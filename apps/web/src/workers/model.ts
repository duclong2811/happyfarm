/**
 * The worker panel's pure half: what can be assigned, in what order, and what a row says.
 *
 * A job is configuration, and the panel is a configuration editor: it chooses from the definitions
 * the world already ships (a crop, a tree, a resource the island actually holds), it never invents a
 * resource, and it never claims that assigning work does anything yet. Everything here is a pure
 * function of the data the panel was handed, so the rules are testable without a browser.
 */

import type {
  AutoPlanDTO,
  AutoStepDTO,
  JobDTO,
  JobKind,
  LifecycleFamilyDTO,
  WaitReasonDTO,
  WorkActionDTO,
  WorkAreaSummaryDTO
} from "@happy-farm/contracts";

/** One thing a job could target: a stable game-data id and the key its name is translated from. */
export interface JobTargetOption {
  readonly id: string;
  readonly displayNameKey: string;
}

/** What the panel knows about the world: the catalogues and the nodes actually placed on the island. */
export interface JobTargetSources {
  readonly crops: readonly { readonly cropDefinitionId: string; readonly displayNameKey: string }[];
  readonly trees: readonly { readonly treeDefinitionId: string; readonly displayNameKey: string }[];
  readonly resourceNodes: readonly {
    readonly definitionId: string;
    readonly displayNameKey: string;
    readonly verb: string;
  }[];
  readonly fishingSpots?: readonly { readonly spotId: string; readonly displayNameKey: string }[];
}

/**
 * The targets a profession can be assigned today.
 *
 * FARM reads the crop catalogue, ORCHARD the tree catalogue, and MINING and FORESTRY the *definitions
 * the island's own nodes are placed with* - split by the verb those nodes carry, so a mining job can
 * only name a deposit someone could actually mine. FISHERY names an authored wild spot; LIVESTOCK and
 * AQUACULTURE remain empty because those systems are not cut over.
 */
export function jobTargetsFor(kind: JobKind, sources: JobTargetSources): readonly JobTargetOption[] {
  if (kind === "FARM") {
    return sources.crops.map((crop) => ({ id: crop.cropDefinitionId, displayNameKey: crop.displayNameKey }));
  }
  if (kind === "ORCHARD") {
    return sources.trees.map((tree) => ({ id: tree.treeDefinitionId, displayNameKey: tree.displayNameKey }));
  }
  if (kind === "FISHERY") {
    return (sources.fishingSpots ?? []).map((spot) => ({ id: spot.spotId, displayNameKey: spot.displayNameKey }));
  }
  const verb = kind === "MINING" ? "MINE" : kind === "FORESTRY" ? "CHOP" : null;
  if (verb === null) return [];
  const seen = new Set<string>();
  const options: JobTargetOption[] = [];
  for (const node of sources.resourceNodes) {
    if (node.verb !== verb || seen.has(node.definitionId)) continue;
    seen.add(node.definitionId);
    options.push({ id: node.definitionId, displayNameKey: node.displayNameKey });
  }
  return options;
}

/** Whether this profession has anything to assign at all. */
export function kindIsAssignable(kind: JobKind, sources: JobTargetSources): boolean {
  return jobTargetsFor(kind, sources).length > 0;
}

/** The areas a job of this kind may name: same kind, same farm (the list is already the farm's). */
export function compatibleAreas(
  kind: JobKind,
  areas: readonly WorkAreaSummaryDTO[]
): readonly WorkAreaSummaryDTO[] {
  return areas.filter((area) => area.kind === kind);
}

/**
 * Moves one job up or down in the order and returns the whole new order.
 *
 * The reorder command takes the complete list, so a move is expressed as the list it produces rather
 * than as a "swap these two" instruction the server would have to re-derive. Moving past either end
 * returns the order unchanged, which makes the buttons harmless at the edges.
 */
export function moveJobInOrder(
  orderedJobIds: readonly string[],
  jobId: string,
  direction: -1 | 1
): readonly string[] {
  const index = orderedJobIds.indexOf(jobId);
  if (index < 0) return orderedJobIds;
  const target = index + direction;
  if (target < 0 || target >= orderedJobIds.length) return orderedJobIds;
  const next = [...orderedJobIds];
  const moved = next[index] as string;
  next[index] = next[target] as string;
  next[target] = moved;
  return next;
}

/** The order a list of jobs is in, which is what a reorder sends and what the panel compares. */
export function jobOrderOf(jobs: readonly JobDTO[]): readonly string[] {
  return jobs.map((job) => job.jobId);
}

/** A key that changes only when the drawn worker list would change. */
export function jobListSignature(jobs: readonly JobDTO[]): string {
  return jobs
    .map(
      (job) =>
        `${job.jobId}:${String(job.priority)}:${String(job.version)}:${job.enabled ? "1" : "0"}:${
          job.autoPurchaseSupplies ? "1" : "0"
        }:${job.targetDefinitionId}`
    )
    .join("|");
}

/**
 * The Auto half of the panel's pure logic: what a production cycle looks like, and how a plan reads.
 *
 * Both are presentations of facts the server owns. The lifecycle is the *family* the skill runs (a
 * definition field, not a class), and the status is the resolver's own action or wait reason - never a
 * client guess about what the engine is doing.
 */

/** One step in a production cycle, as a token the panel translates. */
export type LifecycleStepToken =
  | "seed"
  | "sapling"
  | "plant"
  | "plantOnce"
  | "grow"
  | "harvest"
  | "warehouse"
  | "travel"
  | "gather"
  | "wait"
  | "repeat";

/**
 * The cycle a family runs, as the strip the card draws.
 *
 * A `REPLANT_CROP` skill is a loop that eats a seed every pass; a `PERENNIAL_PRODUCTION` one plants
 * once and then only harvests; a `RESOURCE_NODE_GATHERING` one travels, gathers and waits for the node
 * to renew. The families with no system behind them still answer, because a panel that showed nothing
 * for livestock would be lying about why nothing happens.
 */
export function lifecycleStepsFor(family: LifecycleFamilyDTO): readonly LifecycleStepToken[] {
  switch (family) {
    case "REPLANT_CROP":
      return ["seed", "plant", "grow", "harvest", "warehouse", "repeat"];
    case "PERENNIAL_PRODUCTION":
      return ["sapling", "plantOnce", "grow", "harvest", "warehouse", "repeat"];
    case "RESOURCE_NODE_GATHERING":
      return ["travel", "gather", "wait", "repeat"];
    case "FISHING":
      return ["travel", "gather", "warehouse", "repeat"];
    case "LIVESTOCK":
      return ["wait", "harvest", "warehouse", "repeat"];
  }
}

/** How a plan step reads: a tone for the colour, and a token for the words. */
export interface AutoStatus {
  readonly tone: "ready" | "waiting" | "blocked" | "off";
  readonly token: string;
}

/**
 * What one plan entry means, in the panel's own vocabulary.
 *
 * The tone is the important half: `ready` is a step the engine would take now, `waiting` is the world's
 * own clock, `blocked` is something the player can fix, and `off` is a paused assignment. Nothing here
 * is an action - D1 performs none of them - and the panel's copy says so.
 */
export function autoStatusFor(action: WorkActionDTO | null, waitReason: WaitReasonDTO | null): AutoStatus {
  if (action !== null) {
    switch (action.kind) {
      case "LOAD_INPUT":
        return { tone: "ready", token: "load" };
      case "PURCHASE_INPUT":
        return { tone: "ready", token: "buy" };
      case "TRAVEL_TO_AREA":
        return { tone: "ready", token: "travelArea" };
      case "PLANT":
        return { tone: "ready", token: "plant" };
      case "HARVEST":
        return { tone: "ready", token: "harvest" };
      case "MINE":
        return { tone: "ready", token: "mine" };
      case "CHOP":
        return { tone: "ready", token: "chop" };
      case "TRAVEL_TO_STORAGE":
        return { tone: "ready", token: "deliver" };
      case "UNLOAD":
        return { tone: "ready", token: "unload" };
    }
  }
  switch (waitReason) {
    case "WAITING_FOR_GROWTH":
      return { tone: "waiting", token: "growth" };
    case "WAITING_FOR_RESOURCE":
      return { tone: "waiting", token: "resource" };
    case "WAITING_FOR_SUPPLY":
      return { tone: "waiting", token: "supply" };
    case "WAITING_FOR_FUNDS":
      return { tone: "waiting", token: "funds" };
    case "WAITING_FOR_STORAGE":
      return { tone: "blocked", token: "storage" };
    case "CARGO_FULL":
      return { tone: "blocked", token: "cargoFull" };
    case "NO_ELIGIBLE_TARGETS":
      return { tone: "blocked", token: "noTargets" };
    case "UNSUPPORTED_SKILL":
      return { tone: "blocked", token: "unsupported" };
    case "DISABLED":
      return { tone: "off", token: "disabled" };
    case "NOT_AUTO_CONTROLLED":
      return { tone: "off", token: "playerControl" };
    default:
      return { tone: "off", token: "idle" };
  }
}

/** The plan entry for one assignment, or null when the plan does not describe it. */
export function planForAssignment(plan: AutoPlanDTO | null, jobId: string): AutoPlanDTO["perAssignment"][number] | null {
  return plan === null ? null : (plan.perAssignment.find((entry) => entry.jobId === jobId) ?? null);
}

/** What Auto would do next, from the per-assignment previews, while the player is still driving. */
export function autoPreviewFor(plan: AutoPlanDTO): {
  readonly status: AutoStatus;
  readonly action: AutoPlanDTO["action"];
} {
  const ordered = [...plan.perAssignment].sort((left, right) => left.priority - right.priority);
  const ready = ordered.find((entry) => entry.action !== null);
  if (ready !== undefined) return { status: autoStatusFor(ready.action, null), action: ready.action };
  const waiting = ordered.find((entry) => entry.enabled);
  return { status: autoStatusFor(null, waiting?.waitReason ?? "NO_ASSIGNMENT"), action: null };
}

/**
 * What the running line says, as a token plus the values it needs.
 *
 * The panel's live status comes from the step the server *performed*, not from a guess about what it
 * might do next: while an actor is walking, planting or carrying a load, the honest answer is what the
 * last step reported. The token is translated by the panel; nothing here is a display string, and no
 * enum name ever reaches the player.
 */
export interface AutoRunStatus {
  readonly token: string;
  readonly itemDefinitionId: string | null;
  readonly quantity: number | null;
  readonly progress: { readonly planted: number; readonly empty: number; readonly mature: number } | null;
}

export function autoRunStatusFor(step: AutoStepDTO): AutoRunStatus {
  const carried = { itemDefinitionId: step.itemDefinitionId, quantity: step.quantity, progress: step.progress };
  if (step.phase === "STOPPED") return { token: "stopped", ...carried };
  if (step.phase === "RETRY") return { token: "retry", ...carried };
  if (step.phase === "TRAVELLING") {
    const token =
      step.to?.kind === "MARKET" ? "travelMarket" : step.to?.kind === "WAREHOUSE" ? "travelWarehouse" : "travelField";
    return { token, ...carried };
  }
  if (step.phase === "WORKED") {
    switch (step.step) {
      case "LOAD_INPUT":
        return { token: "load", ...carried };
      case "PURCHASE_INPUT":
        return { token: "buy", ...carried };
      case "PLANT":
        return { token: "plant", ...carried };
      case "HARVEST":
        return { token: "harvest", ...carried };
      case "UNLOAD":
        return { token: "unload", ...carried };
      default:
        return { token: "working", ...carried };
    }
  }
  return { token: "waiting", ...carried };
}

/** The field's progress as two numbers the panel can render, or null when the step has none. */
export function autoFieldProgress(
  progress: AutoStepDTO["progress"]
): { readonly planted: number; readonly total: number } | null {
  if (progress === null) return null;
  const total = progress.planted + progress.empty;
  return total <= 0 ? null : { planted: progress.planted, total };
}

