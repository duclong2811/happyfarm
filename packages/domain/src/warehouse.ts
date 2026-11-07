import { DomainError } from "./errors";

/**
 * The Island Warehouse: the rule that a Home Island holds a finite number of stored units.
 *
 * The warehouse is **capacity over the existing inventory**, not a second inventory. Unlike the other
 * per-item inventory rules, this is one budget shared by every stored good, so the interesting
 * question is always a *net* one: a transaction may add one item while removing another, and only the
 * combined change has to fit.
 */

export interface WarehouseUpgradeCost {
  readonly currencyDefinitionId: string;
  readonly gold: number;
  readonly materials: Readonly<Record<string, number>>;
}

export interface WarehouseTierDefinition {
  readonly tier: number;
  readonly displayNameKey: string;
  readonly capacity: number;
  /** The cost of moving from this tier to the next; null on the highest tier. */
  readonly upgrade: WarehouseUpgradeCost | null;
}

export interface WarehouseState {
  readonly tier: number;
  readonly capacity: number;
  /** The sum of every stored item's quantity. May exceed capacity for a grandfathered player. */
  readonly used: number;
  readonly version: number;
}

export const MAX_WAREHOUSE_CAPACITY = 1_000_000_000;

/** The room a warehouse has left, floored at zero: an over-capacity player has no free space. */
export function warehouseAvailable(state: Pick<WarehouseState, "capacity" | "used">): number {
  return Math.max(0, state.capacity - state.used);
}

/** True when a grandfathered player is holding more than their warehouse can now hold. */
export function isOverCapacity(state: Pick<WarehouseState, "capacity" | "used">): boolean {
  return state.used > state.capacity;
}

/** The next tier's definition, or null when this is the highest tier the deployment ships. */
export function nextWarehouseTier(
  tiers: readonly WarehouseTierDefinition[],
  tier: number
): WarehouseTierDefinition | null {
  return tiers.find((entry) => entry.tier === tier + 1) ?? null;
}

/**
 * The capacity primitive the whole storage system is built on.
 *
 * `deltas` is the *net* change a single transaction makes: a harvest is one positive value, a shop
 * purchase is one positive value, and a future crafting step is a mix of positives and negatives.
 * Only their sum has to fit, which is what lets a recipe consume 10 and produce 6 even when the
 * warehouse is nearly full.
 *
 * It is pure and has no persistence: the authoritative check runs inside the database transaction
 * (the inventory capacity trigger), and this is the same rule the application and tests reason with.
 */
export function assertStorageDeltaFits(
  capacity: number,
  currentUsed: number,
  deltas: readonly number[]
): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_WAREHOUSE_CAPACITY) {
    throw new DomainError("INVALID_WAREHOUSE", "Warehouse capacity is invalid");
  }
  if (!Number.isSafeInteger(currentUsed) || currentUsed < 0) {
    throw new DomainError("INVALID_WAREHOUSE", "Warehouse usage is invalid");
  }
  let net = 0;
  for (const delta of deltas) {
    if (!Number.isSafeInteger(delta)) {
      throw new DomainError("INVALID_WAREHOUSE", "Storage delta must be a safe integer");
    }
    net += delta;
    if (!Number.isSafeInteger(net)) {
      throw new DomainError("INVALID_WAREHOUSE", "Storage delta is outside the safe integer range");
    }
  }
  const projected = currentUsed + net;
  if (!Number.isSafeInteger(projected) || projected < 0) {
    throw new DomainError("INVALID_WAREHOUSE", "Storage delta would make usage invalid");
  }
  if (net > 0 && projected > capacity) {
    throw new DomainError("WAREHOUSE_FULL", "The warehouse does not have enough space");
  }
}
