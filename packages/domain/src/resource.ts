import { DomainError } from "./errors";
import type { PlayerId, ResourceActionId } from "./ids";
import { instantAfter, isAtOrAfter, secondsUntil } from "./time";

/**
 * The generic resource-node lifecycle: what mining introduces and forestry reuses.
 *
 * Nothing here knows about rocks, ore or a pickaxe. A node has a *verb* (MINE today, CHOP tomorrow), a
 * drop table, an action duration and a regeneration duration; the domain decides which drop a roll
 * lands on, how much of it, and when a depleted node is available again. The server owns all four.
 */

export type ResourceVerb = "MINE" | "CHOP";

/** One row of a drop table: what a node gives, how much, and how likely relative to its siblings. */
export interface ResourceDropEntry {
  readonly itemDefinitionId: string;
  readonly minQuantity: number;
  readonly maxQuantity: number;
  readonly weight: number;
}

export type ResourceActionStatus = "ACTIVE" | "SETTLED" | "CANCELLED";

/** One player's gather attempt. Owned by the actor, named against the node, and zone-scoped. */
export interface ResourceAction {
  readonly actionId: ResourceActionId;
  readonly actorPlayerId: PlayerId;
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly nodeId: string;
  readonly definitionId: string;
  readonly verb: ResourceVerb;
  readonly status: ResourceActionStatus;
  readonly startedAt: string;
  readonly readyAt: string;
  readonly settledAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The mutable half of a node: when it is next available, in one zone.
 *
 * Keyed by `(zoneId, nodeId)` rather than by the node alone, because the same authored deposit exists
 * in every player's own home island and, later, in shared grounds - each with its own depletion.
 */
export interface ResourceNodeState {
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly nodeId: string;
  readonly availableAt: string;
  readonly depletedAt: string;
  readonly version: number;
}

function assertDropEntries(entries: readonly ResourceDropEntry[]): void {
  if (entries.length === 0) {
    throw new DomainError("INVALID_RESOURCE", "A drop table needs at least one entry");
  }
  let total = 0;
  for (const entry of entries) {
    if (typeof entry.itemDefinitionId !== "string" || entry.itemDefinitionId.length === 0) {
      throw new DomainError("INVALID_RESOURCE", "A drop entry is missing its item");
    }
    if (
      !Number.isSafeInteger(entry.minQuantity) ||
      !Number.isSafeInteger(entry.maxQuantity) ||
      entry.minQuantity <= 0 ||
      entry.maxQuantity < entry.minQuantity
    ) {
      throw new DomainError("INVALID_RESOURCE", "A drop quantity range is invalid");
    }
    if (!Number.isSafeInteger(entry.weight) || entry.weight <= 0) {
      throw new DomainError("INVALID_RESOURCE", "A drop weight must be a positive whole number");
    }
    total += entry.weight;
    if (!Number.isSafeInteger(total)) {
      throw new DomainError("INVALID_RESOURCE", "Drop weights overflow the safe integer range");
    }
  }
}

export function totalDropWeight(entries: readonly ResourceDropEntry[]): number {
  assertDropEntries(entries);
  return entries.reduce((sum, entry) => sum + entry.weight, 0);
}

/**
 * Which entry a roll lands on.
 *
 * Exactly the fishing catch draw's shape, deliberately: integer tickets, exact comparison, and a roll
 * outside `[0, 1)` refused rather than clamped. A table with one entry always returns it, which is how
 * a deterministic yield is expressed without a second code path.
 */
export function selectResourceDrop(
  entries: readonly ResourceDropEntry[],
  roll: number
): ResourceDropEntry {
  const total = totalDropWeight(entries);
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new DomainError("INVALID_RESOURCE", "A drop roll must be within [0, 1)");
  }
  const ticket = Math.floor(roll * total);
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (ticket < cumulative) return entry;
  }
  return entries[entries.length - 1] as ResourceDropEntry;
}

/** How much of the chosen item a roll yields: an exact quantity when min equals max. */
export function resourceQuantity(entry: ResourceDropEntry, roll: number): number {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new DomainError("INVALID_RESOURCE", "A quantity roll must be within [0, 1)");
  }
  if (
    !Number.isSafeInteger(entry.minQuantity) ||
    !Number.isSafeInteger(entry.maxQuantity) ||
    entry.minQuantity <= 0 ||
    entry.maxQuantity < entry.minQuantity
  ) {
    throw new DomainError("INVALID_RESOURCE", "A drop quantity range is invalid");
  }
  const span = entry.maxQuantity - entry.minQuantity + 1;
  return entry.minQuantity + Math.floor(roll * span);
}

/** The instant a node gathered at `startedAt` becomes available again. */
export function resourceAvailableAt(startedAt: string, regenerationSeconds: number): string {
  try {
    return instantAfter(startedAt, regenerationSeconds);
  } catch {
    throw new DomainError("INVALID_RESOURCE", "Resource regeneration timing is invalid");
  }
}

/**
 * Whether a node is available now.
 *
 * "No row" means never gathered, which is available: state is written lazily by the first depletion,
 * exactly as a wallet is written by the first settlement. That is what makes regeneration a
 * comparison rather than a job.
 */
export function isResourceAvailable(availableAt: string | null, serverTime: string): boolean {
  if (availableAt === null) return true;
  return isAtOrAfter(availableAt, serverTime);
}

export function secondsUntilResourceAvailable(availableAt: string | null, serverTime: string): number {
  if (availableAt === null) return 0;
  return secondsUntil(availableAt, serverTime);
}

/** Refuses an action row that could not have been produced by this feature. */
export function assertResourceAction(action: ResourceAction): void {
  if (typeof action.actionId !== "string" || !action.actionId.startsWith("resact_")) {
    throw new DomainError("INVALID_RESOURCE", "Resource action id is invalid");
  }
  if (typeof action.nodeId !== "string" || !action.nodeId.startsWith("node_")) {
    throw new DomainError("INVALID_RESOURCE", "Resource node id is invalid");
  }
  if (typeof action.definitionId !== "string" || !action.definitionId.startsWith("resource_")) {
    throw new DomainError("INVALID_RESOURCE", "Resource definition id is invalid");
  }
  const verb: string = action.verb;
  if (verb !== "MINE" && verb !== "CHOP") {
    throw new DomainError("INVALID_RESOURCE", "Resource verb is invalid");
  }
  if (typeof action.zoneKind !== "string" || action.zoneKind.length === 0) {
    throw new DomainError("INVALID_RESOURCE", "Resource action is missing its zone kind");
  }
  if (typeof action.zoneId !== "string" || action.zoneId.length === 0) {
    throw new DomainError("INVALID_RESOURCE", "Resource action is missing its zone id");
  }
  if (!Number.isFinite(Date.parse(action.startedAt)) || !Number.isFinite(Date.parse(action.readyAt))) {
    throw new DomainError("INVALID_RESOURCE", "Resource action timing is invalid");
  }
  if (!Number.isSafeInteger(action.version) || action.version < 1) {
    throw new DomainError("INVALID_RESOURCE", "Resource action version is invalid");
  }
  if (action.status === "SETTLED" && action.settledAt === null) {
    throw new DomainError("INVALID_RESOURCE", "A settled resource action needs a settlement time");
  }
}
