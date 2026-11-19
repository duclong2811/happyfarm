import { describe, expect, it } from "vitest";
import { AMBUSH_CHANCE_MAX, AMBUSH_EARLIEST, AMBUSH_LATEST, AMBUSH_PARTIES, PIRATE_SHIPS, planAmbush, SHIP_BATTLE_NUMBERS, SHIP_CLASSES, stableHash } from "@happy-farm/game-data";

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
});
