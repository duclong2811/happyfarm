import { DomainError } from "./errors";
import { WORK_AREA_KINDS, type WorkAreaKind } from "./work-area";
import type { ActorId, FarmId, JobId, WorkAreaId } from "./ids";

/**
 * A Job: the *configuration* of work an actor should do, in an area, for a target.
 *
 * It answers four questions and nothing else:
 *
 * ```text
 * WHO?       actor_id
 * WHERE?     work_area_id          a player-named group of cells
 * WHAT?      kind + target         a profession and a stable game-data id
 * ORDER?     priority             deterministic, 1 = first
 * ```

 *
 * **A Job is not an execution.** Creating one plants nothing, harvests nothing, moves nobody, and
 * writes no inventory, experience or gold. It is a durable statement of intent that a future executor
 * may act on; until that executor exists, a job is inert configuration. Every slice that touches this
 * file must keep that true.
 */

/**
 * The professions a job may name - the *same* vocabulary a Work Area is named with.
 *
 * Sharing the list is the compatibility rule: a FARM job's area must be a FARM area because a job and
 * its area are describing the same work in the same words. There is no MIXED, and there are no
 * element, level or specialisation restrictions.
 */
export const JOB_KINDS = WORK_AREA_KINDS;
export type JobKind = WorkAreaKind;

export function parseJobKind(value: string): JobKind {
  if (!(JOB_KINDS as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_JOB", "Job kind is not recognised");
  }
  return value as JobKind;
}

/** How many jobs one actor may hold. Bounded so a list read and a future executor stay small. */
export const MAX_JOBS_PER_ACTOR = 24;

/**
 * The game-data namespace a job's target must come from, by profession.
 *
 * A FARM job names a crop, an ORCHARD job a tree, and a MINING or FORESTRY job a resource - the
 * definitions the world already ships. `LIVESTOCK` and `AQUACULTURE` are deliberately **absent**:
 * there is no livestock system or aquaculture automation. `FISHERY` is separate: it names wild
 * fishing spots and never aliases the future aquaculture source.
 */
export const JOB_TARGET_PREFIXES: Readonly<Partial<Record<JobKind, string>>> = {
  FARM: "crop_",
  ORCHARD: "tree_",
  FORESTRY: "resource_",
  MINING: "resource_",
  FISHERY: "spot_"
};

/** Whether this profession has any target the game can validate today. */
export function jobKindSupportsTargets(kind: JobKind): boolean {
  return JOB_TARGET_PREFIXES[kind] !== undefined;
}

export function jobTargetPrefix(kind: JobKind): string | null {
  return JOB_TARGET_PREFIXES[kind] ?? null;
}

/**
 * Whether a target id is even the right *shape* for the profession.
 *
 * The shape check is the domain's; whether the definition actually exists is the application's, read
 * from the same catalogue the world is served from. Both must pass, and neither is a client claim.
 */
export function jobTargetFitsShape(kind: JobKind, targetDefinitionId: string): boolean {
  const prefix = jobTargetPrefix(kind);
  return prefix !== null && targetDefinitionId.startsWith(prefix);
}

export interface ActorJob {
  readonly id: JobId;
  readonly actorId: ActorId;
  /** The farm the work belongs to: the authorization root a route scopes by. */
  readonly farmId: FarmId;
  readonly workAreaId: WorkAreaId;
  readonly kind: JobKind;
  /** A stable game-data id (`crop_*`, `tree_*`, `resource_*`, `spot_*`), never a translated label. */
  readonly targetDefinitionId: string;
  readonly executionMode?: "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
  /** 1 is first. Dense and contiguous across one actor's jobs, which reordering keeps true. */
  readonly priority: number;
  readonly enabled: boolean;
  /**
   * Whether Auto may buy this assignment's missing input.
   *
   * A policy, not a fact: the resolver uses it to choose between "buy the shortage" and "wait for
   * supply". Default false, so an assignment never starts spending gold because a build shipped.
   */
  readonly autoPurchaseSupplies: boolean;
  /**
   * Whether this assignment may fund a missing supply by selling from the player's whitelist.
   *
   * Off unless the player turned it on for this assignment, so every existing assignment keeps the
   * behavior it had. The whitelist itself lives in `auto_funding_items` and is read only when Gold is
   * actually short.
   */
  readonly autoFundingEnabled: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A job belongs where its area does: the kind is the whole compatibility rule. */
export function jobKindMatchesArea(kind: JobKind, areaKind: WorkAreaKind): boolean {
  return kind === areaKind;
}

/** The dense priority list a reorder or an insert produces: 1..count. */
export function prioritiesFor(count: number): readonly number[] {
  if (!Number.isInteger(count) || count < 0 || count > MAX_JOBS_PER_ACTOR) {
    throw new DomainError("INVALID_JOB", "Job count is out of range");
  }
  return Array.from({ length: count }, (_value, index) => index + 1);
}

/**
 * The order a reorder produces, or a refusal.
 *
 * The client sends the order it wants as a list of ids; the server accepts it only when it is exactly
 * a permutation of the actor's current jobs - every id present, none repeated, none invented. That is
 * what makes "no duplicate, no gap, no corruption" a property of the write rather than a hope about
 * the client, and it is why the stored priorities can then simply be 1..N.
 */
export function planJobReorder(
  currentIds: readonly JobId[],
  requestedIds: readonly JobId[]
): readonly JobId[] {
  if (requestedIds.length !== currentIds.length) {
    throw new DomainError("JOB_REORDER_MISMATCH", "The order must list every job exactly once");
  }
  const current = new Set(currentIds);
  const seen = new Set<string>();
  for (const id of requestedIds) {
    if (!current.has(id) || seen.has(id)) {
      throw new DomainError("JOB_REORDER_MISMATCH", "The order must list every job exactly once");
    }
    seen.add(id);
  }
  return [...requestedIds];
}

/** Refuses an edit made against a version the job has already moved past. */
export function assertJobVersion(job: Pick<ActorJob, "version">, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || job.version !== expectedVersion) {
    throw new DomainError("CONFLICT_STALE_STATE", "Job changed since it was read");
  }
}

/** Refuses an edit made against an actor version that has already moved past. */
export function assertActorVersion(
  actor: { readonly version: number },
  expectedVersion: number
): void {
  if (!Number.isInteger(expectedVersion) || actor.version !== expectedVersion) {
    throw new DomainError("CONFLICT_STALE_STATE", "Actor changed since it was read");
  }
}

/**
 * The priority a newly created job takes: after every existing one.
 *
 * Measured against the priorities that exist rather than against how many there are. A delete
 * renumbers the survivors so the two agree, and this is the belt to that braces: even if a gap ever
 * survived, an append can never collide with a job that is already there.
 */
export function nextJobPriority(priorities: readonly number[]): number {
  if (priorities.length >= MAX_JOBS_PER_ACTOR) {
    throw new DomainError("INVALID_JOB", "This actor already holds as many jobs as it can");
  }
  return priorities.reduce((highest, priority) => Math.max(highest, priority), 0) + 1;
}
