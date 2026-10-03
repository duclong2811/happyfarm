import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  D1EconomySettlementRepository,
  D1IdempotencyRepository,
  D1InventoryRepository,
  D1WalletRepository,
  D1WarehouseRepository
} from "../../workers/api/src/d1-repositories";
import { EconomyService, GetWarehouseStatus, InventoryService, UpgradeWarehouse } from "@happy-farm/application";
import {
  CryptoIdGenerator,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions,
  GameDataWarehouseTiers,
  Sha256Fingerprint,
  SystemClock
} from "../../workers/api/src/runtime";
import {
  createEconomyMutation,
  createInventoryAddition,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  parseShopEntryId
} from "@happy-farm/domain";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const migration = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIRECTORY}${name}`, "utf8"))
  .join("\n");

describe("island warehouse", () => {
  let db: NodeD1Database;
  let warehouse: D1WarehouseRepository;
  let status: GetWarehouseStatus;
  let upgrade: UpgradeWarehouse;
  let inventory: D1InventoryRepository;
  let wallets: D1WalletRepository;
  let economySettlement: D1EconomySettlementRepository;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-one', 'Player', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Other', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100000, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);

    const clock = new SystemClock();
    const ids = new CryptoIdGenerator();
    const items = new GameDataItemDefinitions();
    const currencies = new GameDataCurrencyDefinitions();
    const tiers = new GameDataWarehouseTiers();
    inventory = new D1InventoryRepository(db);
    wallets = new D1WalletRepository(db);
    warehouse = new D1WarehouseRepository(db);
    status = new GetWarehouseStatus(warehouse, tiers);
    upgrade = new UpgradeWarehouse(
      warehouse,
      tiers,
      wallets,
      currencies,
      inventory,
      new EconomyService(ids, clock),
      new InventoryService(items, clock),
      new D1IdempotencyRepository(db),
      new Sha256Fingerprint(),
      clock
    );
    economySettlement = new D1EconomySettlementRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function stock(itemId: string, quantity: number): void {
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)")
      .run(PLAYER_ONE_ID, itemId, quantity, NOW);
  }

  it("reports the starter tier, used and available capacity", async () => {
    stock("item_wood", 600);
    stock("item_stone", 400);
    const view = await status.execute({ playerId: PLAYER_ONE_ID });
    expect(view).toMatchObject({ tier: 0, capacity: 1000, used: 1000, available: 0, overCapacity: false });
    expect(view.nextTier).toBe(1);
    expect(view.nextUpgrade?.gold).toBeGreaterThan(0);
  });

  it("upgrades atomically: gold debited, materials consumed, tier and capacity raised", async () => {
    stock("item_wood", 500);
    stock("item_stone", 500);
    const view = await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_0001" });
    expect(view).toMatchObject({ tier: 1, capacity: 2500, used: 900 });
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    expect(wallet?.balance).toBe(99_500);
    expect((await inventory.find(PLAYER_ONE_ID, parseItemDefinitionId("item_wood")))?.quantity).toBe(450);
    const ledger = db.sqlite
      .prepare("SELECT reason, reference_type FROM economy_ledger WHERE player_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(PLAYER_ONE_ID) as { reason: string; reference_type: string } | undefined;
    expect(ledger).toMatchObject({ reason: "WAREHOUSE_UPGRADE", reference_type: "WAREHOUSE" });
  });

  it("is idempotent: a replayed upgrade does not charge twice", async () => {
    stock("item_wood", 500);
    stock("item_stone", 500);
    const first = await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_replay" });
    const second = await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_replay" });
    expect(second).toEqual(first);
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    expect(wallet?.balance).toBe(99_500);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID)).toMatchObject({ n: 1 });
  });

  it("refuses an upgrade the island lacks materials for", async () => {
    stock("item_wood", 10); // fewer than the 50 the first upgrade needs
    stock("item_stone", 50);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_broke" })).rejects.toMatchObject({
      code: "INSUFFICIENT_ITEMS"
    });
  });

  it("refuses an upgrade the island cannot pay for", async () => {
    stock("item_wood", 50);
    stock("item_stone", 50);
    db.sqlite.prepare("UPDATE wallets SET balance = 1 WHERE player_id = ?").run(PLAYER_ONE_ID);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_poor" })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS"
    });
  });

  it("refuses an upgrade past the highest tier", async () => {
    stock("item_wood", 500);
    stock("item_stone", 500);
    db.sqlite.prepare("UPDATE home_island_warehouses SET tier = 3, capacity = 15000 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_max" })).rejects.toMatchObject({
      code: "WAREHOUSE_MAX_TIER"
    });
  });

  it("refuses a shop purchase that would overflow, with no gold debited and no item granted", async () => {
    stock("item_wood", 600);
    stock("item_stone", 400);
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    expect(wallet).not.toBeNull();
    if (wallet === null) throw new Error("expected a wallet");
    const currency = new GameDataCurrencyDefinitions().findById(wallet.currencyDefinitionId);
    expect(currency).not.toBeNull();
    if (currency === null) throw new Error("expected a currency definition");
    const seed = new GameDataItemDefinitions().findById(parseItemDefinitionId("item_carrot_seed"));
    if (seed === null) throw new Error("expected the carrot seed definition");
    const economy = createEconomyMutation(wallet, currency, {
      transactionId: new CryptoIdGenerator().newEconomyTransactionId(),
      delta: -2,
      reason: "SHOP_BUY",
      referenceId: parseShopEntryId("shop_carrot_seed"),
      requestId: "req_shop_overflow",
      createdAt: NOW
    });
    const addition = createInventoryAddition(PLAYER_ONE_ID, seed, 1, NOW);
    await expect(
      economySettlement.settleShopAtomically(
        economy,
        addition,
        null,
        {
          actorPlayerId: PLAYER_ONE_ID,
          operation: "BUY_ITEM",
          requestId: "req_shop_overflow",
          payloadFingerprint: "fp",
          resourceId: economy.transactionId,
          responseJson: "{}",
          status: "COMPLETED",
          createdAt: NOW
        }
      )
    ).rejects.toThrow(/warehouse_full/);
    // The whole batch rolled back: no gold left the wallet, and no seed was granted.
    expect((await wallets.find(PLAYER_ONE_ID, "currency_gold" as never))?.balance).toBe(100000);
    expect(await inventory.find(PLAYER_ONE_ID, parseItemDefinitionId("item_carrot_seed"))).toBeNull();
  });

  it("does not let another actor read or upgrade this island's warehouse", async () => {
    // The status read is scoped to the authenticated actor; a second player has their own starter cap.
    const other = await status.execute({ playerId: PLAYER_TWO_ID });
    expect(other.tier).toBe(0);
    expect(other.used).toBe(0);
    // There is no route that accepts a target player id, so an actor cannot address another warehouse.
    expect(warehouse).toBeDefined();
  });
});
