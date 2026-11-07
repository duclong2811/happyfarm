import type {
  ActorDTO,
  AutoPlanDTO,
  AutoStepDTO,
  JobDTO,
  ResourceNodeDTO,
  WorkAreaSummaryDTO
} from "@happy-farm/contracts";

export type MiningPanelStatus =
  | "AUTO_LOADING"
  | "AUTO_ERROR"
  | "SETUP_REQUIRED"
  | "NO_ASSIGNMENT"
  | "DISABLED"
  | "READY"
  | "STOPPED"
  | "TRAVELLING"
  | "CARRYING"
  | "MINING"
  | "WAITING"
  | "CARGO_FULL";

export type MiningPanelAction = "NONE" | "SETUP_AREA" | "ASSIGN" | "START" | "STOP" | "OPEN_AUTO";

export interface MiningPanelState {
  readonly nodeId: string;
  readonly definitionId: string;
  readonly status: MiningPanelStatus;
  readonly action: MiningPanelAction;
  readonly hasMiningArea: boolean;
  readonly hasMiningAssignment: boolean;
}

export interface MiningPanelInput {
  readonly node: Pick<ResourceNodeDTO, "nodeId" | "definitionId">;
  readonly actor: Pick<ActorDTO, "controlMode"> | null;
  readonly jobs: readonly Pick<JobDTO, "jobId" | "kind" | "targetDefinitionId" | "enabled">[];
  readonly workAreas: readonly Pick<WorkAreaSummaryDTO, "kind" | "cellCount">[];
  readonly autoPlan: AutoPlanDTO | null;
  readonly autoStep: AutoStepDTO | null;
  readonly dataReady: boolean;
  readonly dataError: boolean;
}

/** These keys are intentionally profession-local; Mining must never render Forestry fields. */
export const MINING_PANEL_FIELD_KEYS = [
  "mining.resourceType",
  "mining.product",
  "mining.yield",
  "mining.status",
  "mining.requiredLevel"
] as const;

export const FORESTRY_PANEL_FIELD_KEYS = [
  "forestry.origin",
  "forestry.type",
  "forestry.product",
  "forestry.yield",
  "forestry.status",
  "forestry.level"
] as const;

function isMiningJob(
  job: Pick<JobDTO, "kind" | "targetDefinitionId">,
  definitionId: string
): boolean {
  return job.kind === "MINING" && job.targetDefinitionId === definitionId;
}

/**
 * Pure Mining presentation state. It consumes the server reads already held by the page and never
 * invents a work area, assignment, or status while the Auto reads are unavailable.
 */
export function miningPanelState(input: MiningPanelInput): MiningPanelState {
  const base = {
    nodeId: input.node.nodeId,
    definitionId: input.node.definitionId,
    hasMiningArea: input.workAreas.some((area) => area.kind === "MINING" && area.cellCount > 0),
    hasMiningAssignment: input.jobs.some((job) => isMiningJob(job, input.node.definitionId))
  };

  if (input.dataError) return { ...base, status: "AUTO_ERROR", action: "NONE" };
  if (!input.dataReady) return { ...base, status: "AUTO_LOADING", action: "NONE" };

  const assignment = input.jobs.find((job) => isMiningJob(job, input.node.definitionId)) ?? null;
  if (assignment === null) {
    return base.hasMiningArea
      ? { ...base, status: "NO_ASSIGNMENT", action: "ASSIGN" }
      : { ...base, status: "SETUP_REQUIRED", action: "SETUP_AREA" };
  }
  if (!assignment.enabled) return { ...base, status: "DISABLED", action: "OPEN_AUTO" };
  // A STOPPED response is authoritative even when the actor snapshot is one render behind it. Do
  // not let the previous AUTO step keep the mine looking active after the lease/control transition.
  if (input.autoStep?.phase === "STOPPED") {
    return { ...base, status: "STOPPED", action: "START" };
  }
  if (input.actor?.controlMode !== "AUTO_CONTROLLED") {
    return { ...base, status: "READY", action: "START" };
  }

  const step = input.autoStep;
  const plan = input.autoPlan;
  const waitReason = step?.waitReason ?? plan?.waitReason;
  if (waitReason === "CARGO_FULL") return { ...base, status: "CARGO_FULL", action: "STOP" };
  if (step?.jobId === assignment.jobId && step.phase === "TRAVELLING") {
    return {
      ...base,
      status: step.to?.kind === "WAREHOUSE" ? "CARRYING" : "TRAVELLING",
      action: "STOP"
    };
  }
  // Between beats the server answers WAITING/MINE: the character is still at the face, digging.
  if (step?.jobId === assignment.jobId && (step.phase === "WORKED" || step.phase === "WAITING") && step.step === "MINE") {
    return { ...base, status: "MINING", action: "STOP" };
  }
  return { ...base, status: "WAITING", action: "STOP" };
}
