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
import type { InventoryService } from "./inventory";
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
  InventoryRepository,
  ItemDefinitionRepository,
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

/**
 * Planting, and everything it has to change at once.
 *
 * The dependencies are one record rather than a longer positional list because planting is the
 * widest settlement in the game: it reads the farm, the membership, the tile, the crop row, the
 * level, and the seed stack, and it writes the crop, the seed, and the receipt together.
 */
export interface PlantCropDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly crops: CropInstanceRepository;
  readonly inventory: InventoryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly definitions: CropDefinitionRepository;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly unlockedLand: UnlockedLandPolicy;
  readonly inventoryService: InventoryService;
  readonly ids: CropIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

export class PlantCrop {
  constructor(private readonly dependencies: PlantCropDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: PlantCropCommand): Promise<CropState> {
    const {
      farms,
      members,
      tiles,
      crops,
      inventory,
      idempotency,
      definitions,
      progression,
      progressionDefinition,
      unlockedLand,
      inventoryService,
      ids,
      fingerprints,
      clock
    } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");

    const fingerprint = await fingerprints.hash(
      JSON.stringify([
        farmId,
        command.x,
        command.y,
        command.cropDefinitionId,
        command.expectedTileVersion
      ])
    );
    if ((await farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Planting is not allowed");
    }

    const existingRequest = await idempotency.find(actor.playerId, PLANT_OPERATION, command.requestId);
    if (existingRequest !== null) {
      return this.replay(existingRequest, fingerprint);
    }

    try {
      assertValidCoordinate(command);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
    const tile = await tiles.find(farmId, command.x, command.y);
    if (tile === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
    if (!(await unlockedLand.isUnlocked(farmId, command))) {
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
    if ((await crops.findAtTile(farmId, command.x, command.y)) !== null) {
      throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
    }

    let definitionId: CropDefinition["id"];
    try {
      definitionId = parseCropDefinitionId(command.cropDefinitionId);
    } catch {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }
    const definition = definitions.findById(definitionId);
    if (definition === null) {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }
    // Game data is a module constant for the life of a deployment, so the requirement read here is
    // the one this Worker enforces and there is no version to guard. The level comes from the same
    // authoritative row the harvest writes, derived from experience rather than from the cached
    // column, and a player with no row is level 1 exactly as `GET /progression` reports.
    const level = storedLevel(progressionDefinition, await progression.find(actor.playerId));
    if (!isCropUnlocked(definition, level)) {
      throw new ApplicationError(
        "CROP_LEVEL_REQUIRED",
        `Crop ${definition.id} requires level ${String(requiredLevelFor(definition))}; player is level ${String(level)}`
      );
    }

    // Planting costs exactly one seed, and the crop definition -- never the client -- says which
    // item that is. The row the removal is prepared against is the state read here, so a concurrent
    // consumption either applies against it or rolls the whole planting back.
    const seed = await inventory.find(actor.playerId, definition.seedItemDefinitionId);
    if (seed === null || seed.quantity < 1) {
      throw new ApplicationError("INSUFFICIENT_ITEMS", "Planting requires a seed for this crop");
    }
    const seedRemoval = inventoryService.prepareRemoval(
      actor.playerId,
      definition.seedItemDefinitionId,
      1
    );

    const now = clock.now();
    const crop = createCropInstance(
      ids.newCropInstanceId(),
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
      await crops.plantAtomically(crop, command.expectedTileVersion, seedRemoval, seed, record);
      return new CropStateProjector(definitions, clock).project(crop, now);
    } catch (error: unknown) {
      const racedRequest = await idempotency.find(actor.playerId, PLANT_OPERATION, command.requestId);
      if (racedRequest !== null) return this.replay(racedRequest, fingerprint);
      if ((await crops.findAtTile(farmId, command.x, command.y)) !== null) {
        throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
      }
      const currentTile = await tiles.find(farmId, command.x, command.y);
      if (currentTile === null) {
        throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
      }
      if (currentTile.terrainType !== "SOIL") {
        throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
      }
      if (currentTile.version !== command.expectedTileVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
      }
      // The batch rolls back as one unit, so a lost race leaves the seed exactly where it was. Which
      // stable error the player sees is decided by re-reading the state they contended over.
      const currentSeed = await inventory.find(actor.playerId, definition.seedItemDefinitionId);
      if (currentSeed === null || currentSeed.quantity < 1) {
        throw new ApplicationError("INSUFFICIENT_ITEMS", "Planting requires a seed for this crop");
      }
      if (currentSeed.version !== seed.version) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Inventory changed concurrently");
      }
      throw error;
    }
  }

  private async replay(record: IdempotencyRecord, fingerprint: string): Promise<CropState> {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    const crop = await this.dependencies.crops.findById(parseCropInstanceId(record.resourceId));
    if (crop === null) throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    return new CropStateProjector(this.dependencies.definitions, this.dependencies.clock).project(crop);
  }
}

const UPROOT_OPERATION = "UPROOT_CROP";

export interface UprootCropCommand {
  readonly cropInstanceId: string;
  readonly expectedCropVersion: number;
  readonly requestId: string;
}

/** What uprooting removed. There is no reward field, because there is no reward. */
export interface UprootCropResult {
  readonly cropInstanceId: string;
}

/**
 * Removes a crop the player planted by mistake, freeing the tile.
 *
 * Uprooting is deliberately the opposite of harvesting: it refunds nothing -- no seed, no gold, no
 * produce, no experience -- which is why it can be settled by deleting one row and recording one
 * receipt. It is available for a growing crop and for a mature one, so a mis-planted tile never has
 * to be waited out.
 *
 * Authorization is rechecked before the stored result of a replay is returned, exactly as harvesting
 * rechecks it, so a member whose access was revoked cannot read back an old uproot.
 */
export class UprootCrop {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly crops: CropInstanceRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: UprootCropCommand
  ): Promise<UprootCropResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let cropId;
    try {
      cropId = parseCropInstanceId(command.cropInstanceId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Crop instance ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, cropId, command.expectedCropVersion])
    );

    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Uprooting is not allowed");
    }

    const existing = await this.idempotency.find(actor.playerId, UPROOT_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const crop = await this.crops.findById(cropId);
    // A crop in another farm is not this farm's crop: the route names a farm, and the row has to
    // agree with it before anything is deleted.
    if (crop === null || crop.farmId !== farmId) {
      throw new ApplicationError("CROP_NOT_FOUND", "Crop was not found");
    }
    if (crop.version !== command.expectedCropVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Crop version does not match");
    }

    const result: UprootCropResult = { cropInstanceId: crop.id };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: UPROOT_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: crop.id,
      responseJson: JSON.stringify(result),
      status: "COMPLETED",
      createdAt: this.clock.now()
    };

    try {
      await this.crops.removeAtomically(crop, command.expectedCropVersion, record);
      return result;
    } catch (error: unknown) {
      const raced = await this.idempotency.find(actor.playerId, UPROOT_OPERATION, command.requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      // The row is still there, so the deletion lost a race against another command: report the
      // conflict rather than deleting something the second time.
      const current = await this.crops.findById(cropId);
      if (current === null) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Crop changed concurrently");
      }
      if (current.version !== command.expectedCropVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Crop version does not match");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): UprootCropResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      if (value.cropInstanceId !== record.resourceId || typeof value.cropInstanceId !== "string") {
        throw new Error("invalid stored result");
      }
      parseCropInstanceId(value.cropInstanceId);
      return { cropInstanceId: value.cropInstanceId };
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
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
  readonly displayNameKey: string;
  readonly growthDurationSeconds: number;
  /** The seed one planting consumes, and the item whose count the planting control displays. */
  readonly seedItemDefinitionId: string;
  readonly seedItemDisplayNameKey: string;
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
  constructor(
    private readonly definitions: CropDefinitionRepository,
    private readonly items: ItemDefinitionRepository
  ) {}

  execute(actor: ActorContext | null): readonly CropDefinitionView[] {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return this.definitions.list().map((definition) => {
      // The catalogue is also the client's only source for the seed's name, so the seed has to be a
      // real definition here. Game data refuses a crop whose seed is missing, so a miss means the
      // deployment is internally inconsistent and the read fails rather than inventing a label.
      const seed = this.items.findById(definition.seedItemDefinitionId);
      if (seed === null) {
        throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Seed item definition was not found");
      }
      return {
        cropDefinitionId: definition.id,
        displayNameKey: definition.displayNameKey,
        growthDurationSeconds: definition.growthDurationSeconds,
        seedItemDefinitionId: definition.seedItemDefinitionId,
        seedItemDisplayNameKey: seed.displayNameKey,
        harvestItemDefinitionId: definition.harvest.itemDefinitionId,
        baseQuantity: definition.harvest.baseQuantity,
        harvestXp: definition.harvest.xp,
        requiredLevel: requiredLevelFor(definition)
      };
    });
  }
}
