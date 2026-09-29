import { describe, expect, it } from "vitest";
import type { CropDefinitionDTO, CropStateDTO, FarmTileDTO } from "@happy-farm/contracts";
import { createTranslator } from "../../apps/web/src/i18n";
import {
  describeSelection,
  formatRemainingGrowth,
  type SelectionInput,
  type SelectedCropState
} from "../../apps/web/src/selection";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const en = createTranslator("en");
const vi = createTranslator("vi");

function tile(x: number, y: number, terrainType: FarmTileDTO["terrainType"] = "SOIL"): FarmTileDTO {
  return {
    farmId: "farm_test",
    x,
    y,
    terrainType,
    state: "IDLE",
    version: 3,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function crop(x: number, y: number, overrides: Partial<CropStateDTO> = {}): CropStateDTO {
  return {
    cropInstanceId: "cropinst_00000000-0000-4000-8000-000000000001",
    definitionId: "crop_carrot",
    tileX: x,
    tileY: y,
    plantedAt: "2026-01-01T00:00:00.000Z",
    growthStage: 1,
    growthProgress: 0.25,
    mature: false,
    version: 4,
    ...overrides
  };
}

function definition(overrides: Partial<CropDefinitionDTO> = {}): CropDefinitionDTO {
  return {
    cropDefinitionId: "crop_carrot",
    displayNameKey: "crop.carrot.name",
    growthDurationSeconds: 600,
    seedItemDefinitionId: "item_carrot_seed",
    seedItemDisplayNameKey: "item.carrot_seed.name",
    harvestItemDefinitionId: "item_carrot",
    baseQuantity: 1,
    harvestXp: 5,
    requiredLevel: 1,
    ...overrides
  };
}

const PLANTABLE: SelectedCropState = {
  cropDefinitionId: "crop_carrot",
  unlocked: true,
  seedCount: 12
};

function input(overrides: Partial<SelectionInput> = {}): SelectionInput {
  return {
    tiles: [],
    crops: [],
    cropDefinitions: [definition()],
    selected: null,
    selectedCrop: PLANTABLE,
    nowMs: NOW,
    ...overrides
  };
}

describe("describeSelection", () => {
  it("offers planting for an empty soil tile holding an unlocked crop with seeds", () => {
    const view = describeSelection(
      input({ tiles: [tile(2, 3)], selected: { x: 2, y: 3 } })
    );
    expect(view).toMatchObject({
      kind: "empty",
      coordinate: { x: 2, y: 3 },
      terrainType: "SOIL",
      crop: null,
      canPlant: true,
      canHarvest: false,
      canUproot: false,
      plantBlocked: null,
      remainingSeconds: null
    });
  });

  it("refuses planting on an empty tile that is not soil, and says why", () => {
    const view = describeSelection(
      input({ tiles: [tile(2, 3, "WATER")], selected: { x: 2, y: 3 } })
    );
    expect(view.kind).toBe("empty");
    expect(view.canPlant).toBe(false);
    expect(view.plantBlocked).toBe("terrain");
  });

  it("refuses planting with no seed of the chosen crop", () => {
    // The dock's third precondition: the server's inventory says there is nothing to plant, so no
    // request is offered even though the tile is bare soil.
    const view = describeSelection(
      input({
        tiles: [tile(2, 3)],
        selected: { x: 2, y: 3 },
        selectedCrop: { cropDefinitionId: "crop_carrot", unlocked: true, seedCount: 0 }
      })
    );
    expect(view.canPlant).toBe(false);
    expect(view.plantBlocked).toBe("no-seed");
  });

  it("refuses planting a crop the player's level has not unlocked", () => {
    const view = describeSelection(
      input({
        tiles: [tile(2, 3)],
        selected: { x: 2, y: 3 },
        selectedCrop: { cropDefinitionId: "crop_wheat", unlocked: false, seedCount: 40 }
      })
    );
    expect(view.canPlant).toBe(false);
    expect(view.plantBlocked).toBe("crop-locked");
  });

  it("refuses planting when the catalogue has offered no crop at all", () => {
    const view = describeSelection(
      input({ tiles: [tile(2, 3)], selected: { x: 2, y: 3 }, selectedCrop: null })
    );
    expect(view.canPlant).toBe(false);
    expect(view.plantBlocked).toBe("no-crop");
  });

  it("describes a growing crop without ever offering to plant over it", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [crop(1, 1)],
        selected: { x: 1, y: 1 },
        nowMs: Date.parse("2026-01-01T00:01:00.000Z")
      })
    );
    expect(view).toMatchObject({
      kind: "growing",
      canPlant: false,
      canHarvest: false,
      canUproot: true,
      plantBlocked: "occupied",
      remainingSeconds: 540
    });
    expect(view.crop?.definitionId).toBe("crop_carrot");
  });

  it("counts down from the server's plantedAt and catalogue duration", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [
          crop(1, 1, {
            plantedAt: "2026-01-01T00:09:30.000Z",
            growthProgress: 0.95
          })
        ],
        selected: { x: 1, y: 1 }
      })
    );
    // 30 seconds elapsed of a 600-second crop leaves 570, even though growthProgress reads 95%.
    expect(view.remainingSeconds).toBe(570);
  });

  it("treats a mature crop as harvestable and still uprootable", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [crop(1, 1, { mature: true, growthStage: 3, growthProgress: 1 })],
        selected: { x: 1, y: 1 }
      })
    );
    expect(view).toMatchObject({
      kind: "mature",
      canPlant: false,
      canHarvest: true,
      canUproot: true,
      remainingSeconds: null
    });
    expect(view.crop?.version).toBe(4);
  });

  it("never lets an occupied tile send a plant request, growing or mature", () => {
    for (const mature of [false, true]) {
      const view = describeSelection(
        input({
          tiles: [tile(4, 4)],
          crops: [crop(4, 4, { mature })],
          selected: { x: 4, y: 4 }
        })
      );
      expect(view.canPlant).toBe(false);
      expect(view.kind).toBe(mature ? "mature" : "growing");
    }
  });

  it("trusts the server's mature flag over a client clock that is past the duration", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [
          crop(1, 1, {
            plantedAt: "2025-12-31T23:00:00.000Z",
            growthProgress: 1
          })
        ],
        selected: { x: 1, y: 1 }
      })
    );
    // The catalogue duration has long elapsed on this machine, but the server still says growing.
    expect(view.kind).toBe("growing");
    expect(view.canHarvest).toBe(false);
    expect(view.canPlant).toBe(false);
    expect(view.remainingSeconds).toBe(0);
  });

  it("trusts the server's mature flag even when growthProgress looks low", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [crop(1, 1, { mature: true, growthProgress: 0.02 })],
        selected: { x: 1, y: 1 }
      })
    );
    expect(view.kind).toBe("mature");
    expect(view.canHarvest).toBe(true);
  });

  it("leaves the countdown unknown when the catalogue does not list the crop", () => {
    const view = describeSelection(
      input({
        tiles: [tile(1, 1)],
        crops: [crop(1, 1, { definitionId: "crop_unknown" })],
        cropDefinitions: [],
        selected: { x: 1, y: 1 }
      })
    );
    expect(view.kind).toBe("growing");
    expect(view.canPlant).toBe(false);
    expect(view.canUproot).toBe(true);
    expect(view.remainingSeconds).toBeNull();
  });

  it("reports nothing selected and a stale selection distinctly", () => {
    const none = describeSelection(input());
    expect(none.kind).toBe("none");
    expect(none.plantBlocked).toBe("no-tile");
    const stale = describeSelection(input({ selected: { x: 9, y: 9 } }));
    expect(stale.kind).toBe("missing");
    expect(stale.canPlant).toBe(false);
    expect(stale.canUproot).toBe(false);
    expect(stale.plantBlocked).toBe("unlocked-land");
    expect(stale.coordinate).toEqual({ x: 9, y: 9 });
  });
});

describe("formatRemainingGrowth", () => {
  it("phrases seconds, minutes, hours, and unknown time in English", () => {
    expect(formatRemainingGrowth(45, en)).toBe("45s left");
    expect(formatRemainingGrowth(150, en)).toBe("2m 30s left");
    expect(formatRemainingGrowth(7200, en)).toBe("2h left");
    expect(formatRemainingGrowth(0, en)).toBe("ready any moment");
    expect(formatRemainingGrowth(null, en)).toBe("growth time unavailable");
  });

  it("phrases the same countdown in Vietnamese", () => {
    expect(formatRemainingGrowth(45, vi)).toBe("còn 45 giây");
    expect(formatRemainingGrowth(150, vi)).toBe("còn 2 phút 30 giây");
    expect(formatRemainingGrowth(7200, vi)).toBe("còn 2 giờ");
    expect(formatRemainingGrowth(0, vi)).toBe("sắp chín");
    expect(formatRemainingGrowth(null, vi)).toBe("chưa rõ thời gian");
  });

  it("covers the day-scale branches in both languages", () => {
    expect(formatRemainingGrowth(86_400, en)).toBe("1d left");
    expect(formatRemainingGrowth(90_000, en)).toBe("1d 1h left");
    expect(formatRemainingGrowth(86_400, vi)).toBe("còn 1 ngày");
    expect(formatRemainingGrowth(90_000, vi)).toBe("còn 1 ngày 1 giờ");
  });
});
