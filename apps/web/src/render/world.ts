import type { PlotDTO } from "@happy-farm/contracts";
import type { FarmLayout, TileBounds, TileCoordinate } from "./layout";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE, tileToWorld, worldFrame, worldToTile } from "./layout";
import {
  DISTRICTS,
  FARMSTEAD,
  ISLAND_LOBES,
  ISLAND_SHAPE_EXPONENT,
  ISLAND_SHORE_MARGIN_TILES,
  ISLAND_UPLANDS,
  LANDMARKS,
  LANDMARKS_WORLD,
  MEADOWS,
  POND,
  ROADS,
  TERRAIN_RELIEF_WORLD,
  VISUAL_BOUNDS,
  terrainFlatAreas,
  type District,
  type DistrictGround,
  type DistrictKind,
  type PlacedLandmark
} from "./world-config";
import { GROUND_SURFACE_Y, terrainHeightAt, type TerrainShape } from "./terrain-height";
import { buildRoadSpec, type RoadSpec } from "./roads";
export type { RoadSpec } from "./roads";

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

export type SceneryKind = "tree" | "pine" | "bush" | "rock" | "flower";

export interface SceneryInstance {
  readonly kind: SceneryKind;
  readonly worldX: number;
  /** Height of the ground under it, so a prop on a hill stands on the hill instead of inside it. */
  readonly worldY: number;
  readonly worldZ: number;
  readonly scale: number;
  readonly rotationY: number;
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
   * Every plot the catalogue has not sold, as a patch of rough ground.
   *
   * Wider than `lockedPlots`, which is only the ring being offered: the whole unclaimed reserve has
   * to read as land rather than as lawn, and this is the layer that does it.
   */
  readonly wildPatches: readonly LockedPlotSquare[];
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
  wildPatches: [],
  lockedScenery: [],
  lockedBoundary: [],
  landmarks: [],
  districts: [],
  roads: [],
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
const MAX_SCENERY = 900;
/** How many vegetation clusters are attempted. Rejected candidates cost only a turn of the seed. */
const SCENERY_CLUSTER_ATTEMPTS = 220;
/** How far outside the fence a planted thing has to be to count as countryside rather than field. */
const FIELD_CLEARANCE_TILES = 1.4;
/** Tile spacing between the stakes that mark the edge of the land that is still locked. */
const LOCKED_STAKE_SPACING_TILES = 3;
/** How many wild props a locked plot grows, before the per-prop open-ground filter. */
const LOCKED_PROPS_PER_PLOT = 70;
/** Tree spacing inside an orchard's rows, in tiles. */
const ORCHARD_ROW_SPACING_TILES = 4.2;
/** How far a prop has to stay from a road's centreline, in tiles. */
const ROAD_CLEARANCE_TILES = 1.6;

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
      return roll < 0.58 ? "tree" : roll < 0.83 ? "pine" : "bush";
    case "SHRUBS":
      return roll < 0.72 ? "bush" : roll < 0.9 ? "flower" : "rock";
    case "ROCKS":
      return roll < 0.78 ? "rock" : roll < 0.92 ? "bush" : "flower";
    case "FLOWERS":
      return roll < 0.86 ? "flower" : "bush";
  }
}

/** Which cluster a district grows, read off its kind. */
function clusterKindFor(kind: DistrictKind, roll: number): ClusterKind {
  switch (kind) {
    case "FOREST":
      return "FOREST";
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
  clearings: readonly TileBounds[]
): SceneryInstance[] {
  const rand = mulberry32(SCENERY_SEED);
  const scenery: SceneryInstance[] = [];
  const frame = worldFrame(layout.pitch);

  /**
   * The tiles a road runs through, as a set.
   *
   * A prop standing in the middle of the primary road is the most obvious way to make a designed map
   * look generated, and checking every candidate against every road sample would cost more than the
   * rest of the world build. One tile lookup keeps it cheap and exact enough.
   */
  const roadTiles = new Set<string>();
  for (const road of roads) {
    const clearance = Math.ceil(ROAD_CLEARANCE_TILES);
    for (const sample of road.samples) {
      const tile = worldToTile({ worldX: sample.worldX, worldZ: sample.worldZ }, frame);
      for (let dy = -clearance; dy <= clearance; dy += 1) {
        for (let dx = -clearance; dx <= clearance; dx += 1) {
          roadTiles.add(`${String(tile.x + dx)},${String(tile.y + dy)}`);
        }
      }
    }
  }

  function place(kind: SceneryKind, tileX: number, tileY: number, scale: number, rotationY: number): void {
    if (scenery.length >= MAX_SCENERY) return;
    const position = tileToWorld({ x: tileX, y: tileY }, frame);
    scenery.push({
      kind,
      worldX: position.worldX,
      // Stands on the ground rather than under it: the same function the terrain mesh is built from.
      worldY: GROUND_SURFACE_Y + terrainHeightAt(position.worldX, position.worldZ, terrain),
      worldZ: position.worldZ,
      scale,
      rotationY
    });
  }

  /**
   * Whether a candidate is standing room rather than field, water, road, or a landmark's clearing.
   *
   * Every exclusion is a constant of the world config, so this answer never depends on how much land
   * the farm owns.
   */
  function isOpenGround(tileX: number, tileY: number): boolean {
    // Nothing grows past the map, whatever a district's blob or a cluster's radius reaches for.
    if (
      tileX < VISUAL_BOUNDS.minX ||
      tileX > VISUAL_BOUNDS.maxX ||
      tileY < VISUAL_BOUNDS.minY ||
      tileY > VISUAL_BOUNDS.maxY
    ) {
      return false;
    }
    // The land the farm works, and the plots it is being offered, are the only places on the island
    // that stay clear: everywhere else - including the reserve the catalogue has not reached yet - is
    // countryside, because a field nobody has bought yet is still landscape.
    for (const clearing of clearings) {
      if (
        tileX >= clearing.minX - FIELD_CLEARANCE_TILES &&
        tileX <= clearing.maxX + FIELD_CLEARANCE_TILES &&
        tileY >= clearing.minY - FIELD_CLEARANCE_TILES &&
        tileY <= clearing.maxY + FIELD_CLEARANCE_TILES
      ) {
        return false;
      }
    }
    if (roadTiles.has(`${String(Math.round(tileX))},${String(Math.round(tileY))}`)) return false;
    const pondDx = (tileX - POND.center.x) / (POND.radiusX + 1.6);
    const pondDy = (tileY - POND.center.y) / (POND.radiusY + 1.6);
    if (pondDx * pondDx + pondDy * pondDy < 1) return false;
    if (Math.abs(tileX - FARMSTEAD.center.x) < 5 && Math.abs(tileY - FARMSTEAD.center.y) < 5) return false;
    const world = tileToWorld({ x: tileX, y: tileY }, frame);
    for (const landmark of LANDMARKS_WORLD) {
      if (Math.hypot(world.worldX - landmark.worldX, world.worldZ - landmark.worldZ) < landmark.blockingRadiusWorld + 2.2) {
        return false;
      }
    }
    return true;
  }

  // 1. The tree line inside the island's rim. It is what makes the world read as a place with an edge
  // rather than as a shape that stops, and it is one row deep so it frames the view.
  const inset = RIM_TREE_BAND_TILES / 2;
  const rimX: number[] = [];
  for (let x = VISUAL_BOUNDS.minX + inset; x <= VISUAL_BOUNDS.maxX - inset; x += RIM_TREE_SPACING_TILES) {
    rimX.push(x);
  }
  for (const [index, x] of rimX.entries()) {
    for (const y of [VISUAL_BOUNDS.minY + inset, VISUAL_BOUNDS.maxY - inset]) {
      const jitterX = (rand() - 0.5) * 0.6;
      const jitterY = (rand() - 0.5) * 0.6;
      const scaleRoll = rand();
      const rotationRoll = rand();
      const kind: SceneryKind = index % 2 === 0 ? "tree" : "pine";
      if (isOpenGround(x + jitterX, y + jitterY)) {
        place(kind, x + jitterX, y + jitterY, 1 + scaleRoll * 0.45, rotationRoll * Math.PI * 2);
      }
    }
  }
  for (let y = VISUAL_BOUNDS.minY + inset + RIM_TREE_SPACING_TILES; y <= VISUAL_BOUNDS.maxY - inset - RIM_TREE_SPACING_TILES; y += RIM_TREE_SPACING_TILES) {
    for (const x of [VISUAL_BOUNDS.minX + inset, VISUAL_BOUNDS.maxX - inset]) {
      const jitterX = (rand() - 0.5) * 0.6;
      const jitterY = (rand() - 0.5) * 0.6;
      const scaleRoll = rand();
      const rotationRoll = rand();
      const kind: SceneryKind = rand() < 0.5 ? "tree" : "pine";
      if (isOpenGround(x + jitterX, y + jitterY)) {
        place(kind, x + jitterX, y + jitterY, 1 + scaleRoll * 0.45, rotationRoll * Math.PI * 2);
      }
    }
  }

  // 2. The orchard: rows, not a scatter. Rows are what makes perennial agriculture legible from a
  // distance, and they are laid on the district's own axis so a lane follows the ground it is on.
  for (const district of DISTRICTS) {
    if (district.kind !== "ORCHARD") continue;
    const cos = Math.cos(district.rotationY);
    const sin = Math.sin(district.rotationY);
    for (let row = -Math.ceil(district.radiusY); row <= district.radiusY; row += ORCHARD_ROW_SPACING_TILES) {
      for (let column = -Math.ceil(district.radiusX); column <= district.radiusX; column += ORCHARD_ROW_SPACING_TILES) {
        const jitterX = (rand() - 0.5) * 0.7;
        const jitterY = (rand() - 0.5) * 0.7;
        const scaleRoll = rand();
        const rotationRoll = rand();
        const localX = column + jitterX;
        const localZ = row + jitterY;
        const tileX = district.center.x + localX * cos - localZ * sin;
        const tileY = district.center.y + localX * sin + localZ * cos;
        if (!isOpenGround(tileX, tileY)) continue;
        place("tree", tileX, tileY, 0.95 + scaleRoll * 0.35, rotationRoll * Math.PI * 2);
      }
    }
  }

  // 3. The clusters. A cluster's centre is drawn from a district in proportion to that district's own
  // density, so woodland is dense, pasture is nearly open, and the settlement has a few trees in it.
  const weighted: District[] = [];
  for (const district of DISTRICTS) {
    // A district with no density grows nothing and does not spend a turn of the seed.
    if (district.density <= 0) continue;
    const shares = Math.max(1, Math.round(district.density * 12));
    for (let index = 0; index < shares; index += 1) weighted.push(district);
  }
  for (let attempt = 0; attempt < SCENERY_CLUSTER_ATTEMPTS; attempt += 1) {
    const district = weighted[attempt % weighted.length];
    if (district === undefined) continue;
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

    const cluster = clusterKindFor(district.kind, kindRoll);
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
      const rolled = clusterMemberKind(cluster, memberKindRoll);
      const kind: SceneryKind = memberKindRoll > district.treeShare && rolled === "tree" ? "bush" : rolled;
      place(kind, at.x, at.y, 0.78 + scaleRoll * 0.55, rotationRoll * Math.PI * 2);
    }
  }

  return scenery;
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

  for (const plot of plots) {
    // One seed per plot rather than one for the list: buying a plot has to clear *that* plot's wild
    // growth, not reshuffle every other plot's.
    const rand = mulberry32(LOCKED_SCENERY_SEED + plot.plotIndex * 0x9e3779b1);
    for (let index = 0; index < LOCKED_PROPS_PER_PLOT; index += 1) {
      const x = plot.minX + edgeMargin + rand() * (plot.maxX - plot.minX + 1 - edgeMargin * 2);
      const y = plot.minY + edgeMargin + rand() * (plot.maxY - plot.minY + 1 - edgeMargin * 2);
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      const kind: SceneryKind =
        kindRoll < 0.42 ? "bush" : kindRoll < 0.72 ? "flower" : kindRoll < 0.9 ? "rock" : "tree";
      const position = tileToWorld({ x, y }, frame);
      scenery.push({
        kind,
        worldX: position.worldX,
        // Locked land is always on the reserve's flat plateau, and its rough surface sits a hair above
        // the grass, so this is the patch's own level rather than the terrain's.
        worldY: LOCKED_GROUND_SURFACE_Y,
        worldZ: position.worldZ,
        // Smaller than open-country scenery: this is scrub coming up on neglected ground.
        scale: 0.62 + scaleRoll * 0.42,
        rotationY: rotationRoll * Math.PI * 2
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

  const wildPatches: LockedPlotSquare[] = input.plots
    .filter((plot) => !plot.unlocked)
    .map((plot) => placedPlot(plotSquare(plot.plotIndex)));

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
   * What scenery may not grow on: the land the farm works, and the plots it is being offered.
   *
   * Everything else is countryside, including the rest of the reserve. That is the point of the
   * master plan: an unbought field is still landscape, and only the ring the catalogue is selling
   * right now is cleared for its own treatment.
   */
  const clearings: TileBounds[] = [
    {
      minX: owned.minX - APRON_MARGIN_TILES,
      maxX: owned.maxX + APRON_MARGIN_TILES,
      minY: owned.minY - APRON_MARGIN_TILES,
      maxY: owned.maxY + APRON_MARGIN_TILES
    },
    ...previewLockedPlots(input.plots).map((plot) => plotSquare(plot.plotIndex))
  ];

  const pondCentre = tileToWorld(POND.center, mapping);
  const yardCentre = tileToWorld(FARMSTEAD.center, mapping);

  return {
    inner,
    outer,
    apron,
    bed,
    lockedPlots,
    wildPatches,
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
    scenery: buildScenery(input.layout, terrain, roads, clearings),
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

