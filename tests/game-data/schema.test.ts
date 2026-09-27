import { describe, expect, it } from "vitest";
import { createCropRegistry, validateDefinitions } from "@happy-farm/game-data";

describe("game-data validation", () => {
  it("accepts stable semantic IDs and rejects malformed definitions", () => {
    expect(validateDefinitions([{ id: "crop_carrot", displayName: "Carrot" }])).toHaveLength(1);
    expect(() => validateDefinitions([{ id: "Carrot", displayName: "Carrot" }])).toThrow();
  });

  it("validates crop timing, stages, IDs, rewards, and duplicates", () => {
    const valid = {
      id: "crop_radish",
      displayNameKey: "crop.radish.name",
      growthDurationSeconds: 120,
      growthStages: 3,
      harvest: { itemDefinitionId: "item_radish", baseQuantity: 2 }
    };
    expect(createCropRegistry([valid]).size).toBe(1);
    expect(() => createCropRegistry([{ ...valid, growthDurationSeconds: 0 }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, growthStages: 1 }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, id: "Radish" }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, harvest: { ...valid.harvest, baseQuantity: 0 } }])).toThrow();
    expect(() => createCropRegistry([valid, valid])).toThrow("Duplicate crop definition");
  });
});
