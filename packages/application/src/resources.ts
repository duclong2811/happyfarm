import {
  assertResourceAction,
  createXpAward,
  isResourceAvailable,
  parseResourceActionId,
  resourceAvailableAt,
  resourceQuantity,
  secondsUntilResourceAvailable,
  selectResourceDrop,
  type ItemDefinitionId,
  type PlayerId,
  type ProgressionDefinition,
  type ResourceAction,
  type ResourceActionId,
  type ResourceNodeState,
  type ResourceVerb,
  type XpAward
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import {
  assertStoredXpAward,
  emptyProgression,
  progressionView,
  storedLevel,
  type XpAwardView
} from "./progression";
import type {
  ActorContext,
  Clock,
  HomeIslandZoneResolver,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  ProgressionRepository,
  RandomPort,
  ResourceActionRepository,
  ResourceCataloguePort,
  ResourceIdGenerator,
  ResourceNodeStateRepository,
  ResourceSettlementRepository
} from "./ports";

/**
 * Resource gathering: the generic lifecycle mining introduces and forestry reuses.
 *
 * The shape is fishing's, because it is the same problem - server-owned start, server-owned wait,
 * one atomic payout, replay and race safety - with two additions that matter: the *node* has its own
 * authoritative availability, and the payout depletes it and starts a regeneration clock. Nothing in
 * this file mentions a rock, an ore or a pickaxe: a node has a verb, a drop table, a duration and a
 * regeneration time, and `CHOP` is another value of the same enum.
 */

const START_OPERATION = "RESOURCE_START";
const SETTLE_OPERATION = "RESOURCE_SETTLE";
const CANCEL_OPERATION = "RESOURCE_CANCEL";

/** How many times a settlement re-reads progression after losing a race before giving up. */
const PROGRESSION_ATTEMPTS = 8;

export interface ResourceNodeView {
  readonly nodeId: string;
  readonly definitionId: string;
  readonly displayNameKey: string;
  readonly verb: ResourceVerb;
  readonly zoneKind: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly interactionRadiusTiles: number;
  readonly actionSeconds: number;
  readonly modelId: string;
  /** The material this node yields. Sent so the client can draw the material with the node's own art. */
  readonly dropItemDefinitionId: string;
  readonly requiredLevel: number;
  /** When this node is next available, or null when it has never been gathered. */
  readonly availableAt: string | null;
  readonly secondsUntilAvailable: number;
  readonly available: boolean;
}

export interface ResourceCatalogueView {
  readonly nodes: readonly ResourceNodeView[];
}

export interface ResourceActionView {
  readonly actionId: string;
  readonly zone: { readonly kind: string; readonly id: string };
  readonly nodeId: string;
  readonly definitionId: string;
  readonly verb: ResourceVerb;
  readonly status: ResourceAction["status"];
  readonly startedAt: string;
  readonly readyAt: string;
  readonly secondsUntilReady: number;
  readonly version: number;
}

export interface ResourceDropView {
  readonly itemDefinitionId: string;
  readonly quantity: number;
}

export interface ResourceSettleView {
  readonly drop: ResourceDropView;
  readonly node: { readonly nodeId: string; readonly availableAt: string };
  readonly progression: XpAwardView;
}

function toActionView(action: ResourceAction, serverTime: string): ResourceActionView {
  return {
    actionId: action.actionId,
    zone: { kind: action.zoneKind, id: action.zoneId },
    nodeId: action.nodeId,
    definitionId: action.definitionId,
    verb: action.verb,
    status: action.status,
    startedAt: action.startedAt,
    readyAt: action.readyAt,
    secondsUntilReady: Math.max(0, Math.ceil((Date.parse(action.readyAt) - Date.parse(serverTime)) / 1000)),
    version: action.version
  };
}

/**
 * The island's nodes, with the actor's own zone's availability folded in.
 *
 * Two bounded reads at most: the static catalogue is game data, and the state rows are one range scan
 * keyed by the zone. No polling, and the countdown a client shows is derived from `availableAt`.
 */
export class ListResourceNodes {
  constructor(
    private readonly catalogue: ResourceCataloguePort,
    private readonly states: ResourceNodeStateRepository,
    private readonly zones: HomeIslandZoneResolver,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<ResourceCatalogueView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const zone = await this.zones.resolveForPlayer(actor.playerId);
    const states = zone === null ? [] : await this.states.listByZone(zone.id);
    const byNode = new Map(states.map((state) => [state.nodeId, state]));
    const now = this.clock.now();
    const nodes: ResourceNodeView[] = [];
    for (const node of this.catalogue.listNodes()) {
      if (zone === null || node.zoneKind !== zone.kind) continue;
      const definition = this.catalogue.findDefinition(node.definitionId);
      if (definition === null) continue;
      const state = byNode.get(node.id) ?? null;
      const availableAt = state?.availableAt ?? null;
      const table = this.catalogue.findDropTable(definition.dropTableId);
      const dropItem = table?.entries[0]?.itemDefinitionId;
      if (dropItem === undefined) continue;
      nodes.push({
        nodeId: node.id,
        definitionId: definition.id,
        displayNameKey: definition.displayNameKey,
        verb: definition.verb,
        zoneKind: node.zoneKind,
        position: { x: node.position.x, y: node.position.y },
        interactionRadiusTiles: node.interactionRadiusTiles,
        actionSeconds: definition.actionSeconds,
        modelId: definition.modelId,
        dropItemDefinitionId: dropItem,
        requiredLevel: definition.requiredLevel,
        availableAt,
        secondsUntilAvailable: secondsUntilResourceAvailable(availableAt, now),
        available: isResourceAvailable(availableAt, now)
      });
    }
    return { nodes };
  }
}

export interface StartResourceActionCommand {
  readonly nodeId: string;
  readonly requestId: string;
}

/**
 * The actor's live gather, or null.
 *
 * One indexed lookup, and the whole cost of a refresh: without it a page reload would lose the
 * in-flight action and the player would be refused a new one until it settled itself. The client
 * resumes the wait from `readyAt` instead.
 */
export class GetActiveResourceAction {
  constructor(
    private readonly actions: ResourceActionRepository,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<ResourceActionView | null> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const action = await this.actions.findActiveByActor(actor.playerId);
    return action === null ? null : toActionView(action, this.clock.now());
  }
}

/**
 * Begins one gather.
 *
 * The client names a node and nothing else. The server resolves the actor's own zone, checks the node
 * belongs to that zone kind, that the actor's level satisfies the node, and that the node is actually
 * available right now - a depleted node is refused here rather than after the wait.
 */
export class StartResourceAction {
  constructor(
    private readonly zones: HomeIslandZoneResolver,
    private readonly catalogue: ResourceCataloguePort,
    private readonly states: ResourceNodeStateRepository,
    private readonly actions: ResourceActionRepository,
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
    private readonly idempotency: IdempotencyRepository,
    private readonly ids: ResourceIdGenerator,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    command: StartResourceActionCommand
  ): Promise<ResourceActionView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const fingerprint = await this.fingerprints.hash(JSON.stringify([command.nodeId]));

    const existing = await this.idempotency.find(actor.playerId, START_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const node = this.catalogue.findNode(command.nodeId);
    if (node === null) throw new ApplicationError("RESOURCE_NODE_NOT_FOUND", "Resource node was not found");
    const definition = this.catalogue.findDefinition(node.definitionId);
    if (definition === null) {
      throw new ApplicationError("INTERNAL_ERROR", "Resource node has no definition");
    }
    if (this.catalogue.findDropTable(definition.dropTableId) === null) {
      throw new ApplicationError("INTERNAL_ERROR", "Resource node has no drop table");
    }

    const zone = await this.zones.resolveForPlayer(actor.playerId);
    if (zone === null || node.zoneKind !== zone.kind) {
      throw new ApplicationError("RESOURCE_ZONE_NOT_ALLOWED", "Gathering is not allowed in this zone");
    }
    const level = storedLevel(this.progressionDefinition, await this.progression.find(actor.playerId));
    if (definition.requiredLevel > level) {
      throw new ApplicationError(
        "RESOURCE_LEVEL_REQUIRED",
        `Resource ${definition.id} requires level ${String(definition.requiredLevel)}; player is level ${String(level)}`
      );
    }

    const state = await this.states.find(zone.id, node.id);
    const now = this.clock.now();
    if (!isResourceAvailable(state?.availableAt ?? null, now)) {
      throw new ApplicationError("RESOURCE_NODE_DEPLETED", "This resource node is still depleted");
    }

    const active = await this.actions.findActiveByActor(actor.playerId);
    if (active !== null) {
      throw new ApplicationError("RESOURCE_ALREADY_ACTIVE", "A gather is already in progress");
    }

    const action: ResourceAction = {
      actionId: this.ids.newResourceActionId(),
      actorPlayerId: actor.playerId,
      zoneKind: node.zoneKind,
      zoneId: zone.id,
      nodeId: node.id,
      definitionId: definition.id,
      verb: definition.verb,
      status: "ACTIVE",
      startedAt: now,
      readyAt: resourceAvailableAt(now, definition.actionSeconds),
      settledAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    assertResourceAction(action);
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
        throw new ApplicationError("RESOURCE_ALREADY_ACTIVE", "A gather is already in progress");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): ResourceActionView {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      parseResourceActionId(String(value.actionId));
      if (typeof value.nodeId !== "string" || typeof value.readyAt !== "string") {
        throw new Error("invalid stored action");
      }
      return value as unknown as ResourceActionView;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export interface SettleResourceActionCommand {
  readonly actionId: string;
  readonly expectedActionVersion: number;
  readonly requestId: string;
}

/**
 * Settles a gather: the item, the experience, the depletion and the regeneration clock, atomically.
 *
 * Readiness is the server's clock against the action's own `ready_at`. The drop comes from the
 * definition's table, chosen by the injected random port - one code path whether the table is a single
 * deterministic entry or several weighted ones. The node must still be available when the settlement
 * runs, so two attempts at one node can only deplete it once.
 */
export class SettleResourceAction {
  constructor(
    private readonly actions: ResourceActionRepository,
    private readonly settlement: ResourceSettlementRepository,
    private readonly catalogue: ResourceCataloguePort,
    private readonly states: ResourceNodeStateRepository,
    private readonly inventory: InventoryRepository,
    private readonly inventoryService: InventoryService,
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
    private readonly idempotency: IdempotencyRepository,
    private readonly random: RandomPort,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    command: SettleResourceActionCommand
  ): Promise<ResourceSettleView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let actionId: ResourceActionId;
    try {
      actionId = parseResourceActionId(command.actionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Resource action ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([actionId, command.expectedActionVersion])
    );

    const existing = await this.idempotency.find(actor.playerId, SETTLE_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const action = await this.actions.findById(actionId);
    if (action === null || action.actorPlayerId !== actor.playerId) {
      throw new ApplicationError("RESOURCE_ACTION_NOT_FOUND", "Resource action was not found");
    }
    if (action.status !== "ACTIVE") {
      throw new ApplicationError("RESOURCE_ACTION_NOT_ACTIVE", "Resource action has already finished");
    }
    if (action.version !== command.expectedActionVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Resource action version does not match");
    }
    const now = this.clock.now();
    if (Date.parse(action.readyAt) > Date.parse(now)) {
      throw new ApplicationError("RESOURCE_NOT_READY", "The gather is not finished yet");
    }

    const definition = this.catalogue.findDefinition(action.definitionId);
    if (definition === null) throw new ApplicationError("INTERNAL_ERROR", "Resource definition was not found");
    const table = this.catalogue.findDropTable(definition.dropTableId);
    if (table === null) throw new ApplicationError("INTERNAL_ERROR", "Resource drop table was not found");

    // The node must still be available: another gather (or another player, in a shared zone later) may
    // have depleted it since this action started.
    const state = await this.states.find(action.zoneId, action.nodeId);
    if (!isResourceAvailable(state?.availableAt ?? null, now)) {
      throw new ApplicationError("RESOURCE_NODE_DEPLETED", "This resource node is still depleted");
    }

    const entry = selectResourceDrop(table.entries, this.random.roll());
    const quantity = resourceQuantity(entry, this.random.roll());
    const addition = this.inventoryService.prepareAddition(actor.playerId, entry.itemDefinitionId, quantity);
    await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);

    const drop: ResourceDropView = { itemDefinitionId: entry.itemDefinitionId, quantity };
    const availableAt = resourceAvailableAt(now, definition.regenerationSeconds);
    const nodeState: ResourceNodeState = {
      zoneKind: action.zoneKind,
      zoneId: action.zoneId,
      nodeId: action.nodeId,
      availableAt,
      depletedAt: now,
      version: (state?.version ?? 0) + 1
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
      const result: ResourceSettleView = {
        drop,
        node: { nodeId: action.nodeId, availableAt },
        progression: {
          xpAwarded: award.xpAwarded,
          leveledUp: award.leveledUp,
          progression: progressionView(this.progressionDefinition, award.xpAfter)
        }
      };
      const settledAction: ResourceAction = {
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
        await this.settlement.settleResourceAtomically(settledAction, addition, award, nodeState, record);
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "RESOURCE_CONFLICT") continue;
        const raced = await this.idempotency.find(actor.playerId, SETTLE_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        const currentAction = await this.actions.findById(actionId);
        if (currentAction !== null && currentAction.status !== "ACTIVE") {
          throw new ApplicationError("RESOURCE_ACTION_NOT_ACTIVE", "Resource action has already finished");
        }
        throw error;
      }
    }
    throw new ApplicationError("RESOURCE_CONFLICT", "Resource action changed concurrently");
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

  private replay(record: IdempotencyRecord, fingerprint: string): ResourceSettleView {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      const drop = value.drop;
      if (typeof drop !== "object" || drop === null) throw new Error("invalid stored drop");
      const fields = drop as Record<string, unknown>;
      if (
        typeof fields.itemDefinitionId !== "string" ||
        !Number.isSafeInteger(fields.quantity) ||
        (fields.quantity as number) <= 0
      ) {
        throw new Error("invalid stored drop");
      }
      assertStoredXpAward(value.progression);
      return value as unknown as ResourceSettleView;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export interface CancelResourceActionCommand {
  readonly actionId: string;
  readonly expectedActionVersion: number;
  readonly requestId: string;
}

export interface CancelResourceActionResult {
  readonly cancelled: true;
}

/**
 * Gives up a gather, leaving the node untouched.
 *
 * A cancelled gather must not deplete the node: the deposit is only spent by a settlement, so walking
 * away costs the player their time and nothing else.
 */
export class CancelResourceAction {
  constructor(
    private readonly actions: ResourceActionRepository,
    private readonly settlement: ResourceSettlementRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    command: CancelResourceActionCommand
  ): Promise<CancelResourceActionResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let actionId: ResourceActionId;
    try {
      actionId = parseResourceActionId(command.actionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Resource action ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([actionId, command.expectedActionVersion])
    );
    const existing = await this.idempotency.find(actor.playerId, CANCEL_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const action = await this.actions.findById(actionId);
    if (action === null || action.actorPlayerId !== actor.playerId) {
      throw new ApplicationError("RESOURCE_ACTION_NOT_FOUND", "Resource action was not found");
    }
    if (action.status !== "ACTIVE") {
      throw new ApplicationError("RESOURCE_ACTION_NOT_ACTIVE", "Resource action has already finished");
    }
    if (action.version !== command.expectedActionVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Resource action version does not match");
    }
    const now = this.clock.now();
    const cancelled: ResourceAction = {
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
      await this.settlement.cancelResourceAtomically(cancelled, record);
      return { cancelled: true };
    } catch (error: unknown) {
      const raced = await this.idempotency.find(actor.playerId, CANCEL_OPERATION, command.requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      const current = await this.actions.findById(actionId);
      if (current !== null && current.status !== "ACTIVE") {
        throw new ApplicationError("RESOURCE_ACTION_NOT_ACTIVE", "Resource action has already finished");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): CancelResourceActionResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    return { cancelled: true };
  }
}
