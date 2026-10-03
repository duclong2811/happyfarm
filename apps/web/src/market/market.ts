import type {
  CropDefinitionDTO,
  FishDefinitionDTO,
  InventoryEntryDTO,
  ResourceNodeDTO,
  ShopEntryDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import { itemVisualFor, type ItemVisual } from "../items/visuals";

/**
 * The Farm Market's decisions: which items are on the shelf, in which direction, and what a player is
 * allowed to ask for.
 *
 * The market is the one place where a farming loop closes - seeds go out, produce comes back, gold
 * moves - so the rules are worth testing rather than discovering by tapping. Everything here is pure
 * arithmetic over rows the server already sent. In particular: **no price is computed, invented or
 * adjusted**. A card carries the catalogue's own number, and the server charges its own.
 *
 * Presentation only, in the strongest sense: the quantity bounds below are what the *UI* will let a
 * player ask for. The server independently checks funds, stock, quantity and entry direction, so a
 * client that ignores every bound here still cannot buy a seed it cannot afford.
 */

export type MarketDirection = "buy" | "sell";

export interface MarketCard {
  readonly key: string;
  readonly shopEntryId: string;
  readonly itemDefinitionId: string;
  readonly nameKey: string | null;
  readonly nameFallback: string;
  /** The catalogue's price for one unit, in the direction this card trades. */
  readonly unitPrice: number;
  /** How many the player holds. */
  readonly owned: number;
  readonly maxQuantityPerRequest: number;
  /**
   * The level at which this item can be *planted*, when the catalogues say (seeds and saplings).
   *
   * Deliberately not a purchase lock: the server sells seeds to anybody, and inventing a lock the
   * server does not enforce would be a lie the market tells about its own rules. It is shown because a
   * player deciding what to buy benefits from knowing when they can use it.
   */
  readonly plantingLevel: number | null;
  readonly visual: ItemVisual;
}

export interface MarketInput {
  readonly entries: readonly ShopEntryDTO[];
  readonly direction: MarketDirection;
  readonly inventory: readonly InventoryEntryDTO[];
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  /** The species this deployment can catch, so a fish row draws the fish. */
  readonly fish?: readonly FishDefinitionDTO[];
  /** The island's deposits, so a material row draws the node it came from. */
  readonly resourceNodes?: readonly ResourceNodeDTO[];
  readonly playerLevel: number | null;
}

/** How many of one item the player holds. Duplicate rows are summed, as everywhere else. */
export function ownedQuantity(
  inventory: readonly InventoryEntryDTO[],
  itemDefinitionId: string
): number {
  let total = 0;
  for (const entry of inventory) {
    if (entry.itemDefinitionId !== itemDefinitionId) continue;
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue;
    total += entry.quantity;
  }
  return total;
}

/**
 * The level at which an item becomes plantable, from the catalogue that consumes it.
 *
 * A seed knows its crop and a sapling knows its tree, and those definitions carry the requirement. An
 * item that nothing plants - harvested produce - has none.
 */
export function plantingLevelFor(
  itemDefinitionId: string,
  catalogues: Pick<MarketInput, "cropDefinitions" | "treeDefinitions">
): number | null {
  const crop = catalogues.cropDefinitions.find(
    (definition) => definition.seedItemDefinitionId === itemDefinitionId
  );
  if (crop !== undefined) return crop.requiredLevel;
  const tree = catalogues.treeDefinitions.find(
    (definition) => definition.saplingItemDefinitionId === itemDefinitionId
  );
  return tree?.requiredLevel ?? null;
}

/**
 * What the shelf holds, in the direction being browsed.
 *
 * BUY is everything the catalogue sells. SELL is only what the player actually owns: a selling screen
 * full of things they have none of is a form, not a market. Order is the catalogue's own, except that
 * seeds a player cannot plant yet sort after the ones they can - the useful choices first, exactly as
 * the planting picker does it.
 */
export function marketCards(input: MarketInput): MarketCard[] {
  const ranked: { readonly card: MarketCard; readonly order: number; readonly rank: number }[] = [];
  for (const [order, entry] of input.entries.entries()) {
    if (input.direction === "buy" ? entry.buyPrice === null : entry.sellPrice === null) continue;
    const owned = ownedQuantity(input.inventory, entry.itemDefinitionId);
    // The sell shelf is what the player has; a row they own none of is not a choice.
    if (input.direction === "sell" && owned <= 0) continue;
    const plantingLevel = plantingLevelFor(entry.itemDefinitionId, input);
    ranked.push({
      order,
      rank: plantingRank(plantingLevel, input.playerLevel),
      card: {
        key: entry.shopEntryId,
        shopEntryId: entry.shopEntryId,
        itemDefinitionId: entry.itemDefinitionId,
        nameKey: entry.itemDisplayNameKey,
        nameFallback: entry.itemDefinitionId,
        unitPrice: (input.direction === "buy" ? entry.buyPrice : entry.sellPrice) ?? 0,
        owned,
        maxQuantityPerRequest: entry.maxQuantityPerRequest,
        plantingLevel,
        visual: itemVisualFor(entry.itemDefinitionId, input)
      }
    });
  }
  // Stable in both keys: a group of equally-usable choices keeps the catalogue's own order, so the
  // shelf does not reshuffle itself between refreshes.
  ranked.sort((left, right) => (left.rank === right.rank ? left.order - right.order : left.rank - right.rank));
  return ranked.map((entry) => entry.card);
}

function plantingRank(plantingLevel: number | null, playerLevel: number | null): number {
  if (plantingLevel === null || playerLevel === null) return 0;
  return playerLevel >= plantingLevel ? 0 : 1;
}

export function marketCardFor(cards: readonly MarketCard[], key: string | null): MarketCard | null {
  if (key === null) return null;
  return cards.find((card) => card.key === key) ?? null;
}

/**
 * Which tab the market opens on.
 *
 * Walking up to the stall with a bag full of carrots should offer to sell them; with an empty bag it
 * should offer seeds. Either way the player can switch tabs - this only picks the one that is more
 * likely to be what they walked over for.
 */
export function defaultMarketDirection(input: MarketInput): MarketDirection {
  return marketCards({ ...input, direction: "sell" }).length > 0 ? "sell" : "buy";
}

export interface MarketBounds {
  readonly min: number;
  /** The most the player may ask for. Zero means this trade cannot be made at all. */
  readonly max: number;
}

/** The most of one item a wallet can pay for, as a convenience - never as authority. */
export function marketMaxAffordable(gold: number, unitPrice: number, maxPerRequest: number): number {
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) return 0;
  if (!Number.isSafeInteger(maxPerRequest) || maxPerRequest <= 0) return 0;
  return Math.min(Math.floor(gold / unitPrice), maxPerRequest);
}

/**
 * What the quantity control may range over.
 *
 * Selling is bounded by what the player holds; buying is bounded by what the wallet covers and by the
 * entry's own per-request ceiling. `max === 0` is the honest answer to "you cannot afford one" or "you
 * have none", and the UI refuses to submit rather than sending a request the server would reject.
 */
export function marketQuantityBounds(
  card: MarketCard,
  direction: MarketDirection,
  gold: number
): MarketBounds {
  const max =
    direction === "sell"
      ? Math.min(card.owned, card.maxQuantityPerRequest)
      : marketMaxAffordable(gold, card.unitPrice, card.maxQuantityPerRequest);
  return { min: 1, max: Math.max(0, Number.isSafeInteger(max) ? max : 0) };
}

export function clampMarketQuantity(quantity: number, bounds: MarketBounds): number {
  if (!Number.isFinite(quantity)) return bounds.min;
  const whole = Math.floor(quantity);
  if (bounds.max < bounds.min) return bounds.min;
  return Math.min(Math.max(whole, bounds.min), bounds.max);
}

/** One press of the stepper, clamped. */
export function marketQuantityStep(current: number, delta: number, bounds: MarketBounds): number {
  return clampMarketQuantity(current + delta, bounds);
}

/** What the player will pay or receive. Presentation only: the server settles its own number. */
export function marketTotal(unitPrice: number, quantity: number): number {
  if (!Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(quantity)) return 0;
  const total = unitPrice * quantity;
  return Number.isSafeInteger(total) ? total : 0;
}

export function marketCanSubmit(quantity: number, bounds: MarketBounds): boolean {
  return bounds.max >= bounds.min && Number.isSafeInteger(quantity) && quantity >= bounds.min && quantity <= bounds.max;
}
