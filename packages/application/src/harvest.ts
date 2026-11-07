import {
  canHarvest,
  createXpAward,
  parseCropInstanceId,
  parseItemDefinitionId,
  type CropDefinition,
  type CropInstance,
  type CropInstanceId,
  type FarmId,
  type InventoryAddition,
  type ItemDefinitionId,
  type PlayerId,
  type ProgressionDefinition,
  type XpAward
} from "@happy-farm/domain";
import type { CargoService } from "./cargo";
import { ApplicationError } from "./errors";
import { requireMainCharacterPlayerControl } from "./jobs";
import type { InventoryService } from "./inventory";
import { autoTransitionId } from "./auto-plant";
import {
  assertStoredXpAward,
  emptyProgression,
  progressionView,
  type XpAwardView
} from "./progression";
import type {
  ActorContext,
  ActorRepository,
  CargoGrant,
  CargoRepository,
  Clock,
  CropHarvestBatchReceiptRepository,
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
 * The operation an Auto harvest's semantic receipt carries.
 *
 * Distinct from `HARVEST_CROP` so an Auto transition is addressable by its own semantic identity, and
 * so a retried Auto step can find the receipt it wrote rather than the manual path's.
 */
const AUTO_HARVEST_OPERATION = "AUTO_HARVEST";
const HARVEST_CROP_AREA_OPERATION = "HARVEST_CROP_AREA_GROUP";
export const MAX_HARVEST_CROP_AREA_GROUP = 25;

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

/**
 * What a harvest needs to be able to land its reward in the actor's cargo instead of the Warehouse.
 *
 * Optional, and one bundle rather than three more positional parameters, because the manual path has
 * no use for any of it: a host that never runs Auto harvests exactly as it always did, and a host that
 * does hands this in once.
 */
export interface HarvestCargoDestination {
  readonly cargo: CargoRepository;
  readonly cargoService: CargoService;
  readonly actors: ActorRepository;
}

/** Where one harvest's reward lands, as the two shapes the settlements take. */
type HarvestReward =
  | { readonly kind: "WAREHOUSE"; readonly addition: InventoryAddition }
  | {
      readonly kind: "CARGO";
      readonly grant: CargoGrant;
      /**
       * The carried stack the settlement's trigger will grow, as it was read.
       *
       * Null when the actor carried none of this item, in which case the trigger inserts a fresh row.
       * The Auto settlement uses it to state the exact post-state its receipt must observe, which is
       * what makes "the goods actually arrived in cargo" a provable part of the batch.
       */
      readonly expected: { readonly quantity: number; readonly version: number } | null;
      /** The cargo container's own version the caller read; the Auto settlement's container guard. */
      readonly containerVersion: number;
    };

/** The Auto timeline facts one Auto harvest must advance with its economic mutation. */
export interface AutoHarvestSettlementContext {
  readonly actorId: string;
  readonly assignmentId: string;
  readonly eventTime: string;
  readonly expectedAutoVersion: number;
  readonly expectedSimulationAt: string | null;
}

/**
 * The one write boundary for an Auto harvest.
 *
 * The same harvest rule, reward and experience as the manual path - composed, in one transaction,
 * with the actors' Auto timeline advance and the semantic receipt, so a harvest can never commit
 * without the timeline it belongs to moving with it.
 */
export interface AutoHarvestSettlement {
  settle(input: {
    readonly crop: CropInstance;
    readonly grant: CargoGrant;
    readonly award: XpAward;
    readonly expectedCargo: { readonly quantity: number; readonly version: number } | null;
    readonly containerVersion: number;
    readonly idempotency: IdempotencyRecord;
    readonly context: AutoHarvestSettlementContext;
  }): Promise<void>;
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
    private readonly clock: Clock,
    /** Present only when this host can land a reward in cargo; see `HarvestCargoDestination`. */
    private readonly cargoDestination?: HarvestCargoDestination,
    /** Present only when this host can compose the harvest with the Auto timeline. */
    private readonly autoSettlement?: AutoHarvestSettlement
  ) {}

  /** Harvests into the Home Warehouse: the manual path, unchanged. */
  execute(actor: ActorContext | null, farmId: FarmId, command: HarvestCropCommand): Promise<HarvestCropResult> {
    return this.harvest(actor, farmId, command, "WAREHOUSE");
  }

  /**
   * Harvests into the actor's cargo: what an Auto-driven character does in the field.
   *
   * The same class, the same reward amount, the same XP rule, the same crop-state guard, the same
   * receipt and the same retry discipline - only the destination differs, which is what keeps "Auto
   * never yields more than a player's own hands" true by construction.
   */
  executeIntoCargo(actor: ActorContext | null, farmId: FarmId, command: HarvestCropCommand): Promise<HarvestCropResult> {
    return this.harvest(actor, farmId, command, "CARGO");
  }

  /**
   * Harvests into cargo as one Auto transition.
   *
   * Exactly `executeIntoCargo` plus the Auto timeline context: the same maturity check, the same
   * reward, the same experience rule and the same crop-state guard. The difference is that the
   * economic mutation, the Auto state advance, `simulation_at` and the semantic receipt commit in one
   * transaction - so a harvest that lands can never leave the timeline behind, and a stale timeline
   * can never pay a harvest out.
   */
  executeIntoCargoAuto(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestCropCommand & AutoHarvestSettlementContext
  ): Promise<HarvestCropResult> {
    const { assignmentId, actorId, eventTime, expectedAutoVersion, expectedSimulationAt, ...harvestCommand } = command;
    return this.harvest(actor, farmId, harvestCommand, "CARGO", {
      actorId,
      assignmentId,
      eventTime,
      expectedAutoVersion,
      expectedSimulationAt
    });
  }

  private async harvest(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestCropCommand,
    destination: "WAREHOUSE" | "CARGO",
    autoContext?: AutoHarvestSettlementContext
  ): Promise<HarvestCropResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (autoContext === undefined) await requireMainCharacterPlayerControl(this.cargoDestination?.actors, actor.playerId);
    let cropId: CropInstanceId;
    try {
      cropId = parseCropInstanceId(command.cropInstanceId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Crop instance ID is invalid");
    }
    // The destination is part of the intent: the same request id may not harvest into the Warehouse
    // and into cargo, which is what makes a replay a replay rather than a second payout.
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, cropId, command.expectedCropVersion, destination])
    );

    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Harvesting is not allowed");
    }

    // The economic identity is the Auto transition's, not the HTTP request's: a retry of the same
    // step finds the receipt it already wrote, while a manual harvest keeps naming its own request.
    const operation = autoContext === undefined ? HARVEST_OPERATION : AUTO_HARVEST_OPERATION;
    const settlementRequestId =
      autoContext === undefined
        ? command.requestId
        : autoTransitionId({ ...autoContext, kind: "HARVEST" });
    const existing = await this.idempotency.find(actor.playerId, operation, settlementRequestId);
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
    // An Auto harvest is settled at the instant the executor simulated: its maturity check, the
    // experience timestamp and its receipt all belong to that instant, not to the moment the player
    // came back. The manual path keeps reading the clock as it always did.
    const harvestNow = (): string => autoContext?.eventTime ?? this.clock.now();
    if (!canHarvest(crop, definition, harvestNow())) {
      throw new ApplicationError("CROP_NOT_MATURE", "Crop is not mature");
    }
    // The reward is the crop definition's, never a caller's: one rule, two containers.
    const reward = await this.prepareReward(actor, definition, destination);
    const harvest: HarvestResult = {
      cropInstanceId: crop.id,
      itemDefinitionId: reward.kind === "WAREHOUSE" ? reward.addition.itemDefinitionId : reward.grant.itemDefinitionId,
      quantityAdded: reward.kind === "WAREHOUSE" ? reward.addition.quantity : reward.grant.quantity
    };

    // The award is computed from a read, written only if that read still holds, and the whole
    // settlement is retried when it does not. Every attempt re-reads progression, so a lost race
    // costs a round trip rather than experience.
    for (let attempt = 0; attempt < PROGRESSION_ATTEMPTS; attempt += 1) {
      const stored = await this.progression.find(actor.playerId);
      const current = stored ?? emptyProgression(actor.playerId, harvestNow());
      let award: XpAward;
      try {
        award = createXpAward(this.progressionDefinition, current, definition.harvest.xp, harvestNow());
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
        operation,
        requestId: settlementRequestId,
        payloadFingerprint: fingerprint,
        resourceId: crop.id,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: harvestNow()
      };

      try {
        if (reward.kind === "WAREHOUSE") {
          await this.settlement.settleHarvestAtomically(crop, reward.addition, award, record);
        } else if (autoContext !== undefined && this.autoSettlement !== undefined) {
          await this.autoSettlement.settle({
            crop,
            grant: reward.grant,
            award,
            expectedCargo: reward.expected,
            containerVersion: reward.containerVersion,
            idempotency: record,
            context: autoContext
          });
        } else {
          await this.settlement.settleHarvestIntoCargoAtomically(crop, reward.grant, award, record);
        }
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "PROGRESSION_CONFLICT") continue;
        const raced = await this.idempotency.find(actor.playerId, operation, settlementRequestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        const currentCrop = await this.crops.findById(cropId);
        if (currentCrop === null) {
          throw new ApplicationError("CROP_ALREADY_HARVESTED", "Crop was already harvested");
        }
        await this.prepareReward(actor, definition, destination);
        throw error;
      }
    }
    throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
  }

  /**
   * The reward this harvest will pay, prepared against the destination the caller named.
   *
   * Preparing it is also the capacity pre-check: a warehouse reward is checked against the item's
   * inventory ceiling and a cargo reward against the container's capacity, so an overflowing harvest
   * is refused with a clean error before anything is written. The real authority is still the
   * database trigger inside the settlement - a racing grant can fill either container between this
   * read and the write, and the batch then rolls back with the crop still standing.
   */
  private async prepareReward(
    actor: ActorContext,
    definition: CropDefinition,
    destination: "WAREHOUSE" | "CARGO"
  ): Promise<HarvestReward> {
    if (destination === "WAREHOUSE") {
      const addition = this.inventoryService.prepareAddition(
        actor.playerId,
        definition.harvest.itemDefinitionId,
        definition.harvest.baseQuantity
      );
      await this.assertInventoryCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);
      return { kind: "WAREHOUSE", addition };
    }
    const bundle = this.cargoDestination;
    if (bundle === undefined) {
      throw new ApplicationError("INTERNAL_ERROR", "Harvesting into cargo is not available on this host");
    }
    const main = await bundle.actors.findMainCharacter(actor.playerId);
    if (main === null) {
      throw new ApplicationError("ACTOR_NOT_FOUND", "The actor cannot carry a harvest yet");
    }
    // One bounded read of the actor's own rows: it is the grant's free-capacity input and the carried
    // stack the Auto settlement's receipt must observe, so both come from the same snapshot.
    const carried = await bundle.cargo.listByActor(main.id);
    const used = carried.reduce((total, item) => total + item.quantity, 0);
    const expected = carried.find((item) => item.itemDefinitionId === definition.harvest.itemDefinitionId) ?? null;
    return {
      kind: "CARGO",
      grant: bundle.cargoService.prepareGrant(
        main.id,
        main.cargoCapacity,
        used,
        definition.harvest.itemDefinitionId,
        definition.harvest.baseQuantity
      ),
      expected: expected === null ? null : { quantity: expected.quantity, version: expected.version },
      containerVersion: main.cargoVersion
    };
  }

  private async assertInventoryCapacity(
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

export interface HarvestCropAreaGroupCommand {
  readonly requestId: string;
  readonly crops: readonly HarvestCropAreaCandidate[];
}

export interface HarvestCropAreaCandidate {
  readonly cropInstanceId: string;
  readonly expectedCropVersion: number;
}

export type HarvestCropAreaSkipReason =
  | "NOT_READY"
  | "INVENTORY_FULL"
  | "WAREHOUSE_FULL"
  | "STALE"
  | "NOT_OWNED"
  | "NOT_FOUND"
  | "NOT_ACTIVE";

export interface HarvestCropAreaCropResult {
  readonly cropInstanceId: string;
  readonly status: "HARVESTED" | "SKIPPED";
  readonly itemDefinitionId: string | null;
  readonly quantityAdded: number;
  readonly reason: HarvestCropAreaSkipReason | null;
}

export interface HarvestCropAreaGroupResult {
  readonly results: readonly HarvestCropAreaCropResult[];
  readonly harvestedCount: number;
  readonly skippedCount: number;
  readonly products: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

/** Bounded estate-management crop harvest that reuses the single-crop settlement and receipt. */
export class HarvestCropAreaGroup {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly crops: CropInstanceRepository,
    private readonly harvestCrop: HarvestCrop,
    private readonly receipts: CropHarvestBatchReceiptRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestCropAreaGroupCommand
  ): Promise<HarvestCropAreaGroupResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (command.crops.length === 0 || command.crops.length > MAX_HARVEST_CROP_AREA_GROUP) {
      throw new ApplicationError("INVALID_INPUT", "The harvest group size is invalid");
    }
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") throw new ApplicationError("NOT_AUTHORIZED", "Harvesting is not allowed");
    const parsedCandidates = command.crops.map((candidate) => {
      try {
        return { cropInstanceId: parseCropInstanceId(candidate.cropInstanceId), expectedCropVersion: candidate.expectedCropVersion };
      } catch {
        throw new ApplicationError("INVALID_INPUT", "Crop instance ID is invalid");
      }
    });
    if (new Set(parsedCandidates.map((candidate) => candidate.cropInstanceId)).size !== parsedCandidates.length) {
      throw new ApplicationError("INVALID_INPUT", "A harvest group cannot contain a duplicate crop");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, parsedCandidates.map((candidate) => [candidate.cropInstanceId, candidate.expectedCropVersion])])
    );
    const existing = await this.receipts.find(actor.playerId, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const results: HarvestCropAreaCropResult[] = [];
    for (let index = 0; index < parsedCandidates.length; index += 1) {
      const candidate = parsedCandidates[index];
      if (candidate === undefined) continue;
      try {
        const result = await this.harvestCrop.execute(actor, farmId, {
          cropInstanceId: candidate.cropInstanceId,
          expectedCropVersion: candidate.expectedCropVersion,
          requestId: await this.derivedRequestId(command.requestId, index)
        });
        results.push({
          cropInstanceId: result.harvest.cropInstanceId,
          status: "HARVESTED",
          itemDefinitionId: result.harvest.itemDefinitionId,
          quantityAdded: result.harvest.quantityAdded,
          reason: null
        });
      } catch (error: unknown) {
        const reason = cropBatchSkipReason(error);
        if (reason === null) throw error;
        results.push({ cropInstanceId: candidate.cropInstanceId, status: "SKIPPED", itemDefinitionId: null, quantityAdded: 0, reason });
      }
    }
    const products = new Map<string, number>();
    for (const result of results) {
      if (result.itemDefinitionId === null) continue;
      products.set(result.itemDefinitionId, (products.get(result.itemDefinitionId) ?? 0) + result.quantityAdded);
    }
    const response: HarvestCropAreaGroupResult = {
      results,
      harvestedCount: results.filter((result) => result.status === "HARVESTED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length,
      products: [...products.entries()].map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: HARVEST_CROP_AREA_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: String(farmId),
      responseJson: JSON.stringify(response),
      status: "COMPLETED",
      createdAt: this.clock.now()
    };
    if (await this.receipts.save(record)) return response;
    const raced = await this.receipts.find(actor.playerId, command.requestId);
    if (raced !== null) return this.replay(raced, fingerprint);
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "The harvest group could not be recorded");
  }

  private async derivedRequestId(groupRequestId: string, index: number): Promise<string> {
    const digest = await this.fingerprints.hash(`${groupRequestId}:${String(index)}`);
    return `crop-area-${digest.slice(0, 72)}`;
  }

  private replay(record: IdempotencyRecord, fingerprint: string): HarvestCropAreaGroupResult {
    if (record.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    try {
      const value = JSON.parse(record.responseJson) as HarvestCropAreaGroupResult;
      if (!Array.isArray(value.results) || !Number.isSafeInteger(value.harvestedCount) || !Number.isSafeInteger(value.skippedCount) || !Array.isArray(value.products)) throw new Error("invalid stored result");
      return value;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored harvest group result is unavailable");
    }
  }
}

function cropBatchSkipReason(error: unknown): HarvestCropAreaSkipReason | null {
  if (error instanceof Error && error.message.includes("warehouse_full")) return "WAREHOUSE_FULL";
  if (!(error instanceof ApplicationError)) return null;
  switch (error.code) {
    case "CROP_NOT_MATURE": return "NOT_READY";
    case "CONFLICT_STALE_STATE": return "STALE";
    case "INVENTORY_LIMIT_EXCEEDED": return "INVENTORY_FULL";
    case "WAREHOUSE_FULL": return "WAREHOUSE_FULL";
    case "NOT_AUTHORIZED": return "NOT_OWNED";
    case "CROP_NOT_FOUND": return "NOT_FOUND";
    case "CROP_ALREADY_HARVESTED": return "NOT_ACTIVE";
    default: return null;
  }
}
