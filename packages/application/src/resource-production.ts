import {
  isResourceAvailable,
  requiredGroundCapability,
  resourceAvailableAt,
  workAreaCellKey,
  type ActorJob,
  type FarmId,
  type JobId,
  type ProductionAssignmentSnapshot
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import { requireOwnedFarm } from "./jobs";
import type {
  ActorContext,
  ActorJobRepository,
  FarmMemberRepository,
  FarmRepository,
  ResourceCataloguePort,
  ResourceNodeStateRepository,
  ResourceProductionBinding,
  ResourceProductionBindingRepository,
  WorkAreaGroundLookup,
  WorkAreaRepository,
  Clock
} from "./ports";

type ResourceProductionJob = ActorJob & { readonly kind: "FORESTRY" | "MINING" };

function verbForJob(job: ResourceProductionJob): "CHOP" | "MINE" {
  return job.kind === "FORESTRY" ? "CHOP" : "MINE";
}

function sourceFamilyForJob(job: ResourceProductionJob): "FORESTRY" | "MINING" {
  return job.kind;
}

function isResourceProductionJob(job: ActorJob): job is ResourceProductionJob {
  return (job.kind === "FORESTRY" || job.kind === "MINING")
    && job.executionMode === "RATE_PRODUCTION"
    && job.targetDefinitionId.startsWith("resource_");
}

export interface ResourceProductionNodeContext {
  readonly nodeId: string;
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly expectedAvailableAt: string | null;
  readonly expectedVersion: number | null;
  readonly regenerationSeconds: number;
}

export interface ResourceProductionContext {
  readonly sourceRatePerHour: number;
  readonly continuousLabor: boolean;
  readonly availableNodes: readonly ResourceProductionNodeContext[];
}

interface ResourceProductionDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly jobs: ActorJobRepository;
  readonly workAreas: WorkAreaRepository;
  readonly catalogue: ResourceCataloguePort;
  readonly states: ResourceNodeStateRepository;
  readonly ground: WorkAreaGroundLookup;
  readonly clock: Clock;
}

async function eligibleResourceNodes(
  dependencies: ResourceProductionDependencies,
  job: ResourceProductionJob,
  now: string
): Promise<{ readonly outputItemDefinitionId: string; readonly context: ResourceProductionContext }> {
  const area = await dependencies.workAreas.findById(job.workAreaId);
  if (area === null || area.farmId !== job.farmId || area.kind !== job.kind) {
    throw new ApplicationError("WORK_AREA_NOT_FOUND", "The resource work area was not found");
  }
  if (requiredGroundCapability(area.kind) !== (job.kind === "FORESTRY" ? "FORESTRY" : "MINING")) {
    throw new ApplicationError("INVALID_INPUT", "The resource work area has the wrong ground capability");
  }
  const definition = dependencies.catalogue.findDefinition(job.targetDefinitionId);
  if (definition === null || definition.verb !== verbForJob(job)) {
    throw new ApplicationError("INVALID_INPUT", "The resource target is not compatible with this work skill");
  }
  const table = dependencies.catalogue.findDropTable(definition.dropTableId);
  if (table === null || table.entries.length !== 1 || table.entries[0]?.minQuantity !== table.entries[0]?.maxQuantity) {
    throw new ApplicationError("INVALID_INPUT", "The resource target needs one deterministic production output");
  }

  const cells = new Set((await dependencies.workAreas.listCells(area.id)).map(workAreaCellKey));
  const states = await dependencies.states.listByZone(area.zoneId);
  const stateByNode = new Map(states.map((state) => [state.nodeId, state]));
  const candidates: ResourceProductionNodeContext[] = [];
  for (const node of dependencies.catalogue.listNodes()) {
    if (node.zoneKind !== area.zoneKind || node.definitionId !== definition.id) continue;
    const cellKey = workAreaCellKey({ x: Math.round(node.position.x), y: Math.round(node.position.y) });
    if (!cells.has(cellKey)) continue;
    if (!dependencies.ground.capabilitiesAt({ x: Math.round(node.position.x), y: Math.round(node.position.y) }).includes(requiredGroundCapability(area.kind))) continue;
    const state = stateByNode.get(node.id);
    // Unified ore is a durable work anchor. It must not inherit the legacy depletion window, or a
    // second actor would be paid from a node cooldown instead of from labour time.
    if (definition.settlementMode !== "CONTINUOUS_LABOR" && !isResourceAvailable(state?.availableAt ?? null, now)) continue;
    candidates.push({
      nodeId: node.id,
      zoneKind: node.zoneKind,
      zoneId: area.zoneId,
      expectedAvailableAt: state?.availableAt ?? null,
      expectedVersion: state?.version ?? null,
      regenerationSeconds: definition.regenerationSeconds
    });
  }
  return {
    outputItemDefinitionId: table.entries[0]?.itemDefinitionId ?? "",
    context: {
      sourceRatePerHour: definition.settlementMode === "CONTINUOUS_LABOR"
        ? (candidates.length === 0 ? 0 : definition.productionUnitsPerHour)
        : candidates.length * definition.productionUnitsPerHour,
      continuousLabor: definition.settlementMode === "CONTINUOUS_LABOR",
      availableNodes: candidates
    }
  };
}

export interface EnsureResourceProductionBindingDependencies extends ResourceProductionDependencies {
  readonly bindings: ResourceProductionBindingRepository;
}

/** Establishes the durable Forestry/Mining binding at job creation, with no economic mutation. */
export class EnsureResourceProductionBinding {
  constructor(private readonly dependencies: EnsureResourceProductionBindingDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, actorJobId: JobId): Promise<ResourceProductionBinding> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await this.dependencies.jobs.findById(actorJobId);
    if (job === null || job.farmId !== farmId) throw new ApplicationError("JOB_NOT_FOUND", "Job was not found");
    if (!isResourceProductionJob(job)) {
      throw new ApplicationError("INVALID_INPUT", "Only Forestry and Mining rate assignments can be bound");
    }
    const resolved = await eligibleResourceNodes(this.dependencies, job, this.dependencies.clock.now());
    return this.dependencies.bindings.ensureAtomically({
      assignmentId: `production_assignment_${actorJobId}`,
      sourceId: `production_source_${sourceFamilyForJob(job).toLowerCase()}_${actorJobId}`,
      sourceFamily: sourceFamilyForJob(job),
      outputItemDefinitionId: resolved.outputItemDefinitionId,
      farmId,
      actorId: job.actorId,
      actorJobId,
      workAreaId: job.workAreaId,
      ratePerHour: resolved.context.sourceRatePerHour,
      activatedAt: this.dependencies.clock.now()
    });
  }
}

/** Re-reads the bounded area/node state before every settlement so manual and automated work share it. */
export class ResolveResourceProductionContext {
  constructor(private readonly dependencies: ResourceProductionDependencies) {}

  async execute(assignment: ProductionAssignmentSnapshot & { readonly actorJobId?: JobId }, now: string): Promise<ResourceProductionContext | null> {
    if (assignment.actorJobId === undefined) return null;
    const job = await this.dependencies.jobs.findById(assignment.actorJobId);
    if (job === null || !isResourceProductionJob(job)) return null;
    return (await eligibleResourceNodes(this.dependencies, job, now)).context;
  }
}

export function resourceNodeDepletions(
  context: ResourceProductionContext,
  settledAt: string
): readonly {
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly nodeId: string;
  readonly expectedAvailableAt: string | null;
  readonly expectedVersion: number | null;
  readonly availableAt: string;
  readonly depletedAt: string;
  readonly nextVersion: number;
}[] {
  return context.availableNodes.map((node) => ({
    zoneKind: node.zoneKind,
    zoneId: node.zoneId,
    nodeId: node.nodeId,
    expectedAvailableAt: node.expectedAvailableAt,
    expectedVersion: node.expectedVersion,
    availableAt: resourceAvailableAt(settledAt, node.regenerationSeconds),
    depletedAt: settledAt,
    nextVersion: node.expectedVersion === null ? 1 : node.expectedVersion + 1
  }));
}

