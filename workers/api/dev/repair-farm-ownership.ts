import type { DatabaseSync } from "node:sqlite";

/**
 * DEVELOPMENT-ONLY repair for a local database that predates one-farm-per-player.
 *
 * `0014_one_farm_per_player.sql` creates a unique index on `farms(owner_player_id)`. That index is
 * correct and is not negotiable - but it cannot be *created* over data that already violates it, and a
 * local development database created before V13.6.1 can hold several farms for one player: the old dev
 * session created a new farm each time it started, and the local file kept them all. Applying the
 * migration to that file fails with `UNIQUE constraint failed: farms.owner_player_id` before the
 * development Worker can start at all.
 *
 * So the local runner repairs the *data* first, exactly as the invariant requires:
 *
 * * one farm survives per owner - the most recently updated one, which for a development database is
 *   the farm the last session was actually playing;
 * * its rows are untouched, and so is every player-scoped row (wallet, inventory, progression, ledger),
 *   because those live on the player and not on the farm;
 * * the abandoned duplicates go, and their farm-scoped rows (tiles, members, crops, trees, built
 *   things, receipts) go with them through `ON DELETE CASCADE`.
 *
 * This is deliberately **not** a committed migration and never touches a deployed database:
 * `workers/api/dev/**` is not in the deployed entrypoint's import graph, and staging applied `0014`
 * cleanly (it had one farm per player). It runs before the migrations, is a no-op on a clean database,
 * and reports what it did so the developer sees it rather than wondering where farms went.
 */

export interface FarmOwnershipRepair {
  /** How many players had more than one farm. */
  readonly ownersRepaired: number;
  /** How many abandoned farm rows were removed. */
  readonly farmsRemoved: number;
  /** The farm kept for each repaired owner, in owner order. */
  readonly keptFarmIds: readonly string[];
}

export const NO_FARM_REPAIR: FarmOwnershipRepair = {
  ownersRepaired: 0,
  farmsRemoved: 0,
  keptFarmIds: []
};

interface DuplicateOwnerRow {
  readonly owner_player_id: string;
  readonly farms: number;
}

function tableExists(sqlite: DatabaseSync, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { readonly name: string } | undefined;
  return row !== undefined;
}

/**
 * Resolves every owner that has more than one farm, keeping one and removing the rest.
 *
 * Idempotent: with no duplicates it does nothing, and after one run there are none to find. Throws
 * rather than proceeding if the invariant still does not hold afterwards, because the next thing the
 * runner does is apply the index that requires it.
 */
export function repairDuplicateFarmOwnership(sqlite: DatabaseSync): FarmOwnershipRepair {
  // The host enables foreign keys before this runs; confirming it here keeps the repair honest on its
  // own: without them, deleting a farm would strand its tiles and built things instead of removing them.
  sqlite.exec("PRAGMA foreign_keys = ON");
  if (!tableExists(sqlite, "farms")) return NO_FARM_REPAIR;

  const duplicateRows: unknown = sqlite
    .prepare(
      "SELECT owner_player_id, COUNT(*) AS farms FROM farms GROUP BY owner_player_id HAVING COUNT(*) > 1 ORDER BY owner_player_id"
    )
    .all();
  const duplicates = duplicateRows as DuplicateOwnerRow[];
  if (duplicates.length === 0) return NO_FARM_REPAIR;

  const keptFarmIds: string[] = [];
  let farmsRemoved = 0;
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const owner of duplicates) {
      const keeper = sqlite
        .prepare(
          "SELECT id FROM farms WHERE owner_player_id = ? ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1"
        )
        .get(owner.owner_player_id) as { readonly id: string } | undefined;
      if (keeper === undefined) continue;
      keptFarmIds.push(keeper.id);
      const removed = sqlite
        .prepare("DELETE FROM farms WHERE owner_player_id = ? AND id <> ?")
        .run(owner.owner_player_id, keeper.id);
      farmsRemoved += Number(removed.changes);
    }
    sqlite.exec("COMMIT");
  } catch (error: unknown) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  const remaining = sqlite
    .prepare("SELECT COUNT(*) AS owners FROM (SELECT owner_player_id FROM farms GROUP BY owner_player_id HAVING COUNT(*) > 1)")
    .get() as { readonly owners: number };
  if (remaining.owners > 0) {
    throw new Error("Local farm repair left a player owning more than one farm");
  }
  return { ownersRepaired: keptFarmIds.length, farmsRemoved, keptFarmIds };
}
