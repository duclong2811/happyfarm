import type { CellBounds, CropInstance, TileCoordinate, TreeInstance } from "@happy-farm/domain";

/**
 * Which cells a Work Assignment may actually act on, as one rule.
 *
 * Two callers ask this question and must never disagree: the D1 resolver, whose counts decide what the
 * plan *says*, and the D2 executor, whose concrete cell is where the actor *walks and works*. The
 * resolver saying "there is work" while the executor finds nothing to walk to would be a silent
 * stall, so the rule lives here once and both read it.
 *
 * Pure: no repository, no clock, no mutation - just the rows the caller already read.
 */

/** Whether a cell is taken by something: a crop, a tree, or a building's footprint. */
export function cellOccupied(
  x: number,
  y: number,
  crops: readonly CropInstance[],
  trees: readonly TreeInstance[],
  bounds: readonly CellBounds[]
): boolean {
  if (crops.some((crop) => crop.tileX === x && crop.tileY === y)) return true;
  if (trees.some((tree) => tree.tileX === x && tree.tileY === y)) return true;
  return bounds.some((bound) => x >= bound.minX && x <= bound.maxX && y >= bound.minY && y <= bound.maxY);
}

/** The area's own cells in a stable order: row by row, west to east. */
export function orderedCells(cells: readonly TileCoordinate[]): readonly TileCoordinate[] {
  return [...cells].sort((left, right) => left.y - right.y || left.x - right.x);
}

/**
 * The area's empty, unoccupied cells - the ground an assignment could plant on.
 *
 * A cell in a work area is still free for anything the ordinary rules allow (V16.2.2A: membership is
 * orchestration metadata, not occupancy), so "empty" means exactly "nothing is standing there".
 */
export function emptyCells(
  cells: readonly TileCoordinate[],
  crops: readonly CropInstance[],
  trees: readonly TreeInstance[],
  bounds: readonly CellBounds[]
): readonly TileCoordinate[] {
  return orderedCells(cells).filter((cell) => !cellOccupied(cell.x, cell.y, crops, trees, bounds));
}

/** The area's own crops of one definition, in the same stable order. */
export function matchingCrops(
  cells: readonly TileCoordinate[],
  crops: readonly CropInstance[],
  definitionId: string
): readonly CropInstance[] {
  const inside = cellIndex(cells);
  return crops
    .filter((crop) => crop.cropDefinitionId === definitionId && inside.has(cellKey(crop.tileX, crop.tileY)))
    .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX);
}

/** The area's own trees of one definition, in the same stable order. */
export function matchingTrees(
  cells: readonly TileCoordinate[],
  trees: readonly TreeInstance[],
  definitionId: string
): readonly TreeInstance[] {
  const inside = cellIndex(cells);
  return trees
    .filter((tree) => tree.treeDefinitionId === definitionId && inside.has(cellKey(tree.tileX, tree.tileY)))
    .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX);
}

/** A cell's identity in the area index. */
export function cellKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

/** The area's member cells as a set, for the callers that ask about many points. */
export function cellIndex(cells: readonly TileCoordinate[]): ReadonlySet<string> {
  return new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
}
