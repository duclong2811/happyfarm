import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDevApiHost, type DevApiHost } from "../../workers/api/dev/api-host";
import { applyMigrations } from "../../workers/api/dev/migrations";
import {
  NO_FARM_REPAIR,
  repairDuplicateFarmOwnership
} from "../../workers/api/dev/repair-farm-ownership";

/**
 * The local database that could not migrate.
 *
 * `0014` creates the unique index that makes "one player, one farm" true, and a database written before
 * V13.6.1 can hold several farms for one player - the old development session created a new one every
 * time it started. This file reproduces exactly that state, proves the migration cannot be applied over
 * it, and proves the repair resolves it without touching the player's own farm or any player-scoped
 * progress.
 */

const REAL_MIGRATIONS = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const NOW = "2026-01-01T00:00:00.000Z";
const PLAYER_ID = "player_11111111-1111-4111-8111-111111111111";
const OLDEST_FARM = "farm_11111111-1111-4111-8111-111111111111";
const MIDDLE_FARM = "farm_22222222-2222-4222-8222-222222222222";
const NEWEST_FARM = "farm_33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
const hosts: DevApiHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    try {
      host.close();
    } catch {
      // Already closed.
    }
  }
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the file briefly; temp directories are disposable.
    }
  }
});

/** A throwaway repository layout holding every committed migration. */
function fakeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "happy-farm-repair-host-"));
  dirs.push(root);
  mkdirSync(join(root, "workers", "api"), { recursive: true });
  const migrations = join(root, "database", "migrations");
  mkdirSync(migrations, { recursive: true });
  for (const name of readdirSync(REAL_MIGRATIONS)) {
    if (!name.endsWith(".sql")) continue;
    copyFileSync(join(REAL_MIGRATIONS, name), join(migrations, name));
  }
  writeFileSync(
    join(root, "workers", "api", ".dev.vars"),
    [
      "DEV_AUTH_ENABLED=true",
      "DEV_AUTH_TOKEN=repair-host-token-0123456789",
      `DEV_PLAYER_ID=${PLAYER_ID}`,
      "DEV_AUTH_ISSUER=https://dev.happy-farm.local",
      "DEV_AUTH_SUBJECT=dev-player-one",
      ""
    ].join("\n"),
    "utf8"
  );
  return root;
}

/**
 * A migrations directory holding only the named files, so the test can stop the database at `0013` -
 * the exact state the failing local database was in.
 */
function migrationsUpTo(names: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "happy-farm-repair-"));
  dirs.push(root);
  const available = readdirSync(REAL_MIGRATIONS).sort();
  for (const name of available) {
    if (!names.includes(name)) continue;
    copyFileSync(join(REAL_MIGRATIONS, name), join(root, name));
  }
  return root;
}

function beforeOneFarmPerPlayer(): readonly string[] {
  return readdirSync(REAL_MIGRATIONS)
    .filter((name) => name.endsWith(".sql") && name < "0014")
    .sort();
}

function withOneFarmPerPlayer(): readonly string[] {
  return readdirSync(REAL_MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** The local database as it actually was: a player, three farms, and progress on the newest. */
function seedLegacyLocalDatabase(sqlite: DatabaseSync): void {
  sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', 'dev-player-one', 'Dev', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ID, NOW, NOW);
  sqlite
    .prepare(
      "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 250, 1, ?, ?)"
    )
    .run(PLAYER_ID, NOW, NOW);
  sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', 35, ?, 1)"
    )
    .run(PLAYER_ID, NOW);

  const farms = [
    { id: OLDEST_FARM, at: "2026-01-01T00:00:00.000Z" },
    { id: MIDDLE_FARM, at: "2026-01-02T00:00:00.000Z" },
    { id: NEWEST_FARM, at: "2026-01-03T00:00:00.000Z" }
  ] as const;
  for (const farm of farms) {
    sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Starter Farm', ?, ?)")
      .run(farm.id, PLAYER_ID, farm.at, farm.at);
    sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
      .run(farm.id, PLAYER_ID, farm.at);
    sqlite
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'SOIL', 'IDLE', 1, ?)"
      )
      .run(farm.id, farm.at);
    sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 0, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
      )
      .run(`cropinst_${farm.id.slice(5)}`, farm.id, PLAYER_ID, farm.at, farm.at, farm.at);
    sqlite
      .prepare(
        "INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, 'world.tree_broad', 'WORLD_OBJECT', 2, 2, 0, 1, 1, 2, 2, 2, 2, 1, 'ACTIVE', ?, 'STARTER', ?, 0, 0, 'currency_gold', ?, ?, NULL, 1)"
      )
      .run(`construct_${farm.id.slice(5)}`, farm.id, PLAYER_ID, `starter.${farm.id}`, farm.at, farm.at);
  }
}

describe("a local database from before one-farm-per-player", () => {
  it("cannot accept the unique index until the duplicate farms are resolved", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyMigrations(sqlite, migrationsUpTo(beforeOneFarmPerPlayer()));
    seedLegacyLocalDatabase(sqlite);

    // This is the failure the developer saw: the index cannot be created over three farms for one
    // player, so the local Worker never started.
    expect(() => applyMigrations(sqlite, migrationsUpTo(withOneFarmPerPlayer()))).toThrow(
      /UNIQUE constraint failed: farms\.owner_player_id/
    );
    sqlite.close();
  });

  it("keeps the farm the last session was playing and removes the abandoned duplicates", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyMigrations(sqlite, migrationsUpTo(beforeOneFarmPerPlayer()));
    seedLegacyLocalDatabase(sqlite);

    const repair = repairDuplicateFarmOwnership(sqlite);
    expect(repair).toEqual({ ownersRepaired: 1, farmsRemoved: 2, keptFarmIds: [NEWEST_FARM] });

    // One farm per player, and it is the one that was used most recently - the player's world, with its
    // tiles, its crop and its built things still there.
    expect(sqlite.prepare("SELECT id, owner_player_id FROM farms").all()).toEqual([
      { id: NEWEST_FARM, owner_player_id: PLAYER_ID }
    ]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(NEWEST_FARM)).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE farm_id = ?").get(NEWEST_FARM)).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_constructions WHERE farm_id = ?").get(NEWEST_FARM)).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_members WHERE farm_id = ?").get(NEWEST_FARM)).toEqual({ count: 1 });

    // The abandoned farms left nothing behind: no orphaned tiles, crops, members or built things.
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farms WHERE id <> ?").get(NEWEST_FARM)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_constructions").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_members").get()).toEqual({ count: 1 });

    // Player-scoped progress was never farm-scoped, so it is untouched.
    expect(sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ID)).toEqual({ balance: 250 });
    expect(sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ?").get(PLAYER_ID)).toEqual({ quantity: 35 });

    // And now the migration applies, which is the whole point.
    const applied = applyMigrations(sqlite, migrationsUpTo(withOneFarmPerPlayer()));
    expect(applied).toEqual(["0014_one_farm_per_player.sql", "0015_player_identities.sql"]);
    const index = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_farms_owner_player'")
      .get() as { readonly name: string } | undefined;
    expect(index?.name).toBe("idx_farms_owner_player");
    // The invariant is live: a second farm for the same player is refused by the database itself.
    expect(() =>
      sqlite
        .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Second', ?, ?)")
        .run("farm_99999999-9999-4999-8999-999999999999", PLAYER_ID, NOW, NOW)
    ).toThrow(/UNIQUE constraint failed: farms\.owner_player_id/);
    sqlite.close();
  });

  it("is a no-op on a clean database and on a second run", () => {
    const clean = new DatabaseSync(":memory:");
    clean.exec("PRAGMA foreign_keys = ON");
    applyMigrations(clean, migrationsUpTo(withOneFarmPerPlayer()));
    expect(repairDuplicateFarmOwnership(clean)).toEqual(NO_FARM_REPAIR);
    clean.close();

    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyMigrations(sqlite, migrationsUpTo(beforeOneFarmPerPlayer()));
    seedLegacyLocalDatabase(sqlite);
    expect(repairDuplicateFarmOwnership(sqlite).farmsRemoved).toBe(2);
    expect(repairDuplicateFarmOwnership(sqlite)).toEqual(NO_FARM_REPAIR);
    sqlite.close();
  });

  it("does nothing at all to a database that has not created its farms table yet", () => {
    const sqlite = new DatabaseSync(":memory:");
    expect(repairDuplicateFarmOwnership(sqlite)).toEqual(NO_FARM_REPAIR);
    sqlite.close();
  });

  it("lets the development host start on that database and serve its own farm", async () => {
    // The real path: a local file stuck at 0013 with duplicates, opened by the development host exactly
    // as `npm run dev` opens it. Before the repair this is where the developer saw
    // `UNIQUE constraint failed: farms.owner_player_id` and the browser never got a session.
    const root = fakeRepoRoot();
    const databasePath = join(root, ".wrangler", "dev-local.sqlite");
    mkdirSync(join(root, ".wrangler"), { recursive: true });
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("PRAGMA foreign_keys = ON");
    applyMigrations(legacy, migrationsUpTo(beforeOneFarmPerPlayer()));
    seedLegacyLocalDatabase(legacy);
    legacy.close();

    const host = createDevApiHost({ repoRoot: root, databasePath });
    hosts.push(host);
    expect(host.farmOwnershipRepair).toEqual({
      ownersRepaired: 1,
      farmsRemoved: 2,
      keptFarmIds: [NEWEST_FARM]
    });
    expect(host.appliedMigrations).toEqual(["0014_one_farm_per_player.sql", "0015_player_identities.sql"]);

    // The API now answers, and the farm it hands back is the one that survived - the last one played,
    // not a fresh world and not an abandoned duplicate.
    const headers = { authorization: "Bearer repair-host-token-0123456789", "content-type": "application/json" };
    const created = await host.handle(
      new Request("https://dev.happy-farm.local/farms", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Starter Farm" })
      })
    );
    expect(created.status).toBe(200);
    const createdBody: unknown = await created.json();
    const body = createdBody as { readonly data: { readonly farm: { readonly id: string } } };
    expect(body.data.farm.id).toBe(NEWEST_FARM);
    // And the rest of the API answers, so the host is fully up rather than half-started.
    const health = await host.handle(new Request("https://dev.happy-farm.local/health"));
    expect(health.status).toBe(200);
  });
});
