import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import productionWorker from "../../workers/api/src/index";
import { createDevWorker, type DevEnv } from "../../workers/api/src/dev-index";
import { DEV_AUTH_BOOTSTRAP_PATH, type DevAuthBindings } from "../../workers/api/src/dev-auth";
import { UnconfiguredAuthenticator } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql", "0007_seed_economy.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const DEV_PLAYER_ID = "player_33333333-3333-4333-8333-333333333333";
const DEV_ISSUER = "https://dev.happy-farm.local";
const DEV_SUBJECT = "dev-player-one";
const DEV_TOKEN = "dev-token-for-tests-0001";

const DEV_BINDINGS: DevAuthBindings = {
  DEV_AUTH_ENABLED: "true",
  DEV_AUTH_TOKEN: DEV_TOKEN,
  DEV_PLAYER_ID,
  DEV_AUTH_ISSUER: DEV_ISSUER,
  DEV_AUTH_SUBJECT: DEV_SUBJECT,
  DEV_PLAYER_DISPLAY_NAME: "Dev Player One"
};

function devEnv(db: NodeD1Database, bindings: DevAuthBindings = DEV_BINDINGS): DevEnv {
  return { DB: db, ...bindings };
}

interface DevRequestOptions {
  readonly method?: string;
  readonly token?: string | null;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function devRequest(path: string, options: DevRequestOptions = {}): Request {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token !== null) {
    headers["authorization"] = `Bearer ${options.token ?? DEV_TOKEN}`;
  }
  const body = options.body;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new Request(`https://dev.test${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body })
  });
}

function seedPlayer(db: NodeD1Database, id: string, issuer: string, subject: string): void {
  db.sqlite
    .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Seeded Player', 'ACTIVE', ?, ?)")
    .run(id, issuer, subject, NOW, NOW);
}

function seedWallet(db: NodeD1Database, playerId: string, balance: number): void {
  db.sqlite
    .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)")
    .run(playerId, balance, NOW, NOW);
}

describe("development authentication bridge", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
  });

  afterEach(() => {
    db.close();
  });

  it("fails closed when development authentication is disabled", async () => {
    const handle = createDevWorker(devEnv(db, { ...DEV_BINDINGS, DEV_AUTH_ENABLED: "false" }));
    const response = await handle(devRequest("/wallet"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("rejects a missing credential", async () => {
    const handle = createDevWorker(devEnv(db));
    const response = await handle(devRequest("/wallet", { token: null }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("rejects an incorrect token", async () => {
    const handle = createDevWorker(devEnv(db));
    const response = await handle(devRequest("/wallet", { token: "wrong-dev-token" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("rejects a credential when the server token binding is absent", async () => {
    const handle = createDevWorker(devEnv(db, { DEV_AUTH_ENABLED: "true", DEV_PLAYER_ID, DEV_AUTH_ISSUER: DEV_ISSUER, DEV_AUTH_SUBJECT: DEV_SUBJECT }));
    const response = await handle(devRequest("/wallet"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("authenticates the configured actor from the server configuration only", async () => {
    seedPlayer(db, DEV_PLAYER_ID, DEV_ISSUER, DEV_SUBJECT);
    seedPlayer(db, PLAYER_TWO_ID, "https://identity.test", "subject-two");
    seedWallet(db, DEV_PLAYER_ID, 42);
    seedWallet(db, PLAYER_TWO_ID, 999);
    const handle = createDevWorker(devEnv(db));

    const response = await handle(
      devRequest(`/wallet?playerId=${PLAYER_TWO_ID}&userId=2&walletOwner=other`, {
        headers: { "x-player-id": PLAYER_TWO_ID }
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", displayNameKey: "currency.gold.name", balance: 42 }] }
    });
  });

  it("creates exactly one configured dev player on first bootstrap and is idempotent", async () => {
    const handle = createDevWorker(devEnv(db));
    const first = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      data: { player: { playerId: DEV_PLAYER_ID, status: "ACTIVE", created: true } }
    });
    expect(db.sqlite.prepare("SELECT id, auth_issuer, auth_subject, display_name, status FROM players").all()).toEqual([
      { id: DEV_PLAYER_ID, auth_issuer: DEV_ISSUER, auth_subject: DEV_SUBJECT, display_name: "Dev Player One", status: "ACTIVE" }
    ]);

    const replay = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      data: { player: { playerId: DEV_PLAYER_ID, status: "ACTIVE", created: false } }
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 1 });
    for (const table of ["wallets", "economy_ledger", "farms", "farm_members"]) {
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    // Onboarding does write one thing: the player's one-time starter seeds, and nothing else.
    expect(
      db.sqlite
        .prepare("SELECT item_definition_id, quantity FROM inventory_items WHERE player_id = ?")
        .all(DEV_PLAYER_ID)
    ).toEqual([{ item_definition_id: "item_carrot_seed", quantity: 36 }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 1 });
  });

  it("rejects bootstrap without a valid token and writes nothing", async () => {
    const handle = createDevWorker(devEnv(db));
    const unauthenticated = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST", token: null }));
    expect(unauthenticated.status).toBe(401);
    const wrongToken = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST", token: "wrong-dev-token" }));
    expect(wrongToken.status).toBe(401);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });
  });

  it("never accepts client-supplied identity on bootstrap and keeps the configured identity", async () => {
    const handle = createDevWorker(devEnv(db));
    const injected = await handle(
      devRequest(DEV_AUTH_BOOTSTRAP_PATH, {
        method: "POST",
        body: JSON.stringify({ playerId: PLAYER_TWO_ID, issuer: "https://evil.test", subject: "evil", role: "OWNER", balance: 9999, inventory: [] })
      })
    );
    expect(injected.status).toBe(400);
    expect(await injected.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });

    const accepted = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }));
    expect(accepted.status).toBe(200);
    expect(db.sqlite.prepare("SELECT id, auth_issuer, auth_subject FROM players").all()).toEqual([
      { id: DEV_PLAYER_ID, auth_issuer: DEV_ISSUER, auth_subject: DEV_SUBJECT }
    ]);
  });

  it("only serves the bootstrap route for POST", async () => {
    const handle = createDevWorker(devEnv(db));
    const response = await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "RESOURCE_NOT_FOUND" } });
  });

  it("unblocks authenticated farm creation once the dev player exists", async () => {
    const handle = createDevWorker(devEnv(db));
    const beforeBootstrap = await handle(devRequest("/farms", { method: "POST", body: JSON.stringify({ name: "Dev Farm" }) }));
    expect(beforeBootstrap.status).toBe(400);
    expect(await beforeBootstrap.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    expect((await handle(devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }))).status).toBe(200);
    const created = await handle(devRequest("/farms", { method: "POST", body: JSON.stringify({ name: "Dev Farm" }) }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      ok: true,
      data: { farm: { ownerPlayerId: DEV_PLAYER_ID }, membership: { playerId: DEV_PLAYER_ID, role: "OWNER" } }
    });
  });
});

describe("production entrypoint isolation", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
  });

  afterEach(() => {
    db.close();
  });

  it("keeps the production authenticator fail-closed", async () => {
    expect(await new UnconfiguredAuthenticator().authenticate()).toBeNull();
  });

  it("gives the development token zero authority in production wiring", async () => {
    const response = await productionWorker.fetch(
      devRequest("/farms", { method: "POST", body: JSON.stringify({ name: "Production Farm" }) }),
      { DB: db }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 0 });
  });

  it("does not expose the development bootstrap route in production", async () => {
    const response = await productionWorker.fetch(
      devRequest(DEV_AUTH_BOOTSTRAP_PATH, { method: "POST" }),
      { DB: db }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "RESOURCE_NOT_FOUND" } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });
  });
});
