import { DomainError } from "./errors";
import { calculateTreeProduction, type TreeDefinition, type TreeInstance } from "./tree";
import { workAreaCellKey, type WorkAreaCell } from "./work-area";

/** Stable Work Skill identity for the first rate-based perennial producer. */
export const APPLE_ORCHARD_WORK_SKILL_ID = "orchard.apple";
export const APPLE_TREE_DEFINITION_ID = "tree_apple";
export const APPLE_ITEM_DEFINITION_ID = "item_apple";

/** One mature Apple Tree contributes this many whole Apples per hour. */
export const APPLE_RATE_PER_TREE_PER_HOUR = 1;

export interface OrchardTreeCandidate {
  readonly tree: TreeInstance;
  readonly definition: TreeDefinition;
  /** False represents an authoritative stored/deleted tree row and is never eligible. */
  readonly active?: boolean;
}

export interface OrchardCapacity {
  readonly eligibleMatureAppleTreeCount: number;
  readonly ratePerHour: number;
  readonly eligibleTreeIds: readonly string[];
}

function isInside(cells: ReadonlySet<string>, tree: TreeInstance): boolean {
  return cells.has(workAreaCellKey({ x: tree.tileX, y: tree.tileY }));
}

/**
 * Computes one aggregate Orchard Source rate from authoritative tree rows and Work Area cells.
 * Missing rows (stored/deleted trees) are naturally excluded; no client count participates.
 */
export function calculateAppleOrchardCapacity(
  cells: readonly WorkAreaCell[],
  candidates: readonly OrchardTreeCandidate[],
  serverTime: string
): OrchardCapacity {
  const membership = new Set(cells.map(workAreaCellKey));
  const eligible: string[] = [];
  for (const candidate of candidates) {
    const { tree, definition } = candidate;
    if (candidate.active === false || tree.treeDefinitionId !== APPLE_TREE_DEFINITION_ID) continue;
    if (!isInside(membership, tree)) continue;
    if (definition.id !== APPLE_TREE_DEFINITION_ID) continue;
    if (calculateTreeProduction(definition, tree, serverTime).ready) eligible.push(tree.id);
  }
  return {
    eligibleMatureAppleTreeCount: eligible.length,
    ratePerHour: eligible.length * APPLE_RATE_PER_TREE_PER_HOUR,
    eligibleTreeIds: eligible
  };
}

export interface OrchardRateBoundary {
  readonly at: string;
  readonly ratePerHour: number;
}

export interface OrchardProductionSegment {
  readonly from: string;
  readonly to: string;
  readonly ratePerHour: number;
}

/** Splits settlement at authoritative rate changes, preventing a new rate being applied retroactively. */
export function orchardProductionSegments(
  from: string,
  to: string,
  initialRatePerHour: number,
  boundaries: readonly OrchardRateBoundary[]
): readonly OrchardProductionSegment[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || toMs < fromMs) {
    throw new DomainError("INVALID_INSTANT", "Orchard settlement interval is invalid");
  }
  if (!Number.isSafeInteger(initialRatePerHour) || initialRatePerHour < 0) {
    throw new DomainError("INVALID_RESOURCE", "Orchard rate is invalid");
  }
  const changes = boundaries
    .map((boundary) => ({ atMs: Date.parse(boundary.at), ratePerHour: boundary.ratePerHour }))
    .filter((boundary) => boundary.atMs > fromMs && boundary.atMs < toMs)
    .sort((left, right) => left.atMs - right.atMs);
  let cursor = fromMs;
  let rate = initialRatePerHour;
  const result: OrchardProductionSegment[] = [];
  for (const change of changes) {
    if (!Number.isSafeInteger(change.atMs) || !Number.isSafeInteger(change.ratePerHour) || change.ratePerHour < 0) {
      throw new DomainError("INVALID_RESOURCE", "Orchard rate boundary is invalid");
    }
    result.push({ from: new Date(cursor).toISOString(), to: new Date(change.atMs).toISOString(), ratePerHour: rate });
    cursor = change.atMs;
    rate = change.ratePerHour;
  }
  if (cursor < toMs) result.push({ from: new Date(cursor).toISOString(), to: new Date(toMs).toISOString(), ratePerHour: rate });
  return result;
}
