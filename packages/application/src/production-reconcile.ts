import type { FarmId, JobId, PlayerId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, ActorJobRepository, FarmMemberRepository, FarmRepository, ProductionAssignmentRepository, ProductionSourceRepository } from "./ports";
import type { SettleProductionAssignment, SettleProductionAssignmentResult } from "./production";

export interface ReconcileFarmProductionResult {
  readonly settlements: readonly SettleProductionAssignmentResult[];
  readonly producedItems: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
  readonly blocked: readonly { readonly assignmentId: string; readonly reason: string }[];
}

export class ReconcileFarmProduction {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly assignments: ProductionAssignmentRepository,
    private readonly sources: ProductionSourceRepository,
    private readonly settle: SettleProductionAssignment,
    private readonly jobs: ActorJobRepository,
    private readonly ensureOrchardBinding: (actor: ActorContext, farmId: FarmId, jobId: JobId) => Promise<unknown>
  ) {}

  async execute(playerId: PlayerId, farmId: FarmId, actor: ActorContext): Promise<ReconcileFarmProductionResult> {
    const farm = await this.farms.findById(farmId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.members.findByFarmAndPlayer(farmId, playerId);
    if (membership === null || membership.role === "VISITOR") throw new ApplicationError("NOT_AUTHORIZED", "The player cannot reconcile production on this farm");
    for (const job of await this.jobs.listByFarm(farmId)) {
      const isApple = job.kind === "ORCHARD" && job.targetDefinitionId === "tree_apple";
      const isResource = (job.kind === "FORESTRY" || job.kind === "MINING") && job.targetDefinitionId.startsWith("resource_");
      const isWildFishery = job.kind === "FISHERY" && job.targetDefinitionId.startsWith("spot_");
      // Unified ore is driven by the actor executor and lands in cargo. Do not also run the legacy
      // warehouse rate settlement during boot/offline reconciliation.
      const isContinuousLabor = job.kind === "MINING" && job.targetDefinitionId === "resource_ore";
      if ((isApple || (isResource && !isContinuousLabor) || isWildFishery) && job.executionMode === "RATE_PRODUCTION") {
        await this.ensureOrchardBinding(actor, farmId, job.id);
      }
    }
    const continuousJobIds = new Set(
      (await this.jobs.listByFarm(farmId))
        .filter((job) => job.kind === "MINING" && job.targetDefinitionId === "resource_ore")
        .map((job) => job.id)
    );
    const assignments = (await this.assignments.listByFarm(farmId)).filter(
      (assignment) => assignment.executionMode === "RATE_PRODUCTION" && (assignment.actorJobId === undefined || !continuousJobIds.has(assignment.actorJobId))
    );
    const settlements: SettleProductionAssignmentResult[] = [];
    const itemByAssignment = new Map<string, string>();
    for (const assignment of assignments) {
      const source = await this.sources.findByFarmAndId(farmId, assignment.sourceId);
      if (source === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Production source was not found");
      itemByAssignment.set(assignment.id, source.outputItemDefinitionId);
      settlements.push(await this.settle.execute({ playerId, farmId, assignmentId: assignment.id }));
    }
    const totals = new Map<string, number>();
    const blocked: { assignmentId: string; reason: string }[] = [];
    for (const settlement of settlements) {
      const item = itemByAssignment.get(settlement.assignmentId);
      if (item !== undefined && settlement.producedQuantity > 0) totals.set(item, (totals.get(item) ?? 0) + settlement.producedQuantity);
      if (settlement.blockedReason !== null) blocked.push({ assignmentId: settlement.assignmentId, reason: settlement.blockedReason });
    }
    return {
      settlements,
      producedItems: [...totals.entries()].map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity })),
      blocked
    };
  }
}
