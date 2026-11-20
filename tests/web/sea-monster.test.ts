import { describe, expect, it } from "vitest";
import { monsterDrawnLength, monsterLairs, MONSTER_REACH, nearMonster } from "../../apps/web/src/sea-monster";

/**
 * Where the roster's monsters lie off the home island (sea-monster.ts), and when the helm offers a
 * fight. Presentation only: the roster and every fight are the server's.
 */

const island = { size: 96, originX: -30, originY: -30, seed: 11 };
const half = (island.size - 1) / 2;
const centre = { x: island.originX + half, y: island.originY + half };
const bearingOf = (at: { readonly x: number; readonly y: number }): number => Math.atan2(at.y - centre.y, at.x - centre.x);
const between = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("the monsters' lairs", () => {
  it("lie in open water a dozen tiles or more past the island's grid, the same places every time", () => {
    const lairs = monsterLairs(island, null, 3);
    expect(lairs).toHaveLength(3);
    for (const lair of lairs) expect(Math.hypot(lair.x - centre.x, lair.y - centre.y)).toBeGreaterThanOrEqual(half + 12 - 1e-6);
    expect(monsterLairs(island, null, 3)).toEqual(lairs);
  });

  it("are spread evenly round the island", () => {
    const lairs = monsterLairs(island, null, 3);
    const [a, b, c] = lairs.map(bearingOf);
    expect(between(a ?? 0, b ?? 0)).toBeCloseTo((Math.PI * 2) / 3, 5);
    expect(between(b ?? 0, c ?? 0)).toBeCloseTo((Math.PI * 2) / 3, 5);
  });

  it("keep away from the pier's side of the island", () => {
    const pier = { x: centre.x + 20, y: centre.y + 5 };
    for (const lair of monsterLairs(island, pier, 3)) expect(between(bearingOf(lair), bearingOf(pier))).toBeGreaterThanOrEqual(Math.PI / 3 - 1e-6);
  });

  it("offer the fight only to a ship close by", () => {
    const [lair] = monsterLairs(island, null, 3);
    if (lair === undefined) throw new Error("no lair");
    expect(nearMonster({ x: lair.x + MONSTER_REACH - 1, y: lair.y }, lair)).toBe(true);
    expect(nearMonster({ x: lair.x + MONSTER_REACH + 1, y: lair.y }, lair)).toBe(false);
  });
});

describe("a monster's drawn size", () => {
  it("grows with its level", () => {
    expect(monsterDrawnLength("monster_kinh_ngu", 3)).toBeGreaterThan(monsterDrawnLength("monster_kinh_ngu", 2));
    expect(monsterDrawnLength("monster_kinh_ngu", 2)).toBeGreaterThan(monsterDrawnLength("monster_kinh_ngu", 1));
  });
});
