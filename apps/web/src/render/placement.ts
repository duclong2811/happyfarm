import { islandRadiusAt, type IslandShape } from "./terrain-height";
import type { WorldFrame } from "./layout";

/**
 * One door every decorative placement has to walk through.
 *
 * Before this module each placement system carried its own idea of "is this a legal spot": the
 * scenery scatter checked a bounding rectangle, the rim tree line was authored on that rectangle
 * directly, and the district blobs reached past it. The island's coastline is *inside* that
 * rectangle - the corners of the bounds are sea - so the ring between the two was water that
 * everything agreed was land, which is how trees ended up standing in the ocean.
 *
 * The fix is not a better rectangle. It is that the coastline question has exactly one answer, and
 * it comes from the same `islandRadiusAt` the terrain mesh, the beach, and the player's collision
 * world already use. Everything else here is the second question: even on land, is this the *right*
 * kind of place for this thing?
 */

/** The world facts a placement is judged against. Built once per world, from the world config. */
export interface PlacementWorld {
  /** The authoritative coastline. Rendering, collision, and this module read the same shape. */
  readonly island: IslandShape;
  /** The one tile mapping, so a world position can be asked about as a tile. */
  readonly frame: WorldFrame;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  /**
   * The road network's own centreline samples, with the half-width of the road that runs through
   * each one, so "is this on a road" is a distance to the road rather than a tile lookup that has to
   * guess how wide a tile's worth of clearance is.
   */
  readonly roads: readonly {
    readonly worldX: number;
    readonly worldZ: number;
    readonly halfWidthWorld: number;
  }[];
  /** Standing water, as ellipses in world metres. */
  readonly waterBodies: readonly {
    readonly worldX: number;
    readonly worldZ: number;
    readonly radiusWorldX: number;
    readonly radiusWorldZ: number;
  }[];
  /** Anything with its own clearing: buildings, the quay, the orchard rows' turning space. */
  readonly clearings: readonly {
    readonly worldX: number;
    readonly worldZ: number;
    readonly radiusWorld: number;
  }[];
}

/**
 * How far inland a thing has to stand, in shore units.
 *
 * A tree at the waterline is a tree with its roots in the surf; a tuft of grass at the waterline is
 * a shoreline. Big things keep a real margin, small things may come close, and nothing at all may
 * pass the shore.
 */
export type ShorelineClass = "LARGE" | "MEDIUM" | "SMALL";

const INLAND_LIMIT: Readonly<Record<ShorelineClass, number>> = {
  // 0.90 of the way to the shore: a canopy never overhangs the water.
  LARGE: 0.9,
  // 0.95: a thicket or a boulder may stand close, but not at the edge.
  MEDIUM: 0.95,
  // 0.975: grass and pebbles are what the shoreline is made of.
  SMALL: 0.975
};

/** How much room a placement keeps from the *edge* of a road, in world metres. */
const ROAD_CLEARANCE_WORLD = 1.2;

export interface PlacementRequest {
  readonly worldX: number;
  readonly worldZ: number;
  readonly shoreline: ShorelineClass;
  /** Extra clearance from roads and clearings, in world metres. */
  readonly clearanceWorld?: number;
}

export type PlacementRejection =
  | "OUTSIDE_BOUNDS"
  | "IN_THE_SEA"
  | "IN_WATER"
  | "ON_A_ROAD"
  | "IN_A_CLEARING";

/**
 * Whether a placement is legal, and why not when it is not.
 *
 * Returning the reason rather than a boolean is what makes the rule testable: a test can assert that
 * a point in the sea is refused *because it is in the sea*, not merely refused.
 */
export function placementRejection(
  request: PlacementRequest,
  world: PlacementWorld
): PlacementRejection | null {
  const { worldX, worldZ } = request;
  if (
    worldX < world.bounds.minX ||
    worldX > world.bounds.maxX ||
    worldZ < world.bounds.minY ||
    worldZ > world.bounds.maxY
  ) {
    return "OUTSIDE_BOUNDS";
  }

  // The one authoritative coastline test. Everything else is decoration policy.
  if (islandRadiusAt(worldX, worldZ, world.island) > INLAND_LIMIT[request.shoreline]) {
    return "IN_THE_SEA";
  }

  for (const body of world.waterBodies) {
    const dx = (worldX - body.worldX) / body.radiusWorldX;
    const dz = (worldZ - body.worldZ) / body.radiusWorldZ;
    if (dx * dx + dz * dz <= 1) return "IN_WATER";
  }

  const clearance = request.clearanceWorld ?? ROAD_CLEARANCE_WORLD;
  if (nearRoad(worldX, worldZ, clearance, world)) return "ON_A_ROAD";

  for (const clearing of world.clearings) {
    if (Math.hypot(worldX - clearing.worldX, worldZ - clearing.worldZ) < clearing.radiusWorld) {
      return "IN_A_CLEARING";
    }
  }

  return null;
}

/**
 * Whether a world position falls within `clearance` of a road's own edge.
 *
 * A distance rather than a tile lookup, because a road has a *width*: the primary is more than twice
 * as wide as a path, and a tile-based clearance has to round both of them to the same grid - which
 * is how a road that is 2.6 tiles across ends up clearing six tiles of ground. The cost is one
 * distance per sample per candidate, which the world build does once.
 */
function nearRoad(worldX: number, worldZ: number, clearanceWorld: number, world: PlacementWorld): boolean {
  for (const road of world.roads) {
    if (Math.hypot(worldX - road.worldX, worldZ - road.worldZ) < road.halfWidthWorld + clearanceWorld) {
      return true;
    }
  }
  return false;
}
