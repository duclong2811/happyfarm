import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationError, type IdempotencyRecord } from "@happy-farm/application";
import {
  mineIdFor,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseItemDefinitionId,
  type EconomyMutation
} from "@happy-farm/domain";
import { D1MineRepository } from "../../workers/api/src/d1-repositories";
import { allMigrationNames, migrationSql, schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Migration 0044 and the mine repository's guarded writes.
 *
 * The migration rebuilds the ledger to admit the mine-upgrade reason; what it must not do is lose a
 * row or a trigger. The repository's writes must refuse to settle against state that moved between
 * the read and the write, and refuse whole - no ore, no experience, no gold, no materials.
 */

const MINE_ID = mineIdFor(FARM_ONE_ID, 0);
const FINGERPRINT = "f".repeat(64);

function seedPlayerAndFarm(db: NodeD1Database): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'miner', 'Miner', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Đảo', ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
}

describe("migration 0044: farm mines and the ledger rebuild", () => {
  it("keeps every ledger row and every trigger, and admits only the mine pairing", () => {
    const before = allMigrationNames().filter((name) => name < "0044");
    const db = new NodeD1Database(before.map((name) => migrationSql(name)).join("\n"));
    try {
      seedPlayerAndFarm(db);
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_eeeeeeee-eeee-4eee-8eee-000000000001', ?, 'currency_gold', -100, 1000, 900, 1, 'WAREHOUSE_UPGRADE', 'WAREHOUSE', 'warehouse_11111111-1111-4111-8111-111111111111', 'request-0001', ?)"
        )
        .run(PLAYER_ONE_ID, NOW);
      const triggers = (): string[] =>
        (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
      const triggersBefore = triggers();

      db.sqlite.exec(migrationSql("0044_farm_mines.sql"));

      expect(db.sqlite.prepare("SELECT id, delta, reason FROM economy_ledger").all()).toEqual([
        { id: "econ_eeeeeeee-eeee-4eee-8eee-000000000001", delta: -100, reason: "WAREHOUSE_UPGRADE" }
      ]);
      expect(triggers()).toEqual([...triggersBefore, "idempotency_mine_upgrade_requires_ledger"].sort());
      // The wallet triggers came back with the table: a ledger row still moves the balance.
      const insert = db.sqlite.prepare(
        "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', -500, 900, 400, 2, ?, ?, ?, 'request-0002', ?)"
      );
      expect(() => insert.run("econ_eeeeeeee-eeee-4eee-8eee-000000000002", PLAYER_ONE_ID, "MINE_UPGRADE", "WAREHOUSE", MINE_ID, NOW)).toThrow();
      expect(() => insert.run("econ_eeeeeeee-eeee-4eee-8eee-000000000002", PLAYER_ONE_ID, "WAREHOUSE_UPGRADE", "MINE", MINE_ID, NOW)).toThrow();
      expect(() => insert.run("econ_eeeeeeee-eeee-4eee-8eee-000000000002", PLAYER_ONE_ID, "MINE_UPGRADE", "MINE", "warehouse_x", NOW)).toThrow();
      insert.run("econ_eeeeeeee-eeee-4eee-8eee-000000000002", PLAYER_ONE_ID, "MINE_UPGRADE", "MINE", MINE_ID, NOW);
      expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 400, version: 3 });
      expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
      // A mine-upgrade receipt cannot exist without its ledger row.
      const receipt = db.sqlite.prepare(
        "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'MINE_UPGRADE', ?, ?, 'COMPLETED', ?, '{}', ?)"
      );
      expect(() => receipt.run(PLAYER_ONE_ID, "request-0003", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000009", NOW)).toThrow();
      receipt.run(PLAYER_ONE_ID, "request-0002", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000002", NOW);
    } finally {
      db.close();
    }
  });

  it("holds one mine per farm slot, with sane numbers", () => {
    const db = new NodeD1Database(schemaSql());
    try {
      seedPlayerAndFarm(db);
      const insert = db.sqlite.prepare(
        "INSERT INTO farm_mines (id, farm_id, slot, level, banked_milli, accrued_since, ore_dug_total, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)"
      );
      insert.run(MINE_ID, FARM_ONE_ID, 0, 1, 0, NOW, NOW, NOW);
      expect(() => insert.run(mineIdFor(FARM_ONE_ID, 1), FARM_ONE_ID, 0, 1, 0, NOW, NOW, NOW)).toThrow();
      expect(() => insert.run(mineIdFor(FARM_ONE_ID, 2), FARM_ONE_ID, 2, 0, 0, NOW, NOW, NOW)).toThrow();
      expect(() => insert.run(mineIdFor(FARM_ONE_ID, 3), FARM_ONE_ID, 3, 1, -1, NOW, NOW, NOW)).toThrow();
      expect(() => insert.run("stone_1", FARM_ONE_ID, 4, 1, 0, NOW, NOW, NOW)).toThrow();
    } finally {
      db.close();
    }
  });
});

describe("mine repository guarded writes", () => {
  let db: NodeD1Database;
  let mines: D1MineRepository;

  beforeEach(async () => {
    db = new NodeD1Database(schemaSql());
    seedPlayerAndFarm(db);
    mines = new D1MineRepository(db);
    await mines.ensureSlots(FARM_ONE_ID, [{ id: MINE_ID, slot: 0 }], NOW);
  });

  afterEach(() => {
    db.close();
  });

  function receipt(operation: string, requestId: string, resourceId: string): IdempotencyRecord {
    return {
      actorPlayerId: PLAYER_ONE_ID,
      operation,
      requestId,
      payloadFingerprint: FINGERPRINT,
      resourceId,
      responseJson: "{}",
      status: "COMPLETED",
      createdAt: NOW
    };
  }

  it("refuses a dig against a mine version that has moved, and writes nothing", async () => {
    const [mine] = await mines.listByFarm(FARM_ONE_ID);
    if (mine === undefined) throw new Error("mine was not created");
    const stale = { ...mine, version: mine.version + 7 };
    const attempt = mines.digAtomically(
      {
        playerId: PLAYER_ONE_ID,
        mine: stale,
        change: { level: 1, bankedMilli: 0, accruedSince: NOW, oreDugTotal: 60, marker: "dig:request-0010" },
        addition: { kind: "ADD", playerId: PLAYER_ONE_ID, itemDefinitionId: parseItemDefinitionId("item_ore"), quantity: 60, maxQuantity: 1_000_000, timestamp: NOW },
        award: null,
        timestamp: NOW
      },
      receipt("MINE_COLLECT", "request-0010", MINE_ID)
    );
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "MINE_CONFLICT");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys").get()).toEqual({ n: 0 });
    expect((await mines.listByFarm(FARM_ONE_ID))[0]).toEqual(mine);
  });

  it("refuses an upgrade whose materials moved after they were read, and charges nothing", async () => {
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_wood', 100, ?, 1), (?, 'item_ore', 200, ?, 1)")
      .run(PLAYER_ONE_ID, NOW, PLAYER_ONE_ID, NOW);
    const [mine] = await mines.listByFarm(FARM_ONE_ID);
    if (mine === undefined) throw new Error("mine was not created");
    const transactionId = parseEconomyTransactionId("econ_eeeeeeee-eeee-4eee-8eee-000000000010");
    const economy: EconomyMutation = {
      transactionId,
      playerId: PLAYER_ONE_ID,
      currencyDefinitionId: parseCurrencyDefinitionId("currency_gold"),
      delta: -500,
      balanceBefore: 1000,
      balanceAfter: 500,
      expectedWalletVersion: 1,
      reason: "MINE_UPGRADE",
      referenceType: "MINE",
      referenceId: MINE_ID,
      requestId: "request-0011",
      createdAt: NOW
    };
    // Someone spent wood between the read and the write: the version the caller holds is stale.
    db.sqlite.prepare("UPDATE inventory_items SET quantity = 90, version = 2 WHERE item_definition_id = 'item_wood'").run();
    const attempt = mines.upgradeAtomically(
      {
        playerId: PLAYER_ONE_ID,
        mine,
        change: { level: 2, bankedMilli: 0, accruedSince: NOW, oreDugTotal: 0, marker: transactionId },
        economy,
        removals: [
          { kind: "REMOVE", playerId: PLAYER_ONE_ID, itemDefinitionId: parseItemDefinitionId("item_wood"), quantity: 80, timestamp: NOW },
          { kind: "REMOVE", playerId: PLAYER_ONE_ID, itemDefinitionId: parseItemDefinitionId("item_ore"), quantity: 150, timestamp: NOW }
        ],
        expectedInventory: [
          { playerId: PLAYER_ONE_ID, itemDefinitionId: parseItemDefinitionId("item_wood"), quantity: 100, version: 1, updatedAt: NOW },
          { playerId: PLAYER_ONE_ID, itemDefinitionId: parseItemDefinitionId("item_ore"), quantity: 200, version: 1, updatedAt: NOW }
        ],
        timestamp: NOW
      },
      receipt("MINE_UPGRADE", "request-0011", transactionId)
    );
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "MINE_CONFLICT");
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 1000, version: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT item_definition_id, quantity FROM inventory_items ORDER BY item_definition_id").all()).toEqual([
      { item_definition_id: "item_ore", quantity: 200 },
      { item_definition_id: "item_wood", quantity: 90 }
    ]);
    expect((await mines.listByFarm(FARM_ONE_ID))[0]?.level).toBe(1);
  });
});
