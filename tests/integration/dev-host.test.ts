import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDevApiHost, type DevApiHost } from "../../workers/api/dev/api-host";
import { readDevVars } from "../../workers/api/dev/dev-vars";
import { applyMigrations } from "../../workers/api/dev/migrations";
import { SqliteD1Database } from "../../workers/api/dev/sqlite-d1";
import { DEV_AUTH_BOOTSTRAP_PATH } from "../../workers/api/src/dev-auth";

const MIGRATION_NAMES = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql"
];

const REAL_MIGRATIONS = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const NOW = "2026-01-01T00:00:00.000Z";
const DEV_TOKEN = "dev-host-token-0123456789";
const DEV_PLAYER_ID = "player_33333333-3333-4333-8333-333333333333";

/** Builds a throwaway repository layout so the host is exercised without touching the real repo. */
function createFakeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "happy-farm-dev-host-"));
  mkdirSync(join(root, "workers", "api"), { recursive: true });
  mkdirSync(join(root, "database", "migrations"), { recursive: true });
  for (const name of MIGRATION_NAMES) {
    copyFileSync(join(REAL_MIGRATIONS, name), join(root, "database", "migrations", name));
  }
  return root;
}

function writeDevVars(root: string, content: string): void {
  writeFileSync(join(root, "workers", "api", ".dev.vars"), content, "utf8");
}

const VALID_DEV_VARS = [
  "DEV_AUTH_ENABLED=true",
  `DEV_AUTH_TOKEN=${DEV_TOKEN}`,
  `DEV_PLAYER_ID=${DEV_PLAYER_ID}`,
  "DEV_AUTH_ISSUER=https://dev.happy-farm.local",
  "DEV_AUTH_SUBJECT=dev-player-one",
  ""
].join("\n");

function authedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${DEV_TOKEN}`);
  return new Request(`https://dev.happy-farm.local${path}`, { ...init, headers });
}

const dirs: string[] = [];
const hosts: DevApiHost[] = [];

function trackHost(host: DevApiHost): DevApiHost {
  hosts.push(host);
  return host;
}

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
      // Windows can briefly hold the file; temp directories are disposable.
    }
  }
});

describe("development .dev.vars reader", () => {
  it("returns no bindings when the file is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "happy-farm-dev-vars-"));
    dirs.push(root);
    expect(readDevVars(join(root, ".dev.vars"))).toEqual({});
  });

  it("ignores comments and blank lines and strips quotes", () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    const file = join(root, "workers", "api", ".dev.vars");
    writeFileSync(
      file,
      [
        "# a comment",
        "",
        "   ",
        "not-an-assignment",
        'DEV_AUTH_TOKEN="quoted-token-value"',
        "  DEV_AUTH_ENABLED = true  ",
        "DEV_BASE64_TOKEN=abc=def==",
        ""
      ].join("\n"),
      "utf8"
    );

    expect(readDevVars(file)).toEqual({
      DEV_AUTH_TOKEN: "quoted-token-value",
      DEV_AUTH_ENABLED: "true",
      DEV_BASE64_TOKEN: "abc=def=="
    });
  });
});

describe("development migration runner", () => {
  it("applies committed migrations in order and is idempotent", () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    const migrationsDir = join(root, "database", "migrations");
    const sqlite = new DatabaseSync(":memory:");

    expect(applyMigrations(sqlite, migrationsDir)).toEqual(MIGRATION_NAMES);
    expect(applyMigrations(sqlite, migrationsDir)).toEqual([]);

    const tracked = sqlite
      .prepare("SELECT name FROM dev_applied_migrations ORDER BY name")
      .all() as { name: string }[];
    expect(tracked.map((row) => row.name)).toEqual(MIGRATION_NAMES);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  it("rolls back a migration that fails partway through, then applies it on a later run", () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    const migrationsDir = join(root, "database", "migrations");
    const partial = join(migrationsDir, "0001_partial.sql");
    const sqlite = new DatabaseSync(":memory:");

    writeFileSync(
      partial,
      "CREATE TABLE partial_table (id TEXT PRIMARY KEY NOT NULL);\nSELECT * FROM missing_table;\n",
      "utf8"
    );
    expect(() => applyMigrations(sqlite, migrationsDir)).toThrow();

    // Neither the schema the failed migration created nor its tracking row may survive it.
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'").all()
    ).toEqual([]);
    expect(sqlite.prepare("SELECT name FROM dev_applied_migrations").all()).toEqual([]);

    // A later run applies it once it can succeed, so the local database is never stranded.
    writeFileSync(partial, "CREATE TABLE partial_table (id TEXT PRIMARY KEY NOT NULL);\n", "utf8");
    expect(applyMigrations(sqlite, migrationsDir)).toEqual(["0001_partial.sql", ...MIGRATION_NAMES]);
    sqlite.close();
  });
});

describe("SQLite-backed D1 port", () => {
  function createDatabase(): SqliteD1Database {
    const root = createFakeRepoRoot();
    dirs.push(root);
    const sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite, join(root, "database", "migrations"));
    return new SqliteD1Database(sqlite);
  }

  function seedPlayer(database: SqliteD1Database): Promise<unknown> {
    return database
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', 'dev-player-one', 'Dev', 'ACTIVE', ?, ?)"
      )
      .bind(DEV_PLAYER_ID, NOW, NOW)
      .run();
  }

  it("projects first, all, and run results like D1", async () => {
    const database = createDatabase();
    await seedPlayer(database);

    const row = await database
      .prepare("SELECT id, status FROM players WHERE id = ?")
      .bind(DEV_PLAYER_ID)
      .first<{ id: string; status: string }>();
    expect(row).toEqual({ id: DEV_PLAYER_ID, status: "ACTIVE" });

    const missing = await database.prepare("SELECT id FROM players WHERE id = ?").bind("player_absent").first();
    expect(missing).toBeNull();

    const all = await database.prepare("SELECT id FROM players").all<{ id: string }>();
    expect(all.results).toEqual([{ id: DEV_PLAYER_ID }]);

    const run = await database.prepare("UPDATE players SET display_name = ? WHERE id = ?").bind("Renamed", DEV_PLAYER_ID).run();
    expect(run.success).toBe(true);
    expect(run.meta.changes).toBe(1);

    database.close();
  });

  it("enforces foreign keys like D1", () => {
    const database = createDatabase();
    // `run()` reports driver failures synchronously, exactly like the D1 port does.
    expect(() =>
      database
        .prepare(
          "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES ('farm_missing', 0, 0, 'SOIL', 'IDLE', 1, ?)"
        )
        .bind(NOW)
        .run()
    ).toThrow();
    database.close();
  });

  it("rolls back every statement of a failed batch", async () => {
    const database = createDatabase();
    const statements = [
      database
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', 'dev-player-one', 'Dev', 'ACTIVE', ?, ?)"
        )
        .bind(DEV_PLAYER_ID, NOW, NOW),
      database
        .prepare(
          "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES ('farm_missing', 0, 0, 'SOIL', 'IDLE', 1, ?)"
        )
        .bind(NOW)
    ];

    await expect(database.batch(statements)).rejects.toThrow();
    expect(await database.prepare("SELECT COUNT(*) AS count FROM players").first()).toEqual({ count: 0 });

    await seedPlayer(database);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM players").first()).toEqual({ count: 1 });
    database.close();
  });

  it("serializes overlapping batches instead of nesting transactions", async () => {
    const database = createDatabase();
    const insert = (id: string) =>
      database
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Dev', 'ACTIVE', ?, ?)"
        )
        .bind(id, `subject-for-${id}`, NOW, NOW);

    await Promise.all([
      database.batch([insert("player_11111111-1111-4111-8111-111111111111")]),
      database.batch([insert("player_22222222-2222-4222-8222-222222222222")]),
      database.batch([insert("player_33333333-3333-4333-8333-333333333333")])
    ]);

    expect(await database.prepare("SELECT COUNT(*) AS count FROM players").first()).toEqual({ count: 3 });
    database.close();
  });

  it("releases the database handle when closed", () => {
    const database = createDatabase();
    database.close();
    expect(() => database.prepare("SELECT 1")).toThrow();
  });
});

describe("development API host", () => {
  it("applies migrations and serves the development API", async () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    writeDevVars(root, VALID_DEV_VARS);

    const host = trackHost(createDevApiHost({ repoRoot: root }));
    expect(host.configured).toBe(true);
    expect(host.appliedMigrations).toEqual(MIGRATION_NAMES);
    expect(host.databasePath).toBe(join(root, ".wrangler", "dev-local.sqlite"));
    expect(existsSync(host.databasePath)).toBe(true);

    const health = await host.handle(new Request("https://dev.local/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, data: { status: "ok" } });

    const anonymous = await host.handle(new Request("https://dev.local/wallet"));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });

    const bootstrap = await host.handle(authedRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(bootstrap.status).toBe(200);
    expect(await bootstrap.json()).toEqual({
      ok: true,
      data: { player: { playerId: DEV_PLAYER_ID, status: "ACTIVE", created: true } }
    });

    // Onboarding, not a command: the bootstrap hands a new player their one-time starter seeds, and
    // a later bootstrap finds the receipt and grants nothing more.
    const inventory = await host.handle(authedRequest("/inventory"));
    expect(await inventory.json()).toEqual({
      ok: true,
      data: {
        items: [
          { itemDefinitionId: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", quantity: 36 }
        ]
      }
    });
    await host.handle(authedRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(await (await host.handle(authedRequest("/inventory"))).json()).toMatchObject({
      ok: true,
      data: { items: [{ itemDefinitionId: "item_carrot_seed", quantity: 36 }] }
    });

    const created = await host.handle(
      authedRequest("/farms", { method: "POST", body: JSON.stringify({ name: "Host Farm" }), headers: { "content-type": "application/json" } })
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      ok: true,
      data: { farm: { ownerPlayerId: DEV_PLAYER_ID, name: "Host Farm" }, membership: { role: "OWNER" } }
    });
  });

  it("reuses an existing database file across hosts", async () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    writeDevVars(root, VALID_DEV_VARS);
    const databasePath = join(root, "custom.sqlite");

    const first = trackHost(createDevApiHost({ repoRoot: root, databasePath }));
    expect(first.appliedMigrations).toEqual(MIGRATION_NAMES);
    await first.handle(authedRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    first.close();

    const second = trackHost(createDevApiHost({ repoRoot: root, databasePath }));
    expect(second.appliedMigrations).toEqual([]);
    const bootstrap = await second.handle(authedRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(await bootstrap.json()).toMatchObject({ ok: true, data: { player: { created: false } } });
  });

  it("stays fail-closed when no development identity is configured", async () => {
    const root = createFakeRepoRoot();
    dirs.push(root);

    const host = trackHost(createDevApiHost({ repoRoot: root }));
    expect(host.configured).toBe(false);

    const wallet = await host.handle(authedRequest("/wallet"));
    expect(wallet.status).toBe(401);
    expect(await wallet.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });

    const bootstrap = await host.handle(authedRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(bootstrap.status).toBe(401);
    expect(await bootstrap.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });

    const players = new DatabaseSync(host.databasePath);
    expect(players.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });
    players.close();
  });

  it("stays fail-closed when the token is present but development auth is disabled", async () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    writeDevVars(root, VALID_DEV_VARS.replace("DEV_AUTH_ENABLED=true", "DEV_AUTH_ENABLED=false"));

    const host = trackHost(createDevApiHost({ repoRoot: root }));
    expect(host.configured).toBe(false);
    const wallet = await host.handle(authedRequest("/wallet"));
    expect(wallet.status).toBe(401);
  });

  it("keeps the committed migration files as the single source of truth", () => {
    const root = createFakeRepoRoot();
    dirs.push(root);
    writeDevVars(root, VALID_DEV_VARS);
    const host = trackHost(createDevApiHost({ repoRoot: root }));

    const reader = new DatabaseSync(host.databasePath);
    const tables = reader
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    for (const expected of [
      "crop_instances",
      "economy_ledger",
      "farm_members",
      "farm_tiles",
      "farms",
      "harvest_settlements",
      "idempotency_keys",
      "inventory_items",
      "players",
      "starter_seed_grants",
      "wallets"
    ]) {
      expect(names, expected).toContain(expected);
    }
    reader.close();
  });
});