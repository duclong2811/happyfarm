import { DomainError } from "./errors";
import type { CropDefinitionId, CropInstanceId, FarmId, ItemDefinitionId, PlayerId } from "./ids";
import type { FarmTile } from "./tile";

export interface CropDefinition {
  readonly id: CropDefinitionId;
  readonly displayNameKey: string;
  readonly growthDurationSeconds: number;
  readonly growthStages: number;
  readonly requiredFarmLevel?: number;
  readonly harvest: {
    readonly itemDefinitionId: ItemDefinitionId;
    readonly baseQuantity: number;
  };
}

export interface CropInstance {
  readonly id: CropInstanceId;
  readonly farmId: FarmId;
  readonly tileX: number;
  readonly tileY: number;
  readonly cropDefinitionId: CropDefinitionId;
  readonly plantedByPlayerId: PlayerId;
  readonly plantedAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CropGrowth {
  readonly elapsedSeconds: number;
  readonly progress: number;
  readonly stage: number;
  readonly mature: boolean;
}

export function assertTilePlantable(tile: FarmTile): void {
  if (tile.terrainType !== "SOIL") {
    throw new DomainError("INVALID_CROP", "Tile is not plantable");
  }
}

export function createCropInstance(
  id: CropInstanceId,
  farmId: FarmId,
  tileX: number,
  tileY: number,
  cropDefinitionId: CropDefinitionId,
  plantedByPlayerId: PlayerId,
  timestamp: string
): CropInstance {
  return {
    id,
    farmId,
    tileX,
    tileY,
    cropDefinitionId,
    plantedByPlayerId,
    plantedAt: timestamp,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function calculateCropGrowth(
  definition: CropDefinition,
  plantedAt: string,
  serverTime: string
): CropGrowth {
  const plantedMs = Date.parse(plantedAt);
  const serverMs = Date.parse(serverTime);
  const durationMs = definition.growthDurationSeconds * 1000;
  if (
    !Number.isFinite(plantedMs) ||
    !Number.isFinite(serverMs) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    !Number.isInteger(definition.growthStages) ||
    definition.growthStages < 2
  ) {
    throw new DomainError("INVALID_CROP", "Crop timing data is invalid");
  }

  const elapsedMs = Math.max(0, serverMs - plantedMs);
  const clampedElapsedMs = Math.min(elapsedMs, durationMs);
  const mature = elapsedMs >= durationMs;
  const stage = mature
    ? definition.growthStages - 1
    : Number(
        (BigInt(Math.trunc(clampedElapsedMs)) * BigInt(definition.growthStages - 1)) /
          BigInt(durationMs)
      );

  return {
    elapsedSeconds: elapsedMs / 1000,
    progress: clampedElapsedMs / durationMs,
    stage,
    mature
  };
}

export function canHarvest(crop: CropInstance, definition: CropDefinition, serverTime: string): boolean {
  return calculateCropGrowth(definition, crop.plantedAt, serverTime).mature;
}
