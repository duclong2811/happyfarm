import {
  assertTilePlantable,
  assertValidCoordinate,
  calculateCropGrowth,
  createCropInstance,
  DomainError,
  parseCropDefinitionId,
  parseCropInstanceId,
  type CropDefinition,
  type CropInstance,
  type FarmId,
  type TileCoordinate,
  type UnlockedLandPolicy
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  CropDefinitionRepository,
  CropIdGenerator,
  CropInstanceRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  PayloadFingerprint
} from "./ports";

const PLANT_OPERATION = "PLANT_CROP";

export interface PlantCropCommand extends TileCoordinate {
  readonly cropDefinitionId: string;
  readonly expectedTileVersion: number;
  readonly requestId: string;
}

export interface CropState {
  readonly cropInstanceId: string;
  readonly definitionId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly plantedAt: string;
  readonly growthStage: number;
  readonly growthProgress: number;
  readonly mature: boolean;
  readonly version: number;
}

export class CropStateProjector {
  constructor(
    private readonly definitions: CropDefinitionRepository,
    private readonly clock: Clock
  ) {}

  project(crop: CropInstance, serverTime = this.clock.now()): CropState {
    const definition = this.definitions.findById(crop.cropDefinitionId);
    if (definition === null) {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }
    if (definition.requiredFarmLevel !== undefined) {
      throw new ApplicationError("INVALID_INPUT", "Crop level requirements are not available in Phase 2A");
    }
    const growth = calculateCropGrowth(definition, crop.plantedAt, serverTime);
    return {
      cropInstanceId: crop.id,
      definitionId: crop.cropDefinitionId,
      tileX: crop.tileX,
      tileY: crop.tileY,
      plantedAt: crop.plantedAt,
      growthStage: growth.stage,
      growthProgress: growth.progress,
      mature: growth.mature,
      version: crop.version
    };
  }

  projectMany(crops: readonly CropInstance[]): readonly CropState[] {
    const serverTime = this.clock.now();
    return crops.map((crop) => this.project(crop, serverTime));
  }
}

export class PlantCrop {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly tiles: FarmTileRepository,
    private readonly crops: CropInstanceRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly definitions: CropDefinitionRepository,
    private readonly unlockedLand: UnlockedLandPolicy,
    private readonly ids: CropIdGenerator,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: PlantCropCommand): Promise<CropState> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");

    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([
        farmId,
        command.x,
        command.y,
        command.cropDefinitionId,
        command.expectedTileVersion
      ])
    );
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Planting is not allowed");
    }

    const existingRequest = await this.idempotency.find(actor.playerId, PLANT_OPERATION, command.requestId);
    if (existingRequest !== null) {
      return this.replay(existingRequest, fingerprint);
    }

    try {
      assertValidCoordinate(command);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
    const tile = await this.tiles.find(farmId, command.x, command.y);
    if (tile === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
    if (!(await this.unlockedLand.isUnlocked(farmId, command))) {
      throw new ApplicationError("INVALID_INPUT", "Tile is outside unlocked land");
    }
    try {
      assertTilePlantable(tile);
    } catch {
      throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
    }
    if (tile.version !== command.expectedTileVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
    }
    if ((await this.crops.findAtTile(farmId, command.x, command.y)) !== null) {
      throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
    }

    let definitionId: CropDefinition["id"];
    try {
      definitionId = parseCropDefinitionId(command.cropDefinitionId);
    } catch {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }
    const definition = this.definitions.findById(definitionId);
    if (definition === null) {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }

    const now = this.clock.now();
    const crop = createCropInstance(
      this.ids.newCropInstanceId(),
      farmId,
      command.x,
      command.y,
      definition.id,
      actor.playerId,
      now
    );
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: PLANT_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: crop.id,
      responseJson: JSON.stringify({ cropInstanceId: crop.id }),
      status: "COMPLETED",
      createdAt: now
    };

    try {
      await this.crops.plantAtomically(crop, command.expectedTileVersion, record);
      return new CropStateProjector(this.definitions, this.clock).project(crop, now);
    } catch (error: unknown) {
      const racedRequest = await this.idempotency.find(actor.playerId, PLANT_OPERATION, command.requestId);
      if (racedRequest !== null) return this.replay(racedRequest, fingerprint);
      if ((await this.crops.findAtTile(farmId, command.x, command.y)) !== null) {
        throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
      }
      const currentTile = await this.tiles.find(farmId, command.x, command.y);
      if (currentTile === null) {
        throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
      }
      if (currentTile.terrainType !== "SOIL") {
        throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
      }
      if (currentTile.version !== command.expectedTileVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
      }
      throw error;
    }
  }

  private async replay(record: IdempotencyRecord, fingerprint: string): Promise<CropState> {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    const crop = await this.crops.findById(parseCropInstanceId(record.resourceId));
    if (crop === null) throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    return new CropStateProjector(this.definitions, this.clock).project(crop);
  }
}

export class GetFarmCrops {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly crops: CropInstanceRepository,
    private readonly projector: CropStateProjector
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly CropState[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    if ((await this.members.findByFarmAndPlayer(farmId, actor.playerId)) === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    }
    return this.projector.projectMany(await this.crops.listByFarm(farmId));
  }
}
