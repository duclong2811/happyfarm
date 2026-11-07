import { DomainError } from "./errors";
import type { TileCoordinate } from "./tile";

/**
 * Where an Auto-driven actor is, and how long it takes to get anywhere else.
 *
 * Pure by design: the server records one anchor per actor (the place the last walk finished at) and,
 * while a walk is under way, the place it is heading to and the time it arrives. That is enough to
 * refuse a distant action that claims to be somewhere it cannot be, without storing a per-frame
 * position, a path, a waypoint or an event log.
 *
 * Location is **eligibility**, never permission: standing at the Warehouse does not authorize a load
 * on its own - ownership and the settlement's own guards still decide everything economic.
 */

export const AUTO_ANCHOR_KINDS = ["WAREHOUSE", "MARKET", "CELL"] as const;
export type AutoAnchorKind = (typeof AUTO_ANCHOR_KINDS)[number];

/** One place an actor can be: a named building, or a tile it is standing on. */
export interface AutoAnchor {
  readonly kind: AutoAnchorKind;
  readonly x: number | null;
  readonly y: number | null;
}

export const WAREHOUSE_ANCHOR: AutoAnchor = { kind: "WAREHOUSE", x: null, y: null };
export const MARKET_ANCHOR: AutoAnchor = { kind: "MARKET", x: null, y: null };

/**
 * One actor's Auto position, as the server records it.
 *
 * `anchor` is where the last walk finished. `travelTo` and `arrivesAt` are set together while a walk
 * is under way, and cleared together when it ends - so "am I there yet?" is one comparison and never
 * a guess. `version` is the optimistic guard for the two writers that can race on one actor.
 */
export interface AutoTravelState {
  readonly anchor: AutoAnchor | null;
  readonly travelTo: AutoAnchor | null;
  readonly arrivesAt: string | null;
  readonly version: number;
  /** The authoritative simulation timeline has been reconciled through this server timestamp. */
  readonly simulationAt?: string | null;
  /** A finite Main Character Auto lease; NULL is legacy compatibility for pre-lease rows. */
  readonly leaseUntil?: string | null;
  /** Server time at which the current lease was issued or renewed. */
  readonly leaseIssuedAt?: string | null;
}

/** An actor that has never run Auto: position unknown, no walk in progress. */
export const NO_AUTO_TRAVEL: AutoTravelState = {
  anchor: null,
  travelTo: null,
  arrivesAt: null,
  version: 0,
  simulationAt: null,
  leaseUntil: null,
  leaseIssuedAt: null
};

/** Where the actor will be if the walk in progress completes, or where it already is. */
export function settledAnchor(state: AutoTravelState): AutoAnchor | null {
  return state.travelTo ?? state.anchor;
}

export function cellAnchor(x: number, y: number): AutoAnchor {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new DomainError("INVALID_ANCHOR", "A cell anchor needs integer tile coordinates");
  }
  return { kind: "CELL", x, y };
}

export function parseAutoAnchorKind(value: string): AutoAnchorKind {
  if (!(AUTO_ANCHOR_KINDS as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_ANCHOR", "Anchor kind is not recognised");
  }
  return value as AutoAnchorKind;
}

/** Whether two anchors name the same place. An unknown anchor matches nothing. */
export function anchorsMatch(left: AutoAnchor | null, right: AutoAnchor): boolean {
  if (left === null) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind !== "CELL") return true;
  return left.x === right.x && left.y === right.y;
}

/** Where the island's two named anchors are, as tiles the geography owns. */
export interface AutoAnchorTiles {
  readonly warehouse: TileCoordinate;
  readonly market: TileCoordinate;
}

/** The tile an anchor names, or null when the anchor is unknown. */
export function anchorTile(anchor: AutoAnchor | null, tiles: AutoAnchorTiles): TileCoordinate | null {
  if (anchor === null) return null;
  if (anchor.kind === "WAREHOUSE") return tiles.warehouse;
  if (anchor.kind === "MARKET") return tiles.market;
  return anchor.x === null || anchor.y === null ? null : { x: anchor.x, y: anchor.y };
}

/**
 * The shortest and longest a single walk may take.
 *
 * The floor is what makes the work cadence bounded: an actor may not plant two cells in the same
 * instant, so a field is worked at a human pace that the *server* enforces rather than one the client
 * is trusted to keep. The ceiling keeps one absurd journey from parking an actor for an hour.
 */
export const MIN_AUTO_TRAVEL_SECONDS = 0.4;
export const MAX_AUTO_TRAVEL_SECONDS = 180;

/** How long a walk of `distanceWorld` takes at `speedWorldPerSecond`, clamped to the bounds above. */
export function travelSecondsForDistance(distanceWorld: number, speedWorldPerSecond: number): number {
  if (!Number.isFinite(distanceWorld) || distanceWorld < 0) return MIN_AUTO_TRAVEL_SECONDS;
  if (!Number.isFinite(speedWorldPerSecond) || speedWorldPerSecond <= 0) {
    throw new DomainError("INVALID_ANCHOR", "A walk needs a positive speed");
  }
  const seconds = distanceWorld / speedWorldPerSecond;
  return Math.min(MAX_AUTO_TRAVEL_SECONDS, Math.max(MIN_AUTO_TRAVEL_SECONDS, seconds));
}

/**
 * How long it takes to walk from one anchor to another.
 *
 * The world distance between two tiles is the tile pitch times the tile distance, which is the same
 * arithmetic the renderer's `tileToWorld` does - the frame's origin cancels out of a difference, so
 * the server needs only the pitch. An unknown origin anchor (a save that has never run Auto) is read
 * as the Warehouse: the one place every actor can certainly reach.
 */
export function travelSeconds(
  from: AutoAnchor | null,
  to: AutoAnchor,
  tiles: AutoAnchorTiles,
  pitchWorld: number,
  speedWorldPerSecond: number
): number {
  const origin = from ?? WAREHOUSE_ANCHOR;
  const fromTile = anchorTile(origin, tiles);
  const toTile = anchorTile(to, tiles);
  if (fromTile === null || toTile === null) return MIN_AUTO_TRAVEL_SECONDS;
  if (!Number.isFinite(pitchWorld) || pitchWorld <= 0) {
    throw new DomainError("INVALID_ANCHOR", "A walk needs a positive tile pitch");
  }
  if (fromTile.x === toTile.x && fromTile.y === toTile.y) return MIN_AUTO_TRAVEL_SECONDS;
  const distance = Math.hypot(toTile.x - fromTile.x, toTile.y - fromTile.y) * pitchWorld;
  return travelSecondsForDistance(distance, speedWorldPerSecond);
}

/**
 * Whether a walked-to anchor may settle its action yet.
 *
 * The one rule that makes "the client says it arrived" meaningless: the server compares the walk's own
 * recorded arrival time against the server's clock.
 */
export function travelHasArrived(arrivesAt: string, serverTime: string): boolean {
  const arrival = Date.parse(arrivesAt);
  const now = Date.parse(serverTime);
  if (!Number.isFinite(arrival) || !Number.isFinite(now)) return false;
  return now >= arrival;
}
