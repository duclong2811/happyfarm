import {
  applyTileMutation,
  assertValidCoordinate,
  createFarmTile,
  DomainError,
  isUsableLand,
  landOriginFor,
  type FarmId,
  type TerrainType,
  type TileCoordinate
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  FarmMemberRepository,
  FarmTileRepository,
  TileTerrainLookup
} from "./ports";

export class FarmTileService {
  constructor(
    private readonly members: FarmMemberRepository,
    private readonly tiles: FarmTileRepository,
    private readonly terrain: TileTerrainLookup,
    private readonly clock: Clock
  ) {}

  async create(
    actor: ActorContext | null,
    farmId: FarmId,
    coordinate: TileCoordinate,
    terrainType: TerrainType
  ) {
    await this.assertCanMutate(actor, farmId);
    this.validateCoordinate(coordinate);
    if (!isUsableLand(landOriginFor(this.terrain.classify(coordinate)))) {
      throw new ApplicationError("INVALID_INPUT", "That cell is not usable land");
    }
    try {
      const tile = createFarmTile(farmId, coordinate, terrainType, this.clock.now());
      await this.tiles.insert(tile);
      return tile;
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new ApplicationError("INVALID_INPUT", error.message);
      }
      throw error;
    }
  }

  async touch(actor: ActorContext | null, farmId: FarmId, coordinate: TileCoordinate, expectedVersion: number) {
    await this.assertCanMutate(actor, farmId);
    this.validateCoordinate(coordinate);
    const tile = await this.tiles.find(farmId, coordinate.x, coordinate.y);
    if (tile === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
    }
    try {
      const updated = applyTileMutation(tile, expectedVersion, this.clock.now());
      if (!(await this.tiles.updateVersion(updated, expectedVersion))) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tile was changed concurrently");
      }
      return updated;
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "CONFLICT_STALE_STATE") {
        throw new ApplicationError("CONFLICT_STALE_STATE", error.message);
      }
      throw error;
    }
  }

  private async assertCanMutate(actor: ActorContext | null, farmId: FarmId): Promise<void> {
    if (actor === null) {
      throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Tile mutation is not allowed");
    }
  }

  private validateCoordinate(coordinate: TileCoordinate): void {
    try {
      assertValidCoordinate(coordinate);
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new ApplicationError("INVALID_INPUT", error.message);
      }
      throw error;
    }
  }
}
