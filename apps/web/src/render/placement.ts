import { islandRadiusAt, type IslandShape } from "./terrain-height";
import { worldToTile, type WorldFrame } from "./layout";

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
  /** Tiles a road runs through, so nothing stands in a road. */
  readonly roadTiles: ReadonlySet<string>;
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

/** How much room a placement keeps from a road, in world metres. */
const ROAD_CLEARANCE_WORLD = 1.7;

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
 * Whether a world position falls on a road's tile or one within `clearance` of it.
 *
 * The road set is built from the road network's own samples, so a road that moves moves its
 * no-build zone with it. A neighbourhood lookup rather than a distance query keeps the cost of
 * validating thousands of candidates at build time negligible.
 */
function nearRoad(worldX: number, worldZ: number, clearanceWorld: number, world: PlacementWorld): boolean {
  const tile = worldToTile({ worldX, worldZ }, world.frame);
  const step = Math.max(1, Math.ceil(clearanceWorld / world.frame.pitch));
  for (let dy = -step; dy <= step; dy += 1) {
    for (let dx = -step; dx <= step; dx += 1) {
      if (world.roadTiles.has(`${String(tile.x + dx)},${String(tile.y + dy)}`)) return true;
    }
  }
  return false;
}
