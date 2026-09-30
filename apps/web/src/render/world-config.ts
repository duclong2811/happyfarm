import type { TileBounds, TileCoordinate, WorldFrame } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, WORLD_ORIGIN_TILE_X, worldFrame } from "./layout";
import { islandRadiusAt, type FlatArea, type IslandLobe, type IslandShape, type TerrainShape, type UplandBias } from "./terrain-height";

/**
 * The static world: the island's outline, its districts, its roads, its water, its landmarks, and
 * what is walkable.
 *
 * This file is the **one** place a world coordinate is written down. The renderer draws what is
 * defined here, the player's collision reads the same outline and the same fence geometry, and the
 * camera takes its bounds from the same numbers - so a district cannot move in one place and stay put
 * in another, and nothing has to be kept in sync by hand.
 *
 * Everything here is presentation. Land ownership stays in `farm_tiles`, prices and levels stay in
 * the plot catalogue, and crop and tree occupancy stay in their instance rows. `FARM_FIELD_BOUNDS`
 * is only the reservation the rest of the plan must not overlap, and a test pins it to the shipped
 * plot catalogue so a future catalogue cannot silently outgrow it.
 *
 * Coordinates are tile coordinates, so this file speaks the same language as the server, and the
 * fixed frame in `layout.ts` is the only place that turns them into world metres.
 */

export const WORLD_CONFIG_VERSION = 4;

/**
 * The land the shipped plot catalogue can hand out: 8 plots of 12x12 make a 36x36 field at [0,35]^2.
 *
 * A *reservation*, not a gameplay bound. It is also the one rectangle the terrain holds dead flat,
 * because a plot bought at its edge must not land on a slope.
 */
export const FARM_FIELD_BOUNDS: TileBounds = { minX: 0, maxX: 35, minY: 0, maxY: 35 };

/**
 * The rectangle every district, road, and landmark has to fit inside.
 *
 * Grown from 62 to 89 tiles. The alpha's island had room for a field and a ring of scenery; an
 * estate with an orchard, a pasture, a water district, woodland, a settlement, and a coast needs
 * room to give each of them a character of its own rather than a band around the field.
 */
export const VISUAL_BOUNDS: TileBounds = { minX: -26, maxX: 62, minY: -26, maxY: 62 };

/** How far the shore reaches past the visual bounds, in tiles: the beach's own width. */
export const ISLAND_SHORE_MARGIN_TILES = 2;

/** The base outline's superellipse exponent. 2 is an ellipse; higher squares the corners off. */
export const ISLAND_SHAPE_EXPONENT = 3.4;

/**
 * The lobes that make the outline an island rather than a shape.
 *
 * Each is a low-frequency radial displacement. Together they put a bay in the south-east - which is
 * where the harbour goes - a bay in the west, and headlands to the south and north-east, so the
 * silhouette is asymmetric and still smooth. The amplitudes are deliberately small: this is a
 * coastline, not a star, and a self-intersecting outline would break both the shore and the beach.
 */
export const ISLAND_LOBES: readonly IslandLobe[] = [
  { harmonic: 2, amplitude: 0.08, phase: -2.6 },
  { harmonic: 3, amplitude: 0.055, phase: 2.4 },
  { harmonic: 5, amplitude: 0.03, phase: 0.6 }
];

/**
 * The functions the island's land is divided between.
 *
 * The set is deliberately small and non-overlapping: a crop district, a civic centre, a perennial
 * orchard, grazing, a water district, woodland, *managed* woodland, and the coast that will one day
 * carry the fishery and the harbour. Nothing here is gameplay - a district neither unlocks nor
 * produces anything - but the ground, the roads, and the vegetation all follow it, so the territory
 * reads the same way from the estate camera as it does on foot.
 */
export type DistrictKind =
  | "SETTLEMENT"
  | "CROPLAND"
  | "ORCHARD"
  | "PASTURE"
  | "WATER"
  | "FOREST"
  | "FORESTRY"
  | "COAST"
  /**
   * Land the plan has deliberately left alone.
   *
   * Not "empty": reserved. A territory that has already filled every corner has nowhere to put the
   * system nobody has designed yet, and redesigning the map for each new one is how a world ends up
   * incoherent. This is ordinary meadow and sparse woodland today and the next district tomorrow. It
   * is never labelled in the game.
   */
  | "FUTURE";

/** How a district's ground is drawn. Colour only; nothing reads it back. */
export type DistrictGround = "NONE" | "PLAZA" | "ORCHARD" | "PASTURE" | "WETLAND" | "FOREST_FLOOR" | "SAND";

/**
 * A district: a zone of the island with an identity.
 *
 * A blob rather than a rectangle - centre, two radii, a rotation - so no district has a straight
 * edge anywhere except where a road or the reserve itself gives it one. Districts are *rules for
 * ground and vegetation*, never ownership: a district does not unlock, block, or price anything.
 */
export interface District {
  readonly id: string;
  readonly kind: DistrictKind;
  readonly labelKey: string;
  readonly center: TileCoordinate;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationY: number;
  /** Ground tint drawn under the district's vegetation. `NONE` leaves the island's own grass. */
  readonly ground: DistrictGround;
  /** How much open-country vegetation the district holds, 0..1. */
  readonly density: number;
  /** Of that vegetation, how much is trees rather than scrub, 0..1. */
  readonly treeShare: number;
}

/**
 * The island's districts.
 *
 * Laid out the way a settlement actually grows: the field it works, the settlement beside it, the
 * orchard and the pasture that feed it, the water it draws from, the woodland it cuts, and the coast
 * it will one day trade from. Their order in this list is their draw order for ground tints, so the
 * reserve's own treatment stays on top of the landscape it sits in.
 *
 * `density` and `treeShare` are the island's explicit vegetation profile, one row per function -
 * they are not a global scatter. A crop district is *empty* of scenery (its land belongs to the
 * catalogue), a settlement is nearly empty and deliberately planted, an orchard is structured,
 * pasture is open grazing with shade trees, natural woodland is the densest thing on the island,
 * managed woodland is one step behind it, and the coast is sparse so the shoreline silhouette stays
 * readable.
 */
export const DISTRICTS: readonly District[] = [
  {
    id: "cropland",
    kind: "CROPLAND",
    labelKey: "world.district.cropland",
    center: { x: 17.5, y: 17.5 },
    radiusX: 25,
    radiusY: 25,
    rotationY: 0,
    ground: "NONE",
    density: 0,
    treeShare: 0
  },
  {
    id: "orchard",
    kind: "ORCHARD",
    labelKey: "world.district.orchard",
    center: { x: -2, y: -14 },
    radiusX: 15,
    radiusY: 8,
    rotationY: -0.18,
    // District identity comes from rows, paths and trees, not from a tinted ellipse: the ground
    // treatments that used to paint each district a different colour are switched off, because at
    // estate zoom they read as a debug overlay rather than as land.
    ground: "NONE",
    density: 0.5,
    treeShare: 0.95
  },
  {
    id: "forest_north",
    kind: "FOREST",
    labelKey: "world.district.forest",
    center: { x: 34, y: -18 },
    radiusX: 14,
    radiusY: 8,
    rotationY: 0.15,
    ground: "NONE",
    density: 0.85,
    treeShare: 0.95
  },
  {
    id: "pasture",
    kind: "PASTURE",
    labelKey: "world.district.pasture",
    center: { x: -16, y: 14 },
    radiusX: 10,
    radiusY: 12,
    rotationY: 0.25,
    ground: "NONE",
    density: 0.1,
    treeShare: 0.35
  },
  {
    id: "settlement",
    kind: "SETTLEMENT",
    labelKey: "world.district.settlement",
    // The civic centre sits on the island's east flank, between the fields and the coast: the market
    // and the well are on its square, the barn is on its western edge where the fields begin, and the
    // warehouse and the town hall have reserved ground on it rather than wherever there was space.
    center: { x: 40, y: 0 },
    radiusX: 11,
    radiusY: 9,
    rotationY: 0,
    ground: "NONE",
    density: 0.06,
    treeShare: 0.5
  },
  {
    id: "water",
    kind: "WATER",
    labelKey: "world.district.water",
    // The pond district, south of the settlement and outside the fields: the water the island draws
    // on, with the wetland around it. Deliberately does not reach the square.
    center: { x: 43, y: 13 },
    radiusX: 8,
    radiusY: 6,
    rotationY: 0.1,
    ground: "NONE",
    density: 0.18,
    treeShare: 0.4
  },
  {
    id: "forestry",
    kind: "FORESTRY",
    labelKey: "world.district.forestry",
    center: { x: -14, y: 44 },
    radiusX: 11,
    radiusY: 9,
    rotationY: -0.2,
    ground: "NONE",
    density: 0.6,
    treeShare: 1
  },
  {
    id: "coast",
    kind: "COAST",
    labelKey: "world.district.coast",
    center: { x: 45, y: 45 },
    radiusX: 12,
    radiusY: 9,
    rotationY: 0.6,
    ground: "NONE",
    density: 0.06,
    treeShare: 0.2
  },
  {
    id: "future_reserve",
    kind: "FUTURE",
    labelKey: "world.district.future",
    center: { x: 4, y: 46 },
    radiusX: 15,
    radiusY: 9,
    rotationY: 0.1,
    ground: "NONE",
    // Meadow with scattered woodland, not a building site and not a thicket: the point is that it
    // looks like land nobody has decided about yet.
    density: 0.2,
    treeShare: 0.55
  }
];

/** The district that owns a point, or null when the point is open landscape. Most specific wins. */
export function districtAt(tile: TileCoordinate): District | null {
  let best: District | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const district of DISTRICTS) {
    const dx = tile.x - district.center.x;
    const dz = tile.y - district.center.y;
    const cos = Math.cos(-district.rotationY);
    const sin = Math.sin(-district.rotationY);
    const localX = (dx * cos - dz * sin) / district.radiusX;
    const localZ = (dx * sin + dz * cos) / district.radiusY;
    const distance = Math.hypot(localX, localZ);
    if (distance <= 1 && distance < bestDistance) {
      best = district;
      bestDistance = distance;
    }
  }
  return best;
}

export type RoadKind = "PRIMARY" | "SECONDARY" | "PATH";

/**
 * A road: a polyline through the landscape, plus the class that decides how wide it is drawn.
 *
 * Roads are the map's explanation. The primary road runs from the settlement past the field's south
 * gate to the harbour; the secondary roads reach the orchard, the pasture, the pond, and the woods;
 * the paths are the last few metres into a place. All of them run *around* the reserved field rather
 * than through it, so no road ever crosses a tile the farm can own.
 */
export interface Road {
  readonly id: string;
  readonly kind: RoadKind;
  readonly points: readonly TileCoordinate[];
}

/** How wide each class of road is drawn, in tiles. */
export const ROAD_WIDTH_TILES: Readonly<Record<RoadKind, number>> = {
  PRIMARY: 1.9,
  SECONDARY: 1.3,
  PATH: 0.8
};

export const ROADS: readonly Road[] = [
  {
    id: "primary",
    kind: "PRIMARY",
    points: [
      // Harbour → settlement → the field's south gate, which is the route the whole territory is
      // organised around. It runs *around* the reserve on the east and south, because the reserve is
      // the one square the plan has to work with rather than through.
      { x: 45, y: 44 },
      { x: 46, y: 34 },
      { x: 44, y: 22 },
      { x: 42, y: 12 },
      { x: 40, y: 6 },
      { x: 41, y: 20 },
      { x: 42, y: 34 },
      { x: 38, y: 40 },
      { x: 24, y: 41 },
      { x: 14, y: 41.5 },
      { x: 6.5, y: 41 },
      { x: 12, y: 46 },
      { x: 26, y: 49 },
      { x: 38, y: 50 },
      { x: 44, y: 47 }
    ]
  },
  {
    id: "orchard_road",
    kind: "SECONDARY",
    points: [
      // Leaves the square heading north-east, then turns west *outside* the reserve: the field's fence
      // is the one boundary a road may not cut, however much shorter the line would be.
      { x: 41, y: 4 },
      { x: 39, y: -6 },
      { x: 26, y: -13 },
      { x: 8, y: -16 },
      { x: -12, y: -12 }
    ]
  },
  {
    id: "pasture_road",
    kind: "SECONDARY",
    points: [
      { x: -3.5, y: 16.5 },
      { x: -8, y: 18 },
      { x: -17, y: 22 }
    ]
  },
  {
    id: "water_road",
    kind: "SECONDARY",
    points: [
      { x: 41, y: 20 },
      { x: 43, y: 16 },
      { x: 44, y: 12 }
    ]
  },
  {
    id: "forest_road",
    kind: "SECONDARY",
    points: [
      { x: 32, y: -14 },
      { x: 34, y: -22 },
      { x: 32, y: -24 }
    ]
  },
  {
    id: "forestry_road",
    kind: "SECONDARY",
    points: [
      { x: 20, y: 41 },
      { x: 4, y: 44 },
      { x: -10, y: 44 },
      { x: -14, y: 40 }
    ]
  },
  {
    id: "reserve_road",
    kind: "PATH",
    points: [
      { x: 14, y: 41.5 },
      { x: 6, y: 47 },
      { x: 0, y: 50 }
    ]
  },
  {
    id: "settlement_loop",
    kind: "PATH",
    points: [
      { x: 38, y: 2 },
      { x: 43, y: -2 },
      { x: 45, y: 5 },
      { x: 40, y: 7 },
      { x: 38, y: 2 }
    ]
  },
  {
    id: "orchard_lane",
    kind: "PATH",
    points: [
      { x: -2, y: -14 },
      { x: -10, y: -17 },
      { x: -19, y: -13 }
    ]
  },
  {
    id: "pasture_lane",
    kind: "PATH",
    points: [
      { x: -14, y: 16 },
      { x: -18, y: 24 },
      { x: -16, y: 32 }
    ]
  },
  {
    id: "harbour_boardwalk",
    kind: "PATH",
    points: [
      { x: 45, y: 44 },
      { x: 47, y: 47 }
    ]
  }
];

/** The pond, in tile coordinates. Water is visual and non-walkable; there is no fishing yet. */
export const POND = {
  center: { x: 42.5, y: 9 },
  radiusX: 3.6,
  radiusY: 3
} as const;

/**
 * The agricultural reserve's visual field blocks.
 *
 * The catalogue's grid is a square and has to stay one, so the *farm* is drawn as what a farm looks
 * like: four fields of different sizes with grass margins and paths between them, in the quadrant of
 * the reserve the catalogue has not sold yet. Each block is presentation only - no tile, no rule, no
 * collision - and the moment a plot is bought the apron and its tiles are drawn on top of it, so a
 * field block can never sit where the player is farming.
 */
export interface FieldBlock {
  readonly id: string;
  readonly bounds: TileBounds;
  /** Which way the furrows run, in radians about Y. */
  readonly rotationY: number;
}

export const FIELD_BLOCKS: readonly FieldBlock[] = [
  { id: "field_a", bounds: { minX: 24, maxX: 29.5, minY: 24, maxY: 28.5 }, rotationY: 0 },
  { id: "field_b", bounds: { minX: 30.5, maxX: 35, minY: 24, maxY: 29.5 }, rotationY: Math.PI / 2 },
  { id: "field_c", bounds: { minX: 24, maxX: 31, minY: 30, maxY: 34.5 }, rotationY: 0 },
  { id: "field_d", bounds: { minX: 32, maxX: 35, minY: 31, maxY: 34.5 }, rotationY: Math.PI / 2 }
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
  /** The south gate leads to the spawn and the main road; the side gates to the estate. */
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

/**
 * A patch of ground with its own colour: a break in the island's single green.
 *
 * Local variation only. A district's own ground is drawn from the district; these are the extra
 * patches that stop even a district being one flat tone.
 */
export interface MeadowPatch {
  readonly id: string;
  readonly kind: "MEADOW" | "DIRT" | "SAND";
  readonly center: TileCoordinate;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationY: number;
}

export const MEADOWS: readonly MeadowPatch[] = [
  { id: "north_meadow", kind: "MEADOW", center: { x: 8, y: -7 }, radiusX: 9.5, radiusY: 4.2, rotationY: 0.12 },
  { id: "west_meadow", kind: "MEADOW", center: { x: -7.5, y: 24 }, radiusX: 3.6, radiusY: 11, rotationY: -0.08 },
  { id: "east_meadow", kind: "MEADOW", center: { x: 52, y: 24 }, radiusX: 4.2, radiusY: 8.5, rotationY: 0.2 },
  { id: "south_meadow", kind: "MEADOW", center: { x: 12, y: 42 }, radiusX: 10, radiusY: 3.4, rotationY: -0.15 },
  { id: "north_west_meadow", kind: "MEADOW", center: { x: -9, y: 6 }, radiusX: 3.2, radiusY: 6.5, rotationY: 0.35 },
  { id: "reserve_east_meadow", kind: "MEADOW", center: { x: 28, y: 6 }, radiusX: 4, radiusY: 3.5, rotationY: 0.3 },
  { id: "reserve_south_meadow", kind: "MEADOW", center: { x: 6, y: 28 }, radiusX: 3.5, radiusY: 4, rotationY: -0.2 },
  { id: "ranch_dirt", kind: "DIRT", center: { x: -7, y: 14 }, radiusX: 3.4, radiusY: 7, rotationY: 0 },
  { id: "orchard_dirt", kind: "DIRT", center: { x: 20, y: -7 }, radiusX: 8.5, radiusY: 2.6, rotationY: 0 },
  { id: "south_shore", kind: "SAND", center: { x: 5.5, y: 44 }, radiusX: 12, radiusY: 3, rotationY: 0 },
  { id: "pond_shore", kind: "SAND", center: { x: 43, y: 9 }, radiusX: 4.6, radiusY: 4.4, rotationY: 0 }
];

/**
 * The barn and the yard it stands in, on the settlement's edge where the fields meet the buildings.
 *
 * The barn is the one structure the world has always drawn; the yard around it is a flat area, a
 * road junction, and a collision circle.
 */
export const FARMSTEAD = {
  center: { x: 41, y: -6 },
  rotationY: Math.PI * 0.75
} as const;

/**
 * The kinds of structure the world places.
 *
 * Each has a builder in `landmarks.ts` that draws it from shared primitives. They are scenery: none
 * of them unlocks, produces, stores, or prices anything. They exist so the island has things to
 * navigate by, and so the districts have a centre of gravity.
 */
export type LandmarkKind =
  | "FARMHOUSE"
  | "WINDMILL"
  | "WELL"
  | "MARKET_STALL"
  | "STORAGE_SHED"
  | "HARBOR"
  | "SILO"
  | "COOP";

/**
 * A placed landmark.
 *
 * `blockingRadiusWorld` is the circle a walker goes around, and 0 for a structure the player walks
 * through or up to. Every landmark is placed clear of the field, the roads, the water, and the
 * spawn, so a landmark can never seal a route.
 */
export interface LandmarkSpec {
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly tile: TileCoordinate;
  readonly rotationY: number;
  readonly blockingRadiusWorld: number;
}

/**
 * The landmark layout, each in the district it belongs to.
 *
 * The settlement holds the farmhouse, the market, and the well around its square; the barn sits where
 * the fields meet the buildings; the windmill stands on the upland beside the orchard; the shed is at
 * the pasture's edge; and the harbour is on the south-east bay, where the primary road ends.
 */
export const LANDMARKS: readonly LandmarkSpec[] = [
  // The square's buildings face it: the residence on the north side, the well on the west, the
  // market on the south, with the road arriving from the south-east. Rotations are the frontage, not
  // decoration, which is why they are near a right angle to the side they stand on.
  { id: "farmhouse", kind: "FARMHOUSE", tile: { x: 44, y: -1 }, rotationY: Math.PI, blockingRadiusWorld: 2.6 },
  { id: "well", kind: "WELL", tile: { x: 38.5, y: -4 }, rotationY: 0, blockingRadiusWorld: 0.85 },
  { id: "market_stall", kind: "MARKET_STALL", tile: { x: 39, y: 3 }, rotationY: 0, blockingRadiusWorld: 1.2 },
  { id: "windmill", kind: "WINDMILL", tile: { x: -8, y: -10 }, rotationY: 0.35, blockingRadiusWorld: 1.8 },
  { id: "storage_shed", kind: "STORAGE_SHED", tile: { x: -14, y: 18 }, rotationY: 0.2, blockingRadiusWorld: 1.6 },
  // The agricultural pair: a silo on the settlement's working edge and a coop out on the pasture.
  { id: "silo", kind: "SILO", tile: { x: 48, y: -2 }, rotationY: 0, blockingRadiusWorld: 1.6 },
  { id: "coop", kind: "COOP", tile: { x: -18, y: 12 }, rotationY: 0.5, blockingRadiusWorld: 1.1 },
  // The bay runs out to the south-east, so the quay faces that way and its pier reaches the water
  // rather than the grass behind it.
  { id: "harbor", kind: "HARBOR", tile: { x: 48.5, y: 48.5 }, rotationY: Math.PI / 4, blockingRadiusWorld: 1.4 }
];

/**
 * Where the character appears: on the primary road, south of the fence and outside every tile the
 * farm can own, so it never starts inside a crop, a tree, a landmark, or water. The south gate opens
 * onto the same road, so walking north from here enters the field.
 */
export const SPAWN_TILE: TileCoordinate = { x: WORLD_ORIGIN_TILE_X, y: 41 };

export interface WorldObstacle {
  readonly id: string;
  /** A circle in world metres: the only shape a walker needs for static collision. */
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
export const FARMSTEAD_WORLD = toWorld(FARMSTEAD.center);

/** One landmark, in world metres: what the renderer draws and what collision blocks. */
export interface PlacedLandmark extends LandmarkSpec {
  readonly worldX: number;
  readonly worldZ: number;
}

export const LANDMARKS_WORLD: readonly PlacedLandmark[] = LANDMARKS.map((landmark) => ({
  ...landmark,
  ...toWorld(landmark.tile)
}));

/**
 * Static obstacles a character must walk around.
 *
 * Deliberately a short list of circles: the barn, the pond, and one per landmark. Crops and trees
 * are *not* here - they are authoritative runtime state, and the collision world reads them from the
 * farm's own rows the same way the renderer does today.
 */
export const STATIC_OBSTACLES: readonly WorldObstacle[] = [
  { id: "barn", centerWorldX: FARMSTEAD_WORLD.worldX, centerWorldZ: FARMSTEAD_WORLD.worldZ, radiusWorld: 2.2 },
  { id: "pond", centerWorldX: POND_WORLD.worldX, centerWorldZ: POND_WORLD.worldZ, radiusWorld: Math.max(POND_WORLD.radiusWorldX, POND_WORLD.radiusWorldZ) },
  ...LANDMARKS_WORLD.map((landmark) => ({
    id: landmark.id,
    centerWorldX: landmark.worldX,
    centerWorldZ: landmark.worldZ,
    radiusWorld: landmark.blockingRadiusWorld
  }))
];

/**
 * The island in world metres: the visual bounds plus a shore margin.
 *
 * The extra margin is what the beach and the shoreline scenery stand on. It does not change what the
 * farm may own - that is `FARM_FIELD_BOUNDS` and the plot catalogue - and it does not move a tile.
 */
export const ISLAND_HALF_WIDTH_WORLD =
  ((VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * frame.pitch;
export const ISLAND_HALF_DEPTH_WORLD =
  ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * frame.pitch;

/**
 * Half the framed farm, in world metres: the fence rectangle, which is the land the plot catalogue
 * can hand out plus its apron.
 *
 * The camera's default view frames the farm, not the island. Zooming out from here still reaches the
 * whole estate and following the character is closer again, so the starting view is neither an empty
 * overview nor a close-up with no context around it.
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

/** The island's outline: one shape for the drawn shore and the walkable one. */
export const ISLAND_SHAPE: IslandShape = {
  centerWorldX: WORLD_CENTER_WORLD.worldX,
  centerWorldZ: WORLD_CENTER_WORLD.worldZ,
  halfWidthWorld: ISLAND_HALF_WIDTH_WORLD,
  halfDepthWorld: ISLAND_HALF_DEPTH_WORLD,
  exponent: ISLAND_SHAPE_EXPONENT,
  lobes: ISLAND_LOBES
};

/**
 * The rectangles the terrain holds dead flat.
 *
 * The reserved field first and widest: a plot bought at its edge must not land on a slope, and the
 * whole 36-tile square has to stay level for the tile grid to keep meaning what it means. Then the
 * places water or a building stands, and the harbour's quay.
 */
export function terrainFlatAreas(frame: WorldFrame = worldFrame()): readonly FlatArea[] {
  function around(tile: TileCoordinate, halfWidthTiles: number, halfDepthTiles: number, featherTiles: number): FlatArea {
    const centre = tileToWorld(tile, frame);
    return {
      centerWorldX: centre.worldX,
      centerWorldZ: centre.worldZ,
      halfWidthWorld: halfWidthTiles * frame.pitch,
      halfDepthWorld: halfDepthTiles * frame.pitch,
      featherWorld: featherTiles * frame.pitch
    };
  }
  return [
    around({ x: (FARM_FIELD_BOUNDS.minX + FARM_FIELD_BOUNDS.maxX + 1) / 2, y: (FARM_FIELD_BOUNDS.minY + FARM_FIELD_BOUNDS.maxY + 1) / 2 }, 20, 20, 4),
    around(POND.center, POND.radiusX + 2.5, POND.radiusY + 2.5, 3),
    around(FARMSTEAD.center, 6, 6, 3),
    around({ x: 40, y: 0 }, 9, 8, 4),
    around({ x: 45, y: 45 }, 9, 7, 3)
  ];
}

/**
 * The broad rise that makes the island's upland, pointing north-east across it.
 *
 * The terrain follows the plan rather than the plan following the terrain: the natural forest sits on
 * the highest, roughest ground, the orchard on a gentle slope beside the fields, and the harbour and
 * the wetland on the low side where the water is.
 */
export const ISLAND_UPLANDS: readonly UplandBias[] = [{ normalX: 0.66, normalZ: -0.75, weight: 0.75 }];

/**
 * Height of the tallest hill above the flat ground, in world units.
 *
 * Raised in V7. At 6.5 the island read as a plate with a pattern painted on it from the estate
 * camera: relief is what gives a landscape a near side and a far side, and without it every district
 * sits on the same plane and the composition flattens out. The farm, the settlement, the pond, and
 * the quay are still held dead flat by `terrainFlatAreas`, so the gameplay surfaces stay usable.
 */
export const TERRAIN_RELIEF_WORLD = 9.5;

/** The island's outline, its elevation, and the areas that stay level. Pure data. */
export const TERRAIN_SHAPE: TerrainShape = {
  ...ISLAND_SHAPE,
  reliefWorld: TERRAIN_RELIEF_WORLD,
  flatAreas: terrainFlatAreas(),
  uplands: ISLAND_UPLANDS
};

/**
 * Whether a tile holds the pond's water.
 *
 * The pond is the only water the world has today. A district can be *about* water - the wetland
 * around it - without turning its tiles into water, because water is a tile rule and a district is a
 * description of landscape.
 */
export function isWaterTile(tile: TileCoordinate): boolean {
  const dx = (tile.x - POND.center.x) / POND.radiusX;
  const dy = (tile.y - POND.center.y) / POND.radiusY;
  return dx * dx + dy * dy <= 1;
}

/** Whether a tile holds a static obstacle a character must walk around. */
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
 * Grass, sand, and roads are walkable; water and anything past the shoreline is not; a static
 * obstacle is not. The shore is the island's own outline rather than a bounding box, so the corners
 * of the box - which are sea - are not reported as ground. Crop and tree occupancy is deliberately
 * *not* consulted here: that is authoritative runtime state, and the collision world combines this
 * static answer with the farm's own rows.
 */
export function isStaticWorldWalkable(tile: TileCoordinate): boolean {
  const world = toWorld(tile);
  // A hair inside the waterline, so a point reported walkable is one the shore does not reject.
  if (islandRadiusAt(world.worldX, world.worldZ, ISLAND_SHAPE) > 0.985) return false;
  if (isWaterTile(tile)) return false;
  if (isStaticObstacleTile(tile)) return false;
  return true;
}

/**
 * The rectangle the walkable island fits inside.
 *
 * A convenience bound for callers that need a box rather than the shape; the shore itself is
 * `islandRadiusAt`, which is what the collision world tests.
 */
export const WALKABLE_BOUNDS: TileBounds = {
  minX: Math.floor((VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2 - ISLAND_HALF_WIDTH_WORLD / frame.pitch),
  maxX: Math.ceil((VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2 + ISLAND_HALF_WIDTH_WORLD / frame.pitch),
  minY: Math.floor((VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2 - ISLAND_HALF_DEPTH_WORLD / frame.pitch),
  maxY: Math.ceil((VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2 + ISLAND_HALF_DEPTH_WORLD / frame.pitch)
};

/** Every gameplay-relevant number the static world exposes, for tests and later phases. */
export const WORLD_CONFIG = {
  version: WORLD_CONFIG_VERSION,
  frame,
  visualBounds: VISUAL_BOUNDS,
  farmFieldBounds: FARM_FIELD_BOUNDS,
  districts: DISTRICTS,
  roads: ROADS,
  roadWidths: ROAD_WIDTH_TILES,
  meadows: MEADOWS,
  fence: FENCE,
  pond: POND,
  farmstead: FARMSTEAD,
  landmarks: LANDMARKS,
  spawnTile: SPAWN_TILE,
  spawnWorld: SPAWN_WORLD,
  staticObstacles: STATIC_OBSTACLES,
  farmHalfExtentWorld: FARM_HALF_EXTENT_WORLD,
  islandHalfWidthWorld: ISLAND_HALF_WIDTH_WORLD,
  islandHalfDepthWorld: ISLAND_HALF_DEPTH_WORLD,
  islandShape: ISLAND_SHAPE,
  terrainShape: TERRAIN_SHAPE
} as const;
