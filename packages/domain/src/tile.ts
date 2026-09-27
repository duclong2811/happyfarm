import { DomainError } from "./errors";
import type { FarmId } from "./ids";

export const MIN_TILE_X = -1_000_000;
export const MAX_TILE_X = 1_000_000;
export const MIN_TILE_Y = -1_000_000;
export const MAX_TILE_Y = 1_000_000;

export const TERRAIN_TYPES = ["GRASS", "SOIL", "WATER", "BLOCKED"] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];
export const TILE_STATES = ["IDLE"] as const;
export type TileState = (typeof TILE_STATES)[number];

export interface TileCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface FarmTile extends TileCoordinate {
  readonly farmId: FarmId;
  readonly terrainType: TerrainType;
  readonly state: TileState;
  readonly version: number;
  readonly updatedAt: string;
}

export interface UnlockedLandPolicy {
  isUnlocked(farmId: FarmId, coordinate: TileCoordinate): Promise<boolean>;
}

export function assertValidCoordinate(coordinate: TileCoordinate): void {
  if (
    !Number.isInteger(coordinate.x) ||
    !Number.isInteger(coordinate.y) ||
    coordinate.x < MIN_TILE_X ||
    coordinate.x > MAX_TILE_X ||
    coordinate.y < MIN_TILE_Y ||
    coordinate.y > MAX_TILE_Y
  ) {
    throw new DomainError("INVALID_TILE", "Tile coordinate is invalid or out of bounds");
  }
}

export function parseTerrainType(value: string): TerrainType {
  if (!TERRAIN_TYPES.some((terrain) => terrain === value)) {
    throw new DomainError("INVALID_TILE", "Invalid terrain type");
  }
  return value as TerrainType;
}

export function createFarmTile(
  farmId: FarmId,
  coordinate: TileCoordinate,
  terrainType: TerrainType,
  timestamp: string
): FarmTile {
  assertValidCoordinate(coordinate);
  return { farmId, ...coordinate, terrainType, state: "IDLE", version: 1, updatedAt: timestamp };
}

export function applyTileMutation(tile: FarmTile, expectedVersion: number, timestamp: string): FarmTile {
  if (!Number.isInteger(expectedVersion) || tile.version !== expectedVersion) {
    throw new DomainError("CONFLICT_STALE_STATE", "Tile version does not match");
  }
  return { ...tile, version: tile.version + 1, updatedAt: timestamp };
}
