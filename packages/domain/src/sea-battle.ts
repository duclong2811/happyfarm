import { DomainError } from "./errors";

/**
 * A sea battle, simulated tick by tick (docs/design/NAVAL.md, W5c).
 *
 * The same code runs in two places. On the player's device it plays the fight in realtime while the
 * device records the player's inputs. On the server it replays the fight from the same setup and those
 * inputs to decide the result. The server never takes a hit, a position or a winner from a client;
 * it only ever computes them.
 *
 * For the replay to be the same fight, the simulation is deterministic down to the bit on every
 * JavaScript engine:
 * - Only `+ - * /` and `Math.sqrt` touch floating point. These are correctly rounded IEEE-754 in
 *   every engine. `Math.sin`, `Math.cos`, `Math.atan2`, `Math.hypot` and `Math.pow` are not, so they
 *   are never used: headings are whole units of a turn, and sine and cosine are a fixed polynomial
 *   here.
 * - Randomness is a seeded 32-bit generator using integer operations only.
 * - Everything happens in a fixed order: ships by index, then cannonballs by creation order.
 *
 * Axes: +x east, +z south. Heading 0 faces east, and a heading grows clockwise as seen from above,
 * through south. Port (left) is a quarter turn anticlockwise of the heading, starboard a quarter turn
 * clockwise.
 */

export const SEA_BATTLE_TICK_HZ = 20;
export const SEA_BATTLE_MAX_TICKS = 180 * SEA_BATTLE_TICK_HZ;
/** A fight is in this circle round its start; a ship that sails out of it has fled. */
export const SEA_BATTLE_ARENA_RADIUS = 260;
/** Inputs one fight may carry: far more than a player can press, small enough to replay cheaply. */
export const SEA_BATTLE_MAX_INPUTS = 2_400;
/** Heading units in a full turn. */
export const SEA_BATTLE_TURN_UNITS = 4096;

const QUARTER = SEA_BATTLE_TURN_UNITS / 4;
const DT = 1 / SEA_BATTLE_TICK_HZ;
const BALL_SPEED = 42;
const BALL_TICKS = 30;
const BALL_DAMAGE = 8;
const RELOAD_TICKS = 60;
const ACCELERATION = 0.25;

export const SEA_BATTLE_ACTIONS = [
  "RUDDER_LEFT",
  "RUDDER_CENTER",
  "RUDDER_RIGHT",
  "SAIL_DOWN",
  "SAIL_HALF",
  "SAIL_FULL",
  "FIRE_PORT",
  "FIRE_STARBOARD"
] as const;
export type SeaBattleAction = (typeof SEA_BATTLE_ACTIONS)[number];

export interface SeaBattleInput {
  readonly tick: number;
  readonly action: SeaBattleAction;
}

/** One ship's fighting numbers. */
export interface SeaBattleShipSpec {
  readonly hull: number;
  readonly hullMax: number;
  readonly cannons: number;
  /** Units a second at full sail. */
  readonly speed: number;
  /** Heading units a tick at full rudder. */
  readonly turn: number;
  /** The circle a cannonball must enter to hit it. */
  readonly radius: number;
  /** How wide its broadsides scatter, in heading units either side. */
  readonly spread: number;
}

export interface SeaBattleSetup {
  readonly seed: number;
  readonly player: SeaBattleShipSpec;
  readonly pirates: readonly SeaBattleShipSpec[];
}

export interface SeaBattleShip {
  readonly spec: SeaBattleShipSpec;
  x: number;
  z: number;
  /** Whole units of a turn, 0 to 4095. */
  heading: number;
  speed: number;
  /** 0 struck, 1 half, 2 full. */
  sail: 0 | 1 | 2;
  rudder: -1 | 0 | 1;
  hull: number;
  reloadPort: number;
  reloadStarboard: number;
  alive: boolean;
}

export interface SeaBattleBall {
  x: number;
  z: number;
  readonly vx: number;
  readonly vz: number;
  ticksLeft: number;
  /** 0 is the player's; any other index is a pirate's. */
  readonly owner: number;
}

export type SeaBattleOutcome = "WON" | "LOST" | "FLED" | "TIMEOUT";

export interface SeaBattleState {
  tick: number;
  /** The player is ship 0; pirates follow. */
  readonly ships: SeaBattleShip[];
  balls: SeaBattleBall[];
  rng: number;
  outcome: SeaBattleOutcome | null;
  readonly stats: { shots: number; hits: number; damageDealt: number; damageTaken: number };
}

export interface SeaBattleResult {
  readonly outcome: SeaBattleOutcome;
  readonly ticks: number;
  readonly playerHull: number;
  readonly pirateHulls: readonly number[];
  readonly stats: { readonly shots: number; readonly hits: number; readonly damageDealt: number; readonly damageTaken: number };
}

/** Sine of a heading in turn units, by a fixed polynomial: the same bits on every engine. */
export function seaSine(units: number): number {
  let u = ((units % SEA_BATTLE_TURN_UNITS) + SEA_BATTLE_TURN_UNITS) % SEA_BATTLE_TURN_UNITS;
  let sign = 1;
  if (u >= 2 * QUARTER) {
    u -= 2 * QUARTER;
    sign = -1;
  }
  if (u > QUARTER) u = 2 * QUARTER - u;
  const x = u * ((2 * 3.141592653589793) / SEA_BATTLE_TURN_UNITS);
  const x2 = x * x;
  return sign * x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - (x2 / 210) * (1 - x2 / 272))))))));
}

export function seaCosine(units: number): number {
  return seaSine(units + QUARTER);
}

/** One step of a 32-bit generator: integer operations only. Returns the next state and a value in [0, 1). */
function nextRandom(state: number): { readonly state: number; readonly value: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function random(state: SeaBattleState): number {
  const step = nextRandom(state.rng);
  state.rng = step.state;
  return step.value;
}

function normaliseHeading(units: number): number {
  return ((units % SEA_BATTLE_TURN_UNITS) + SEA_BATTLE_TURN_UNITS) % SEA_BATTLE_TURN_UNITS;
}

function assertSpec(spec: SeaBattleShipSpec): void {
  const finite = [spec.hull, spec.hullMax, spec.cannons, spec.speed, spec.turn, spec.radius, spec.spread].every((value) => Number.isFinite(value));
  if (!finite || spec.hull < 0 || spec.hullMax <= 0 || spec.cannons < 0 || spec.speed <= 0 || spec.turn <= 0 || spec.radius <= 0 || spec.spread < 0) {
    throw new DomainError("INVALID_SEA_BATTLE", "A ship's fighting numbers are invalid");
  }
  if (!Number.isInteger(spec.turn) || !Number.isInteger(spec.spread) || !Number.isInteger(spec.cannons)) {
    throw new DomainError("INVALID_SEA_BATTLE", "A ship's turn, spread and cannons are whole numbers");
  }
}

/** The fight as it starts: the player in the middle heading north, the pirates closing from the seed's bearings. */
export function createSeaBattle(setup: SeaBattleSetup): SeaBattleState {
  if (!Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > 0xffffffff) throw new DomainError("INVALID_SEA_BATTLE", "A sea battle's seed is a 32-bit whole number");
  if (setup.pirates.length < 1 || setup.pirates.length > 6) throw new DomainError("INVALID_SEA_BATTLE", "A sea battle has one to six pirate ships");
  assertSpec(setup.player);
  for (const pirate of setup.pirates) assertSpec(pirate);
  const ship = (spec: SeaBattleShipSpec, x: number, z: number, heading: number): SeaBattleShip => ({
    spec,
    x,
    z,
    heading: normaliseHeading(heading),
    speed: spec.speed * 0.5,
    sail: 1,
    rudder: 0,
    hull: Math.min(spec.hull, spec.hullMax),
    reloadPort: 0,
    reloadStarboard: 0,
    alive: spec.hull > 0
  });
  const state: SeaBattleState = {
    tick: 0,
    ships: [ship(setup.player, 0, 0, 3 * QUARTER)],
    balls: [],
    rng: setup.seed >>> 0,
    outcome: null,
    stats: { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0 }
  };
  setup.pirates.forEach((spec, index) => {
    // Each pirate comes from its own bearing, a little apart, and heads at the player.
    const bearing = Math.floor(random(state) * SEA_BATTLE_TURN_UNITS) + index * Math.floor(SEA_BATTLE_TURN_UNITS / setup.pirates.length);
    const distance = 120 + random(state) * 40;
    const x = seaCosine(bearing) * distance;
    const z = seaSine(bearing) * distance;
    state.ships.push(ship(spec, x, z, bearing + 2 * QUARTER));
  });
  if (!state.ships[0]?.alive) state.outcome = "LOST";
  return state;
}

function fire(state: SeaBattleState, index: number, side: "PORT" | "STARBOARD"): void {
  const ship = state.ships[index];
  if (ship === undefined || !ship.alive || ship.spec.cannons <= 0) return;
  if (side === "PORT" ? ship.reloadPort > 0 : ship.reloadStarboard > 0) return;
  if (side === "PORT") ship.reloadPort = RELOAD_TICKS;
  else ship.reloadStarboard = RELOAD_TICKS;
  const guns = Math.max(1, Math.floor(ship.spec.cannons / 2));
  const sideHeading = ship.heading + (side === "PORT" ? -QUARTER : QUARTER);
  const alongX = seaCosine(ship.heading);
  const alongZ = seaSine(ship.heading);
  const shipVx = alongX * ship.speed;
  const shipVz = alongZ * ship.speed;
  for (let gun = 0; gun < guns; gun += 1) {
    const offset = (gun - (guns - 1) / 2) * 2.2;
    const scatter = Math.floor((random(state) * 2 - 1) * ship.spec.spread);
    const direction = sideHeading + scatter;
    state.balls.push({
      x: ship.x + alongX * offset,
      z: ship.z + alongZ * offset,
      vx: seaCosine(direction) * BALL_SPEED + shipVx,
      vz: seaSine(direction) * BALL_SPEED + shipVz,
      ticksLeft: BALL_TICKS,
      owner: index
    });
    if (index === 0) state.stats.shots += 1;
  }
}

/** A pirate's choice for this tick: close in, then lie broadside on and fire when the player is abeam. */
function steerPirate(state: SeaBattleState, index: number): void {
  const pirate = state.ships[index];
  const player = state.ships[0];
  if (pirate === undefined || player === undefined || !pirate.alive) return;
  const dx = player.x - pirate.x;
  const dz = player.z - pirate.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const fx = seaCosine(pirate.heading);
  const fz = seaSine(pirate.heading);
  const cross = fx * dz - fz * dx;
  const dot = fx * dx + fz * dz;
  const abeam = distance > 0 && Math.abs(dot) / distance < 0.35;
  if (distance > 75) {
    pirate.sail = 2;
    pirate.rudder = Math.abs(cross) < distance * 0.08 && dot > 0 ? 0 : cross > 0 ? 1 : -1;
  } else {
    pirate.sail = 1;
    // Turn so the player falls abeam: away when the player is ahead, towards when astern.
    pirate.rudder = abeam ? 0 : dot > 0 ? (cross > 0 ? -1 : 1) : cross > 0 ? 1 : -1;
  }
  if (player.alive && distance < 62 && abeam) fire(state, index, cross > 0 ? "STARBOARD" : "PORT");
}

function applyPlayerAction(state: SeaBattleState, action: SeaBattleAction): void {
  const player = state.ships[0];
  if (player === undefined || !player.alive) return;
  switch (action) {
    case "RUDDER_LEFT":
      player.rudder = -1;
      break;
    case "RUDDER_CENTER":
      player.rudder = 0;
      break;
    case "RUDDER_RIGHT":
      player.rudder = 1;
      break;
    case "SAIL_DOWN":
      player.sail = 0;
      break;
    case "SAIL_HALF":
      player.sail = 1;
      break;
    case "SAIL_FULL":
      player.sail = 2;
      break;
    case "FIRE_PORT":
      fire(state, 0, "PORT");
      break;
    case "FIRE_STARBOARD":
      fire(state, 0, "STARBOARD");
      break;
  }
}

/**
 * Advances the fight one tick, with the player's actions for this tick (in the order they were
 * given). Does nothing once the fight has an outcome.
 */
export function stepSeaBattle(state: SeaBattleState, actions: readonly SeaBattleAction[]): void {
  if (state.outcome !== null) return;
  for (const action of actions) applyPlayerAction(state, action);
  for (let index = 1; index < state.ships.length; index += 1) steerPirate(state, index);

  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const target = ship.spec.speed * (ship.sail === 0 ? 0 : ship.sail === 1 ? 0.5 : 1);
    ship.speed += (target - ship.speed) * ACCELERATION * DT * 4;
    ship.heading = normaliseHeading(ship.heading + ship.rudder * ship.spec.turn);
    ship.x += seaCosine(ship.heading) * ship.speed * DT;
    ship.z += seaSine(ship.heading) * ship.speed * DT;
    if (ship.reloadPort > 0) ship.reloadPort -= 1;
    if (ship.reloadStarboard > 0) ship.reloadStarboard -= 1;
  }

  const flying: SeaBattleBall[] = [];
  for (const ball of state.balls) {
    ball.x += ball.vx * DT;
    ball.z += ball.vz * DT;
    ball.ticksLeft -= 1;
    let landed = false;
    // A player's ball can hit any pirate; a pirate's ball hits only the player.
    for (let index = 0; index < state.ships.length && !landed; index += 1) {
      const ship = state.ships[index];
      if (ship === undefined || !ship.alive || index === ball.owner || (ball.owner !== 0 && index !== 0)) continue;
      const dx = ball.x - ship.x;
      const dz = ball.z - ship.z;
      if (dx * dx + dz * dz > ship.spec.radius * ship.spec.radius) continue;
      landed = true;
      const damage = Math.min(BALL_DAMAGE, ship.hull);
      ship.hull -= damage;
      if (ship.hull <= 0) ship.alive = false;
      if (ball.owner === 0) {
        state.stats.hits += 1;
        state.stats.damageDealt += damage;
      } else {
        state.stats.damageTaken += damage;
      }
    }
    if (!landed && ball.ticksLeft > 0) flying.push(ball);
  }
  state.balls = flying;
  state.tick += 1;

  const player = state.ships[0];
  if (player === undefined || !player.alive) state.outcome = "LOST";
  else if (state.ships.slice(1).every((ship) => !ship.alive)) state.outcome = "WON";
  else if (player.x * player.x + player.z * player.z > SEA_BATTLE_ARENA_RADIUS * SEA_BATTLE_ARENA_RADIUS) state.outcome = "FLED";
  else if (state.tick >= SEA_BATTLE_MAX_TICKS) state.outcome = "TIMEOUT";
}

/** Refuses inputs no honest device could send: too many, out of order, out of range, or unknown. */
export function assertSeaBattleInputs(inputs: readonly SeaBattleInput[]): void {
  if (inputs.length > SEA_BATTLE_MAX_INPUTS) throw new DomainError("INVALID_SEA_BATTLE", "Too many inputs for one fight");
  let last = 0;
  for (const input of inputs) {
    if (!Number.isInteger(input.tick) || input.tick < 0 || input.tick >= SEA_BATTLE_MAX_TICKS || input.tick < last) {
      throw new DomainError("INVALID_SEA_BATTLE", "A fight's inputs must be in order and inside the fight");
    }
    if (!(SEA_BATTLE_ACTIONS as readonly string[]).includes(input.action)) throw new DomainError("INVALID_SEA_BATTLE", "Unknown fight input");
    last = input.tick;
  }
}

/** Plays a whole fight from its setup and the player's inputs: what the server does to decide it. */
export function runSeaBattle(setup: SeaBattleSetup, inputs: readonly SeaBattleInput[]): SeaBattleResult {
  assertSeaBattleInputs(inputs);
  const state = createSeaBattle(setup);
  let next = 0;
  while (state.outcome === null) {
    const actions: SeaBattleAction[] = [];
    while (next < inputs.length && inputs[next]?.tick === state.tick) {
      const input = inputs[next];
      if (input !== undefined) actions.push(input.action);
      next += 1;
    }
    stepSeaBattle(state, actions);
  }
  return seaBattleResult(state);
}

export function seaBattleResult(state: SeaBattleState): SeaBattleResult {
  return {
    outcome: state.outcome ?? "TIMEOUT",
    ticks: state.tick,
    playerHull: Math.max(0, state.ships[0]?.hull ?? 0),
    pirateHulls: state.ships.slice(1).map((ship) => Math.max(0, ship.hull)),
    stats: { ...state.stats }
  };
}
