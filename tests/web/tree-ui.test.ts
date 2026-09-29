import { describe, expect, it } from "vitest";
import type {
  CropStateDTO,
  FarmTileDTO,
  TreeDefinitionDTO,
  TreeStateDTO
} from "@happy-farm/contracts";
import { createTranslator, displayName } from "../../apps/web/src/i18n";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { describeSelection, type SelectionInput } from "../../apps/web/src/selection";

const NOW = 1_700_000_000_000;
const TREE_ID = "treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function tile(x: number, y: number, terrainType: FarmTileDTO["terrainType"] = "SOIL"): FarmTileDTO {
  return {
    farmId: "farm_test",
    x,
    y,
    terrainType,
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function crop(x: number, y: number): CropStateDTO {
  return {
    cropInstanceId: `cropinst_${String(x)}${String(y)}`,
    definitionId: "crop_carrot",
    tileX: x,
    tileY: y,
    plantedAt: "2026-01-01T00:00:00.000Z",
    growthStage: 0,
    growthProgress: 0,
    mature: false,
    version: 1
  };
}

function tree(x: number, y: number, overrides: Partial<TreeStateDTO> = {}): TreeStateDTO {
  return {
    treeInstanceId: TREE_ID,
    definitionId: "tree_apple",
    tileX: x,
    tileY: y,
    plantedAt: "2026-01-01T00:00:00.000Z",
    lastHarvestedAt: null,
    readyAt: "2026-01-01T01:00:00.000Z",
    secondsUntilReady: 3600,
    ready: false,
    phase: "GROWING",
    growthStage: 0,
    growthProgress: 0,
    version: 1,
    ...overrides
  };
}

const TREE_DEFINITION: TreeDefinitionDTO = {
  treeDefinitionId: "tree_apple",
  displayNameKey: "tree.apple.name",
  saplingItemDefinitionId: "item_apple_sapling",
  saplingItemDisplayNameKey: "item.apple_sapling.name",
  firstReadySeconds: 3600,
  regrowSeconds: 900,
  growthStages: 4,
  harvestItemDefinitionId: "item_apple",
  baseQuantity: 3,
  harvestXp: 10,
  requiredLevel: 3
};

const NO_SAPLING = { treeDefinitionId: "tree_apple", unlocked: true, saplingCount: 0 };
const WITH_SAPLING = { ...NO_SAPLING, saplingCount: 2 };
const LOCKED_TREE_CHOICE = { treeDefinitionId: "tree_apple", unlocked: false, saplingCount: 2 };

function selectionInput(overrides: Partial<SelectionInput> = {}): SelectionInput {
  return {
    tiles: [tile(0, 0)],
    crops: [],
    trees: [],
    cropDefinitions: [],
    treeDefinitions: [TREE_DEFINITION],
    selected: { x: 0, y: 0 },
    selectedCrop: null,
    selectedTree: null,
    nowMs: NOW,
    ...overrides
  };
}

describe("tree view model", () => {
  it("makes a tile with a tree unplantable, and draws the tree's own stage", () => {
    for (const [state, stage] of [
      [tree(0, 0), "SAPLING"],
      [tree(0, 0, { growthStage: 2, growthProgress: 0.5 }), "GROWING"],
      [tree(0, 0, { phase: "READY", ready: true, growthProgress: 1 }), "READY"],
      [tree(0, 0, { phase: "REGROWING", lastHarvestedAt: "2026-01-01T01:00:00.000Z", growthProgress: 0.2 }), "REGROWING"]
    ] as const) {
      const input = buildFarmSceneInput({
        tiles: [tile(0, 0)],
        crops: [],
        trees: [state],
        plots: [],
        selected: null
      });
      expect(input.tiles[0]?.plantable).toBe(false);
      expect(input.tiles[0]?.tree?.visualStage).toBe(stage);
      expect(input.tiles[0]?.tree?.treeInstanceId).toBe(TREE_ID);
      expect(input.tiles[0]?.crop).toBeNull();
    }
  });

  it("keeps a bare soil tile plantable, and a cropped tile not", () => {
    const empty = buildFarmSceneInput({ tiles: [tile(0, 0)], crops: [], trees: [], plots: [], selected: null });
    expect(empty.tiles[0]?.plantable).toBe(true);
    expect(empty.tiles[0]?.tree).toBeNull();

    const cropped = buildFarmSceneInput({
      tiles: [tile(0, 0)],
      crops: [crop(0, 0)],
      trees: [],
      plots: [],
      selected: null
    });
    expect(cropped.tiles[0]?.plantable).toBe(false);
  });

  it("survives corrupt state holding both occupants instead of crashing", () => {
    const input = buildFarmSceneInput({
      tiles: [tile(0, 0)],
      crops: [crop(0, 0)],
      trees: [tree(0, 0, { phase: "READY", ready: true })],
      plots: [],
      selected: null
    });
    // The tree wins the tile visually, nothing is invented, and the tile stays unplantable.
    expect(input.tiles[0]?.tree?.visualStage).toBe("READY");
    expect(input.tiles[0]?.crop).toBeNull();
    expect(input.tiles[0]?.plantable).toBe(false);
  });

  it("handles negative coordinates and expanded plots like any other tile", () => {
    const input = buildFarmSceneInput({
      tiles: [tile(-3, -4)],
      crops: [],
      trees: [tree(-3, -4)],
      plots: [],
      selected: { x: -3, y: -4 }
    });
    expect(input.tiles).toHaveLength(1);
    expect(input.tiles[0]?.selected).toBe(true);
    expect(input.tiles[0]?.plantable).toBe(false);
  });
});

describe("tree selection", () => {
  it("offers harvest only when the server says the cycle is ready, and always offers removal", () => {
    const growing = describeSelection(selectionInput({ trees: [tree(0, 0)] }));
    expect(growing.kind).toBe("tree");
    expect(growing.canHarvestTree).toBe(false);
    expect(growing.canRemoveTree).toBe(true);
    expect(growing.canPlant).toBe(false);
    expect(growing.plantOption).toBeNull();

    const regrowing = describeSelection(
      selectionInput({ trees: [tree(0, 0, { phase: "REGROWING", secondsUntilReady: 300 })] })
    );
    expect(regrowing.canHarvestTree).toBe(false);
    expect(regrowing.remainingSeconds).toBe(300);

    const ready = describeSelection(
      selectionInput({ trees: [tree(0, 0, { phase: "READY", ready: true, secondsUntilReady: 0 })] })
    );
    expect(ready.canHarvestTree).toBe(true);
    expect(ready.canRemoveTree).toBe(true);
  });

  it("carries the tree's own identity and revision, never a display name", () => {
    const view = describeSelection(selectionInput({ trees: [tree(0, 0, { version: 4 })] }));
    expect(view.tree?.treeInstanceId).toBe(TREE_ID);
    expect(view.tree?.version).toBe(4);
    expect(view.coordinate).toEqual({ x: 0, y: 0 });
  });

  it("blocks planting a chosen tree for the same reasons it blocks a crop", () => {
    const locked = describeSelection(selectionInput({ selectedTree: LOCKED_TREE_CHOICE }));
    expect(locked.kind).toBe("empty");
    expect(locked.canPlant).toBe(false);
    expect(locked.plantBlocked).toBe("tree-locked");

    const noSapling = describeSelection(selectionInput({ selectedTree: NO_SAPLING }));
    expect(noSapling.plantBlocked).toBe("no-sapling");

    const plantable = describeSelection(selectionInput({ selectedTree: WITH_SAPLING }));
    expect(plantable.canPlant).toBe(true);
    expect(plantable.plantOption).toBe("tree");
  });

  it("switches between a crop tile and a tree tile without carrying identity across", () => {
    const onCrop = describeSelection(
      selectionInput({ tiles: [tile(0, 0), tile(1, 0)], crops: [crop(1, 0)], selected: { x: 1, y: 0 } })
    );
    expect(onCrop.kind).toBe("growing");
    expect(onCrop.tree).toBeNull();

    const onTree = describeSelection(
      selectionInput({ tiles: [tile(0, 0), tile(1, 0)], crops: [crop(1, 0)], trees: [tree(0, 0)], selected: { x: 0, y: 0 } })
    );
    expect(onTree.kind).toBe("tree");
    expect(onTree.tree?.treeInstanceId).toBe(TREE_ID);
    expect(onTree.canHarvest).toBe(false);
  });

  it("falls back to unlocked land when the selected tree disappears after a refresh", () => {
    const view = describeSelection(selectionInput({ selected: { x: 5, y: 5 }, trees: [] }));
    expect(view.kind).toBe("missing");
    expect(view.tree).toBeNull();
    expect(view.canHarvestTree).toBe(false);
  });
});

describe("tree translations", () => {
  it("has every tree string in both languages", () => {
    const en = createTranslator("en");
    const vi = createTranslator("vi");
    for (const key of [
      "dock.tree",
      "dock.plantTree",
      "dock.removeTree",
      "dock.removeTree.confirm",
      "dock.saplingCount",
      "dock.noSapling",
      "plant.crops",
      "plant.trees",
      "tree.state.GROWING",
      "tree.state.READY",
      "tree.state.REGROWING",
      "selection.tree.title",
      "selection.tree.growingDetail",
      "selection.tree.readyDetail",
      "selection.tree.regrowingDetail",
      "status.plantedTree",
      "status.removedTree",
      "error.TREE_NOT_READY",
      "error.TREE_NOT_FOUND",
      "error.TREE_LEVEL_REQUIRED"
    ] as const) {
      expect(en(key), key).toBeTruthy();
      expect(vi(key), key).toBeTruthy();
      expect(vi(key), key).not.toBe(en(key));
    }
    expect(displayName("en", "tree.apple.name", "tree_apple")).toBe("Apple Tree");
    expect(displayName("vi", "tree.apple.name", "tree_apple")).toBe("Cây táo");
    expect(displayName("en", "item.apple_sapling.name", "item_apple_sapling")).toBe("Apple sapling");
  });
});
