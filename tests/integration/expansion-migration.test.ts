import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

function readMigration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

/** Everything a database has before the expansion migration is applied. */
const BEFORE_EXPANSION = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql"
]
  .map(readMigration)
  .join("\n");

const EXPANSION = readMigration("0006_farm_expansion.sql");

const TRANSACTION_ID = "econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EXPANSION_TRANSACTION_ID = "econ_ffffffff-ffff-4fff-8fff-ffffffffffff";
const FINGERPRINT = "a".repeat(64);

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare(
    "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)"
  );
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
}

function ledgerRow(
  db: NodeD1Database,
  input: {
    readonly id?: string;
    readonly reason: string;
    readonly referenceType: string;
    readonly referenceId: string;
    readonly delta?: number;
    readonly balanceBefore?: number;
    readonly balanceAfter?: number;
    readonly requestId?: string;
  }
): void {
  db.sqlite
    .prepare(
      "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', ?, ?, ?, 1, ?, ?, ?, ?, ?)"
    )
    .run(
      input.id ?? TRANSACTION_ID,
      PLAYER_ONE_ID,
      input.delta ?? -100,
      input.balanceBefore ?? 500,
      input.balanceAfter ?? 400,
      input.reason,
      input.referenceType,
      input.referenceId,
      input.requestId ?? "request_001",
      NOW
    );
}

describe("farm expansion migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(BEFORE_EXPANSION);
    seedPlayers(db);
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 500, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("copies existing history into the rebuilt table and leaves the wallet it settled untouched", () => {
    ledgerRow(db, { reason: "SHOP_BUY", referenceType: "SHOP_ENTRY", referenceId: "shop_carrot" });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 400,
      version: 2
    });

    db.sqlite.exec(EXPANSION);

    expect(db.sqlite.prepare("SELECT id, delta, reason, reference_type, reference_id FROM economy_ledger").all()).toEqual([
      { id: TRANSACTION_ID, delta: -100, reason: "SHOP_BUY", reference_type: "SHOP_ENTRY", reference_id: "shop_carrot" }
    ]);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 400,
      version: 2
    });
  });

  it("restores every index and trigger the rebuilt table has to carry", () => {
    db.sqlite.exec(EXPANSION);
    const objects = db.sqlite
      .prepare("SELECT name, type FROM sqlite_master WHERE name IN ('economy_ledger','economy_ledger_rebuilt','idx_economy_ledger_player_created','idx_economy_ledger_player_request','idx_economy_ledger_reference','economy_ledger_validate_wallet','economy_ledger_apply_wallet','economy_ledger_immutable_update','economy_ledger_immutable_delete','idempotency_expand_requires_ledger') ORDER BY name")
      .all();
    expect(objects).toEqual([
      { name: "economy_ledger", type: "table" },
      { name: "economy_ledger_apply_wallet", type: "trigger" },
      { name: "economy_ledger_immutable_delete", type: "trigger" },
      { name: "economy_ledger_immutable_update", type: "trigger" },
      { name: "economy_ledger_validate_wallet", type: "trigger" },
      { name: "idempotency_expand_requires_ledger", type: "trigger" },
      { name: "idx_economy_ledger_player_created", type: "index" },
      { name: "idx_economy_ledger_player_request", type: "index" },
      { name: "idx_economy_ledger_reference", type: "index" }
    ]);
  });

  it("keeps the rebuilt table guarded, immutable, and append-only", () => {
    db.sqlite.exec(EXPANSION);
    ledgerRow(db, { reason: "SHOP_BUY", referenceType: "SHOP_ENTRY", referenceId: "shop_carrot" });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 400,
      version: 2
    });
    // A stale wallet version, exactly as 0004's trigger refused before the rebuild.
    expect(() => {
      ledgerRow(db, {
        id: "econ_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        reason: "SHOP_BUY",
        referenceType: "SHOP_ENTRY",
        referenceId: "shop_carrot",
        delta: -1,
        balanceBefore: 500,
        balanceAfter: 499
      });
    }).toThrow();
    expect(() => db.sqlite.prepare("UPDATE economy_ledger SET delta = 1").run()).toThrow();
    expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 1 });
  });

  it("accepts a land purchase and applies it to the wallet through the same triggers", () => {
    db.sqlite.exec(EXPANSION);
    ledgerRow(db, {
      id: EXPANSION_TRANSACTION_ID,
      reason: "FARM_EXPANSION",
      referenceType: "PLOT",
      referenceId: "plot_1",
      delta: -100,
      balanceBefore: 500,
      balanceAfter: 400
    });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 400,
      version: 2
    });
    expect(
      db.sqlite.prepare("SELECT reason, reference_type, reference_id FROM economy_ledger").get()
    ).toEqual({ reason: "FARM_EXPANSION", reference_type: "PLOT", reference_id: "plot_1" });
  });

  it("refuses a row whose reason and reference kind do not belong together", () => {
    db.sqlite.exec(EXPANSION);
    const rejected = [
      { reason: "SHOP_BUY", referenceType: "PLOT", referenceId: "plot_1" },
      { reason: "SHOP_SELL", referenceType: "PLOT", referenceId: "plot_1" },
      { reason: "FARM_EXPANSION", referenceType: "SHOP_ENTRY", referenceId: "shop_carrot" },
      { reason: "FARM_EXPANSION", referenceType: "PLOT", referenceId: "shop_carrot" },
      { reason: "SHOP_BUY", referenceType: "SHOP_ENTRY", referenceId: "plot_1" },
      { reason: "GIFT", referenceType: "PLOT", referenceId: "plot_1" },
      { reason: "FARM_EXPANSION", referenceType: "OTHER", referenceId: "plot_1" },
      { reason: "FARM_EXPANSION", referenceType: "PLOT", referenceId: "not_a_plot" }
    ];
    for (const row of rejected) {
      expect(() => { ledgerRow(db, row); }).toThrow();
    }
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 500,
      version: 1
    });
  });

  it("requires a completed expansion record to point at the actor's own expansion ledger row", () => {
    db.sqlite.exec(EXPANSION);
    const insert = db.sqlite.prepare(
      "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'EXPAND_FARM', ?, ?, 'COMPLETED', ?, '{}', ?)"
    );
    expect(() => insert.run(PLAYER_ONE_ID, "expand_missing_001", FINGERPRINT, null, NOW)).toThrow();
    expect(() => insert.run(PLAYER_ONE_ID, "expand_unknown_001", FINGERPRINT, TRANSACTION_ID, NOW)).toThrow();

    ledgerRow(db, {
      id: EXPANSION_TRANSACTION_ID,
      reason: "FARM_EXPANSION",
      referenceType: "PLOT",
      referenceId: "plot_1",
      balanceBefore: 500,
      balanceAfter: 400
    });
    // The ledger row belongs to another player, so it cannot stand in for this actor's record.
    expect(() => insert.run(PLAYER_TWO_ID, "expand_other_001", FINGERPRINT, EXPANSION_TRANSACTION_ID, NOW)).toThrow();
    insert.run(PLAYER_ONE_ID, "expand_ok_001", FINGERPRINT, EXPANSION_TRANSACTION_ID, NOW);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 1 });
  });
});
