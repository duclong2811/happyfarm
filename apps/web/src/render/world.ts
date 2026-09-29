import type { PlotDTO } from "@happy-farm/contracts";
import type { FarmLayout, TileBounds, TileCoordinate } from "./layout";
import { tileToWorld, worldFrame, WORLD_ORIGIN_TILE_X, WORLD_ORIGIN_TILE_Y } from "./layout";
import {
  FARMHOUSE,
  FENCE,
  PATHS,
  POND,
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
export const PLOT_TILE_SIZE = 6;
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
  readonly islandHalfWidthWorld: number;
  readonly islandHalfDepthWorld: number;
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
  islandHalfWidthWorld: 0,
  islandHalfDepthWorld: 0,
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
const SCENERY_LATTICE = 30;
const MAX_SCENERY = 120;

/**
 * Deterministic decoration placement.
 *
 * The lattice and seed are constants, so a given farm always produces the same rocks and trees.
 * Only land the player does not own is decorated: the apron, paths, pond, and barn exclusion zones
 * keep scenery out of the playable field.
 */
function buildScenery(
  layout: FarmLayout,
  excludedField: TileBounds,
  pondTileX: number,
  pondTileY: number,
  pondRadiusTileX: number,
  pondRadiusTileY: number,
  barnTileX: number,
  barnTileY: number
): SceneryInstance[] {
  const rand = mulberry32(SCENERY_SEED);
  // The island is fixed, so the ellipse scenery inhabits is fixed too: buying land cannot move it.
  const halfWidth = (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2;
  const halfDepth = (VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2;
  const scenery: SceneryInstance[] = [];

  for (let gy = -SCENERY_LATTICE; gy <= SCENERY_LATTICE; gy += 1) {
    for (let gx = -SCENERY_LATTICE; gx <= SCENERY_LATTICE; gx += 1) {
      // Advance the generator for every candidate, in a fixed order, so positions never depend on
      // how much of the world survived the filters.
      const jitterX = rand();
      const jitterY = rand();
      const kindRoll = rand();
      const scaleRoll = rand();
      const rotationRoll = rand();

      if (scenery.length >= MAX_SCENERY) continue;

      // The lattice is anchored to the fixed world origin, never to the framed land, so buying a plot
      // cannot shuffle the scenery the player already saw.
      const tileX = WORLD_ORIGIN_TILE_X + gx + jitterX * 0.7;
      const tileY = WORLD_ORIGIN_TILE_Y + gy + jitterY * 0.7;
      const relativeX = tileX - WORLD_ORIGIN_TILE_X;
      const relativeY = tileY - WORLD_ORIGIN_TILE_Y;

      const normalX = relativeX / (halfWidth - 0.8);
      const normalY = relativeY / (halfDepth - 0.8);
      if (normalX * normalX + normalY * normalY > 0.92) continue;

      if (
        tileX >= excludedField.minX - 1.2 &&
        tileX <= excludedField.maxX + 1.2 &&
        tileY >= excludedField.minY - 1.2 &&
        tileY <= excludedField.maxY + 1.2
      ) {
        continue;
      }
      // Keep the south path clear.
      if (Math.abs(relativeX) < 1.8 && relativeY > 0) continue;
      const pondDx = (tileX - pondTileX) / (pondRadiusTileX + 1.4);
      const pondDy = (tileY - pondTileY) / (pondRadiusTileY + 1.4);
      if (pondDx * pondDx + pondDy * pondDy < 1) continue;
      if (Math.abs(tileX - barnTileX) < 3.6 && Math.abs(tileY - barnTileY) < 3.6) continue;

      const kind: SceneryKind =
        kindRoll < 0.26 ? "tree" : kindRoll < 0.48 ? "pine" : kindRoll < 0.7 ? "bush" : kindRoll < 0.87 ? "rock" : "flower";
      const position = tileToWorld({ x: tileX, y: tileY }, worldFrame(layout.pitch));
      scenery.push({
        kind,
        worldX: position.worldX,
        worldZ: position.worldZ,
        scale: 0.85 + scaleRoll * 0.5,
        rotationY: rotationRoll * Math.PI * 2
      });
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
    scenery: buildScenery(
      input.layout,
      FENCE.bounds,
      POND.center.x,
      POND.center.y,
      POND.radiusX,
      POND.radiusY,
      FARMHOUSE.center.x,
      FARMHOUSE.center.y
    ),
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
    centerWorldX: centerWorld.worldX,
    centerWorldZ: centerWorld.worldZ
  };
}
