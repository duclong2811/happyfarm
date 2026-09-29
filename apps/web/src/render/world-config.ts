import type { TileBounds, TileCoordinate } from "./layout";
import { tileToWorld, WORLD_ORIGIN_TILE_X, worldFrame } from "./layout";

/**
 * The static farm world.
 *
 * Everything here is presentation: where the island ends, which zones are reserved for features that
 * do not exist yet, where a character would spawn, and what is walkable. None of it is authoritative
 * and none of it is stored: land ownership stays in `farm_tiles`, prices and level requirements stay
 * in the plot catalogue, and crop/tree occupancy stays in their instance rows. The farm grid is not
 * duplicated here; `FARM_FIELD_BOUNDS` is only the reservation the layout must not overlap, and a test
 * pins it to the shipped plot catalogue so a future catalogue cannot silently outgrow it.
 *
 * Coordinates are tile coordinates, so this file speaks the same language as the server, and the
 * fixed frame in `layout.ts` is the only place that turns them into world metres.
 */

export const WORLD_CONFIG_VERSION = 1;

/**
 * The land the shipped plot catalogue can hand out: 8 plots of 6x6 make an 18x18 field at [0,17]^2.
 *
 * This is a *reservation* used to keep static zones out of the way, not a gameplay bound. A test
 * mirrors it against `packages/domain/src/plot.ts` plus the game-data catalogue, so a catalogue that
 * grew past it would fail loudly instead of silently clipping future land or overlapping a zone.
 */
export const FARM_FIELD_BOUNDS: TileBounds = { minX: 0, maxX: 17, minY: 0, maxY: 17 };

/** The island, including every reserved zone and its margin. Fixed: it does not grow with the farm. */
export const VISUAL_BOUNDS: TileBounds = { minX: -13, maxX: 30, minY: -13, maxY: 30 };

export type RegionKind = "ORCHARD" | "RANCH" | "POND" | "FARMHOUSE";

/**
 * A reserved area: space kept for a feature that is not implemented yet.
 *
 * These are visual reservations only. `ORCHARD` does not make trees tree-only, does not unlock
 * anything, and does not own anything: a tree is still planted on any soil tile the player owns.
 */
export interface WorldRegion {
  readonly id: string;
  readonly kind: RegionKind;
  readonly bounds: TileBounds;
  /** The marker's own text key, kept short so it reads as scenery rather than as a control. */
  readonly labelKey: string;
}

export const WORLD_REGIONS: readonly WorldRegion[] = [
  { id: "orchard", kind: "ORCHARD", bounds: { minX: -6, maxX: 18, minY: -12, maxY: -2 }, labelKey: "world.region.orchard" },
  { id: "ranch", kind: "RANCH", bounds: { minX: -12, maxX: -2, minY: -2, maxY: 18 }, labelKey: "world.region.ranch" },
  { id: "pond", kind: "POND", bounds: { minX: 19, maxX: 29, minY: 2, maxY: 12 }, labelKey: "world.region.pond" },
  { id: "farmhouse", kind: "FARMHOUSE", bounds: { minX: 19, maxX: 29, minY: -10, maxY: 0 }, labelKey: "world.region.farmhouse" }
];

/** The fence around the field, and the gaps in it. All in tile coordinates, all fixed. */
export interface FenceSpec {
  readonly bounds: TileBounds;
  /** Axis-aligned gaps: the south gate leads to the spawn, the two side gates to the reserves. */
  readonly gates: readonly { readonly side: "SOUTH" | "WEST" | "EAST"; readonly from: number; readonly to: number }[];
}

export const FENCE: FenceSpec = {
  bounds: { minX: -1.5, maxX: 18.5, minY: -1.5, maxY: 18.5 },
  gates: [
    { side: "SOUTH", from: 1.3, to: 3.7 },
    { side: "WEST", from: 6.5, to: 9 },
    { side: "EAST", from: 6.5, to: 9 }
  ]
};

/** An axis-aligned strip of ground. Paths are visual and a walkability hint; there is no pathfinding. */
export interface PathStrip {
  readonly id: string;
  readonly bounds: TileBounds;
}

export const PATHS: readonly PathStrip[] = [
  // The main path: south gate → spawn → island edge.
  { id: "south", bounds: { minX: 1.3, maxX: 3.7, minY: 18.5, maxY: 26.5 } },
  // Branch to the orchard reserve.
  { id: "orchard", bounds: { minX: 1.3, maxX: 18, minY: -2, maxY: -0.4 } },
  // Branch through the west gate to the ranch reserve.
  { id: "ranch", bounds: { minX: -4.5, maxX: -1.5, minY: 7, maxY: 9 } },
  // Branch through the east gate to the pond and the farmhouse yard.
  { id: "pond", bounds: { minX: 18.5, maxX: 24.5, minY: 7, maxY: 9 } },
  { id: "farmhouse", bounds: { minX: 18.5, maxX: 22, minY: -4.5, maxY: -2.5 } }
];

/** The pond, in tile coordinates. Water is visual and non-walkable; there is no fishing yet. */
export const POND = {
  center: { x: 24, y: 7 },
  radiusX: 3.6,
  radiusY: 3
} as const;

/** The farmhouse/barn yard, a static building placeholder. */
export const FARMHOUSE = {
  center: { x: 23, y: -5.5 },
  rotationY: Math.PI * 0.75
} as const;

/**
 * Where a character would appear in Phase 8: on the main path, south of the fence and outside every
 * tile the farm can own, so it never starts inside a crop, a tree, a marker, or water.
 */
export const SPAWN_TILE: TileCoordinate = { x: WORLD_ORIGIN_TILE_X, y: 24 };

export interface WorldObstacle {
  readonly id: string;
  /** A circle in world metres: the only shape Phase 8 needs for static collision today. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly radiusWorld: number;
}

const frame = worldFrame();

function toWorld(tile: TileCoordinate): { readonly worldX: number; readonly worldZ: number } {
  return tileToWorld(tile, frame);
}

export const SPAWN_WORLD = toWorld(SPAWN_TILE);
export const POND_WORLD = { ...toWorld(POND.center), radiusWorldX: POND.radiusX * frame.pitch, radiusWorldZ: POND.radiusY * frame.pitch };
export const FARMHOUSE_WORLD = toWorld(FARMHOUSE.center);

/**
 * Static obstacles a character must walk around.
 *
 * Deliberately a short list of circles: the barn, the pond, and one per region marker. Crops and
 * trees are *not* here - they are authoritative runtime state, and Phase 8 will read them from
 * `crop_instances`/`tree_instances` the same way the renderer does today.
 */
export const STATIC_OBSTACLES: readonly WorldObstacle[] = [
  { id: "farmhouse", centerWorldX: FARMHOUSE_WORLD.worldX, centerWorldZ: FARMHOUSE_WORLD.worldZ, radiusWorld: 2.2 },
  { id: "pond", centerWorldX: POND_WORLD.worldX, centerWorldZ: POND_WORLD.worldZ, radiusWorld: Math.max(POND_WORLD.radiusWorldX, POND_WORLD.radiusWorldZ) }
];

/** The island in world metres, from the fixed visual bounds. */
export const ISLAND_HALF_WIDTH_WORLD = ((VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2) * frame.pitch;
export const ISLAND_HALF_DEPTH_WORLD = ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2) * frame.pitch;

/** World position of the visual bounds' centre: what a camera frames, never a coordinate origin. */
export const WORLD_CENTER_WORLD = toWorld({
  x: (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2,
  y: (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2
});

function inside(bounds: TileBounds, tile: TileCoordinate): boolean {
  return tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY;
}

/** Whether a tile holds the pond's water. */
export function isWaterTile(tile: TileCoordinate): boolean {
  const dx = (tile.x - POND.center.x) / POND.radiusX;
  const dy = (tile.y - POND.center.y) / POND.radiusY;
  return dx * dx + dy * dy <= 1;
}

/** Whether a tile holds a static obstacle the future character must walk around. */
export function isStaticObstacleTile(tile: TileCoordinate): boolean {
  return STATIC_OBSTACLES.some((obstacle) => {
    const world = toWorld(tile);
    const dx = world.worldX - obstacle.centerWorldX;
    const dz = world.worldZ - obstacle.centerWorldZ;
    return dx * dx + dz * dz <= obstacle.radiusWorld * obstacle.radiusWorld;
  });
}

/**
 * Whether a point is on walkable ground.
 *
 * Grass, sand, and paths are walkable; water and anything outside the island is not; a static obstacle
 * is not. Crop and tree occupancy is deliberately *not* consulted here: that is authoritative runtime
 * state, and Phase 8 will combine this static answer with the farm's own rows.
 */
export function isStaticWorldWalkable(tile: TileCoordinate): boolean {
  if (!inside(VISUAL_BOUNDS, tile)) return false;
  if (isWaterTile(tile)) return false;
  if (isStaticObstacleTile(tile)) return false;
  return true;
}

/** The walkable tile bounds, for a future movement clamp. */
export const WALKABLE_BOUNDS: TileBounds = VISUAL_BOUNDS;

/** Every gameplay-relevant number the static world exposes, for tests and Phase 8. */
export const WORLD_CONFIG = {
  version: WORLD_CONFIG_VERSION,
  frame,
  visualBounds: VISUAL_BOUNDS,
  farmFieldBounds: FARM_FIELD_BOUNDS,
  regions: WORLD_REGIONS,
  fence: FENCE,
  paths: PATHS,
  pond: POND,
  farmhouse: FARMHOUSE,
  spawnTile: SPAWN_TILE,
  spawnWorld: SPAWN_WORLD,
  staticObstacles: STATIC_OBSTACLES
} as const;
