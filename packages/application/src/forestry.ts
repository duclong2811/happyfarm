import { createXpAward, parseConstructionId } from "@happy-farm/domain";
import type { ConstructionInstance, FarmId, ProgressionDefinition, XpAward } from "@happy-farm/domain";
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
  ConstructionRepository,
  FarmMemberRepository,
  FarmRepository,
  ForestryConstructionDefinitionRepository,
  ForestryConstructionState,
  ForestryConstructionStateRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  ProgressionRepository,
  PayloadFingerprint
} from "./ports";

export const CHOP_FORESTRY_CONSTRUCTION_OPERATION = "CHOP_FORESTRY_CONSTRUCTION";

export interface ForestryConstructionStateView {
  readonly constructionId: string;
  readonly entryId: string;
  readonly status: "READY" | "DEPLETED";
  readonly dropItemDefinitionId: string;
  readonly dropQuantity: number;
  readonly regenerationAt: string | null;
  readonly version: number;
}

export interface ForestryChopResult {
  readonly constructionId: string;
  readonly itemDefinitionId: string;
  readonly quantityAdded: number;
  readonly state: ForestryConstructionStateView;
  readonly progression: XpAwardView;
}

export function projectForestryConstructionState(
  state: ForestryConstructionState,
  definition: { readonly dropItemDefinitionId: string; readonly dropQuantity: number },
  now: string
): ForestryConstructionStateView {
  const ready = state.regenerationAt === null || Date.parse(state.regenerationAt) <= Date.parse(now);
  return {
    constructionId: state.constructionId,
    entryId: state.entryId,
    status: ready ? "READY" : "DEPLETED",
    dropItemDefinitionId: definition.dropItemDefinitionId,
    dropQuantity: definition.dropQuantity,
    regenerationAt: ready ? null : state.regenerationAt,
    version: state.version
  };
}

export interface ChopForestryConstructionCommand {
  readonly requestId: string;
  readonly expectedForestryVersion: number;
}

export interface ChopForestryConstructionDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly constructions: ConstructionRepository;
  readonly definitions: ForestryConstructionDefinitionRepository;
  readonly state: ForestryConstructionStateRepository;
  readonly inventory: InventoryRepository;
  readonly inventoryService: InventoryService;
  readonly idempotency: IdempotencyRepository;
  readonly settlement: ForestryConstructionStateRepository;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

function isEditableConstruction(actor: ActorContext, construction: ConstructionInstance, role: string): boolean {
  return role === "OWNER" || (role === "EDITOR" && construction.ownerPlayerId === actor.playerId);
}

export class ChopForestryConstruction {
  constructor(private readonly dependencies: ChopForestryConstructionDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: ChopForestryConstructionCommand
  ): Promise<ForestryChopResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let id;
    try {
      id = parseConstructionId(constructionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Construction ID is invalid");
    }
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([CHOP_FORESTRY_CONSTRUCTION_OPERATION, farmId, id, command.expectedForestryVersion])
    );
    const existing = await this.dependencies.idempotency.find(actor.playerId, CHOP_FORESTRY_CONSTRUCTION_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);
    if ((await this.dependencies.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER" && membership?.role !== "EDITOR") {
      throw new ApplicationError("NOT_AUTHORIZED", "This farm does not allow forestry work");
    }
    const construction = await this.dependencies.constructions.findById(id);
    if (construction === null || construction.farmId !== farmId) {
      throw new ApplicationError("FORESTRY_CONSTRUCTION_NOT_FOUND", "That tree was not found on this farm");
    }
    if (!isEditableConstruction(actor, construction, membership.role)) {
      throw new ApplicationError("OBJECT_NOT_OWNED", "That tree belongs to another player");
    }
    if (construction.state !== "ACTIVE") {
      throw new ApplicationError("FORESTRY_CONSTRUCTION_NOT_READY", "A stored tree cannot be chopped");
    }
    const definition = this.dependencies.definitions.findByEntryId(construction.entryId);
    if (definition === null) {
      throw new ApplicationError("FORESTRY_CONSTRUCTION_NOT_FOUND", "This object is not a forestry tree");
    }
    const state = await this.dependencies.state.findByConstruction(farmId, id);
    if (state === null || state.entryId !== construction.entryId) {
      throw new ApplicationError("FORESTRY_CONSTRUCTION_NOT_FOUND", "Forestry state was not found");
    }
    if (state.version !== command.expectedForestryVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "The tree changed since you looked at it");
    }
    const now = this.dependencies.clock.now();
    if (state.regenerationAt !== null && Date.parse(state.regenerationAt) > Date.parse(now)) {
      throw new ApplicationError("FORESTRY_CONSTRUCTION_NOT_READY", "This tree is regenerating");
    }
    const addition = this.dependencies.inventoryService.prepareAddition(actor.playerId, definition.dropItemDefinitionId, definition.dropQuantity);
    const held = await this.dependencies.inventory.find(actor.playerId, addition.itemDefinitionId);
    if (held !== null && held.quantity > addition.maxQuantity - addition.quantity) {
      throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", "Inventory limit would be exceeded");
    }
    const nextRegeneration = new Date(Date.parse(now) + definition.regenerationSeconds * 1000).toISOString();
    const nextState: ForestryConstructionState = {
      ...state,
      lastChoppedAt: now,
      regenerationAt: nextRegeneration,
      version: state.version + 1
    };
    const harvest = {
      constructionId: construction.id,
      itemDefinitionId: addition.itemDefinitionId,
      quantityAdded: addition.quantity
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = (await this.dependencies.progression.find(actor.playerId)) ?? emptyProgression(actor.playerId, now);
      let award: XpAward;
      try {
        award = createXpAward(this.dependencies.progressionDefinition, stored, definition.xp, now);
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      }
      const result: ForestryChopResult = {
        ...harvest,
        state: projectForestryConstructionState(nextState, definition, now),
        progression: {
          xpAwarded: award.xpAwarded,
          leveledUp: award.leveledUp,
          progression: progressionView(this.dependencies.progressionDefinition, award.xpAfter)
        }
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: CHOP_FORESTRY_CONSTRUCTION_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: construction.id,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: now
      };
      try {
        await this.dependencies.settlement.settleChopAtomically(state, nextState, addition, award, record);
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "PROGRESSION_CONFLICT") continue;
        const raced = await this.dependencies.idempotency.find(actor.playerId, CHOP_FORESTRY_CONSTRUCTION_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        throw error;
      }
    }
    throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
  }

  private replay(record: IdempotencyRecord, fingerprint: string): ForestryChopResult {
    if (record.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
    try {
      const value = JSON.parse(record.responseJson) as ForestryChopResult;
      if (value.constructionId !== record.resourceId || typeof value.itemDefinitionId !== "string" || !Number.isSafeInteger(value.quantityAdded) || value.quantityAdded <= 0) throw new Error("invalid forestry result");
      assertStoredXpAward(value.progression);
      return value;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored forestry result is invalid");
    }
  }
}

