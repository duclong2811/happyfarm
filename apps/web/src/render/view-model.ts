import type { CropStateDTO, FarmTileDTO } from "@happy-farm/contracts";
import { layoutFarmTiles, type FarmLayout, type TilePlacement } from "./layout";

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

export interface SceneTile extends TilePlacement {
  readonly terrainType: FarmTileDTO["terrainType"];
  /** True only for soil with no crop: the server's planting preconditions, not a client guess. */
  readonly plantable: boolean;
  readonly selected: boolean;
  readonly crop: SceneCrop | null;
}

export interface FarmSceneInput {
  readonly layout: FarmLayout;
  readonly tiles: readonly SceneTile[];
}

export interface FarmViewState {
  readonly tiles: readonly FarmTileDTO[];
  readonly crops: readonly CropStateDTO[];
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
  const layout = layoutFarmTiles([...tilesByCoordinate.values()].map((tile) => ({ x: tile.x, y: tile.y })));

  const tiles: SceneTile[] = [];
  for (const placement of layout.placements) {
    const key = coordinateKey(placement.tileX, placement.tileY);
    const tile = tilesByCoordinate.get(key);
    // layoutFarmTiles only emits coordinates it was given, so a missing tile means there is nothing
    // authoritative to draw and the placement is skipped rather than guessed at.
    if (tile === undefined) continue;
    const crop = cropsByCoordinate.get(key) ?? null;
    tiles.push({
      ...placement,
      terrainType: tile.terrainType,
      plantable: tile.terrainType === "SOIL" && crop === null,
      selected:
        state.selected !== null &&
        state.selected.x === placement.tileX &&
        state.selected.y === placement.tileY,
      crop:
        crop === null
          ? null
          : {
              cropInstanceId: crop.cropInstanceId,
              definitionId: crop.definitionId,
              mature: crop.mature,
              heightFraction: heightFractionOf(crop)
            }
    });
  }

  return { layout, tiles };
}
