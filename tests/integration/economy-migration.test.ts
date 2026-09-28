import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

describe("wallet and economy ledger migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    const insert = db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)");
    insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
    insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("enforces wallet identity, bounds, version, and player foreign key", () => {
    const insert = db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, ?, ?, ?)");
    insert.run(PLAYER_ONE_ID, 0, 1, NOW, NOW);
    expect(() => insert.run(PLAYER_ONE_ID, 0, 1, NOW, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO wallets VALUES (?, 'currency_gold', -1, 1, ?, ?)").run(PLAYER_TWO_ID, NOW, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO wallets VALUES (?, 'currency_gold', 0, 0, ?, ?)").run(PLAYER_TWO_ID, NOW, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO wallets VALUES ('player_ffffffff-ffff-4fff-8fff-ffffffffffff', 'currency_gold', 0, 1, ?, ?)").run(NOW, NOW)).toThrow();
  });

  it("enforces the ledger equation, stable values, guarded wallet version, and immutability", () => {
    db.sqlite.prepare("INSERT INTO wallets VALUES (?, 'currency_gold', 10, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const insert = db.sqlite.prepare("INSERT INTO economy_ledger VALUES ('econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ?, 'currency_gold', 5, 10, ?, 1, 'SHOP_SELL', 'SHOP_ENTRY', 'shop_carrot', 'request_001', ?)");
    expect(() => insert.run(PLAYER_ONE_ID, 14, NOW)).toThrow();
    insert.run(PLAYER_ONE_ID, 15, NOW);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 15, version: 2 });
    expect(() => db.sqlite.prepare("UPDATE economy_ledger SET delta = 4").run()).toThrow();
    expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
  });

  it("rejects a ledger row that claims a stale wallet version and applies the matching one", () => {
    db.sqlite.prepare("INSERT INTO wallets VALUES (?, 'currency_gold', 10, 3, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const insert = db.sqlite.prepare("INSERT INTO economy_ledger VALUES (?, ?, 'currency_gold', 5, 10, 15, ?, 'SHOP_SELL', 'SHOP_ENTRY', 'shop_carrot', 'request_001', ?)");
    expect(() => insert.run("econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", PLAYER_ONE_ID, 2, NOW)).toThrow();
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 10, version: 3 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    insert.run("econ_ffffffff-ffff-4fff-8fff-ffffffffffff", PLAYER_ONE_ID, 3, NOW);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 15, version: 4 });
  });

  it("enforces stable ledger reasons, references, request IDs, and non-zero deltas", () => {
    db.sqlite.prepare("INSERT INTO wallets VALUES (?, 'currency_gold', 10, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const insert = db.sqlite.prepare("INSERT INTO economy_ledger VALUES (?, ?, 'currency_gold', ?, 10, ?, 1, ?, ?, ?, ?, ?)");
    const transactionId = "econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect(() => insert.run(transactionId, PLAYER_ONE_ID, 5, 15, "GIFT", "SHOP_ENTRY", "shop_carrot", "request_001", NOW)).toThrow();
    expect(() => insert.run(transactionId, PLAYER_ONE_ID, 5, 15, "SHOP_SELL", "OTHER", "shop_carrot", "request_001", NOW)).toThrow();
    expect(() => insert.run(transactionId, PLAYER_ONE_ID, 5, 15, "SHOP_SELL", "SHOP_ENTRY", "not_a_shop", "request_001", NOW)).toThrow();
    expect(() => insert.run(transactionId, PLAYER_ONE_ID, 5, 15, "SHOP_SELL", "SHOP_ENTRY", "shop_carrot", "short", NOW)).toThrow();
    expect(() => insert.run(transactionId, PLAYER_ONE_ID, 0, 10, "SHOP_SELL", "SHOP_ENTRY", "shop_carrot", "request_001", NOW)).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 10, version: 1 });
  });
});
