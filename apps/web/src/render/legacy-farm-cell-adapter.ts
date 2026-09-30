import { FARM_FIELD_BOUNDS } from "./world-config";
import { cellKey, cellToWorld, worldToCell, type WorldCell, type WorldCellMap } from "./world-cell";
import type { TileCoordinate } from "./layout";

/**
 * The bridge between the farm the server knows and the island the client draws.
 *
 * The server's land is a set of tiles with a `x, y` coordinate, and that is not going to change in a
 * client pass: plots, planting, harvest, ownership and idempotency all key off it. The client's
 * island is now a cell map. The adapter is the *only* place the two meet, and it is deliberately an
 * identity rather than a translation - a cell's coordinate *is* the farm tile's coordinate, on the
 * same pitch and the same origin - so the adapter can prove the correspondence instead of computing
 * it, and a future change to one of them fails a test rather than drifting silently.
 *
 * It also owns the one asymmetry the two systems have: the plot catalogue sells land inside
 * `FARM_FIELD_BOUNDS`, and a cell outside that reservation is island scenery, not a farm tile.
 */

/** Whether a coordinate is one the plot catalogue could sell. */
export function isFarmlandTile(tile: TileCoordinate): boolean {
  return (
    tile.x >= FARM_FIELD_BOUNDS.minX &&
    tile.x <= FARM_FIELD_BOUNDS.maxX &&
    tile.y >= FARM_FIELD_BOUNDS.minY &&
    tile.y <= FARM_FIELD_BOUNDS.maxY
  );
}

/**
 * The cell a farm tile stands for.
 *
 * The coordinate is used unchanged, which is the whole point of choosing the tile as the cell size:
 * there is no mapping to get wrong, and a plot bought at tile `7,3` is cell `7,3` on the same day it
 * becomes a row of carrots.
 */
export function farmTileToCell(tile: TileCoordinate): TileCoordinate {
  return { x: tile.x, y: tile.y };
}

/** The farm tile a cell stands for, or null when the cell is not land the catalogue can sell. */
export function cellToFarmTile(cell: WorldCell): TileCoordinate | null {
  if (!isFarmlandTile({ x: cell.x, y: cell.z })) return null;
  return { x: cell.x, y: cell.z };
}

/** The cell a farm tile resolves to in a built map, or null when that cell is not on the island. */
export function farmTileWorldCell(map: WorldCellMap, tile: TileCoordinate): WorldCell | null {
  return map.cells.get(cellKey(tile.x, tile.y)) ?? null;
}

/** The world position of a farm tile, through the cell conversion rather than beside it. */
export function farmTileWorldPosition(tile: TileCoordinate, map: WorldCellMap): { readonly worldX: number; readonly worldZ: number } {
  return cellToWorld(farmTileToCell(tile), map.frame);
}

/** The farm tile a world position falls on. The inverse of `farmTileWorldPosition`. */
export function farmTileAtPosition(
  position: { readonly worldX: number; readonly worldZ: number },
  map: WorldCellMap
): TileCoordinate {
  const cell = worldToCell(position, map.frame);
  return { x: cell.x, y: cell.y };
}
