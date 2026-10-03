import {
  assertFishingAction,
  fishingReadyAt,
  isFishingReady,
  parseFishingActionId,
  secondsUntilFishingReady,
  selectCatch,
  createXpAward,
  type FishingAction,
  type FishingActionId,
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
  FishDefinition,
  FishingActionRepository,
  FishingCataloguePort,
  FishingIdGenerator,
  FishingRandomPort,
  FishingSettlementRepository,
  HomeIslandZoneResolver,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  ProgressionRepository
} from "./ports";

/**
 * Fishing: the first profession that does not happen on the farm.
 *
 * The shape is the harvest's, because the problem is the same one: the server owns the outcome, the
 * clock, the reward and the receipt, and a retry must not pay twice. What differs is where it lives.
 * A crop harvest is authorized by a farm and owned by a farm; a fishing action belongs to the
 * *actor*, names the *zone* it happened in, and is settled from a catch table rather than from a row
 * on a tile. That is what makes a shared ground a new zone kind later instead of a rewrite.
 */

const START_OPERATION = "FISHING_START";
const SETTLE_OPERATION = "FISHING_SETTLE";
const CANCEL_OPERATION = "FISHING_CANCEL";

/** How many times a settlement re-reads progression after losing a race before giving up. */
const PROGRESSION_ATTEMPTS = 8;

export interface FishingSpotView {
  readonly spotId: string;
  readonly displayNameKey: string;
  readonly zoneKind: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly interactionRadiusTiles: number;
  readonly tableId: string;
}

export interface FishView {
  readonly fishDefinitionId: string;
  readonly displayNameKey: string;
  readonly itemDefinitionId: string;
  readonly itemDisplayNameKey: string;
  readonly modelId: string | null;
  readonly sellPrice: number;
  readonly xp: number;
  readonly requiredLevel: number;
}

/** The whole catalogue the client draws from: where to fish, and what lives there. */
export interface FishingCatalogueView {
  readonly spots: readonly FishingSpotView[];
  readonly fish: readonly FishView[];
}

export interface FishingActionView {
  readonly actionId: string;
  readonly zone: { readonly kind: string; readonly id: string };
  readonly spotId: string;
  readonly tableId: string;
  readonly status: FishingAction["status"];
  readonly startedAt: string;
  readonly readyAt: string;
  readonly secondsUntilReady: number;
  readonly version: number;
}

export interface FishingCatchView {
  readonly itemDefinitionId: string;
  readonly quantity: number;
}

export interface FishingSettleView {
  readonly catch: FishingCatchView;
  readonly progression: XpAwardView;
}

function toActionView(action: FishingAction, serverTime: string): FishingActionView {
  return {
    actionId: action.actionId,
    zone: { kind: action.zoneKind, id: action.zoneId },
    spotId: action.spotId,
    tableId: action.tableId,
    status: action.status,
    startedAt: action.startedAt,
    readyAt: action.readyAt,
    secondsUntilReady: secondsUntilFishingReady(action.readyAt, serverTime),
    version: action.version
  };
}

/**
 * The fishing catalogue: spots and species, straight from game data.
 *
 * A pure projection - no database, no player state - so a client can draw the water and name the
 * catch without the server having read a single farm row.
 */
export class ListFishingCatalogue {
  constructor(private readonly catalogue: FishingCataloguePort) {}

  execute(actor: ActorContext | null): FishingCatalogueView {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return {
      // Only open spots are listed: a closed one would be a prompt the server refuses.
      spots: this.catalogue
        .listSpots()
        .filter((spot) => spot.enabled)
        .map((spot) => ({
          spotId: spot.id,
          displayNameKey: spot.displayNameKey,
          zoneKind: spot.zoneKind,
          position: { x: spot.position.x, y: spot.position.y },
          interactionRadiusTiles: spot.interactionRadiusTiles,
          tableId: spot.tableId
        })),
      fish: this.catalogueFish()
    };
  }

  private catalogueFish(): readonly FishView[] {
    // The catalogue port exposes fish one id at a time for settlement; the listing walks the tables,
    // which are the only place a fish is named, so the two views cannot disagree about what exists.
    const seen = new Map<string, FishView>();
    for (const spot of this.catalogue.listSpots()) {
      const table = this.catalogue.findTable(spot.tableId);
      if (table === null) continue;
      for (const entry of table.entries) {
        if (seen.has(entry.fishId)) continue;
        const definition = this.catalogue.findFish(entry.fishId);
        if (definition === null) continue;
        seen.set(entry.fishId, toFishView(definition));
      }
    }
    return [...seen.values()];
  }
}

function toFishView(definition: FishDefinition): FishView {
  return {
    fishDefinitionId: definition.id,
    displayNameKey: definition.displayNameKey,
    itemDefinitionId: definition.itemDefinitionId,
    itemDisplayNameKey: definition.itemDisplayNameKey,
    modelId: definition.modelId,
    sellPrice: definition.sellPrice,
    xp: definition.xp,
    requiredLevel: definition.requiredLevel
  };
}

/** The actor's live attempt, or null. One indexed lookup: this is the whole cost of a refresh. */
export class GetActiveFishing {
  constructor(
    private readonly actions: FishingActionRepository,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<FishingActionView | null> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const action = await this.actions.findActiveByActor(actor.playerId);
    return action === null ? null : toActionView(action, this.clock.now());
  }
}

export interface StartFishingCommand {
  readonly spotId: string;
  readonly requestId: string;
}

/**
 * Starts one fishing attempt.
 *
 * The client names a *spot* and nothing else: which table it uses, which zone it is in, and how long
 * the attempt takes are all the server's. The zone is resolved from the actor's own home island -
 * the same adapter that already maps a farm to `HOME_ISLAND` - and the spot declares which zone kinds
 * it belongs to, so a spot is never implicitly the player's.
 */
export class StartFishing {
  constructor(
    private readonly zones: HomeIslandZoneResolver,
    private readonly actions: FishingActionRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly catalogue: FishingCataloguePort,
    private readonly ids: FishingIdGenerator,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: StartFishingCommand): Promise<FishingActionView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const fingerprint = await this.fingerprints.hash(JSON.stringify([command.spotId]));

    const existing = await this.idempotency.find(actor.playerId, START_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const spot = this.catalogue.findSpot(command.spotId);
    if (spot === null) throw new ApplicationError("FISHING_SPOT_NOT_FOUND", "Fishing spot was not found");
    if (!spot.enabled) throw new ApplicationError("FISHING_SPOT_DISABLED", "Fishing spot is closed");

    // The zone: for Home Island, the actor's own island, resolved from the actor and never from the
    // request. A spot that belongs to another zone kind is refused here, which is the check a shared
    // fishing ground will relax by its own rules.
    const zone = await this.zones.resolveForPlayer(actor.playerId);
    if (zone === null || spot.zoneKind !== zone.kind) {
      throw new ApplicationError("FISHING_ZONE_NOT_ALLOWED", "Fishing is not allowed in this zone");
    }
    if (this.catalogue.findTable(spot.tableId) === null) {
      throw new ApplicationError("INTERNAL_ERROR", "Fishing spot has no catch table");
    }

    const active = await this.actions.findActiveByActor(actor.playerId);
    if (active !== null) {
      throw new ApplicationError("FISHING_ALREADY_ACTIVE", "A fishing attempt is already in progress");
    }

    const now = this.clock.now();
    const action: FishingAction = {
      actionId: this.ids.newFishingActionId(),
      actorPlayerId: actor.playerId,
      zoneKind: spot.zoneKind,
      zoneId: zone.id,
      spotId: spot.id,
      tableId: spot.tableId,
      status: "ACTIVE",
      startedAt: now,
      readyAt: fishingReadyAt(now, this.catalogue.actionSeconds),
      settledAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    assertFishingAction(action);
    const view = toActionView(action, now);
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: START_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: action.actionId,
      responseJson: JSON.stringify(view),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await this.actions.create(action, record);
      return view;
    } catch (error: unknown) {
      const raced = await this.idempotency.find(actor.playerId, START_OPERATION, command.requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      if ((await this.actions.findActiveByActor(actor.playerId)) !== null) {
        throw new ApplicationError("FISHING_ALREADY_ACTIVE", "A fishing attempt is already in progress");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): FishingActionView {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      parseFishingActionId(String(value.actionId));
      if (typeof value.spotId !== "string" || typeof value.readyAt !== "string") {
        throw new Error("invalid stored action");
      }
      return value as unknown as FishingActionView;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export interface SettleFishingCommand {
  readonly actionId: string;
  readonly expectedActionVersion: number;
  readonly requestId: string;
}

/**
 * Settles a finished attempt: the server chooses the catch and pays it once.
 *
 * The client supplies an action id and the revision it is looking at. It cannot name a fish, a
 * quantity, a price or an experience reward, and it cannot shorten the wait: readiness is a
 * comparison of the action's own timestamps against the server clock. The roll is the injected
 * random port's, and the whole payout is one batch with the receipt that makes a replay a no-op.
 */
export class SettleFishing {
  constructor(
    private readonly actions: FishingActionRepository,
    private readonly settlement: FishingSettlementRepository,
    private readonly catalogue: FishingCataloguePort,
    private readonly inventory: InventoryRepository,
    private readonly inventoryService: InventoryService,
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
    private readonly idempotency: IdempotencyRepository,
    private readonly random: FishingRandomPort,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: SettleFishingCommand): Promise<FishingSettleView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let actionId: FishingActionId;
    try {
      actionId = parseFishingActionId(command.actionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Fishing action ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([actionId, command.expectedActionVersion])
    );

    const existing = await this.idempotency.find(actor.playerId, SETTLE_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const action = await this.actions.findById(actionId);
    // Another player's action is indistinguishable from one that does not exist.
    if (action === null || action.actorPlayerId !== actor.playerId) {
      throw new ApplicationError("FISHING_ACTION_NOT_FOUND", "Fishing action was not found");
    }
    if (action.status !== "ACTIVE") {
      throw new ApplicationError("FISHING_ACTION_NOT_ACTIVE", "Fishing action has already finished");
    }
    if (action.version !== command.expectedActionVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Fishing action version does not match");
    }
    if (!isFishingReady(action, this.clock.now())) {
      throw new ApplicationError("FISHING_NOT_READY", "The catch is not ready yet");
    }

    const table = this.catalogue.findTable(action.tableId);
    if (table === null) throw new ApplicationError("INTERNAL_ERROR", "Fishing table was not found");
    const caught = selectCatch(table.entries, this.random.roll());
    const definition = this.catalogue.findFish(caught.fishId);
    if (definition === null) throw new ApplicationError("INTERNAL_ERROR", "Fish definition was not found");
    const addition = this.inventoryService.prepareAddition(actor.playerId, definition.itemDefinitionId, 1);
    await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);

    const settled: FishingCatchView = {
      itemDefinitionId: definition.itemDefinitionId,
      quantity: addition.quantity
    };

    for (let attempt = 0; attempt < PROGRESSION_ATTEMPTS; attempt += 1) {
      const stored = await this.progression.find(actor.playerId);
      const current = stored ?? emptyProgression(actor.playerId, this.clock.now());
      let award: XpAward;
      try {
        award = createXpAward(this.progressionDefinition, current, definition.xp, this.clock.now());
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      }
      const result: FishingSettleView = {
        catch: settled,
        progression: {
          xpAwarded: award.xpAwarded,
          leveledUp: award.leveledUp,
          progression: progressionView(this.progressionDefinition, award.xpAfter)
        }
      };
      const settledAction: FishingAction = {
        ...action,
        status: "SETTLED",
        settledAt: award.timestamp,
        version: action.version + 1,
        updatedAt: award.timestamp
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: SETTLE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: action.actionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: award.timestamp
      };
      try {
        await this.settlement.settleFishingAtomically(settledAction, addition, award, record);
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "FISHING_CONFLICT") continue;
        const raced = await this.idempotency.find(actor.playerId, SETTLE_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        const currentAction = await this.actions.findById(actionId);
        if (currentAction !== null && currentAction.status !== "ACTIVE") {
          throw new ApplicationError("FISHING_ACTION_NOT_ACTIVE", "Fishing action has already finished");
        }
        throw error;
      }
    }
    throw new ApplicationError("FISHING_CONFLICT", "Fishing action changed concurrently");
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

  private replay(record: IdempotencyRecord, fingerprint: string): FishingSettleView {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      const caught = value.catch;
      if (typeof caught !== "object" || caught === null) throw new Error("invalid stored catch");
      const fields = caught as Record<string, unknown>;
      if (
        typeof fields.itemDefinitionId !== "string" ||
        !Number.isSafeInteger(fields.quantity) ||
        (fields.quantity as number) <= 0
      ) {
        throw new Error("invalid stored catch");
      }
      assertStoredXpAward(value.progression);
      return value as unknown as FishingSettleView;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export interface CancelFishingCommand {
  readonly actionId: string;
  readonly expectedActionVersion: number;
  readonly requestId: string;
}

export interface CancelFishingResult {
  readonly cancelled: true;
}

/**
 * Gives up an attempt, granting nothing.
 *
 * Movement cancels fishing on the client, and a cancelled attempt must be as final as a settled one:
 * no fish, no experience, and no way to settle it afterwards. Cancelling something already settled is
 * refused rather than ignored, so a client cannot mistake a paid catch for a discarded one.
 */
export class CancelFishing {
  constructor(
    private readonly actions: FishingActionRepository,
    private readonly settlement: FishingSettlementRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: CancelFishingCommand): Promise<CancelFishingResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let actionId: FishingActionId;
    try {
      actionId = parseFishingActionId(command.actionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Fishing action ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([actionId, command.expectedActionVersion])
    );
    const existing = await this.idempotency.find(actor.playerId, CANCEL_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const action = await this.actions.findById(actionId);
    if (action === null || action.actorPlayerId !== actor.playerId) {
      throw new ApplicationError("FISHING_ACTION_NOT_FOUND", "Fishing action was not found");
    }
    if (action.status !== "ACTIVE") {
      throw new ApplicationError("FISHING_ACTION_NOT_ACTIVE", "Fishing action has already finished");
    }
    if (action.version !== command.expectedActionVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Fishing action version does not match");
    }
    const now = this.clock.now();
    const cancelled: FishingAction = {
      ...action,
      status: "CANCELLED",
      version: action.version + 1,
      updatedAt: now
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: CANCEL_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: action.actionId,
      responseJson: JSON.stringify({ cancelled: true }),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await this.settlement.cancelFishingAtomically(cancelled, record);
      return { cancelled: true };
    } catch (error: unknown) {
      const raced = await this.idempotency.find(actor.playerId, CANCEL_OPERATION, command.requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      const current = await this.actions.findById(actionId);
      if (current !== null && current.status !== "ACTIVE") {
        throw new ApplicationError("FISHING_ACTION_NOT_ACTIVE", "Fishing action has already finished");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): CancelFishingResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    return { cancelled: true };
  }
}
