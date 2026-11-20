import { describe, expect, it } from "vitest";
import { DOCK_ROWBOAT_CLASS_ID, DOCK_TIERS, dockTier, nextShipClass, SHIP_CLASSES, SHIP_ROLES, shipClassById, shipLadder, VOYAGE_MIN_SECONDS, voyageSeconds } from "@happy-farm/game-data";

/**
 * The fleet (game data, docs/design/FLEET.md): three ladders that only climb, a dock that only grows,
 * and voyage times that follow distance.
 */
describe("ship classes", () => {
  it("lead with the dock's rowboat, the first fishing boat", () => {
    expect(SHIP_CLASSES[0]?.id).toBe(DOCK_ROWBOAT_CLASS_ID);
    expect(SHIP_CLASSES[0]).toMatchObject({ role: "FISHING", rank: 1, tier: 1, requiredPlayerLevel: 1, cannons: 0 });
  });

  it("keep today's sloop, brig and frigate, with their numbers, as the first three warships", () => {
    expect(shipLadder("WAR").map((entry) => entry.id)).toEqual(["ship_class_sloop", "ship_class_brig", "ship_class_frigate", "ship_class_dragon"]);
    expect(shipClassById("ship_class_sloop")).toMatchObject({ tier: 2, requiredPlayerLevel: 10, speedTilesPerMinute: 70, hull: 150, cannons: 2, buildCost: { gold: 800, wood: 150, ore: 60 } });
    expect(shipClassById("ship_class_brig")).toMatchObject({ tier: 3, requiredPlayerLevel: 25, speedTilesPerMinute: 100, hull: 320, cannons: 6 });
    expect(shipClassById("ship_class_frigate")).toMatchObject({ tier: 4, requiredPlayerLevel: 45, speedTilesPerMinute: 130, hull: 600, cannons: 12 });
  });

  it("climb each ladder one rank at a time: faster, sturdier, roomier, later and dearer", () => {
    expect(new Set(SHIP_CLASSES.map((entry) => entry.id)).size).toBe(SHIP_CLASSES.length);
    for (const role of SHIP_ROLES) {
      const ladder = shipLadder(role);
      expect(ladder.length, role).toBeGreaterThanOrEqual(2);
      ladder.forEach((entry, index) => {
        expect(entry.id).toMatch(/^ship_class_[a-z]+(?:_[a-z]+)*$/);
        expect(entry.rank).toBe(index + 1);
        expect(entry.tier).toBeGreaterThanOrEqual(1);
        expect(entry.tier).toBeLessThanOrEqual(4);
        expect(entry.buildCost.gold).toBeGreaterThan(0);
        expect(shipClassById(entry.id)).toBe(entry);
        const before = ladder[index - 1];
        expect(nextShipClass(before?.id ?? "none")).toBe(before === undefined ? null : entry);
        if (before === undefined) return;
        expect(entry.speedTilesPerMinute).toBeGreaterThan(before.speedTilesPerMinute);
        expect(entry.hull).toBeGreaterThan(before.hull);
        expect(entry.hold).toBeGreaterThan(before.hold);
        expect(entry.cannons).toBeGreaterThanOrEqual(before.cannons);
        expect(entry.tier).toBeGreaterThanOrEqual(before.tier);
        expect(entry.requiredPlayerLevel).toBeGreaterThan(before.requiredPlayerLevel);
        expect(entry.buildCost.gold).toBeGreaterThan(before.buildCost.gold);
      });
      expect(nextShipClass(ladder[ladder.length - 1]?.id ?? "")).toBeNull();
    }
  });

  it("give each role its trade: fishing boats carry no guns, merchant ships the biggest holds, warships the most guns", () => {
    const top = (role: (typeof SHIP_ROLES)[number]) => shipLadder(role)[shipLadder(role).length - 1];
    for (const boat of shipLadder("FISHING")) expect(boat.cannons).toBe(0);
    expect(top("MERCHANT")?.hold).toBeGreaterThan(top("WAR")?.hold ?? Infinity);
    expect(top("MERCHANT")?.hold).toBeGreaterThan(top("FISHING")?.hold ?? Infinity);
    expect(top("WAR")?.cannons).toBeGreaterThan(top("MERCHANT")?.cannons ?? Infinity);
  });

  it("open the market's ships at level 50, as the owner decided", () => {
    expect(shipLadder("MERCHANT")[0]?.requiredPlayerLevel).toBe(50);
  });
});

describe("the dock", () => {
  it("starts free with one berth and grows to five, each tier later and dearer", () => {
    expect(DOCK_TIERS.map((entry) => entry.berths)).toEqual([1, 2, 3, 5]);
    expect(DOCK_TIERS[0]).toMatchObject({ tier: 1, requiredPlayerLevel: 1, upgradeCost: null });
    DOCK_TIERS.forEach((entry, index) => {
      expect(entry.tier).toBe(index + 1);
      expect(dockTier(entry.tier)).toBe(entry);
      const before = DOCK_TIERS[index - 1];
      if (before === undefined) return;
      expect(entry.requiredPlayerLevel).toBeGreaterThan(before.requiredPlayerLevel);
      expect(entry.upgradeCost?.gold ?? 0).toBeGreaterThan(before.upgradeCost?.gold ?? 0);
    });
    expect(dockTier(99)).toBeNull();
  });
});

describe("voyage time", () => {
  it("follows distance and speed, never shorter than the minimum", () => {
    expect(voyageSeconds(0, 40)).toBe(VOYAGE_MIN_SECONDS);
    expect(voyageSeconds(400, 40)).toBe(600);
    expect(voyageSeconds(401, 40)).toBe(602);
    expect(voyageSeconds(400, 100)).toBeLessThan(voyageSeconds(400, 40));
    expect(() => voyageSeconds(-1, 40)).toThrow();
    expect(() => voyageSeconds(10, 0)).toThrow();
    expect(() => voyageSeconds(Number.NaN, 40)).toThrow();
  });
});
