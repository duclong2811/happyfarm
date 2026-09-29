import { describe, expect, it } from "vitest";
import {
  calculateCropGrowth,
  canHarvest,
  createCropInstance,
  parseCropDefinitionId,
  parseItemDefinitionId
} from "@happy-farm/domain";
import { CROP_ONE_ID, FARM_ONE_ID, PLAYER_ONE_ID } from "../support/fixtures";

const definition = {
  id: parseCropDefinitionId("crop_test"),
  displayNameKey: "crop.test.name",
  growthDurationSeconds: 400,
  growthStages: 4,
  seedItemDefinitionId: parseItemDefinitionId("item_test_seed"),
  harvest: { itemDefinitionId: parseItemDefinitionId("item_test"), baseQuantity: 1, xp: 1 }
};
const plantedAt = "2026-01-01T12:00:00.000Z";

describe("deterministic crop growth", () => {
  it.each([
    ["2026-01-01T12:00:00.000Z", 0, 0, false],
    ["2026-01-01T12:02:13.332Z", 0.33333, 0, false],
    ["2026-01-01T12:02:13.333Z", 0.3333325, 0, false],
    ["2026-01-01T12:02:13.334Z", 0.333335, 1, false],
    ["2026-01-01T12:06:39.999Z", 0.9999975, 2, false],
    ["2026-01-01T12:06:40.000Z", 1, 3, true],
    ["2026-01-01T20:00:00.000Z", 1, 3, true]
  ])("derives stable stage boundaries at %s", (serverTime, progress, stage, mature) => {
    const growth = calculateCropGrowth(definition, plantedAt, serverTime);
    expect(growth.progress).toBeCloseTo(progress, 7);
    expect(growth.stage).toBe(stage);
    expect(growth.mature).toBe(mature);
  });

  it("clamps a future planted timestamp to zero without mutating it", () => {
    expect(calculateCropGrowth(definition, plantedAt, "2026-01-01T11:00:00.000Z")).toEqual({
      elapsedSeconds: 0,
      progress: 0,
      stage: 0,
      mature: false
    });
  });

  it("determines harvest eligibility without settling rewards", () => {
    const crop = createCropInstance(
      CROP_ONE_ID,
      FARM_ONE_ID,
      0,
      0,
      definition.id,
      PLAYER_ONE_ID,
      plantedAt
    );
    expect(canHarvest(crop, definition, "2026-01-01T12:06:39.999Z")).toBe(false);
    expect(canHarvest(crop, definition, "2026-01-01T12:06:40.000Z")).toBe(true);
  });

  it("keeps true offline elapsed time while clamping progress", () => {
    const growth = calculateCropGrowth(definition, plantedAt, "2026-01-01T20:00:00.000Z");
    expect(growth.elapsedSeconds).toBe(28_800);
    expect(growth.progress).toBe(1);
    expect(growth.mature).toBe(true);
  });
});
