import {
  canHarvest,
  parseCropInstanceId,
  parseItemDefinitionId,
  type CropInstanceId,
  type FarmId,
  type ItemDefinitionId,
  type PlayerId
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
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
  PayloadFingerprint
} from "./ports";

const HARVEST_OPERATION = "HARVEST_CROP";

export interface HarvestCropCommand {
  readonly cropInstanceId: string;
  readonly expectedCropVersion: number;
  readonly requestId: string;
}

export interface HarvestResult {
  readonly cropInstanceId: string;
  readonly itemDefinitionId: string;
  readonly quantityAdded: number;
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
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: HarvestCropCommand): Promise<HarvestResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let cropId: CropInstanceId;
    try {
      cropId = parseCropInstanceId(command.cropInstanceId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Crop instance ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(JSON.stringify([farmId, cropId, command.expectedCropVersion]));

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

    const result: HarvestResult = {
      cropInstanceId: crop.id,
      itemDefinitionId: addition.itemDefinitionId,
      quantityAdded: addition.quantity
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
      await this.settlement.settleHarvestAtomically(crop, addition, record);
      return result;
    } catch (error: unknown) {
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

  private async assertCapacity(playerId: PlayerId, itemId: ItemDefinitionId, delta: number, maximum: number): Promise<void> {
    const current = await this.inventory.find(playerId, itemId);
    if (current !== null && current.quantity > maximum - delta) {
      throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", "Inventory limit would be exceeded");
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): HarvestResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      if (
        value.cropInstanceId !== record.resourceId ||
        typeof value.cropInstanceId !== "string" ||
        typeof value.itemDefinitionId !== "string" ||
        !Number.isSafeInteger(value.quantityAdded) ||
        (value.quantityAdded as number) <= 0
      ) throw new Error("invalid stored result");
      parseCropInstanceId(value.cropInstanceId);
      parseItemDefinitionId(value.itemDefinitionId);
      return value as unknown as HarvestResult;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}
