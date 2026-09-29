import type { CropStateDTO, FarmTileDTO, PlotDTO, TreeStateDTO } from "@happy-farm/contracts";
import { layoutFarmTiles, type FarmLayout, type TilePlacement } from "./layout";
import { buildFarmWorld, landFrame, type FarmWorld } from "./world";

/**
 * Turns authoritative farm state into render descriptors.
 *
 * Pure by design: no three, no DOM, no clock, no network. What the 3D view will show can therefore
 * be asserted in a unit test, and two rules live here rather than inside the renderer:
 *
 * 1. A crop renders only when the server also returned its tile as unlocked land. A crop without a
 *    tile row is unknown or stale, and drawing it would invent land the player does not have.
 * 2. Growth is display only. `growthProgress` and `mature` come from the server, and maturity is
 *    never derived from a client clock, so a wrong or tampered local clock cannot make a crop look
 *    ready to harvest.
 */

export interface SceneCrop {
  readonly cropInstanceId: string;
  readonly definitionId: string;
  readonly mature: boolean;
  /** Height as a fraction of a fully grown crop, clamped to 0..1. */
  readonly heightFraction: number;
}

/**
 * The four visual stages a tree can be drawn in.
 *
 * Derived from the server's phase and growth numbers, never decided here: this is the only place the
 * renderer's vocabulary meets the contract's, and it is a projection in one direction.
 */
export type TreeVisualStage = "SAPLING" | "GROWING" | "READY" | "REGROWING";

export interface SceneTree {
  readonly treeInstanceId: string;
  readonly definitionId: string;
  readonly visualStage: TreeVisualStage;
  /** 0..1 within the current cycle, straight from the server's projection. */
  readonly growthProgress: number;
  readonly ready: boolean;
}

export interface SceneTile extends TilePlacement {
  readonly terrainType: FarmTileDTO["terrainType"];
  /** True only for soil with no crop: the server's planting preconditions, not a client guess. */
  readonly plantable: boolean;
  readonly selected: boolean;
  readonly crop: SceneCrop | null;
  /** The tree on this tile, or null. A tile never holds both, but this file does not assume it. */
  readonly tree: SceneTree | null;
}

export interface FarmSceneInput {
  readonly layout: FarmLayout;
  readonly world: FarmWorld;
  readonly tiles: readonly SceneTile[];
}

export interface FarmViewState {
  readonly tiles: readonly FarmTileDTO[];
  readonly crops: readonly CropStateDTO[];
  readonly trees: readonly TreeStateDTO[];
  readonly plots: readonly PlotDTO[];
  readonly selected: { readonly x: number; readonly y: number } | null;
}

function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

function heightFractionOf(crop: CropStateDTO): number {
  if (crop.mature) return 1;
  const progress = crop.growthProgress;
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  return progress > 1 ? 1 : progress;
}

/**
 * Which of the four stages to draw.
 *
 * `READY` and `REGROWING` are the server's phase; the first growth splits into a sapling and a
 * growing tree at the first stage boundary, which is display-only.
 */
function visualStageOf(tree: TreeStateDTO): TreeVisualStage {
  if (tree.ready) return "READY";
  if (tree.phase === "REGROWING") return "REGROWING";
  return tree.growthStage <= 0 ? "SAPLING" : "GROWING";
}

function sceneTreeOf(tree: TreeStateDTO): SceneTree {
  const progress = tree.growthProgress;
  return {
    treeInstanceId: tree.treeInstanceId,
    definitionId: tree.definitionId,
    visualStage: visualStageOf(tree),
    growthProgress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0,
    ready: tree.ready
  };
}

/** One player, one farm, one crop per tile: the first row for a coordinate is the winner. */
function firstByCoordinate<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const byCoordinate = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    if (!byCoordinate.has(itemKey)) byCoordinate.set(itemKey, item);
  }
  return byCoordinate;
}

export function buildFarmSceneInput(state: FarmViewState): FarmSceneInput {
  // Duplicates collapse to the same row on every refresh, so the scene cannot flicker between two
  // candidates when the API repeats a coordinate.
  const tilesByCoordinate = firstByCoordinate(state.tiles, (tile) => coordinateKey(tile.x, tile.y));
  const cropsByCoordinate = firstByCoordinate(state.crops, (crop) => coordinateKey(crop.tileX, crop.tileY));
  const treesByCoordinate = firstByCoordinate(state.trees, (tree) => coordinateKey(tree.tileX, tree.tileY));
  const uniqueTiles = [...tilesByCoordinate.values()].map((tile) => ({ x: tile.x, y: tile.y }));
  const frame = landFrame(uniqueTiles, state.plots);
  const layout = layoutFarmTiles(uniqueTiles, frame === null ? {} : { frame });
  const world = buildFarmWorld({ layout, tiles: uniqueTiles, plots: state.plots });

  const tiles: SceneTile[] = [];
  for (const placement of layout.placements) {
    const key = coordinateKey(placement.tileX, placement.tileY);
    const tile = tilesByCoordinate.get(key);
    // layoutFarmTiles only emits coordinates it was given, so a missing tile means there is nothing
    // authoritative to draw and the placement is skipped rather than guessed at.
    if (tile === undefined) continue;
    const crop = cropsByCoordinate.get(key) ?? null;
    const tree = treesByCoordinate.get(key) ?? null;
    tiles.push({
      ...placement,
      terrainType: tile.terrainType,
      // Three conditions, not two: a tree occupies its tile for as long as it stands, exactly as a
      // crop does. Corrupt state holding both still renders (the renderer draws the tree) and is
      // never plantable, and this file never edits the rows it was given.
      plantable: tile.terrainType === "SOIL" && crop === null && tree === null,
      selected:
        state.selected !== null &&
        state.selected.x === placement.tileX &&
        state.selected.y === placement.tileY,
      tree:
        tree === null
          ? null
          : sceneTreeOf(tree),
      crop:
        crop === null || tree !== null
          ? null
          : {
              cropInstanceId: crop.cropInstanceId,
              definitionId: crop.definitionId,
              mature: crop.mature,
              heightFraction: heightFractionOf(crop)
            }
    });
  }

  return { layout, world, tiles };
}
