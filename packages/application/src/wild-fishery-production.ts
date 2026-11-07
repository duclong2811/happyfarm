import {
  consumeFishingStock,
  fishingStockAt,
  requiredGroundCapability,
  selectCatch,
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
  Clock,
  FarmMemberRepository,
  FarmRepository,
  FishingCataloguePort,
  FishingRandomPort,
  FishingSpotStateRepository,
  WildFisheryProductionBinding,
  WildFisheryProductionBindingRepository,
  WorkAreaGroundLookup,
  WorkAreaRepository
} from "./ports";

type WildFisheryJob = ActorJob & { readonly kind: "FISHERY" };

function isWildFisheryJob(job: ActorJob): job is WildFisheryJob {
  return job.kind === "FISHERY" && job.executionMode === "RATE_PRODUCTION" && job.targetDefinitionId.startsWith("spot_");
}

interface WildFisheryDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly jobs: ActorJobRepository;
  readonly workAreas: WorkAreaRepository;
  readonly catalogue: FishingCataloguePort;
  readonly states: FishingSpotStateRepository;
  readonly ground: WorkAreaGroundLookup;
  readonly clock: Clock;
  readonly random: FishingRandomPort;
}

export interface WildFisherySpotContext {
  readonly sourceRatePerHour: number;
  readonly availableStock: number;
  readonly spotId: string;
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly expectedStock: number;
  readonly expectedLastRegeneratedAt: string | null;
  readonly expectedVersion: number | null;
  readonly regenerationSeconds: number;
}

async function resolveSpot(dependencies: WildFisheryDependencies, job: WildFisheryJob, now: string): Promise<WildFisherySpotContext> {
  const area = await dependencies.workAreas.findById(job.workAreaId);
  if (area === null || area.farmId !== job.farmId || area.kind !== "FISHERY") {
    throw new ApplicationError("WORK_AREA_NOT_FOUND", "The fishery work area was not found");
  }
  const spot = dependencies.catalogue.findSpot(job.targetDefinitionId);
  if (spot === null || !spot.enabled) throw new ApplicationError("JOB_TARGET_INVALID", "The fishing target is unavailable");
  const table = dependencies.catalogue.findTable(spot.tableId);
  if (table === null || table.entries.length === 0) throw new ApplicationError("INVALID_INPUT", "The fishing spot has no catch table");
  const cells = new Set((await dependencies.workAreas.listCells(area.id)).map(workAreaCellKey));
  const cell = { x: Math.round(spot.position.x), y: Math.round(spot.position.y) };
  if (!cells.has(workAreaCellKey(cell)) || !dependencies.ground.capabilitiesAt(cell).includes(requiredGroundCapability("FISHERY"))) {
    return {
      sourceRatePerHour: 0, availableStock: 0, spotId: spot.id, zoneKind: area.zoneKind, zoneId: area.zoneId,
      expectedStock: 0, expectedLastRegeneratedAt: null, expectedVersion: null, regenerationSeconds: spot.regenerationSeconds
    };
  }
  const state = (await dependencies.states.listByZone(area.zoneKind, area.zoneId)).find((entry) => entry.spotId === spot.id) ?? null;
  const availableStock = fishingStockAt(state, spot.maxStock, spot.regenerationSeconds, now);
  return {
    sourceRatePerHour: availableStock > 0 ? spot.productionUnitsPerHour : 0,
    availableStock,
    spotId: spot.id,
    zoneKind: area.zoneKind,
    zoneId: area.zoneId,
    expectedStock: state?.stock ?? spot.maxStock,
    expectedLastRegeneratedAt: state?.lastRegeneratedAt ?? null,
    expectedVersion: state?.version ?? null,
    regenerationSeconds: spot.regenerationSeconds
  };
}

function outputForTable(catalogue: FishingCataloguePort, spotId: string, random: FishingRandomPort): string {
  const spot = catalogue.findSpot(spotId);
  if (spot === null) throw new ApplicationError("JOB_TARGET_INVALID", "The fishing spot was not found");
  const table = catalogue.findTable(spot.tableId);
  if (table === null) throw new ApplicationError("INVALID_INPUT", "The fishing table was not found");
  const fish = catalogue.findFish(selectCatch(table.entries, random.roll()).fishId);
  if (fish === null) throw new ApplicationError("INTERNAL_ERROR", "The fishing table names an unknown fish");
  return fish.itemDefinitionId;
}

export interface EnsureWildFisheryProductionBindingDependencies extends WildFisheryDependencies {
  readonly bindings: WildFisheryProductionBindingRepository;
}

export class EnsureWildFisheryProductionBinding {
  constructor(private readonly dependencies: EnsureWildFisheryProductionBindingDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, actorJobId: JobId): Promise<WildFisheryProductionBinding> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await this.dependencies.jobs.findById(actorJobId);
    if (job === null || job.farmId !== farmId) throw new ApplicationError("JOB_NOT_FOUND", "Job was not found");
    if (!isWildFisheryJob(job)) throw new ApplicationError("INVALID_INPUT", "Only wild fishery rate assignments can be bound");
    const resolved = await resolveSpot(this.dependencies, job, this.dependencies.clock.now());
    return this.dependencies.bindings.ensureAtomically({
      assignmentId: `production_assignment_${actorJobId}`,
      sourceId: `production_source_fishery_${actorJobId}`,
      outputItemDefinitionId: outputForTable(this.dependencies.catalogue, job.targetDefinitionId, this.dependencies.random),
      farmId,
      actorId: job.actorId,
      actorJobId,
      workAreaId: job.workAreaId,
      ratePerHour: resolved.sourceRatePerHour,
      initialStock: resolved.availableStock,
      activatedAt: this.dependencies.clock.now()
    });
  }
}

export class ResolveWildFisheryProductionContext {
  constructor(private readonly dependencies: WildFisheryDependencies) {}

  async execute(assignment: ProductionAssignmentSnapshot & { readonly actorJobId?: JobId }, now: string): Promise<WildFisherySpotContext | null> {
    if (assignment.actorJobId === undefined) return null;
    const job = await this.dependencies.jobs.findById(assignment.actorJobId);
    if (job === null || !isWildFisheryJob(job)) return null;
    return resolveSpot(this.dependencies, job, now);
  }
}

export function wildFisheryStockConsumption(
  context: WildFisherySpotContext,
  quantity: number,
  settledAt: string
): readonly [{
  readonly zoneKind: string; readonly zoneId: string; readonly spotId: string;
  readonly expectedStock: number; readonly expectedLastRegeneratedAt: string | null; readonly expectedVersion: number | null;
  readonly stock: number; readonly lastRegeneratedAt: string; readonly nextVersion: number;
}] {
  if (quantity <= 0) return [] as never;
  const next = consumeFishingStock(context.availableStock, quantity, settledAt);
  return [{
    zoneKind: context.zoneKind, zoneId: context.zoneId, spotId: context.spotId,
    expectedStock: context.expectedStock, expectedLastRegeneratedAt: context.expectedLastRegeneratedAt,
    expectedVersion: context.expectedVersion, stock: next.stock, lastRegeneratedAt: next.lastRegeneratedAt,
    nextVersion: context.expectedVersion === null ? 1 : context.expectedVersion + 1
  }];
}
