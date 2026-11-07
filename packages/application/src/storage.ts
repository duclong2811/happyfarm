import { assertStorageDeltaFits, DomainError, type PlayerId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { WarehouseRepository, WarehouseTierRepository } from "./ports";

/**
 * The pre-flight storage check for a reward that is about to be *rolled*.
 *
 * The database's capacity guard is the authority: it runs inside the settlement's transaction, so a
 * grant that does not fit rolls the whole batch back. This helper runs the same arithmetic earlier,
 * before the reward is chosen, so an already-full warehouse does not need to draw or persist entropy.
 * Fishing and resource action repositories pin the rolls durably before payout: a competing grant
 * can fill storage after this check, and that payout rollback must not discard the chosen rolls.
 *
 * Passing this pre-check neither reserves storage nor authorises a write. The guard still decides.
 */
export async function assertWarehouseHasRoom(
  warehouse: WarehouseRepository | undefined,
  tiers: WarehouseTierRepository | undefined,
  playerId: PlayerId,
  delta: number
): Promise<void> {
  if (warehouse === undefined || tiers === undefined) return;
  const stored = await warehouse.find(playerId);
  // A player with no row is held to the starter capacity by the guard, so the pre-check uses the same
  // number rather than pretending the warehouse is unbounded.
  const capacity = stored?.capacity ?? tiers.list()[0]?.capacity ?? 0;
  const used = await warehouse.usedCapacity(playerId);
  try {
    assertStorageDeltaFits(capacity, used, [delta]);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === "WAREHOUSE_FULL") {
      throw new ApplicationError("WAREHOUSE_FULL", "The warehouse cannot hold this reward");
    }
    throw error;
  }
}
