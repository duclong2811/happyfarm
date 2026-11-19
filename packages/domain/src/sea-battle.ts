import { DomainError } from "./errors";

/**
 * A sea battle, simulated tick by tick (docs/design/NAVAL.md, W5c; owner decisions 2026-11-19).
 *
 * The same code runs in two places. On the player's device it plays the fight in realtime while the
 * device records the player's inputs. On the server it replays the fight from the same setup and those
 * inputs to decide the result. The server never takes a hit, a position or a winner from a client;
 * it only ever computes them.
 *
 * How a fight plays (second version, the owner's "open-world Gunny"):
 * - Ships are steered with the rudder, driven by three sail settings, and can row a short burst
 *   ("oars") to dodge or to ram.
 * - Broadsides are aimed like an artillery game: holding a side's fire charges it (the longer the
 *   hold, the farther the shot, to full in 1.5 s), the aim may swing about 35 degrees either side of
 *   the beam, and releasing fires. The charge is measured here, from the ticks between the charge and
 *   the release, never taken from the device.
 * - Stone balls fly an arc under gravity, and the fight's wind pushes them a little off their line
 *   (and helps or slows a ship's sails a little): it matters, but it never decides a shot alone.
 * - Ships collide. A ship driving into another hurts it by its own speed and weight; the one rammed
 *   takes the blow, the rammer only a share of it, and a head-on meeting hurts both alike.
 *
 * For the replay to be the same fight, the simulation is deterministic down to the bit on every
 * JavaScript engine:
 * - Only `+ - * /` and `Math.sqrt` touch floating point. These are correctly rounded IEEE-754 in
 *   every engine. `Math.sin`, `Math.cos`, `Math.atan2`, `Math.hypot` and `Math.pow` are not, so they
 *   are never used: headings are whole units of a turn, and sine and cosine are a fixed polynomial
 *   here.
 * - Randomness is a seeded 32-bit generator using integer operations only.
 * - Everything happens in a fixed order: ships by index, then collisions by pair, then cannonballs by
 *   creation order.
 *
 * Axes: +x east, +z south, +y up. Heading 0 faces east, and a heading grows clockwise as seen from
 * above, through south. Port (left) is a quarter turn anticlockwise of the heading, starboard a
 * quarter turn clockwise.
 */

export const SEA_BATTLE_TICK_HZ = 20;
export const SEA_BATTLE_MAX_TICKS = 180 * SEA_BATTLE_TICK_HZ;
/** A fight is in this circle round its start; a ship that sails out of it has fled. */
export const SEA_BATTLE_ARENA_RADIUS = 260;
/** Inputs one fight may carry: one a tick on average, more than any player presses, cheap to replay. */
export const SEA_BATTLE_MAX_INPUTS = 3_600;
/** Heading units in a full turn. */
export const SEA_BATTLE_TURN_UNITS = 4096;
/** How far off the beam a broadside may be laid, either way, in heading units (about 35 degrees). */
export const SEA_BATTLE_AIM_LIMIT = 400;
/** Ticks a broadside takes to charge from its shortest reach to its longest (1.5 s). */
export const SEA_BATTLE_CHARGE_TICKS = 30;
/** A broadside's reach on still air, uncharged and fully charged. */
export const SEA_BATTLE_MIN_RANGE = 20;
export const SEA_BATTLE_MAX_RANGE = 95;
/** Ticks a side's guns take to load again after a broadside. */
export const SEA_BATTLE_RELOAD_TICKS = 60;
/** The oars: a burst of this many ticks, then this long before the crew can row again. */
export const SEA_BATTLE_OAR_TICKS = 40;
export const SEA_BATTLE_OAR_REST_TICKS = 200;

const QUARTER = SEA_BATTLE_TURN_UNITS / 4;
const DT = 1 / SEA_BATTLE_TICK_HZ;
const GRAVITY = 30;
/** Balls leave the guns this high above the water, at a fixed elevation of 30 degrees. */
const LAUNCH_HEIGHT = 2;
const ELEVATION_SIN = 0.5;
const ELEVATION_COS = 0.8660254037844386;
/** A ball this low over a hull strikes it. */
const HULL_HEIGHT = 4;
const BALL_DAMAGE = 8;
/** A ball is in the air at most this long (it lands well before). */
const BALL_MAX_TICKS = 100;
const ACCELERATION = 0.25;
/** The wind's push on a ball in flight, at its strongest (units a second, each second). */
const WIND_MAX = 7;
/** The share of a ship's sailing speed the wind adds or takes, at its strongest. */
const WIND_SAIL_SHARE = 0.1;
/** Rowing: this share of top speed, reached faster than under sail. */
const OAR_SPEED = 1.6;
/** Ramming: ships meet when this share of their two circles overlap. */
const RAM_REACH = 0.85;
const RAM_SPEED_MIN = 2;
const RAM_DAMAGE_PER_SPEED = 3;
/** What ramming costs the rammer, as a share of the blow it deals. */
const RAM_SELF_SHARE = 0.25;
/** After a blow, the two ships need this long apart before another one counts. */
const RAM_REST_TICKS = 20;

export const SEA_BATTLE_ACTIONS = [
  "RUDDER_LEFT",
  "RUDDER_CENTER",
  "RUDDER_RIGHT",
  "SAIL_DOWN",
  "SAIL_HALF",
  "SAIL_FULL",
  "FIRE_PORT",
  "FIRE_STARBOARD",
  "CHARGE_PORT",
  "CHARGE_STARBOARD",
  "OARS"
] as const;

export type SeaBattleAction = (typeof SEA_BATTLE_ACTIONS)[number];

export interface SeaBattleInput {
  readonly tick: number;
  readonly action: SeaBattleAction;
  /** A broadside's aim off the beam, in heading units (`FIRE_*` only; absent means straight abeam). */
  readonly aim?: number;
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
  /** The circle a cannonball must enter to hit it, and the hull it rams with. */
  readonly radius: number;
  /** How wide its broadsides scatter, in heading units either side. */
  readonly spread: number;
}

export interface SeaBattleSetup {
  readonly seed: number;
  readonly player: SeaBattleShipSpec;
  readonly pirates: readonly SeaBattleShipSpec[];
}

export type SeaBattleSide = "PORT" | "STARBOARD";

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
  /** The tick a side began charging, or -1 when it is not. */
  chargePort: number;
  chargeStarboard: number;
  /** Ticks left of a burst at the oars, and ticks before the crew can row again. */
  oars: number;
  oarRest: number;
  /** Ticks before another ramming blow counts. */
  ramRest: number;
  alive: boolean;
}

export interface SeaBattleBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ticks: number;
  /** 0 is the player's; any other index is a pirate's. */
  readonly owner: number;
}

/** Where a ball came down this tick, for the eye (a splash, or a hit). */
export interface SeaBattleImpact {
  readonly x: number;
  readonly z: number;
  /** The ship it struck, or -1 for open water. */
  readonly ship: number;
}

/** A ramming blow this tick, for the eye. */
export interface SeaBattleRam {
  readonly x: number;
  readonly z: number;
  readonly a: number;
  readonly b: number;
}

export type SeaBattleOutcome = "WON" | "LOST" | "FLED" | "TIMEOUT";

export interface SeaBattleState {
  tick: number;
  /** The player is ship 0; pirates follow. */
  readonly ships: SeaBattleShip[];
  balls: SeaBattleBall[];
  /** The fight's wind: its push on a ball in flight, east (x) and south (z). Fixed by the seed. */
  readonly wind: { readonly x: number; readonly z: number; readonly heading: number; readonly strength: number };
  /** What happened in the last tick, for the renderer: it decides nothing. */
  impacts: SeaBattleImpact[];
  rams: SeaBattleRam[];
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

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
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

/** The fight as it starts: the player lying still in the middle heading north, the pirates closing from the seed's bearings. */
export function createSeaBattle(setup: SeaBattleSetup): SeaBattleState {
  if (!Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > 0xffffffff) throw new DomainError("INVALID_SEA_BATTLE", "A sea battle's seed is a 32-bit whole number");
  if (setup.pirates.length < 1 || setup.pirates.length > 6) throw new DomainError("INVALID_SEA_BATTLE", "A sea battle has one to six pirate ships");
  assertSpec(setup.player);
  for (const pirate of setup.pirates) assertSpec(pirate);
  // The pirates come on under half sail; the ambushed ship is caught lying still with its sails struck,
  // so a captain who gives no orders neither fights nor gets away.
  const ship = (spec: SeaBattleShipSpec, x: number, z: number, heading: number, underway: boolean): SeaBattleShip => ({
    spec,
    x,
    z,
    heading: normaliseHeading(heading),
    speed: underway ? spec.speed * 0.5 : 0,
    sail: underway ? 1 : 0,
    rudder: 0,
    hull: Math.min(spec.hull, spec.hullMax),
    reloadPort: 0,
    reloadStarboard: 0,
    chargePort: -1,
    chargeStarboard: -1,
    oars: 0,
    oarRest: 0,
    ramRest: 0,
    alive: spec.hull > 0
  });
  const state: SeaBattleState = {
    tick: 0,
    ships: [ship(setup.player, 0, 0, 3 * QUARTER, false)],
    balls: [],
    wind: { x: 0, z: 0, heading: 0, strength: 0 },
    impacts: [],
    rams: [],
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
    state.ships.push(ship(spec, x, z, bearing + 2 * QUARTER, true));
  });
  // The wind blows from the seed's own quarter, at least a breeze and at most WIND_MAX.
  const windHeading = Math.floor(random(state) * SEA_BATTLE_TURN_UNITS);
  const strength = WIND_MAX * (0.25 + 0.75 * random(state));
  (state as { wind: SeaBattleState["wind"] }).wind = {
    x: seaCosine(windHeading) * strength,
    z: seaSine(windHeading) * strength,
    heading: windHeading,
    strength
  };
  if (!state.ships[0]?.alive) state.outcome = "LOST";
  return state;
}

/** How charged a side is at `tick`: 0 for a ball at its shortest reach, 1 for its longest. */
export function broadsidePower(ship: SeaBattleShip, side: SeaBattleSide, tick: number): number {
  const started = side === "PORT" ? ship.chargePort : ship.chargeStarboard;
  if (started < 0) return 0;
  return clamp((tick - started) / SEA_BATTLE_CHARGE_TICKS, 0, 1);
}

/** The aim a device may send: whole heading units, inside the broadside's arc. */
function clampAim(aim: number | undefined): number {
  if (aim === undefined) return 0;
  return clamp(Math.floor(aim), -SEA_BATTLE_AIM_LIMIT, SEA_BATTLE_AIM_LIMIT);
}

/**
 * A ball as it leaves a gun: from the ship (offset `along` its length), on `direction`, with the speed
 * that carries it `range` on still air at the fixed elevation, plus the ship's own way.
 */
function launch(ship: SeaBattleShip, direction: number, range: number, along: number, owner: number): SeaBattleBall {
  const alongX = seaCosine(ship.heading);
  const alongZ = seaSine(ship.heading);
  // range = v^2 * sin(2 * elevation) / g, so v = sqrt(range * g / (2 * sin * cos)).
  const speed = Math.sqrt((range * GRAVITY) / (2 * ELEVATION_SIN * ELEVATION_COS));
  const horizontal = speed * ELEVATION_COS;
  return {
    x: ship.x + alongX * along,
    y: LAUNCH_HEIGHT,
    z: ship.z + alongZ * along,
    vx: seaCosine(direction) * horizontal + alongX * ship.speed,
    vy: speed * ELEVATION_SIN,
    vz: seaSine(direction) * horizontal + alongZ * ship.speed,
    ticks: 0,
    owner
  };
}

/** One tick of a ball's flight: the wind's push, gravity, then the move. */
function fly(ball: SeaBattleBall, wind: SeaBattleState["wind"]): void {
  ball.vx += wind.x * DT;
  ball.vz += wind.z * DT;
  ball.vy -= GRAVITY * DT;
  ball.x += ball.vx * DT;
  ball.y += ball.vy * DT;
  ball.z += ball.vz * DT;
  ball.ticks += 1;
}

function rangeFor(power: number): number {
  return SEA_BATTLE_MIN_RANGE + clamp(power, 0, 1) * (SEA_BATTLE_MAX_RANGE - SEA_BATTLE_MIN_RANGE);
}

function sideHeading(ship: SeaBattleShip, side: SeaBattleSide): number {
  return ship.heading + (side === "PORT" ? -QUARTER : QUARTER);
}

/**
 * Where a broadside laid now would go, for the device to draw while the player aims: the path of a
 * ball fired from the ship's middle with no scatter. It changes nothing.
 */
export function previewBroadside(
  state: SeaBattleState,
  index: number,
  side: SeaBattleSide,
  aim: number,
  power: number
): { readonly path: readonly { readonly x: number; readonly y: number; readonly z: number }[]; readonly landing: { readonly x: number; readonly z: number } } {
  const ship = state.ships[index];
  if (ship === undefined) return { path: [], landing: { x: 0, z: 0 } };
  const ball = launch(ship, sideHeading(ship, side) + clampAim(aim), rangeFor(power), 0, index);
  const path: { x: number; y: number; z: number }[] = [{ x: ball.x, y: ball.y, z: ball.z }];
  while (ball.y > 0 && ball.ticks < BALL_MAX_TICKS) {
    fly(ball, state.wind);
    path.push({ x: ball.x, y: Math.max(0, ball.y), z: ball.z });
  }
  return { path, landing: { x: ball.x, z: ball.z } };
}

function fire(state: SeaBattleState, index: number, side: SeaBattleSide, aim: number, power: number): void {
  const ship = state.ships[index];
  if (ship === undefined || !ship.alive || ship.spec.cannons <= 0) return;
  if (side === "PORT" ? ship.reloadPort > 0 : ship.reloadStarboard > 0) return;
  if (side === "PORT") {
    ship.reloadPort = SEA_BATTLE_RELOAD_TICKS;
    ship.chargePort = -1;
  } else {
    ship.reloadStarboard = SEA_BATTLE_RELOAD_TICKS;
    ship.chargeStarboard = -1;
  }
  const guns = Math.max(1, Math.floor(ship.spec.cannons / 2));
  const laid = sideHeading(ship, side) + clampAim(aim);
  const range = rangeFor(power);
  for (let gun = 0; gun < guns; gun += 1) {
    const offset = (gun - (guns - 1) / 2) * 2.2;
    const scatter = Math.floor((random(state) * 2 - 1) * ship.spec.spread);
    // Each gun's charge differs a little too: a few percent of the reach either way.
    const reach = range * (1 + (random(state) * 2 - 1) * 0.04);
    state.balls.push(launch(ship, laid + scatter, reach, offset, index));
    if (index === 0) state.stats.shots += 1;
  }
}

function startCharge(state: SeaBattleState, ship: SeaBattleShip, side: SeaBattleSide): void {
  if (!ship.alive || ship.spec.cannons <= 0) return;
  if (side === "PORT") {
    if (ship.reloadPort === 0 && ship.chargePort < 0) ship.chargePort = state.tick;
  } else if (ship.reloadStarboard === 0 && ship.chargeStarboard < 0) {
    ship.chargeStarboard = state.tick;
  }
}

function row(ship: SeaBattleShip): void {
  if (ship.alive && ship.oars === 0 && ship.oarRest === 0) ship.oars = SEA_BATTLE_OAR_TICKS;
}

/**
 * A pirate's choice for this tick.
 *
 * - Far off, it closes at full sail.
 * - A player lying still or crawling is rammed: the pirate heads straight in and rows the last stretch.
 * - Otherwise it circles the player with the player on the side it already has, drawing in when too
 *   far and out when too close, so its broadside stays on.
 * - It fires that side when the player is inside the broadside's arc and reach, aiming where the
 *   player will be when the ball comes down. It does not allow for the wind, so its shots drift.
 */
function steerPirate(state: SeaBattleState, index: number): void {
  const pirate = state.ships[index];
  const player = state.ships[0];
  if (pirate === undefined || player === undefined || !pirate.alive) return;
  const dx = player.x - pirate.x;
  const dz = player.z - pirate.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance <= 0) return;
  const fx = seaCosine(pirate.heading);
  const fz = seaSine(pirate.heading);
  const cross = fx * dz - fz * dx;
  const dot = fx * dx + fz * dz;
  let wantX = dx / distance;
  let wantZ = dz / distance;
  const ramming = player.alive && player.speed < player.spec.speed * 0.2 && distance < 70;
  if (distance > 110) {
    pirate.sail = 2;
  } else if (ramming) {
    pirate.sail = 2;
    if (distance < 35 && dot / distance > 0.95) row(pirate);
  } else {
    pirate.sail = 1;
    // Keep the player on this side: turn a quarter away from it, less when too far, more when too close.
    const inward = distance > 70 ? 280 : distance < 40 ? -280 : 0;
    const turn = cross > 0 ? -(QUARTER - inward) : QUARTER - inward;
    const c = seaCosine(turn);
    const sn = seaSine(turn);
    const rx = wantX * c - wantZ * sn;
    const rz = wantX * sn + wantZ * c;
    wantX = rx;
    wantZ = rz;
  }
  const steer = fx * wantZ - fz * wantX;
  const ahead = fx * wantX + fz * wantZ;
  pirate.rudder = ahead > 0.995 ? 0 : steer > 0 ? 1 : steer < 0 ? -1 : 1;
  if (!player.alive) return;

  // Aim: lead the player by the ball's time in the air, then lay the side it is on.
  const side: SeaBattleSide = cross > 0 ? "STARBOARD" : "PORT";
  if (side === "PORT" ? pirate.reloadPort > 0 : pirate.reloadStarboard > 0) return;
  const guess = clamp(distance, SEA_BATTLE_MIN_RANGE, SEA_BATTLE_MAX_RANGE);
  const flight = (2 * Math.sqrt((guess * GRAVITY) / (2 * ELEVATION_SIN * ELEVATION_COS)) * ELEVATION_SIN) / GRAVITY;
  const leadX = dx + seaCosine(player.heading) * player.speed * flight;
  const leadZ = dz + seaSine(player.heading) * player.speed * flight;
  const lead = Math.sqrt(leadX * leadX + leadZ * leadZ);
  if (lead < SEA_BATTLE_MIN_RANGE * 0.8 || lead > SEA_BATTLE_MAX_RANGE) return;
  // The lead's bearing off the beam, from its sine against the beam's own direction.
  const beam = sideHeading(pirate, side);
  const bx = seaCosine(beam);
  const bz = seaSine(beam);
  const along = (bx * leadX + bz * leadZ) / lead;
  const off = (bx * leadZ - bz * leadX) / lead;
  if (along < 0.82) return;
  // Small angles: the heading units off the beam are close to the sine times a turn over 2 pi.
  const aim = Math.floor(off * (SEA_BATTLE_TURN_UNITS / (2 * 3.141592653589793)));
  if (aim < -SEA_BATTLE_AIM_LIMIT || aim > SEA_BATTLE_AIM_LIMIT) return;
  const power = (lead - SEA_BATTLE_MIN_RANGE) / (SEA_BATTLE_MAX_RANGE - SEA_BATTLE_MIN_RANGE);
  fire(state, index, side, aim, power);
}

function applyPlayerAction(state: SeaBattleState, action: SeaBattleAction, aim: number | undefined): void {
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
    case "CHARGE_PORT":
      startCharge(state, player, "PORT");
      break;
    case "CHARGE_STARBOARD":
      startCharge(state, player, "STARBOARD");
      break;
    case "FIRE_PORT":
      fire(state, 0, "PORT", clampAim(aim), broadsidePower(player, "PORT", state.tick));
      break;
    case "FIRE_STARBOARD":
      fire(state, 0, "STARBOARD", clampAim(aim), broadsidePower(player, "STARBOARD", state.tick));
      break;
    case "OARS":
      row(player);
      break;
  }
}

/** A ship's weight in a collision, from its hull: a frigate rams harder than a sloop. */
function heft(ship: SeaBattleShip): number {
  return clamp(ship.spec.hullMax / 150, 0.6, 2.5);
}

function hurt(state: SeaBattleState, index: number, damage: number, by: number): void {
  const ship = state.ships[index];
  if (ship === undefined || !ship.alive || damage <= 0) return;
  const dealt = Math.min(damage, ship.hull);
  ship.hull -= dealt;
  if (ship.hull <= 0) ship.alive = false;
  if (index === 0) state.stats.damageTaken += dealt;
  else if (by === 0) state.stats.damageDealt += dealt;
}

/**
 * Ships that touch are pushed apart. A blow lands when they meet fast enough: each ship deals its own
 * closing speed, times its weight, to the other, and takes a share of what it deals. Driving into a
 * ship that is not driving back is all give; a head-on meeting hurts both alike. Pirates never hurt
 * one another.
 */
function collide(state: SeaBattleState): void {
  for (let i = 0; i < state.ships.length; i += 1) {
    for (let j = i + 1; j < state.ships.length; j += 1) {
      const a = state.ships[i];
      const b = state.ships[j];
      if (a === undefined || b === undefined || !a.alive || !b.alive) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const reach = (a.spec.radius + b.spec.radius) * RAM_REACH;
      const squared = dx * dx + dz * dz;
      if (squared >= reach * reach) continue;
      const distance = Math.sqrt(squared);
      const nx = distance > 0 ? dx / distance : 1;
      const nz = distance > 0 ? dz / distance : 0;
      // How fast each drives into the other along the line between them.
      const aInto = Math.max(0, (seaCosine(a.heading) * nx + seaSine(a.heading) * nz) * a.speed);
      const bInto = Math.max(0, -(seaCosine(b.heading) * nx + seaSine(b.heading) * nz) * b.speed);
      const friendly = i !== 0 && j !== 0;
      if (!friendly && a.ramRest === 0 && b.ramRest === 0 && aInto + bInto > RAM_SPEED_MIN) {
        const toB = aInto * RAM_DAMAGE_PER_SPEED * heft(a);
        const toA = bInto * RAM_DAMAGE_PER_SPEED * heft(b);
        hurt(state, j, Math.round(toB + toA * RAM_SELF_SHARE), i);
        hurt(state, i, Math.round(toA + toB * RAM_SELF_SHARE), j);
        a.speed *= 0.4;
        b.speed *= 0.4;
        a.ramRest = RAM_REST_TICKS;
        b.ramRest = RAM_REST_TICKS;
        state.rams.push({ x: a.x + dx / 2, z: a.z + dz / 2, a: i, b: j });
      }
      // Apart again, half each way.
      const push = (reach - distance) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

/**
 * Advances the fight one tick, with the player's inputs for this tick (in the order they were given).
 * Does nothing once the fight has an outcome.
 */
export function stepSeaBattle(state: SeaBattleState, actions: readonly (SeaBattleAction | { readonly action: SeaBattleAction; readonly aim?: number })[]): void {
  if (state.outcome !== null) return;
  state.impacts = [];
  state.rams = [];
  for (const entry of actions) {
    if (typeof entry === "string") applyPlayerAction(state, entry, undefined);
    else applyPlayerAction(state, entry.action, entry.aim);
  }
  for (let index = 1; index < state.ships.length; index += 1) steerPirate(state, index);

  for (const ship of state.ships) {
    if (!ship.alive) continue;
    let target: number;
    let rate = ACCELERATION;
    if (ship.oars > 0) {
      target = ship.spec.speed * OAR_SPEED;
      rate = ACCELERATION * 2;
      ship.oars -= 1;
      if (ship.oars === 0) ship.oarRest = SEA_BATTLE_OAR_REST_TICKS;
    } else {
      // The wind helps a ship running before it, and slows one beating into it, a little.
      const along = (seaCosine(ship.heading) * state.wind.x + seaSine(ship.heading) * state.wind.z) / WIND_MAX;
      target = ship.spec.speed * (ship.sail === 0 ? 0 : ship.sail === 1 ? 0.5 : 1) * (1 + along * WIND_SAIL_SHARE);
      if (ship.oarRest > 0) ship.oarRest -= 1;
    }
    ship.speed += (target - ship.speed) * rate * DT * 4;
    ship.heading = normaliseHeading(ship.heading + ship.rudder * ship.spec.turn);
    ship.x += seaCosine(ship.heading) * ship.speed * DT;
    ship.z += seaSine(ship.heading) * ship.speed * DT;
    if (ship.reloadPort > 0) ship.reloadPort -= 1;
    if (ship.reloadStarboard > 0) ship.reloadStarboard -= 1;
    if (ship.ramRest > 0) ship.ramRest -= 1;
  }
  collide(state);

  const flying: SeaBattleBall[] = [];
  for (const ball of state.balls) {
    fly(ball, state.wind);
    let landed = false;
    if (ball.y <= HULL_HEIGHT) {
      // A player's ball can hit any pirate; a pirate's ball hits only the player.
      for (let index = 0; index < state.ships.length && !landed; index += 1) {
        const ship = state.ships[index];
        if (ship === undefined || !ship.alive || index === ball.owner || (ball.owner !== 0 && index !== 0)) continue;
        const dx = ball.x - ship.x;
        const dz = ball.z - ship.z;
        if (dx * dx + dz * dz > ship.spec.radius * ship.spec.radius) continue;
        landed = true;
        if (ball.owner === 0) state.stats.hits += 1;
        hurt(state, index, BALL_DAMAGE, ball.owner);
        state.impacts.push({ x: ball.x, z: ball.z, ship: index });
      }
    }
    if (!landed && (ball.y <= 0 || ball.ticks >= BALL_MAX_TICKS)) {
      landed = true;
      state.impacts.push({ x: ball.x, z: ball.z, ship: -1 });
    }
    if (!landed) flying.push(ball);
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
    if (input.aim !== undefined) {
      const firing = input.action === "FIRE_PORT" || input.action === "FIRE_STARBOARD";
      if (!firing || !Number.isInteger(input.aim) || input.aim < -SEA_BATTLE_AIM_LIMIT || input.aim > SEA_BATTLE_AIM_LIMIT) {
        throw new DomainError("INVALID_SEA_BATTLE", "A broadside's aim is a whole number inside its arc");
      }
    }
    last = input.tick;
  }
}

/** Plays a whole fight from its setup and the player's inputs: what the server does to decide it. */
export function runSeaBattle(setup: SeaBattleSetup, inputs: readonly SeaBattleInput[]): SeaBattleResult {
  assertSeaBattleInputs(inputs);
  const state = createSeaBattle(setup);
  let next = 0;
  while (state.outcome === null) {
    const actions: { action: SeaBattleAction; aim?: number }[] = [];
    while (next < inputs.length && inputs[next]?.tick === state.tick) {
      const input = inputs[next];
      if (input !== undefined) actions.push(input.aim === undefined ? { action: input.action } : { action: input.action, aim: input.aim });
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
