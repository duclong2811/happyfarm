import type { ControlMode } from "./actor";
import { planFundingSale, type FundingCandidate, type FundingSale } from "./funding";
import type { JobId } from "./ids";
import { WORK_AREA_KINDS, type WorkAreaKind } from "./work-area";

/**
 * Work Skills: the *plan* the Auto engine makes, and nothing it does.
 *
 * A Work Skill is a complete repeating production lifecycle, not one action. `farm.rice` means
 * "maintain rice in this area": the skill decides whether the next step is to fetch seed, plant,
 * wait, harvest or haul, and the player only ever names the skill.
 *
 * Everything in this file is **pure**. `resolveNextAction` reads a snapshot and returns a plan; it
 * cannot write to the database, the wallet, the inventory, cargo, the world or movement. D1 plans and
 * explains; the slices after it execute.
 */

export const LIFECYCLE_FAMILIES = [
  "REPLANT_CROP",
  "PERENNIAL_PRODUCTION",
  "RESOURCE_NODE_GATHERING",
  "FISHING",
  "LIVESTOCK"
] as const;
export type LifecycleFamily = (typeof LIFECYCLE_FAMILIES)[number];

/** Which family a profession's work belongs to. The family is the reusable machine; the skill is data. */
export function familyForKind(kind: WorkAreaKind): LifecycleFamily {
  switch (kind) {
    case "FARM":
      return "REPLANT_CROP";
    case "ORCHARD":
      return "PERENNIAL_PRODUCTION";
    case "FORESTRY":
    case "MINING":
      return "RESOURCE_NODE_GATHERING";
    case "AQUACULTURE":
    case "FISHERY":
      return "FISHING";
    case "LIVESTOCK":
      return "LIVESTOCK";
  }
}

/**
 * A skill's stable id, derived from the assignment it describes.
 *
 * `(FARM, crop_rice)` -> `farm.rice`. Deriving it means the id can never drift from the pair, needs no
 * column, and cannot be spoofed by a client - which is why a `skill_id` column is earned only when two
 * skills share one pair, never by a rename.
 */
export function skillIdFor(kind: WorkAreaKind, targetDefinitionId: string): string {
  const short = targetDefinitionId.replace(/^(crop|tree|resource|animal|fish)_/u, "");
  return `${kind.toLowerCase()}.${short}`;
}

/** One skill definition: data, never execution code. */
export interface WorkSkillDefinition {
  readonly id: string;
  readonly kind: WorkAreaKind;
  readonly family: LifecycleFamily;
  readonly targetDefinitionId: string;
  /** What one plant consumes, when the family plants. */
  readonly inputItemDefinitionId: string | null;
  /** What a harvest yields, when the family harvests into cargo. */
  readonly outputItemDefinitionId: string | null;
  /**
   * How much one harvest yields, when the family harvests into cargo.
   *
   * The resolver needs the *size* of a reward, not just that one exists: a pair of hands with room for
   * one unit cannot take a two-unit harvest, and deciding "there is room" from `used < capacity` alone
   * would send an actor to a field it cannot actually work - a stall the player would see as the game
   * being broken. Null means "unknown", which is treated as one unit.
   */
  readonly outputQuantity: number | null;
}

/** The next thing the engine would do, as a typed value rather than a string. */
export type WorkAction =
  | { readonly kind: "LOAD_INPUT"; readonly itemDefinitionId: string; readonly quantity: number }
  | { readonly kind: "PURCHASE_INPUT"; readonly itemDefinitionId: string; readonly quantity: number }
  /**
   * Buy the input with Gold the actor does not have yet, by selling the assignment's own whitelist.
   *
   * Distinct from `PURCHASE_INPUT` on purpose: it moves a second set of goods and writes its own
   * ledger entries, and it must settle as one transaction or not at all.
   */
  | {
      readonly kind: "FUND_AND_PURCHASE_INPUT";
      readonly itemDefinitionId: string;
      readonly quantity: number;
      readonly sales: readonly FundingSale[];
    }
  | { readonly kind: "TRAVEL_TO_AREA" }
  | { readonly kind: "PLANT"; readonly cells: number }
  | { readonly kind: "HARVEST"; readonly cells: number }
  | { readonly kind: "MINE" }
  | { readonly kind: "CHOP" }
  | { readonly kind: "TRAVEL_TO_STORAGE" }
  | { readonly kind: "UNLOAD" };

/** Why the engine is not doing any of those. Derived, never persisted. */
export const WAIT_REASONS = [
  "NOT_AUTO_CONTROLLED",
  "NO_ASSIGNMENT",
  "ALL_DISABLED",
  /** One assignment's own switch: it is configured but not eligible for Auto right now. */
  "DISABLED",
  "WAITING_FOR_GROWTH",
  "WAITING_FOR_RESOURCE",
  "WAITING_FOR_SUPPLY",
  "WAITING_FOR_FUNDS",
  "WAITING_FOR_STORAGE",
  "CARGO_FULL",
  "NO_ELIGIBLE_TARGETS",
  "UNSUPPORTED_SKILL",
  /**
   * The skill resolves, but the Auto executor does not perform it yet.
   *
   * Distinct from `UNSUPPORTED_SKILL` on purpose: mining, forestry and the orchard all have real
   * systems behind them and a real plan; what they do not have is an executor slice. Saying so is the
   * difference between "the game cannot do this" and "this build does not run it yet".
   */
  "NOT_EXECUTABLE_YET"
] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

export interface AutoPlan {
  /** The next action, or null when there is nothing to do. */
  readonly action: WorkAction | null;
  /** The assignment the action belongs to, or null for an actor-level action like an unload. */
  readonly jobId: JobId | null;
  /** Why there is no action. Null when there is one. */
  readonly waitReason: WaitReason | null;
}

/**
 * The stable ids of the specific targets an assignment could work *right now*.
 *
 * Counts answer "is there work"; these answer "on what". Only the overlap rule reads them, and they
 * stay bounded by the area's own cells (`MAX_WORK_AREA_CELLS`), so the snapshot never grows into a
 * scan of the island.
 */
export interface AssignmentClaims {
  /** Mature crop or ready tree instances the assignment could harvest. */
  readonly mature: readonly string[];
  /** Eligible empty cells it could plant into, as `x,y`. */
  readonly empty: readonly string[];
  /** Available resource nodes it could gather from. */
  readonly available: readonly string[];
}

/** How one assignment's targets look right now, as the world read them. */
export interface AssignmentTargets {
  /** REPLANT_CROP / PERENNIAL_PRODUCTION: eligible cells by state. */
  readonly emptyCells: number;
  readonly growingCells: number;
  readonly matureCells: number;
  /** PERENNIAL_PRODUCTION: how many of the area's eligible cells already hold the target. */
  readonly standing: number;
  /** RESOURCE_NODE_GATHERING: nodes that can be worked, and nodes regenerating. */
  readonly availableNodes: number;
  readonly depletedNodes: number;
  /** The target ids behind those counts, for the overlap rule alone. */
  readonly claims: AssignmentClaims;
}

export interface AssignmentPlanInput {
  readonly jobId: JobId;
  readonly priority: number;
  readonly enabled: boolean;
  readonly skill: WorkSkillDefinition;
  readonly autoPurchaseSupplies: boolean;
  readonly targets: AssignmentTargets;
  /** The catalogue price of the skill's input, or null when this deployment does not sell it. */
  readonly inputPrice: number | null;
  /**
   * The player's emergency-funding whitelist for this assignment, in priority order.
   *
   * Empty unless the player enabled it and ticked items, and each entry carries the *server's* sell
   * price - never a client value. The planner only reads it when Gold is short.
   */
  readonly funding: { readonly enabled: boolean; readonly candidates: readonly FundingCandidate[] };
}

/**
 * Everything the resolver is allowed to look at, handed in by the caller.
 *
 * Nothing here is read by the resolver itself: the application performs the bounded reads once and
 * passes the snapshot in, which is what makes a plan reproducible in a unit test and reusable by a
 * future offline reconciliation over a different clock.
 */
export interface AutoPlanContext {
  readonly controlMode: ControlMode;
  readonly cargo: { readonly used: number; readonly capacity: number };
  readonly warehouse: { readonly full: boolean };
  /** Item id -> quantity, for the two containers the resolver reasons about. */
  readonly carried: Readonly<Record<string, number>>;
  readonly stored: Readonly<Record<string, number>>;
  readonly gold: number;
  readonly assignments: readonly AssignmentPlanInput[];
}

/**
 * The most inputs one Auto supply step moves at a time.
 *
 * A bound, not a target: the step also fits within the actor's free capacity, the eligible planting
 * demand, and what the Warehouse or the wallet can actually supply. It exists so a large field cannot
 * become one enormous load, and so an actor visibly works in batches.
 */
/** Bounded by the actor's cargo capacity; 30 is the current shipped starter capacity. */
/** The families the Auto executor performs today. Everything else resolves and waits. */
export const EXECUTABLE_WORK_FAMILIES = ["REPLANT_CROP", "RESOURCE_NODE_GATHERING"] as const;

export function isExecutableFamily(family: LifecycleFamily): boolean {
  return (EXECUTABLE_WORK_FAMILIES as readonly LifecycleFamily[]).includes(family);
}

function has(container: Readonly<Record<string, number>>, itemDefinitionId: string): boolean {
  return (container[itemDefinitionId] ?? 0) >= 1;
}

/**
 * How many inputs one supply step should move.
 *
 * The useful batch: never more than the skip has ground for, never more than fits in the hands, never
 * more than the source can give. The caller only reaches here
 * when at least one is available in both directions, so the result is at least one.
 */
function supplyBatch(availableInSource: number, context: AutoPlanContext, targets: AssignmentTargets): number {
  const free = Math.max(0, context.cargo.capacity - context.cargo.used);
  return Math.max(1, Math.min(targets.emptyCells, free, availableInSource));
}

/** Whether the actor's hands have room for `amount` more units. */
function hasCargoRoom(context: AutoPlanContext, amount = 1): boolean {
  return context.cargo.used + Math.max(1, amount) <= context.cargo.capacity;
}

/**
 * What a full container means for the step that was about to happen.
 *
 * A full cargo over a warehouse with room is a delivery waiting to happen; a full cargo over a full
 * warehouse is the one state nothing can fix, and it is named rather than hidden.
 */
function cargoWait(context: AutoPlanContext): WaitReason {
  return context.warehouse.full ? "WAITING_FOR_STORAGE" : "CARGO_FULL";
}

/**
 * Whether the actor is carrying goods it must put down before any more reward can land.
 *
 * A pile in the hands is not a blocker by itself - it is the next delivery, and the plan says so
 * rather than reporting a wait. The exception is a destination that cannot take it, which is a real
 * wait and is reported as one.
 */
export function needsDelivery(context: AutoPlanContext): boolean {
  return context.cargo.capacity > 0 && context.cargo.used >= context.cargo.capacity && context.cargo.used > 0;
}

/** One assignment's next step, with the targets the step would touch. */
export interface AssignmentPlan {
  readonly jobId: JobId;
  readonly action: WorkAction | null;
  readonly waitReason: WaitReason | null;
  /** True when a higher-priority assignment already claimed this assignment's targets this pass. */
  readonly claimed: boolean;
}

/** A whole pass: the actor-level plan, and the per-assignment explanation behind it. */
export interface AutoPassPlan {
  readonly plan: AutoPlan;
  readonly assignments: readonly AssignmentPlan[];
}

/** The identity the overlap rule compares: what kind of thing, and which ones. */
function targetKey(skill: WorkSkillDefinition): string {
  return `${skill.kind}:${skill.targetDefinitionId}`;
}

/** The targets the chosen action would touch, for the overlap rule. */
function claimsFor(action: WorkAction | null, targets: AssignmentTargets): readonly string[] {
  if (action === null) return [];
  switch (action.kind) {
    case "HARVEST":
      return targets.claims.mature;
    case "PLANT":
    case "LOAD_INPUT":
    case "PURCHASE_INPUT":
      return targets.claims.empty;
    case "MINE":
    case "CHOP":
      return targets.claims.available;
    default:
      return [];
  }
}

/**
 * One assignment's next step, as a pure function of the snapshot.
 *
 * Deterministic and total: every state maps to an action or a wait with a reason. Ripe is harvested
 * first because it is the only step that pays; an unplantable-but-not-ripe area waits for growth
 * rather than manufacturing work; and the supply ladder is exactly carried -> stored -> bought ->
 * wait, in that order, so nothing is ever planted without its input.
 */
export function planAssignment(
  context: AutoPlanContext,
  assignment: AssignmentPlanInput
): { readonly action: WorkAction | null; readonly waitReason: WaitReason | null } {
  if (!assignment.enabled) return { action: null, waitReason: "DISABLED" };
  const { skill, targets } = assignment;
  switch (skill.family) {
    case "REPLANT_CROP":
    case "PERENNIAL_PRODUCTION": {
      if (targets.matureCells > 0) {
        // The reward itself has to fit, not merely "some room": a harvest that cannot land is refused
        // so the crop stays in the ground and the actor can go and make space instead of losing it.
        if (!hasCargoRoom(context, skill.outputQuantity ?? 1)) {
          // A near-full container over a warehouse with room is a delivery, not a dead end.
          return { action: null, waitReason: context.warehouse.full ? "WAITING_FOR_STORAGE" : "CARGO_FULL" };
        }
        return { action: { kind: "HARVEST", cells: targets.matureCells }, waitReason: null };
      }
      if (targets.emptyCells > 0) {
        if (skill.inputItemDefinitionId === null) return { action: null, waitReason: "UNSUPPORTED_SKILL" };
        const input = skill.inputItemDefinitionId;
        // 1. Already in hand: plant. This pays nothing, but it is the step that grows the field.
        if (has(context.carried, input)) {
          return { action: { kind: "PLANT", cells: targets.emptyCells }, waitReason: null };
        }
        // 2. In the Warehouse: bring it, which needs somewhere to put it.
        if (has(context.stored, input)) {
          if (!hasCargoRoom(context)) return { action: null, waitReason: cargoWait(context) };
          const stored = context.stored[input] ?? 0;
          return {
            action: { kind: "LOAD_INPUT", itemDefinitionId: input, quantity: supplyBatch(stored, context, targets) },
            waitReason: null
          };
        }
        // 3. Neither: buy only when this assignment's own policy allows it.
        if (assignment.autoPurchaseSupplies) {
          if (assignment.inputPrice === null) return { action: null, waitReason: "WAITING_FOR_SUPPLY" };
          if (!hasCargoRoom(context)) return { action: null, waitReason: cargoWait(context) };
          // B1 first, unchanged: the actor buys what its hands, its ground and its purse allow.
          const capacityBatch = supplyBatch(Number.MAX_SAFE_INTEGER, context, targets);
          const affordableNow = Math.floor(context.gold / assignment.inputPrice);
          const baseline = affordableNow < 1 ? 0 : supplyBatch(affordableNow, context, targets);
          if (baseline >= capacityBatch) {
            return { action: { kind: "PURCHASE_INPUT", itemDefinitionId: input, quantity: baseline }, waitReason: null };
          }
          // Gold cannot fill the hands: the player's whitelist may fund the difference, but only the
          // difference - the intended quantity is the capacity-driven batch either way.
          const quantity = capacityBatch;
          const cost = quantity * assignment.inputPrice;
          const shortfall = Math.max(0, cost - context.gold);
          if (assignment.funding.enabled && assignment.funding.candidates.length > 0) {
            // The caller read each candidate's Warehouse quantity when it built the list; the planner
            // must not guess it from a snapshot that only holds the assignment's own inputs.
            const candidates = assignment.funding.candidates.map((candidate) => ({
              itemDefinitionId: candidate.itemDefinitionId,
              unitPrice: candidate.unitPrice,
              available: candidate.available
            }));
            const plan = planFundingSale(shortfall, candidates);
            if (plan !== null) {
              return {
                action: { kind: "FUND_AND_PURCHASE_INPUT", itemDefinitionId: input, quantity, sales: plan.sales },
                waitReason: null
              };
            }
          }
          // Funding is off, empty, or cannot cover the shortfall: fall back to exactly what B1 would
          // have done - buy what the purse affords, or wait when it affords nothing.
          if (baseline >= 1) {
            return { action: { kind: "PURCHASE_INPUT", itemDefinitionId: input, quantity: baseline }, waitReason: null };
          }
          return { action: null, waitReason: "WAITING_FOR_FUNDS" };
        }
        // 4. Nothing to plant with and no permission to buy: wait, do not fake a planting.
        return { action: null, waitReason: "WAITING_FOR_SUPPLY" };
      }
      // No empty ground: the area is doing what it can, and the rest is the crops' own clock.
      if (targets.growingCells > 0 || targets.standing > 0) {
        return { action: null, waitReason: "WAITING_FOR_GROWTH" };
      }
      // Occupied or invalid cells the assignment did not plant: never clear somebody else's work.
      return { action: null, waitReason: "NO_ELIGIBLE_TARGETS" };
    }
    case "RESOURCE_NODE_GATHERING": {
      if (targets.availableNodes > 0) {
        if (!hasCargoRoom(context)) return { action: null, waitReason: cargoWait(context) };
        return { action: { kind: skill.kind === "MINING" ? "MINE" : "CHOP" }, waitReason: null };
      }
      return {
        action: null,
        waitReason: targets.depletedNodes > 0 ? "WAITING_FOR_RESOURCE" : "NO_ELIGIBLE_TARGETS"
      };
    }
    case "FISHING":
    case "LIVESTOCK":
      // No system exists behind these yet, and the resolver says so rather than pretending.
      return { action: null, waitReason: "UNSUPPORTED_SKILL" };
  }
}

/**
 * Whether the Auto executor performs this assignment's next step today.
 *
 * The resolver plans every family it understands; the *executor* is a separate, deliberately narrow
 * slice. A family that plans but does not execute reports `NOT_EXECUTABLE_YET` rather than quietly
 * doing nothing, so the panel can say which is which.
 */
export function executablePlanReason(
  action: WorkAction | null,
  skill: WorkSkillDefinition
): WaitReason | null {
  if (action === null) return null;
  if (isExecutableFamily(skill.family)) return null;
  return "NOT_EXECUTABLE_YET";
}

/**
 * The whole pass: the actor-level plan, plus what each assignment would do on its own.
 *
 * The actor-level answer is the highest-priority **actionable** assignment, never simply #1: a rice
 * field that is still growing must not stop a ready orchard. Waiting is not blocking. Only when
 * nothing is actionable does the plan report why - and a full pair of hands is reported as the
 * delivery it is, before any assignment's own wait.
 *
 * The per-assignment list is computed even while the player is driving, because the panel's whole
 * job before Auto is switched on is to show what Auto *would* do.
 */
export function resolvePass(context: AutoPlanContext): AutoPassPlan {
  const ordered = [...context.assignments].sort((left, right) => left.priority - right.priority);
  const enabled = ordered.filter((assignment) => assignment.enabled);

  const claimed = new Map<string, Set<string>>();
  const assignments: AssignmentPlan[] = [];
  let winner: AutoPlan | null = null;
  let firstWait: { readonly jobId: JobId; readonly reason: WaitReason } | null = null;

  for (const assignment of ordered) {
    if (!assignment.enabled) {
      assignments.push({ jobId: assignment.jobId, action: null, waitReason: "DISABLED", claimed: false });
      continue;
    }
    const planned = planAssignment(context, assignment);
    const claims = claimsFor(planned.action, assignment.targets);
    const key = targetKey(assignment.skill);
    const taken = claimed.get(key) ?? new Set<string>();
    const contested = planned.action !== null && claims.some((claim) => taken.has(claim));
    if (planned.action !== null && !contested) {
      for (const claim of claims) taken.add(claim);
      claimed.set(key, taken);
      assignments.push({ jobId: assignment.jobId, action: planned.action, waitReason: null, claimed: false });
      if (winner === null) winner = { action: planned.action, jobId: assignment.jobId, waitReason: null };
      continue;
    }
    const waitReason = contested ? "NO_ELIGIBLE_TARGETS" : planned.waitReason;
    assignments.push({ jobId: assignment.jobId, action: null, waitReason, claimed: contested });
    if (firstWait === null && !contested && waitReason !== null) {
      firstWait = { jobId: assignment.jobId, reason: waitReason };
    }
  }

  let plan: AutoPlan;
  if (context.controlMode !== "AUTO_CONTROLLED") {
    plan = { action: null, jobId: null, waitReason: "NOT_AUTO_CONTROLLED" };
  } else if (context.assignments.length === 0) {
    plan = { action: null, jobId: null, waitReason: "NO_ASSIGNMENT" };
  } else if (enabled.length === 0) {
    plan = { action: null, jobId: null, waitReason: "ALL_DISABLED" };
  } else if (winner !== null) {
    plan = winner;
  } else if (needsDelivery(context) || (cargoIsTheBlocker(firstWait?.reason) && context.cargo.used > 0)) {
    // Nothing in the field can be done, and the actor's own hands are what stands in the way - either
    // because they are full, or because the reward of the work that *is* ready would not fit. Either
    // way the delivery is the next step, and the goods go home rather than sitting in the field.
    plan = context.warehouse.full
      ? { action: null, jobId: null, waitReason: "WAITING_FOR_STORAGE" }
      : { action: { kind: "TRAVEL_TO_STORAGE" }, jobId: null, waitReason: null };
  } else {
    plan = {
      action: null,
      jobId: firstWait?.jobId ?? null,
      waitReason: firstWait?.reason ?? "NO_ELIGIBLE_TARGETS"
    };
  }
  return { plan, assignments };
}

/** Whether "there is nowhere to put it" is what the highest-priority wait is really about. */
function cargoIsTheBlocker(reason: WaitReason | null | undefined): boolean {
  return reason === "CARGO_FULL" || reason === "WAITING_FOR_STORAGE";
}

/**
 * The pure decision: the highest-priority **actionable** assignment, or a reason none is.
 *
 * `resolvePass` is the whole picture; this is the actor-level half of it, kept as the name the
 * design and the brief both use.
 */
export function resolveNextAction(context: AutoPlanContext): AutoPlan {
  return resolvePass(context).plan;
}

/** The professions the registry can describe today. */
export const SKILL_KINDS = WORK_AREA_KINDS;
