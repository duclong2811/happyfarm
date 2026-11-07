import { DomainError } from "./errors";
import type { FishingActionId, PlayerId } from "./ids";
import { instantAfter, secondsUntil } from "./time";

export interface FishingStockState {
  readonly spotId: string;
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly stock: number;
  readonly lastRegeneratedAt: string;
  readonly version: number;
}

/** Stock is regenerated mathematically at read time; no timer or per-fish row is created. */
export function fishingStockAt(
  state: Pick<FishingStockState, "stock" | "lastRegeneratedAt"> | null,
  maxStock: number,
  regenerationSeconds: number,
  now: string
): number {
  if (!Number.isSafeInteger(maxStock) || maxStock < 1 || !Number.isSafeInteger(regenerationSeconds) || regenerationSeconds < 1) {
    throw new DomainError("INVALID_FISHING", "Fishing stock configuration is invalid");
  }
  if (state === null) return maxStock;
  if (!Number.isSafeInteger(state.stock) || state.stock < 0 || state.stock > maxStock) {
    throw new DomainError("INVALID_FISHING", "Fishing stock state is invalid");
  }
  const elapsed = Date.parse(now) - Date.parse(state.lastRegeneratedAt);
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) throw new DomainError("INVALID_FISHING", "Fishing stock time is invalid");
  return Math.min(maxStock, state.stock + Math.floor(elapsed / (regenerationSeconds * 1000)));
}

export function consumeFishingStock(
  availableStock: number,
  quantity: number,
  now: string
): { readonly stock: number; readonly lastRegeneratedAt: string } {
  if (!Number.isSafeInteger(availableStock) || !Number.isSafeInteger(quantity) || quantity < 1 || availableStock < quantity) {
    throw new DomainError("INVALID_FISHING", "Fishing stock is depleted");
  }
  if (!Number.isFinite(Date.parse(now))) throw new DomainError("INVALID_FISHING", "Fishing settlement time is invalid");
  return { stock: availableStock - quantity, lastRegeneratedAt: now };
}

/**
 * Fishing's rules, with no database, no clock and no randomness of their own.
 *
 * The three pieces that have to be exact live here. A catch table is *weights*, and the selection is a
 * pure function of a roll the server supplies, so the outcome is unpredictable in production and
 * reproducible in a test. An action's readiness is a comparison of two timestamps, so "can I settle
 * yet?" is the server's answer and never a client's timer. And an action's shape is validated before
 * anything is written, so a corrupted row is refused rather than settled.
 */

/** One row of a catch table: which fish, and how likely relative to its neighbours. */
export interface CatchTableEntry {
  readonly fishId: string;
  readonly weight: number;
}

export type FishingActionStatus = "ACTIVE" | "SETTLED" | "CANCELLED";

/**
 * One player's fishing action.
 *
 * It belongs to the *actor*, never to a farm, and it carries the zone it happened in: for Home Island
 * that zone is the actor's own farm, and for a future shared ground it will be the ground's own id.
 * Only the timestamps and the status are durable; the wait itself is a comparison, not a timer.
 */
export interface FishingAction {
  readonly actionId: FishingActionId;
  readonly actorPlayerId: PlayerId;
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly spotId: string;
  readonly tableId: string;
  readonly status: FishingActionStatus;
  readonly startedAt: string;
  readonly readyAt: string;
  readonly settledAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function assertWeightedEntries(entries: readonly CatchTableEntry[]): void {
  if (entries.length === 0) {
    throw new DomainError("INVALID_FISHING", "A catch table needs at least one entry");
  }
  let total = 0;
  for (const entry of entries) {
    if (typeof entry.fishId !== "string" || entry.fishId.length === 0) {
      throw new DomainError("INVALID_FISHING", "A catch table entry is missing its fish");
    }
    if (!Number.isSafeInteger(entry.weight) || entry.weight <= 0) {
      throw new DomainError("INVALID_FISHING", "A catch weight must be a positive whole number");
    }
    total += entry.weight;
    if (!Number.isSafeInteger(total)) {
      throw new DomainError("INVALID_FISHING", "Catch weights overflow the safe integer range");
    }
  }
}

export function totalCatchWeight(entries: readonly CatchTableEntry[]): number {
  assertWeightedEntries(entries);
  return entries.reduce((sum, entry) => sum + entry.weight, 0);
}

/**
 * Which fish a roll lands on.
 *
 * The roll is the server's, in `[0, 1)`. It is turned into an integer ticket in `[0, total)` and the
 * table is walked in order, so the selection is exact in integers and does not depend on floating
 * point accumulation. A roll outside `[0, 1)` is refused rather than clamped: a caller that produced
 * one has a bug, and a clamped roll would hide it behind a plausible catch.
 */
export function selectCatch(
  entries: readonly CatchTableEntry[],
  roll: number
): CatchTableEntry {
  const total = totalCatchWeight(entries);
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new DomainError("INVALID_FISHING", "A catch roll must be within [0, 1)");
  }
  const ticket = Math.floor(roll * total);
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (ticket < cumulative) return entry;
  }
  // Unreachable for a valid roll and a positive total, but the last entry is the honest answer if
  // floating point ever lands exactly on the boundary.
  return entries[entries.length - 1] as CatchTableEntry;
}

/** The instant an action started now becomes settle-able, from the server's own duration. */
export function fishingReadyAt(startedAt: string, actionSeconds: number): string {
  try {
    return instantAfter(startedAt, actionSeconds);
  } catch {
    throw new DomainError("INVALID_FISHING", "Fishing timing is invalid");
  }
}

/** Whole seconds until an action is ready, never negative. Zero exactly when it is ready. */
export function secondsUntilFishingReady(readyAt: string, serverTime: string): number {
  try {
    return secondsUntil(readyAt, serverTime);
  } catch {
    throw new DomainError("INVALID_FISHING", "Fishing timing is invalid");
  }
}

/** Whether the server's clock has reached the moment this action can pay out. */
export function isFishingReady(action: FishingAction, serverTime: string): boolean {
  return secondsUntilFishingReady(action.readyAt, serverTime) === 0;
}

/** Refuses an action row that could not have been produced by this feature. */
export function assertFishingAction(action: FishingAction): void {
  if (typeof action.actionId !== "string" || !action.actionId.startsWith("fishact_")) {
    throw new DomainError("INVALID_FISHING", "Fishing action id is invalid");
  }
  if (typeof action.spotId !== "string" || !action.spotId.startsWith("spot_")) {
    throw new DomainError("INVALID_FISHING", "Fishing spot id is invalid");
  }
  if (typeof action.tableId !== "string" || !action.tableId.startsWith("fishtable_")) {
    throw new DomainError("INVALID_FISHING", "Fishing table id is invalid");
  }
  if (typeof action.zoneKind !== "string" || action.zoneKind.length === 0) {
    throw new DomainError("INVALID_FISHING", "Fishing action is missing its zone kind");
  }
  if (typeof action.zoneId !== "string" || action.zoneId.length === 0) {
    throw new DomainError("INVALID_FISHING", "Fishing action is missing its zone id");
  }
  if (!Number.isFinite(Date.parse(action.startedAt)) || !Number.isFinite(Date.parse(action.readyAt))) {
    throw new DomainError("INVALID_FISHING", "Fishing action timing is invalid");
  }
  if (!Number.isSafeInteger(action.version) || action.version < 1) {
    throw new DomainError("INVALID_FISHING", "Fishing action version is invalid");
  }
  if (action.status === "SETTLED" && action.settledAt === null) {
    throw new DomainError("INVALID_FISHING", "A settled fishing action needs a settlement time");
  }
}
