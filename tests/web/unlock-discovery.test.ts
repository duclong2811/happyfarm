import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  BuildCatalogEntryDTO,
  CropDefinitionDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import { createTranslator } from "../../apps/web/src/i18n";
import {
  LEVEL_UP_DURATION_MS,
  levelUpFeedback,
  unlockNotices,
  type UnlockDiscoveryInput
} from "../../apps/web/src/unlocks";

/**
 * What a level-up says it unlocked.
 *
 * The list is a diff over the server's own catalogues, so the fixtures here are catalogue rows: a
 * crop, a tree, and a building, each carrying the level the server already enforces. The test is
 * that the client says only what actually changed between two levels, never what it was told to say.
 */

const STYLES = fileURLToPath(new URL("../../apps/web/src/styles.css", import.meta.url));
const en = createTranslator("en");
const vi = createTranslator("vi");

function crop(id: string, requiredLevel: number): CropDefinitionDTO {
  return {
    cropDefinitionId: id,
    displayNameKey: `crop.${id.replace(/^crop_/, "")}.name`,
    growthDurationSeconds: 60,
    seedItemDefinitionId: `item_${id.replace(/^crop_/, "")}_seed`,
    seedItemDisplayNameKey: `item.${id.replace(/^crop_/, "")}_seed.name`,
    harvestItemDefinitionId: `item_${id.replace(/^crop_/, "")}`,
    baseQuantity: 1,
    harvestXp: 1,
    requiredLevel
  };
}

function tree(id: string, requiredLevel: number): TreeDefinitionDTO {
  return {
    treeDefinitionId: id,
    displayNameKey: `tree.${id.replace(/^tree_/, "")}.name`,
    saplingItemDefinitionId: `item_${id.replace(/^tree_/, "")}_sapling`,
    saplingItemDisplayNameKey: `item.${id.replace(/^tree_/, "")}_sapling.name`,
    firstReadySeconds: 3600,
    regrowSeconds: 900,
    growthStages: 4,
    harvestItemDefinitionId: `item_${id.replace(/^tree_/, "")}`,
    baseQuantity: 1,
    harvestXp: 1,
    requiredLevel
  };
}

function building(entryId: string, requiredLevel: number, label: string): BuildCatalogEntryDTO {
  return {
    entryId,
    category: "BUILDING",
    displayNameKey: `place.${entryId.replace(/^place_/, "")}.name`,
    label,
    descriptionKey: null,
    modelId: null,
    requiredLevel,
    price: 0,
    currencyDefinitionId: "currency_gold",
    footprint: { widthCells: 1, depthCells: 1 },
    allowedTerrain: ["LAND"],
    tier: null,
    tierRank: null,
    upgradeTo: null,
    rotatable: true,
    movable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0,
    decorative: false,
    tags: [],
    unlockCondition: "OWNED_LAND",
    gameplay: {
      classification: "COSMETIC",
      status: "ACTIVE",
      summaryKey: "place.effect",
      production: null,
      storage: null,
      movement: null,
      workerTask: null
    }
  };
}

function input(overrides: Partial<UnlockDiscoveryInput> = {}): UnlockDiscoveryInput {
  return {
    cropDefinitions: [crop("crop_carrot", 1), crop("crop_wheat", 2), crop("crop_corn", 3)],
    treeDefinitions: [tree("tree_apple", 3)],
    buildCatalog: [building("place_barn_basic", 1, "Barn"), building("place_barn_grand", 4, "Grand Barn")],
    previousLevel: 1,
    level: 2,
    ...overrides
  };
}

describe("unlock discovery", () => {
  it("reports only the content that became eligible at the new level", () => {
    expect(unlockNotices(input()).map((notice) => notice.key)).toEqual(["crop:crop_wheat"]);
  });

  it("includes a tree unlocked at the same level as a crop, in a stable order", () => {
    expect(unlockNotices(input({ level: 3 })).map((notice) => notice.key)).toEqual([
      "crop:crop_wheat",
      "crop:crop_corn",
      "tree:tree_apple"
    ]);
  });

  it("never reports content the player could already use, or content still locked", () => {
    // Carrot and the basic barn are level 1, and the grand barn is level 4: none of them is news at
    // level 2, exactly as none of them would be withheld from the picker at level 2.
    const keys = unlockNotices(input({ level: 3 })).map((notice) => notice.key);
    expect(keys).not.toContain("crop:crop_carrot");
    expect(keys).not.toContain("build:place_barn_basic");
    expect(keys).not.toContain("build:place_barn_grand");
  });

  it("adds a building when its own level arrives, without a second evaluator", () => {
    expect(unlockNotices(input({ level: 4 })).map((notice) => notice.key)).toEqual([
      "crop:crop_wheat",
      "crop:crop_corn",
      "tree:tree_apple",
      "build:place_barn_grand"
    ]);
  });

  it("says nothing when the level did not rise", () => {
    expect(unlockNotices(input({ previousLevel: 3, level: 3 }))).toEqual([]);
    expect(unlockNotices(input({ previousLevel: 5, level: 3 }))).toEqual([]);
  });

  it("says nothing when either level is unknown or malformed", () => {
    // An unknown level must not announce the whole catalogue, and a fractional one must not be
    // treated as a real level either. Saying too little is the safe direction.
    expect(unlockNotices(input({ previousLevel: null }))).toEqual([]);
    expect(unlockNotices(input({ level: null }))).toEqual([]);
    expect(unlockNotices(input({ previousLevel: 1.5 }))).toEqual([]);
    expect(unlockNotices(input({ level: Number.NaN }))).toEqual([]);
    expect(unlockNotices(input({ level: Number.POSITIVE_INFINITY }))).toEqual([]);
  });

  it("carries the catalogue's own name key and a fallback", () => {
    const [wheat] = unlockNotices(input());
    expect(wheat).toMatchObject({
      kind: "crop",
      labelKey: "crop.wheat.name",
      fallback: "crop_wheat"
    });
    const [, , , grandBarn] = unlockNotices(input({ level: 4 }));
    expect(grandBarn).toMatchObject({
      kind: "building",
      labelKey: "place.barn_grand.name",
      fallback: "Grand Barn"
    });
  });
});

describe("level-up feedback", () => {
  it("shows the level and what it opened, when it opened something", () => {
    expect(levelUpFeedback(3, ["Wheat", "Apple Tree"], en)).toEqual({
      title: "Level 3",
      detail: "Unlocked Wheat, Apple Tree"
    });
  });

  it("shows the level alone when it opened nothing", () => {
    expect(levelUpFeedback(2, [], en)).toEqual({ title: "Level 2", detail: null });
  });

  it("phrases both lines in Vietnamese without touching the numbers", () => {
    expect(levelUpFeedback(3, ["Wheat"], vi)).toEqual({
      title: "Cấp 3",
      detail: "Mở khoá Wheat"
    });
  });

  it("stays on screen for as long as the stylesheet animates it", () => {
    const css = readFileSync(STYLES, "utf8");
    expect(css).toContain(`animation: level-up-rise ${String(LEVEL_UP_DURATION_MS / 1000)}s`);
    expect(css).toContain(".level-up.is-live");
  });
});
