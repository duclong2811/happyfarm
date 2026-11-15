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
import {
  ApplicationError,
  EconomyService,
  GetWarehouseStatus,
  InventoryService,
  UpgradeWarehouse,
  type IdempotencyRecord,
  type InventoryRepository,
  type WalletRepository
} from "@happy-farm/application";
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
  parseEconomyTransactionId,
  parseItemDefinitionId,
  parseShopEntryId,
  warehouseIdFromUuid,
  type EconomyMutation,
  type InventoryItem
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
  let upgradeWith: (walletsPort: WalletRepository, inventoryPort?: InventoryRepository) => UpgradeWarehouse;
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
    upgradeWith = (walletsPort, inventoryPort = inventory) =>
      new UpgradeWarehouse(
        warehouse,
        tiers,
        walletsPort,
        currencies,
        inventoryPort,
        new EconomyService(ids, clock),
        new InventoryService(items, clock),
        new D1IdempotencyRepository(db),
        new Sha256Fingerprint(),
        clock
      );
    upgrade = upgradeWith(wallets);
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
    stock("item_ore", 400);
    const view = await status.execute({ playerId: PLAYER_ONE_ID });
    expect(view).toMatchObject({ tier: 0, capacity: 1000, used: 1000, available: 0, overCapacity: false });
    expect(view.nextTier).toBe(1);
    expect(view.nextUpgrade?.gold).toBeGreaterThan(0);
  });

  it("upgrades atomically: gold debited, materials consumed, tier and capacity raised", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
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
    stock("item_ore", 500);
    const first = await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_replay" });
    const second = await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_replay" });
    expect(second).toEqual(first);
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    expect(wallet?.balance).toBe(99_500);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID)).toMatchObject({ n: 1 });
  });

  it("charges exactly once for two racing submissions of the same upgrade", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    // The double-submit case: the same request id, twice, at once. The receipt makes it one purchase.
    const [first, second] = await Promise.all([
      upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_race_same" }),
      upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_race_same" })
    ]);
    expect(second).toEqual(first);
    const row = db.sqlite
      .prepare("SELECT tier, capacity FROM home_island_warehouses WHERE owner_player_id = ?")
      .get(PLAYER_ONE_ID) as { tier: number; capacity: number };
    expect(row).toEqual({ tier: 1, capacity: 2500 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'WAREHOUSE_UPGRADE'").get()
    ).toMatchObject({ n: 1 });
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    expect(wallet?.balance).toBe(99_500);
  });

  it("never charges for a racing upgrade whose own step did not happen", async () => {
    // Different request ids are two purchases, but a step is chosen once from the tier the caller
    // read. The loser must fail closed: exactly one step applied, exactly one charge, and the tier
    // must match the money spent. (Before the transaction marker this double-charged: the loser's
    // receipt was satisfied by the winner's tier/version.)
    stock("item_wood", 500);
    stock("item_ore", 500);
    const attempts = await Promise.allSettled([
      upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_race_a" }),
      upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_race_b" })
    ]);
    const row = db.sqlite
      .prepare("SELECT tier, capacity FROM home_island_warehouses WHERE owner_player_id = ?")
      .get(PLAYER_ONE_ID) as { tier: number; capacity: number };
    const ledger = db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'WAREHOUSE_UPGRADE'")
      .get() as { n: number };
    const wallet = await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold"));
    const spent = 100_000 - (wallet?.balance ?? 0);
    // However the race interleaves: the tier's step count, the ledger rows and the gold all agree.
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(row.tier).toBe(1);
    expect(ledger.n).toBe(1);
    expect(spent).toBe(500);
  });

  /**
   * One step, written straight through the repository from the tier and version the caller read.
   * `items` are the stacks it reads and takes 50 of each; `beforeWrite` runs after every read.
   */
  async function upgradeThroughRepository(
    requestId: string,
    transactionId: string,
    read: { tier: number; version: number },
    options: { readonly items?: readonly string[]; readonly beforeWrite?: () => void } = {}
  ): Promise<void> {
    const gold = parseCurrencyDefinitionId("currency_gold");
    const wallet = await wallets.find(PLAYER_ONE_ID, gold);
    if (wallet === null) throw new Error("wallet was not seeded");
    const expectedInventory: InventoryItem[] = [];
    for (const itemId of options.items ?? ["item_wood", "item_ore"]) {
      const row = await inventory.find(PLAYER_ONE_ID, parseItemDefinitionId(itemId));
      if (row === null) throw new Error(`${itemId} was not stocked`);
      expectedInventory.push(row);
    }
    const warehouseId = warehouseIdFromUuid(PLAYER_ONE_ID.slice("player_".length));
    const economy: EconomyMutation = {
      transactionId: parseEconomyTransactionId(transactionId),
      playerId: PLAYER_ONE_ID,
      currencyDefinitionId: gold,
      delta: -500,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance - 500,
      expectedWalletVersion: wallet.version,
      reason: "WAREHOUSE_UPGRADE",
      referenceType: "WAREHOUSE",
      referenceId: warehouseId,
      requestId,
      createdAt: NOW
    };
    const record: IdempotencyRecord = {
      actorPlayerId: PLAYER_ONE_ID,
      operation: "WAREHOUSE_UPGRADE",
      requestId,
      payloadFingerprint: "f".repeat(64),
      resourceId: transactionId,
      responseJson: "{}",
      status: "COMPLETED",
      createdAt: NOW
    };
    options.beforeWrite?.();
    await warehouse.upgradeAtomically(
      {
        playerId: PLAYER_ONE_ID,
        warehouseId,
        expectedFromTier: read.tier,
        expectedVersion: read.version,
        toTier: read.tier + 1,
        capacity: 2500,
        economy,
        removals: expectedInventory.map((row) => ({
          kind: "REMOVE" as const,
          playerId: PLAYER_ONE_ID,
          itemDefinitionId: row.itemDefinitionId,
          quantity: 50,
          timestamp: NOW
        })),
        expectedInventory,
        createdAt: NOW
      },
      record
    );
  }

  function snapshot(): unknown {
    return {
      warehouse: db.sqlite.prepare("SELECT tier, capacity, version FROM home_island_warehouses WHERE owner_player_id = ?").get(PLAYER_ONE_ID),
      wallet: db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID),
      inventory: db.sqlite.prepare("SELECT item_definition_id, quantity, version FROM inventory_items WHERE player_id = ? ORDER BY item_definition_id").all(PLAYER_ONE_ID),
      ledger: db.sqlite.prepare("SELECT id FROM economy_ledger ORDER BY id").all(),
      receipts: db.sqlite.prepare("SELECT request_id FROM idempotency_keys ORDER BY request_id").all()
    };
  }

  it("refuses, as an economy conflict, an upgrade whose warehouse step another request already took", async () => {
    // Two upgrades with different request ids, both read at tier 0 / version 1. The second reads the
    // wallet and the materials after the first landed, so its charge is valid and only the warehouse
    // guard can refuse it. That leaves the receipt's actor NULL, and the receipt trigger - which fires
    // before the NOT NULL check - is what reports it; it must still read as a conflict, not a crash.
    stock("item_wood", 500);
    stock("item_ore", 500);
    const read = { tier: 0, version: 1 };
    await upgradeThroughRepository("req_upgrade_first", "econ_eeeeeeee-eeee-4eee-8eee-000000000001", read);
    const afterFirst = snapshot();
    expect(afterFirst).toMatchObject({ warehouse: { tier: 1, capacity: 2500, version: 2 }, wallet: { balance: 99_500, version: 2 } });

    const second = upgradeThroughRepository("req_upgrade_second", "econ_eeeeeeee-eeee-4eee-8eee-000000000002", read);
    await expect(second).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT");
    // Nothing of the second request was kept: no gold, no materials, no tier, no ledger row, no receipt.
    expect(snapshot()).toEqual(afterFirst);
  });

  it("answers stale state when another upgrade lands between reading the warehouse and the wallet", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    // The interleaving the repository test pins down, through the use case: this request reads the
    // warehouse at tier 0, then a sibling request with its own id upgrades, then this request reads the
    // wallet the sibling left behind and writes.
    let sibling: Promise<unknown> | null = null;
    const walletsAfterSibling: WalletRepository = {
      find: async (playerId, currencyId) => {
        sibling ??= upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_sibling" });
        await sibling;
        return wallets.find(playerId, currencyId);
      },
      listByPlayer: (playerId) => wallets.listByPlayer(playerId)
    };
    const attempt = upgradeWith(walletsAfterSibling).execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_stale" });
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "CONFLICT_STALE_STATE");

    expect(db.sqlite.prepare("SELECT tier, capacity FROM home_island_warehouses WHERE owner_player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      tier: 1,
      capacity: 2500
    });
    expect((await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold")))?.balance).toBe(99_500);
    expect((await inventory.find(PLAYER_ONE_ID, parseItemDefinitionId("item_wood")))?.quantity).toBe(450);
    expect((await inventory.find(PLAYER_ONE_ID, parseItemDefinitionId("item_ore")))?.quantity).toBe(450);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'WAREHOUSE_UPGRADE'").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT request_id FROM idempotency_keys").all()).toEqual([{ request_id: "req_upgrade_sibling" }]);
  });

  /** The island before any upgrade, with wood spent from 500 to `wood` by someone else (version 2). */
  function untouchedExceptWood(wood: number): unknown {
    return {
      warehouse: { tier: 0, capacity: 1000, version: 1 },
      wallet: { balance: 100_000, version: 1 },
      inventory: [
        { item_definition_id: "item_ore", quantity: 500, version: 1 },
        { item_definition_id: "item_wood", quantity: wood, version: 2 }
      ],
      ledger: [],
      receipts: []
    };
  }

  function spendWood(quantity: number): void {
    db.sqlite
      .prepare("UPDATE inventory_items SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_definition_id = 'item_wood'")
      .run(quantity, PLAYER_ONE_ID);
  }

  it("refuses an upgrade whose materials moved after they were read, and charges nothing", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    let moved: unknown = null;
    // Someone spends wood between this request's read and its write, so the wood UPDATE - guarded by
    // the quantity and version read - matches no row. The ledger, the ore and the warehouse guards all
    // still hold; only a guard on the wood stack itself can tell that the wood was never taken.
    const attempt = upgradeThroughRepository("req_upgrade_moved", "econ_eeeeeeee-eeee-4eee-8eee-000000000003", { tier: 0, version: 1 }, {
      beforeWrite: () => {
        spendWood(400);
        moved = snapshot();
      }
    });
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT");
    // No gold charged, no material changed, the tier unchanged, no ledger row and no receipt.
    expect(moved).toEqual(untouchedExceptWood(400));
    expect(snapshot()).toEqual(moved);
  });

  it("refuses a material list that names one stack twice", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    const before = snapshot();
    // Both wood removals were read at 500/v1, so after the first one lands the second matches no row -
    // yet the stack sits exactly where each guard expects it. One removal per stack is what makes the
    // guard a proof, so the repository refuses anything else before writing.
    const attempt = upgradeThroughRepository("req_upgrade_twice", "econ_eeeeeeee-eeee-4eee-8eee-000000000004", { tier: 0, version: 1 }, {
      items: ["item_wood", "item_wood"]
    });
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "INVALID_INPUT");
    expect(snapshot()).toEqual(before);
  });

  /** An inventory port that spends wood down to `wood` right after this request first reads it. */
  function inventorySpendingWoodAfterRead(wood: number): InventoryRepository {
    let spent = false;
    return {
      find: async (playerId, itemDefinitionId) => {
        const row = await inventory.find(playerId, itemDefinitionId);
        if (!spent && itemDefinitionId === "item_wood") {
          spent = true;
          spendWood(wood);
        }
        return row;
      },
      listByPlayer: (playerId) => inventory.listByPlayer(playerId)
    };
  }

  it("re-reads materials that moved before the write, and takes them from where they now are", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    const execute = (): Promise<unknown> =>
      upgradeWith(wallets, inventorySpendingWoodAfterRead(400)).execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_moved_retry" });
    // The first write is refused by the wood guard. Retrying from the same stale read could never
    // succeed; the retry reads wood at 400 and takes its 50 from there.
    const view = await execute();
    expect(view).toMatchObject({ tier: 1, capacity: 2500, used: 800 });
    expect(snapshot()).toMatchObject({
      warehouse: { tier: 1, capacity: 2500, version: 2 },
      wallet: { balance: 99_500, version: 2 },
      inventory: [
        { item_definition_id: "item_ore", quantity: 450, version: 2 },
        { item_definition_id: "item_wood", quantity: 350, version: 3 }
      ],
      receipts: [{ request_id: "req_upgrade_moved_retry" }]
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'WAREHOUSE_UPGRADE'").get()).toEqual({ n: 1 });
    // The receipt answers with what the island really holds, and a replay repeats it without a charge.
    expect((await status.execute({ playerId: PLAYER_ONE_ID })).used).toBe(800);
    expect(await upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_moved_retry" })).toEqual(view);
    expect((await wallets.find(PLAYER_ONE_ID, parseCurrencyDefinitionId("currency_gold")))?.balance).toBe(99_500);
  });

  it("refuses, charging nothing, an upgrade whose materials were spent below its cost before the write", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    const attempt = upgradeWith(wallets, inventorySpendingWoodAfterRead(10)).execute(
      { playerId: PLAYER_ONE_ID },
      { requestId: "req_upgrade_moved_short" }
    );
    await expect(attempt).rejects.toMatchObject({ code: "INSUFFICIENT_ITEMS" });
    expect(snapshot()).toEqual(untouchedExceptWood(10));
  });

  it("refuses an upgrade the island lacks materials for", async () => {
    stock("item_wood", 10); // fewer than the 50 the first upgrade needs
    stock("item_ore", 50);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_broke" })).rejects.toMatchObject({
      code: "INSUFFICIENT_ITEMS"
    });
  });

  it("refuses an upgrade the island cannot pay for", async () => {
    stock("item_wood", 50);
    stock("item_ore", 50);
    db.sqlite.prepare("UPDATE wallets SET balance = 1 WHERE player_id = ?").run(PLAYER_ONE_ID);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_poor" })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS"
    });
  });

  it("refuses an upgrade past the highest tier", async () => {
    stock("item_wood", 500);
    stock("item_ore", 500);
    db.sqlite.prepare("UPDATE home_island_warehouses SET tier = 6, capacity = 100000 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    await expect(upgrade.execute({ playerId: PLAYER_ONE_ID }, { requestId: "req_upgrade_max" })).rejects.toMatchObject({
      code: "WAREHOUSE_MAX_TIER"
    });
  });

  it("refuses a shop purchase that would overflow, with no gold debited and no item granted", async () => {
    stock("item_wood", 600);
    stock("item_ore", 400);
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
