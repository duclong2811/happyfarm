import type { FleetResponse } from "@happy-farm/contracts";
import { SHIP_BATTLE_NUMBERS, type SeaMonsterDefinition } from "@happy-farm/game-data";
import { runSeaBattle, SEA_BATTLE_ACTIONS, type SeaBattleResult, type SeaBattleSetup } from "@happy-farm/domain";

/**
 * The sea monster that lairs off the home island (docs/design/NAVAL.md, "A monster off the island").
 *
 * A practice fight, decided entirely on the player's screen: the same battle simulation the server
 * referees for pirates, run here with a monster as the opponent. It sends nothing, pays nothing and
 * costs nothing - the ship fights at full hull and comes back as it was - so it can be fought as often
 * as the player likes while the fleet's own design (fishing, trade, war) is settled.
 */

/** How close to the lair, in tiles, the helm offers the fight. */
export const MONSTER_REACH = 14;

/** Where the monster lairs, in island tiles: in open water a little off the island, away from the pier. */
export interface MonsterLair {
  readonly x: number;
  readonly y: number;
  /** The way it faces, as a heading (angle from +x toward +y). */
  readonly heading: number;
}

/**
 * The lair, from the island's own seed: a bearing off the island's middle, a dozen tiles past the edge
 * of its grid (open water on every island), turned away from the pier so a ship leaving it does not
 * sail straight into the monster.
 */
export function monsterLair(island: { readonly size: number; readonly originX: number; readonly originY: number; readonly seed: number }, pier: { readonly x: number; readonly y: number } | null): MonsterLair {
  const half = (island.size - 1) / 2;
  const centre = { x: island.originX + half, y: island.originY + half };
  let bearing = (((island.seed * 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
  if (pier !== null) {
    const pierBearing = Math.atan2(pier.y - centre.y, pier.x - centre.x);
    const apart = Math.abs(Math.atan2(Math.sin(bearing - pierBearing), Math.cos(bearing - pierBearing)));
    if (apart < Math.PI / 3) bearing = pierBearing + Math.PI * (2 / 3);
  }
  const distance = half + 12;
  return {
    x: centre.x + Math.cos(bearing) * distance,
    y: centre.y + Math.sin(bearing) * distance,
    // It lies across the bearing, coiled round the island.
    heading: bearing + Math.PI / 2
  };
}

/** Whether a ship at (x, y) is close enough to the lair to be offered the fight. */
export function nearMonster(at: { readonly x: number; readonly y: number }, lair: MonsterLair): boolean {
  return Math.hypot(at.x - lair.x, at.y - lair.y) <= MONSTER_REACH;
}

/**
 * The practice fight: the player's own ship, at full hull, against the monster. The seed varies the
 * wind and where the monster comes from, so no two fights are quite alike.
 */
export function practiceBattleSetup(ship: FleetResponse["ship"], monster: SeaMonsterDefinition, seed: number): SeaBattleSetup {
  const numbers = SHIP_BATTLE_NUMBERS[ship.classId] ?? SHIP_BATTLE_NUMBERS.ship_class_rowboat ?? { speed: 6, turn: 16, radius: 3, spread: 60 };
  return {
    seed: seed >>> 0,
    player: { hull: ship.hullMax, hullMax: ship.hullMax, cannons: ship.cannons, ...numbers },
    pirates: [{ hull: monster.hull, hullMax: monster.hull, cannons: 0, ...monster.battle, behaviour: "BEAST" }]
  };
}

/**
 * Plays the recorded orders through the simulation on this screen - the practice fight's referee.
 * The orders arrive as the battle view records them: `[tick, action index]` or with an aim.
 */
export function runPracticeFight(setup: SeaBattleSetup, orders: readonly ([number, number] | [number, number, number])[]): SeaBattleResult {
  return runSeaBattle(
    setup,
    orders.map(([tick, action, aim]) => {
      const name = SEA_BATTLE_ACTIONS[action] ?? "RUDDER_CENTER";
      return aim === undefined ? { tick, action: name } : { tick, action: name, aim };
    })
  );
}
