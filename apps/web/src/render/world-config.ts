import type { TileBounds, TileCoordinate, WorldFrame } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, WORLD_ORIGIN_TILE_X, worldFrame } from "./layout";
import { islandRadiusAt, type FlatArea, type IslandLobe, type IslandShape, type TerrainShape, type UplandBias } from "./terrain-height";
import type { EnvironmentCompositionPreset } from "./composition";

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

export const WORLD_CONFIG_VERSION = 5;

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
 * Grown twice: 62 to 89 tiles when the estate gained its districts, and 89 to 105 in V9. The second
 * growth is the composition fix. The reserve is a 36-tile square in the middle of the island, and at
 * 89 tiles that left a ring around it barely seventeen tiles wide - enough for one district at a
 * time, which is why the orchard, the pasture, and the managed wood were all crowding a coast they
 * then ran into. A ring of twenty-four tiles is the least that lets each of them have a middle of
 * its own and a margin of grass around it.
 */
export const VISUAL_BOUNDS: TileBounds = { minX: -34, maxX: 70, minY: -34, maxY: 70 };

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

/**
 * How a district's ground *could* be drawn, if a district ever wanted a treatment of its own.
 *
 * Every district is `NONE` today, and that is the fourth pass to reach that conclusion: a district
 * painted as one coloured blob reads as a debug overlay from the estate camera, not as land. The V9
 * pass removed the last tint - the orchard's bare-earth oval, which turned the island's north-west
 * into something that looked like a sand dune with trees standing on it - and the renderer no longer
 * draws district ground at all. Identity comes from rows, beds, paths, buildings, trees, and water.
 * The vocabulary stays because the crop district's own test pins it, and because the honest way to
 * bring a treatment back is to give it a shape and an edge rather than a blob.
 */
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
  /**
   * Distance between the rows of a district that is planted in rows, in tiles.
   *
   * Absent for a district that is a scatter. An orchard's rows are wide and its beds generous; a
   * managed wood's are tighter and its beds narrow, which is the whole visual difference between the
   * two - and the reason the spacing is a property of the district rather than a constant in the
   * renderer.
   */
  readonly rowSpacingTiles?: number;
  /** How wide the bed drawn under one row is, in tiles. Only read where `rowSpacingTiles` is. */
  readonly rowBedWidthTiles?: number;
  /** How wide the lane alongside the rows is, in tiles: the space that makes a stand walkable. */
  readonly rowLaneWidthTiles?: number;
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
    radiusX: 21,
    radiusY: 21,
    rotationY: 0,
    ground: "NONE",
    density: 0,
    treeShare: 0
  },
  {
    id: "orchard",
    kind: "ORCHARD",
    labelKey: "world.district.orchard",
    // North-west of the fields, on the gentle shoulder between the lowland and the high wood. Rows
    // run with the slope, so a lane on its own axis is a lane that does not climb.
    // Turned to follow the coast rather than to follow the compass. The island's north-west is a
    // curved band, and an orchard laid out on the first axis that came to mind ran its far corner
    // into the sea; laid along the shoreline it fits twice the plantation on the same land - and its
    // rows end up running across the estate camera's view instead of away from it, which is what
    // makes a row of trees read as a row.
    center: { x: -14, y: -14 },
    radiusX: 14,
    radiusY: 8,
    rotationY: -0.78,
    // District identity comes from rows, paths and trees, not from a tinted ellipse: the ground
    // treatments that used to paint each district a different colour are switched off, because at
    // estate zoom they read as a debug overlay rather than as land.
    ground: "NONE",
    // Low: a district that is planted in rows gets its structure from the rows, and a scatter on top
    // of them is what stops the rows reading at all.
    density: 0.18,
    treeShare: 0.98,
    // Rows at 3.6 tiles and a tree every 2.4 along them: dense enough that a row reads as a line of
    // trees rather than as three dots, wide enough that the lane between two rows is still a lane.
    // Rows a tree and a bit apart, a tree every 1.4 tiles along them, and a mown lane two tiles wide
    // between the rows. That ratio - tight along the line, wide across it - is what a plantation looks
    // like from above, and it is the only spacing that survives the estate camera.
    rowSpacingTiles: 2.6,
    rowBedWidthTiles: 1.7,
    rowLaneWidthTiles: 1
  },
  {
    id: "forest_north",
    kind: "FOREST",
    labelKey: "world.district.forest",
    // The first of the island's two great woods, along the northern highland: the largest single
    // mass on the island, and the reason the north reads as a different kind of place from the
    // field.
    center: { x: 12, y: -18 },
    radiusX: 16,
    radiusY: 9,
    rotationY: 0.06,
    ground: "NONE",
    density: 0.95,
    treeShare: 0.98
  },
  {
    id: "forest_east",
    kind: "FOREST",
    labelKey: "world.district.forest",
    // The second mass, on the north-eastern headland. Two woods with open ground between them read
    // as a landscape; one wide band around the whole north edge reads as a painted border.
    center: { x: 50, y: -16 },
    radiusX: 10,
    radiusY: 8,
    rotationY: 0.2,
    ground: "NONE",
    density: 0.92,
    treeShare: 0.96
  },
  {
    id: "pasture",
    kind: "PASTURE",
    labelKey: "world.district.pasture",
    center: { x: -15, y: 8 },
    radiusX: 9,
    radiusY: 10,
    rotationY: 0.2,
    ground: "NONE",
    density: 0.12,
    treeShare: 0.3
  },
  {
    id: "settlement",
    kind: "SETTLEMENT",
    labelKey: "world.district.settlement",
    // The civic centre sits on the island's east flank, between the fields and the coast: the square
    // is at its middle, the buildings face onto it, the barn stands on its western edge where the
    // fields begin, and the warehouse and the town hall have reserved ground rather than whatever
    // happened to be free.
    center: { x: 44, y: 2 },
    radiusX: 13,
    radiusY: 11,
    rotationY: 0,
    ground: "NONE",
    density: 0.05,
    treeShare: 0.5
  },
  {
    id: "water",
    kind: "WATER",
    labelKey: "world.district.water",
    // The freshwater basin on the island's southern flank: the lake, the wetland around it, and the
    // reedy bank the island draws its water from. It sits on the low side of the relief, which is
    // where water actually collects, and it is the one place on the island the player reads as water
    // rather than as coast.
    center: { x: 0, y: 43 },
    radiusX: 11,
    radiusY: 8,
    rotationY: 0.1,
    // No tint: the lake, its reedy bank, and the stones along it are the district's identity. A
    // district-wide ground colour is the thing V6 removed and V9 must not put back.
    ground: "NONE",
    density: 0.14,
    treeShare: 0.3
  },
  {
    id: "forestry",
    kind: "FORESTRY",
    labelKey: "world.district.forestry",
    // Managed woodland on the western shoulder, between the pasture and the freshwater basin. Rows,
    // a haul road and a loading yard are what separate it from the untouched wood to the north.
    center: { x: -18, y: 30 },
    radiusX: 8,
    radiusY: 8,
    rotationY: -0.15,
    ground: "NONE",
    density: 0.28,
    treeShare: 1,
    rowSpacingTiles: 2,
    rowBedWidthTiles: 1.3,
    rowLaneWidthTiles: 2.2
  },
  {
    id: "coast",
    kind: "COAST",
    labelKey: "world.district.coast",
    // The bay the harbour stands in, on the south-east flank: the quay, the yard behind it, the
    // boats, and the fish farm just offshore.
    center: { x: 44, y: 44 },
    radiusX: 12,
    radiusY: 8,
    rotationY: 0.5,
    // No tint: a district-wide sand colour is exactly the "coloured blob" the plan forbids, and the
    // beach the island already draws along its own outline is where the sand belongs.
    ground: "NONE",
    density: 0.05,
    treeShare: 0.2
  },
  {
    id: "future_reserve",
    kind: "FUTURE",
    labelKey: "world.district.future",
    // Meadow south of the fields, between the freshwater basin and the coast: the land the island
    // has deliberately not decided about yet.
    center: { x: 22, y: 52 },
    radiusX: 12,
    radiusY: 7.5,
    rotationY: 0.12,
    ground: "NONE",
    density: 0.16,
    treeShare: 0.5
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
  PRIMARY: 2.6,
  SECONDARY: 1.5,
  PATH: 0.9
};

export const ROADS: readonly Road[] = [
  {
    id: "primary",
    kind: "PRIMARY",
    points: [
      // The ring road. One primary goes the whole way round the agricultural heartland: out of the
      // quay at the south-east bay, up the waterfront to the town, west along the wood's southern
      // edge, down the orchard's shoulder, south past the pasture and the managed wood, east along
      // the meadow to the field's own south gate and the spawn, and back to the harbour. That is the
      // skeleton the territory is organised around, and it is deliberately *around* the reserve: the
      // square the catalogue sells is the one piece of ground no road may cross.
      { x: 53, y: 53 },
      { x: 50, y: 52 },
      { x: 46, y: 49 },
      { x: 42, y: 45 },
      { x: 40, y: 38 },
      { x: 41, y: 28 },
      { x: 42, y: 18 },
      { x: 42, y: 8 },
      { x: 42, y: -1 },
      { x: 40, y: -8 },
      { x: 30, y: -9 },
      { x: 18, y: -9 },
      { x: 6, y: -10 },
      { x: -5, y: -11 },
      { x: -9, y: -6 },
      { x: -10, y: 4 },
      { x: -10, y: 16 },
      { x: -9, y: 28 },
      { x: -7, y: 36 },
      { x: -7, y: 40 },
      { x: 0, y: 43 },
      { x: 6, y: 41.5 },
      { x: 16, y: 41 },
      { x: 26, y: 41 },
      { x: 34, y: 43 },
      { x: 40, y: 47 },
      { x: 46, y: 50 },
      { x: 50, y: 52 },
      { x: 53, y: 53 }
    ]
  },
  {
    id: "orchard_road",
    kind: "SECONDARY",
    points: [
      // Off the ring at the north-west corner, down into the orchard: the rows themselves run on the
      // district's own axis, so the spur is what turns a planted field into a place you can enter.
      { x: -5, y: -11 },
      { x: -9, y: -14 },
      { x: -14, y: -17 },
      { x: -20, y: -17 }
    ]
  },
  {
    id: "pasture_road",
    kind: "SECONDARY",
    points: [
      { x: -10, y: 6 },
      { x: -14, y: 6 },
      { x: -17, y: 10 },
      { x: -19, y: 16 }
    ]
  },
  {
    id: "water_road",
    kind: "SECONDARY",
    points: [
      // Down the western bank of the lake: the road stops at the water's edge, which is where the
      // platform and the reeds are.
      { x: -7, y: 40 },
      { x: -9, y: 45 },
      { x: -10, y: 48 }
    ]
  },
  {
    id: "forest_road",
    kind: "SECONDARY",
    points: [
      // The wood's access track: off the ring, into the mass, and out the far side of it.
      { x: 18, y: -9 },
      { x: 18, y: -15 },
      { x: 16, y: -22 }
    ]
  },
  {
    id: "forest_east_road",
    kind: "SECONDARY",
    points: [
      { x: 40, y: -8 },
      { x: 45, y: -13 },
      { x: 50, y: -18 }
    ]
  },
  {
    id: "forestry_road",
    kind: "SECONDARY",
    points: [
      // The haul road: off the ring, along the stand, and into the loading yard at its far end.
      { x: -9, y: 28 },
      { x: -14, y: 28 },
      { x: -18, y: 31 },
      { x: -21, y: 34 }
    ]
  },
  {
    id: "east_gate_road",
    kind: "SECONDARY",
    points: [
      // The approach to the field's east gate, so the town's street is the field's other entrance.
      { x: 42, y: 16 },
      { x: 40, y: 15 },
      { x: 38.5, y: 14.5 }
    ]
  },
  {
    id: "west_gate_road",
    kind: "SECONDARY",
    points: [
      { x: -10, y: 18 },
      { x: -9, y: 16 },
      { x: -4.5, y: 14.5 }
    ]
  },
  {
    id: "settlement_loop",
    kind: "PATH",
    points: [
      // The street around the square: the plaza, the market row, the well, and the way back.
      { x: 39, y: -1 },
      { x: 49, y: -1 },
      { x: 49, y: 8 },
      { x: 39, y: 8 },
      { x: 39, y: -1 }
    ]
  },
  {
    id: "orchard_lane",
    kind: "PATH",
    points: [
      // The lane along the orchard's headland: the far side of the rows, where the grass strip is.
      { x: -20, y: -17 },
      { x: -24, y: -20 }
    ]
  },
  {
    id: "pasture_lane",
    kind: "PATH",
    points: [
      { x: -19, y: 16 },
      { x: -19, y: 22 }
    ]
  },
  {
    id: "harbour_boardwalk",
    kind: "PATH",
    points: [
      { x: 53, y: 53 },
      { x: 55, y: 56 }
    ]
  },
  {
    id: "mining_road",
    kind: "SECONDARY",
    points: [
      // Off the ring into the highland the island is keeping for quarrying: the reserve has no
      // building and no system yet, but a piece of land nothing can reach is not part of the island.
      { x: 28, y: -9 },
      { x: 30, y: -15 },
      { x: 33, y: -20 },
      { x: 34, y: -25 }
    ]
  },
  {
    id: "farm_track",
    kind: "PATH",
    points: [
      // The farm's own track: from the barn's yard, across the fields, to the western parcels. A path
      // and not a road - it is what a tractor follows between two fields - which is why it is the one
      // way the network is allowed to cross the land the catalogue sells.
      { x: 39, y: -4 },
      { x: 33, y: 0 },
      { x: 26, y: 5 },
      { x: 18, y: 9 },
      { x: 10, y: 12 },
      { x: 3, y: 16 }
    ]
  }
];

/**
 * The lake, in tile coordinates. Water is visual and non-walkable; there is no fishing yet.
 *
 * It sits in the freshwater basin on the island's southern flank, on the low side of the relief
 * where water actually collects, with the reedy bank, the stepping platform, and the wetland around
 * it. The district is *about* water; this ellipse is the water itself, and it is the only one.
 */
export const POND = {
  center: { x: -3, y: 45 },
  radiusX: 5,
  radiusY: 3.8
} as const;

/**
 * The settlement's square: the one paved place on the island.
 *
 * A compact, slightly irregular plaza rather than a slab, with grass at its edge and the buildings
 * facing onto it. It is drawn in the plaza material - the same palette as the road, a different
 * surface - which is what makes the town read as a place rather than as buildings that happen to be
 * near each other.
 */
export const PLAZA = {
  center: { x: 45, y: 3 },
  radiusX: 4.6,
  radiusY: 3.4,
  rotationY: 0.06
} as const;

/**
 * The harbour: a quay that starts on land, crosses the shoreline, and ends on water.
 *
 * `root` is where the pier meets the beach and `bearing` is the direction the deck runs in, both
 * consulted by the dock's geometry. The yard and the fish store stand behind the root, on the land
 * side, which is the order a working quay actually has: road, yard, store, dock, boat, cages, sea.
 */
export const HARBOUR = {
  root: { x: 53, y: 53 },
  /** Direction of the deck, in radians about Y: local +z of the harbour group. */
  bearing: Math.PI / 4,
  lengthTiles: 6.4,
  deckWidthTiles: 1.7,
  yard: { x: 50, y: 50 }
} as const;

/**
 * The forest's loading yard: where a haul road ends and cut timber is stacked.
 *
 * A clearing with a log pile, a stack of planks and the ground churned bare by dragging, at the far
 * end of the haul road. It is the thing that makes managed woodland read as *managed* rather than as
 * a wood that happens to have straight rows.
 */
export const LOGGING_YARD = {
  center: { x: -21, y: 34 },
  radiusTiles: 3.4,
  rotationY: -0.15
} as const;

/**
 * The fish farm: the raft of cages in the bay, moored in rows.
 *
 * Placed from the island's own outline rather than from hand-picked coordinates, so "in water" is
 * true as long as the coastline is: `parameter` walks along the bay and `distance` steps out past
 * the waterline. Three cages to a row and two rows, which is what turns a scatter of frames into a
 * farm.
 */
export const FISH_FARM = {
  /** Shore parameter of the first cage, in radians around the island. */
  firstParameter: 0.30,
  /** How far along the shore each cage in a row sits. */
  parameterStep: 0.085,
  /** How far past the waterline each row floats, in shore units. */
  rowDistances: [1.06, 1.14],
  /** Cages per row. */
  perRow: 3
} as const;

/**
 * The planned aquaculture water: the bay the fish farm is moored in, and nothing else.
 *
 * An `AQUACULTURE` cell is a cell of *planned production water*. The open sea is not one: a player
 * who clicks mid-ocean must be told the cell has no use, which is only possible if the plan drew a
 * line around the part of the bay that does. The area is centred on the cages the renderer already
 * places, so the logical cells and the floating frames are the same place.
 */
export const AQUACULTURE_ZONE = {
  center: { x: 64, y: 47 },
  radiusX: 7,
  radiusY: 5.5
} as const;

/**
 * The mining reserve: highland the island is keeping for quarrying it has not designed yet.
 *
 * On the northern ridge between the two woods - rocky, high, and as far from the town, the fields,
 * the lake, and the harbour as the island allows, which is what a quarry needs before it needs
 * anything else. Zone metadata only: no building, no resource, no gameplay, and the ground stays as
 * natural as it was.
 */
export const MINING_RESERVE = {
  center: { x: 34, y: -22 },
  radiusX: 7,
  radiusY: 5.5
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
  /**
   * Which way the furrows run, in radians about Y.
   *
   * The block's own outline stays axis-aligned on the tile grid - the reserve is a square and the
   * land inside it is measured in tiles - so this is the *ploughing* direction, not the parcel's.
   * Fields worked by the same gang of machines share a direction; the next gang works across them.
   */
  readonly rotationY: number;
  /** How the parcel reads: a field in cultivation, or the yard the machines stand on. */
  readonly kind: "CULTIVATED" | "FALLOW" | "YARD";
}

/**
 * The agricultural heartland, drawn as a working farm rather than as a grid of test squares.
 *
 * Six fields of three different sizes, spaced unevenly, worked in two directions, with grass strips
 * between them and a machine yard at the southern end - which is what a farm looks like from above,
 * and what the estate camera has to be able to read in five seconds. Every parcel sits on land the
 * catalogue has not sold yet, so the moment a plot is bought its tiles and its apron paint over the
 * parcel underneath it.
 */
export const FIELD_BLOCKS: readonly FieldBlock[] = [
  // The northern band: the biggest field in the north-west, worked along the ridge, and the block
  // beside it worked across, so the two read as two gangs of machines rather than one pattern.
  { id: "field_north_west", bounds: { minX: 14, maxX: 21, minY: 3, maxY: 9 }, rotationY: 0, kind: "CULTIVATED" },
  { id: "field_north_east", bounds: { minX: 26, maxX: 33, minY: 2, maxY: 9 }, rotationY: Math.PI / 2, kind: "CULTIVATED" },
  // The middle band: three fields, the widest of them between the other two, all worked across the
  // slope by the same gang.
  { id: "field_west", bounds: { minX: 3, maxX: 9, minY: 14, maxY: 21 }, rotationY: Math.PI / 2, kind: "CULTIVATED" },
  { id: "field_middle", bounds: { minX: 14, maxX: 22, minY: 14, maxY: 21 }, rotationY: Math.PI / 2, kind: "CULTIVATED" },
  { id: "field_east", bounds: { minX: 26, maxX: 33, minY: 14, maxY: 21 }, rotationY: Math.PI / 2, kind: "CULTIVATED" },
  // The southern band: the strips left fallow this season, and the hard standing beyond them.
  { id: "field_south_west", bounds: { minX: 3, maxX: 9, minY: 27, maxY: 33 }, rotationY: 0, kind: "FALLOW" },
  // The smallest parcel on the reserve, which is what a hierarchy of fields needs at its bottom end.
  { id: "field_south", bounds: { minX: 15, maxX: 20, minY: 27, maxY: 32 }, rotationY: 0, kind: "FALLOW" },
  { id: "machine_yard", bounds: { minX: 26, maxX: 33, minY: 26, maxY: 30 }, rotationY: 0, kind: "YARD" }
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
  // Meadow, in the places a farm leaves to grass: the strip between the wood and the fields, the
  // pasture's own open ground, and the southern meadow the island has not decided about.
  { id: "forest_verge_meadow", kind: "MEADOW", center: { x: 24, y: -6 }, radiusX: 9, radiusY: 2.6, rotationY: 0.1 },
  { id: "pasture_meadow", kind: "MEADOW", center: { x: -15, y: 22 }, radiusX: 4, radiusY: 5.5, rotationY: -0.08 },
  { id: "east_meadow", kind: "MEADOW", center: { x: 56, y: 18 }, radiusX: 4, radiusY: 7.5, rotationY: 0.2 },
  { id: "south_meadow", kind: "MEADOW", center: { x: 26, y: 40 }, radiusX: 9, radiusY: 3.2, rotationY: -0.12 },
  { id: "west_meadow", kind: "MEADOW", center: { x: -22, y: 2 }, radiusX: 4.5, radiusY: 7, rotationY: 0.3 },
  { id: "lake_meadow", kind: "MEADOW", center: { x: -2, y: 38 }, radiusX: 8, radiusY: 2.6, rotationY: 0.06 },
  // Bare ground, where the island works: the ranch yard, the barn's hard standing, and the shore the
  // harbour drags its boats over.
  { id: "ranch_dirt", kind: "DIRT", center: { x: -17, y: 10 }, radiusX: 4.4, radiusY: 6, rotationY: 0 },
  { id: "barn_yard_dirt", kind: "DIRT", center: { x: 38, y: -7 }, radiusX: 5, radiusY: 4, rotationY: 0 },
  { id: "harbour_apron", kind: "DIRT", center: { x: 50, y: 50 }, radiusX: 6, radiusY: 4.5, rotationY: 0.4 },
  { id: "lake_shore", kind: "SAND", center: { x: -3, y: 45 }, radiusX: 5.6, radiusY: 4.3, rotationY: 0.05 },
  // The path the residents wear between the farmhouse and the square, and the meadow variation the
  // wilderness needs so it reads as land with a shape rather than as the island's leftover green.
  { id: "farmhouse_path", kind: "DIRT", center: { x: 45, y: -0.6 }, radiusX: 2.2, radiusY: 1.1, rotationY: 0 },
  { id: "wild_meadow_east", kind: "MEADOW", center: { x: 30, y: 52 }, radiusX: 6, radiusY: 3, rotationY: 0.15 },
  { id: "wild_meadow_west", kind: "MEADOW", center: { x: 12, y: 48 }, radiusX: 5, radiusY: 2.6, rotationY: -0.1 },
  { id: "forest_edge_meadow", kind: "MEADOW", center: { x: 30, y: -24 }, radiusX: 7, radiusY: 2.4, rotationY: 0.08 }
];

/**
 * The barn and the yard it stands in, on the settlement's edge where the fields meet the buildings.
 *
 * The barn is the one structure the world has always drawn; the yard around it is a flat area, a
 * road junction, and a collision circle.
 */
export const FARMSTEAD = {
  center: { x: 38, y: -7 },
  // The barn faces the fields it serves: its front looks south, over the fence and the crop rows.
  rotationY: 0
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
  | "OPEN_BARN"
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
  // The town's buildings face the square. Rotation is the frontage, not decoration: the residence
  // looks south onto the plaza, the market looks west onto it across the market row, and the well
  // stands on its western side where the streets meet.
  { id: "farmhouse", kind: "FARMHOUSE", tile: { x: 45, y: -2 }, rotationY: 0, blockingRadiusWorld: 2.6 },
  { id: "market_stall", kind: "MARKET_STALL", tile: { x: 49, y: 3 }, rotationY: -Math.PI / 2, blockingRadiusWorld: 1.2 },
  { id: "well", kind: "WELL", tile: { x: 41, y: 3 }, rotationY: 0, blockingRadiusWorld: 0.85 },
  { id: "storage_shed", kind: "STORAGE_SHED", tile: { x: -18, y: 14 }, rotationY: 0.4, blockingRadiusWorld: 1.6 },
  // The agricultural anchor: the barn and the open barn where the fields meet the town, and the silo
  // at the field's north-east corner. This cluster is what makes the heartland read as a working
  // farm rather than as a pattern of brown rectangles.
  { id: "open_barn", kind: "OPEN_BARN", tile: { x: 42.5, y: -6.5 }, rotationY: 0, blockingRadiusWorld: 1.8 },
  { id: "silo", kind: "SILO", tile: { x: 34.5, y: -4 }, rotationY: 0, blockingRadiusWorld: 1.6 },
  // The orchard's mill, on the slope above the rows, and the pasture's coop out where the animals go.
  { id: "windmill", kind: "WINDMILL", tile: { x: -16, y: -13 }, rotationY: 0.35, blockingRadiusWorld: 1.8 },
  { id: "coop", kind: "COOP", tile: { x: -18, y: 6 }, rotationY: 0.5, blockingRadiusWorld: 1.1 },
  // The bay runs out to the south-east, so the quay faces that way and its pier reaches the water
  // rather than the grass behind it.
  { id: "harbor", kind: "HARBOR", tile: HARBOUR.yard, rotationY: HARBOUR.bearing, blockingRadiusWorld: 1.4 }
];

/**
 * Where the character appears: on the primary road, south of the fence and outside every tile the
 * farm can own, so it never starts inside a crop, a tree, a landmark, or water. The south gate opens
 * onto the same road, so walking north from here enters the field.
 */
export const SPAWN_TILE: TileCoordinate = { x: WORLD_ORIGIN_TILE_X, y: 41 };

/**
 * The island's set dressing: the six places that are furnished rather than decorated.
 *
 * This is the composition layer V10 adds, and it is the reason a building no longer stands alone. A
 * preset is an anchor, a facing, and a handful of authored props in the anchor's own frame; every
 * offset here was placed by eye against a screenshot, which is the only way a yard ends up looking
 * like a yard. The props are decoration in the strict sense: nothing here is a tile, a rule, a price,
 * or a collision, and the only thing the rest of the world reads from a preset is the ground it asks
 * to keep clear.
 *
 * Six places, in the order the island's economy happens in them: the barn works the fields, the
 * market sells what the fields grew, the farmhouse is where the farmer lives, the orchard packs its
 * fruit, the timber yard stacks what the wood produced, and the quay lands the catch.
 */
export const COMPOSITION_PRESETS: readonly EnvironmentCompositionPreset[] = [
  {
    id: "barn_yard_t1",
    district: "SETTLEMENT",
    anchor: FARMSTEAD.center,
    rotationY: 0,
    clearanceTiles: 6.5,
    props: [
      // The working half of the yard, on the side the barn doors open onto and clear of the open barn
      // four tiles east: the wagon is turned, the produce is stacked where the cart can reach it, and
      // the tools are kept on the dry side against the fence.
      { assetId: "prop_wagon", offsetX: -3.0, offsetY: 3.0, rotationY: 0.42, scale: 1 },
      { assetId: "prop_crate_produce", offsetX: -4.2, offsetY: 1.4, rotationY: -0.3, scale: 1 },
      { assetId: "prop_crate_empty", offsetX: -4.8, offsetY: 2.3, rotationY: 0.2, scale: 1 },
      { assetId: "prop_sack", offsetX: -2.2, offsetY: 3.6, rotationY: 0.6, scale: 1 },
      { assetId: "prop_sack", offsetX: -1.5, offsetY: 4.0, rotationY: -0.4, scale: 0.9 },
      { assetId: "prop_barrel", offsetX: 0.6, offsetY: 3.4, rotationY: 0.2, scale: 1 },
      { assetId: "prop_barrel", offsetX: 1.3, offsetY: 4.0, rotationY: -0.5, scale: 0.9 },
      { assetId: "prop_bucket", offsetX: -1.0, offsetY: 3.0, rotationY: 0.9, scale: 1 },
      { assetId: "prop_workbench", offsetX: -5.0, offsetY: -1.2, rotationY: Math.PI / 2, scale: 1 },
      { assetId: "prop_chest", offsetX: -4.6, offsetY: -2.4, rotationY: 0.3, scale: 1 },
      { assetId: "prop_whetstone", offsetX: -3.6, offsetY: -3.0, rotationY: 0, scale: 1 },
      // A short fence run on the field side, so the yard has an edge rather than fading into grass.
      { assetId: "prop_fence_rail_long", offsetX: -6.2, offsetY: -0.5, rotationY: 0, scale: 1 },
      { assetId: "prop_fence_rail_long", offsetX: -6.2, offsetY: 1.7, rotationY: 0, scale: 1 },
      { assetId: "prop_fence_rail", offsetX: -6.2, offsetY: 3.7, rotationY: 0, scale: 1 }
    ]
  },
  {
    id: "market_square_t1",
    district: "SETTLEMENT",
    anchor: PLAZA.center,
    rotationY: 0,
    clearanceTiles: 6,
    props: [
      // Two stalls face into the square from opposite sides, with the produce they sell between them.
      { assetId: "prop_stall", offsetX: -2.9, offsetY: -0.8, rotationY: -Math.PI / 2, scale: 1 },
      { assetId: "prop_stall_cart", offsetX: 2.2, offsetY: 1.3, rotationY: 0.35, scale: 1 },
      { assetId: "prop_crate_produce", offsetX: -1.8, offsetY: 1.3, rotationY: 0.3, scale: 1 },
      { assetId: "prop_crate_carrot", offsetX: -1.1, offsetY: 1.6, rotationY: -0.2, scale: 1 },
      { assetId: "prop_barrel_apples", offsetX: 1.1, offsetY: -1.5, rotationY: 0.4, scale: 1 },
      { assetId: "prop_barrel", offsetX: 1.7, offsetY: -1.0, rotationY: -0.3, scale: 0.95 },
      { assetId: "prop_sack", offsetX: 0.5, offsetY: 1.9, rotationY: 0.5, scale: 1 },
      { assetId: "prop_sack", offsetX: 1.0, offsetY: 1.5, rotationY: -0.3, scale: 0.9 },
      { assetId: "prop_bench", offsetX: -0.4, offsetY: -2.1, rotationY: 0, scale: 1 },
      { assetId: "prop_bench", offsetX: 2.4, offsetY: 0.5, rotationY: Math.PI / 2, scale: 1 },
      { assetId: "prop_planter", offsetX: -2.1, offsetY: -1.9, rotationY: 0.2, scale: 1 },
      { assetId: "prop_planter", offsetX: 2.7, offsetY: -1.7, rotationY: -0.4, scale: 0.9 },
      { assetId: "prop_lantern", offsetX: -3.1, offsetY: -2.3, rotationY: 0, scale: 1 },
      { assetId: "prop_crate_empty", offsetX: 0.3, offsetY: -0.7, rotationY: 0.8, scale: 1 }
    ]
  },
  {
    id: "farmhouse_yard_t1",
    district: "SETTLEMENT",
    anchor: { x: 45, y: -2 },
    rotationY: 0,
    clearanceTiles: 5,
    props: [
      // Inhabited rather than busy: two planters on the frontage, a bench under the window, and the
      // utility props the residents would leave at the back of the house.
      { assetId: "prop_planter", offsetX: -3.4, offsetY: 0.7, rotationY: 0.2, scale: 1 },
      { assetId: "prop_planter", offsetX: 3.4, offsetY: 0.7, rotationY: -0.2, scale: 1 },
      { assetId: "prop_bench", offsetX: 0, offsetY: -3.3, rotationY: Math.PI, scale: 1 },
      { assetId: "prop_barrel", offsetX: -4.3, offsetY: -0.8, rotationY: 0.3, scale: 1 },
      { assetId: "prop_crate_empty", offsetX: 4.3, offsetY: -1.0, rotationY: 0.5, scale: 1 },
      { assetId: "prop_bucket", offsetX: -2.9, offsetY: -2.7, rotationY: 0.6, scale: 1 },
      { assetId: "prop_lantern", offsetX: 2.7, offsetY: -2.9, rotationY: 0, scale: 1 },
      { assetId: "prop_sack", offsetX: 4.1, offsetY: 1.9, rotationY: 0.4, scale: 1 },
      { assetId: "prop_chest", offsetX: -4.5, offsetY: 1.3, rotationY: 0.15, scale: 1 }
    ]
  },
  {
    id: "orchard_yard_t1",
    district: "ORCHARD",
    anchor: { x: -19.5, y: -16 },
    rotationY: -0.22,
    clearanceTiles: 3.4,
    props: [
      // The picking station at the end of the row the orchard lane runs to: what was picked, and what
      // it is carried away in.
      { assetId: "prop_crate_produce", offsetX: 0.7, offsetY: 1.0, rotationY: 0.3, scale: 1 },
      { assetId: "prop_crate_carrot", offsetX: -0.6, offsetY: 1.2, rotationY: -0.2, scale: 1 },
      { assetId: "prop_sack", offsetX: 0.2, offsetY: 1.9, rotationY: 0.5, scale: 1 },
      { assetId: "prop_barrel_apples", offsetX: -1.5, offsetY: 0.6, rotationY: 0.4, scale: 1 },
      { assetId: "prop_wagon", offsetX: 2.1, offsetY: -0.4, rotationY: 0.5, scale: 1 }
    ]
  },
  {
    id: "logging_yard_t1",
    district: "FORESTRY",
    anchor: LOGGING_YARD.center,
    rotationY: LOGGING_YARD.rotationY,
    clearanceTiles: 4.6,
    props: [
      // The bench and the sharpening station are where the saws are worked on; the crates are where
      // the sawn stock is stacked; the anvil log is the stump everything is cut on.
      { assetId: "prop_workbench", offsetX: -1.7, offsetY: 1.3, rotationY: 0.4, scale: 1 },
      { assetId: "prop_whetstone", offsetX: -2.7, offsetY: 1.9, rotationY: 0, scale: 1 },
      { assetId: "prop_axe", offsetX: -1.1, offsetY: 2.1, rotationY: 0.3, scale: 1 },
      { assetId: "prop_anvil_log", offsetX: -2.9, offsetY: -1.5, rotationY: 0.2, scale: 1 },
      { assetId: "prop_crate_wooden", offsetX: 1.9, offsetY: -1.3, rotationY: -0.4, scale: 1 },
      { assetId: "prop_crate_empty", offsetX: 2.5, offsetY: -0.7, rotationY: 0.2, scale: 1 },
      { assetId: "prop_chest", offsetX: 0.7, offsetY: -2.1, rotationY: 0.5, scale: 1 },
      { assetId: "prop_bucket", offsetX: 1.5, offsetY: 1.7, rotationY: 0.8, scale: 1 }
    ]
  },
  {
    id: "fishery_t1",
    district: "COAST",
    anchor: HARBOUR.yard,
    rotationY: HARBOUR.bearing,
    clearanceTiles: 5.5,
    props: [
      // Between the store and the deck, in the order a catch moves through a quay.
      { assetId: "prop_barrel", offsetX: -1.9, offsetY: -1.3, rotationY: 0, scale: 1 },
      { assetId: "prop_barrel", offsetX: 2.1, offsetY: -1.5, rotationY: 0.5, scale: 0.95 },
      { assetId: "prop_crate_empty", offsetX: 0.7, offsetY: -1.9, rotationY: 0.3, scale: 1 },
      { assetId: "prop_crate_wooden", offsetX: 1.7, offsetY: 0.5, rotationY: -0.3, scale: 1 },
      { assetId: "prop_bucket", offsetX: 0.3, offsetY: 1.3, rotationY: 0.7, scale: 1 },
      { assetId: "prop_rope", offsetX: -1.5, offsetY: 1.7, rotationY: 0.6, scale: 1 },
      { assetId: "prop_rope", offsetX: 1.1, offsetY: 2.3, rotationY: -0.5, scale: 0.9 },
      { assetId: "prop_cage_small", offsetX: -2.5, offsetY: 1.1, rotationY: 0.2, scale: 1 },
      { assetId: "prop_chest", offsetX: -0.9, offsetY: -1.7, rotationY: 0.4, scale: 1 }
    ]
  }
];

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
    around({ x: (FARM_FIELD_BOUNDS.minX + FARM_FIELD_BOUNDS.maxX + 1) / 2, y: (FARM_FIELD_BOUNDS.minY + FARM_FIELD_BOUNDS.maxY + 1) / 2 }, 21, 21, 5),
    around(POND.center, POND.radiusX + 2.5, POND.radiusY + 2.5, 3),
    around(FARMSTEAD.center, 6, 6, 3),
    around({ x: PLAZA.center.x, y: PLAZA.center.y }, 13, 11, 4),
    around(HARBOUR.yard, 11, 9, 3)
  ];
}

/**
 * The broad rise that makes the island's upland, pointing north-east across it.
 *
 * The terrain follows the plan rather than the plan following the terrain: the natural forest sits on
 * the highest, roughest ground, the orchard on a gentle slope beside the fields, and the harbour and
 * the wetland on the low side where the water is.
 */
export const ISLAND_UPLANDS: readonly UplandBias[] = [
  // The northern highland: the broad rise the natural wood stands on, running from the north-west
  // shoulder to the north-eastern headland.
  { normalX: 0.55, normalZ: -0.83, weight: 0.6 },
  // The orchard's own shoulder, a gentler second rise to the north-west, so the perennial side of
  // the island has a shape of its own instead of being the flat end of one slope.
  { normalX: -0.45, normalZ: -0.89, weight: 0.18 }
];

/**
 * Height of the tallest hill above the flat ground, in world units.
 *
 * Raised in V7. At 6.5 the island read as a plate with a pattern painted on it from the estate
 * camera: relief is what gives a landscape a near side and a far side, and without it every district
 * sits on the same plane and the composition flattens out. The farm, the settlement, the pond, and
 * the quay are still held dead flat by `terrainFlatAreas`, so the gameplay surfaces stay usable.
 */
export const TERRAIN_RELIEF_WORLD = 8;

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
  plaza: PLAZA,
  harbour: HARBOUR,
  loggingYard: LOGGING_YARD,
  fishFarm: FISH_FARM,
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
