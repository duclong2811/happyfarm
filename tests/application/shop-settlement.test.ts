import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuyItem, EconomyService, InventoryService, SellItem, type Clock, type EconomyTransactionIdGenerator } from "@happy-farm/application";
import { MAX_INVENTORY_QUANTITY, MAX_WALLET_BALANCE, parseEconomyTransactionId } from "@happy-farm/domain";
import { D1CropRepository, D1EconomySettlementRepository, D1InventoryRepository, D1WalletRepository } from "../../workers/api/src/d1-repositories";
import { GameDataCurrencyDefinitions, GameDataItemDefinitions, GameDataShopEntries, Sha256Fingerprint } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");
const clock: Clock = { now: () => NOW };

function ids(): EconomyTransactionIdGenerator {
  let sequence = 1;
  return { newEconomyTransactionId: () => parseEconomyTransactionId(`econ_dddddddd-dddd-4ddd-8ddd-${String(sequence++).padStart(12, "0")}`) };
}

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)");
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
}

function services(db: NodeD1Database) {
  const inventory = new D1InventoryRepository(db);
  const wallets = new D1WalletRepository(db);
  const dependencies = {
    shops: new GameDataShopEntries(), currencies: new GameDataCurrencyDefinitions(), wallets, inventory,
    idempotency: new D1CropRepository(db), settlement: new D1EconomySettlementRepository(db),
    economyService: new EconomyService(ids(), clock), inventoryService: new InventoryService(new GameDataItemDefinitions(), clock),
    fingerprints: new Sha256Fingerprint(), clock
  };
  return { buy: new BuyItem(dependencies), sell: new SellItem(dependencies), inventory, wallets };
}

function wallet(db: NodeD1Database, balance: number, player = PLAYER_ONE_ID): void {
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)").run(player, balance, NOW, NOW);
}

function item(db: NodeD1Database, definition: string, quantity: number, player = PLAYER_ONE_ID): void {
  db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)").run(player, definition, quantity, NOW);
}

describe("authoritative shop settlement", () => {
  let db: NodeD1Database;
  beforeEach(() => { db = new NodeD1Database(migration); seedPlayers(db); });
  afterEach(() => { db.close(); });

  it("buys and sells at server prices, versions both resources, and reconciles the ledger", async () => {
    wallet(db, 100);
    const { buy, sell } = services(db);
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "buy_loop_001", shopEntryId: "shop_carrot", quantity: 10 })).resolves.toMatchObject({ amountSpent: 40, newBalance: 60 });
    await expect(sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "sell_loop_001", shopEntryId: "shop_carrot", quantity: 4 })).resolves.toMatchObject({ amountReceived: 8, newBalance: 68 });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 68, version: 3 });
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual({ quantity: 6, version: 2 });
    const ledger = db.sqlite.prepare("SELECT delta, balance_before, balance_after FROM economy_ledger ORDER BY rowid").all() as Array<{ delta: number; balance_before: number; balance_after: number }>;
    expect(ledger).toEqual([{ delta: -40, balance_before: 100, balance_after: 60 }, { delta: 8, balance_before: 60, balance_after: 68 }]);
    expect(100 + ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(68);
  });

  it("replays successful requests exactly once, rejects payload mismatch, and isolates operations", async () => {
    wallet(db, 100); item(db, "item_carrot", 10);
    const { buy, sell } = services(db);
    const buyCommand = { requestId: "shared_request_001", shopEntryId: "shop_carrot", quantity: 1 };
    const first = await buy.execute({ playerId: PLAYER_ONE_ID }, buyCommand);
    expect(await buy.execute({ playerId: PLAYER_ONE_ID }, buyCommand)).toEqual(first);
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, { ...buyCommand, quantity: 2 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await sell.execute({ playerId: PLAYER_ONE_ID }, buyCommand);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 98, version: 3 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 2 });
  });

  it("scopes identical request IDs to the authenticated actor", async () => {
    wallet(db, 20); wallet(db, 20, PLAYER_TWO_ID);
    const { buy } = services(db);
    const command = { requestId: "same_actor_request", shopEntryId: "shop_carrot", quantity: 1 };
    await buy.execute({ playerId: PLAYER_ONE_ID }, command);
    await buy.execute({ playerId: PLAYER_TWO_ID }, command);
    expect(db.sqlite.prepare("SELECT player_id, balance FROM wallets ORDER BY player_id").all()).toEqual([{ player_id: PLAYER_ONE_ID, balance: 16 }, { player_id: PLAYER_TWO_ID, balance: 16 }]);
  });

  it("prevents concurrent overspend and double sale", async () => {
    wallet(db, 100); item(db, "item_carrot", 10);
    const { buy, sell } = services(db);
    const buys = await Promise.allSettled([
      buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "overspend_buy_a", shopEntryId: "shop_wheat", quantity: 14 }),
      buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "overspend_buy_b", shopEntryId: "shop_wheat", quantity: 14 })
    ]);
    expect(buys.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const sells = await Promise.allSettled([
      sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "double_sell_a", shopEntryId: "shop_carrot", quantity: 10 }),
      sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "double_sell_b", shopEntryId: "shop_carrot", quantity: 10 })
    ]);
    expect(sells.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 36 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 2 });
  });

  it("preserves all valid concurrent sales without lost wallet updates", async () => {
    wallet(db, 0); item(db, "item_carrot", 2); item(db, "item_wheat", 3);
    const { sell } = services(db);
    await Promise.all([
      sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "valid_sell_carrot", shopEntryId: "shop_carrot", quantity: 2 }),
      sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "valid_sell_wheat", shopEntryId: "shop_wheat", quantity: 3 })
    ]);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 13, version: 3 });
  });

  it("replays the original result without overwriting a newer balance", async () => {
    wallet(db, 100);
    const { buy } = services(db);
    const command = { requestId: "replay_race_001", shopEntryId: "shop_carrot", quantity: 1 };
    const original = await buy.execute({ playerId: PLAYER_ONE_ID }, command);
    expect(original).toMatchObject({ amountSpent: 4, newBalance: 96 });
    const [replay, concurrent] = await Promise.all([
      buy.execute({ playerId: PLAYER_ONE_ID }, command),
      buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "replay_race_002", shopEntryId: "shop_carrot", quantity: 1 })
    ]);
    expect(replay).toEqual(original);
    expect(concurrent.newBalance).toBe(92);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 92, version: 3 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 2 });
  });

  it("keeps actor wallets, inventory, and replayed results isolated", async () => {
    wallet(db, 50, PLAYER_TWO_ID); item(db, "item_carrot", 3, PLAYER_TWO_ID);
    const { buy, sell } = services(db);
    const command = { requestId: "actor_isolation_001", shopEntryId: "shop_carrot", quantity: 1 };
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, command)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await expect(sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "actor_isolation_002", shopEntryId: "shop_carrot", quantity: 1 })).rejects.toMatchObject({ code: "INSUFFICIENT_ITEMS" });
    await expect(buy.execute({ playerId: PLAYER_TWO_ID }, command)).resolves.toMatchObject({ newBalance: 46 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_TWO_ID)).toEqual({ balance: 46 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_TWO_ID)).toEqual({ quantity: 4 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ count: 0 });
  });

  it("rejects insufficient funds/items and unknown shop entries without side effects", async () => {
    wallet(db, 3); item(db, "item_carrot", 1);
    const { buy, sell } = services(db);
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "insufficient_buy", shopEntryId: "shop_carrot", quantity: 1 })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await expect(sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "insufficient_sell", shopEntryId: "shop_carrot", quantity: 2 })).rejects.toMatchObject({ code: "INSUFFICIENT_ITEMS" });
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "unknown_shop", shopEntryId: "shop_missing", quantity: 1 })).rejects.toMatchObject({ code: "SHOP_ENTRY_NOT_FOUND" });
    await expect(sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "unknown_sale", shopEntryId: "shop_missing", quantity: 1 })).rejects.toMatchObject({ code: "SHOP_ENTRY_NOT_FOUND" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
  });

  it("rolls back wallet overflow on sell and inventory overflow on buy", async () => {
    wallet(db, MAX_WALLET_BALANCE - 1); item(db, "item_carrot", MAX_INVENTORY_QUANTITY);
    const { buy, sell } = services(db);
    await expect(sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: "overflow_sell", shopEntryId: "shop_carrot", quantity: 1 })).rejects.toMatchObject({ code: "WALLET_LIMIT_EXCEEDED" });
    await expect(buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: "overflow_buy", shopEntryId: "shop_carrot", quantity: 1 })).rejects.toMatchObject({ code: "INVENTORY_LIMIT_EXCEEDED" });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: MAX_WALLET_BALANCE - 1, version: 1 });
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ quantity: MAX_INVENTORY_QUANTITY, version: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
  });
});

describe.each(["BUY", "SELL"] as const)("%s rollback injection", (operation) => {
  it.each([
    ["wallet preparation", { afterStatement: (index: number) => { if (index === 0) throw new Error("injected wallet failure"); } }],
    ["ledger/wallet mutation", { afterStatement: (index: number) => { if (index === 1) throw new Error("injected ledger failure"); } }],
    ["inventory mutation", { afterStatement: (index: number) => { if (index === 2) throw new Error("injected inventory failure"); } }],
    ["idempotency finalization", { afterStatement: (index: number) => { if (index === 3) throw new Error("injected idempotency failure"); } }]
  ])("rolls back after %s", async (_stage, failure) => {
    const db = new NodeD1Database(migration, failure); seedPlayers(db); wallet(db, 100); item(db, "item_carrot", 10);
    const beforeWallet = db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID);
    const beforeInventory = db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID);
    const shop = services(db);
    const action = operation === "BUY"
      ? shop.buy.execute({ playerId: PLAYER_ONE_ID }, { requestId: `rollback_buy_${_stage}`, shopEntryId: "shop_carrot", quantity: 1 })
      : shop.sell.execute({ playerId: PLAYER_ONE_ID }, { requestId: `rollback_sell_${_stage}`, shopEntryId: "shop_carrot", quantity: 1 });
    await expect(action).rejects.toThrow("injected");
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual(beforeWallet);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual(beforeInventory);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
    db.close();
  });
});
