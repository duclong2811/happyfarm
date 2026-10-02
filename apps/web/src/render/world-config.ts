import type { TileBounds, TileCoordinate, WorldFrame } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, WORLD_ORIGIN_TILE_X, worldFrame } from "./layout";
import {
  islandRadiusAt,
  type FlatArea,
  type IslandLobe,
  type IslandShape,
  type TerrainShape,
  type UplandBias,
  type VolcanoShape
} from "./terrain-height";
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
 * The places the island itself owns.
 *
 * Two, and the list is deliberately shrinking rather than growing. V12.1 removed the *production*
 * districts' meaning; V12.2 deletes the entries themselves, because a name like "orchard" or
 * "managed wood" that no longer describes anything is a name the next pass will mistake for a rule.
 * What is left is what the island actually keeps for itself: the village, and the harbour it sits
 * beside. Land use everywhere else is `CellCapability` on the cell, and the player's own.
 */
export type DistrictKind = "SETTLEMENT" | "COAST";

/**
 * One place the island keeps for itself: a blob with a centre, two radii, and a rotation.
 *
 * A blob rather than a rectangle, so a civic edge is not a straight line except where a road gives it
 * one. A district does not unlock, block, or price anything, and since V12.2 nothing reads it for
 * scenery either: it exists so the settlement has a middle and the harbour has a place, and so
 * `districtAt` can answer "is this civic ground?" for the cell map and the building plan.
 */
export interface District {
  readonly id: string;
  readonly kind: DistrictKind;
  readonly labelKey: string;
  readonly center: TileCoordinate;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationY: number;
}

/**
 * The island's woodland masses.
 *
 * A grove is *landscape*, not a district and not a claim: it says where trees grow today, which is a
 * fact about the place rather than a rule about the land. A player who wants that ground clears it
 * and builds there, exactly as they would clear any other tree; nothing here is ownership, capability,
 * or production, and `CellCapability` remains the only thing that says what a cell may become.
 *
 * They exist because removing the forest districts left the island with no large vegetation at all:
 * scattered clusters read as scrub, and an island with no woods loses the depth that makes the open
 * ground between them read as *open*. Two masses, deliberately apart, with the volcano's foothill
 * between them.
 */
export interface WoodlandPatch {
  readonly id: string;
  readonly center: TileCoordinate;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationY: number;
}

export const WOODLANDS: readonly WoodlandPatch[] = [
  {
    id: "wood_north",
    // The northern mass, running along the shoulder the volcano rises out of - the forested foothill
    // the volcano's own gradient thins into as the ground climbs.
    center: { x: 12, y: -18 },
    radiusX: 16,
    radiusY: 9,
    rotationY: 0.06
  },
  {
    id: "wood_east",
    // A second, smaller mass on the north-eastern headland. Two woods with open ground between them
    // read as a landscape; one band around the whole north edge reads as a painted border.
    center: { x: 50, y: -16 },
    radiusX: 10,
    radiusY: 8,
    rotationY: 0.2
  }
];

/**
 * The two places the island keeps for itself, and nothing else.
 *
 * V12.2 deleted the rest: cropland, orchard, pasture, "managed wood", the freshwater basin, and the
 * reserve the plan had left undecided. None of them described anything any more - the production
 * presentation they existed for was removed in V12.1, and nothing reads a district to decide scenery,
 * ground, or capability since. A name with no reader is a name the next pass treats as a rule, so
 * they are gone rather than deprecated.
 *
 * What remains is what the island genuinely owns: the village, which is civic ground, and the coast
 * the harbour stands on. Ordinary land is `CellCapability` on the cell and the player's own.
 */
export const DISTRICTS: readonly District[] = [
  {
    id: "settlement",
    kind: "SETTLEMENT",
    labelKey: "world.district.settlement",
    // The community the island already has: the square at its middle, the buildings facing onto it,
    // the barn on its western edge where the working land begins, and reserved ground for the town
    // hall and the warehouse that a later pass will build. It is a *civic area*, not a production
    // district - the player's fields are their own business and they start nowhere near here.
    center: { x: 44, y: 2 },
    radiusX: 13,
    radiusY: 11,
    rotationY: 0
  },
  {
    id: "coast",
    kind: "COAST",
    labelKey: "world.district.coast",
    // The bay the harbour stands in, on the south-east flank: the quay, the yard behind it, and the
    // water the boats moor in. The water is protected so that nothing a player places can block the
    // pier - the one piece of the island where a *rule* is allowed to keep the sea clear.
    center: { x: 44, y: 44 },
    radiusX: 12,
    radiusY: 8,
    rotationY: 0.5
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
 * The places the road network has to reach, by name.
 *
 * A road names the stops it makes rather than only the pixels it passes through, so "is every
 * district connected" is a question about a graph instead of a question about a screenshot. The
 * anchor is the tile a stop sits on; the road's own waypoints are what make the shape.
 */
export type RoadNodeId =
  | "harbour"
  | "harbour_yard"
  | "civic"
  | "plaza"
  | "farm_hub"
  | "agriculture"
  | "highland";

/**
 * A road: a polyline through the landscape, the class that decides how wide it is drawn, and the
 * stops along it.
 *
 * Roads are the map's explanation. One stone spine runs from the harbour, through the harbour yard
 * and the settlement's square, to the farm hub. Dirt roads leave that hub for the orchard, the
 * managed wood, the lake, and the quarry reserve. Paths are the last few metres into a place - a
 * lane between two fields, a lane under the orchard rows, a footpath to the water.
 *
 * Every `PRIMARY` and `SECONDARY` road runs *around* the reserved field rather than through it: a
 * plot the catalogue sells must never have a highway crossing it. A `PATH` may cross the reserve,
 * because the farm track is how a tractor gets between two fields and that is exactly where it
 * belongs.
 */
export interface Road {
  readonly id: string;
  readonly kind: RoadKind;
  /** The stops this road passes through, in order. Consecutive pairs are the graph's edges. */
  readonly connects: readonly RoadNodeId[];
  readonly points: readonly TileCoordinate[];
}

/**
 * How wide each class of road is drawn, in tiles.
 *
 * Three classes, three widths, and the gaps between them are wide enough to read from the estate
 * camera. V12.2 widened the middle class: the island's own road is now a *dirt* road, and a dirt road
 * that has to carry the eye from the harbour to the village from the estate camera needs more than the
 * narrow track it used to be. `PRIMARY` is kept because the player's stone and paved tiers will draw
 * with it; nothing the island authors uses it any more.
 */
export const ROAD_WIDTH_TILES: Readonly<Record<RoadKind, number>> = {
  PRIMARY: 2.9,
  // The island's own road. V12.3 brought this down from 2.2: at estate zoom the dirt road read as a
  // highway rather than a farm track. One and three-quarter cells is wide enough for a cart to pass a
  // walker and no wider.
  SECONDARY: 1.75,
  PATH: 1.1
};

/**
 * How much wider than the road itself each class's shoulder is drawn, in world metres.
 *
 * The shoulder is the soft fringe every road sits in, and it belongs here rather than in the
 * renderer because it is part of the road's *width*: scenery clearance has to be measured from the
 * edge a player can see, and a rule that only knew about the ribbon left trees standing on the
 * shoulder of a wide road. One table, two readers - `terrain.ts` draws it and `placement.ts` clears
 * it.
 */
export const ROAD_SHOULDER_WORLD: Readonly<Record<RoadKind, number>> = {
  PRIMARY: 0.3,
  SECONDARY: 0.26,
  PATH: 0.15
};

export const ROADS: readonly Road[] = [
  {
    id: "harbour_spine",
    kind: "SECONDARY",
    connects: ["harbour", "harbour_yard", "civic", "plaza"],
    points: [
      // The island's one road, in the order a cart travels it: off the quay at the south-east bay, up
      // the waterfront, and into the settlement. It hugs the island's east flank so it never has to
      // cross the reserve, and it climbs nothing: the harbour yard and the town are both held flat.
      //
      // It is **dirt**, and that is the V12.2 correction: the island is undeveloped, so the only road
      // it supplies is the cheapest one that works. The paving starts inside the village, where the
      // plaza is, and the transition between the two is the whole visual story of the road.
      //
      // Three waypoints, because that is what a built road is: the quay, the one corner where the
      // waterfront leg turns inland, and the village entrance. V13.1 cut this from eight points to
      // three and the road from a spline to a surveyed alignment: the eight points were a shuffle
      // westward that only existed to give the spline something to do, and the spline turned the one
      // real corner - the 39 degrees at the harbour yard - into a hook that began at the quay.
      //
      // The last waypoint sits just *inside* the paved rim of the square, not at its centre. Dirt
      // that stops at the paving edge leaves a sliver of grass at the corners of its own end cap;
      // dirt that reaches a few decimetres under the paving meets it with no seam at all, and the
      // paving is the top surface there, so the square stays paved. Past the village the road is the
      // *player's*: everything beyond the settlement is ground somebody has to build on.
      { x: 53, y: 53 },
      { x: 50, y: 50 },
      { x: 45.9, y: 5.4 }
    ]
  },
  {
    id: "farm_road",
    kind: "SECONDARY",
    connects: ["plaza", "farm_hub"],
    points: [
      // The village's own working road: the dirt that starts where the paving stops and runs out to
      // the barn's yard. A stone surface in the settlement and a warm earth one outside it is the
      // whole road hierarchy in two hundred metres, and it is the last stretch the island authors.
      //
      // Two waypoints: a straight spur from the square's north-west rim to the yard. It used to
      // leave the square's centre north-east and then bend back west, which painted a dirt blot in
      // the middle of the one paved place on the island and described a detour nothing needed.
      { x: 43.4, y: -0.3 },
      { x: 41, y: -4 }
    ]
  },
  {
    id: "village_street",
    kind: "PATH",
    connects: ["plaza"],
    points: [
      // The street around the square: past the market row, the well, and back. It is what makes the
      // buildings face a *place* rather than stand beside each other.
      { x: 40.5, y: -1 },
      { x: 48.4, y: -0.4 },
      { x: 49.6, y: 4 },
      { x: 47.8, y: 8.6 },
      { x: 41.2, y: 8.2 },
      { x: 39.8, y: 3.6 },
      { x: 40.5, y: -1 }
    ]
  },
  {
    id: "harbour_boardwalk",
    kind: "PATH",
    connects: ["harbour"],
    points: [
      // The quay's own walkway, out over the water to the moored boats.
      { x: 53, y: 53 },
      { x: 55, y: 56 }
    ]
  },
  {
    id: "north_road",
    /**
     * A **path**, not a road.
     *
     * V12.2's rule is that the island supplies only the infrastructure it needs. The harbour road is
     * needed: the settlement lives off the sea. The way to the volcano is a walk to a landmark, so it
     * is a footpath - narrow, unpaved, and obviously not something a cart uses - and the ground it
     * crosses stays the player's to develop around.
     */
    kind: "PATH",
    connects: ["plaza", "highland"],
    points: [
      // The island's second road, and the only other one it authors: out of the village's own gate,
      // north-west up the gentle ground, and stopping on the volcano's lower flank. It is dirt rather
      // than stone because it is a rural access route rather than civic infrastructure - and it stops
      // *before* the steep ground, because nothing should be climbing the landmark.
      //
      // It leaves from the square's own north-west rim, like the lane to the barn, rather than from
      // the square's middle: a footpath across the paving is one more line painted on the one paved
      // place on the island.
      { x: 44.3, y: -0.4 },
      { x: 41, y: -7 },
      { x: 37, y: -10 },
      { x: 32, y: -12 },
      { x: 27, y: -14 },
      { x: 26.5, y: -13 }
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
  { id: "forest_edge_meadow", kind: "MEADOW", center: { x: 30, y: -24 }, radiusX: 7, radiusY: 2.4, rotationY: 0.08 },
  // The farmland's own margin: the ring of ground around the reserve, where a young farm leaves rough
  // grass, a hedgerow that has not been laid, and the stones it has pulled out of the ploughing. The
  // reserve itself is not tinted - the apron and its tiles cover it - so these sit just outside it.
  { id: "margin_meadow_north", kind: "MEADOW", center: { x: 14, y: -4 }, radiusX: 8, radiusY: 2.4, rotationY: 0.05 },
  { id: "margin_meadow_east", kind: "MEADOW", center: { x: 44, y: 24 }, radiusX: 3.5, radiusY: 8, rotationY: 0.15 },
  { id: "margin_meadow_south", kind: "MEADOW", center: { x: 14, y: 40 }, radiusX: 7, radiusY: 2.8, rotationY: -0.06 },
  { id: "margin_meadow_west", kind: "MEADOW", center: { x: -5, y: 26 }, radiusX: 2.6, radiusY: 6, rotationY: -0.2 },
  // The southern slopes, which the estate view reads as the far end of the island: colour variation
  // rather than objects, so the ground has a shape without the coast turning into a prop display.
  { id: "margin_meadow_south_east", kind: "MEADOW", center: { x: 36, y: 48 }, radiusX: 8, radiusY: 3.2, rotationY: 0.2 },
  { id: "margin_meadow_coast", kind: "MEADOW", center: { x: 52, y: 38 }, radiusX: 3.4, radiusY: 7, rotationY: 0.35 }
];

/**
 * A grove, a thicket, or an outcrop on the farmland's margin.
 *
 * The crop district is deliberately empty of scenery inside the reserve, because that land belongs to
 * the catalogue - but its blob reaches several tiles past the reserve's edge, and a bare ring around a
 * farm reads as a green plane rather than as countryside. These are the places that ring is broken
 * up, authored one by one rather than scattered: a wood's southern verge, the stones rolled off the
 * ploughing, the hedge nobody has laid yet.
 *
 * A grove is a centre, a radius, and a member count, and its members follow the same cluster rules the
 * districts use. Nothing here is gameplay: no grove is a tile, a rule, or a collision.
 */
export interface MarginGrove {
  readonly id: string;
  readonly kind: "GROVE" | "THICKET" | "ROCKS" | "FLOWERS";
  readonly center: TileCoordinate;
  readonly radiusTiles: number;
  readonly members: number;
}

export const FIELD_MARGIN_GROVES: readonly MarginGrove[] = [
  { id: "margin_grove_north", kind: "GROVE", center: { x: 6, y: -5 }, radiusTiles: 3.2, members: 16 },
  { id: "margin_thicket_west", kind: "THICKET", center: { x: -6, y: 20 }, radiusTiles: 3, members: 14 },
  { id: "margin_rocks_west", kind: "ROCKS", center: { x: -7, y: 32 }, radiusTiles: 2.4, members: 11 },
  { id: "margin_grove_south_west", kind: "GROVE", center: { x: 2, y: 40 }, radiusTiles: 3.4, members: 16 },
  { id: "margin_thicket_south", kind: "THICKET", center: { x: 34, y: 40 }, radiusTiles: 3.2, members: 15 },
  { id: "margin_flowers_south_east", kind: "FLOWERS", center: { x: 44, y: 40 }, radiusTiles: 3, members: 16 },
  { id: "margin_grove_east", kind: "GROVE", center: { x: 52, y: 22 }, radiusTiles: 3.4, members: 16 },
  { id: "margin_rocks_east", kind: "ROCKS", center: { x: 55, y: 6 }, radiusTiles: 2.6, members: 12 },
  { id: "margin_thicket_north_east", kind: "THICKET", center: { x: 46, y: -18 }, radiusTiles: 3.4, members: 15 },
  // The southern slopes: the ground between the fields and the island's south coast, which the
  // five-second test reads as the empty end of the estate if nothing stands on it.
  { id: "margin_grove_south_east", kind: "GROVE", center: { x: 40, y: 46 }, radiusTiles: 3.6, members: 16 },
  { id: "margin_rocks_south", kind: "ROCKS", center: { x: 26, y: 52 }, radiusTiles: 3, members: 13 },
  { id: "margin_thicket_coast", kind: "THICKET", center: { x: 52, y: 40 }, radiusTiles: 3.2, members: 14 }
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
 * Where each road stop is, in tile coordinates.
 *
 * Every one is derived from the definition it belongs to - the quay root from `HARBOUR`, the hub
 * from `FARMSTEAD`, the mill yard from `LOGGING_YARD` - so a stop cannot drift away from the place
 * it names when the place moves.
 */
export const ROAD_NODES: Readonly<Record<RoadNodeId, TileCoordinate>> = {
  harbour: HARBOUR.root,
  harbour_yard: HARBOUR.yard,
  civic: { x: 44, y: 8 },
  plaza: PLAZA.center,
  // The yard in front of the barn, not the barn itself: the hub is where the roads meet, and a road
  // that ends inside a building is a road that ends nowhere.
  farm_hub: { x: 41, y: -4 },
  agriculture: { x: 17, y: 17 },
  // Where the north road stops: on the volcano's foothill, short of the steep ground. The mountain
  // is the island's landmark, not a through-route, so nothing authored goes further up it.
  highland: { x: 26.5, y: -13 }
};

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
  /**
   * How far the building's own parts reach, when that is more than a walker's circle.
   *
   * `blockingRadiusWorld` is what a *walker* goes around, and a low structure's parts do not reach
   * past it. A windmill's sails do: the tower is under two metres across, and the rotor sweeps three
   * metres, over the heads of anyone walking under it. Decoration is kept out of the larger number,
   * so a treetop cannot grow through a turning sail. Defaults to `blockingRadiusWorld`.
   */
  readonly keepClearRadiusWorld?: number;
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
  // The mill on the slope above the orchard used to stand here as a landmark. It is a *player's*
  // object now: `world.windmill` in the shared starter layout, seeded into `farm_constructions` and
  // drawn from its row like everything else the player may move. Drawing it here as well would be a
  // second windmill standing where the first one used to be.
  //
  // The coop stays: it is out where the animals go, and it is the next slice of the same migration.
  { id: "coop", kind: "COOP", tile: { x: -18, y: 6 }, rotationY: 0.5, blockingRadiusWorld: 1.1 },
  // The bay runs out to the south-east, so the quay faces that way and its pier reaches the water
  // rather than the grass behind it. It stands on the *landward* side of the yard, so the road can
  // run through the yard itself: a store built where the road ends is a store in the way.
  { id: "harbor", kind: "HARBOR", tile: { x: 47.5, y: 48 }, rotationY: HARBOUR.bearing, blockingRadiusWorld: 1.4 }
];

/**
 * Where the character appears: on the primary road, south of the fence and outside every tile the
 * farm can own, so it never starts inside a crop, a tree, a landmark, or water. The south gate opens
 * onto the same road, so walking north from here enters the field.
 */
/**
 * Where the character starts: on the southern edge of the twelve-tile square the player owns.
 *
 * The spawn used to sit on a lane thirty tiles south of the farm, because an authored road ran to it.
 * With the lanes gone there is nothing there, and a player who starts in the middle of open country
 * with their own land out of sight has been given no first move. Thirteen is one tile past the last
 * owned row, so the first thing in front of them is their own field.
 */
export const SPAWN_TILE: TileCoordinate = { x: WORLD_ORIGIN_TILE_X, y: 13 };

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
 * The faint directional bias in the rolling ground.
 *
 * There is no upland any more: the island's height comes from the volcano and a couple of metres of
 * swell, and every other place is a place the player can build on. What is left here is one small
 * northward lean, which is enough to give the harbour side and the volcano side of the island a
 * difference without making either of them a hill.
 */
export const ISLAND_UPLANDS: readonly UplandBias[] = [
  // One faint bias towards the north, so the ground the volcano stands on is a little higher than the
  // harbour side and the landmark has a shoulder to rise out of. Deliberately tiny: the V12.1 brief
  // removes the authored uplands that made the island a bowl with a mountain ring, because most of
  // the island has to read as usable ground. The volcano is the only tall thing that is left.
  { normalX: 0.12, normalZ: -0.99, weight: 0.16 }
];

/**
 * Height of the tallest hill above the flat ground, in world units.
 *
 * Lowered hard in V12.1. V7 raised this to 8 to keep the composition from flattening out, and the
 * result was an island of domes and ridges whose only job was variation: roads climbed hills for no
 * reason, buildable land was cut into fragments, and the silhouette read as procedural. The brief now
 * asks for the opposite - most of the island plainly usable, with one clear landmark - so the rolling
 * ground is a couple of metres of gentle swell and the volcano supplies every metre of height the
 * island is allowed to have above that.
 */
export const TERRAIN_RELIEF_WORLD = 2.6;

/**
 * The volcano: the island's one authored landmark, in the north.
 *
 * It is the only tall thing on the island, and it is deliberately the *only* one. Everything about it
 * is a shape rather than an object: one centre, one base radius, one height, and the fractions that
 * place the rim, the crater floor and the steep ground between them. `terrain-height.ts` turns those
 * into metres, and the WorldCell map turns the same fractions into the bands a player is or is not
 * allowed to build on - so the mountain that is drawn and the ground that is *usable* cannot drift
 * apart.
 *
 * North and off-centre on purpose: the island's centre is the land the player develops, and a volcano
 * there would be a wall across the middle of the map. It sits on the northern shoulder with its
 * northern flank running into the sea, which is what makes the silhouette read from the estate camera
 * without a mountain ring anywhere else.
 */
export const VOLCANO = {
  center: { x: 12, y: -23 },
  /** How far the flanks reach, in tiles. About 14% of the island's land area. */
  baseRadiusTiles: 21.3,
  /** Height of the rim above the flat ground, in world metres: over five times the rolling relief. */
  heightWorld: 18,
  /** The rim's radius, as a fraction of the base: inside this is the crater. */
  rimRadiusFraction: 0.34,
  /** How far the crater floor sits below the rim, as a fraction of the height. */
  craterDepthFraction: 0.5,
  /** The fraction of the base inside which the flanks count as steep ground. */
  steepRadiusFraction: 0.62,
  /** Asymmetry: one flank is higher, and the summit is therefore off-centre. */
  // Small on purpose. The first version leaned by a tenth of its height, which put one shoulder of the
  // rim far above the other and turned the crater into a notch rather than a bowl.
  tilt: 0.06,
  tiltDirection: -2.4,
  /** Radial wobble, so the footprint is an outline rather than a circle. */
  lobes: [
    { harmonic: 2, amplitude: 0.07, phase: 1.1 },
    { harmonic: 3, amplitude: 0.045, phase: -0.6 }
  ]
} as const;

/** The volcano's centre in world metres. */
export const VOLCANO_WORLD = toWorld(VOLCANO.center);

/** The volcano as the terrain function reads it. */
export const VOLCANO_SHAPE: VolcanoShape = {
  centerWorldX: VOLCANO_WORLD.worldX,
  centerWorldZ: VOLCANO_WORLD.worldZ,
  baseRadiusWorld: VOLCANO.baseRadiusTiles * frame.pitch,
  heightWorld: VOLCANO.heightWorld,
  rimRadiusFraction: VOLCANO.rimRadiusFraction,
  craterDepthFraction: VOLCANO.craterDepthFraction,
  steepRadiusFraction: VOLCANO.steepRadiusFraction,
  tilt: VOLCANO.tilt,
  tiltDirection: VOLCANO.tiltDirection,
  lobes: VOLCANO.lobes
};

/** The island's outline, its elevation, and the areas that stay level. Pure data. */
export const TERRAIN_SHAPE: TerrainShape = {
  ...ISLAND_SHAPE,
  reliefWorld: TERRAIN_RELIEF_WORLD,
  flatAreas: terrainFlatAreas(),
  uplands: ISLAND_UPLANDS,
  volcano: VOLCANO_SHAPE
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
  roadNodes: ROAD_NODES,
  roadWidths: ROAD_WIDTH_TILES,
  meadows: MEADOWS,
  fence: FENCE,
  pond: POND,
  plaza: PLAZA,
  harbour: HARBOUR,
  volcano: VOLCANO,
  volcanoShape: VOLCANO_SHAPE,
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
