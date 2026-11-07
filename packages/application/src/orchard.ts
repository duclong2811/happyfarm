import {
  calculateAppleOrchardCapacity,
  type FarmId,
  type JobId,
  type OrchardTreeCandidate
} from "@happy-farm/domain";
import type { ActorContext, ActorJobRepository, FarmMemberRepository, OrchardProductionBindingRepository, TreeDefinitionRepository, TreeInstanceRepository, WorkAreaRepository, Clock, FarmRepository } from "./ports";
import { ApplicationError } from "./errors";
import { requireOwnedFarm } from "./jobs";

export interface EnsureOrchardProductionBindingDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly jobs: ActorJobRepository;
  readonly workAreas: WorkAreaRepository;
  readonly trees: TreeInstanceRepository;
  readonly treeDefinitions: TreeDefinitionRepository;
  readonly bindings: OrchardProductionBindingRepository;
  readonly clock: Clock;
}

export class EnsureOrchardProductionBinding {
  constructor(private readonly dependencies: EnsureOrchardProductionBindingDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, actorJobId: JobId) {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await this.dependencies.jobs.findById(actorJobId);
    if (job === null || job.farmId !== farmId) throw new ApplicationError("JOB_NOT_FOUND", "Job was not found");
    if (job.kind !== "ORCHARD" || job.targetDefinitionId !== "tree_apple" || job.executionMode !== "RATE_PRODUCTION") {
      throw new ApplicationError("INVALID_INPUT", "Only Apple Orchard rate assignments can be bound");
    }
    const area = await this.dependencies.workAreas.findById(job.workAreaId);
    if (area === null || area.farmId !== farmId || area.kind !== "ORCHARD") {
      throw new ApplicationError("WORK_AREA_NOT_FOUND", "Orchard work area was not found");
    }
    const definition = this.dependencies.treeDefinitions.findById("tree_apple" as never);
    if (definition === null) throw new ApplicationError("INVALID_INPUT", "Apple Tree definition is unavailable");
    const cells = await this.dependencies.workAreas.listCells(area.id);
    const trees = await this.dependencies.trees.listByFarm(farmId);
    const candidates: OrchardTreeCandidate[] = trees.map((tree) => ({
      tree,
      definition: this.dependencies.treeDefinitions.findById(tree.treeDefinitionId) ?? definition
    }));
    const activatedAt = this.dependencies.clock.now();
    const capacity = calculateAppleOrchardCapacity(cells, candidates, activatedAt);
    return this.dependencies.bindings.ensureAtomically({
      assignmentId: `production_assignment_${actorJobId}`,
      sourceId: `production_source_orchard_${actorJobId}`,
      farmId,
      actorId: job.actorId,
      actorJobId,
      workAreaId: area.id,
      ratePerHour: capacity.ratePerHour,
      activatedAt
    });
  }
}
