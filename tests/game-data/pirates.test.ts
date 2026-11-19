import { describe, expect, it } from "vitest";
import { ambushBounty, AMBUSH_CHANCE_MAX, AMBUSH_EARLIEST, AMBUSH_LATEST, AMBUSH_PARTIES, PIRATE_SHIPS, planAmbush, SHIP_BATTLE_NUMBERS, SHIP_CLASSES, stableHash } from "@happy-farm/game-data";

/** Pirate ambushes (game data): a fixed fate per route and day, never a rowboat, parties that exist. */
describe("pirate ambushes", () => {
  const base = { playerId: "player_x", fromSlotId: "slot_north_1_1", toSlotId: "slot_north_1_2", day: "2026-11-20", distanceTiles: 900, shipTier: 2 };

  it("meets the same fate on the same route the same day, whatever the number of tries", () => {
    expect(planAmbush(base)).toEqual(planAmbush(base));
    expect(stableHash("happyfarm")).toBe(stableHash("happyfarm"));
    expect(stableHash("happyfarm")).not.toBe(stableHash("happyfarm!"));
  });

  it("never ambushes a ship without guns, and strikes mid-voyage with pirates that exist", () => {
    expect(planAmbush({ ...base, shipTier: 1 })).toBeNull();
    const ids = new Set(PIRATE_SHIPS.map((ship) => ship.id));
    for (const parties of Object.values(AMBUSH_PARTIES)) for (const party of parties) for (const id of party.pirates) expect(ids.has(id)).toBe(true);
    let struck = 0;
    for (let n = 0; n < 400; n += 1) {
      const plan = planAmbush({ ...base, playerId: `player_${String(n)}`, distanceTiles: 100_000 });
      if (plan === null) continue;
      struck += 1;
      expect(plan.atShare).toBeGreaterThanOrEqual(AMBUSH_EARLIEST);
      expect(plan.atShare).toBeLessThanOrEqual(AMBUSH_LATEST);
      expect(plan.pirates.length).toBeGreaterThan(0);
      expect(Number.isInteger(plan.seed)).toBe(true);
    }
    // However long the voyage, the chance stays under its cap.
    expect(struck / 400).toBeLessThan(AMBUSH_CHANCE_MAX + 0.1);
    expect(struck).toBeGreaterThan(0);
  });

  it("strikes more often on longer voyages, and every ship class has fighting numbers", () => {
    const count = (distanceTiles: number): number =>
      Array.from({ length: 400 }, (_, n) => planAmbush({ ...base, playerId: `player_${String(n)}`, distanceTiles })).filter((plan) => plan !== null).length;
    expect(count(200)).toBeLessThan(count(900));
    for (const shipClass of SHIP_CLASSES) expect(SHIP_BATTLE_NUMBERS[shipClass.id]).toBeDefined();
  });

  it("pays the owner's bounties (the generous scale, 2026-11-19), summed over a party", () => {
    expect(Object.fromEntries(PIRATE_SHIPS.map((ship) => [ship.id, ship.bounty]))).toEqual({
      pirate_cutter: { gold: 160, wood: 40, ore: 0, xp: 60 },
      pirate_raider: { gold: 500, wood: 120, ore: 40, xp: 180 },
      pirate_corsair: { gold: 1200, wood: 240, ore: 120, xp: 400 }
    });
    expect(ambushBounty(["pirate_raider", "pirate_cutter"])).toEqual({ gold: 660, wood: 160, ore: 40, xp: 240 });
    expect(ambushBounty([])).toEqual({ gold: 0, wood: 0, ore: 0, xp: 0 });
    expect(() => ambushBounty(["pirate_unknown"])).toThrow();
    // A bigger pirate always pays more, so a harder fight is never the worse deal.
    for (let index = 1; index < PIRATE_SHIPS.length; index += 1) {
      const smaller = PIRATE_SHIPS[index - 1]?.bounty;
      const bigger = PIRATE_SHIPS[index]?.bounty;
      expect(bigger?.gold ?? 0).toBeGreaterThan(smaller?.gold ?? 0);
      expect(bigger?.xp ?? 0).toBeGreaterThan(smaller?.xp ?? 0);
    }
  });
});
