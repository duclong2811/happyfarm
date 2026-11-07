import { cellKey, cellToWorld, worldToCell, type WorldCell, type WorldCellMap } from "./world-cell";
import type { TileCoordinate } from "./layout";

/**
 * Selecting a cell, and nothing else.
 *
 * Selection is a *presentation* state: it names a cell, it draws a quiet square over it, and it tells
 * the dock what the cell is. It plants nothing, walks nowhere, and is never sent to the server. That
 * separation is the reason a mis-click is harmless, and it is why this module is pure: the rules for
 * "which cell did the player point at" and "may a character be sent there" can be tested without a
 * canvas, a camera, or a WebGL context.
 */

export interface CellSelection {
  readonly cell: TileCoordinate;
}

/**
 * The cell under a world position, or null when the point is off the island.
 *
 * Off the map is a rejection rather than a cell with a hopeful classification: past the shoreline
 * margin there is no cell, so clicking the open sea selects nothing.
 */
export function selectableCellAt(
  map: WorldCellMap,
  position: { readonly worldX: number; readonly worldZ: number }
): WorldCell | null {
  const coordinate = worldToCell(position, map.frame);
  return map.cells.get(cellKey(coordinate.x, coordinate.y)) ?? null;
}

/** The cell a selection names, if it is still on the map. */
export function selectedCell(map: WorldCellMap, selection: CellSelection | null): WorldCell | null {
  if (selection === null) return null;
  return map.cells.get(cellKey(selection.cell.x, selection.cell.y)) ?? null;
}

/**
 * The selected cell and its immediate neighbours - the largest local preview the island allows.
 *
 * Nine cells at most, and only while something is selected. The whole point of the cell system being
 * invisible is that this is a *local* answer: a player wants to know what is around the thing they
 * pointed at, not to be shown the island's whole lattice.
 */
export function localNeighbourhood(selection: CellSelection, map: WorldCellMap): readonly WorldCell[] {
  const cells: WorldCell[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cell = map.cells.get(cellKey(selection.cell.x + dx, selection.cell.y + dz));
      if (cell !== undefined) cells.push(cell);
    }
  }
  return cells;
}

/** Where a character stands when it arrives at a cell: the cell's own centre. */
export function cellCentre(cell: WorldCell, map: WorldCellMap): { readonly worldX: number; readonly worldZ: number } {
  return cellToWorld({ x: cell.x, y: cell.z }, map.frame);
}

/** Why a cell cannot be walked to, or null when it can. */
export type DestinationRejection = "OFF_THE_MAP" | "NOT_WALKABLE" | "BLOCKED" | "NOT_WALKABLE_CELL";

/**
 * The movement destination a cell offers, or the reason it offers none.
 *
 * `isBlocked` is the caller's own collision test at a world point - the same world the controller
 * walks in, so a destination this accepts is one the character can actually stand on and a
 * destination it refuses is one they would have walked into a wall to reach. Water, buildings,
 * building footprints and a crop standing on the target itself are all refused here, by asking the
 * collision world rather than by guessing.
 */
export function movementDestination(
  cell: WorldCell,
  map: WorldCellMap,
  isBlocked: (worldX: number, worldZ: number) => boolean
): { readonly worldX: number; readonly worldZ: number } | null {
  return destinationRejection(cell, map, isBlocked) === null ? cellCentre(cell, map) : null;
}

/**
 * A walk destination for a selected world target.
 *
 * A crop is passable, so its own centre is the natural destination. A perennial tree is different:
 * its cell is walkable ground, but its trunk is a collision circle. When the target centre is blocked,
 * offer the nearest walkable neighbour instead. The caller supplies the character position so the
 * straight-line runtime approaches from the player's side of the tree rather than trying to cross its
 * trunk. This is movement presentation only; interaction range and harvest legality remain separate.
 */
export function movementDestinationForTarget(
  target: WorldCell,
  map: WorldCellMap,
  from: { readonly worldX: number; readonly worldZ: number },
  isBlocked: (worldX: number, worldZ: number) => boolean
): { readonly worldX: number; readonly worldZ: number } | null {
  const direct = movementDestination(target, map, isBlocked);
  if (direct !== null) return direct;

  const candidates: { readonly worldX: number; readonly worldZ: number }[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const neighbour = map.cells.get(cellKey(target.x + dx, target.z + dz));
      if (neighbour === undefined) continue;
      const destination = movementDestination(neighbour, map, isBlocked);
      if (destination !== null) candidates.push(destination);
    }
  }
  candidates.sort((a, b) => {
    const distanceA = Math.hypot(a.worldX - from.worldX, a.worldZ - from.worldZ);
    const distanceB = Math.hypot(b.worldX - from.worldX, b.worldZ - from.worldZ);
    return distanceA - distanceB;
  });
  return candidates[0] ?? null;
}

export function destinationRejection(
  cell: WorldCell,
  map: WorldCellMap,
  isBlocked: (worldX: number, worldZ: number) => boolean
): DestinationRejection | null {
  if (map.cells.get(cellKey(cell.x, cell.z)) === undefined) return "OFF_THE_MAP";
  if (cell.terrain === "WATER") return "NOT_WALKABLE";
  if (!cell.walkable) return "NOT_WALKABLE_CELL";
  const centre = cellCentre(cell, map);
  if (isBlocked(centre.worldX, centre.worldZ)) return "BLOCKED";
  return null;
}
