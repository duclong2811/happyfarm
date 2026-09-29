import {
  canHarvest,
  createXpAward,
  parseCropInstanceId,
  parseItemDefinitionId,
  type CropInstanceId,
  type FarmId,
  type ItemDefinitionId,
  type PlayerId,
  type ProgressionDefinition,
  type XpAward
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import {
  assertStoredXpAward,
  emptyProgression,
  progressionView,
  type XpAwardView
} from "./progression";
import type {
  ActorContext,
  Clock,
  CropDefinitionRepository,
  CropInstanceRepository,
  FarmMemberRepository,
  FarmRepository,
  HarvestSettlementRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  ProgressionRepository
} from "./ports";

const HARVEST_OPERATION = "HARVEST_CROP";

/**
 * How many times a harvest re-reads progression after losing a race before giving up.
 *
 * A lost race rolls the whole settlement back, including the harvest, so retrying re-runs the same
 * command against fresh state rather than paying out twice.
 */
const PROGRESSION_ATTEMPTS = 8;

export interface HarvestCropCommand {
  readonly cropInstanceId: string;
  readonly expectedCropVersion: number;
  readonly requestId: string;
}

/** What the harvest produced, without the experience it earned. */
export interface HarvestResult {
  readonly cropInstanceId: string;
  readonly itemDefinitionId: string;
  readonly quantityAdded: number;
}

/**
 * The whole stored command result.
 *
 * This is also the idempotent replay payload and the API response body, so a replay returns exactly
 * what the original call returned, experience included, instead of recomputing it. A recomputed
 * award would report a different level the moment another harvest landed in between.
 */
export interface HarvestCropResult {
  readonly harvest: HarvestResult;
  readonly progression: XpAwardView;
}

export class HarvestCrop {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly crops: CropInstanceRepository,
    private readonly inventory: InventoryRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly settlement: HarvestSettlementRepository,
    private readonly cropDefinitions: CropDefinitionRepository,
    private readonly inventoryService: InventoryService,
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestCropCommand
  ): Promise<HarvestCropResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let cropId: CropInstanceId;
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
      throw new ApplicationError("NOT_AUTHORIZED", "Harvesting is not allowed");
    }

    const existing = await this.idempotency.find(actor.playerId, HARVEST_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const crop = await this.crops.findById(cropId);
    if (crop === null || crop.farmId !== farmId) {
      throw new ApplicationError("CROP_NOT_FOUND", "Crop was not found");
    }
    if (crop.version !== command.expectedCropVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Crop version does not match");
    }
    const definition = this.cropDefinitions.findById(crop.cropDefinitionId);
    if (definition === null) {
      throw new ApplicationError("CROP_DEFINITION_NOT_FOUND", "Crop definition was not found");
    }
    if (!canHarvest(crop, definition, this.clock.now())) {
      throw new ApplicationError("CROP_NOT_MATURE", "Crop is not mature");
    }
    const addition = this.inventoryService.prepareAddition(
      actor.playerId,
      definition.harvest.itemDefinitionId,
      definition.harvest.baseQuantity
    );
    await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);

    const harvest: HarvestResult = {
      cropInstanceId: crop.id,
      itemDefinitionId: addition.itemDefinitionId,
      quantityAdded: addition.quantity
    };

    // The award is computed from a read, written only if that read still holds, and the whole
    // settlement is retried when it does not. Every attempt re-reads progression, so a lost race
    // costs a round trip rather than experience.
    for (let attempt = 0; attempt < PROGRESSION_ATTEMPTS; attempt += 1) {
      const stored = await this.progression.find(actor.playerId);
      const current = stored ?? emptyProgression(actor.playerId, this.clock.now());
      let award: XpAward;
      try {
        award = createXpAward(this.progressionDefinition, current, definition.harvest.xp, this.clock.now());
      } catch {
        // A stored row this curve could not have produced is corrupt, not stale: refuse rather than
        // write the disagreement forward.
        throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      }
      const result: HarvestCropResult = {
        harvest,
        progression: {
          xpAwarded: award.xpAwarded,
          leveledUp: award.leveledUp,
          progression: progressionView(this.progressionDefinition, award.xpAfter)
        }
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: HARVEST_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: crop.id,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: this.clock.now()
      };

      try {
        await this.settlement.settleHarvestAtomically(crop, addition, award, record);
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "PROGRESSION_CONFLICT") continue;
        const raced = await this.idempotency.find(actor.playerId, HARVEST_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        const currentCrop = await this.crops.findById(cropId);
        if (currentCrop === null) {
          throw new ApplicationError("CROP_ALREADY_HARVESTED", "Crop was already harvested");
        }
        await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);
        throw error;
      }
    }
    throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
  }

  private async assertCapacity(
    playerId: PlayerId,
    itemId: ItemDefinitionId,
    delta: number,
    maximum: number
  ): Promise<void> {
    const current = await this.inventory.find(playerId, itemId);
    if (current !== null && current.quantity > maximum - delta) {
      throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", "Inventory limit would be exceeded");
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): HarvestCropResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      const harvest = value.harvest;
      if (typeof harvest !== "object" || harvest === null) throw new Error("invalid stored result");
      const fields = harvest as Record<string, unknown>;
      if (
        fields.cropInstanceId !== record.resourceId ||
        typeof fields.cropInstanceId !== "string" ||
        typeof fields.itemDefinitionId !== "string" ||
        !Number.isSafeInteger(fields.quantityAdded) ||
        (fields.quantityAdded as number) <= 0
      ) {
        throw new Error("invalid stored result");
      }
      parseCropInstanceId(fields.cropInstanceId);
      parseItemDefinitionId(fields.itemDefinitionId);
      assertStoredXpAward(value.progression);
      return value as unknown as HarvestCropResult;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}
