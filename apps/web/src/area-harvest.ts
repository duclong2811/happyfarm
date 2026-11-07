import type { CropDefinitionDTO, CropStateDTO, TreeDefinitionDTO, TreeStateDTO } from "@happy-farm/contracts";
import type { WorldCellMap } from "./render/world-cell";

export interface AreaHarvestCorner {
  readonly x: number;
  readonly y: number;
}

export type AreaHarvestPanelStage = "CHOOSE_FIRST" | "CHOOSE_SECOND" | "PREVIEW";

/** The three visible states of the shared area tool. The panel must not render a preview before both corners exist. */
export function areaHarvestPanelStage(
  first: AreaHarvestCorner | null,
  second: AreaHarvestCorner | null
): AreaHarvestPanelStage {
  if (first === null) return "CHOOSE_FIRST";
  return second === null ? "CHOOSE_SECOND" : "PREVIEW";
}

export interface AreaHarvestBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface AreaHarvestCandidate {
  readonly treeInstanceId: string;
  readonly expectedTreeVersion: number;
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly x: number;
  readonly y: number;
}

export interface AreaHarvestCropCandidate {
  readonly cropInstanceId: string;
  readonly expectedCropVersion: number;
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly x: number;
  readonly y: number;
}

export type AreaHarvestCellBucket = "PLANNED" | "WAITING" | "INVALID";
export type AreaHarvestCellReason = "NOT_READY" | "NOT_REPEATABLE" | "NOT_FOUND" | "OCCUPIED" | "NOT_PLANTABLE" | "NO_TARGET";

export interface AreaHarvestCellClassification {
  readonly x: number;
  readonly y: number;
  readonly bucket: AreaHarvestCellBucket;
  readonly reason: AreaHarvestCellReason;
}

export interface AreaHarvestPreview {
  readonly bounds: AreaHarvestBounds | null;
  readonly treesInArea: number;
  readonly cropsInArea: number;
  readonly fruitReadyCount: number;
  readonly cropReadyCount: number;
  readonly readyCount: number;
  readonly skippedCount: number;
  readonly plannedCells: readonly AreaHarvestCellClassification[];
  readonly waitingCells: readonly AreaHarvestCellClassification[];
  readonly invalidCells: readonly AreaHarvestCellClassification[];
  readonly candidates: readonly AreaHarvestCandidate[];
  readonly cropCandidates: readonly AreaHarvestCropCandidate[];
  readonly products: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

/** The server's bounded management unit for an area harvest. */
export const AREA_HARVEST_GROUP_SIZE = 25;

export function areaHarvestGroups<T>(items: readonly T[]): readonly (readonly T[])[] {
  const groups: (readonly T[])[] = [];
  for (let offset = 0; offset < items.length; offset += AREA_HARVEST_GROUP_SIZE) {
    groups.push(items.slice(offset, offset + AREA_HARVEST_GROUP_SIZE));
  }
  return groups;
}

export function areaHarvestBounds(a: AreaHarvestCorner, b: AreaHarvestCorner): AreaHarvestBounds {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y)
  };
}

/** Only orchard fruit trees belong to this first batch; every forestry/resource lifecycle stays out. */
export function isRepeatingFruitTree(definitionId: string): boolean {
  return definitionId === "tree_apple" || definitionId === "tree_orange" || definitionId === "tree_peach";
}

export function previewAreaHarvest(
  trees: readonly TreeStateDTO[],
  definitions: readonly TreeDefinitionDTO[],
  corners: readonly [AreaHarvestCorner, AreaHarvestCorner] | null,
  crops: readonly CropStateDTO[] = [],
  cropDefinitions: readonly CropDefinitionDTO[] = [],
  cellMap: WorldCellMap | null = null
): AreaHarvestPreview {
  if (corners === null) {
    return { bounds: null, treesInArea: 0, cropsInArea: 0, fruitReadyCount: 0, cropReadyCount: 0, readyCount: 0, skippedCount: 0, plannedCells: [], waitingCells: [], invalidCells: [], candidates: [], cropCandidates: [], products: [] };
  }
  const bounds = areaHarvestBounds(corners[0], corners[1]);
  const products = new Map<string, number>();
  const candidates: AreaHarvestCandidate[] = [];
  const cropCandidates: AreaHarvestCropCandidate[] = [];
  let treesInArea = 0;
  let cropsInArea = 0;
  let fruitReadyCount = 0;
  let cropReadyCount = 0;
  for (const tree of trees) {
    if (tree.storageState === "STORED") continue;
    if (tree.tileX < bounds.minX || tree.tileX > bounds.maxX || tree.tileY < bounds.minY || tree.tileY > bounds.maxY) continue;
    treesInArea += 1;
    const definition = definitions.find((entry) => entry.treeDefinitionId === tree.definitionId);
    if (definition === undefined || !isRepeatingFruitTree(tree.definitionId) || !tree.ready) {
      continue;
    }
    candidates.push({
      treeInstanceId: tree.treeInstanceId,
      expectedTreeVersion: tree.version,
      itemDefinitionId: definition.harvestItemDefinitionId,
      quantity: definition.baseQuantity,
      x: tree.tileX,
      y: tree.tileY
    });
    fruitReadyCount += 1;
    products.set(definition.harvestItemDefinitionId, (products.get(definition.harvestItemDefinitionId) ?? 0) + definition.baseQuantity);
  }
  for (const crop of crops) {
    if (crop.tileX < bounds.minX || crop.tileX > bounds.maxX || crop.tileY < bounds.minY || crop.tileY > bounds.maxY) continue;
    cropsInArea += 1;
    const definition = cropDefinitions.find((entry) => entry.cropDefinitionId === crop.definitionId);
    if (definition === undefined || !crop.mature) {
      continue;
    }
    cropCandidates.push({
      cropInstanceId: crop.cropInstanceId,
      expectedCropVersion: crop.version,
      itemDefinitionId: definition.harvestItemDefinitionId,
      quantity: definition.baseQuantity,
      x: crop.tileX,
      y: crop.tileY
    });
    cropReadyCount += 1;
    products.set(definition.harvestItemDefinitionId, (products.get(definition.harvestItemDefinitionId) ?? 0) + definition.baseQuantity);
  }
  const plannedKeys = new Set<string>();
  const plannedCells: AreaHarvestCellClassification[] = [];
  for (const candidate of candidates) {
    const key = `${String(candidate.x)},${String(candidate.y)}`;
    if (plannedKeys.has(key)) continue;
    plannedKeys.add(key);
    plannedCells.push({ x: candidate.x, y: candidate.y, bucket: "PLANNED", reason: "NOT_READY" });
  }
  for (const candidate of cropCandidates) {
    const key = `${String(candidate.x)},${String(candidate.y)}`;
    if (plannedKeys.has(key)) continue;
    plannedKeys.add(key);
    plannedCells.push({ x: candidate.x, y: candidate.y, bucket: "PLANNED", reason: "NOT_READY" });
  }

  const treeByCell = new Map<string, TreeStateDTO>();
  for (const tree of trees) {
    if (tree.storageState === "STORED") continue;
    if (tree.tileX < bounds.minX || tree.tileX > bounds.maxX || tree.tileY < bounds.minY || tree.tileY > bounds.maxY) continue;
    treeByCell.set(`${String(tree.tileX)},${String(tree.tileY)}`, tree);
  }
  const cropByCell = new Map<string, CropStateDTO>();
  for (const crop of crops) {
    if (crop.tileX < bounds.minX || crop.tileX > bounds.maxX || crop.tileY < bounds.minY || crop.tileY > bounds.maxY) continue;
    cropByCell.set(`${String(crop.tileX)},${String(crop.tileY)}`, crop);
  }
  const waitingCells: AreaHarvestCellClassification[] = [];
  const invalidCells: AreaHarvestCellClassification[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const key = `${String(x)},${String(y)}`;
      if (plannedKeys.has(key)) continue;
      const tree = treeByCell.get(key);
      if (tree !== undefined) {
        const definition = definitions.find((entry) => entry.treeDefinitionId === tree.definitionId);
        const classification: AreaHarvestCellClassification = definition === undefined
          ? { x, y, bucket: "INVALID", reason: "NOT_FOUND" }
          : !isRepeatingFruitTree(tree.definitionId)
            ? { x, y, bucket: "INVALID", reason: "NOT_REPEATABLE" }
            : { x, y, bucket: "WAITING", reason: "NOT_READY" };
        (classification.bucket === "WAITING" ? waitingCells : invalidCells).push(classification);
        continue;
      }
      const crop = cropByCell.get(key);
      if (crop !== undefined) {
        const definition = cropDefinitions.find((entry) => entry.cropDefinitionId === crop.definitionId);
        const classification: AreaHarvestCellClassification = definition === undefined
          ? { x, y, bucket: "INVALID", reason: "NOT_FOUND" }
          : { x, y, bucket: "WAITING", reason: "NOT_READY" };
        (classification.bucket === "WAITING" ? waitingCells : invalidCells).push(classification);
        continue;
      }
      const world = cellMap?.cells.get(key);
      const classification: AreaHarvestCellClassification = world === undefined || world.terrain !== "LAND"
        ? { x, y, bucket: "INVALID", reason: "NOT_PLANTABLE" }
        : world.occupancy === "BUILDING" || world.occupancy === "SCENERY" || world.occupancy === "RESOURCE"
          ? { x, y, bucket: "INVALID", reason: "OCCUPIED" }
          : { x, y, bucket: "INVALID", reason: "NO_TARGET" };
      invalidCells.push(classification);
    }
  }

  return {
    bounds,
    treesInArea,
    cropsInArea,
    fruitReadyCount,
    cropReadyCount,
    readyCount: candidates.length + cropCandidates.length,
    skippedCount: waitingCells.length + invalidCells.length,
    plannedCells,
    waitingCells,
    invalidCells,
    candidates,
    cropCandidates,
    products: [...products.entries()].map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
  };
}

