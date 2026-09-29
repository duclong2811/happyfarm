import { DomainError } from "./errors";
import type { CropDefinitionId, CropInstanceId, FarmId, ItemDefinitionId, PlayerId } from "./ids";
import type { FarmTile } from "./tile";

export interface CropDefinition {
  readonly id: CropDefinitionId;
  readonly displayNameKey: string;
  readonly growthDurationSeconds: number;
  readonly growthStages: number;
  /**
   * The player level at which this crop becomes plantable. Absent means no requirement, which is
   * the starting crop's case.
   *
   * This is authoritative game data, never a client input, and `isCropUnlocked` below is the only
   * rule that interprets it. It is deliberately named for the *player's* level: a farm has no level
   * of its own, and progression is the single source of one.
   */
  readonly requiredLevel?: number;
  readonly harvest: {
    readonly itemDefinitionId: ItemDefinitionId;
    readonly baseQuantity: number;
    /** Experience granted on harvesting this crop. Authoritative; the client never supplies it. */
    readonly xp: number;
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

/** The level a player must have reached before this crop can be planted. */
export function requiredLevelFor(definition: CropDefinition): number {
  return definition.requiredLevel ?? 1;
}

/**
 * Whether a player at `level` may plant this crop.
 *
 * A level that is not a safe integer — negative, fractional, `NaN`, infinite — compares as
 * insufficient, so a malformed reading locks every crop rather than unlocking every crop. The
 * refusal is the safe direction: a player who should have been allowed can retry, a player who
 * should not have been cannot un-plant.
 *
 * The same applies to the requirement: a requirement below the level every player starts at is not
 * a level either, and compared exactly as written it would unlock the crop for everybody. It locks
 * instead. Game data rejects such a value at load; this is the rule's last line of defence.
 */
export function isCropUnlocked(definition: CropDefinition, level: number): boolean {
  const required = requiredLevelFor(definition);
  return Number.isSafeInteger(level) && required >= 1 && level >= required;
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
