import type { PlotDTO } from "@happy-farm/contracts";
import type { FarmLayout, TileBounds, TileCoordinate } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, worldFrame, worldToTile } from "./layout";
import {
  DISTRICTS,
  COMPOSITION_PRESETS,
  FIELD_BLOCKS,
  FIELD_MARGIN_GROVES,
  FISH_FARM,
  FARMSTEAD,
  FENCE,
  HARBOUR,
  ISLAND_LOBES,
  ISLAND_SHAPE_EXPONENT,
  ISLAND_SHORE_MARGIN_TILES,
  ISLAND_UPLANDS,
  LANDMARKS,
  LANDMARKS_WORLD,
  LOGGING_YARD,
  MEADOWS,
  POND,
  PLAZA,
  ROAD_NODES,
  ROADS,
  ROAD_WIDTH_TILES,
  TERRAIN_RELIEF_WORLD,
  VISUAL_BOUNDS,
  terrainFlatAreas,
  type District,
  type DistrictGround,
  type DistrictKind,
  type FieldBlock,
  type PlacedLandmark,
  type RoadKind,
  type RoadNodeId
} from "./world-config";
import { GROUND_SURFACE_Y, islandRimPoint, terrainHeightAt, type TerrainShape } from "./terrain-height";
import { buildRoadSpec, ROAD_LIFT_WORLD, type RoadSpec } from "./roads";
export type { RoadSpec } from "./roads";
import type { JunctionSpec } from "./road-surface";
import { placementRejection, type PlacementWorld, type ShorelineClass } from "./placement";
import { buildCompositions, type CompositionClearing, type CompositionWorld } from "./composition";
import { PROP_MODELS } from "./prop-model-urls";

/**
 * The world model the renderer draws.
 *
 * Pure geometry and pure rules: it is derived from the server's land and the static world config and
 * decides no gameplay. Unlock state comes from the server's plot catalogue, and the only thing
 * mirrored from the server's layout rule is the deterministic plot square, because the client has to
 * draw locked land it does not own yet. `tests/web/farm-world.test.ts` pins that mirror to
 * `packages/domain/src/plot.ts`, so the two cannot drift without a failing test.
 *
 * Everything placed here is placed from a fixed seed, so the same island is the same island on every
 * client and after every refresh - and buying land cannot reshuffle any of it, because nothing here
 * reads the farm's tiles.
 */

/** Side length of one plot cohort, mirroring `PLOT_TILE_SIZE` in `packages/domain/src/plot.ts`. */
export const PLOT_TILE_SIZE = 12;
/** Tiles of dirt the cultivated apron keeps around the land the farm owns. */
export const APRON_MARGIN_TILES = 1.5;
/** How wide the tree line inside the island's rim is, in tiles. */
export const RIM_TREE_BAND_TILES = 2;
/** Tile spacing between the rim trees that close off the island's edge. */
export const RIM_TREE_SPACING_TILES = 2.2;
/**
 * Height of the rough ground drawn over a locked plot.
 *
 * A hair above the cultivated apron it overlaps at the field's edge, and a little above the grass
 * beyond it, so the plot's own surface is what the eye reads rather than the ground underneath.
 */
export const LOCKED_GROUND_SURFACE_Y = 0.012;

export interface PlotSquare extends TileBounds {
  readonly plotIndex: number;
}

export interface LockedPlotSquare extends PlotSquare {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly sizeWorld: number;
}

export interface PondSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorldX: number;
  readonly radiusWorldZ: number;
}

export interface BarnSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly rotationY: number;
}

export type SceneryKind = "tree" | "pine" | "bush" | "rock" | "flower" | "plant" | "prop";

/**
 * Which art tier a placement draws from.
 *
 * `HERO` is the curated CC0 set, drawn where the player is or is looking; `FILLER` is the lighter
 * set for the rim of the island and everything the estate camera sees as texture rather than as a
 * plant. The world model chooses the tier, so "how good does this need to look" is a decision about
 * the *place*, not something the renderer guesses from a distance it does not know.
 */
export type SceneryTier = "HERO" | "FILLER";

export interface SceneryInstance {
  readonly kind: SceneryKind;
  /**
   * An explicit model, when the *place* decides which one rather than the kind.
   *
   * A forest is a family of variants on purpose - a wood of one clone reads as wallpaper - but a row
   * of orchard trees is planted, so every tree in it is the same tree. An override is how a district
   * says "this row is one cultivar" without the renderer having to guess from a roll.
   */
  readonly modelId?: string;
  readonly worldX: number;
  /** Height of the ground under it, so a prop on a hill stands on the hill instead of inside it. */
  readonly worldY: number;
  readonly worldZ: number;
  /** Height in world metres: every model is normalized to one unit, so this is the size it draws. */
  readonly scale: number;
  readonly rotationY: number;
  readonly tier: SceneryTier;
  /** 0..1, chosen from the world seed: which variant of the tier's family this one is. */
  readonly variantRoll: number;
  /**
   * Whether this is small detail - a flower, a tuft of grass - rather than a mass.
   *
   * At estate zoom a thousand of these are visual noise that hides the things the plan is actually
   * made of: the fields, the roads, the forest masses, the settlement. The renderer keeps them in
   * their own group and switches that group off when the camera is far enough away, which is a one
   * flag per zoom change rather than anything per frame.
   */
  readonly detail: boolean;
}

/** A stake on the boundary of the land that is still locked. */
export interface BoundaryStake {
  readonly id: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
}

/** A patch of ground with its own colour, in world metres. */
export interface MeadowSpec {
  readonly id: string;
  readonly kind: "MEADOW" | "DIRT" | "SAND";
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorldX: number;
  readonly radiusWorldZ: number;
  readonly rotationY: number;
}

/** A district's ground, in world metres: what the renderer tints beneath its vegetation. */
export interface DistrictPatch {
  readonly id: string;
  readonly kind: DistrictKind;
  readonly ground: DistrictGround;
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorldX: number;
  readonly radiusWorldZ: number;
  readonly rotationY: number;
}

/** A rectangle of ground in world metres: the apron and the bed under the tiles. */
export interface GroundRect {
  readonly worldX: number;
  readonly worldZ: number;
  readonly widthWorld: number;
  readonly depthWorld: number;
}

/** One of the agricultural reserve's parcels, in world metres: what the renderer ploughs. */
export interface FieldBlockSpec {
  readonly id: string;
  readonly kind: FieldBlock["kind"];
  readonly worldX: number;
  readonly worldZ: number;
  readonly widthWorld: number;
  readonly depthWorld: number;
  /** The direction the furrows run in, in radians about Y. */
  readonly rotationY: number;
}

/** The settlement's paved square, in world metres. */
export interface PlazaSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorldX: number;
  readonly radiusWorldZ: number;
  readonly rotationY: number;
}

/**
 * The harbour, in world metres.
 *
 * `worldX`/`worldZ` are the landward end of the deck and `rotationY` is the bearing it runs on, so
 * the pier is built out from the shore it actually has rather than from a hand-picked far end.
 */
export interface HarbourSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly rotationY: number;
  readonly lengthWorld: number;
  readonly deckWidthWorld: number;
  readonly yardWorldX: number;
  readonly yardWorldZ: number;
}

/** The forest's loading yard: a clearing with stacked timber standing on it. */
export interface LoggingYardSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorld: number;
  readonly rotationY: number;
}

export interface FarmWorld {
  /** Unlocked land only. */
  readonly inner: TileBounds | null;
  /** Unlocked land plus the next ring of locked land, which is the map the player sees. */
  readonly outer: TileBounds | null;
  /**
   * The cultivated dirt around the land the farm actually owns.
   *
   * It follows `inner`, not the whole reserved field: the alpha paved the entire 36-tile reserve, so
   * the twelve-tile starter square sat in the middle of a brown yard. The apron now hugs what the
   * player owns, and the rest of the reserve is ground with the next plots growing on it.
   */
  readonly apron: GroundRect | null;
  /** The darker soil bed under the tile slabs, so the gaps between tiles read as furrows. */
  readonly bed: GroundRect | null;
  readonly lockedPlots: readonly LockedPlotSquare[];
  /**
   * Wild vegetation inside the locked plots.
   *
   * Deliberately its own list rather than part of `scenery`: this is the only decoration that stands
   * next to the field, and callers that assert "no scenery inside the farm" must be able to tell the
   * two apart.
   */
  readonly lockedScenery: readonly SceneryInstance[];
  /** Stakes along the outer edge of the locked ring: the boundary marker the player reads. */
  readonly lockedBoundary: readonly BoundaryStake[];
  /** The landmarks the world config places, in world metres. */
  readonly landmarks: readonly PlacedLandmark[];
  /** The island's districts, as blobs of ground for the renderer to tint. */
  readonly districts: readonly DistrictPatch[];
  /** Every road, already resampled into a terrain-following centreline. */
  readonly roads: readonly RoadSpec[];
  /**
   * Where two or more roads meet, in world metres.
   *
   * A junction is a small paved place the roads run into rather than an overlap of two strips, which
   * is what stops an intersection from looking like a cross-shaped seam. Derived from the stops the
   * roads declare, so a junction cannot exist at a place the network does not actually reach.
   */
  readonly junctions: readonly JunctionSpec[];
  /**
   * The agricultural reserve's visual fields.
   *
   * Presentation only, and drawn in the overlay: a field block is a picture of a field, and the apron
   * and the tiles paint over it the moment the land it sits on is bought.
   */
  readonly fieldBlocks: readonly FieldBlockSpec[];
  /** The settlement's square: the one paved place on the island. */
  readonly plaza: PlazaSpec;
  /** The harbour's quay, deck, and yard. */
  readonly harbour: HarbourSpec;
  /** The clearing where the managed wood's timber is stacked. */
  readonly loggingYard: LoggingYardSpec | null;
  /**
   * The island's set dressing: every authored prop on its authored spot.
   *
   * Presentation only, and deliberately its own field rather than part of `scenery`: scenery is a
   * scatter and this is a list of decisions, so a caller that wants to know what was *placed* (as
   * opposed to what grew) reads this one.
   */
  readonly compositions: CompositionWorld;
  /**
   * The fishery's aquaculture cages.
   *
   * Placed from the island's own outline rather than from hand-picked coordinates: each one sits a
   * few per cent *outside* the shoreline along the bay, which is what guarantees a cage is in water
   * and not on the beach, whatever the coastline does later.
   */
  readonly aquaculture: readonly { readonly worldX: number; readonly worldZ: number; readonly radiusWorld: number; readonly rotationY: number }[];
  readonly scenery: readonly SceneryInstance[];
  readonly pond: PondSpec | null;
  readonly barn: BarnSpec | null;
  /** Terrain variation outside the districts. Static: a fixed function of the world config. */
  readonly meadows: readonly MeadowSpec[];
  readonly islandHalfWidthWorld: number;
  readonly islandHalfDepthWorld: number;
  /** Half the framed farm: the owned field and its apron, which is what a default view frames. */
  readonly farmHalfExtentWorld: number;
  /** World centre of the static world, for camera framing only. Never a coordinate origin. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  /** The island's outline, its elevation, and the rectangles it holds level. */
  readonly terrain: TerrainShape;
}

export interface BuildWorldInput {
  readonly layout: FarmLayout;
  readonly tiles: readonly TileCoordinate[];
  readonly plots: readonly PlotDTO[];
}

const EMPTY_WORLD: FarmWorld = {
  inner: null,
  outer: null,
  apron: null,
  bed: null,
  lockedPlots: [],
  lockedScenery: [],
  lockedBoundary: [],
  landmarks: [],
  districts: [],
  roads: [],
  junctions: [],
  fieldBlocks: [],
  plaza: { worldX: 0, worldZ: 0, radiusWorldX: 0, radiusWorldZ: 0, rotationY: 0 },
  harbour: { worldX: 0, worldZ: 0, rotationY: 0, lengthWorld: 0, deckWidthWorld: 0, yardWorldX: 0, yardWorldZ: 0 },
  loggingYard: null,
  compositions: { props: [], clearings: [] },
  aquaculture: [],
  scenery: [],
  pond: null,
  barn: null,
  meadows: [],
  islandHalfWidthWorld: 0,
  islandHalfDepthWorld: 0,
  farmHalfExtentWorld: 0,
  centerWorldX: 0,
  centerWorldZ: 0,
  terrain: {
    centerWorldX: 0,
    centerWorldZ: 0,
    halfWidthWorld: 0,
    halfDepthWorld: 0,
    exponent: ISLAND_SHAPE_EXPONENT,
    lobes: [],
    reliefWorld: 0,
    flatAreas: [],
    uplands: []
  }
};

/** The concentric ring a plot index belongs to. Mirrors `plotRing` in the domain. */
export function plotRing(plotIndex: number): number {
  if (!Number.isSafeInteger(plotIndex) || plotIndex < 1) {
    throw new RangeError("plot index must be a positive safe integer");
  }
  let ring = Math.max(1, Math.floor(Math.sqrt(plotIndex)));
  while (ring * (ring + 2) < plotIndex) ring += 1;
  while (ring > 1 && (ring - 1) * (ring + 1) >= plotIndex) ring -= 1;
  return ring;
}

/** Where a plot's tile square starts. Mirrors `plotOrigin` in the domain. */
export function plotOrigin(plotIndex: number): TileCoordinate {
  const ring = plotRing(plotIndex);
  const offsetInRing = plotIndex - (ring - 1) * (ring + 1);
  if (offsetInRing <= ring + 1) {
    return { x: PLOT_TILE_SIZE * ring, y: PLOT_TILE_SIZE * (offsetInRing - 1) };
  }
  return { x: PLOT_TILE_SIZE * (offsetInRing - ring - 2), y: PLOT_TILE_SIZE * ring };
}

export function plotSquare(plotIndex: number): PlotSquare {
  const origin = plotOrigin(plotIndex);
  return {
    plotIndex,
    minX: origin.x,
    minY: origin.y,
    maxX: origin.x + PLOT_TILE_SIZE - 1,
    maxY: origin.y + PLOT_TILE_SIZE - 1
  };
}

function boundsOf(tiles: readonly TileCoordinate[]): TileBounds | null {
  if (tiles.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    maxX = Math.max(maxX, tile.x);
    maxY = Math.max(maxY, tile.y);
  }
  return { minX, maxX, minY, maxY };
}

function unionBounds(left: TileBounds | null, right: TileBounds): TileBounds {
  if (left === null) return right;
  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minY: Math.min(left.minY, right.minY),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

/**
 * The locked plots worth previewing: the ring of the first locked plot.
 *
 * Showing only the next ring keeps the map readable and keeps the frame a square. Once that ring is
 * bought, the preview moves outward to the next one.
 */
export function previewLockedPlots(plots: readonly PlotDTO[]): readonly PlotDTO[] {
  const locked = plots.filter((plot) => !plot.unlocked).sort((left, right) => left.plotIndex - right.plotIndex);
  const first = locked[0];
  if (first === undefined) return [];
  const ring = plotRing(first.plotIndex);
  return locked.filter((plot) => plotRing(plot.plotIndex) === ring);
}

/** Unlocked land plus the previewed locked ring: the square the map is framed around. */
export function landFrame(
  tiles: readonly TileCoordinate[],
  plots: readonly PlotDTO[]
): TileBounds | null {
  let frame = boundsOf(tiles);
  for (const plot of previewLockedPlots(plots)) {
    frame = unionBounds(frame, plotSquare(plot.plotIndex));
  }
  return frame;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCENERY_SEED = 0x51f3a7;
/** Its own seed, so the scrub on locked land is not a copy of the countryside around it. */
const LOCKED_SCENERY_SEED = 0x2c9e11;
/**
 * Cap on the props one world draws.
 *
 * The renderer instances them by kind, so the draw calls are flat and this number bounds vertex work
 * and rebuild cost rather than batches. The island is an estate rather than a field, so the budget
 * is larger than the alpha's - and still a number, so a future district cannot quietly spend it.
 */
const MAX_SCENERY = 1000;
/**
 * How many placements may draw a curated model before the rest fall back to the light set.
 *
 * A curated tree is a few thousand triangles, so this is the number that keeps\n * "make the districts look good" from becoming "make the island unrenderable". It is deliberately
 * generous for the districts a player walks and tight enough that the far side of the island is
 * filler, which is what the estate camera wants anyway.
 */
const HERO_SCENERY_BUDGET = 900;
/**
 * How many props each part of the island may spend.
 *
 * The order the sections are built in decides who gets the last seat on the island, and a single
 * global counter let a wood that grew one cluster too many quietly eat the shore, the hedgerow, and
 * the wilderness. A section budget is the fix: every part of the composition is promised its own
 * share, and the global budget stays as the backstop rather than as the only rule.
 */
const SECTION_BUDGET = {
  /** Per wood, not for all of them: two woods of 55 trees each is a forest, one of 110 is a lump. */
  forest: 80,
  orchard: 110,
  forestry: 150,
  district: 80,
  shore: 34,
  hedge: 30,
  /** The planted edges of the agricultural parcels, which V11 made the field's boundary. */
  fieldHedge: 60,
  /** The groves and outcrops that break up the ring of ground around the reserve. */
  fieldMargin: 96,
  wilderness: 88
} as const;
/** How far outside the fence a planted thing has to be to count as countryside rather than field. */
const FIELD_CLEARANCE_TILES = 1.4;
/** Tile spacing between the stakes that mark the edge of the land that is still locked. */
const LOCKED_STAKE_SPACING_TILES = 3;
/** How many wild props a locked plot grows, before the per-prop open-ground filter. */
/**
 * How much scrub a plot of unclaimed land grows.
 *
 * Deliberately sparse. Locked land is landscape that happens not to be the player's yet, not a
 * state to be signalled with objects: forty small props per plot read as confetti from the estate
 * camera and drowned out the fields they sat beside.
 */
const LOCKED_PROPS_PER_PLOT = 12;

/**
 * The four kinds of vegetation cluster.
 *
 * Composition is the point: a countryside reads as forest pockets, thickets, rock outcrops, and
 * flower patches, not as one tree every twenty metres. A cluster is one seed, one radius, and one
 * member count, and the member kinds follow from the cluster's kind.
 */
type ClusterKind = "FOREST" | "SHRUBS" | "ROCKS" | "FLOWERS";

/** Which prop a roll inside a cluster produces: a table, so the mix is readable rather than nested. */
function clusterMemberKind(cluster: ClusterKind, roll: number): SceneryKind {
  switch (cluster) {
    case "FOREST":
      return roll < 0.54 ? "tree" : roll < 0.78 ? "pine" : roll < 0.9 ? "bush" : "plant";
    case "SHRUBS":
      return roll < 0.5 ? "bush" : roll < 0.7 ? "plant" : roll < 0.88 ? "flower" : "rock";
    case "ROCKS":
      return roll < 0.68 ? "rock" : roll < 0.85 ? "bush" : roll < 0.94 ? "plant" : "flower";
    case "FLOWERS":
      return roll < 0.46 ? "flower" : roll < 0.82 ? "plant" : "bush";
  }
}

/** Which cluster a district grows, read off its kind. */
function clusterKindFor(kind: DistrictKind, roll: number): ClusterKind {
  switch (kind) {
    case "FOREST":
      return "FOREST";
    case "FORESTRY":
      return roll < 0.75 ? "FOREST" : "SHRUBS";
    case "ORCHARD":
      return roll < 0.7 ? "SHRUBS" : "FLOWERS";
    case "PASTURE":
      return roll < 0.5 ? "SHRUBS" : "FLOWERS";
    case "COAST":
      return roll < 0.55 ? "ROCKS" : "SHRUBS";
    case "WATER":
      return roll < 0.6 ? "SHRUBS" : "FLOWERS";
    case "SETTLEMENT":
      return roll < 0.6 ? "SHRUBS" : "FLOWERS";
    case "FUTURE":
      // Meadow with the occasional thicket: land nobody has decided about yet, not a building site.
      return roll < 0.55 ? "SHRUBS" : "FLOWERS";
    case "CROPLAND":
      return "FLOWERS";
  }
}

/**
 * A deterministic, isotropic blob outline.
 *
 * Districts are blobs rather than rectangles, so a district's ground tint must not have a straight
 * edge either. Three small lobes, phased from the district's own id, give every district a slightly
 * different edge that is still the same edge on every client.
 */
export function districtOutlineScale(angle: number, phase: number): number {
  return (
    1 +
    0.11 * Math.sin(3 * angle + phase) +
    0.06 * Math.sin(5 * angle - phase * 1.7) +
    0.035 * Math.sin(7 * angle + phase * 0.6)
  );
}

/** A stable phase for a district's outline, from its id. */
export function districtOutlinePhase(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0;
  return (hash % 1000) / 1000 * Math.PI * 2;
}

/**
 * Deterministic decoration placement.
 *
 * Three sources, in order: the tree line that closes the island's rim, the orchard's rows, and the
 * vegetation clusters every other district grows. The seed is a constant and the generator advances a
 * fixed number of times per candidate, so the same world always grows the same trees - and buying a
 * plot cannot reshuffle them, because nothing here reads the farm's tiles.
 */
function buildScenery(
  layout: FarmLayout,
  terrain: TerrainShape,
  roads: readonly RoadSpec[],
  compositionClearings: readonly CompositionClearing[]
): SceneryInstance[] {
  const rand = mulberry32(SCENERY_SEED);
  const scenery: SceneryInstance[] = [];
  const frame = worldFrame(layout.pitch);
  /**
   * How many high-detail props this world may draw.
   *
   * A curated tree is ten times the triangles of a filler one, so the budget is what stops "spend
   * more on the districts" from becoming "spend everything". The first placements to claim it are
   * the ones a player meets first - the orchard, then the districts around them - because the order
   * below is fixed and the seed is fixed with it.
   */
  let heroBudget = HERO_SCENERY_BUDGET;

  /**
   * The world facts every placement is judged against.
   *
   * The coastline is the same `IslandShape` the terrain mesh, the beach, and the player's collision
   * world use, which is the whole point: there is no second opinion about where the sea is.
   */
  const placementWorld: PlacementWorld = {
    island: terrain,
    frame,
    bounds: {
      minX: tileToWorld({ x: VISUAL_BOUNDS.minX, y: 0 }, frame).worldX,
      maxX: tileToWorld({ x: VISUAL_BOUNDS.maxX, y: 0 }, frame).worldX,
      minY: tileToWorld({ x: 0, y: VISUAL_BOUNDS.minY }, frame).worldZ,
      maxY: tileToWorld({ x: 0, y: VISUAL_BOUNDS.maxY }, frame).worldZ
    },
    roads: roads.flatMap((road) =>
      road.samples.map((sample) => ({
        worldX: sample.worldX,
        worldZ: sample.worldZ,
        halfWidthWorld: road.widthWorld / 2
      }))
    ),
    waterBodies: [
      {
        ...tileToWorld(POND.center, frame),
        radiusWorldX: (POND.radiusX + 1.6) * layout.pitch,
        radiusWorldZ: (POND.radiusY + 1.6) * layout.pitch
      }
    ],
    clearings: [
      { ...tileToWorld(FARMSTEAD.center, frame), radiusWorld: 5 * layout.pitch },
      // The town square, the quay and its yard, and the timber yard are places with a job, so
      // nothing decorative stands on them either.
      { ...tileToWorld(PLAZA.center, frame), radiusWorld: (PLAZA.radiusX + 1.5) * layout.pitch },
      { ...tileToWorld(HARBOUR.root, frame), radiusWorld: 6 * layout.pitch },
      { ...tileToWorld(HARBOUR.yard, frame), radiusWorld: 4 * layout.pitch },
      { ...tileToWorld(LOGGING_YARD.center, frame), radiusWorld: (LOGGING_YARD.radiusTiles + 1.5) * layout.pitch },
      // Every furnished place keeps its own ground clear, so a thicket cannot grow through the middle
      // of a market square or a timber yard. The preset declares the radius; the scenery pass obeys it.
      ...compositionClearings.map((clearing) => ({
        worldX: clearing.worldX,
        worldZ: clearing.worldZ,
        radiusWorld: clearing.radiusWorld
      })),
      ...LANDMARKS_WORLD.map((landmark) => ({
        worldX: landmark.worldX,
        worldZ: landmark.worldZ,
        radiusWorld: landmark.blockingRadiusWorld + 1.6
      }))
    ]
  };

  /** The shoreline class a kind belongs to: what may stand how close to the water. */
  function shorelineFor(kind: SceneryKind): ShorelineClass {
    switch (kind) {
      case "tree":
      case "pine":
      case "prop":
        return "LARGE";
      case "bush":
      case "rock":
        return "MEDIUM";
      case "flower":
      case "plant":
        return "SMALL";
    }
  }

  function place(kind: SceneryKind, tileX: number, tileY: number, scale: number, rotationY: number, modelId?: string): void {
    // The budget bounds how much detail the island carries. Past it a placement is *skipped*, not
    // downgraded to a primitive: filling the rest with placeholder shapes is what made the earlier
    // passes noisy, and negative space is worth more than a full map.
    if (heroBudget <= 0 || scenery.length >= MAX_SCENERY) return;
    const position = tileToWorld({ x: tileX, y: tileY }, frame);
    if (
      placementRejection(
        { worldX: position.worldX, worldZ: position.worldZ, shoreline: shorelineFor(kind) },
        placementWorld
      ) !== null
    ) {
      return;
    }
    heroBudget -= 1;
    scenery.push({
      kind,
      ...(modelId === undefined ? {} : { modelId }),
      worldX: position.worldX,
      // Stands on the ground rather than under it: the same function the terrain mesh is built from.
      worldY: GROUND_SURFACE_Y + terrainHeightAt(position.worldX, position.worldZ, terrain),
      worldZ: position.worldZ,
      scale,
      rotationY,
      tier: "HERO",
      variantRoll: rand(),
      detail: kind === "flower" || kind === "plant"
    });
  }

  /**
   * Whether a candidate is standing room rather than field, water, road, or a landmark's clearing.
   *
   * The reserved field is excluded whole, and that is deliberate rather than a leftover: this layer
   * is *static*, and the land inside the reserve is exactly the land the player changes. Whatever
   * vegetation the reserve does get is the wild growth built in the overlay, where following
   * progression is the point. Anything here that read the farm's tiles would make the whole world
   * reshuffle every time a plot was bought.
   */
  function isOpenGround(tileX: number, tileY: number): boolean {
    // The reserved field is excluded whole: this layer is static, and the land inside the reserve is
    // the land the player changes. The reserve's own vegetation is the overlay's job.
    if (
      tileX >= FENCE.bounds.minX - FIELD_CLEARANCE_TILES &&
      tileX <= FENCE.bounds.maxX + FIELD_CLEARANCE_TILES &&
      tileY >= FENCE.bounds.minY - FIELD_CLEARANCE_TILES &&
      tileY <= FENCE.bounds.maxY + FIELD_CLEARANCE_TILES
    ) {
      return false;
    }
    return true;
  }

  /**
   * A placer that may spend at most `limit` placements.
   *
   * Every section of the composition gets its own share of the island, so a wood that grew one
   * cluster too many cannot quietly eat the hedgerow, the shore, or the wilderness at the end of the
   * list. Rejected candidates cost nothing, which is what keeps a budget about *what stands* rather
   * than about how many attempts were made to stand it.
   */
  function within(
    limit: number
  ): (kind: SceneryKind, tileX: number, tileY: number, scale: number, rotationY: number, modelId?: string) => void {
    let remaining = limit;
    return (kind, tileX, tileY, scale, rotationY, modelId) => {
      if (remaining <= 0) return;
      const before = scenery.length;
      if (modelId === undefined) place(kind, tileX, tileY, scale, rotationY);
      else place(kind, tileX, tileY, scale, rotationY, modelId);
      if (scenery.length > before) remaining -= 1;
    };
  }

  /**
   * A lattice in a district's own frame: rows across the slope, positions along each row.
   *
   * An orchard and a managed wood are the same lattice at two spacings - the wide rows and generous
   * beds of a fruit orchard, the tight rows and narrow beds of a working stand - which is exactly the
   * distinction V9 asks a viewer to make from the estate camera.
   */
  function plantRows(options: {
    readonly district: District;
    /** Distance between rows, in tiles. */
    readonly spacingTiles: number;
    /** Distance between the trees *along* a row, in tiles. */
    readonly columnSpacingTiles: number;
    readonly jitter: number;
    readonly scaleBase: number;
    readonly scaleSpread: number;
    readonly pineShare: number;
    /**
     * The model every tree in this lattice draws, or absent to let the roll choose within the kind.
     *
     * A plantation is one cultivar and a wood is a mixture: an orchard row that mixes four canopy
     * shapes does not read as a row from the estate camera, however regular the lattice is.
     */
    readonly modelId?: string;
    readonly placement: (
      kind: SceneryKind,
      tileX: number,
      tileY: number,
      scale: number,
      rotationY: number,
      modelId?: string
    ) => void;
  }): void {
    const district = options.district;
    const cos = Math.cos(district.rotationY);
    const sin = Math.sin(district.rotationY);
    for (let row = -Math.ceil(district.radiusY); row <= district.radiusY; row += options.spacingTiles) {
      for (let column = -Math.ceil(district.radiusX); column <= district.radiusX; column += options.columnSpacingTiles) {
        const jitterX = (rand() - 0.5) * options.jitter;
        const jitterZ = (rand() - 0.5) * options.jitter;
        const kindRoll = rand();
        const scaleRoll = rand();
        const rotationRoll = rand();
        const localX = column + jitterX;
        const localZ = row + jitterZ;
        // The lattice is clipped to the district's own outline, so a row can never run out of its
        // district and into the field or the wood beside it.
        if (Math.hypot(localX / district.radiusX, localZ / district.radiusY) > 0.94) continue;
        const tileX = district.center.x + localX * cos - localZ * sin;
        const tileY = district.center.y + localX * sin + localZ * cos;
        if (!isOpenGround(tileX, tileY)) continue;
        const kind: SceneryKind = kindRoll < options.pineShare ? "pine" : "tree";
        options.placement(
          kind,
          tileX,
          tileY,
          options.scaleBase + scaleRoll * options.scaleSpread,
          rotationRoll * Math.PI * 2,
          options.modelId
        );
      }
    }
  }

  // 2. The orchard: a fruit orchard is a *lattice*, and what makes it legible from the estate camera
  // is not the trees but the spacing: wide rows, one small tree per station, and glass-clear lanes
  // between them. It is the first thing a viewer should be able to name from above after the fields.
  const orchardBudget = within(SECTION_BUDGET.orchard);
  for (const district of DISTRICTS) {
    if (district.kind !== "ORCHARD") continue;
    plantRows({
      district,
      spacingTiles: district.rowSpacingTiles ?? 4,
      // A fruit orchard is planted tighter along the row than between rows: four metres between the
      // lines, a tree every three. The two spacings are what make a stand of trees read as an
      // orchard rather than as a grid.
      // Tight along the row, wide between rows: that ratio *is* the orchard's signature. An even
      // lattice at any spacing reads as a block of trees; trees almost touching along a line, with a
      // lane between the lines, read as rows.
      columnSpacingTiles: (district.rowSpacingTiles ?? 4) * 0.42,
      jitter: 0.3,
      // One cultivar, one size, one silhouette: a row of four canopy shapes is a thicket, however
      // regular the lattice under it. `tree_broad_2` is the roundest canopy in the curated set, which
      // is what a fruit tree should look like from the estate camera.
      scaleBase: 2.9,
      scaleSpread: 0.4,
      pineShare: 0,
      modelId: "tree_broad_2",
      placement: orchardBudget
    });
  }

  // 3. The great woods. Two masses on the island's high ground, each grown as one dense core with a
  // softer edge, a clearing or two cut into it, and real variation in tree size - because a wood
  // reads as a wood from above only when it has a thick middle, a ragged edge, and a hole in it. This
  // is the largest visual mass on the island and the anchor of the natural half of the composition.
  for (const district of DISTRICTS) {
    if (district.kind !== "FOREST") continue;
    // A budget per wood rather than one for all of them: shares of a single counter meant the first
    // wood in the list took the whole of it and the second grew as a thicket.
    const forestBudget = within(SECTION_BUDGET.forest);
    const cos = Math.cos(district.rotationY);
    const sin = Math.sin(district.rotationY);
    const clearings: { readonly x: number; readonly y: number; readonly r: number }[] = [];
    for (let index = 0; index < 2; index += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = 0.2 + rand() * 0.5;
      clearings.push({
        x: district.center.x + Math.cos(angle) * distance * district.radiusX,
        y: district.center.y + Math.sin(angle) * distance * district.radiusY,
        r: 1.6 + rand() * 2.2
      });
    }
    const samples = 150;
    for (let sample = 0; sample < samples; sample += 1) {
      const angle = rand() * Math.PI * 2;
      // Uniform over the district's disc, weighted toward the middle: dense at the core, thinning to
      // nothing at the rim, which is what a canopy does at its edge.
      const roll = Math.sqrt(rand());
      const distance = roll * roll * 0.98;
      const localX = Math.cos(angle) * distance * district.radiusX;
      const localZ = Math.sin(angle) * distance * district.radiusY;
      const tileX = district.center.x + localX * cos - localZ * sin;
      const tileY = district.center.y + localX * sin + localZ * cos;
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      if (!isOpenGround(tileX, tileY)) continue;
      let inClearing = false;
      for (const clearing of clearings) {
        if (Math.hypot(tileX - clearing.x, tileY - clearing.y) < clearing.r) {
          inClearing = true;
          break;
        }
      }
      if (inClearing) {
        if (kindRoll < 0.6) forestBudget("plant", tileX, tileY, unitScaleFor("plant", scaleRoll), rotationRoll * Math.PI * 2);
        continue;
      }
      const kind: SceneryKind =
        distance > 0.74
          ? kindRoll < 0.55
            ? "bush"
            : kindRoll < 0.8
              ? "tree"
              : "plant"
          : kindRoll < 0.46
            ? "tree"
            : kindRoll < 0.78
              ? "pine"
              : kindRoll < 0.9
                ? "bush"
                : "plant";
      forestBudget(kind, tileX, tileY, unitScaleFor(kind, scaleRoll), rotationRoll * Math.PI * 2);
    }
  }

  // 4. Thickets, rock outcrops, and flowers everywhere else. A cluster's centre is drawn from a
  // district in proportion to that district's own density, so the pasture is nearly open, the
  // settlement has a few planted trees in it, and the coast is what the coast is made of.
  for (const district of DISTRICTS) {
    // A district with no density grows nothing and does not spend a turn of the seed.
    if (district.density <= 0) continue;
    // One quota per district rather than a share of one pool. A pool is spent in list order, which
    // meant the first two districts - the orchard and the near wood - took every placement and the
    // pasture, the coast, and the town were left with bare ground however the weighting was tuned.
    const budget = within(Math.max(3, Math.round(district.density * 30)));
    const clusters = Math.max(2, Math.round(district.density * 16));
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      const kindRoll = rand();
      const angle = rand() * Math.PI * 2;
      const radius = Math.sqrt(rand()) * 0.92;
      const memberRoll = rand();
      const sizeRoll = rand();

      const cos = Math.cos(district.rotationY);
      const sin = Math.sin(district.rotationY);
      const localX = Math.cos(angle) * radius * district.radiusX;
      const localZ = Math.sin(angle) * radius * district.radiusY;
      const centerX = district.center.x + localX * cos - localZ * sin;
      const centerZ = district.center.y + localX * sin + localZ * cos;

      const kind = clusterKindFor(district.kind, kindRoll);
      const clusterRadius = 2.2 + sizeRoll * 3.2;
      const members = Math.round(5 + memberRoll * 10 * Math.max(0.35, district.density));
      for (let member = 0; member < members; member += 1) {
        const memberAngle = rand() * Math.PI * 2;
        const memberDistance = clusterRadius * Math.sqrt(rand());
        const memberKindRoll = rand();
        const scaleRoll = rand();
        const rotationRoll = rand();
        const at = {
          x: centerX + Math.cos(memberAngle) * memberDistance,
          y: centerZ + Math.sin(memberAngle) * memberDistance
        };
        if (!isOpenGround(at.x, at.y)) continue;
        // A district's tree share decides how woody its clusters are: a pasture's thicket is mostly
        // scrub even where a wood's would be canopy.
        const rolled = clusterMemberKind(kind, memberKindRoll);
        const kind_: SceneryKind = memberKindRoll > district.treeShare && rolled === "tree" ? "bush" : rolled;
        budget(kind_, at.x, at.y, unitScaleFor(kind_, scaleRoll), rotationRoll * Math.PI * 2);
      }
    }
  }

  // 4. The managed wood: rows too, but tighter, denser, and mixed - a stand somebody planted and
  // somebody cuts, which is the whole visual difference between it and the wood nobody has touched.
  const forestryBudget = within(SECTION_BUDGET.forestry);
  for (const district of DISTRICTS) {
    if (district.kind !== "FORESTRY") continue;
    plantRows({
      district,
      spacingTiles: district.rowSpacingTiles ?? 3.2,
      columnSpacingTiles: (district.rowSpacingTiles ?? 3.2) * 0.7,
      jitter: 0.5,
      // A working stand is conifers, in rows, of a size: tall enough to read as timber rather than as
      // scrub, and visually the opposite of the orchard's round canopy at the same distance.
      scaleBase: 3.4,
      scaleSpread: 0.8,
      pineShare: 1,
      modelId: "tree_pine_2",
      placement: forestryBudget
    });
  }

  // 5. The wilderness: the land the island has deliberately not decided about.
  //
  // It is not a place the plan forgot and it is not a thicket either. Tall grass, low scrub, the odd
  // tree, and a lot of room is what land waiting for its purpose actually looks like - and it is the
  // reading the five-second test is checking for when it asks whether the island is finished.
  const wildernessBudget = within(SECTION_BUDGET.wilderness);
  for (const district of DISTRICTS) {
    if (district.kind !== "FUTURE") continue;
    const cos = Math.cos(district.rotationY);
    const sin = Math.sin(district.rotationY);
    for (let index = 0; index < 110; index += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = Math.sqrt(rand()) * 0.92;
      const localX = Math.cos(angle) * distance * district.radiusX;
      const localZ = Math.sin(angle) * distance * district.radiusY;
      const tileX = district.center.x + localX * cos - localZ * sin;
      const tileY = district.center.y + localX * sin + localZ * cos;
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      if (!isOpenGround(tileX, tileY)) continue;
      // Mostly meadow grass with occasional scrub: nothing here is a landmark, because a landmark
      // would be the plan deciding what this land is for.
      const kind: SceneryKind = kindRoll < 0.62 ? "plant" : kindRoll < 0.9 ? "bush" : "tree";
      wildernessBudget(kind, tileX, tileY, unitScaleFor(kind, scaleRoll), rotationRoll * Math.PI * 2);
    }
  }

  // 6. The farmland's margin.
  //
  // The crop district grows nothing inside the reserve on purpose - that land belongs to the
  // catalogue - but the blob reaches several tiles past the reserve's edge, and leaving that ring
  // empty is what made the estate view read as a green plane with a farmhouse on it. `isOpenGround`
  // still refuses the reserve itself and `placementRejection` still refuses the water, the roads, and
  // every building's clearing, so a grove only ever stands on open countryside. The anchors are
  // authored rather than sampled: a ring of evenly scattered bushes is confetti, and a dozen decided
  // places are a landscape.
  //
  // It is placed *before* the shoreline, the hedgerows, and the field edges because the budget is
  // spent in order: a section that runs last only gets what is left, and the whole point of this one
  // is that the ring around the fields is not left to chance.
  const marginBudget = within(SECTION_BUDGET.fieldMargin);
  for (const grove of FIELD_MARGIN_GROVES) {
    const cluster: ClusterKind =
      grove.kind === "GROVE" ? "FOREST" : grove.kind === "ROCKS" ? "ROCKS" : grove.kind === "THICKET" ? "SHRUBS" : "FLOWERS";
    for (let member = 0; member < grove.members; member += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = grove.radiusTiles * Math.sqrt(rand());
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      const tileX = grove.center.x + Math.cos(angle) * distance;
      const tileY = grove.center.y + Math.sin(angle) * distance;
      if (!isOpenGround(tileX, tileY)) continue;
      const kind = clusterMemberKind(cluster, kindRoll);
      marginBudget(kind, tileX, tileY, unitScaleFor(kind, scaleRoll), rotationRoll * Math.PI * 2);
    }
  }

  // 7. The shoreline: a sparse, controlled band of what a coast is actually made of.
  //
  // The island no longer gets a continuous ring of trees - that hid the coastline and read as a wall
  // - so the edge is decorated by walking the shore and stepping a short way inland, placing small
  // things only: pebbles, grass, the occasional bush. Their shoreline class is what keeps the trees
  // away from the water and lets the grass reach it.
  const shoreBudget = within(SECTION_BUDGET.shore);
  const SHORE_SAMPLES = 46;
  for (let index = 0; index < SHORE_SAMPLES; index += 1) {
    const angle = (index / SHORE_SAMPLES) * Math.PI * 2 + rand() * 0.08;
    const rim = islandRimPoint(angle, terrain);
    const inward = 0.9 + rand() * 0.07;
    const worldX = terrain.centerWorldX + (rim.worldX - terrain.centerWorldX) * inward;
    const worldZ = terrain.centerWorldZ + (rim.worldZ - terrain.centerWorldZ) * inward;
    const tile = worldToTile({ worldX, worldZ }, frame);
    const kindRoll = rand();
    const scaleRoll = rand();
    const rotationRoll = rand();
    const kind: SceneryKind = kindRoll < 0.48 ? "rock" : kindRoll < 0.86 ? "plant" : "bush";
    shoreBudget(kind, tile.x, tile.y, unitScaleFor(kind, scaleRoll), rotationRoll * Math.PI * 2);
  }

  // 7. The hedgerow along the estate side of the fence.
  //
  // The fence draws the reserve as a hard square, and the plots inside it cannot hide that. A hedge
  // on the outside of the boundary breaks the line into a planted edge - which is what a farm does
  // with a boundary, and what stops a rectangle reading as the outline of a board. It stands outside
  // the reserve because that land is never for sale, so the hedge can never end up inside a field the
  // player buys.
  const hedgeBudget = within(SECTION_BUDGET.hedge);
  for (let along = -1; along <= 38; along += 2.5) {
    const jitter = (rand() - 0.5) * 0.9;
    const sizeRoll = rand();
    const rotationRoll = rand();
    const kind: SceneryKind = rand() < 0.78 ? "bush" : "tree";
    if (isOpenGround(along + jitter, 38.6)) {
      hedgeBudget(kind, along + jitter, 38.6, unitScaleFor(kind, sizeRoll), rotationRoll * Math.PI * 2);
    }
  }
  for (let along = 1; along <= 38; along += 2.5) {
    const jitter = (rand() - 0.5) * 0.9;
    const sizeRoll = rand();
    const rotationRoll = rand();
    const kind: SceneryKind = rand() < 0.78 ? "bush" : "tree";
    if (isOpenGround(-3.4, along + jitter)) {
      hedgeBudget(kind, -3.4, along + jitter, unitScaleFor(kind, sizeRoll), rotationRoll * Math.PI * 2);
    }
  }

  // 8. The field hedgerows.
  //
  // A worked field is bounded by something, and on this island that something is a hedge rather than
  // the fence V11 removed: a planted edge along the roadside of the larger parcels, with gaps where a
  // cart would go through. It is scenery like the rest, so the placement rules - the coastline, the
  // roads, the clearings - still decide where it may stand.
  const fieldHedgeBudget = within(SECTION_BUDGET.fieldHedge);
  for (const block of FIELD_BLOCKS) {
    if (block.kind === "YARD") continue;
    for (const edge of [
      { fixed: block.bounds.minY, along: "X", close: true },
      { fixed: block.bounds.maxY, along: "X", close: false }
    ] as const) {
      for (let along = block.bounds.minX + 1; along <= block.bounds.maxX - 1; along += 2.4) {
        // A gap every third step: a hedge with an entrance in it, which is what a field has.
        if (Math.round(along) % 8 < 2) continue;
        const jitter = (rand() - 0.5) * 0.5;
        const sizeRoll = rand();
        const rotationRoll = rand();
        const tileX = along + jitter;
        // The hedge stands on the parcel's own edge line, so it frames the field rather than cutting it.
        const tileY = edge.fixed + (edge.close ? -0.6 : 0.6);
        if (!isOpenGround(tileX, tileY)) continue;
        fieldHedgeBudget("bush", tileX, tileY, unitScaleFor("bush", sizeRoll) * 0.9, rotationRoll * Math.PI * 2);
      }
    }
  }

  return scenery;
}

/**
 * How tall a prop of each kind is drawn, in world metres.
 *
 * One table, in one place, because the alternative is what the alpha had: a scale factor per call
 * site, tuned against whichever model happened to be there. Every model in the manifest is normalized
 * to one unit tall, so these numbers *are* the world's sizes - the player is 1.6.
 */
function unitScaleFor(kind: SceneryKind, roll: number): number {
  switch (kind) {
    case "tree":
      return 2.6 + roll * 1.3;
    case "pine":
      return 3.0 + roll * 1.6;
    case "bush":
      return 0.75 + roll * 0.5;
    case "rock":
      return 0.55 + roll * 0.6;
    case "flower":
      return 0.35 + roll * 0.25;
    case "plant":
      return 0.3 + roll * 0.35;
    case "prop":
      return 0.9;
  }
}

/**
 * Wild vegetation inside the land that is still locked.
 *
 * The alpha drew locked land as a grey slab under a fog rectangle with a padlock on it: legible as a
 * price tag, unreadable as a place. This is the replacement - the plot keeps its boundary and its
 * sign, but the ground between them grows brambles, weeds, and stones, so the ring around the field
 * reads as land the player has not claimed rather than as a developer placeholder.
 *
 * It lives in its own list rather than in `scenery` because it is the one decoration allowed to stand
 * beside the field, and callers that assert "nothing grows in the farm" have to be able to tell the
 * two apart. It is still a pure function of the plot geometry and a fixed seed.
 */
function buildLockedScenery(
  plots: readonly PlotSquare[],
  layout: FarmLayout
): SceneryInstance[] {
  const frame = worldFrame(layout.pitch);
  const scenery: SceneryInstance[] = [];
  /** Keeps the plot's edge readable: a stake line with a thicket sitting on top of it is noise. */
  const edgeMargin = 1.4;
  /**
   * Whether a point is inside one of the reserve's working parcels.
   *
   * A field block is a picture of a *worked* field, so nothing grows on it: the scrub that makes
   * unclaimed land read as land belongs on the ground *between* the parcels - the headlands, the
   * lanes, and the strips the plan has left to grass - and a thicket standing in the middle of a
   * ploughed field is the one thing that would make the heartland read as abandoned.
   */
  function onAParcel(tileX: number, tileY: number): boolean {
    return FIELD_BLOCKS.some(
      (block) =>
        block.kind !== "YARD" &&
        tileX >= block.bounds.minX &&
        tileX <= block.bounds.maxX &&
        tileY >= block.bounds.minY &&
        tileY <= block.bounds.maxY
    );
  }

  for (const plot of plots) {
    // One seed per plot rather than one for the list: buying a plot has to clear *that* plot's wild
    // growth, not reshuffle every other plot's.
    const rand = mulberry32(LOCKED_SCENERY_SEED + plot.plotIndex * 0x9e3779b1);
    for (let index = 0; index < LOCKED_PROPS_PER_PLOT; index += 1) {
      // The headland: a plot's own margin, outside every parcel it carries. Sampling the ring rather
      // than the whole square is what keeps the scrub off the ploughing and puts it where a farm
      // actually leaves its rough grass - along the field's edge, next to the stakes.
      const edge = Math.floor(rand() * 4);
      const along = edgeMargin + rand() * (plot.maxX - plot.minX + 1 - edgeMargin * 2);
      const depth = 0.6 + rand() * 1.2;
      const x = edge === 0 ? plot.minX + depth : edge === 1 ? plot.maxX - depth : plot.minX + along;
      const y = edge === 2 ? plot.minY + depth : edge === 3 ? plot.maxY - depth : plot.minY + along;
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      if (onAParcel(x, y)) continue;
      const kind: SceneryKind =
        // Grass, the occasional shrub, the occasional rock: the colours that make unclaimed land look
        // like land rather than like a debug overlay.
        kindRoll < 0.42 ? "plant" : kindRoll < 0.78 ? "bush" : kindRoll < 0.94 ? "rock" : "tree";
      const position = tileToWorld({ x, y }, frame);
      scenery.push({
        kind,
        worldX: position.worldX,
        // Locked land is always on the reserve's flat plateau, and its rough surface sits a hair above
        // the grass, so this is the patch's own level rather than the terrain's.
        worldY: LOCKED_GROUND_SURFACE_Y,
        worldZ: position.worldZ,
        // Smaller than open-country scenery: this is scrub coming up on neglected ground.
        scale: 0.5 + scaleRoll * 0.4,
        rotationY: rotationRoll * Math.PI * 2,
        // Unclaimed ground sits immediately beside the field, so it is foreground: the light set is
        // for the island's rim, where a flat, cheap prop is seen in silhouette at a hundred metres.
        tier: "HERO",
        variantRoll: rand(),
        detail: kind === "plant"
      });
    }
  }

  return scenery;
}

/**
 * The stakes that mark where the farm's land ends and the land for sale begins.
 *
 * Only an edge whose outside neighbour is *not* locked land gets a stake: the interior seams between
 * two locked plots are invisible, and the edge the player already owns is the one boundary worth
 * drawing. The result is a single line around the claimed field, which is the affordance the grey
 * slab used to carry, without the slab.
 */
function buildLockedBoundary(plots: readonly PlotSquare[], layout: FarmLayout): BoundaryStake[] {
  const frame = worldFrame(layout.pitch);
  const stakes: BoundaryStake[] = [];
  const isLocked = (x: number, y: number): boolean =>
    plots.some((plot) => x >= plot.minX && x <= plot.maxX && y >= plot.minY && y <= plot.maxY);

  for (const plot of plots) {
    const horizontal: number[] = [];
    for (let x = plot.minX + 1; x <= plot.maxX - 1; x += LOCKED_STAKE_SPACING_TILES) horizontal.push(x);
    const vertical: number[] = [];
    for (let y = plot.minY + 1; y <= plot.maxY - 1; y += LOCKED_STAKE_SPACING_TILES) vertical.push(y);

    const edges: readonly {
      readonly along: readonly number[];
      readonly line: number;
      readonly outward: number;
      readonly horizontal: boolean;
    }[] = [
      { along: horizontal, line: plot.minY, outward: -1, horizontal: true },
      { along: horizontal, line: plot.maxY, outward: 1, horizontal: true },
      { along: vertical, line: plot.minX, outward: -1, horizontal: false },
      { along: vertical, line: plot.maxX, outward: 1, horizontal: false }
    ];

    for (const edge of edges) {
      for (const along of edge.along) {
        const tile = edge.horizontal
          ? { x: along, y: edge.line + edge.outward }
          : { x: edge.line + edge.outward, y: along };
        if (isLocked(tile.x, tile.y)) continue;
        const position = tileToWorld(
          edge.horizontal ? { x: along, y: edge.line } : { x: edge.line, y: along },
          frame
        );
        const offset = layout.pitch * 0.5 * edge.outward;
        const worldX = edge.horizontal ? position.worldX : position.worldX + offset;
        const worldZ = edge.horizontal ? position.worldZ + offset : position.worldZ;
        stakes.push({
          id: `plot${String(plot.plotIndex)}_${edge.horizontal ? "h" : "v"}_${String(along)}_${String(edge.outward)}`,
          worldX,
          worldY: LOCKED_GROUND_SURFACE_Y,
          worldZ
        });
      }
    }
  }

  return stakes;
}

export function buildFarmWorld(input: BuildWorldInput): FarmWorld {
  const inner = boundsOf(input.tiles);
  let outer = boundsOf(input.tiles);
  for (const plot of previewLockedPlots(input.plots)) {
    outer = unionBounds(outer, plotSquare(plot.plotIndex));
  }
  if (outer === null) return EMPTY_WORLD;

  const mapping = worldFrame(input.layout.pitch);
  // The island is the visual bounds plus its shore margin, so the beach has ground to stand on.
  const halfWidthTiles = (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2 + ISLAND_SHORE_MARGIN_TILES;
  const halfDepthTiles = (VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2 + ISLAND_SHORE_MARGIN_TILES;
  const centerTileX = (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2;
  const centerTileY = (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2;
  const centerWorld = tileToWorld({ x: centerTileX, y: centerTileY }, mapping);

  // The config's world measures are authored at the standard pitch; a layout drawn at another tile
  // size scales them by the same factor every other measure here uses.
  const pitchScale = input.layout.pitch / (DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP);
  const islandShape = {
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ,
    halfWidthWorld: halfWidthTiles * input.layout.pitch,
    halfDepthWorld: halfDepthTiles * input.layout.pitch,
    exponent: ISLAND_SHAPE_EXPONENT,
    lobes: ISLAND_LOBES
  };
  const terrain: TerrainShape = {
    ...islandShape,
    reliefWorld: TERRAIN_RELIEF_WORLD * pitchScale,
    flatAreas: terrainFlatAreas(mapping),
    uplands: ISLAND_UPLANDS
  };

  const lockedPlots: LockedPlotSquare[] = previewLockedPlots(input.plots).map((plot) => {
    return placedPlot(plotSquare(plot.plotIndex));
  });

  function placedPlot(square: PlotSquare): LockedPlotSquare {
    const centre = tileToWorld(
      { x: (square.minX + square.maxX) / 2, y: (square.minY + square.maxY) / 2 },
      mapping
    );
    return {
      ...square,
      centerWorldX: centre.worldX,
      centerWorldZ: centre.worldZ,
      sizeWorld: PLOT_TILE_SIZE * input.layout.pitch
    };
  }

  /**
   * A rectangle of ground with `marginTiles` of slack on every side, in world metres.
   *
   * The apron and the bed are both built this way: both hug the land the farm owns rather than the
   * reserve, so the field is what the eye lands on and the reserve reads as ground around it.
   */
  function groundRect(bounds: TileBounds, marginTiles: number): GroundRect {
    const centre = tileToWorld(
      { x: (bounds.minX + bounds.maxX + 1) / 2, y: (bounds.minY + bounds.maxY + 1) / 2 },
      mapping
    );
    return {
      worldX: centre.worldX,
      worldZ: centre.worldZ,
      widthWorld: (bounds.maxX - bounds.minX + 1 + marginTiles * 2) * input.layout.pitch,
      depthWorld: (bounds.maxY - bounds.minY + 1 + marginTiles * 2) * input.layout.pitch
    };
  }

  // `outer` is non-null past the early return, so there is always something to cultivate around.
  const owned = inner ?? outer;
  const apron = groundRect(owned, APRON_MARGIN_TILES);
  const bed = groundRect(owned, 0);
  // What a default camera frames: the owned field and the apron around it, not the whole estate.
  const ownedHalfTiles = Math.max(owned.maxX - owned.minX + 1, owned.maxY - owned.minY + 1) / 2;
  const farmHalfExtentWorld = ownedHalfTiles * input.layout.pitch + APRON_MARGIN_TILES * input.layout.pitch;

  const roads = ROADS.map((road) => buildRoadSpec(road, input.layout, terrain));

  /**
   * The places the roads meet.
   *
   * A stop's surface is the most important road that touches it - a stone spine passing through a
   * village square paves the whole junction, not half of it - and the disc is a little wider than the
   * widest road there, so the road ends tuck under it instead of meeting edge to edge.
   */
  const roadRank: Readonly<Record<RoadKind, number>> = { PRIMARY: 3, SECONDARY: 2, PATH: 1 };
  const surfaceAt = new Map<RoadNodeId, RoadKind>();
  for (const road of ROADS) {
    for (const node of road.connects) {
      const existing = surfaceAt.get(node);
      if (existing === undefined || roadRank[road.kind] > roadRank[existing]) surfaceAt.set(node, road.kind);
    }
  }
  const junctions: JunctionSpec[] = [...surfaceAt].map(([node, kind]) => {
    const centre = tileToWorld(ROAD_NODES[node], mapping);
    return {
      id: `junction_${node}`,
      worldX: centre.worldX,
      worldY: GROUND_SURFACE_Y + terrainHeightAt(centre.worldX, centre.worldZ, terrain) + ROAD_LIFT_WORLD,
      worldZ: centre.worldZ,
      radiusWorld: ROAD_WIDTH_TILES[kind] * input.layout.pitch * 0.62,
      kind
    };
  });

  // The agricultural fields: rectangles of the reserve the catalogue has not sold yet, drawn as
  // fields. They are overlay work because they sit where the player will eventually farm, and the
  // apron has to be able to paint over them.
  const fieldBlocks = FIELD_BLOCKS.map((block) => {
    const centre = tileToWorld(
      { x: (block.bounds.minX + block.bounds.maxX + 1) / 2, y: (block.bounds.minY + block.bounds.maxY + 1) / 2 },
      mapping
    );
    return {
      id: block.id,
      kind: block.kind,
      worldX: centre.worldX,
      worldZ: centre.worldZ,
      widthWorld: (block.bounds.maxX - block.bounds.minX + 1) * input.layout.pitch,
      depthWorld: (block.bounds.maxY - block.bounds.minY + 1) * input.layout.pitch,
      rotationY: block.rotationY
    };
  });

  // The aquaculture cages: two rows of three along the bay, just outside the waterline and clear of
  // the pier. Placing them from the outline rather than from hand-picked coordinates is what makes
  // "in water" true by construction, and grouping them into rows is what makes them read as a farm
  // moored in the bay rather than as five frames adrift.
  const aquaculture: { readonly worldX: number; readonly worldZ: number; readonly radiusWorld: number; readonly rotationY: number }[] = [];
  for (const [row, distance] of FISH_FARM.rowDistances.entries()) {
    for (let column = 0; column < FISH_FARM.perRow; column += 1) {
      const parameter = FISH_FARM.firstParameter + column * FISH_FARM.parameterStep;
      const rim = islandRimPoint(parameter, terrain);
      aquaculture.push({
        worldX: terrain.centerWorldX + (rim.worldX - terrain.centerWorldX) * distance,
        worldZ: terrain.centerWorldZ + (rim.worldZ - terrain.centerWorldZ) * distance,
        radiusWorld: 1.55 * input.layout.pitch,
        // Cages stand square to the shore they are moored off, so the raft's rows run parallel to it.
        rotationY: parameter + row * 0.06
      });
    }
  }

  const plazaCentre = tileToWorld(PLAZA.center, mapping);
  const harbourRoot = tileToWorld(HARBOUR.root, mapping);
  const harbourYard = tileToWorld(HARBOUR.yard, mapping);
  const loggingCentre = tileToWorld(LOGGING_YARD.center, mapping);

  /**
   * The set dressing, built from the authored presets.
   *
   * A prop whose id nothing imported is skipped rather than drawn as a placeholder: a missing model
   * is a hole in the yard, and a hole is easier to see and to fix than a wrong shape standing in it.
   * `PROP_MODELS` is the one place that knows a prop's real size, so the preset only has to say
   * "one barrel, here, turned this way".
   */
  const compositions = buildCompositions(
    COMPOSITION_PRESETS,
    input.layout,
    terrain,
    (assetId) => PROP_MODELS.get(assetId)?.sizeWorld ?? 1
  );

  const pondCentre = tileToWorld(POND.center, mapping);
  const yardCentre = tileToWorld(FARMSTEAD.center, mapping);

  return {
    inner,
    outer,
    apron,
    bed,
    lockedPlots,
    // Every plot the catalogue has not sold, not just the ring it is offering: land the player has
    // not bought is countryside, and it belongs to the overlay because buying a plot clears it.
    lockedScenery: buildLockedScenery(
      input.plots
        .filter((plot) => !plot.unlocked)
        .map((plot) => plotSquare(plot.plotIndex)),
      input.layout
    ),
    lockedBoundary: buildLockedBoundary(
      previewLockedPlots(input.plots).map((plot) => plotSquare(plot.plotIndex)),
      input.layout
    ),
    landmarks: LANDMARKS.map((landmark) => ({ ...landmark, ...tileToWorld(landmark.tile, mapping) })),
    districts: DISTRICTS.map((district) => {
      const centre = tileToWorld(district.center, mapping);
      return {
        id: district.id,
        kind: district.kind,
        ground: district.ground,
        worldX: centre.worldX,
        worldZ: centre.worldZ,
        radiusWorldX: district.radiusX * input.layout.pitch,
        radiusWorldZ: district.radiusY * input.layout.pitch,
        rotationY: district.rotationY
      };
    }),
    roads,
    junctions,
    fieldBlocks,
    plaza: {
      worldX: plazaCentre.worldX,
      worldZ: plazaCentre.worldZ,
      radiusWorldX: PLAZA.radiusX * input.layout.pitch,
      radiusWorldZ: PLAZA.radiusY * input.layout.pitch,
      rotationY: PLAZA.rotationY
    },
    harbour: {
      worldX: harbourRoot.worldX,
      worldZ: harbourRoot.worldZ,
      rotationY: HARBOUR.bearing,
      lengthWorld: HARBOUR.lengthTiles * input.layout.pitch,
      deckWidthWorld: HARBOUR.deckWidthTiles * input.layout.pitch,
      yardWorldX: harbourYard.worldX,
      yardWorldZ: harbourYard.worldZ
    },
    loggingYard: {
      worldX: loggingCentre.worldX,
      worldZ: loggingCentre.worldZ,
      radiusWorld: LOGGING_YARD.radiusTiles * input.layout.pitch,
      rotationY: LOGGING_YARD.rotationY
    },
    compositions,
    aquaculture,
    scenery: buildScenery(input.layout, terrain, roads, compositions.clearings),
    meadows: MEADOWS.map((patch) => {
      const centre = tileToWorld(patch.center, mapping);
      return {
        id: patch.id,
        kind: patch.kind,
        worldX: centre.worldX,
        worldZ: centre.worldZ,
        radiusWorldX: patch.radiusX * input.layout.pitch,
        radiusWorldZ: patch.radiusY * input.layout.pitch,
        rotationY: patch.rotationY
      };
    }),
    pond: {
      worldX: pondCentre.worldX,
      worldZ: pondCentre.worldZ,
      radiusWorldX: POND.radiusX * input.layout.pitch,
      radiusWorldZ: POND.radiusY * input.layout.pitch
    },
    barn: {
      worldX: yardCentre.worldX,
      worldZ: yardCentre.worldZ,
      rotationY: FARMSTEAD.rotationY
    },
    islandHalfWidthWorld: halfWidthTiles * input.layout.pitch,
    islandHalfDepthWorld: halfDepthTiles * input.layout.pitch,
    farmHalfExtentWorld,
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ,
    terrain
  };
}

