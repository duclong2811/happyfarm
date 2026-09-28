import { describe, expect, it } from "vitest";
import {
  isCropUnlocked,
  parseCropDefinitionId,
  parseItemDefinitionId,
  requiredLevelFor,
  type CropDefinition
} from "@happy-farm/domain";

function definition(requiredLevel?: number): CropDefinition {
  const base = {
    id: parseCropDefinitionId("crop_test"),
    displayNameKey: "crop.test.name",
    growthDurationSeconds: 60,
    growthStages: 2,
    harvest: { itemDefinitionId: parseItemDefinitionId("item_test"), baseQuantity: 1, xp: 1 }
  };
  return requiredLevel === undefined ? base : { ...base, requiredLevel };
}

describe("crop unlocks by player level", () => {
  it("reads an absent requirement as level 1, the level every player starts at", () => {
    expect(requiredLevelFor(definition())).toBe(1);
    expect(requiredLevelFor(definition(4))).toBe(4);
  });

  it("unlocks at the required level and above, and never before it", () => {
    const crop = definition(3);
    expect(isCropUnlocked(crop, 1)).toBe(false);
    expect(isCropUnlocked(crop, 2)).toBe(false);
    expect(isCropUnlocked(crop, 3)).toBe(true);
    expect(isCropUnlocked(crop, 50)).toBe(true);
  });

  it("treats a level that is not a real level as insufficient, locking rather than unlocking", () => {
    // The failure that matters is unlocking a crop the player has not earned. Every malformed
    // reading therefore fails closed, including one that compares numerically high.
    for (const level of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      expect(isCropUnlocked(definition(2), level), String(level)).toBe(false);
      expect(isCropUnlocked(definition(), level), String(level)).toBe(false);
    }
  });

  it("keeps the starting crop plantable at level 1", () => {
    expect(isCropUnlocked(definition(), 1)).toBe(true);
  });

  it("never fails open on a requirement it cannot read", () => {
    // Game-data validation is where a malformed requirement is caught; the rule only has to avoid
    // unlocking on one. An unreadable requirement compares as unsatisfiable, which is the safe side.
    expect(isCropUnlocked(definition(Number.NaN), 50)).toBe(false);
    expect(isCropUnlocked(definition(2.5), 2)).toBe(false);
    expect(isCropUnlocked(definition(2.5), 3)).toBe(true);
  });
});
