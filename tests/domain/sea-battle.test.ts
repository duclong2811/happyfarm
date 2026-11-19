import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSeaBattle,
  previewBroadside,
  runSeaBattle,
  SEA_BATTLE_AIM_LIMIT,
  SEA_BATTLE_CHARGE_TICKS,
  SEA_BATTLE_MAX_INPUTS,
  SEA_BATTLE_MAX_RANGE,
  SEA_BATTLE_MAX_TICKS,
  SEA_BATTLE_MIN_RANGE,
  SEA_BATTLE_OAR_REST_TICKS,
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
import { gunner, type CaptainOrder } from "../support/sea-captain";

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

/** Plays a fight live, as a device does, recording every input it gives. */
function playLive(battle: SeaBattleSetup, decide: (state: SeaBattleState) => CaptainOrder[]): { inputs: SeaBattleInput[]; result: ReturnType<typeof seaBattleResult> } {
  const state = createSeaBattle(battle);
  const inputs: SeaBattleInput[] = [];
  while (state.outcome === null) {
    const orders = decide(state);
    for (const order of orders) inputs.push(order.aim === undefined ? { tick: state.tick, action: order.action } : { tick: state.tick, action: order.action, aim: order.aim });
    stepSeaBattle(state, orders);
  }
  return { inputs, result: seaBattleResult(state) };
}

/** Steps a fight with no orders but those given at each tick. */
function stepWith(state: SeaBattleState, orders: Record<number, CaptainOrder[]>, ticks: number): void {
  for (let index = 0; index < ticks && state.outcome === null; index += 1) stepSeaBattle(state, orders[state.tick] ?? []);
}

/** A quiet sea with one far-off pirate: nothing interferes with a test of the player's own ship. */
function quiet(seed = 5): SeaBattleState {
  const state = createSeaBattle(setup(seed));
  const pirate = state.ships[1];
  if (pirate !== undefined) {
    pirate.x = 200;
    pirate.z = 200;
  }
  return state;
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
      const live = playLive(battle, gunner());
      expect(live.inputs.length).toBeLessThanOrEqual(SEA_BATTLE_MAX_INPUTS);
      expect(runSeaBattle(battle, live.inputs)).toEqual(live.result);
      if (live.result.outcome === "WON") won += 1;
    }
    // A captain who keeps the pirate abeam and lays its broadsides wins most of these fights.
    expect(won).toBeGreaterThan(6);
  });

  it("is the same fight every time for the same seed and inputs, and a different one for another seed", () => {
    const inputs = playLive(setup(4242, [CUTTER, CUTTER]), gunner()).inputs;
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
    // An aim belongs to a broadside only, as a whole number inside its arc.
    expect(() => runSeaBattle(setup(1), [{ tick: 1, action: "SAIL_FULL", aim: 10 }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: 1, action: "FIRE_PORT", aim: SEA_BATTLE_AIM_LIMIT + 1 }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: 1, action: "FIRE_PORT", aim: 2.5 }])).toThrow();
    expect(() => runSeaBattle(setup(1), [{ tick: 1, action: "FIRE_PORT", aim: -SEA_BATTLE_AIM_LIMIT }])).not.toThrow();
    expect(() => createSeaBattle({ seed: -1, player: SLOOP, pirates: [CUTTER] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: SLOOP, pirates: [] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: { ...SLOOP, speed: Number.NaN }, pirates: [CUTTER] })).toThrow();
    expect(() => createSeaBattle({ seed: 1, player: { ...SLOOP, turn: 1.5 }, pirates: [CUTTER] })).toThrow();
  });

  it("measures a broadside's reach from the ticks it was charged, never from the device", () => {
    const reach = (chargeTicks: number | null): number => {
      const state = quiet();
      const me = state.ships[0];
      if (me === undefined) throw new Error("no ship");
      const fireAt = 1 + (chargeTicks ?? 0);
      const orders: Record<number, CaptainOrder[]> = { [fireAt]: [{ action: "FIRE_STARBOARD" }] };
      if (chargeTicks !== null) orders[1] = [{ action: "CHARGE_STARBOARD" }];
      stepWith(state, orders, fireAt + 1);
      // Follow the broadside's ball down, and measure from where it left the ship.
      const ball = state.balls[0];
      if (ball === undefined) throw new Error("no ball");
      const from = { x: me.x, z: me.z };
      let landed = { x: ball.x, z: ball.z };
      for (let tick = 0; tick < 200 && state.balls.length > 0; tick += 1) {
        stepSeaBattle(state, []);
        const impact = state.impacts[0];
        if (impact !== undefined) landed = impact;
      }
      return Math.sqrt((landed.x - from.x) ** 2 + (landed.z - from.z) ** 2);
    };
    const uncharged = reach(null);
    const half = reach(SEA_BATTLE_CHARGE_TICKS / 2);
    const full = reach(SEA_BATTLE_CHARGE_TICKS);
    const held = reach(SEA_BATTLE_CHARGE_TICKS * 3);
    // The wind moves a ball a little, so the reaches are close to the still-air ones, not exact.
    expect(uncharged).toBeGreaterThan(SEA_BATTLE_MIN_RANGE * 0.75);
    expect(uncharged).toBeLessThan(SEA_BATTLE_MIN_RANGE * 1.35);
    expect(half).toBeGreaterThan(uncharged + 20);
    expect(full).toBeGreaterThan(SEA_BATTLE_MAX_RANGE * 0.85);
    expect(full).toBeLessThan(SEA_BATTLE_MAX_RANGE * 1.15);
    // Holding past full charge reaches no farther.
    expect(Math.abs(held - full)).toBeLessThan(SEA_BATTLE_MAX_RANGE * 0.1);
  });

  it("flies balls in an arc that the wind pushes a little off its line, never a lot", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const state = quiet(seed);
      expect(state.wind.strength).toBeGreaterThan(0);
      const still = { ...state, wind: { x: 0, z: 0, heading: 0, strength: 0 } };
      const windy = previewBroadside(state, 0, "PORT", 0, 1);
      const calm = previewBroadside(still, 0, "PORT", 0, 1);
      const drift = Math.sqrt((windy.landing.x - calm.landing.x) ** 2 + (windy.landing.z - calm.landing.z) ** 2);
      expect(drift).toBeGreaterThan(0.5);
      expect(drift).toBeLessThan(SEA_BATTLE_MAX_RANGE * 0.2);
      // An arc: up, then down to the water.
      const top = Math.max(...calm.path.map((point) => point.y));
      expect(top).toBeGreaterThan(10);
      expect(calm.path[calm.path.length - 1]?.y).toBe(0);
    }
  });

  it("swings a broadside along the beam by its aim, inside the arc only", () => {
    const state = quiet();
    const beam = previewBroadside(state, 0, "STARBOARD", 0, 0.5).landing;
    const fore = previewBroadside(state, 0, "STARBOARD", -SEA_BATTLE_AIM_LIMIT, 0.5).landing;
    const beyond = previewBroadside(state, 0, "STARBOARD", -SEA_BATTLE_AIM_LIMIT * 3, 0.5).landing;
    const me = state.ships[0];
    if (me === undefined) throw new Error("no ship");
    // The ship heads north (-z): a starboard shot laid toward the bow lands farther north than abeam.
    expect(fore.z).toBeLessThan(beam.z - 10);
    // An aim past the arc is held at its edge.
    expect(beyond).toEqual(fore);
  });

  it("rams: the ship driven into takes the blow, the rammer only a share of it", () => {
    const state = quiet();
    const me = state.ships[0];
    const pirate = state.ships[1];
    if (me === undefined || pirate === undefined) throw new Error("no ships");
    // The pirate lies close ahead, its stern to the player's bow, so it drives nothing back into the
    // player; the player rows straight at it.
    pirate.x = me.x + seaCosine(me.heading) * 22;
    pirate.z = me.z + seaSine(me.heading) * 22;
    pirate.heading = me.heading;
    pirate.speed = 0;
    pirate.sail = 0;
    const before = { me: me.hull, pirate: pirate.hull };
    let rammed = false;
    for (let tick = 0; tick < 80 && !rammed; tick += 1) {
      stepSeaBattle(state, tick === 0 ? [{ action: "SAIL_FULL" }, { action: "OARS" }] : []);
      rammed = state.rams.length > 0;
    }
    expect(rammed).toBe(true);
    const dealt = before.pirate - pirate.hull;
    const taken = before.me - me.hull;
    expect(dealt).toBeGreaterThan(15);
    expect(taken).toBeGreaterThan(0);
    // The rammer pays a quarter of the blow it deals.
    expect(dealt).toBeGreaterThan(taken * 3);
    expect(state.stats.damageDealt).toBe(dealt);
    // Ships that met are pushed apart, not left inside one another.
    const gap = Math.sqrt((pirate.x - me.x) ** 2 + (pirate.z - me.z) ** 2);
    expect(gap).toBeGreaterThan((me.spec.radius + pirate.spec.radius) * 0.84);
  });

  it("rows a short burst faster than any sail, then rests the crew", () => {
    const state = quiet();
    const me = state.ships[0];
    if (me === undefined) throw new Error("no ship");
    stepWith(state, { 0: [{ action: "OARS" }] }, 30);
    expect(me.speed).toBeGreaterThan(me.spec.speed);
    stepWith(state, {}, 20);
    expect(me.oars).toBe(0);
    expect(me.oarRest).toBeGreaterThan(SEA_BATTLE_OAR_REST_TICKS - 20);
    // Asked again while resting, the crew does not row.
    stepSeaBattle(state, [{ action: "OARS" }]);
    expect(me.oars).toBe(0);
  });
});
