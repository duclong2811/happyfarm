import { describe, expect, it } from "vitest";
import { SHIP_CLASSES, shipClassByTier, VOYAGE_MIN_SECONDS, voyageSeconds } from "@happy-farm/game-data";

/** The ship classes (game data): a ladder that only climbs, and voyage times that follow distance. */
describe("ship classes", () => {
  it("climb one tier at a time: free rowboat first, then each class faster, sturdier and dearer", () => {
    expect(SHIP_CLASSES[0]).toMatchObject({ id: "ship_class_rowboat", tier: 1, requiredPlayerLevel: 1, buildCost: null });
    SHIP_CLASSES.forEach((entry, index) => {
      expect(entry.tier).toBe(index + 1);
      expect(entry.id).toMatch(/^ship_class_[a-z]+$/);
      expect(shipClassByTier(entry.tier)).toBe(entry);
      const before = SHIP_CLASSES[index - 1];
      if (before === undefined) return;
      expect(entry.speedTilesPerMinute).toBeGreaterThan(before.speedTilesPerMinute);
      expect(entry.hull).toBeGreaterThan(before.hull);
      expect(entry.cannons).toBeGreaterThanOrEqual(before.cannons);
      expect(entry.requiredPlayerLevel).toBeGreaterThan(before.requiredPlayerLevel);
      expect(entry.buildCost).not.toBeNull();
      if (entry.buildCost === null || before.buildCost === null) return;
      expect(entry.buildCost.gold).toBeGreaterThan(before.buildCost.gold);
    });
    expect(new Set(SHIP_CLASSES.map((entry) => entry.id)).size).toBe(SHIP_CLASSES.length);
    expect(shipClassByTier(99)).toBeNull();
  });

  it("time a voyage by distance and speed, never shorter than the minimum", () => {
    expect(voyageSeconds(0, 40)).toBe(VOYAGE_MIN_SECONDS);
    expect(voyageSeconds(400, 40)).toBe(600);
    expect(voyageSeconds(401, 40)).toBe(602);
    expect(voyageSeconds(400, 100)).toBeLessThan(voyageSeconds(400, 40));
    expect(() => voyageSeconds(-1, 40)).toThrow();
    expect(() => voyageSeconds(10, 0)).toThrow();
    expect(() => voyageSeconds(Number.NaN, 40)).toThrow();
  });
});
