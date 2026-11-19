/**
 * The helm (docs/design/NAVAL.md, "Taking the helm"): the player's own ship sailed by hand round the
 * home island's waters.
 *
 * Pure presentation. Nothing here is a request: the ship leaves the pier only on the player's screen,
 * the server still has it moored at home, and every real voyage is still the chart's timed one. That
 * is why the helm may live entirely in the browser - it decides nothing anyone else sees or is paid.
 *
 * Positions are in island tiles (x east, y south, fractions allowed) and the heading is the angle in
 * that plane from +x toward +y, so a heading that grows turns the bow to starboard as seen from
 * behind. The pier's direction uses the same convention, which is how the ship leaves it bow first.
 */

export type HelmSail = 0 | 1 | 2;
export type HelmRudder = -1 | 0 | 1;
/** Why the ship last stopped short: nothing, the shore (or the pier), or the edge of home waters. */
export type HelmBlock = "NONE" | "LAND" | "EDGE";

export interface HelmShip {
  /** Tiles per second at full sail. */
  readonly maxSpeed: number;
  /** Radians per second with the rudder hard over and way on. */
  readonly turnRate: number;
  /** The hull's length, in tiles. */
  readonly lengthTiles: number;
}

export interface HelmState {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** Tiles per second, never negative: a ship under sail does not sail backwards. */
  readonly speed: number;
  readonly sail: HelmSail;
  readonly rudder: HelmRudder;
  /** Seconds of the oars' sprint left, or 0. */
  readonly oars: number;
  /** Seconds before the crew can row again, or 0. */
  readonly oarRest: number;
  /** Where the camera looks: the heading, eased, so a turn swings the view rather than snapping it. */
  readonly viewHeading: number;
  /** The heel, in radians: the hull leans out of a turn, more the faster it goes. */
  readonly heel: number;
  readonly blocked: HelmBlock;
}

/** The waters the helm may sail: which points are open water, and the circle of home waters. */
export interface HelmWaters {
  isWater(x: number, y: number): boolean;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
}

export type HelmOrder = "SAIL_UP" | "SAIL_DOWN" | "OARS";

/** The share of top speed each sail setting gives. */
export const HELM_SAIL_SHARE: readonly [number, number, number] = [0, 0.55, 1];
/** The oars' sprint: how long, how much faster, and the rest the crew needs after it. */
export const HELM_OARS_SECONDS = 4;
export const HELM_OARS_BOOST = 1.6;
export const HELM_OAR_REST_SECONDS = 10;
/** How quickly the ship gathers and loses way, as shares of top speed per second. */
const ACCELERATION_SHARE = 0.35;
const DECELERATION_SHARE = 0.5;
/** The rudder still bites a little with no way on, so a ship nosed into the shore can turn away. */
const STEERAGE_AT_REST = 0.3;
/** How quickly the view catches the heading, per second. */
const VIEW_EASE = 2.2;
const MAX_HEEL = 0.07;
/**
 * How far past the island grid's half-width home waters reach, in tiles. The horizon's nearest
 * neighbour stands about 2.35 half-widths out (horizon-islands.ts), so this stops well short of it.
 */
export const HELM_HOME_WATERS_REACH = 20;
/** The longest step taken at once; a frame after a stall is cut into steps no longer than this. */
const MAX_STEP_SECONDS = 0.05;
/** A long pause (a background tab) is not sailed through at all. */
const MAX_FRAME_SECONDS = 0.5;

/** Speeds and handling by ship tier: the bigger the hull, the faster on a reach and the slower to turn. */
const HANDLING_BY_TIER: readonly { readonly maxSpeed: number; readonly turnRate: number }[] = [
  { maxSpeed: 3.5, turnRate: 1.3 },
  { maxSpeed: 4.5, turnRate: 1.0 },
  { maxSpeed: 5.2, turnRate: 0.8 },
  { maxSpeed: 6, turnRate: 0.65 }
];

export function helmShipForTier(tier: number, lengthTiles: number): HelmShip {
  const index = Math.min(HANDLING_BY_TIER.length, Math.max(1, Math.floor(tier))) - 1;
  const handling = HANDLING_BY_TIER[index] ?? { maxSpeed: 3.5, turnRate: 1.3 };
  return { ...handling, lengthTiles };
}

/** The ship as it lies at the pier: stopped, sails struck, looking where it points. */
export function startHelm(at: { readonly x: number; readonly y: number; readonly heading: number }): HelmState {
  return { x: at.x, y: at.y, heading: at.heading, speed: 0, sail: 0, rudder: 0, oars: 0, oarRest: 0, viewHeading: at.heading, heel: 0, blocked: "NONE" };
}

/** Sails up or down a step, or the oars - which only answer when the crew is rested. */
export function giveHelmOrder(state: HelmState, order: HelmOrder): HelmState {
  switch (order) {
    case "SAIL_UP":
      return state.sail === 2 ? state : { ...state, sail: (state.sail + 1) as HelmSail };
    case "SAIL_DOWN":
      return state.sail === 0 ? state : { ...state, sail: (state.sail - 1) as HelmSail };
    case "OARS":
      return state.oars > 0 || state.oarRest > 0 ? state : { ...state, oars: HELM_OARS_SECONDS };
  }
}

export function setHelmRudder(state: HelmState, rudder: HelmRudder): HelmState {
  return state.rudder === rudder ? state : { ...state, rudder };
}

/** The speed the ship is making for: the sails' share of top speed, and the oars' sprint on top. */
export function helmTargetSpeed(state: HelmState, ship: HelmShip): number {
  const sailed = ship.maxSpeed * HELM_SAIL_SHARE[state.sail];
  // Rowing alone still moves a ship with its sails struck; rowing under sail adds to the wind.
  return state.oars > 0 ? Math.max(sailed, ship.maxSpeed * 0.6) * HELM_OARS_BOOST : sailed;
}

/** The smallest signed turn from `from` to `to`, in (-pi, pi]. */
export function angleBetween(from: number, to: number): number {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/** Whether the whole hull - bow, middle and stern - would lie in open water and inside home waters. */
function hullFits(x: number, y: number, heading: number, ship: HelmShip, waters: HelmWaters): HelmBlock {
  const half = ship.lengthTiles * 0.45;
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const points: readonly (readonly [number, number])[] = [
    [x, y],
    [x + fx * half, y + fy * half],
    [x - fx * half, y - fy * half]
  ];
  for (const [px, py] of points) {
    if (Math.hypot(px - waters.centerX, py - waters.centerY) > waters.radius) return "EDGE";
  }
  for (const [px, py] of points) {
    if (!waters.isWater(px, py)) return "LAND";
  }
  return "NONE";
}

function bowInWater(x: number, y: number, heading: number, ship: HelmShip, waters: HelmWaters): boolean {
  const half = ship.lengthTiles * 0.45;
  return waters.isWater(x + Math.cos(heading) * half, y + Math.sin(heading) * half) && waters.isWater(x, y);
}

function step(state: HelmState, ship: HelmShip, waters: HelmWaters, dt: number): HelmState {
  let oars = state.oars;
  let oarRest = state.oarRest;
  if (oars > 0) {
    oars = Math.max(0, oars - dt);
    if (oars === 0) oarRest = HELM_OAR_REST_SECONDS;
  } else {
    oarRest = Math.max(0, oarRest - dt);
  }
  const rowing = { ...state, oars };
  const target = helmTargetSpeed(rowing, ship);
  let speed = state.speed;
  if (speed < target) speed = Math.min(target, speed + ship.maxSpeed * ACCELERATION_SHARE * dt * (oars > 0 ? 2 : 1));
  else if (speed > target) speed = Math.max(target, speed - ship.maxSpeed * DECELERATION_SHARE * dt);

  // The rudder bites with way on; at rest it still swings the bow a little. A turn that would put the
  // bow or stern ashore is refused, so a ship pressed against the shore can only turn away from it.
  const way = Math.min(1, speed / (ship.maxSpeed * 0.5));
  const steerage = STEERAGE_AT_REST + (1 - STEERAGE_AT_REST) * way;
  let heading = state.heading;
  if (state.rudder !== 0) {
    const turned = heading + state.rudder * ship.turnRate * steerage * dt;
    if (hullFits(state.x, state.y, turned, ship, waters) === "NONE" || hullFits(state.x, state.y, heading, ship, waters) !== "NONE") heading = turned;
  }

  let x = state.x;
  let y = state.y;
  let blocked = state.blocked;
  if (speed > 0) {
    const nextX = x + Math.cos(heading) * speed * dt;
    const nextY = y + Math.sin(heading) * speed * dt;
    const fits = hullFits(nextX, nextY, heading, ship, waters);
    // A hull that does not fit where it already is (a big ship moored close in, its stern over the
    // sand) may still move, as long as its bow goes into open water: that is how it leaves the pier.
    const unmooring = fits === "LAND" && hullFits(x, y, heading, ship, waters) === "LAND" && bowInWater(nextX, nextY, heading, ship, waters);
    if (fits === "NONE" || unmooring) {
      x = nextX;
      y = nextY;
      blocked = "NONE";
    } else {
      // Aground, or at the edge of home waters: the ship stops where it is. It keeps its sails, so
      // turning away is all it takes to get going again.
      speed = 0;
      blocked = fits;
    }
  }

  const heelTarget = -state.rudder * MAX_HEEL * Math.min(1, speed / ship.maxSpeed);
  const heel = state.heel + (heelTarget - state.heel) * Math.min(1, dt * 3);
  const viewHeading = state.viewHeading + angleBetween(state.viewHeading, heading) * Math.min(1, dt * VIEW_EASE);
  return { ...state, x, y, heading, speed, oars, oarRest, heel, viewHeading, blocked };
}

/**
 * Sails `seconds` of real time. Long frames are cut into short steps so a stutter cannot carry the
 * ship through a spit of land, and a pause longer than half a second is not sailed at all.
 */
export function stepHelm(state: HelmState, ship: HelmShip, waters: HelmWaters, seconds: number): HelmState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state;
  let left = Math.min(seconds, MAX_FRAME_SECONDS);
  let next = state;
  while (left > 1e-9) {
    const dt = Math.min(MAX_STEP_SECONDS, left);
    next = step(next, ship, waters, dt);
    left -= dt;
  }
  return next;
}

/** The share of the oars' cycle still to wait, for the button's shading: 1 just after rowing, 0 ready. */
export function helmOarRestShare(state: HelmState): number {
  return state.oars > 0 ? 1 : Math.max(0, Math.min(1, state.oarRest / HELM_OAR_REST_SECONDS));
}

/**
 * The home waters of a generated island: a circle round the middle of its grid, reaching `reach`
 * tiles past the grid's half-width - short of the neighbours on the horizon - and in it every sea
 * cell (open sea and the shallows; everything past the grid is open sea) except along the pier.
 */
export function islandHelmWaters(input: {
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
  /** Whether the cell at (x, y), in island tile coordinates, is sea. */
  readonly isSeaCell: (x: number, y: number) => boolean;
  /** The pier, as a segment from its root to its head, in tiles; null when the island has none. */
  readonly pier: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  /** How far past the grid's half-width home waters reach, in tiles. */
  readonly reach?: number;
  /** How close to the pier's centre line a hull may come, in tiles. */
  readonly pierClearance?: number;
}): HelmWaters {
  const reach = input.reach ?? HELM_HOME_WATERS_REACH;
  const clearance = input.pierClearance ?? 0.45;
  const pier = input.pier;
  const half = (input.size - 1) / 2;
  return {
    centerX: input.originX + half,
    centerY: input.originY + half,
    radius: half + reach,
    isWater(x, y) {
      if (!input.isSeaCell(Math.round(x), Math.round(y))) return false;
      if (pier === null) return true;
      return distanceToSegment(x, y, pier.x0, pier.y0, pier.x1, pier.y1) > clearance;
    }
  };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
