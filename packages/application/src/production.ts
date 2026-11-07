import { ApplicationError } from "./errors";
import { resourceNodeDepletions, type ResolveResourceProductionContext } from "./resource-production";
import { wildFisheryStockConsumption, type ResolveWildFisheryProductionContext } from "./wild-fishery-production";
import { settleProduction, warehouseAvailable, type FarmId, type PlayerId } from "@happy-farm/domain";
import type {
  Clock, FarmMemberRepository, FarmRepository, InventoryRepository, ProductionAssignmentRepository,
  ProductionSettlementCommitter, ProductionSettlementPlan, ProductionSourceRepository, WarehouseRepository
} from "./ports";

export interface SettleProductionAssignmentInput {
  readonly playerId: PlayerId;
  readonly farmId: FarmId;
  readonly assignmentId: string;
  readonly requestId?: string;
}

export interface SettleProductionAssignmentResult {
  readonly assignmentId: string;
  readonly producedQuantity: number;
  readonly settledThrough: string;
  readonly blockedReason: string | null;
  readonly sourceDepleted: boolean;
  readonly sourceRemaining: number | null;
}

export class SettleProductionAssignment {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly assignments: ProductionAssignmentRepository,
    private readonly sources: ProductionSourceRepository,
    private readonly inventory: InventoryRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly committer: ProductionSettlementCommitter,
    private readonly clock: Clock,
    private readonly resourceContext?: ResolveResourceProductionContext,
    private readonly wildFisheryContext?: ResolveWildFisheryProductionContext
  ) {}

  async execute(input: SettleProductionAssignmentInput): Promise<SettleProductionAssignmentResult> {
    const farm = await this.farms.findById(input.farmId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.members.findByFarmAndPlayer(input.farmId, input.playerId);
    if (membership === null || membership.role === "VISITOR") {
      throw new ApplicationError("NOT_AUTHORIZED", "The player cannot settle production on this farm");
    }
    const assignment = await this.assignments.findByFarmAndId(input.farmId, input.assignmentId);
    if (assignment === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Production assignment was not found");
    if (assignment.executionMode !== "RATE_PRODUCTION") {
      throw new ApplicationError("INVALID_INPUT", "The assignment is not a rate-production assignment");
    }
    if (assignment.farmId !== input.farmId) throw new ApplicationError("NOT_AUTHORIZED", "Assignment farm does not match");
    const source = await this.sources.findByFarmAndId(input.farmId, assignment.sourceId);
    if (source === null || source.farmId !== input.farmId) throw new ApplicationError("RESOURCE_NOT_FOUND", "Production source was not found");
    const warehouse = await this.warehouses.find(input.playerId);
    if (warehouse === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Warehouse was not found");
    const item = await this.inventory.find(input.playerId, source.outputItemDefinitionId as never);
    const now = this.clock.now();
    const resource = this.resourceContext === undefined
      ? null
      : await this.resourceContext.execute(assignment, now);
    const fishery = this.wildFisheryContext === undefined
      ? null
      : await this.wildFisheryContext.execute(assignment, now);
    // Unified labor jobs settle through the actor executor so the reward lands in cargo and follows
    // the actor's travel/lease lifecycle. Keeping the old rate endpoint from paying them is the
    // central anti-duplication guard: a reconcile and an Auto mining step cannot both mint ore.
    if (resource?.continuousLabor === true) {
      throw new ApplicationError("INVALID_INPUT", "Continuous resource work must settle through the actor executor");
    }
    const effectiveSource = resource !== null
      ? { ...source, ratePerHour: resource.sourceRatePerHour }
      : fishery !== null
        ? { ...source, ratePerHour: fishery.sourceRatePerHour, remainingStock: fishery.availableStock }
        : source;
    let result = settleProduction({
      assignment, source: effectiveSource, serverNow: now, warehouseFreeCapacity: warehouseAvailable(warehouse)
    });
    // A depleted resource source is a real availability boundary, not hidden production backlog. Move
    // the cursor through the unavailable interval so a later regeneration starts at observation time.
    if (resource?.continuousLabor === false && resource.availableNodes.length === 0
      && result.producedQuantity === 0 && result.elapsedMs > 0
      && assignment.blockedReason !== "WAREHOUSE_FULL" && assignment.enabled && source.enabled) {
      result = {
        ...result,
        newCursor: now,
        newRemainder: assignment.productionRemainder,
        productiveElapsedMs: 0,
        blockedReason: "NOT_READY"
      };
    }
    if (fishery !== null && fishery.availableStock === 0
      && result.producedQuantity === 0 && result.elapsedMs > 0
      && assignment.blockedReason !== "WAREHOUSE_FULL" && assignment.enabled && source.enabled) {
      result = {
        ...result,
        newCursor: now,
        newRemainder: assignment.productionRemainder,
        productiveElapsedMs: 0,
        blockedReason: "NOT_READY"
      };
    }
    const settlementId = `production_${assignment.id}_${String(assignment.version)}_${assignment.settlementCursor.replaceAll(/[^0-9A-Za-z]/gu, "")}`;
    const plan: ProductionSettlementPlan = {
      playerId: input.playerId, assignmentId: assignment.id, farmId: input.farmId,
      expectedAssignmentVersion: assignment.version, expectedCursor: assignment.settlementCursor,
      expectedAssignmentEnabled: assignment.enabled, expectedSourceVersion: source.version,
      ...(resource === null ? {} : {
        expectedSourceRatePerHour: source.ratePerHour,
        nextSourceRatePerHour: resource.sourceRatePerHour,
        resourceNodeDepletions: result.producedQuantity > 0 ? resourceNodeDepletions(resource, now) : []
      }),
      ...(fishery === null ? {} : {
        expectedSourceRatePerHour: source.ratePerHour,
        nextSourceRatePerHour: fishery.sourceRatePerHour,
        nextSourceRemainingStock: result.newSourceRemainingStock,
        fishingSpotConsumptions: result.producedQuantity > 0 ? wildFisheryStockConsumption(fishery, result.producedQuantity, now) : []
      }),
      sourceId: source.id, finiteSource: source.kind === "FINITE", expectedSourceStock: source.remainingStock,
      itemDefinitionId: source.outputItemDefinitionId as never, expectedInventoryQuantity: item?.quantity ?? 0,
      expectedInventoryVersion: item?.version ?? 0, expectedWarehouseVersion: warehouse.version,
      expectedWarehouseUsed: warehouse.used, warehouseCapacity: warehouse.capacity, result,
      settlementId, settledAt: now, executionMode: "RATE_PRODUCTION"
    };
    const committed = await this.committer.settle(plan);
    return {
      assignmentId: assignment.id, producedQuantity: committed.result.producedQuantity,
      settledThrough: committed.result.newCursor, blockedReason: committed.result.blockedReason,
      sourceDepleted: committed.result.sourceDepleted, sourceRemaining: committed.result.newSourceRemainingStock
    };
  }
}
