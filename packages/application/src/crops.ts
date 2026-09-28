import {
  assertTilePlantable,
  assertValidCoordinate,
  calculateCropGrowth,
  createCropInstance,
  DomainError,
  isCropUnlocked,
  parseCropDefinitionId,
  parseCropInstanceId,
  requiredLevelFor,
  type CropDefinition,
  type CropInstance,
  type FarmId,
  type ProgressionDefinition,
  type TileCoordinate,
  type UnlockedLandPolicy
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import { storedLevel } from "./progression";
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
  PayloadFingerprint,
  ProgressionRepository
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
    // The level requirement gates planting, not reading. A crop already in the ground keeps
    // reporting its growth even if a later curve would have locked it.
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
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
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
    // Game data is a module constant for the life of a deployment, so the requirement read here is
    // the one this Worker enforces and there is no version to guard. The level comes from the same
    // authoritative row the harvest writes, derived from experience rather than from the cached
    // column, and a player with no row is level 1 exactly as `GET /progression` reports.
    const level = storedLevel(this.progressionDefinition, await this.progression.find(actor.playerId));
    if (!isCropUnlocked(definition, level)) {
      throw new ApplicationError(
        "CROP_LEVEL_REQUIRED",
        `Crop ${definition.id} requires level ${String(requiredLevelFor(definition))}; player is level ${String(level)}`
      );
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

/** One crop, in the shape the client needs to offer it as a planting choice. */
export interface CropDefinitionView {
  readonly cropDefinitionId: string;
  readonly growthDurationSeconds: number;
  readonly harvestItemDefinitionId: string;
  readonly baseQuantity: number;
  readonly harvestXp: number;
  /** Resolved, never absent: "no requirement" reads as level 1, the level every player starts at. */
  readonly requiredLevel: number;
}

/**
 * The crop catalogue.
 *
 * A pure projection of game data: no repository read, no player state, no mutation. It exists so the
 * client renders its planting choices from what this deployment can actually plant, instead of from
 * a list compiled into the client, and so a crop the player has not unlocked is still listed — with
 * the level it needs — rather than silently missing.
 */
export class ListCropDefinitions {
  constructor(private readonly definitions: CropDefinitionRepository) {}

  execute(actor: ActorContext | null): readonly CropDefinitionView[] {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return this.definitions.list().map((definition) => ({
      cropDefinitionId: definition.id,
      growthDurationSeconds: definition.growthDurationSeconds,
      harvestItemDefinitionId: definition.harvest.itemDefinitionId,
      baseQuantity: definition.harvest.baseQuantity,
      harvestXp: definition.harvest.xp,
      requiredLevel: requiredLevelFor(definition)
    }));
  }
}
