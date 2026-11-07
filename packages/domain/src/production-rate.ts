import { DomainError } from "./errors";

export const PRODUCTION_HOUR_MS = 3_600_000;
export const PRODUCTION_OFFLINE_CAP_MS = 24 * PRODUCTION_HOUR_MS;

export type ProductionAssignmentMode = "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
export type ProductionSourceKind = "RENEWABLE" | "FINITE";
export type ProductionBlockedReason = "WAREHOUSE_FULL" | "SOURCE_DEPLETED" | "DISABLED" | "NOT_READY" | null;

export interface ProductionSourceSnapshot {
  readonly id: string;
  readonly farmId: string;
  readonly kind: ProductionSourceKind;
  readonly outputItemDefinitionId: string;
  /** Whole output units per hour. Modifiers are resolved by the server before this function. */
  readonly ratePerHour: number;
  readonly remainingStock: number | null;
  readonly enabled: boolean;
  readonly version: number;
}

export interface ProductionAssignmentSnapshot {
  readonly id: string;
  readonly farmId: string;
  readonly actorId: string;
  readonly workAreaId: string | null;
  readonly sourceId: string;
  readonly enabled: boolean;
  readonly settlementCursor: string;
  /** Fixed-point remainder in output-units × milliseconds. */
  readonly productionRemainder: number;
  /** Persisted latch that prevents blocked time becoming hidden backlog. */
  readonly blockedReason?: Exclude<ProductionBlockedReason, null>;
  readonly version: number;
}

export interface ProductionSettlementInput {
  readonly assignment: ProductionAssignmentSnapshot;
  readonly source: ProductionSourceSnapshot;
  readonly serverNow: string;
  readonly warehouseFreeCapacity: number;
}

export interface ProductionSettlementResult {
  readonly outputItemDefinitionId: string;
  readonly producedQuantity: number;
  readonly sourceConsumed: number;
  readonly elapsedMs: number;
  readonly productiveElapsedMs: number;
  readonly newCursor: string;
  readonly newRemainder: number;
  readonly newSourceRemainingStock: number | null;
  readonly blockedReason: ProductionBlockedReason;
  readonly sourceDepleted: boolean;
}

function parseTime(value: string): number {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time)) throw new DomainError("INVALID_INSTANT", "Production time is invalid");
  return time;
}

function assertSafeNonNegative(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("INVALID_RESOURCE", message);
}

/**
 * Pure, bounded, integer-safe production calculation. It never reads a clock, inventory, or client
 * input. The host resolves the authoritative source/rate/capacity and commits this result atomically.
 */
export function settleProduction(input: ProductionSettlementInput): ProductionSettlementResult {
  const { assignment, source } = input;
  const cursorMs = parseTime(assignment.settlementCursor);
  const nowMs = parseTime(input.serverNow);
  if (nowMs < cursorMs) throw new DomainError("INVALID_INSTANT", "Production time cannot move backwards");
  if (assignment.sourceId !== source.id || assignment.farmId !== source.farmId) {
    throw new DomainError("INVALID_RESOURCE", "Production source does not belong to the assignment farm");
  }
  assertSafeNonNegative(assignment.productionRemainder, "Production remainder is invalid");
  assertSafeNonNegative(input.warehouseFreeCapacity, "Warehouse capacity is invalid");
  assertSafeNonNegative(source.ratePerHour, "Production rate is invalid");
  if (source.ratePerHour > Number.MAX_SAFE_INTEGER / PRODUCTION_OFFLINE_CAP_MS) {
    throw new DomainError("INVALID_RESOURCE", "Production rate is too large");
  }
  if (source.remainingStock !== null) assertSafeNonNegative(source.remainingStock, "Source stock is invalid");

  const elapsedMs = Math.min(nowMs - cursorMs, PRODUCTION_OFFLINE_CAP_MS);
  // Once a settlement has reached a hard boundary, time spent waiting behind that boundary is not
  // productive backlog. The first later observation consumes the blocked interval and reopens the
  // assignment at server time; a subsequent request can produce from the reopened cursor.
  if (assignment.blockedReason === "WAREHOUSE_FULL" && input.warehouseFreeCapacity > 0) {
    return {
      outputItemDefinitionId: source.outputItemDefinitionId, producedQuantity: 0, sourceConsumed: 0,
      elapsedMs, productiveElapsedMs: 0, newCursor: input.serverNow, newRemainder: assignment.productionRemainder,
      newSourceRemainingStock: source.remainingStock, blockedReason: null, sourceDepleted: source.remainingStock === 0
    };
  }
  if (assignment.blockedReason === "WAREHOUSE_FULL" && input.warehouseFreeCapacity === 0) {
    return {
      outputItemDefinitionId: source.outputItemDefinitionId, producedQuantity: 0, sourceConsumed: 0,
      elapsedMs, productiveElapsedMs: 0, newCursor: input.serverNow, newRemainder: assignment.productionRemainder,
      newSourceRemainingStock: source.remainingStock, blockedReason: "WAREHOUSE_FULL", sourceDepleted: source.remainingStock === 0
    };
  }
  const base = assignment.productionRemainder + source.ratePerHour * elapsedMs;
  const potential = Math.floor(base / PRODUCTION_HOUR_MS);
  const available = Math.min(potential, input.warehouseFreeCapacity, source.remainingStock ?? Number.MAX_SAFE_INTEGER);
  const producedQuantity = Math.max(0, available);
  let productiveElapsedMs = elapsedMs;
  let blockedReason: ProductionBlockedReason = null;

  if (!assignment.enabled || !source.enabled) {
    return {
      outputItemDefinitionId: source.outputItemDefinitionId, producedQuantity: 0, sourceConsumed: 0,
      elapsedMs, productiveElapsedMs: 0, newCursor: assignment.settlementCursor,
      newRemainder: assignment.productionRemainder, newSourceRemainingStock: source.remainingStock,
      blockedReason: "DISABLED", sourceDepleted: source.remainingStock === 0
    };
  }
  if (elapsedMs === 0 || source.ratePerHour === 0) {
    return {
      outputItemDefinitionId: source.outputItemDefinitionId, producedQuantity: 0, sourceConsumed: 0,
      elapsedMs, productiveElapsedMs: 0, newCursor: assignment.settlementCursor,
      newRemainder: assignment.productionRemainder, newSourceRemainingStock: source.remainingStock,
      blockedReason: elapsedMs === 0 ? "NOT_READY" : null, sourceDepleted: source.remainingStock === 0
    };
  }
  if (source.remainingStock === 0) {
    blockedReason = "SOURCE_DEPLETED";
    productiveElapsedMs = 0;
  } else if (input.warehouseFreeCapacity === 0) {
    blockedReason = "WAREHOUSE_FULL";
    productiveElapsedMs = 0;
  } else if (producedQuantity < potential) {
    blockedReason = source.remainingStock !== null && producedQuantity >= source.remainingStock
      ? "SOURCE_DEPLETED" : "WAREHOUSE_FULL";
    // Advance only to the first exact limiting boundary. Blocked time is never retained as backlog.
    productiveElapsedMs = Math.floor((producedQuantity * PRODUCTION_HOUR_MS - assignment.productionRemainder) / source.ratePerHour);
    productiveElapsedMs = Math.max(0, Math.min(elapsedMs, productiveElapsedMs));
  }
  const newCursorMs = cursorMs + productiveElapsedMs;
  const consumedNumerator = assignment.productionRemainder + source.ratePerHour * productiveElapsedMs;
  const newRemainder = consumedNumerator - producedQuantity * PRODUCTION_HOUR_MS;
  const newStock = source.remainingStock === null ? null : source.remainingStock - producedQuantity;
  return {
    outputItemDefinitionId: source.outputItemDefinitionId, producedQuantity, sourceConsumed: producedQuantity,
    elapsedMs, productiveElapsedMs, newCursor: new Date(newCursorMs).toISOString(), newRemainder,
    newSourceRemainingStock: newStock, blockedReason: newStock === 0 ? "SOURCE_DEPLETED" : blockedReason,
    sourceDepleted: newStock === 0
  };
}
