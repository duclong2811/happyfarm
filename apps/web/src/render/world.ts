import type { PlotDTO } from "@happy-farm/contracts";
import type { FarmLayout, TileBounds, TileCoordinate } from "./layout";
import {
  DEFAULT_TILE_GAP,
  DEFAULT_TILE_SIZE,
  tileToWorld,
  worldFrame
} from "./layout";
import {
  FARMHOUSE,
  FENCE,
  FARM_HALF_EXTENT_WORLD,
  MEADOWS,
  PATHS,
  POND,
  RIM_TREE_BAND_TILES,
  RIM_TREE_SPACING_TILES,
  TREE_BANDS,
  VISUAL_BOUNDS
} from "./world-config";

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
  readonly worldZ: number;
  readonly scale: number;
  readonly rotationY: number;
}

export interface PathSpec {
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
  /** World-unit extent of the outer land plus its dirt apron. */
  readonly apronWidth: number;
  readonly apronDepth: number;
  readonly lockedPlots: readonly LockedPlotSquare[];
  readonly scenery: readonly SceneryInstance[];
  readonly pond: PondSpec | null;
  readonly barn: BarnSpec | null;
  readonly path: PathSpec | null;
  /** Terrain variation outside the field. Static: a fixed function of the world config. */
  readonly meadows: readonly MeadowSpec[];
  readonly islandHalfWidthWorld: number;
  readonly islandHalfDepthWorld: number;
  /** Half the framed farm: the land the fence encloses, which is what a default view frames. */
  readonly farmHalfExtentWorld: number;
  /** World centre of the static world, for camera framing only. Never a coordinate origin. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
}

export interface BuildWorldInput {
  readonly layout: FarmLayout;
  readonly tiles: readonly TileCoordinate[];
  readonly plots: readonly PlotDTO[];
}

const EMPTY_WORLD: FarmWorld = {
  inner: null,
  outer: null,
  apronWidth: 0,
  apronDepth: 0,
  lockedPlots: [],
  scenery: [],
  pond: null,
  barn: null,
  path: null,
  meadows: [],
  islandHalfWidthWorld: 0,
  islandHalfDepthWorld: 0,
  farmHalfExtentWorld: 0,
  centerWorldX: 0,
  centerWorldZ: 0
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
const MAX_SCENERY = 240;
/** One candidate position per this many tiles, before the filters decide what survives. */
const SCENERY_LATTICE_STEP_TILES = 1.15;
/** How far outside the fence a planted thing has to be to count as scenery rather than as field. */
const FIELD_CLEARANCE_TILES = 1.2;

/**
 * Deterministic decoration placement: the tree lines that give the island an edge, the planted
 * bands the reserved regions promise, and a scatter of bushes, rocks, and flowers between them.
 *
 * The seed and the lattice are constants and the generator advances once per candidate in a fixed
 * order, so the same world always grows the same trees - and buying a plot cannot reshuffle them,
 * because nothing here reads the farm's tiles. Only land the player cannot farm is decorated: the
 * field, the apron, the paths, the pond, and the yard stay clear.
 */
function buildScenery(layout: FarmLayout): SceneryInstance[] {
  const rand = mulberry32(SCENERY_SEED);
  const scenery: SceneryInstance[] = [];
  const frame = worldFrame(layout.pitch);
  const field = FENCE.bounds;
  const halfWidthTiles = (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2;
  const halfDepthTiles = (VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2;
  // The island's own centre, not the starter land's: the edge tree line and the scatter both live on
  // the island, and only the tile mapping is anchored to the starter square.
  const centerTileX = (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2;
  const centerTileY = (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2;

  function place(kind: SceneryKind, tileX: number, tileY: number, scale: number, rotationY: number): void {
    const position = tileToWorld({ x: tileX, y: tileY }, frame);
    scenery.push({ kind, worldX: position.worldX, worldZ: position.worldZ, scale, rotationY });
  }

  /**
   * Whether a candidate is standing room rather than field, water, path, or yard.
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
    if (Math.abs(tileX - FARMHOUSE.center.x) < 4.2 && Math.abs(tileY - FARMHOUSE.center.y) < 4.2) return false;
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

  // The scatter. Density rises toward the rim and falls toward the field, so the middle of the island
  // reads as tended ground and the outside as wilderness - the visual hierarchy the alpha lacked.
  for (let tileY = VISUAL_BOUNDS.minY; tileY <= VISUAL_BOUNDS.maxY; tileY += SCENERY_LATTICE_STEP_TILES) {
    for (let tileX = VISUAL_BOUNDS.minX; tileX <= VISUAL_BOUNDS.maxX; tileX += SCENERY_LATTICE_STEP_TILES) {
      const jitterX = rand();
      const jitterY = rand();
      const densityRoll = rand();
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();
      if (scenery.length >= MAX_SCENERY) continue;

      const at = { x: tileX + jitterX * 0.9, y: tileY + jitterY * 0.9 };
      const normalX = (at.x - centerTileX) / (halfWidthTiles - 1.4);
      const normalY = (at.y - centerTileY) / (halfDepthTiles - 1.4);
      const radius = Math.hypot(normalX, normalY);
      if (radius > 0.94) continue;
      if (!isOpenGround(at.x, at.y)) continue;
      const density = 0.16 + 0.55 * Math.min(1, Math.max(0, (radius - 0.3) / 0.62));
      if (densityRoll > density) continue;

      const kind: SceneryKind =
        kindRoll < 0.18 ? "tree" : kindRoll < 0.34 ? "pine" : kindRoll < 0.66 ? "bush" : kindRoll < 0.85 ? "rock" : "flower";
      place(kind, at.x, at.y, 0.8 + scaleRoll * 0.5, rotationRoll * Math.PI * 2);
    }
  }

  return scenery;
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
  const halfWidthTiles = (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2;
  const halfDepthTiles = (VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2;
  const centerTileX = (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2;
  const centerTileY = (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2;
  const centerWorld = tileToWorld({ x: centerTileX, y: centerTileY }, mapping);

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
  const yardCentre = tileToWorld(FARMHOUSE.center, mapping);
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

  const apronWidth = (FENCE.bounds.maxX - FENCE.bounds.minX + 1) * input.layout.pitch;
  const apronDepth = (FENCE.bounds.maxY - FENCE.bounds.minY + 1) * input.layout.pitch;

  return {
    inner,
    outer,
    apronWidth,
    apronDepth,
    lockedPlots,
    scenery: buildScenery(input.layout),
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
      rotationY: FARMHOUSE.rotationY
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
    // The config's farm frame is in world metres at the standard pitch; a layout drawn at another
    // tile size scales it by the same factor every other measure here uses.
    farmHalfExtentWorld:
      FARM_HALF_EXTENT_WORLD * (input.layout.pitch / (DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP)),
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ
  };
}
