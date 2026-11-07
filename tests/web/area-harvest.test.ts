import type { CropDefinitionDTO, CropStateDTO, TreeDefinitionDTO, TreeStateDTO } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { areaHarvestGroups, areaHarvestPanelStage, previewAreaHarvest } from "../../apps/web/src/area-harvest";
import { previewAreaPlanting } from "../../apps/web/src/area-planting";
import type { PlantOption } from "../../apps/web/src/items/catalogue";
import type { WorldCell, WorldCellMap } from "../../apps/web/src/render/world-cell";

const definition: TreeDefinitionDTO = {
  treeDefinitionId: "tree_apple",
  displayNameKey: "tree.apple.name",
  saplingItemDefinitionId: "item_apple_sapling",
  saplingItemDisplayNameKey: "item.apple_sapling.name",
  firstReadySeconds: 3600,
  regrowSeconds: 900,
  growthStages: 4,
  harvestItemDefinitionId: "item_apple",
  baseQuantity: 3,
  harvestXp: 9,
  requiredLevel: 3
};

function tree(index: number, ready = true, definitionId = "tree_apple"): TreeStateDTO {
  return {
    treeInstanceId: `treeinst_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    definitionId,
    tileX: index,
    tileY: 0,
    plantedAt: "2026-01-01T00:00:00.000Z",
    lastHarvestedAt: null,
    readyAt: ready ? "2026-01-01T01:00:00.000Z" : "2026-01-01T02:00:00.000Z",
    secondsUntilReady: ready ? 0 : 3600,
    ready,
    phase: ready ? "READY" : "GROWING",
    growthStage: ready ? 3 : 1,
    growthProgress: ready ? 1 : 0.5,
    version: 1
  };
}

const cropDefinition: CropDefinitionDTO = {
  cropDefinitionId: "crop_carrot",
  displayNameKey: "crop.carrot.name",
  growthDurationSeconds: 300,
  seedItemDefinitionId: "item_carrot_seed",
  seedItemDisplayNameKey: "item.carrot_seed.name",
  harvestItemDefinitionId: "item_carrot",
  baseQuantity: 2,
  harvestXp: 4,
  requiredLevel: 1
};

function crop(index: number, mature = true): CropStateDTO {
  return {
    cropInstanceId: `cropinst_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    definitionId: "crop_carrot",
    tileX: index,
    tileY: 0,
    plantedAt: mature ? "2026-01-01T00:00:00.000Z" : "2026-01-01T00:04:59.000Z",
    growthStage: mature ? 3 : 2,
    growthProgress: mature ? 1 : 0.99,
    mature,
    version: 1
  };
}

describe("area fruit-tree harvest preview", () => {
  it("keeps the shared panel in instruction-only states until both corners exist", () => {
    expect(areaHarvestPanelStage(null, null)).toBe("CHOOSE_FIRST");
    expect(areaHarvestPanelStage({ x: 1, y: 2 }, null)).toBe("CHOOSE_SECOND");
    expect(areaHarvestPanelStage({ x: 1, y: 2 }, { x: 4, y: 5 })).toBe("PREVIEW");
  });

  it("counts ready fruit trees, expected products, and skipped trees", () => {
    const preview = previewAreaHarvest(
      [tree(0), tree(1, false), tree(2, true, "tree_wildwood"), tree(8)],
      [definition],
      [{ x: 0, y: 0 }, { x: 2, y: 0 }]
    );
    expect(preview.readyCount).toBe(1);
    expect(preview.skippedCount).toBe(2);
    expect(preview.treesInArea).toBe(3);
    expect(preview.products).toEqual([{ itemDefinitionId: "item_apple", quantity: 3 }]);
  });

  it("classifies every cell into planned, waiting, or invalid from the world cell map", () => {
    const preview = previewAreaHarvest(
      [tree(0), tree(1, false)],
      [definition],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [],
      [],
      plantingMap([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1, occupied: true }])
    );

    expect(preview.plannedCells).toEqual([{ x: 0, y: 0, bucket: "PLANNED", reason: "NOT_READY" }]);
    expect(preview.waitingCells).toEqual([{ x: 1, y: 0, bucket: "WAITING", reason: "NOT_READY" }]);
    expect(preview.invalidCells).toEqual([
      { x: 0, y: 1, bucket: "INVALID", reason: "NO_TARGET" },
      { x: 1, y: 1, bucket: "INVALID", reason: "OCCUPIED" }
    ]);
    expect(preview.skippedCount).toBe(3);
  });

  it.each([1, 25, 100])("handles %s trees without changing the selection contract", (count) => {
    const trees = Array.from({ length: count }, (_, index) => tree(index));
    const preview = previewAreaHarvest(trees, [definition], [{ x: 0, y: 0 }, { x: count - 1, y: 0 }]);
    expect(preview.candidates).toHaveLength(count);
    expect(preview.products).toEqual([{ itemDefinitionId: "item_apple", quantity: count * 3 }]);
  });

  it("splits a hundred candidates into four retryable server groups", () => {
    const candidates = Array.from({ length: 100 }, (_, index) => ({ id: index }));
    const groups = areaHarvestGroups(candidates);
    expect(groups.map((group) => group.length)).toEqual([25, 25, 25, 25]);
    expect(groups.flat()).toEqual(candidates);
  });

  it("counts ready crops separately and keeps immature crops skipped in a mixed orchard", () => {
    const preview = previewAreaHarvest(
      [tree(0)],
      [definition],
      [{ x: 0, y: 0 }, { x: 2, y: 0 }],
      [crop(1), crop(2, false)],
      [cropDefinition]
    );
    expect(preview.fruitReadyCount).toBe(1);
    expect(preview.cropReadyCount).toBe(1);
    expect(preview.readyCount).toBe(2);
    expect(preview.skippedCount).toBe(1);
    expect(preview.cropCandidates).toHaveLength(1);
    expect(preview.products).toEqual([
      { itemDefinitionId: "item_apple", quantity: 3 },
      { itemDefinitionId: "item_carrot", quantity: 2 }
    ]);
  });

  it("supports one hundred ready crops as four bounded groups", () => {
    const preview = previewAreaHarvest(
      [],
      [],
      [{ x: 0, y: 0 }, { x: 99, y: 0 }],
      Array.from({ length: 100 }, (_, index) => crop(index)),
      [cropDefinition]
    );
    expect(areaHarvestGroups(preview.cropCandidates)).toHaveLength(4);
    expect(areaHarvestGroups(preview.cropCandidates).map((group) => group.length)).toEqual([25, 25, 25, 25]);
  });
});

function plantingMap(cells: readonly { x: number; y: number; occupied?: boolean }[]) {
  return {
    cells: new Map(
      cells.map((entry) => [
        `${String(entry.x)},${String(entry.y)}`,
        {
          x: entry.x,
          z: entry.y,
          terrain: "LAND",
          zone: "NONE",
          owned: true,
          shallowWater: false,
          reserved: false,
          walkable: true,
          buildable: !entry.occupied,
          occupancy: entry.occupied ? "BUILDING" : "EMPTY",
          productionCapability: "CROP",
          capabilities: ["WALK", "BUILD", "FARM"],
          road: null,
          legacyFarmTile: { x: entry.x, y: entry.y }
        } satisfies WorldCell
      ])
    )
  } as unknown as WorldCellMap;
}

const carrotOption: PlantOption = {
  key: "crop:crop_carrot",
  kind: "CROP",
  definitionId: "crop_carrot",
  nameKey: "crop.carrot.name",
  nameFallback: "crop_carrot",
  stored: 25,
  requiredLevel: 1,
  growthSeconds: 300,
  group: "AVAILABLE",
  selectable: true,
  blockedReason: null,
  visual: { key: "fallback:SEED_CARROT", fallback: "SEED_CARROT", request: { modelId: null, imageUrl: null, roadTierId: null } }
};

describe("area planting preview", () => {
  it("uses the shared two-corner rectangle and marks occupied cells separately", () => {
    const preview = previewAreaPlanting(
      plantingMap([{ x: 0, y: 0 }, { x: 1, y: 0, occupied: true }, { x: 0, y: 1 }, { x: 1, y: 1 }]),
      [],
      [],
      [],
      carrotOption,
      [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    );
    expect(preview.cellsInArea).toBe(4);
    expect(preview.plantableCount).toBe(3);
    expect(preview.skipped).toContainEqual({ x: 1, y: 0, reason: "OCCUPIED" });
  });

  it.each([1, 25, 100])("keeps %s cells as bounded candidates", (count) => {
    const cells = Array.from({ length: count }, (_, index) => ({ x: index, y: 0 }));
    const preview = previewAreaPlanting(plantingMap(cells), [], [], [], carrotOption, [{ x: 0, y: 0 }, { x: count - 1, y: 0 }]);
    expect(preview.validCells).toHaveLength(count);
    expect(areaHarvestGroups(preview.validCells).map((group) => group.length)).toEqual(
      count === 100 ? [25, 25, 25, 25] : [count]
    );
  });

  it("reports seed shortage without inventing a purchase", () => {
    const preview = previewAreaPlanting(
      plantingMap([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
      [], [], [], { ...carrotOption, stored: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    );
    expect(preview.plantableCount).toBe(2);
    expect(preview.shortageCount).toBe(1);
  });

  it("plans only the inventory-funded prefix and separates shortage cells", () => {
    const cells = Array.from({ length: 52 }, (_, x) => ({ x, y: 0 }));
    const preview = previewAreaPlanting(
      plantingMap(cells),
      [], [], [], { ...carrotOption, stored: 50 },
      [{ x: 0, y: 0 }, { x: 51, y: 0 }]
    );

    expect(preview.plantableCount).toBe(52);
    expect(preview.plannedCount).toBe(50);
    expect(preview.plannedCells).toHaveLength(50);
    expect(preview.shortageCount).toBe(2);
    expect(preview.shortageCells).toEqual([{ x: 50, y: 0 }, { x: 51, y: 0 }]);
    expect(areaHarvestGroups(preview.plannedCells).map((group) => group.length)).toEqual([25, 25]);
  });

  it("keeps all valid cells planned when stock covers the area", () => {
    const cells = Array.from({ length: 42 }, (_, x) => ({ x, y: 0 }));
    const preview = previewAreaPlanting(
      plantingMap(cells),
      [], [], [], { ...carrotOption, stored: 50 },
      [{ x: 0, y: 0 }, { x: 41, y: 0 }]
    );

    expect(preview.plannedCount).toBe(42);
    expect(preview.shortageCount).toBe(0);
    expect(preview.plannedCells).toEqual(cells);
    expect(areaHarvestGroups(preview.plannedCells).map((group) => group.length)).toEqual([25, 17]);
  });

  it("uses stable y/x ordering when inventory changes after preview", () => {
    const cells = [
      { x: 2, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }
    ];
    const corners: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 2, y: 1 }];
    const withFive = previewAreaPlanting(plantingMap(cells), [], [], [], { ...carrotOption, stored: 5 }, corners);
    const withTwo = previewAreaPlanting(plantingMap(cells), [], [], [], { ...carrotOption, stored: 2 }, corners);

    expect(withFive.plannedCells.slice(0, 2)).toEqual(withTwo.plannedCells);
    expect(withFive.plannedCells).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }
    ]);
  });
});
