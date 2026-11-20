import { createSeaBattle, seaBattleResult, stepSeaBattle } from "@happy-farm/domain";
import {
  huntRoster,
  HUNT_ROSTER_SIZE,
  itemRegistry,
  MATERIAL_MERGE_COUNT,
  MONSTER_KINDS,
  MONSTER_MATERIAL_IDS,
  monsterBattle,
  monsterMaterialId,
  parseMonsterMaterial,
  SHIP_BATTLE_NUMBERS,
  shipClassById,
  upgradeMaterials,
  type MonsterKind
} from "@happy-farm/game-data";
import { describe, expect, it } from "vitest";
import { gunner } from "../support/sea-captain";

/**
 * Sea monsters (game data, docs/design/FLEET.md F3): five kinds by three levels, a roster per window,
 * fifteen materials, and a balance an attentive captain can beat with the right ship.
 */

/** How many of eight fights the test's gunner wins with `classId` against a monster. */
function wins(classId: string, kind: MonsterKind, level: number): number {
  const ship = shipClassById(classId);
  const numbers = SHIP_BATTLE_NUMBERS[classId];
  if (ship === null || numbers === undefined) throw new Error(classId);
  const monster = monsterBattle(kind, level);
  let won = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const state = createSeaBattle({ seed, player: { hull: ship.hull, hullMax: ship.hull, cannons: ship.cannons, ...numbers }, pirates: [{ ...monster, hullMax: monster.hull }] });
    const decide = gunner();
    while (state.outcome === null) stepSeaBattle(state, decide(state));
    if (seaBattleResult(state).outcome === "WON") won += 1;
  }
  return won;
}

describe("sea monsters", () => {
  it("are fought with the ship whose rank their level asks for", () => {
    for (const kind of MONSTER_KINDS) {
      expect(wins("ship_class_sloop", kind, 1), `sloop vs ${kind} 1`).toBeGreaterThanOrEqual(5);
      expect(wins("ship_class_brig", kind, 2), `brig vs ${kind} 2`).toBeGreaterThanOrEqual(5);
      expect(wins("ship_class_frigate", kind, 3), `frigate vs ${kind} 3`).toBeGreaterThanOrEqual(7);
    }
    // A level above the ship is a different matter.
    expect(MONSTER_KINDS.filter((kind) => wins("ship_class_sloop", kind, 2) === 0).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("grow with their level", () => {
    for (const kind of MONSTER_KINDS) {
      const [one, two, three] = [1, 2, 3].map((level) => monsterBattle(kind, level));
      expect(two?.hull).toBeGreaterThan(one?.hull ?? Infinity);
      expect(three?.hull).toBeGreaterThan(two?.hull ?? Infinity);
      expect(three?.speed).toBeGreaterThan(one?.speed ?? Infinity);
    }
  });
});

describe("the hunt roster", () => {
  it("holds three monsters of three different kinds, the same for the same player and window", () => {
    const roster = huntRoster("player_1", 1000, 60, 4);
    expect(roster).toHaveLength(HUNT_ROSTER_SIZE);
    expect(new Set(roster.map((entry) => entry.kind)).size).toBe(HUNT_ROSTER_SIZE);
    expect(roster.map((entry) => entry.slot)).toEqual([0, 1, 2]);
    expect(huntRoster("player_1", 1000, 60, 4)).toEqual(roster);
    // Another window, or another player, is another roster (over a few windows, at least once).
    const others = [1001, 1002, 1003].map((window) => JSON.stringify(huntRoster("player_1", window, 60, 4)));
    expect(others.some((other) => other !== JSON.stringify(roster))).toBe(true);
  });

  it("surfaces only the levels the player reaches, and every kind over time", () => {
    const seen = new Set<string>();
    for (let window = 0; window < 200; window += 1) {
      for (const entry of huntRoster("player_2", window, 10, 4)) {
        expect(entry.level).toBe(1);
        seen.add(entry.kind);
      }
      for (const entry of huntRoster("player_2", window, 30, 4)) expect(entry.level).toBeLessThanOrEqual(2);
    }
    expect(seen.size).toBe(MONSTER_KINDS.length);
    const levels = new Set(Array.from({ length: 200 }, (_, window) => huntRoster("player_3", window, 80, 4).map((entry) => entry.level)).flat());
    expect([...levels].sort()).toEqual([1, 2, 3]);
  });

  it("never surfaces a monster above the rank of the player's strongest warship, and keeps lower ones coming", () => {
    const counts = [0, 0, 0, 0];
    for (let window = 0; window < 400; window += 1) {
      for (const entry of huntRoster("player_4", window, 80, 1)) expect(entry.level).toBe(1);
      for (const entry of huntRoster("player_4", window, 80, 2)) expect(entry.level).toBeLessThanOrEqual(2);
      for (const entry of huntRoster("player_4", window, 80, 4)) counts[entry.level] = (counts[entry.level] ?? 0) + 1;
    }
    // The top level open is twice as likely as each below it: about 1 : 1 : 2.
    const total = (counts[1] ?? 0) + (counts[2] ?? 0) + (counts[3] ?? 0);
    expect((counts[1] ?? 0) / total).toBeGreaterThan(0.18);
    expect((counts[3] ?? 0) / total).toBeGreaterThan(0.4);
    // An upgrade mid-window changes levels, never kinds: a slot won stays the same monster.
    expect(huntRoster("player_4", 77, 80, 1).map((entry) => entry.kind)).toEqual(huntRoster("player_4", 77, 80, 4).map((entry) => entry.kind));
  });
});

describe("monster materials", () => {
  it("are fifteen materials, each a real item, read back to its kind and level", () => {
    expect(MONSTER_MATERIAL_IDS).toHaveLength(15);
    for (const id of MONSTER_MATERIAL_IDS) {
      expect(itemRegistry.get(id)?.category, id).toBe("MATERIAL");
      const parsed = parseMonsterMaterial(id);
      expect(parsed).not.toBeNull();
      if (parsed !== null) expect(monsterMaterialId(parsed.kind, parsed.level)).toBe(id);
    }
    expect(parseMonsterMaterial("item_wood")).toBeNull();
    expect(parseMonsterMaterial("item_monster_scale_4")).toBeNull();
    expect(MATERIAL_MERGE_COUNT).toBe(10);
  });

  it("are asked of every ship upgrade, all five kinds at the rank's level, and of no first build", () => {
    expect(upgradeMaterials(1)).toEqual({});
    for (const [rank, level] of [[2, 1], [3, 2], [4, 3]] as const) {
      const needs = upgradeMaterials(rank);
      expect(Object.keys(needs).sort()).toEqual(MONSTER_KINDS.map((kind) => monsterMaterialId(kind, level)).sort());
      expect(Object.values(needs).every((count) => count === 2)).toBe(true);
    }
  });
});
