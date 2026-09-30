import type { PlotDTO } from "@happy-farm/contracts";
import type { FarmLayout, TileBounds, TileCoordinate } from "./layout";
import {
  DEFAULT_TILE_GAP,
  DEFAULT_TILE_SIZE,
  tileToWorld,
  worldFrame,
  worldToTile
} from "./layout";
import {
  FARMSTEAD,
  FENCE,
  FARM_HALF_EXTENT_WORLD,
  ISLAND_SHORE_MARGIN_TILES,
  ISLAND_SHAPE_EXPONENT,
  LANDMARKS,
  LANDMARKS_WORLD,
  MEADOWS,
  PATHS,
  POND,
  RIM_TREE_BAND_TILES,
  RIM_TREE_SPACING_TILES,
  TERRAIN_RELIEF_WORLD,
  terrainLevelAreas,
  TREE_BANDS,
  VISUAL_BOUNDS,
  type PlacedLandmark
} from "./world-config";
import {
  GROUND_SURFACE_Y,
  islandRadiusAt,
  islandRimPoint,
  terrainHeightAt,
  type TerrainShape
} from "./terrain-height";

/**
 * Pure world geometry around the farm field.
 *
 * The renderer draws this; nothing here decides gameplay. Unlock state comes from the server's plot
 * catalogue (`PlotDTO.unlocked`), and the only thing mirrored from the server's layout rule is the
 * deterministic plot square, because the client has to draw locked land it does not own yet.
 * `tests/web/farm-world.test.ts` pins that mirror to `packages/domain/src/plot.ts`, so the two
 * cannot drift without a failing test.
 *
 * Scenery is placed from a fixed seed on a fixed lattice, so the same farm always grows the same
 * trees and rocks rather than reshuffling them on every refresh.
 */

/** Side length of one plot cohort, mirroring `PLOT_TILE_SIZE` in `packages/domain/src/plot.ts`. */
export const PLOT_TILE_SIZE = 12;
/** Grass kept around the outermost land before the island edge. */
export const WORLD_MARGIN_TILES = 5;
/** Tiles of dirt the cultivated apron keeps around the land the farm owns. */
export const APRON_MARGIN_TILES = 1.5;
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

export interface PathSpec {
  readonly worldX: number;
  readonly worldZ: number;
  readonly widthWorld: number;
  readonly depthWorld: number;
}

/** A rectangle of ground in world metres: the apron and the bed under the tiles. */
export interface GroundRect {
  readonly worldX: number;
  readonly worldZ: number;
  readonly widthWorld: number;
  readonly depthWorld: number;
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
  readonly scenery: readonly SceneryInstance[];
  readonly pond: PondSpec | null;
  readonly barn: BarnSpec | null;
  readonly path: PathSpec | null;
  /** Terrain variation outside the field. Static: a fixed function of the world config. */
  readonly meadows: readonly MeadowSpec[];
  readonly islandHalfWidthWorld: number;
  readonly islandHalfDepthWorld: number;
  /** Half the framed farm: the owned field and its apron, which is what a default view frames. */
  readonly farmHalfExtentWorld: number;
  /** World centre of the static world, for camera framing only. Never a coordinate origin. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  /** The island's outline and elevation. Static: a function of the world config alone. */
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
  scenery: [],
  pond: null,
  barn: null,
  path: null,
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
    plateauRadius: 0,
    reliefWorld: 0,
    levelAreas: []
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

/**
 * The four kinds of vegetation cluster.
 *
 * Composition is the point: a countryside reads as forest pockets, thickets, rock outcrops, and
 * flower patches, not as one tree every twenty metres. A cluster is one seed, one radius, and one
 * member count, and the member kinds follow from the cluster's kind.
 */
type ClusterKind = "FOREST" | "SHRUBS" | "ROCKS" | "FLOWERS";

/** The order clusters are attempted in. Repeated so the mix is roughly a quarter of each. */
const CLUSTER_KINDS: readonly ClusterKind[] = [
  "FOREST",
  "SHRUBS",
  "ROCKS",
  "FLOWERS",
  "FOREST",
  "SHRUBS",
  "FLOWERS",
  "ROCKS"
];

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

const SCENERY_SEED = 0x51f3a7;
/** Its own seed, so the scrub on locked land is not a copy of the countryside around it. */
const LOCKED_SCENERY_SEED = 0x2c9e11;
/**
 * Cap on the props one world draws.
 *
 * The renderer instances them by kind, so the draw calls are flat and this number bounds vertex work
 * and rebuild cost rather than batches. It is high enough that the island reads as furnished at the
 * widest camera and low enough that a rebuild during a farm refresh stays a frame's work.
 */
const MAX_SCENERY = 360;
/** How many vegetation clusters are attempted. Rejected candidates cost only a turn of the seed. */
const SCENERY_CLUSTER_ATTEMPTS = 34;
/** How far outside the fence a planted thing has to be to count as scenery rather than as field. */
const FIELD_CLEARANCE_TILES = 1.2;
/** Tile spacing between the stakes that mark the edge of the land that is still locked. */
const LOCKED_STAKE_SPACING_TILES = 3;
/** How many wild props a locked plot grows, before the per-prop open-ground filter. */
const LOCKED_PROPS_PER_PLOT = 22;

/**
 * Deterministic decoration placement: the tree line that gives the island an edge, the planted bands
 * the reserved regions promise, and vegetation clusters between them.
 *
 * The seed is a constant and the generator advances a fixed number of times per candidate, so the
 * same world always grows the same trees - and buying a plot cannot reshuffle them, because nothing
 * here reads the farm's tiles. Only land the player cannot farm is decorated: the field, the apron,
 * the paths, the pond, and every landmark's own clearing stay clear.
 */
function buildScenery(layout: FarmLayout, terrain: TerrainShape): SceneryInstance[] {
  const rand = mulberry32(SCENERY_SEED);
  const scenery: SceneryInstance[] = [];
  const frame = worldFrame(layout.pitch);
  const field = FENCE.bounds;

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
   * Whether a candidate is standing room rather than field, water, path, or a landmark's clearing.
   *
   * Every exclusion is a constant of the world config, so this answer never depends on how much land
   * the farm owns.
   */
  function isOpenGround(tileX: number, tileY: number): boolean {
    if (
      tileX >= field.minX - FIELD_CLEARANCE_TILES &&
      tileX <= field.maxX + FIELD_CLEARANCE_TILES &&
      tileY >= field.minY - FIELD_CLEARANCE_TILES &&
      tileY <= field.maxY + FIELD_CLEARANCE_TILES
    ) {
      return false;
    }
    for (const path of PATHS) {
      if (
        tileX >= path.bounds.minX - 0.6 &&
        tileX <= path.bounds.maxX + 0.6 &&
        tileY >= path.bounds.minY - 0.6 &&
        tileY <= path.bounds.maxY + 0.6
      ) {
        return false;
      }
    }
    const pondDx = (tileX - POND.center.x) / (POND.radiusX + 1.6);
    const pondDy = (tileY - POND.center.y) / (POND.radiusY + 1.6);
    if (pondDx * pondDx + pondDy * pondDy < 1) return false;
    if (Math.abs(tileX - FARMSTEAD.center.x) < 4.2 && Math.abs(tileY - FARMSTEAD.center.y) < 4.2) return false;
    // A ring of clear ground around each landmark, so a tree never grows through the windmill.
    const world = tileToWorld({ x: tileX, y: tileY }, frame);
    for (const landmark of LANDMARKS_WORLD) {
      if (Math.hypot(world.worldX - landmark.worldX, world.worldZ - landmark.worldZ) < landmark.blockingRadiusWorld + 2.2) {
        return false;
      }
    }
    return true;
  }

  // The tree line inside the island's rim. It is the reason the world reads as a place with an edge
  // rather than as a disc that stops, and it is one row deep so it frames the view without walling
  // the player in.
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
      // Every other tree in the line is a pine, so the edge has a canopy rather than a cadence.
      const kind: SceneryKind = index % 2 === 0 ? "tree" : "pine";
      place(kind, x + jitterX, y + jitterY, 1 + scaleRoll * 0.45, rotationRoll * Math.PI * 2);
    }
  }
  for (let y = VISUAL_BOUNDS.minY + inset + RIM_TREE_SPACING_TILES; y <= VISUAL_BOUNDS.maxY - inset - RIM_TREE_SPACING_TILES; y += RIM_TREE_SPACING_TILES) {
    for (const x of [VISUAL_BOUNDS.minX + inset, VISUAL_BOUNDS.maxX - inset]) {
      const jitterX = (rand() - 0.5) * 0.6;
      const jitterY = (rand() - 0.5) * 0.6;
      const scaleRoll = rand();
      const rotationRoll = rand();
      const kind: SceneryKind = rand() < 0.5 ? "tree" : "pine";
      place(kind, x + jitterX, y + jitterY, 1 + scaleRoll * 0.45, rotationRoll * Math.PI * 2);
    }
  }

  // The planted bands the reserved regions promise: the orchard's rows and the ranch's windbreak.
  for (const band of TREE_BANDS) {
    const spacing = band.spacing;
    for (let y = band.bounds.minY + band.offset; y <= band.bounds.maxY; y += spacing) {
      for (let x = band.bounds.minX + band.offset; x <= band.bounds.maxX; x += spacing) {
        const jitterX = (rand() - 0.5) * 0.5;
        const jitterY = (rand() - 0.5) * 0.5;
        const scaleRoll = rand();
        const rotationRoll = rand();
        place(band.kind.toLowerCase() as SceneryKind, x + jitterX, y + jitterY, 0.95 + scaleRoll * 0.4, rotationRoll * Math.PI * 2);
      }
    }
  }

  // The clusters. Each one is a pocket of the same vegetation: a wood, a thicket, an outcrop, or a
  // flower patch. Centres sit further out than the middle of the island, so the tended ground around
  // the farm stays open and the landscape thickens toward the water - the visual hierarchy the
  // alpha's even scatter could not produce.
  for (let attempt = 0; attempt < SCENERY_CLUSTER_ATTEMPTS; attempt += 1) {
    const kind = CLUSTER_KINDS[attempt % CLUSTER_KINDS.length] ?? "SHRUBS";
    const angle = rand() * Math.PI * 2;
    // Biased outward without ever reaching the shore, where the beach has to stay clear.
    const radius = 0.44 + 0.44 * Math.sqrt(rand());
    const memberRoll = rand();
    const sizeRoll = rand();

    const rim = islandRimPoint(angle, terrain);
    const centerX = terrain.centerWorldX + (rim.worldX - terrain.centerWorldX) * radius;
    const centerZ = terrain.centerWorldZ + (rim.worldZ - terrain.centerWorldZ) * radius;
    const center = worldToTile({ worldX: centerX, worldZ: centerZ }, frame);
    if (!isOpenGround(center.x, center.y)) continue;

    const clusterRadius = 2.2 + sizeRoll * 3.4;
    const members = Math.round(6 + memberRoll * 9);
    for (let member = 0; member < members; member += 1) {
      const memberAngle = rand() * Math.PI * 2;
      const memberDistance = clusterRadius * Math.sqrt(rand());
      const memberKindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      const at = {
        x: center.x + Math.cos(memberAngle) * memberDistance,
        y: center.y + Math.sin(memberAngle) * memberDistance
      };
      if (!isOpenGround(at.x, at.y)) continue;
      place(
        clusterMemberKind(kind, memberKindRoll),
        at.x,
        at.y,
        0.78 + scaleRoll * 0.55,
        rotationRoll * Math.PI * 2
      );
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
 * reads as untended countryside the player has not claimed rather than as a developer placeholder.
 *
 * It lives in its own list rather than in `scenery` because it is the one decoration allowed to stand
 * beside the field, and callers that assert "nothing grows in the farm" have to be able to tell the
 * two apart. It is still a pure function of the plot geometry and a fixed seed.
 */
function buildLockedScenery(
  plots: readonly PlotSquare[],
  terrain: TerrainShape,
  layout: FarmLayout
): SceneryInstance[] {
  const rand = mulberry32(LOCKED_SCENERY_SEED);
  const frame = worldFrame(layout.pitch);
  const scenery: SceneryInstance[] = [];
  /** Keeps the plot's edge readable: a stake line with a thicket sitting on top of it is noise. */
  const edgeMargin = 1.4;

  for (const plot of plots) {
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
function buildLockedBoundary(
  plots: readonly PlotSquare[],
  terrain: TerrainShape,
  layout: FarmLayout
): BoundaryStake[] {
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

  // Everything static is a function of the world config alone: the island, the yard, the pond, and
  // the paths keep their world positions while plots are bought, so the static layer never rebuilds
  // because the farm grew. Only `inner`/`outer`/`lockedPlots` below follow progression.
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
  /** Half the reserved field - the fence rectangle - which is what has to stay level. */
  const reserveHalfExtentWorld = FARM_HALF_EXTENT_WORLD * pitchScale;
  const islandShape = {
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ,
    halfWidthWorld: halfWidthTiles * input.layout.pitch,
    halfDepthWorld: halfDepthTiles * input.layout.pitch,
    exponent: ISLAND_SHAPE_EXPONENT
  };
  const terrain: TerrainShape = {
    ...islandShape,
    // The plateau's corner is the farthest the apron reaches; past it the ground is allowed to rise.
    plateauRadius: islandRadiusAt(
      islandShape.centerWorldX + reserveHalfExtentWorld,
      islandShape.centerWorldZ + reserveHalfExtentWorld,
      islandShape
    ),
    reliefWorld: TERRAIN_RELIEF_WORLD * pitchScale,
    levelAreas: terrainLevelAreas(mapping)
  };

  const lockedPlots: LockedPlotSquare[] = previewLockedPlots(input.plots).map((plot) => {
    const square = plotSquare(plot.plotIndex);
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
  });

  // The pond, the yard, and the main path are reserved zones from the world config, not positions
  // derived from how much land exists.
  const pondCentre = tileToWorld(POND.center, mapping);
  const yardCentre = tileToWorld(FARMSTEAD.center, mapping);
  const mainPath = PATHS[0];
  const pathCentre =
    mainPath === undefined
      ? null
      : tileToWorld(
          {
            x: (mainPath.bounds.minX + mainPath.bounds.maxX) / 2,
            y: (mainPath.bounds.minY + mainPath.bounds.maxY) / 2
          },
          mapping
        );

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
  // What a default camera frames: the owned field and the apron around it, not the whole reserve.
  const ownedHalfTiles = Math.max(owned.maxX - owned.minX + 1, owned.maxY - owned.minY + 1) / 2;
  const farmHalfExtentWorld = ownedHalfTiles * input.layout.pitch + APRON_MARGIN_TILES * input.layout.pitch;

  return {
    inner,
    outer,
    apron,
    bed,
    lockedPlots,
    lockedScenery: buildLockedScenery(previewLockedPlots(input.plots).map((plot) => plotSquare(plot.plotIndex)), terrain, input.layout),
    lockedBoundary: buildLockedBoundary(previewLockedPlots(input.plots).map((plot) => plotSquare(plot.plotIndex)), terrain, input.layout),
    landmarks: LANDMARKS.map((landmark) => ({ ...landmark, ...tileToWorld(landmark.tile, mapping) })),
    scenery: buildScenery(input.layout, terrain),
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
    path:
      mainPath === undefined || pathCentre === null
        ? null
        : {
            worldX: pathCentre.worldX,
            worldZ: pathCentre.worldZ,
            widthWorld: (mainPath.bounds.maxX - mainPath.bounds.minX) * input.layout.pitch + input.layout.tileSize,
            depthWorld: (mainPath.bounds.maxY - mainPath.bounds.minY) * input.layout.pitch + input.layout.tileSize
          },
    islandHalfWidthWorld: halfWidthTiles * input.layout.pitch,
    islandHalfDepthWorld: halfDepthTiles * input.layout.pitch,
    farmHalfExtentWorld,
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ,
    terrain
  };
}
