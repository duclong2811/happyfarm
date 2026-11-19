import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSeaBattle,
  runSeaBattle,
  SEA_BATTLE_MAX_INPUTS,
  SEA_BATTLE_MAX_TICKS,
  SEA_BATTLE_TURN_UNITS,
  seaBattleResult,
  seaCosine,
  seaSine,
  stepSeaBattle,
  type SeaBattleAction,
  type SeaBattleInput,
  type SeaBattleSetup,
  type SeaBattleShipSpec,
  type SeaBattleState
} from "@happy-farm/domain";

/**
 * The sea battle (sea-battle.ts): a fight a device plays live is the fight the server replays from
 * its inputs, bit for bit; the simulation touches no engine-dependent maths; and it refuses inputs no
 * honest device would send.
 */

const SLOOP: SeaBattleShipSpec = { hull: 150, hullMax: 150, cannons: 4, speed: 9, turn: 14, radius: 4.5, spread: 40 };
const CUTTER: SeaBattleShipSpec = { hull: 80, hullMax: 80, cannons: 2, speed: 8, turn: 12, radius: 4, spread: 90 };

function setup(seed: number, pirates: readonly SeaBattleShipSpec[] = [CUTTER]): SeaBattleSetup {
  return { seed, player: SLOOP, pirates };
}

/** A simple captain: keep the nearest pirate abeam at fighting range, and fire the side it is on. */
function captain(state: SeaBattleState): SeaBattleAction[] {
  const me = state.ships[0];
  const target = state.ships.slice(1).filter((ship) => ship.alive).sort((a, b) => (a.x - (me?.x ?? 0)) ** 2 + (a.z - (me?.z ?? 0)) ** 2 - ((b.x - (me?.x ?? 0)) ** 2 + (b.z - (me?.z ?? 0)) ** 2))[0];
  if (me === undefined || target === undefined) return [];
  const dx = target.x - me.x;
  const dz = target.z - me.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const fx = seaCosine(me.heading);
  const fz = seaSine(me.heading);
  const cross = fx * dz - fz * dx;
  const dot = fx * dx + fz * dz;
  const actions: SeaBattleAction[] = [];
  const abeam = Math.abs(dot) / distance < 0.3;
  const rudder: SeaBattleAction = distance > 70 ? (cross > 0 ? "RUDDER_RIGHT" : "RUDDER_LEFT") : abeam ? "RUDDER_CENTER" : dot > 0 ? (cross > 0 ? "RUDDER_LEFT" : "RUDDER_RIGHT") : cross > 0 ? "RUDDER_RIGHT" : "RUDDER_LEFT";
  if (me.rudder !== (rudder === "RUDDER_LEFT" ? -1 : rudder === "RUDDER_RIGHT" ? 1 : 0)) actions.push(rudder);
  if (me.sail !== 1) actions.push("SAIL_HALF");
  // A device sends a broadside only when that side's guns are loaded.
  if (distance < 55 && abeam && (cross > 0 ? me.reloadStarboard : me.reloadPort) === 0) actions.push(cross > 0 ? "FIRE_STARBOARD" : "FIRE_PORT");
  return actions;
}

/** Plays a fight live, as a device does, recording every input it gives. */
function playLive(battle: SeaBattleSetup, decide: (state: SeaBattleState) => SeaBattleAction[]): { inputs: SeaBattleInput[]; result: ReturnType<typeof seaBattleResult> } {
  const state = createSeaBattle(battle);
  const inputs: SeaBattleInput[] = [];
  while (state.outcome === null) {
    const actions = decide(state);
    for (const action of actions) inputs.push({ tick: state.tick, action });
    stepSeaBattle(state, actions);
  }
  return { inputs, result: seaBattleResult(state) };
}

describe("the sea battle", () => {
  it("computes sine and cosine from a fixed polynomial, close to the engine's own", () => {
    for (let units = 0; units < SEA_BATTLE_TURN_UNITS; units += 1) {
      const angle = (units / SEA_BATTLE_TURN_UNITS) * 2 * Math.PI;
      expect(Math.abs(seaSine(units) - Math.sin(angle))).toBeLessThan(1e-9);
      expect(Math.abs(seaCosine(units) - Math.cos(angle))).toBeLessThan(1e-9);
    }
    expect(seaSine(-1024)).toBeCloseTo(-1, 12);
    expect(seaSine(4096 + 1024)).toBeCloseTo(1, 12);
  });

  it("uses no maths a JavaScript engine may round its own way", () => {
    const text = readFileSync(fileURLToPath(new URL("../../packages/domain/src/sea-battle.ts", import.meta.url)), "utf8");
    // The code, not its comments: the module's own notes name the functions it avoids.
    const source = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|pow|exp|log|cbrt|random)\b/);
    expect(source).not.toMatch(/Date\.|performance\./);
  });

  it("replays a fight played live, from its inputs alone, to the same result", () => {
    let won = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const battle = setup(seed * 7919);
      const live = playLive(battle, captain);
      expect(live.inputs.length).toBeLessThanOrEqual(SEA_BATTLE_MAX_INPUTS);
      expect(runSeaBattle(battle, live.inputs)).toEqual(live.result);
      if (live.result.outcome === "WON") won += 1;
    }
    // A captain who keeps the pirate abeam and fires wins some of these fights.
    expect(won).toBeGreaterThan(0);
  });

  it("is the same fight every time for the same seed and inputs, and a different one for another seed", () => {
    const inputs = playLive(setup(4242, [CUTTER, CUTTER]), captain).inputs;
    const first = runSeaBattle(setup(4242, [CUTTER, CUTTER]), inputs);
    expect(runSeaBattle(setup(4242, [CUTTER, CUTTER]), inputs)).toEqual(first);
    expect(runSeaBattle(setup(4243, [CUTTER, CUTTER]), inputs)).not.toEqual(first);
  });

  it("never lets a captain who does nothing win, and lets one who runs flee", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const idle = runSeaBattle(setup(seed), []);
      expect(idle.outcome).not.toBe("WON");
      expect(idle.stats.shots).toBe(0);
    }
    const run = runSeaBattle(setup(99), [{ tick: 0, action: "SAIL_FULL" }]);
    expect(["FLED", "LOST"]).toContain(run.outcome);
    expect(run.ticks).toBeLessThan(SEA_BATTLE_MAX_TICKS);
  });

  it("refuses inputs no honest device sends, and setups that are not a fight", () => {
    expect(() => runSeaBattle(setup(1), [{ tick: 5, action: "SAIL_FULL" }, { tick: 4, action: "SAIL_HALF" }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: -1, action: "SAIL_FULL" }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: SEA_BATTLE_MAX_TICKS, action: "SAIL_FULL" }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: 1.5, action: "SAIL_FULL" }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: 1, action: "TELEPORT" as SeaBattleAction }])).toThrow();
    expect(() => runSeaBattle(setup(1), Array.from({ length: SEA_BATTLE_MAX_INPUTS + 1 }, () => ({ tick: 0, action: "SAIL_FULL" as const })))).toThrow();
    expect(() => createSeaBattle({ seed: -1, player: SLOOP, pirates: [CUTTER] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: SLOOP, pirates: [] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: { ...SLOOP, speed: Number.NaN }, pirates: [CUTTER] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: { ...SLOOP, turn: 1.5 }, pirates: [CUTTER] })).toThrow();
  });
});
