import type { ConstructionDTO, CropStateDTO, FarmTileDTO, PlotDTO, TreeStateDTO } from "@happy-farm/contracts";
import { layoutFarmTiles, type FarmLayout, type TilePlacement } from "./layout";
import { buildFarmWorld, landFrame, type FarmWorld } from "./world";
import { buildWorldCellMap } from "./world-cell-map";
import type { WorldCellMap } from "./world-cell";

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
 * The visual stages a tree can be drawn in, including the explicit stump of a depleted one-shot tree.
 *
 * Derived from the server's phase and growth numbers, never decided here: this is the only place the
 * renderer's vocabulary meets the contract's, and it is a projection in one direction.
 */
export type TreeVisualStage = "SAPLING" | "GROWING" | "READY" | "REGROWING" | "DEPLETED";

export interface SceneTree {
  readonly treeInstanceId: string;
  readonly definitionId: string;
  readonly phase: TreeStateDTO["phase"];
  readonly visualStage: TreeVisualStage;
  /** 0..1 within the current cycle, straight from the server's projection. */
  readonly growthProgress: number;
  readonly ready: boolean;
  readonly rotation?: 0 | 1 | 2 | 3;
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

/**
 * Whether a tile shows a tilled soil pad.
 *
 * Ownership is not terrain: an owned cell the player has not cultivated is grass, and only a cell
 * actually carrying a crop is drawn as soil. Extracted so the renderer and its tests read the same
 * rule, and so "buying land must not turn the island brown" is a promise a unit test can keep.
 */
export function tileDrawsSoil(tile: SceneTile): boolean {
  return tile.crop !== null;
}

export interface FarmSceneInput {
  readonly layout: FarmLayout;
  readonly world: FarmWorld;
  readonly tiles: readonly SceneTile[];
  /**
   * The island, cell by cell.
   *
   * Built from the world plus the farm's own rows, because occupancy is *current* state: a cell is
   * `PRODUCTION` while a crop stands on it and empty again the moment it is harvested. It travels
   * with the scene input so the renderer, the selection layer, the action resolver and the player's
   * collision all read one map rather than each asking the world its own question.
   */
  readonly cells: WorldCellMap;
}

export interface FarmViewState {
  readonly tiles: readonly FarmTileDTO[];
  readonly crops: readonly CropStateDTO[];
  readonly trees: readonly TreeStateDTO[];
  readonly plots: readonly PlotDTO[];
  /**
   * The player's own built things, when the caller has read them.
   *
   * Optional because the *farm* projection is a different read from the construction layer, and a
   * caller that only wants the field (a test, a thumbnail, an early refresh) should not have to
   * pretend it has them. Absent and empty mean the same thing here: nothing built is drawn, walked
   * around or collided with, which is the honest state of a farm whose constructions have not been
   * read yet.
   */
  readonly constructions?: readonly ConstructionDTO[];
  readonly resourceNodes?: readonly { readonly position: { readonly x: number; readonly y: number } }[];
  readonly selected: { readonly x: number; readonly y: number } | null;
}

function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

/**
 * The rectangle a persisted construction covers.
 *
 * The anchor and the *already rotated* footprint are both in the DTO, so this is the same arithmetic
 * the server's `constructionBounds` does rather than a second rule: the extra cell of an even side
 * falls on the +x/+y side in both places, which is what keeps a preview, a saved row and an occupancy
 * map naming the same ground.
 */
function constructionBoundsOf(construction: ConstructionDTO): {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
} {
  const startX = construction.anchorX - Math.floor((construction.footprint.widthCells - 1) / 2);
  const startY = construction.anchorY - Math.floor((construction.footprint.depthCells - 1) / 2);
  return {
    minX: startX,
    maxX: startX + construction.footprint.widthCells - 1,
    minY: startY,
    maxY: startY + construction.footprint.depthCells - 1
  };
}

/**
 * Whether two polls of the farm describe the same picture, as one comparison key.
 *
 * The host page polls so that a crop which ripens while nobody is looking appears without a reload,
 * and most polls find the farm exactly as it was. Everything below is a *display* input - what the
 * panels print and what the renderer draws - so an unchanged key means the whole projection can be
 * skipped: no world model, no cell map, no renderer push.
 *
 * Two deliberate choices:
 *
 * * Growth is quantised to whole percent, which is the precision the panels show. A crop is re-drawn
 *   when its printed percentage changes, not for every fraction the server's clock produces.
 * * `version`, ids, and flags are compared exactly, so nothing the client draws can miss a real
 *   change - a maturity flip, a harvest, or a plot purchase all produce a different key.
 */
export function farmPresentationSignature(state: FarmViewState): string {
  const parts: string[] = [
    state.selected === null ? "-" : `s${String(state.selected.x)},${String(state.selected.y)}`
  ];
  for (const plot of state.plots) {
    parts.push(`p${String(plot.plotIndex)}:${plot.unlocked ? "1" : "0"}:${String(plot.price)}:${String(plot.requiredLevel)}`);
  }
  for (const tile of state.tiles) {
    parts.push(`t${String(tile.x)},${String(tile.y)}:${tile.terrainType}:${tile.state}:${String(tile.version)}`);
  }
  for (const crop of state.crops) {
    parts.push(
      `c${crop.cropInstanceId}:${crop.definitionId}@${String(crop.tileX)},${String(crop.tileY)}` +
        `:${String(Math.round(crop.growthProgress * 100))}:${crop.mature ? "1" : "0"}:${String(crop.version)}`
    );
  }
  for (const tree of state.trees) {
    parts.push(
      `r${tree.treeInstanceId}:${tree.definitionId}@${String(tree.tileX)},${String(tree.tileY)}` +
        `:${tree.phase}:${String(Math.round(tree.growthProgress * 100))}:${tree.ready ? "1" : "0"}:${tree.storageState ?? "ACTIVE"}:${String(tree.rotation ?? 0)}:${String(tree.version)}`
    );
  }
  // Built things belong in the presentation signature because they are *occupancy*: a barn the player
  // puts down changes which cells may be built on, and the cell map has to be rebuilt for that.
  for (const construction of state.constructions ?? []) {
    parts.push(
      `b${construction.constructionId}:${construction.entryId}` +
        `@${String(construction.anchorX)},${String(construction.anchorY)}:${String(construction.rotation)}` +
        `:${String(construction.version)}` +
        `:${construction.forestry?.status ?? "-"}:${construction.forestry?.regenerationAt ?? "-"}:${String(construction.forestry?.version ?? 0)}`
    );
  }
  return parts.join(";");
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
  if (tree.phase === "DEPLETED") return "DEPLETED";
  if (tree.phase === "REGROWING") return "REGROWING";
  return tree.growthStage <= 0 ? "SAPLING" : "GROWING";
}

function sceneTreeOf(tree: TreeStateDTO): SceneTree {
  const progress = tree.growthProgress;
  return {
    treeInstanceId: tree.treeInstanceId,
    definitionId: tree.definitionId,
    phase: tree.phase,
    visualStage: visualStageOf(tree),
    growthProgress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0,
    ready: tree.ready,
    rotation: tree.rotation ?? 0
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
  const activeTrees = state.trees.filter((tree) => tree.storageState !== "STORED");
  const treesByCoordinate = firstByCoordinate(activeTrees, (tree) => coordinateKey(tree.tileX, tree.tileY));
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

  // The cell map is built last, from the world and the rows: terrain and land use come from the
  // config, occupancy comes from what is actually growing.
  const cells = buildWorldCellMap({
    layout,
    tiles: uniqueTiles,
    // Stored objects occupy no ground, so they are not occupancy: the map is built from what stands
    // on the island, exactly as the renderer draws from what stands on the island.
    constructions: (state.constructions ?? [])
      .filter((construction) => construction.state === "ACTIVE")
      .map((construction) => constructionBoundsOf(construction)),
    plantedTiles: state.crops.map((crop) => ({ x: crop.tileX, y: crop.tileY })).concat(
      activeTrees.map((tree) => ({ x: tree.tileX, y: tree.tileY }))
    ),
    resourceNodes: (state.resourceNodes ?? []).map((node) => node.position),
    scenery: world.scenery,
    roads: world.roads
  }, world.terrain);

  return { layout, world, tiles, cells };
}
