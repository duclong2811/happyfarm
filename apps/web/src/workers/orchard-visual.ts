import type { TreeStateDTO, WorkAreaDTO } from "@happy-farm/contracts";

export type OrchardVisualState = "IDLE" | "TRAVEL_TO_WORK" | "WORKING" | "TRAVEL_BETWEEN_TREES";
export interface OrchardVisualTarget { readonly treeInstanceId: string; readonly tileX: number; readonly tileY: number; }
export interface OrchardVisualSnapshot {
  readonly state: OrchardVisualState;
  readonly target: OrchardVisualTarget | null;
  readonly workUntilMs: number | null;
}

const WORK_DURATION_MS = 3_000;

function inArea(tree: TreeStateDTO, area: WorkAreaDTO): boolean {
  return area.cells.some((cell) => cell.x === tree.tileX && cell.y === tree.tileY);
}

export function orchardVisualTargets(trees: readonly TreeStateDTO[], area: WorkAreaDTO): readonly OrchardVisualTarget[] {
  return trees
    .filter((tree) => tree.definitionId === "tree_apple" && tree.phase === "READY" && inArea(tree, area))
    .sort((a, b) => a.tileY - b.tileY || a.tileX - b.tileX || a.treeInstanceId.localeCompare(b.treeInstanceId))
    .map((tree) => ({ treeInstanceId: tree.treeInstanceId, tileX: tree.tileX, tileY: tree.tileY }));
}

export function createOrchardVisualController(): {
  readonly snapshot: () => OrchardVisualSnapshot;
  readonly update: (nowMs: number, visible: boolean, targets: readonly OrchardVisualTarget[], assigned: boolean, arrived?: boolean) => OrchardVisualSnapshot;
  readonly interrupt: () => void;
} {
  let current: OrchardVisualSnapshot = { state: "IDLE", target: null, workUntilMs: null };
  let cursor = 0;
  return {
    snapshot: () => current,
    interrupt: () => { current = { state: "IDLE", target: null, workUntilMs: null }; },
    update: (nowMs, visible, targets, assigned, arrived = true) => {
      if (!visible || !assigned || targets.length === 0) {
        current = { state: "IDLE", target: null, workUntilMs: null };
        return current;
      }
      if (current.state === "IDLE" || current.target === null || !targets.some((target) => target.treeInstanceId === current.target?.treeInstanceId)) {
        const target = targets[cursor % targets.length] ?? null; cursor += 1;
        if (target === null) return current;
        current = { state: "TRAVEL_TO_WORK", target, workUntilMs: null };
      } else if ((current.state === "TRAVEL_TO_WORK" || current.state === "TRAVEL_BETWEEN_TREES") && arrived) {
        current = { ...current, state: "WORKING", workUntilMs: nowMs + WORK_DURATION_MS };
      } else if (current.workUntilMs !== null && nowMs >= current.workUntilMs) {
        const target = targets[cursor % targets.length] ?? null; cursor += 1;
        if (target === null) return current;
        current = { state: "TRAVEL_BETWEEN_TREES", target, workUntilMs: null };
      }
      return current;
    }
  };
}
