import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EconomyService, type Clock, type CurrencyDefinitionRepository, type EconomyTransactionIdGenerator } from "@happy-farm/application";
import { MAX_WALLET_BALANCE, parseCurrencyDefinitionId, parseEconomyTransactionId, parseShopEntryId } from "@happy-farm/domain";
import { D1EconomyLedgerRepository, D1EconomyMutationRepository, D1WalletRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");
const goldId = parseCurrencyDefinitionId("currency_gold");
const carrotShop = parseShopEntryId("shop_carrot");
const definitions: CurrencyDefinitionRepository = {
  findById: (id) => id === goldId ? { id: goldId, displayNameKey: "currency.gold.name", maxBalance: MAX_WALLET_BALANCE } : null
};
const clock: Clock = { now: () => NOW };

function makeIds(): EconomyTransactionIdGenerator {
  let sequence = 1;
  return {
    newEconomyTransactionId: () => parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(sequence++).padStart(12, "0")}`)
  };
}

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)");
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
}

function createService(db: NodeD1Database): EconomyService {
  const wallets = new D1WalletRepository(db);
  return new EconomyService(makeIds(), clock, definitions, wallets, new D1EconomyMutationRepository(db));
}

function input(delta: number, requestId = "request_001") {
  return { currencyDefinitionId: "currency_gold", delta, reason: delta < 0 ? "SHOP_BUY" as const : "SHOP_SELL" as const, referenceId: carrotShop, requestId };
}

describe("D1 economy infrastructure", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    seedPlayers(db);
  });
  afterEach(() => {
    db.close();
  });

  it("lazily creates a zero wallet, credits/debits it, increments versions, and records exact ledger rows", async () => {
    const wallets = new D1WalletRepository(db);
    const ledger = new D1EconomyLedgerRepository(db);
    const service = createService(db);
    expect(await wallets.find(PLAYER_ONE_ID, goldId)).toBeNull();
    const credit = await service.mutate({ playerId: PLAYER_ONE_ID }, input(10));
    expect(await wallets.find(PLAYER_ONE_ID, goldId)).toMatchObject({ balance: 10, version: 2 });
    expect(await ledger.findByTransactionId(credit.transactionId)).toMatchObject({
      playerId: PLAYER_ONE_ID, currencyDefinitionId: goldId, delta: 10,
      balanceBefore: 0, balanceAfter: 10, reason: "SHOP_SELL", referenceType: "SHOP_ENTRY",
      referenceId: carrotShop, requestId: "request_001", expectedWalletVersion: 1
    });
    await service.mutate({ playerId: PLAYER_ONE_ID }, input(-10, "request_002"));
    expect(await wallets.find(PLAYER_ONE_ID, goldId)).toMatchObject({ balance: 0, version: 3 });
    expect(await ledger.listByPlayer(PLAYER_ONE_ID, 10)).toHaveLength(2);
  });

  it("rejects invalid currency, malformed currency, invalid amounts, underflow, and overflow without persistence", async () => {
    const service = createService(db);
    for (const currencyDefinitionId of ["currency_unknown", "bad currency"]) {
      await expect(service.mutate({ playerId: PLAYER_ONE_ID }, { ...input(1), currencyDefinitionId })).rejects.toMatchObject({ code: "CURRENCY_DEFINITION_NOT_FOUND" });
    }
    for (const delta of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service.mutate({ playerId: PLAYER_ONE_ID }, input(delta))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(service.mutate({ playerId: PLAYER_ONE_ID }, input(-1))).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await service.mutate({ playerId: PLAYER_ONE_ID }, input(MAX_WALLET_BALANCE));
    await expect(service.mutate({ playerId: PLAYER_ONE_ID }, input(1, "request_002"))).rejects.toMatchObject({ code: "WALLET_LIMIT_EXCEEDED" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ version: 2 });
  });

  it("prevents lost updates for concurrent credits and permits only an affordable concurrent debit", async () => {
    const service = createService(db);
    await service.mutate({ playerId: PLAYER_ONE_ID }, input(100, "request_seed"));
    await Promise.all([
      service.mutate({ playerId: PLAYER_ONE_ID }, input(20, "request_credit_a")),
      service.mutate({ playerId: PLAYER_ONE_ID }, input(30, "request_credit_b"))
    ]);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 150, version: 4 });
    const debits = await Promise.allSettled([
      service.mutate({ playerId: PLAYER_ONE_ID }, input(-80, "request_debit_a")),
      service.mutate({ playerId: PLAYER_ONE_ID }, input(-80, "request_debit_b"))
    ]);
    expect(debits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 70, version: 5 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE delta = -80").get()).toEqual({ count: 1 });
  });

  it("race-safely creates one wallet and keeps players isolated", async () => {
    const service = createService(db);
    await Promise.all([
      service.mutate({ playerId: PLAYER_ONE_ID }, input(3, "request_first_a")),
      service.mutate({ playerId: PLAYER_ONE_ID }, input(4, "request_first_b")),
      service.mutate({ playerId: PLAYER_TWO_ID }, input(9, "request_other"))
    ]);
    expect(db.sqlite.prepare("SELECT player_id, balance FROM wallets ORDER BY player_id").all()).toEqual([
      { player_id: PLAYER_ONE_ID, balance: 7 },
      { player_id: PLAYER_TWO_ID, balance: 9 }
    ]);
    expect(db.sqlite.prepare("SELECT player_id, COUNT(*) AS count FROM economy_ledger GROUP BY player_id ORDER BY player_id").all()).toEqual([
      { player_id: PLAYER_ONE_ID, count: 2 },
      { player_id: PLAYER_TWO_ID, count: 1 }
    ]);
  });

  it("lists only the requested player's wallets in order without writing state", async () => {
    const wallets = new D1WalletRepository(db);
    expect(await wallets.listByPlayer(PLAYER_ONE_ID)).toEqual([]);
    const insert = db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)");
    insert.run(PLAYER_ONE_ID, "currency_gold", 30, NOW, NOW);
    insert.run(PLAYER_ONE_ID, "currency_gem", 5, NOW, NOW);
    insert.run(PLAYER_TWO_ID, "currency_gold", 9, NOW, NOW);
    const snapshot = () => ({
      wallets: db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get(),
      ledger: db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get(),
      idempotency: db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get(),
      inventory: db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get()
    });
    const before = snapshot();

    expect((await wallets.listByPlayer(PLAYER_ONE_ID)).map((wallet) => [wallet.currencyDefinitionId, wallet.balance])).toEqual([
      ["currency_gem", 5],
      ["currency_gold", 30]
    ]);
    expect((await wallets.listByPlayer(PLAYER_TWO_ID)).map((wallet) => [wallet.currencyDefinitionId, wallet.balance])).toEqual([
      ["currency_gold", 9]
    ]);
    expect(await wallets.find(PLAYER_ONE_ID, goldId)).toMatchObject({ balance: 30 });
    expect(snapshot()).toEqual(before);
  });
});

describe("economy transaction rollback", () => {
  it("rolls back wallet creation/update when ledger insertion fails", async () => {
    const failing = new NodeD1Database(migration, { afterStatement: (index) => { if (index === 0) throw new Error("injected ledger failure"); } });
    seedPlayers(failing);
    await expect(createService(failing).mutate({ playerId: PLAYER_ONE_ID }, input(5))).rejects.toThrow("injected ledger failure");
    expect(failing.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get()).toEqual({ count: 0 });
    expect(failing.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    failing.close();
  });

  it("rolls back wallet and ledger when transaction finalization fails", async () => {
    const failing = new NodeD1Database(migration, { beforeCommit: () => { throw new Error("injected commit failure"); } });
    seedPlayers(failing);
    await expect(createService(failing).mutate({ playerId: PLAYER_ONE_ID }, input(5))).rejects.toThrow("injected commit failure");
    expect(failing.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get()).toEqual({ count: 0 });
    expect(failing.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    failing.close();
  });
});
