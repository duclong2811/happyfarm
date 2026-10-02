import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeploymentWorker, type DeploymentEnv } from "../../workers/api/src/index";
import { playerIdForAccessSubject } from "../../workers/api/src/access-auth";
import { readStarterGrantPolicy } from "../../workers/api/src/player-onboarding";
import { NodeD1Database } from "../support/node-d1";

/**
 * What the deployed Worker does for a visitor the world has never seen before.
 *
 * The alpha build created a Player row and stopped there, so a new player arrived with 0 gold and 0
 * seeds, could not afford a seed, and could not plant. These tests hold the fix: onboarding hands
 * over the one-time package, exactly once, and nothing a caller sends can change its contents or
 * repeat it.
 */
const MIGRATIONS = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql",
  "0009_starter_package.sql",
  "0015_player_identities.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const AUDIENCE = "test-audience-tag";

/** The verifier seam: a token is trusted exactly when it names a subject this stub knows. */
const verifier = {
  verify(token: string): Promise<Record<string, unknown> | null> {
    if (!token.startsWith("token-for-")) return Promise.resolve(null);
    return Promise.resolve({
      iss: TEAM_DOMAIN,
      sub: token.slice("token-for-".length),
      aud: [AUDIENCE],
      exp: Math.floor(Date.now() / 1000) + 3600
    });
  }
};

function deploymentEnv(db: NodeD1Database, extra: Partial<DeploymentEnv> = {}): DeploymentEnv {
  return { DB: db, ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUDIENCE, ...extra };
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: string;
}

function request(path: string, subject: string, init: RequestOptions = {}): Request {
  return new Request(`https://staging.test/api${path}`, {
    headers: { "cf-access-jwt-assertion": `token-for-${subject}` },
    ...(init.method === undefined ? {} : { method: init.method }),
    ...(init.body === undefined ? {} : { body: init.body })
  });
}

describe("deployed onboarding", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
  });

  afterEach(() => {
    db.close();
  });

  it("hands a brand-new visitor exactly 100 gold and 10 carrot seeds", async () => {
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    const response = await handle(request("/wallet", "visitor-one"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", displayNameKey: "currency.gold.name", balance: 100 }] }
    });

    const inventory = await handle(request("/inventory", "visitor-one"));
    await expect(inventory.json()).resolves.toEqual({
      ok: true,
      data: { items: [{ itemDefinitionId: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", quantity: 10 }] }
    });
  });

  it("grants nothing more when the same visitor comes back, reconnects, or retries", async () => {
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await handle(request("/wallet", "visitor-one"))).status).toBe(200);
    }
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_carrot_seed'").all()
    ).toEqual([{ quantity: 10 }]);
  });

  it("keeps one package when a visitor's first requests race each other", async () => {
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    await Promise.all([
      handle(request("/wallet", "visitor-one")),
      handle(request("/inventory", "visitor-one")),
      handle(request("/shop", "visitor-one")),
      handle(request("/progression", "visitor-one"))
    ]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets").get()).toEqual({ balance: 100 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items").get()).toEqual({ quantity: 10 });
  });

  it("gives two different visitors their own package and their own player", async () => {
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    await handle(request("/wallet", "visitor-one"));
    await handle(request("/wallet", "visitor-two"));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 2 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets ORDER BY player_id").all()).toEqual([
      { balance: 100 },
      { balance: 100 }
    ]);
    const expected = await playerIdForAccessSubject(TEAM_DOMAIN, "visitor-one");
    expect(db.sqlite.prepare("SELECT id FROM players ORDER BY id").all()).toContainEqual({ id: expected });
  });

  it("leaves an existing player's balance alone under the default policy", async () => {
    // A player the world already knows - a seeded tester, someone who played before the package - is
    // not silently handed gold by a page refresh.
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    const playerId = await playerIdForAccessSubject(TEAM_DOMAIN, "returning-player");
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Tester', 'ACTIVE', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')"
      )
      .run(playerId, TEAM_DOMAIN, "returning-player");

    const response = await handle(request("/wallet", "returning-player"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { wallets: [] } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 0 });
  });

  it("repairs an existing player only when the deployment opts into it", async () => {
    const handle = createDeploymentWorker(
      deploymentEnv(db, { STARTER_GRANT_POLICY: "ALL_UNRECEIPTED" }),
      { verifier }
    );
    const playerId = await playerIdForAccessSubject(TEAM_DOMAIN, "alpha-tester");
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Tester', 'ACTIVE', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')"
      )
      .run(playerId, TEAM_DOMAIN, "alpha-tester");

    expect((await handle(request("/wallet", "alpha-tester"))).status).toBe(200);
    expect(db.sqlite.prepare("SELECT balance FROM wallets").get()).toEqual({ balance: 100 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items").get()).toEqual({ quantity: 10 });
    // Still one receipt: the repair is the same grant, not a second one.
    await handle(request("/wallet", "alpha-tester"));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
  });

  it("still refuses a visitor with no verified identity, and grants them nothing", async () => {
    const handle = createDeploymentWorker(deploymentEnv(db), { verifier });
    const response = await handle(new Request("https://staging.test/api/wallet"));
    expect(response.status).toBe(401);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 0 });
  });

  it("reads an unrecognised or absent policy as the safe default", () => {
    expect(readStarterGrantPolicy(undefined)).toBe("NEW_PLAYERS");
    expect(readStarterGrantPolicy("")).toBe("NEW_PLAYERS");
    expect(readStarterGrantPolicy("true")).toBe("NEW_PLAYERS");
    expect(readStarterGrantPolicy("new_players")).toBe("NEW_PLAYERS");
    expect(readStarterGrantPolicy(" all_unreceipted ")).toBe("ALL_UNRECEIPTED");
  });
});
