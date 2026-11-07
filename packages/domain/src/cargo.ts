import { DomainError } from "./errors";
import type { ActorId, ItemDefinitionId } from "./ids";

/**
 * Actor Cargo: the goods an actor is physically carrying.
 *
 * This is a **separate container** from the Home Warehouse, not a re-reading of it. `inventory_items`
 * is what is *stored*; `actor_cargo_items` is what is *being carried* - and the whole point of the
 * automation design is that production lands in the second and only reaches the first when an actor
 * physically takes it there. Nothing in this slice rewrites existing inventory: every row that exists
 * today is, and stays, Home Warehouse stock.
 *
 * The unit is deliberately the same one the warehouse uses: one item is one cargo unit. Weight and
 * volume are a later evolution, and inventing them now would mean balancing a system before anything
 * uses it.
 */

/**
 * The categories a cargo row may hold.
 *
 * Every shipped item is a physical stackable today, so this is the whole catalogue - but it is
 * written down on purpose rather than assumed. A future non-physical category (a receipt, a token, a
 * progression marker) has to be added here deliberately, which is the difference between a rule and
 * a coincidence. Gold and experience are not items at all: they live on the wallet and the
 * progression row, and no cargo path can name them.
 */
export const CARGO_ITEM_CATEGORIES = ["CROP", "SEED", "FISH", "MATERIAL"] as const;
export type CargoItemCategory = (typeof CARGO_ITEM_CATEGORIES)[number];

export function isCarryableCategory(category: string): category is CargoItemCategory {
  return (CARGO_ITEM_CATEGORIES as readonly string[]).includes(category);
}

/**
 * The categories a *supply purchase* may buy straight into cargo.
 *
 * Narrower than "carryable" on purpose. A Work Skill buys consumable inputs; a harvest does not
 * belong in the shop's cargo destination, and a future non-physical category never will. Seeds are
 * the whole list today; feed and physical materials join it when the systems that need them exist.
 */
export const CARGO_SUPPLY_CATEGORIES = ["SEED"] as const;

export function isSupplyCategory(category: string): boolean {
  return (CARGO_SUPPLY_CATEGORIES as readonly string[]).includes(category);
}

/**
 * The largest single LOAD or supply purchase a client may ask for.
 *
 * A bound, not the limit: the container's own capacity is the real ceiling, and the cargo capacity
 * trigger is its authority. This exists so a request cannot be a number large enough to matter to
 * arithmetic or to a batch.
 */
export const MAX_CARGO_LOAD_QUANTITY = 1_000;

/** The ceiling on any container's capacity, shared with the warehouse's own bound. */
export const MAX_CARGO_CAPACITY = 1_000_000_000;

export interface ActorCargoItem {
  readonly actorId: ActorId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly version: number;
  readonly updatedAt: string;
}

/** How much of a container's capacity its rows use. */
export function cargoUsed(items: readonly Pick<ActorCargoItem, "quantity">[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

/** What a container has left, floored at zero. */
export function cargoAvailable(capacity: number, used: number): number {
  return Math.max(0, capacity - used);
}

/**
 * The capacity primitive the whole cargo system is built on.
 *
 * A *net* delta, exactly like the warehouse's: a grant is one positive value, a future transfer that
 * consumes one item while producing another is a mix, and only the sum has to fit. Removal is never
 * refused for capacity - a full or grandfathered container must always be able to empty itself - and
 * a delta that would take the container below zero is refused outright rather than clamped.
 *
 * The authoritative check runs inside the database transaction (the cargo capacity trigger), and
 * this is the same rule the application and the tests reason with.
 */
export function assertCargoDeltaFits(capacity: number, currentUsed: number, deltas: readonly number[]): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_CARGO_CAPACITY) {
    throw new DomainError("INVALID_CARGO", "Cargo capacity is invalid");
  }
  if (!Number.isSafeInteger(currentUsed) || currentUsed < 0) {
    throw new DomainError("INVALID_CARGO", "Cargo usage is invalid");
  }
  let net = 0;
  for (const delta of deltas) {
    if (!Number.isSafeInteger(delta)) {
      throw new DomainError("INVALID_CARGO", "Cargo delta must be a safe integer");
    }
    net += delta;
    if (!Number.isSafeInteger(net)) {
      throw new DomainError("INVALID_CARGO", "Cargo delta is outside the safe integer range");
    }
  }
  const projected = currentUsed + net;
  if (!Number.isSafeInteger(projected) || projected < 0) {
    throw new DomainError("INVALID_CARGO", "Cargo delta would make usage invalid");
  }
  if (net > 0 && projected > capacity) {
    throw new DomainError("CARGO_FULL", "The actor cannot carry any more");
  }
}

/** Whether a container has room for one more positive delta. The editor's and the grant's pre-check. */
export function cargoHasRoom(capacity: number, used: number, quantity: number): boolean {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return false;
  return used + quantity <= capacity;
}
