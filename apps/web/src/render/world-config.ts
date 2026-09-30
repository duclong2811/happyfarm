import type { TileBounds, TileCoordinate, WorldFrame } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, WORLD_ORIGIN_TILE_X, worldFrame } from "./layout";

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

export const WORLD_CONFIG_VERSION = 2;

/**
 * The land the shipped plot catalogue can hand out: 8 plots of 12x12 make a 36x36 field at [0,35]^2.
 *
 * This is a *reservation* used to keep static zones out of the way, not a gameplay bound. A test
 * mirrors it against `packages/domain/src/plot.ts` plus the game-data catalogue, so a catalogue that
 * grew past it would fail loudly instead of silently clipping future land or overlapping a zone.
 */
export const FARM_FIELD_BOUNDS: TileBounds = { minX: 0, maxX: 35, minY: 0, maxY: 35 };

/**
 * The island, including every reserved zone and its margin. Fixed: it does not grow with the farm.
 *
 * The margin is roughly a third of the island rather than half: the field is about forty per cent of
 * the land a player can see, and the rest is a ring of orchard, ranch, pond, farmhouse yard, tree
 * lines, and meadow that reads as one continuous place instead of a plot on an empty plane.
 */
export const VISUAL_BOUNDS: TileBounds = { minX: -13, maxX: 48, minY: -13, maxY: 48 };

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
  { id: "orchard", kind: "ORCHARD", bounds: { minX: -8, maxX: 38, minY: -12, maxY: -2 }, labelKey: "world.region.orchard" },
  { id: "ranch", kind: "RANCH", bounds: { minX: -12, maxX: -2, minY: -2, maxY: 38 }, labelKey: "world.region.ranch" },
  { id: "pond", kind: "POND", bounds: { minX: 38, maxX: 47, minY: 4, maxY: 14 }, labelKey: "world.region.pond" },
  { id: "farmhouse", kind: "FARMHOUSE", bounds: { minX: 38, maxX: 47, minY: -12, maxY: -2 }, labelKey: "world.region.farmhouse" }
];

/** One reserved region's bounds, by id. Regions are reservations, so a band may only be inside one. */
function regionBounds(id: WorldRegion["id"]): TileBounds {
  const region = WORLD_REGIONS.find((candidate) => candidate.id === id);
  if (region === undefined) throw new Error(`Unknown world region: ${id}`);
  return region.bounds;
}

/** A region's bounds, pulled in by `margin` tiles on every side. */
function inset(bounds: TileBounds, margin: number): TileBounds {
  return {
    minX: bounds.minX + margin,
    maxX: bounds.maxX - margin,
    minY: bounds.minY + margin,
    maxY: bounds.maxY - margin
  };
}

/**
 * A band of planted things: the tree lines that make the island read as land rather than as a
 * painted circle.
 *
 * A band is a rectangle plus a spacing, and positions are laid on that lattice with a small phase
 * offset so two bands sharing an axis do not line up into a corridor. Bands are placed from the
 * region reservations above, so the orchard always fills the orchard and the belt beside the ranch
 * always sits between the ranch and the field. Nothing here is gameplay: no band owns a tile, plants
 * a tree, or blocks a step.
 */
export interface TreeBand {
  readonly id: string;
  readonly kind: "TREE" | "PINE";
  readonly bounds: TileBounds;
  /** Tile spacing between two planted positions, along both axes. */
  readonly spacing: number;
  /** Tile phase offset, so the lattice does not start exactly on the band's corner. */
  readonly offset: number;
}

export const TREE_BANDS: readonly TreeBand[] = [
  // The orchard: rows of fruit trees, the shape the future orchard gameplay will occupy.
  { id: "orchard_rows", kind: "TREE", bounds: inset(regionBounds("orchard"), 2), spacing: 5, offset: 1 },
  // The ranch: a windbreak of pines along the pasture, deliberately sparse so the livestock area
  // this reserves stays open ground.
  { id: "ranch_windbreak", kind: "PINE", bounds: inset(regionBounds("ranch"), 3), spacing: 7, offset: 2 }
];

/** How wide the tree line inside the island's rim is, in tiles. */
export const RIM_TREE_BAND_TILES = 2;
/** Tile spacing between the rim trees that close off the island's edge. */
export const RIM_TREE_SPACING_TILES = 2.2;

/** A patch of ground with its own colour: meadow, bare earth, or shore. */
export interface MeadowPatch {
  readonly id: string;
  readonly kind: "MEADOW" | "DIRT" | "SAND";
  readonly center: TileCoordinate;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationY: number;
}

/**
 * Terrain variation, in tile coordinates, outside the field and outside every path.
 *
 * A flat island of one green reads as a background rather than as ground. These patches are drawn
 * flush with the grass and carry no gameplay: they are where a later stylized terrain pass will put
 * its own material work, and they are the reason the world does not look like a single plane today.
 */
export const MEADOWS: readonly MeadowPatch[] = [
  { id: "north_meadow", kind: "MEADOW", center: { x: 8, y: -7 }, radiusX: 9.5, radiusY: 4.2, rotationY: 0.12 },
  { id: "west_meadow", kind: "MEADOW", center: { x: -7.5, y: 24 }, radiusX: 3.6, radiusY: 11, rotationY: -0.08 },
  { id: "east_meadow", kind: "MEADOW", center: { x: 42, y: 24 }, radiusX: 4.2, radiusY: 8.5, rotationY: 0.2 },
  { id: "south_meadow", kind: "MEADOW", center: { x: 12, y: 42 }, radiusX: 10, radiusY: 3.4, rotationY: -0.15 },
  { id: "ranch_dirt", kind: "DIRT", center: { x: -7, y: 14 }, radiusX: 3.4, radiusY: 7, rotationY: 0 },
  { id: "orchard_dirt", kind: "DIRT", center: { x: 20, y: -7 }, radiusX: 12, radiusY: 3.2, rotationY: 0 },
  { id: "south_shore", kind: "SAND", center: { x: 5.5, y: 44 }, radiusX: 12, radiusY: 3, rotationY: 0 },
  { id: "pond_shore", kind: "SAND", center: { x: 43, y: 9 }, radiusX: 4.6, radiusY: 4.4, rotationY: 0 }
];

export type FenceSide = "SOUTH" | "NORTH" | "WEST" | "EAST";

/** One opening in the fence: a range of tile coordinates along its own side's axis. */
export interface FenceGate {
  readonly side: FenceSide;
  readonly from: number;
  readonly to: number;
}

/** The fence around the field, and the gaps in it. All in tile coordinates, all fixed. */
export interface FenceSpec {
  readonly bounds: TileBounds;
  /** The south gate leads to the spawn, the two side gates to the reserves. */
  readonly gates: readonly FenceGate[];
}

export const FENCE: FenceSpec = {
  bounds: { minX: -1.5, maxX: 36.5, minY: -1.5, maxY: 36.5 },
  gates: [
    { side: "SOUTH", from: 4.3, to: 6.7 },
    { side: "WEST", from: 13, to: 16 },
    { side: "EAST", from: 13, to: 16 }
  ]
};

/** How thick the fence is, as drawn and as collided with. One number for both. */
export const FENCE_THICKNESS_WORLD = 0.09;
/** Breathing room between the dirt apron and the fence line. */
const FENCE_CLEARANCE_WORLD = 0.18;

const FENCE_SIDES: readonly FenceSide[] = ["SOUTH", "EAST", "NORTH", "WEST"];

/** A built piece of the fence: an axis-aligned world rectangle with no gate in it. */
export interface FenceSegment {
  readonly id: string;
  readonly side: FenceSide;
  readonly minWorldX: number;
  readonly maxWorldX: number;
  readonly minWorldZ: number;
  readonly maxWorldZ: number;
}

/**
 * The fence as world geometry: where it stands, how big it is, and the closed segments between its
 * gates.
 *
 * This is the one derivation of `FENCE` that both the renderer and the player's collision consume,
 * so a gate that is drawn open is a gate that can be walked through and a segment that is drawn
 * solid is a segment that blocks. Neither side owns gate numbers of its own.
 */
export interface FenceGeometry {
  /** World centre of the fence rectangle: where the dirt apron is centred too. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfWidthWorld: number;
  readonly halfDepthWorld: number;
  /** Every piece that is actually built, in no particular order. */
  readonly segments: readonly FenceSegment[];
}

interface WorldSpan {
  readonly from: number;
  readonly to: number;
}

/** Cuts the open ranges out of one side's span, leaving what is built. */
function closedSpans(from: number, to: number, openings: readonly WorldSpan[]): readonly WorldSpan[] {
  const ordered = [...openings].sort((left, right) => left.from - right.from);
  const spans: WorldSpan[] = [];
  let cursor = from;
  for (const opening of ordered) {
    if (opening.from > cursor) spans.push({ from: cursor, to: Math.min(opening.from, to) });
    cursor = Math.max(cursor, opening.to);
  }
  if (cursor < to) spans.push({ from: cursor, to });
  return spans;
}

/** Where a gate sits in world metres, along the axis its side runs on. */
function gateOpening(gate: FenceGate, frame: WorldFrame): WorldSpan {
  const horizontal = gate.side === "SOUTH" || gate.side === "NORTH";
  const from = horizontal ? tileToWorld({ x: gate.from, y: 0 }, frame).worldX : tileToWorld({ x: 0, y: gate.from }, frame).worldZ;
  const to = horizontal ? tileToWorld({ x: gate.to, y: 0 }, frame).worldX : tileToWorld({ x: 0, y: gate.to }, frame).worldZ;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Builds the fence from `FENCE` alone.
 *
 * The rectangle is centred on the middle of `FENCE.bounds` - the middle of the field the catalogue
 * can hand out - and sized to the apron plus a small clearance, so it encloses every plot, locked or
 * not, exactly as the config describes. Gates are subtracted from the side they name, whatever side
 * that is, so adding a gate to the config adds both the drawn opening and the walkable one.
 */
export function fenceGeometry(pitch: number = DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP): FenceGeometry {
  const frame = worldFrame(pitch);
  const center = tileToWorld(
    { x: (FENCE.bounds.minX + FENCE.bounds.maxX) / 2, y: (FENCE.bounds.minY + FENCE.bounds.maxY) / 2 },
    frame
  );
  const halfWidthWorld = ((FENCE.bounds.maxX - FENCE.bounds.minX + 1) / 2) * pitch + FENCE_CLEARANCE_WORLD;
  const halfDepthWorld = ((FENCE.bounds.maxY - FENCE.bounds.minY + 1) / 2) * pitch + FENCE_CLEARANCE_WORLD;
  const halfThickness = FENCE_THICKNESS_WORLD / 2;
  const segments: FenceSegment[] = [];

  for (const side of FENCE_SIDES) {
    const horizontal = side === "SOUTH" || side === "NORTH";
    const extent = horizontal ? halfWidthWorld : halfDepthWorld;
    const centerAlong = horizontal ? center.worldX : center.worldZ;
    const line =
      side === "SOUTH"
        ? center.worldZ + halfDepthWorld
        : side === "NORTH"
          ? center.worldZ - halfDepthWorld
          : side === "WEST"
            ? center.worldX - halfWidthWorld
            : center.worldX + halfWidthWorld;
    const openings = FENCE.gates.filter((gate) => gate.side === side).map((gate) => gateOpening(gate, frame));

    closedSpans(centerAlong - extent, centerAlong + extent, openings).forEach((span, index) => {
      segments.push(
        horizontal
          ? {
              id: `${side.toLowerCase()}_${String(index)}`,
              side,
              minWorldX: span.from,
              maxWorldX: span.to,
              minWorldZ: line - halfThickness,
              maxWorldZ: line + halfThickness
            }
          : {
              id: `${side.toLowerCase()}_${String(index)}`,
              side,
              minWorldX: line - halfThickness,
              maxWorldX: line + halfThickness,
              minWorldZ: span.from,
              maxWorldZ: span.to
            }
      );
    });
  }

  return { centerWorldX: center.worldX, centerWorldZ: center.worldZ, halfWidthWorld, halfDepthWorld, segments };
}

/** An axis-aligned strip of ground. Paths are visual and a walkability hint; there is no pathfinding. */
export interface PathStrip {
  readonly id: string;
  readonly bounds: TileBounds;
}

export const PATHS: readonly PathStrip[] = [
  // The main path: south gate → spawn → island edge.
  { id: "south", bounds: { minX: 4.3, maxX: 6.7, minY: 36.5, maxY: 45 } },
  // Branch to the orchard reserve.
  { id: "orchard", bounds: { minX: 6.5, maxX: 38, minY: -11.5, maxY: -3 } },
  // Branch through the west gate to the ranch reserve.
  { id: "ranch", bounds: { minX: -9, maxX: -1.5, minY: 13, maxY: 16 } },
  // Branch through the east gate to the pond and the farmhouse yard.
  { id: "pond", bounds: { minX: 36.5, maxX: 45, minY: 13, maxY: 16 } },
  { id: "farmhouse", bounds: { minX: 39, maxX: 42, minY: -7, maxY: 13 } }
];

/** The pond, in tile coordinates. Water is visual and non-walkable; there is no fishing yet. */
export const POND = {
  center: { x: 42.5, y: 9 },
  radiusX: 3.6,
  radiusY: 3
} as const;

/** The farmhouse/barn yard, a static building placeholder. */
export const FARMHOUSE = {
  center: { x: 42.5, y: -6.5 },
  rotationY: Math.PI * 0.75
} as const;

/**
 * Where the character appears: on the main path, south of the fence and outside every tile the farm
 * can own, so it never starts inside a crop, a tree, a marker, or water. The south gate opens onto
 * the same line, so walking north from here enters the field.
 */
export const SPAWN_TILE: TileCoordinate = { x: WORLD_ORIGIN_TILE_X, y: 41 };

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

/**
 * Half the framed farm, in world metres: the fence rectangle, which is the land the plot catalogue
 * can hand out plus its apron.
 *
 * The camera's default view frames the farm, not the island. Zooming out from here still reaches the
 * whole world and following the character is closer again, so the starting view is neither the empty
 * overview the alpha opened on nor a close-up with no context around it. The island and the fence
 * share a centre, so swapping between the two frames does not slide the world sideways.
 */
export const FARM_HALF_EXTENT_WORLD =
  Math.max(
    (FENCE.bounds.maxX - FENCE.bounds.minX + 1) / 2,
    (FENCE.bounds.maxY - FENCE.bounds.minY + 1) / 2
  ) *
    frame.pitch +
  FENCE_CLEARANCE_WORLD;

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
  treeBands: TREE_BANDS,
  rimTreeBandTiles: RIM_TREE_BAND_TILES,
  rimTreeSpacingTiles: RIM_TREE_SPACING_TILES,
  meadows: MEADOWS,
  fence: FENCE,
  paths: PATHS,
  pond: POND,
  farmhouse: FARMHOUSE,
  spawnTile: SPAWN_TILE,
  spawnWorld: SPAWN_WORLD,
  staticObstacles: STATIC_OBSTACLES,
  farmHalfExtentWorld: FARM_HALF_EXTENT_WORLD,
  islandHalfWidthWorld: ISLAND_HALF_WIDTH_WORLD,
  islandHalfDepthWorld: ISLAND_HALF_DEPTH_WORLD
} as const;
