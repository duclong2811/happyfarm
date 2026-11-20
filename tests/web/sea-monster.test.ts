import type { FleetResponse } from "@happy-farm/contracts";
import { createSeaBattle, runSeaBattle } from "@happy-farm/domain";
import { seaMonster } from "@happy-farm/game-data";
import { describe, expect, it } from "vitest";
import { monsterLair, MONSTER_REACH, nearMonster, practiceBattleSetup, runPracticeFight } from "../../apps/web/src/sea-monster";

/**
 * The practice monster off the home island (sea-monster.ts): where it lairs, when it is offered,
 * and the fight it makes. Nothing here is sent; the server is not asked.
 */

const island = { size: 96, originX: -30, originY: -30, seed: 11 };
const sloop: FleetResponse["ship"] = { classId: "ship_class_sloop", tier: 2, hull: 54, hullMax: 150, speedTilesPerMinute: 70, cannons: 2 };

describe("the monster's lair", () => {
  it("lies in open water a dozen tiles past the island's grid, the same place every time", () => {
    const lair = monsterLair(island, null);
    const half = (island.size - 1) / 2;
    const fromCentre = Math.hypot(lair.x - (island.originX + half), lair.y - (island.originY + half));
    expect(fromCentre).toBeCloseTo(half + 12, 5);
    expect(monsterLair(island, null)).toEqual(lair);
  });

  it("keeps away from the pier's side of the island", () => {
    const half = (island.size - 1) / 2;
    const centre = { x: island.originX + half, y: island.originY + half };
    const free = monsterLair(island, null);
    // A pier on the very bearing the seed picked pushes the lair round the island.
    const pier = { x: centre.x + (free.x - centre.x) * 0.5, y: centre.y + (free.y - centre.y) * 0.5 };
    const moved = monsterLair(island, pier);
    const apart = Math.abs(Math.atan2(Math.sin(Math.atan2(moved.y - centre.y, moved.x - centre.x) - Math.atan2(pier.y - centre.y, pier.x - centre.x)), Math.cos(Math.atan2(moved.y - centre.y, moved.x - centre.x) - Math.atan2(pier.y - centre.y, pier.x - centre.x))));
    expect(apart).toBeGreaterThan(Math.PI / 3);
  });

  it("is offered only to a ship close by", () => {
    const lair = monsterLair(island, null);
    expect(nearMonster({ x: lair.x + MONSTER_REACH - 1, y: lair.y }, lair)).toBe(true);
    expect(nearMonster({ x: lair.x + MONSTER_REACH + 1, y: lair.y }, lair)).toBe(false);
  });
});

describe("the practice fight", () => {
  const monster = seaMonster("monster_thuong_luong");

  it("puts the player's own ship in at full hull against a gunless beast", () => {
    expect(monster).not.toBeNull();
    if (monster === null) return;
    const setup = practiceBattleSetup(sloop, monster, 7);
    expect(setup.player).toMatchObject({ hull: 150, hullMax: 150, cannons: 2, speed: 9 });
    expect(setup.pirates).toEqual([{ hull: monster.hull, hullMax: monster.hull, cannons: 0, ...monster.battle, behaviour: "BEAST" }]);
    expect(() => createSeaBattle(setup)).not.toThrow();
  });

  it("is never won by a captain who gives no orders, and a still ship is rammed", () => {
    if (monster === null) return;
    const result = runSeaBattle(practiceBattleSetup(sloop, monster, 7), []);
    expect(result.outcome).not.toBe("WON");
    expect(result.playerHull).toBeLessThan(sloop.hullMax);
  });
});

describe("the practice referee", () => {
  it("plays the battle view's recorded orders through the simulation", () => {
    const monster = seaMonster("monster_thuong_luong");
    if (monster === null) return;
    const setup = practiceBattleSetup(sloop, monster, 9);
    // Hoist full sail at once (action 5, SAIL_FULL): the same as the orders written out by name.
    expect(runPracticeFight(setup, [[0, 5]])).toEqual(runSeaBattle(setup, [{ tick: 0, action: "SAIL_FULL" }]));
  });
});
