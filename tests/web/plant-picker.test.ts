import { describe, expect, it } from "vitest";
import type { CropDefinitionDTO, TreeDefinitionDTO } from "@happy-farm/contracts";
import {
  defaultPlantChoice,
  plantOptions,
  rememberedPlantChoice,
  storedCounts,
  type PlantOption
} from "../../apps/web/src/items/catalogue";

/**
 * The planting picker: what a player is offered, in what order, and what happens to their choice.
 *
 * This is the difference between a farming loop and a form. The list puts what the player can plant
 * first, a locked crop explains the *level* rather than an empty pouch, and the choice they made
 * survives a refresh while they can still act on it - which is what makes planting a field one tap per
 * tile instead of two decisions per tile.
 */

const CROPS: readonly CropDefinitionDTO[] = [
  {
    cropDefinitionId: "crop_carrot",
    displayNameKey: "crop.carrot.name",
    growthDurationSeconds: 300,
    seedItemDefinitionId: "item_carrot_seed",
    seedItemDisplayNameKey: "item.carrot_seed.name",
    harvestItemDefinitionId: "item_carrot",
    baseQuantity: 2,
    harvestXp: 1,
    requiredLevel: 1
  },
  {
    cropDefinitionId: "crop_corn",
    displayNameKey: "crop.corn.name",
    growthDurationSeconds: 900,
    seedItemDefinitionId: "item_corn_seed",
    seedItemDisplayNameKey: "item.corn_seed.name",
    harvestItemDefinitionId: "item_corn",
    baseQuantity: 3,
    harvestXp: 2,
    requiredLevel: 1
  },
  {
    cropDefinitionId: "crop_wheat",
    displayNameKey: "crop.wheat.name",
    growthDurationSeconds: 600,
    seedItemDefinitionId: "item_wheat_seed",
    seedItemDisplayNameKey: "item.wheat_seed.name",
    harvestItemDefinitionId: "item_wheat",
    baseQuantity: 2,
    harvestXp: 2,
    requiredLevel: 3
  }
];

const TREES: readonly TreeDefinitionDTO[] = [
  {
    treeDefinitionId: "tree_apple",
    displayNameKey: "tree.apple.name",
    saplingItemDefinitionId: "item_apple_sapling",
    saplingItemDisplayNameKey: "item.apple_sapling.name",
    firstReadySeconds: 3600,
    regrowSeconds: 600,
    growthStages: 3,
    harvestItemDefinitionId: "item_apple",
    baseQuantity: 3,
    harvestXp: 4,
    requiredLevel: 1
  }
];

function options(input: {
  readonly level?: number | null;
  readonly seeds?: Readonly<Record<string, number>>;
  readonly saplings?: Readonly<Record<string, number>>;
}): PlantOption[] {
  return plantOptions({
    cropDefinitions: CROPS,
    treeDefinitions: TREES,
    playerLevel: input.level === undefined ? 1 : input.level,
    seedCounts: new Map(Object.entries(input.seeds ?? {})),
    saplingCounts: new Map(Object.entries(input.saplings ?? {}))
  });
}

function find(list: readonly PlantOption[], key: string): PlantOption | undefined {
  return list.find((option) => option.key === key);
}

describe("planting choices", () => {
  it("offers every catalogue entry, crop and tree alike", () => {
    const list = options({ seeds: { item_carrot_seed: 39 } });
    expect(list.map((option) => option.key)).toContain("crop:crop_carrot");
    expect(list.map((option) => option.key)).toContain("tree:tree_apple");
    expect(find(list, "tree:tree_apple")?.kind).toBe("TREE");
    expect(find(list, "tree:tree_apple")?.growthSeconds).toBe(3600);
  });

  it("sorts what the player can use first, then what they cannot, keeping catalogue order inside a group", () => {
    const list = options({
      level: 1,
      seeds: { item_corn_seed: 8 },
      saplings: { item_apple_sapling: 2 }
    });
    // Available first (corn, apple - in catalogue order), then unlocked with nothing to plant, then
    // the level-locked wheat.
    expect(list.map((option) => `${option.group}:${option.key}`)).toEqual([
      "AVAILABLE:crop:crop_corn",
      "AVAILABLE:tree:tree_apple",
      "NO_SEEDS:crop:crop_carrot",
      "LOCKED:crop:crop_wheat"
    ]);
  });

  it("keeps a zero-seed crop visible but unchoosable, and says why", () => {
    const list = options({ seeds: { item_carrot_seed: 39 } });
    const corn = find(list, "crop:crop_corn");
    expect(corn?.stored).toBe(0);
    expect(corn?.group).toBe("NO_SEEDS");
    expect(corn?.blockedReason).toBe("NO_SEEDS");
    // Visible (it communicates progression) but not selectable as plantable.
    expect(corn?.selectable).toBe(false);
  });

  it("blames the level, not the empty pouch, when a crop is locked", () => {
    // A level-2 player with no wheat seeds must be told about the level: the seed count is not the
    // problem they can fix.
    const locked = find(options({ level: 2, seeds: {} }), "crop:crop_wheat");
    expect(locked?.group).toBe("LOCKED");
    expect(locked?.blockedReason).toBe("LEVEL");
    expect(locked?.requiredLevel).toBe(3);
    expect(locked?.selectable).toBe(false);
  });

  it("treats an unknown level as no lock rather than locking everything", () => {
    const list = options({ level: null, seeds: {} });
    expect(list.every((option) => option.group !== "LOCKED")).toBe(true);
  });

  it("moves a locked crop to plantable on the same seeds the moment the level arrives", () => {
    // The state a level-up leaves: nothing bought and nothing changed but the level. The picker is
    // rebuilt from the catalogue and the new level, so wheat goes LOCKED -> AVAILABLE with no reload.
    const seeds = { item_wheat_seed: 2 };
    expect(find(options({ level: 2, seeds }), "crop:crop_wheat")?.group).toBe("LOCKED");
    const unlocked = find(options({ level: 3, seeds }), "crop:crop_wheat");
    expect(unlocked?.group).toBe("AVAILABLE");
    expect(unlocked?.selectable).toBe(true);
    // With no seed in hand the same level change lands on NO_SEEDS instead - still unlockable news,
    // but the pocket is what is missing.
    const empty = find(options({ level: 3, seeds: {} }), "crop:crop_wheat");
    expect(empty?.group).toBe("NO_SEEDS");
    expect(empty?.blockedReason).toBe("NO_SEEDS");
  });
});

describe("the remembered planting choice", () => {
  it("starts on the first available choice", () => {
    const list = options({ seeds: { item_corn_seed: 8 } });
    expect(defaultPlantChoice(list)).toBe("crop:crop_corn");
  });

  it("keeps a valid choice, so the next tile needs no second decision", () => {
    const list = options({ seeds: { item_carrot_seed: 39, item_corn_seed: 8 } });
    // Same options, new cell: the player's crop is still their crop.
    expect(rememberedPlantChoice("crop:crop_corn", list)).toBe("crop:crop_corn");
  });

  it("drops a choice whose seeds have run out, and picks the next one they can use", () => {
    const list = options({ seeds: { item_corn_seed: 8 } });
    // The carrot seeds were spent on the previous tile: Carrot is still on the shelf but cannot be
    // planted, so the choice moves to something that can.
    expect(rememberedPlantChoice("crop:crop_carrot", list)).toBe("crop:crop_corn");
  });

  it("drops a choice that has become level-locked rather than remembering it", () => {
    const list = options({ level: 1, seeds: {} });
    expect(rememberedPlantChoice("crop:crop_wheat", list)).toBeNull();
  });

  it("drops a choice that is no longer in the catalogue at all", () => {
    const list = options({ seeds: { item_carrot_seed: 1 } });
    expect(rememberedPlantChoice("crop:crop_pumpkin", list)).toBe("crop:crop_carrot");
  });

  it("has nothing to remember when the player cannot plant anything", () => {
    const list = options({ level: 1, seeds: {}, saplings: {} });
    expect(defaultPlantChoice(list)).toBeNull();
    expect(rememberedPlantChoice("crop:crop_carrot", list)).toBeNull();
  });
});

describe("stored counts", () => {
  it("counts what the player holds, ignoring empty rows and negative nonsense", () => {
    const counts = storedCounts([
      { itemDefinitionId: "item_carrot_seed", displayNameKey: "k", category: "SEED", quantity: 39 },
      { itemDefinitionId: "item_carrot_seed", displayNameKey: "k", category: "SEED", quantity: 1 },
      { itemDefinitionId: "item_corn_seed", displayNameKey: "k", category: "SEED", quantity: 0 },
      { itemDefinitionId: "item_apple_sapling", displayNameKey: "k", category: "SEED", quantity: 2 }
    ]);
    expect(counts.get("item_carrot_seed")).toBe(40);
    expect(counts.has("item_corn_seed")).toBe(false);
    expect(counts.get("item_apple_sapling")).toBe(2);
  });
});
