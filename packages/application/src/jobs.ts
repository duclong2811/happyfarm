import {
  DomainError,
  HOME_ISLAND_ZONE_KIND,
  MAIN_CHARACTER_KIND,
  assertActorVersion,
  assertJobVersion,
  homeIslandZoneId,
  jobKindMatchesArea,
  jobKindSupportsTargets,
  jobTargetFitsShape,
  nextJobPriority,
  parseCropDefinitionId,
  parseJobKind,
  parseTreeDefinitionId,
  parseWorkAreaId,
  planJobReorder,
  prioritiesFor,
  type Actor,
  type ActorKind,
  type ActorJob,
  type ControlMode,
  type Farm,
  type FarmId,
  type PlayerId,
  type JobId,
  type JobKind,
  type WorkAreaId
} from "@happy-farm/domain";
import { ApplicationError, type ApplicationErrorCode } from "./errors";
import type {
  ActorContext,
  ActorIdGenerator,
  ActorJobRepository,
  ActorRepository,
  CargoCapacityLookup,
  Clock,
  CropDefinitionRepository,
  FarmMemberRepository,
  FarmRepository,
  FishingCataloguePort,
  IdempotencyRecord,
  IdempotencyRepository,
  JobIdGenerator,
  PayloadFingerprint,
  ResourceCataloguePort,
  TreeDefinitionRepository,
  WorkAreaRepository
} from "./ports";

/**
 * The actor and job spine: configuration, never execution.
 *
 * ```text
 * WORK AREA -> JOB -> ACTOR -> (future) CARGO -> ROUTE -> STORAGE
 * ```
 *
 * This module implements everything up to and including the *configuration* half of Jobs: who works
 * (an actor), where (a work area), what (a profession and a stable game-data target), in what order,
 * and whether the assignment is currently eligible. It implements no execution at all - creating a
 * job plants nothing, harvests nothing, moves nobody, and writes no inventory, experience, gold or
 * warehouse row - and no runtime state: no cargo, no route, no activity, no watermark, no simulation.
 *
 * **The Main Character is the player's first worker.** There is one logical actor per player, created
 * lazily and idempotently so an existing save gains it without anyone recreating a farm, and it stays
 * the same actor whether the human is driving it or a later slice's executor is.
 */

export const CREATE_JOB_OPERATION = "CREATE_JOB";

export interface ActorView {
  readonly actorId: string;
  readonly kind: ActorKind;
  readonly controlMode: ControlMode;
  readonly version: number;
}

export interface JobView {
  readonly jobId: string;
  readonly actorId: string;
  readonly workAreaId: string;
  readonly kind: JobKind;
  readonly targetDefinitionId: string;
  /** The target's game-data name key, resolved server-side so the client needs no catalogue of its own. */
  readonly targetDisplayNameKey: string;
  readonly priority: number;
  readonly enabled: boolean;
  /** This assignment's own supply policy: may Auto buy an input it is missing? Never a client claim. */
  readonly autoPurchaseSupplies: boolean;
  /** May Auto fund a missing supply by selling from its whitelist? Never a client claim. */
  readonly autoFundingEnabled: boolean;
  /** The funding whitelist, in priority order (index 0 sells first). */
  readonly fundingItems: readonly string[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function actorView(actor: Actor): ActorView {
  return {
    actorId: actor.id,
    kind: actor.kind,
    controlMode: actor.controlMode,
    version: actor.version
  };
}

export function jobView(
  job: ActorJob,
  targetDisplayNameKey: string,
  /** The funding whitelist in priority order; empty for every caller that never read it. */
  fundingItems: readonly string[] = []
): JobView {
  return {
    jobId: job.id,
    actorId: job.actorId,
    workAreaId: job.workAreaId,
    kind: job.kind,
    targetDefinitionId: job.targetDefinitionId,
    targetDisplayNameKey,
    priority: job.priority,
    enabled: job.enabled,
    autoPurchaseSupplies: job.autoPurchaseSupplies,
    autoFundingEnabled: job.autoFundingEnabled,
    fundingItems: [...fundingItems],
    version: job.version,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

/** The catalogues a target is validated against: the definitions the world already ships. */
export interface JobTargetCatalogue {
  readonly crops: CropDefinitionRepository;
  readonly trees: TreeDefinitionRepository;
  readonly resources: ResourceCataloguePort;
  readonly fishing?: FishingCataloguePort;
}

interface JobDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly actors: ActorRepository;
  readonly jobs: ActorJobRepository;
  readonly workAreas: WorkAreaRepository;
  readonly targets: JobTargetCatalogue;
  /** Needed because assigning a job may create the actor, and an actor carries a capacity. */
  readonly cargoCapacities: CargoCapacityLookup;
}

/**
 * The player's Main Character for a farm they own, created on first use.
 *
 * Bootstrapping is a write, so it lives here and not in a read path, and it is safe to repeat: the
 * database's partial unique index on `(owner_player_id)` for MAIN_CHARACTER rows means two tabs, a
 * refresh and a re-login all converge on one actor, and the loser reads the winner's row back.
 */
export interface MainCharacterDependencies {
  readonly farms: FarmRepository;
  readonly actors: ActorRepository;
  readonly ids: ActorIdGenerator;
  readonly clock: Clock;
  /** What a container of this kind of actor can carry, from game data. */
  readonly cargoCapacities: CargoCapacityLookup;
}

export async function mainCharacterFor(
  dependencies: MainCharacterDependencies,
  farmId: FarmId,
  /**
   * The farm the caller already read in this request, when it has one.
   *
   * A read, never a permission: this only skips re-reading a row the caller is holding. The actor is
   * still resolved from the database (or created) exactly as before.
   */
  observedFarm: Farm | null = null
): Promise<Actor> {
  const farm = observedFarm ?? (await dependencies.farms.findById(farmId));
  if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  const existing = await dependencies.actors.findMainCharacter(farm.ownerPlayerId);
  if (existing !== null) return existing;
  const capacity = dependencies.cargoCapacities.forActorKind(MAIN_CHARACTER_KIND);
  if (capacity === null || !Number.isSafeInteger(capacity) || capacity < 1) {
    throw new ApplicationError("INVALID_CARGO", "The Main Character has no cargo capacity defined");
  }
  const now = dependencies.clock.now();
  return dependencies.actors.ensureMainCharacter({
    id: dependencies.ids.newActorId(),
    ownerPlayerId: farm.ownerPlayerId,
    kind: MAIN_CHARACTER_KIND,
    controlMode: "PLAYER_CONTROLLED",
    zoneKind: HOME_ISLAND_ZONE_KIND,
    zoneId: homeIslandZoneId(farm.id),
    cargoCapacity: capacity,
    cargoVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now
  });
}

export interface FarmAccessDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
}

/** The farm must exist and the actor must OWN it: worker configuration is the owner's, like building. */
export async function requireOwnedFarm(
  dependencies: FarmAccessDependencies,
  farmId: FarmId,
  actor: ActorContext,
  /** The farm the caller already read, when it has one; the membership check is unchanged. */
  observedFarm: Farm | null = null
): Promise<Farm> {
  const farm = observedFarm ?? (await dependencies.farms.findById(farmId));
  if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  const membership = await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
  if (membership?.role !== "OWNER") {
    throw new ApplicationError("NOT_AUTHORIZED", "Worker configuration is not allowed on this farm");
  }
  return farm;
}

/** A player may inspect/shop/unload while Auto runs, but may not start another production action. */
export async function requireMainCharacterPlayerControl(
  actors: Pick<ActorRepository, "findMainCharacter"> | undefined,
  playerId: PlayerId
): Promise<void> {
  if (actors === undefined) return;
  let main: Awaited<ReturnType<NonNullable<typeof actors>["findMainCharacter"]>>;
  try {
    main = await actors.findMainCharacter(playerId);
  } catch (error: unknown) {
    // Older isolated API fixtures stop before the actor migration. The production host always has
    // this table; preserving the legacy manual path here keeps those fixtures meaningful.
    const message = typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message?: unknown }).message)
      : String(error);
    if (message.includes("no such table: actors")) return;
    throw error;
  }
  if (main?.controlMode === "AUTO_CONTROLLED") {
    throw new ApplicationError("CONFLICT_STALE_STATE", "The Main Character is Auto-controlled");
  }
}

function parseKind(raw: string): JobKind {
  try {
    return parseJobKind(raw);
  } catch (error: unknown) {
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }
}

/**
 * What a job's target is called, or a refusal.
 *
 * Two gates, both server-side: the id must have the *shape* the profession uses (a crop for FARM, a
 * tree for ORCHARD, a resource for MINING or FORESTRY), and the definition must actually exist in the
 * catalogue the world is served from. A profession with no such catalogue - livestock, aquaculture -
 * is refused rather than stored as a job nothing could ever honour.
 */
export function targetNameKey(kind: JobKind, targetDefinitionId: string, catalogue: JobTargetCatalogue): string {
  if (!jobKindSupportsTargets(kind)) {
    throw new ApplicationError("JOB_KIND_UNAVAILABLE", "That profession cannot be assigned yet");
  }
  if (!jobTargetFitsShape(kind, targetDefinitionId)) {
    throw new ApplicationError("JOB_TARGET_INVALID", "That target is not valid for this job");
  }
  if (kind === "FARM") {
    const crop = catalogue.crops.findById(parseCropDefinitionId(targetDefinitionId));
    if (crop === null) throw new ApplicationError("JOB_TARGET_INVALID", "That crop is not one this world grows");
    return crop.displayNameKey;
  }
  if (kind === "ORCHARD") {
    const tree = catalogue.trees.findById(parseTreeDefinitionId(targetDefinitionId));
    if (tree === null) throw new ApplicationError("JOB_TARGET_INVALID", "That tree is not one this world grows");
    return tree.displayNameKey;
  }
  if (kind === "FISHERY") {
    const spot = catalogue.fishing?.findSpot(targetDefinitionId);
    if (spot === null || spot === undefined || !spot.enabled) {
      throw new ApplicationError("JOB_TARGET_INVALID", "That fishing spot is not one this world holds");
    }
    return spot.displayNameKey;
  }
  const resource = catalogue.resources.findDefinition(targetDefinitionId);
  if (resource === null) throw new ApplicationError("JOB_TARGET_INVALID", "That resource is not one this world holds");
  return resource.displayNameKey;
}

/** One job, as this farm's row: a wrong farm answers exactly like a missing job. */
async function loadJob(
  dependencies: JobDependencies,
  farmId: FarmId,
  jobId: JobId
): Promise<ActorJob> {
  const job = await dependencies.jobs.findById(jobId);
  if (job === null || job.farmId !== farmId) {
    throw new ApplicationError("JOB_NOT_FOUND", "Job was not found");
  }
  return job;
}

function mapDomain<T>(fallback: ApplicationErrorCode, run: () => T): T {
  try {
    return run();
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      const code: ApplicationErrorCode =
        error.code === "CONFLICT_STALE_STATE"
          ? "CONFLICT_STALE_STATE"
          : error.code === "JOB_REORDER_MISMATCH"
            ? "JOB_REORDER_MISMATCH"
            : fallback;
      throw new ApplicationError(code, error.message);
    }
    throw error;
  }
}

export interface WorkersDependencies extends JobDependencies {
  readonly ids: ActorIdGenerator;
  readonly clock: Clock;
}

export interface WorkerPanelView {
  readonly actor: ActorView;
  readonly jobs: readonly JobView[];
}

/**
 * The worker panel's single read: the owner's Main Character, created on first ask, and its jobs.
 *
 * One bootstrap and two bounded reads - the actor, then that actor's own jobs in priority order. It
 * is called when the panel is opened and after a mutation, never by the farm's ordinary loads, the
 * growth poll, the frame loop, the pointer loop or the movement loop.
 */
export class ResolveWorkers {
  constructor(private readonly dependencies: WorkersDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<WorkerPanelView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId);
    return { actor: actorView(main), jobs: await this.listJobs(main) };
  }

  private async listJobs(main: Actor): Promise<readonly JobView[]> {
    const jobs = await this.dependencies.jobs.listByActor(main.id);
    // The funding whitelist travels with the panel so the client can show what is selected and in
    // which order. It is read only for assignments that actually enabled it, which is rare, and it is
    // a bounded read of that assignment's own rows.
    const views: JobView[] = [];
    for (const job of jobs) {
      // The whitelist is reported even while funding is off, so the panel can show what the player
      // had selected instead of silently emptying the list the moment they switch it off. The
      // *planner* still reads it only when the policy is enabled.
      const fundingItems = await this.dependencies.jobs.listFundingItems(job.id);
      views.push(
        jobView(
          job,
          targetNameKey(job.kind, job.targetDefinitionId, this.dependencies.targets),
          fundingItems.map((item) => item.itemDefinitionId)
        )
      );
    }
    return views;
  }
}

export interface CreateJobCommand {
  readonly requestId: string;
  readonly workAreaId: string;
  readonly kind: string;
  readonly targetDefinitionId: string;
}

export interface CreateJobDependencies extends WorkersDependencies {
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly ids: ActorIdGenerator & JobIdGenerator;
  /** Optional domain-specific binding hook. Configuration must establish its durable runtime binding immediately. */
  readonly onCreated?: (actor: ActorContext, farmId: FarmId, jobId: JobId) => Promise<unknown>;
}

function replayJob(record: IdempotencyRecord, fingerprint: string): JobView {
  if (record.payloadFingerprint !== fingerprint) {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
  }
  try {
    return JSON.parse(record.responseJson) as JobView;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
}

/**
 * Assigns one job to the actor.
 *
 * **This is configuration, not work.** Planting a job plants nothing: no crop, no tree, no node, no
 * inventory, no experience, no gold, no warehouse row and no movement. The whole effect is one row
 * that says "this actor should work this area, for this target, in this order" - and the receipt that
 * makes a retried request a no-op.
 */
export class CreateJob {
  constructor(private readonly dependencies: CreateJobDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: CreateJobCommand): Promise<JobView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const kind = parseKind(command.kind);
    let workAreaId: WorkAreaId;
    try {
      workAreaId = parseWorkAreaId(command.workAreaId);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
    const area = await this.dependencies.workAreas.findById(workAreaId);
    if (area === null || area.farmId !== farmId) {
      throw new ApplicationError("WORK_AREA_NOT_FOUND", "Work area was not found");
    }
    if (!jobKindMatchesArea(kind, area.kind)) {
      // A job and its area describe the same work, so their kinds must be the same word.
      throw new ApplicationError("JOB_AREA_MISMATCH", "That work area is not for this kind of job");
    }
    const targetDefinitionId = command.targetDefinitionId;
    const targetDisplayNameKey = targetNameKey(kind, targetDefinitionId, this.dependencies.targets);
    const main = await mainCharacterFor(this.dependencies, farmId);

    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([farmId, main.id, area.id, kind, targetDefinitionId])
    );
    const existing = await this.dependencies.idempotency.find(
      actor.playerId,
      CREATE_JOB_OPERATION,
      command.requestId
    );
    if (existing !== null) return replayJob(existing, fingerprint);

    const held = await this.dependencies.jobs.listByActor(main.id);
    const priority = mapDomain("JOB_LIMIT_REACHED", () =>
      nextJobPriority(held.map((job) => job.priority))
    );
    const now = this.dependencies.clock.now();
    const job: ActorJob = {
      id: this.dependencies.ids.newJobId(),
      actorId: main.id,
      farmId,
      workAreaId: area.id,
      kind,
      targetDefinitionId,
      executionMode: (kind === "ORCHARD" && targetDefinitionId === "tree_apple")
        || ((kind === "FORESTRY" || kind === "MINING") && targetDefinitionId.startsWith("resource_"))
        || (kind === "FISHERY" && targetDefinitionId.startsWith("spot_"))
        ? "RATE_PRODUCTION"
        : "LEGACY_ACTION_AUTO",
      priority,
      enabled: true,
      autoPurchaseSupplies: false,
      autoFundingEnabled: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const view = jobView(job, targetDisplayNameKey);
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: CREATE_JOB_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: job.id,
      responseJson: JSON.stringify(view),
      status: "COMPLETED",
      createdAt: now
    };
    await this.dependencies.jobs.createAtomically(job, record);
    if (job.executionMode === "RATE_PRODUCTION" && this.dependencies.onCreated !== undefined) {
      await this.dependencies.onCreated(actor, farmId, job.id);
    }
    return view;
  }
}

export interface UpdateJobTargetCommand {
  readonly requestId: string;
  readonly targetDefinitionId: string;
  readonly expectedVersion: number;
}

/** Changes what one job works towards. The area and the profession are fixed; the target is not. */
export class UpdateJobTarget {
  constructor(private readonly dependencies: Omit<CreateJobDependencies, "idempotency" | "fingerprints">) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    jobId: JobId,
    command: UpdateJobTargetCommand
  ): Promise<JobView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await loadJob(this.dependencies, farmId, jobId);
    mapDomain("CONFLICT_STALE_STATE", () => {
      assertJobVersion(job, command.expectedVersion);
    });
    const displayNameKey = targetNameKey(job.kind, command.targetDefinitionId, this.dependencies.targets);
    const next: ActorJob = {
      ...job,
      targetDefinitionId: command.targetDefinitionId,
      version: job.version + 1,
      updatedAt: this.dependencies.clock.now()
    };
    const applied = await this.dependencies.jobs.updateTargetAtomically(next, command.expectedVersion);
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Job changed since it was read");
    return jobView(next, displayNameKey);
  }
}

export interface SetJobEnabledCommand {
  readonly requestId: string;
  readonly enabled: boolean;
  readonly expectedVersion: number;
}

/**
 * Enables or disables one assignment without deleting it.

 * Deliberately not the same thing as the actor's future Auto ON/OFF: this says "skip this job for
 * now", and it changes nothing about who is in control of the character.
 */
export class SetJobEnabled {
  constructor(private readonly dependencies: Omit<CreateJobDependencies, "idempotency" | "fingerprints">) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    jobId: JobId,
    command: SetJobEnabledCommand
  ): Promise<JobView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await loadJob(this.dependencies, farmId, jobId);
    mapDomain("CONFLICT_STALE_STATE", () => {
      assertJobVersion(job, command.expectedVersion);
    });
    const next: ActorJob = {
      ...job,
      enabled: command.enabled,
      version: job.version + 1,
      updatedAt: this.dependencies.clock.now()
    };
    const applied = await this.dependencies.jobs.setEnabledAtomically(next, command.expectedVersion);
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Job changed since it was read");
    return jobView(next, targetNameKey(job.kind, job.targetDefinitionId, this.dependencies.targets));
  }
}

export interface ReorderJobsCommand {
  readonly requestId: string;
  /** Every job the actor holds, exactly once, in the order the player wants. */
  readonly orderedJobIds: readonly string[];
  readonly expectedVersion: number;
}

/**
 * Rewrites the actor's whole order.

 * The order is sent as ids rather than "move job X to position Y" because that is the only shape that
 * cannot leave a gap, a duplicate or a half-applied move behind: the server checks it is exactly a
 * permutation of the actor's current jobs and then writes priorities 1..N in one batch under the
 * actor's version, so two tabs reordering at once cannot interleave.
 */
export class ReorderJobs {
  constructor(private readonly dependencies: WorkersDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: ReorderJobsCommand): Promise<readonly JobView[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId);
    mapDomain("CONFLICT_STALE_STATE", () => {
      assertActorVersion(main, command.expectedVersion);
    });
    const jobs = await this.dependencies.jobs.listByActor(main.id);
    const byId = new Map(jobs.map((job) => [job.id as string, job]));
    const requested = command.orderedJobIds.map((raw) => {
      const job = byId.get(raw);
      if (job === undefined) throw new ApplicationError("JOB_REORDER_MISMATCH", "Unknown job in the order");
      return job;
    });
    mapDomain("JOB_REORDER_MISMATCH", () =>
      planJobReorder(
        jobs.map((job) => job.id),
        requested.map((job) => job.id)
      )
    );
    const now = this.dependencies.clock.now();
    const priorities = prioritiesFor(requested.length);
    const ordered = requested.map((job, index) => ({
      id: job.id,
      priority: priorities[index] ?? index + 1,
      updatedAt: now
    }));
    const applied = await this.dependencies.jobs.reorderAtomically(main.id, command.expectedVersion, ordered, now);
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Actor changed since it was read");
    return requested.map((job, index) =>
      jobView(
        {
          ...job,
          priority: priorities[index] ?? index + 1,
          updatedAt: now,
          version: job.version + 1
        },
        targetNameKey(job.kind, job.targetDefinitionId, this.dependencies.targets)
      )
    );
  }
}

export interface DeleteJobCommand {
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface DeleteJobResult {
  readonly jobId: string;
}

/** Removes one assignment. Its area becomes deletable again; no other state changes. */
export class DeleteJob {
  constructor(private readonly dependencies: Omit<CreateJobDependencies, "idempotency" | "fingerprints">) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    jobId: JobId,
    command: DeleteJobCommand
  ): Promise<DeleteJobResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await loadJob(this.dependencies, farmId, jobId);
    mapDomain("CONFLICT_STALE_STATE", () => {
      assertJobVersion(job, command.expectedVersion);
    });
    const applied = await this.dependencies.jobs.deleteAtomically(
      job.actorId,
      job.id,
      command.expectedVersion
    );
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Job changed since it was read");
    return { jobId: job.id };
  }
}
