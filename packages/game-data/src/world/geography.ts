/**
 * The island's geography, as numbers and pure functions the *server* can also read.
 *
 * V13.2 reported the gap this closes: the client knew where the island ends, where the volcano is and
 * what the ground is made of, and the server knew only which tiles the farm owned. That was enough
 * only because every protected place happened to sit outside owned land - a property of today's map
 * rather than a rule. This module is the rule: one outline, one volcano, one set of protected regions,
 * and a single `classifyTile` that answers what a tile physically is, so the API can refuse a
 * placement for the *reason it is actually refused* instead of inferring "not yours".
 *
 * It is deliberately *geography only*: no meshes, no materials, no three, no rendering data. The
 * renderer keeps its own - elevation, scenery, districts - and imports these numbers so the drawn
 * island and the checked one cannot drift apart.
 */

import type { TileCoordinate } from "./tiles";

/** The one tile-to-world mapping. The renderer's layout module uses the same numbers. */
export const WORLD_TILE_PITCH = 1.08;
export const WORLD_ORIGIN_TILE_X = 5.5;
export const WORLD_ORIGIN_TILE_Y = 5.5;

/** The rectangle the plot catalogue could sell: a reservation, never ownership. */
export const FARM_FIELD_BOUNDS = { minX: 0, maxX: 35, minY: 0, maxY: 35 } as const;

/** The rectangle the island is drawn and reasoned about inside. */
export const VISUAL_BOUNDS = { minX: -34, maxX: 70, minY: -34, maxY: 70 } as const;

/** How much extra ground the island keeps beyond the visual bounds before the sea. */
export const ISLAND_SHORE_MARGIN_TILES = 2;
export const ISLAND_SHAPE_EXPONENT = 3.4;

/** One low-frequency lobe of the coastline. */
export interface IslandLobe {
  readonly harmonic: number;
  readonly amplitude: number;
  readonly phase: number;
}

export const ISLAND_LOBES: readonly IslandLobe[] = [
  { harmonic: 2, amplitude: 0.08, phase: -2.6 },
  { harmonic: 3, amplitude: 0.055, phase: 2.4 },
  { harmonic: 5, amplitude: 0.03, phase: 0.6 }
];

/** The lake, whose bank the terrain holds level. */
export const POND = { center: { x: -3, y: 45 }, radiusX: 5, radiusY: 3.8 } as const;
/** The village square, and the biggest flat area the island keeps for itself. */
export const PLAZA = { center: { x: 45, y: 3 }, radiusX: 4.6, radiusY: 3.4, rotationY: 0.06 } as const;
/** The quay: where the pier meets the beach, and the yard behind it. */
export const HARBOUR = {
  root: { x: 53, y: 53 },
  bearing: Math.PI / 4,
  lengthTiles: 6.4,
  deckWidthTiles: 1.7,
  yard: { x: 50, y: 50 }
} as const;
/** The barn's yard: where the working land begins. */
export const FARMSTEAD = { center: { x: 38, y: -7 }, rotationY: 0 } as const;

/** The volcano: the island's one landmark, and the only tall thing on it. */
export const VOLCANO = {
  center: { x: 12, y: -23 },
  baseRadiusTiles: 21.3,
  heightWorld: 18,
  rimRadiusFraction: 0.34,
  craterDepthFraction: 0.5,
  steepRadiusFraction: 0.62,
  tilt: 0.06,
  tiltDirection: -2.4,
  lobes: [
    { harmonic: 2, amplitude: 0.07, phase: 1.1 },
    { harmonic: 3, amplitude: 0.045, phase: -0.6 }
  ]
} as const;

/**
 * How far the harbour's water is kept clear of anything a player places, in tiles.
 *
 * A cage moored across the pier is a cage nobody can sail past, so this is a protected region rather
 * than a coastline nicety.
 */
export const HARBOUR_CLEARANCE_TILES = 9;
/** How far inland from the waterline the beach reaches, in shore units. */
export const SHORE_BAND = 0.955;
/** How far offshore a cell still counts as the workable shelf, in shore units. */
export const SHALLOW_WATER_BAND = 0.06;

export interface WorldFrame {
  readonly originTileX: number;
  readonly originTileY: number;
  readonly pitch: number;
}

export const WORLD_FRAME: WorldFrame = {
  originTileX: WORLD_ORIGIN_TILE_X,
  originTileY: WORLD_ORIGIN_TILE_Y,
  pitch: WORLD_TILE_PITCH
};

/** A tile's centre, in world metres. The one conversion, shared by both sides. */
export function tileToWorld(tile: TileCoordinate, frame: WorldFrame = WORLD_FRAME): { readonly worldX: number; readonly worldZ: number } {
  return {
    worldX: (tile.x - frame.originTileX) * frame.pitch,
    worldZ: (tile.y - frame.originTileY) * frame.pitch
  };
}

/** The island's outline in world metres: the drawn shore and the walkable one. */
export interface IslandShape {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfWidthWorld: number;
  readonly halfDepthWorld: number;
  readonly exponent: number;
  readonly lobes: readonly IslandLobe[];
}

export function islandShape(frame: WorldFrame = WORLD_FRAME): IslandShape {
  const centre = tileToWorld(
    { x: (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2, y: (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2 },
    frame
  );
  return {
    centerWorldX: centre.worldX,
    centerWorldZ: centre.worldZ,
    halfWidthWorld: ((VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * frame.pitch,
    halfDepthWorld: ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * frame.pitch,
    exponent: ISLAND_SHAPE_EXPONENT,
    lobes: ISLAND_LOBES
  };
}

export const ISLAND_SHAPE: IslandShape = islandShape();

/** The outline's displacement at a polar angle, as a fraction of the base radius. */
export function islandOutlineScale(angle: number, island: { readonly lobes: readonly IslandLobe[] }): number {
  let scale = 1;
  for (const lobe of island.lobes) {
    scale += lobe.amplitude * Math.sin(lobe.harmonic * angle + lobe.phase);
  }
  return Math.min(1.3, Math.max(0.7, scale));
}

/**
 * How far a point is from the island's centre, measured in shore units.
 *
 * 0 at the centre and 1 exactly on the shoreline, so the same number describes the drawn shore, the
 * walkable shore and the beach.
 */
export function islandRadiusAt(worldX: number, worldZ: number, island: IslandShape = ISLAND_SHAPE): number {
  const nx = (worldX - island.centerWorldX) / island.halfWidthWorld;
  const nz = (worldZ - island.centerWorldZ) / island.halfDepthWorld;
  if (nx === 0 && nz === 0) return 0;
  const radius = Math.pow(Math.pow(Math.abs(nx), island.exponent) + Math.pow(Math.abs(nz), island.exponent), 1 / island.exponent);
  return radius / islandOutlineScale(Math.atan2(nz, nx), island);
}

export interface VolcanoShape {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly baseRadiusWorld: number;
  readonly rimRadiusFraction: number;
  readonly steepRadiusFraction: number;
  readonly lobes: readonly IslandLobe[];
}

export function volcanoShape(frame: WorldFrame = WORLD_FRAME): VolcanoShape {
  const centre = tileToWorld(VOLCANO.center, frame);
  return {
    centerWorldX: centre.worldX,
    centerWorldZ: centre.worldZ,
    baseRadiusWorld: VOLCANO.baseRadiusTiles * frame.pitch,
    rimRadiusFraction: VOLCANO.rimRadiusFraction,
    steepRadiusFraction: VOLCANO.steepRadiusFraction,
    lobes: VOLCANO.lobes
  };
}

export const VOLCANO_SHAPE: VolcanoShape = volcanoShape();

/** Which band of the volcano a point falls in, or null when it is not on the mountain at all. */
export type VolcanoZone = "CORE" | "SLOPE" | "FOOTHILL";

export function volcanoZoneAt(worldX: number, worldZ: number, volcano: VolcanoShape = VOLCANO_SHAPE): VolcanoZone | null {
  const dx = worldX - volcano.centerWorldX;
  const dz = worldZ - volcano.centerWorldZ;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return "CORE";
  const bearing = Math.atan2(dz, dx);
  const fraction = distance / (volcano.baseRadiusWorld * islandOutlineScale(bearing, volcano));
  if (fraction >= 1) return null;
  if (fraction < volcano.rimRadiusFraction) return "CORE";
  return fraction < volcano.steepRadiusFraction ? "SLOPE" : "FOOTHILL";
}

/** What the ground physically is. The server's vocabulary for a tile, and the client's for a cell. */
export type WorldTerrain = "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";

export interface TileClassification {
  readonly terrain: WorldTerrain;
  /** The workable shelf: water shallow enough to moor something in, outside the harbour's approach. */
  readonly shallowWater: boolean;
  /**
   * Ground the island keeps for itself: the crater and the steep flanks, the village square, the
   * harbour's water and quay approach. Not an economic district - "not yours to change".
   */
  readonly protectedGround: boolean;
  /** Whether the tile is inside the island's outline at all. */
  readonly insideIsland: boolean;
}

/** Whether a tile is inside the harbour's own water, which nothing may be placed in. */
export function insideHarbourWater(tile: TileCoordinate): boolean {
  return (
    Math.hypot(tile.x - HARBOUR.root.x, tile.y - HARBOUR.root.y) < HARBOUR_CLEARANCE_TILES ||
    Math.hypot(tile.x - HARBOUR.yard.x, tile.y - HARBOUR.yard.y) < HARBOUR_CLEARANCE_TILES
  );
}

/** Whether a tile is inside the village square, which is paved civic ground. */
export function insidePlaza(tile: TileCoordinate, frame: WorldFrame = WORLD_FRAME): boolean {
  const world = tileToWorld(tile, frame);
  const centre = tileToWorld(PLAZA.center, frame);
  const dx = world.worldX - centre.worldX;
  const dz = world.worldZ - centre.worldZ;
  const cos = Math.cos(PLAZA.rotationY);
  const sin = Math.sin(PLAZA.rotationY);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const radiusX = PLAZA.radiusX * frame.pitch;
  const radiusZ = PLAZA.radiusY * frame.pitch;
  return (localX * localX) / (radiusX * radiusX) + (localZ * localZ) / (radiusZ * radiusZ) <= 1;
}

/**
 * What a tile is, from the island's own shape.
 *
 * One function, used by the API's placement rules and (through the cell map) by the renderer, so a
 * client preview and a server refusal cannot disagree about whether a spot is beach, water or the
 * mountain.
 */
export function classifyTile(tile: TileCoordinate, frame: WorldFrame = WORLD_FRAME): TileClassification {
  const world = tileToWorld(tile, frame);
  const radius = islandRadiusAt(world.worldX, world.worldZ, islandShape(frame));
  if (radius > 1 + SHALLOW_WATER_BAND) {
    return { terrain: "WATER", shallowWater: false, protectedGround: insideHarbourWater(tile), insideIsland: radius <= 1 };
  }
  if (radius > 1) {
    const shallow = radius <= 1 + SHALLOW_WATER_BAND && !insideHarbourWater(tile);
    return { terrain: "WATER", shallowWater: shallow, protectedGround: insideHarbourWater(tile), insideIsland: false };
  }
  const zone = volcanoZoneAt(world.worldX, world.worldZ, volcanoShape(frame));
  if (zone !== null) {
    const protectedGround = zone !== "FOOTHILL";
    return { terrain: "VOLCANO", shallowWater: false, protectedGround, insideIsland: true };
  }
  if (radius > SHORE_BAND) {
    return { terrain: "SHORE", shallowWater: false, protectedGround: false, insideIsland: true };
  }
  return {
    terrain: "LAND",
    shallowWater: false,
    protectedGround: insidePlaza(tile, frame),
    insideIsland: true
  };
}
