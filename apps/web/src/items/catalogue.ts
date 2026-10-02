import type { CropDefinitionDTO, InventoryEntryDTO, TreeDefinitionDTO } from "@happy-farm/contracts";
import { itemVisualFor, cropVisualFor, saplingVisual, seedVisual, type ItemVisual } from "./visuals";

/**
 * What the inventory and the planting picker should show, decided without touching the DOM.
 *
 * Both surfaces are presentations of the same server state, and both have rules that are worth testing
 * rather than discovering by clicking: which items are worth showing at all, which group a planting
 * choice belongs in, what order the choices come in, and whether yesterday's choice is still a choice.
 * Everything here is pure arithmetic over rows the page already holds - no fetch, no clock, no element.
 */

/** The inventory's tabs. `ALL` is a view; the others are what an item actually *is*. */
export type InventoryCategory = "ALL" | "PRODUCE" | "SEEDS" | "SAPLINGS";

/** The order the tabs are offered in. A category with nothing in it is not offered at all. */
export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = [
  "ALL",
  "PRODUCE",
  "SEEDS",
  "SAPLINGS"
];

export type InventoryItemCategory = Exclude<InventoryCategory, "ALL">;

export interface InventoryCard {
  readonly key: string;
  readonly itemDefinitionId: string;
  readonly nameKey: string | null;
  readonly nameFallback: string;
  readonly quantity: number;
  readonly category: InventoryItemCategory;
  readonly visual: ItemVisual;
}

export interface InventoryInput {
  readonly inventory: readonly InventoryEntryDTO[];
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
}

/**
 * Which shelf an item belongs on.
 *
 * The server's own category is the first word - produce is what a crop yields - but a seed and a
 * sapling share that category, and they are different things to a player: one plants a field, the
 * other plants a tree. The catalogues say which is which, so the answer is a lookup rather than a
 * guess from the id's spelling.
 */
export function inventoryCategoryOf(
  itemDefinitionId: string,
  itemCategory: string,
  catalogues: Pick<InventoryInput, "cropDefinitions" | "treeDefinitions">
): InventoryItemCategory {
  if (
    catalogues.treeDefinitions.some(
      (definition) => definition.saplingItemDefinitionId === itemDefinitionId
    )
  ) {
    return "SAPLINGS";
  }
  if (itemCategory === "CROP") return "PRODUCE";
  return "SEEDS";
}

/**
 * The inventory as cards.
 *
 * Zero-quantity entries are dropped: the server keeps a row for everything it has ever given a player,
 * and an inventory that lists a dozen things they do not have is a form, not a shelf. Duplicate rows for
 * one item are summed, because "35 carrots and 5 carrots" is one pile of forty to everybody except a
 * database.
 */
export function inventoryCards(input: InventoryInput): InventoryCard[] {
  const order: string[] = [];
  const totals = new Map<string, { quantity: number; displayNameKey: string | null; category: string }>();
  for (const entry of input.inventory) {
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue;
    const known = totals.get(entry.itemDefinitionId);
    if (known === undefined) {
      order.push(entry.itemDefinitionId);
      totals.set(entry.itemDefinitionId, {
        quantity: entry.quantity,
        displayNameKey: entry.displayNameKey,
        category: entry.category
      });
    } else {
      known.quantity += entry.quantity;
    }
  }
  return order.map((itemDefinitionId) => {
    const row = totals.get(itemDefinitionId) as { quantity: number; displayNameKey: string | null; category: string };
    return {
      key: itemDefinitionId,
      itemDefinitionId,
      nameKey: row.displayNameKey,
      nameFallback: itemDefinitionId,
      quantity: row.quantity,
      category: inventoryCategoryOf(itemDefinitionId, row.category, input),
      visual: itemVisualFor(itemDefinitionId, input)
    };
  });
}

/** How many cards each tab would show. `ALL` counts every card. */
export function inventoryCategoryCounts(
  cards: readonly InventoryCard[]
): Readonly<Record<InventoryCategory, number>> {
  const counts: Record<InventoryCategory, number> = { ALL: cards.length, PRODUCE: 0, SEEDS: 0, SAPLINGS: 0 };
  for (const card of cards) counts[card.category] += 1;
  return counts;
}

/** The tabs worth offering: everything, plus each category that actually has something in it. */
export function inventoryTabs(cards: readonly InventoryCard[]): readonly InventoryCategory[] {
  const counts = inventoryCategoryCounts(cards);
  return INVENTORY_CATEGORIES.filter((category) => category === "ALL" || counts[category] > 0);
}

export function visibleInventoryCards(
  cards: readonly InventoryCard[],
  category: InventoryCategory
): readonly InventoryCard[] {
  return category === "ALL" ? cards : cards.filter((card) => card.category === category);
}

/**
 * Which planting choices a player is looking at, and in what order.
 *
 * `AVAILABLE` first (unlocked, seeds in hand), then unlocked-but-empty, then level-locked: the player
 * should never have to scroll past content they cannot use to reach the carrot they have forty seeds
 * for. Catalog order inside each group, exactly as the server sent it, so the list does not reshuffle
 * between refreshes.
 */
export type PlantGroup = "AVAILABLE" | "NO_SEEDS" | "LOCKED";

export interface PlantOption {
  readonly key: string;
  readonly kind: "CROP" | "TREE";
  readonly definitionId: string;
  readonly nameKey: string | null;
  readonly nameFallback: string;
  /** Seeds (crop) or saplings (tree) the player holds. */
  readonly stored: number;
  readonly requiredLevel: number;
  /** Seconds until the first harvest, for the card's own metadata line. */
  readonly growthSeconds: number;
  readonly group: PlantGroup;
  /**
   * Whether the card may be chosen.
   *
   * Only a choice the player can act on is choosable: a locked crop and a crop with no seeds in hand
   * are both *visible* - they tell the player what to work towards - and both inert, so a card can
   * never look selectable and then refuse to plant.
   */
  readonly selectable: boolean;
  /** Why it cannot be planted, phrased by the caller. Never both: the level is the first answer. */
  readonly blockedReason: "NO_SEEDS" | "LEVEL" | null;
  readonly visual: ItemVisual;
}

export interface PlantOptionsInput {
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  readonly playerLevel: number | null;
  readonly seedCounts: ReadonlyMap<string, number>;
  readonly saplingCounts: ReadonlyMap<string, number>;
}

const GROUP_ORDER: Readonly<Record<PlantGroup, number>> = { AVAILABLE: 0, NO_SEEDS: 1, LOCKED: 2 };

export function plantOptions(input: PlantOptionsInput): PlantOption[] {
  const options: PlantOption[] = [];
  for (const definition of input.cropDefinitions) {
    const stored = input.seedCounts.get(definition.seedItemDefinitionId) ?? 0;
    const unlocked = input.playerLevel === null || input.playerLevel >= definition.requiredLevel;
    const group: PlantGroup = !unlocked ? "LOCKED" : stored > 0 ? "AVAILABLE" : "NO_SEEDS";
    options.push({
      key: `crop:${definition.cropDefinitionId}`,
      kind: "CROP",
      definitionId: definition.cropDefinitionId,
      nameKey: definition.displayNameKey,
      nameFallback: definition.cropDefinitionId,
      stored,
      requiredLevel: definition.requiredLevel,
      growthSeconds: definition.growthDurationSeconds,
      group,
      selectable: group === "AVAILABLE",
      // The level is the reason, not the seed count: telling a level-2 player that wheat needs seeds
      // they cannot use yet would send them shopping for the wrong problem.
      blockedReason: group === "LOCKED" ? "LEVEL" : group === "NO_SEEDS" ? "NO_SEEDS" : null,
      visual: cropVisualFor(definition.cropDefinitionId)
    });
  }
  for (const definition of input.treeDefinitions) {
    const stored = input.saplingCounts.get(definition.saplingItemDefinitionId) ?? 0;
    const unlocked = input.playerLevel === null || input.playerLevel >= definition.requiredLevel;
    const group: PlantGroup = !unlocked ? "LOCKED" : stored > 0 ? "AVAILABLE" : "NO_SEEDS";
    options.push({
      key: `tree:${definition.treeDefinitionId}`,
      kind: "TREE",
      definitionId: definition.treeDefinitionId,
      nameKey: definition.displayNameKey,
      nameFallback: definition.treeDefinitionId,
      stored,
      requiredLevel: definition.requiredLevel,
      growthSeconds: definition.firstReadySeconds,
      group,
      selectable: group === "AVAILABLE",
      blockedReason: group === "LOCKED" ? "LEVEL" : group === "NO_SEEDS" ? "NO_SEEDS" : null,
      visual: saplingVisual()
    });
  }
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) =>
      GROUP_ORDER[left.option.group] === GROUP_ORDER[right.option.group]
        ? left.index - right.index
        : GROUP_ORDER[left.option.group] - GROUP_ORDER[right.option.group]
    )
    .map((entry) => entry.option);
}

/** What the picker should preselect before the player has chosen anything. */
export function defaultPlantChoice(options: readonly PlantOption[]): string | null {
  return options.find((option) => option.group === "AVAILABLE")?.key ?? null;
}

/**
 * What stays selected when the picker is rebuilt - which happens after every action and every poll.
 *
 * A remembered choice survives only while it can actually be planted. Seeds run out, and a crop the
 * player has just spent their last seed on must fall back to something they can use rather than sitting
 * there selected and disabled; a level-locked crop must never be remembered at all. That is what makes
 * repeated planting one tap per tile instead of two.
 */
export function rememberedPlantChoice(
  previousKey: string | null,
  options: readonly PlantOption[]
): string | null {
  if (previousKey !== null) {
    const previous = options.find((option) => option.key === previousKey);
    if (previous !== undefined && previous.group === "AVAILABLE") return previous.key;
  }
  return defaultPlantChoice(options);
}

/** The seed/sapling counts the picker needs, read from the server's inventory rows. */
export function storedCounts(
  inventory: readonly InventoryEntryDTO[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of inventory) {
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue;
    counts.set(entry.itemDefinitionId, (counts.get(entry.itemDefinitionId) ?? 0) + entry.quantity);
  }
  return counts;
}

/** The visual for a crop, re-exported so a caller does not reach into `visuals.ts` for one thing. */
export { cropVisualFor, seedVisual };
