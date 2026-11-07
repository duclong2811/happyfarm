import type { CropStateDTO, FarmTileDTO, TreeStateDTO } from "@happy-farm/contracts";
import type { PlantOption } from "./items/catalogue";
import { cellKey, type WorldCellMap } from "./render/world-cell";
import { areaHarvestBounds, type AreaHarvestBounds, type AreaHarvestCorner } from "./area-harvest";

export type AreaPlantSkipReason = "OCCUPIED" | "NOT_PLANTABLE" | "STALE" | "NO_SEEDS" | "LEVEL";

export interface AreaPlantCell {
  readonly x: number;
  readonly y: number;
  readonly expectedTileVersion?: number;
}

export interface AreaPlantPreview {
  readonly bounds: AreaHarvestBounds | null;
  readonly cellsInArea: number;
  readonly plantableCount: number;
  /** Cells the current inventory can actually fund; this is the only list sent to the server. */
  readonly plannedCount: number;
  readonly skippedCount: number;
  readonly shortageCount: number;
  readonly validCells: readonly AreaPlantCell[];
  readonly plannedCells: readonly AreaPlantCell[];
  /** Valid cells after the owned seed/sapling budget is exhausted, kept out of POST groups. */
  readonly shortageCells: readonly AreaPlantCell[];
  readonly skipped: readonly { readonly x: number; readonly y: number; readonly reason: AreaPlantSkipReason }[];
}

/** Client preview only. The server rechecks every one of these facts before settlement. */
export function previewAreaPlanting(
  map: WorldCellMap,
  tiles: readonly FarmTileDTO[],
  crops: readonly CropStateDTO[],
  trees: readonly TreeStateDTO[],
  option: PlantOption | null,
  corners: readonly [AreaHarvestCorner, AreaHarvestCorner] | null
): AreaPlantPreview {
  if (corners === null) {
    return {
      bounds: null,
      cellsInArea: 0,
      plantableCount: 0,
      plannedCount: 0,
      skippedCount: 0,
      shortageCount: 0,
      validCells: [],
      plannedCells: [],
      shortageCells: [],
      skipped: []
    };
  }
  const bounds = areaHarvestBounds(corners[0], corners[1]);
  const validCells: AreaPlantCell[] = [];
  const skipped: { x: number; y: number; reason: AreaPlantSkipReason }[] = [];
  let cellsInArea = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      cellsInArea += 1;
      const world = map.cells.get(cellKey(x, y));
      const tile = tiles.find((candidate) => candidate.x === x && candidate.y === y);
      const crop = crops.some((candidate) => candidate.tileX === x && candidate.tileY === y);
      const tree = trees.some((candidate) => candidate.storageState !== "STORED" && candidate.tileX === x && candidate.tileY === y);
      if (world === undefined || world.reserved || world.terrain !== "LAND" || !world.capabilities.includes("FARM") || (tile !== undefined && tile.terrainType !== "SOIL")) {
        skipped.push({ x, y, reason: "NOT_PLANTABLE" });
        continue;
      }
      if (world.occupancy !== "EMPTY" || crop || tree) {
        skipped.push({ x, y, reason: "OCCUPIED" });
        continue;
      }
      if (option === null || !option.selectable) {
        skipped.push({ x, y, reason: option?.group === "LOCKED" ? "LEVEL" : "NO_SEEDS" });
        continue;
      }
      validCells.push(tile === undefined ? { x, y } : { x, y, expectedTileVersion: tile.version });
    }
  }
  const shortageCount = Math.max(0, validCells.length - (option?.stored ?? 0));
  // The rectangle walk above is deliberately y/x ordered. Keep that order as the stable choice
  // for preview, POST groups and retry so a partial response never changes which cells were next.
  const plannedCount = Math.min(validCells.length, Math.max(0, option?.stored ?? 0));
  const plannedCells = validCells.slice(0, plannedCount);
  const shortageCells = validCells.slice(plannedCount);
  return {
    bounds,
    cellsInArea,
    plantableCount: validCells.length,
    plannedCount,
    skippedCount: skipped.length + shortageCount,
    shortageCount,
    validCells,
    plannedCells,
    shortageCells,
    skipped
  };
}

