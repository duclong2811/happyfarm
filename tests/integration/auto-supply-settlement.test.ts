import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoSupplySettlementContext, CargoLoad, CargoPurchase, IdempotencyRecord } from "@happy-farm/application";
import { parseActorId, parseCurrencyDefinitionId, parseEconomyTransactionId, parseItemDefinitionId, parseJobId, type EconomyMutation } from "@happy-farm/domain";
import { D1AutoSupplySettlementService } from "../../workers/api/src/d1-auto-supply-settlement";
import { D1AutoTravelRepository, D1CargoRepository, D1EconomySettlementRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

const ACTOR = parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const JOB = parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const SEED = parseItemDefinitionId("item_carrot_seed");
const GOLD = parseCurrencyDefinitionId("currency_gold");
const WATERMARK = "2026-10-05T00:00:00.000Z";
const EVENT = "2026-10-05T00:01:00.000Z";

function all(db: NodeD1Database, sql: string): readonly Record<string, unknown>[] {
  return db.sqlite.prepare(sql).all();
}

function state(db: NodeD1Database) {
  return {
    warehouse: all(db, "SELECT quantity, version FROM inventory_items ORDER BY item_definition_id"),
    cargo: all(db, "SELECT quantity, version FROM actor_cargo_items ORDER BY item_definition_id"),
    actor: all(db, "SELECT cargo_version, cargo_transfer_id FROM actors"),
    wallet: all(db, "SELECT balance, version FROM wallets"),
    ledger: all(db, "SELECT delta, balance_before, balance_after, request_id FROM economy_ledger"),
    auto: all(db, "SELECT version, simulation_at FROM actor_auto_state"),
    receipts: all(db, "SELECT operation, request_id FROM idempotency_keys")
  };
}

function seed(db: NodeD1Database, warehouse = 25, cargo = 0, gold = 100): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'supply-proof', 'Supply Proof', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Proof Farm', ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version, cargo_transfer_id) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, 30, 1, NULL)").run(ACTOR, PLAYER_ONE_ID, FARM_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, version, updated_at, simulation_at) VALUES (?, 'WAREHOUSE', 4, ?, ?)").run(ACTOR, NOW, WATERMARK);
  if (warehouse > 0) db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)").run(PLAYER_ONE_ID, SEED, warehouse, NOW);
  if (cargo > 0) db.sqlite.prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?)").run(ACTOR, SEED, cargo, NOW);
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(PLAYER_ONE_ID, GOLD, gold, NOW, NOW);
}

const context = (version = 4): AutoSupplySettlementContext => ({ actorId: ACTOR, assignmentId: JOB, eventTime: EVENT, expectedAutoVersion: version, expectedSimulationAt: WATERMARK });
const receipt = (operation: string): IdempotencyRecord => ({ actorPlayerId: PLAYER_ONE_ID, operation, requestId: "http-only", payloadFingerprint: "b".repeat(64), status: "COMPLETED", resourceId: ACTOR, responseJson: "{}", createdAt: EVENT });
const load = (quantity = 25, warehouse = 25, cargoVersion = 1): CargoLoad => ({ actorId: ACTOR, playerId: PLAYER_ONE_ID, expectedCargoVersion: cargoVersion, itemDefinitionId: SEED, quantity, expectedInventoryQuantity: warehouse, expectedInventoryVersion: 1, timestamp: EVENT });
const purchase = (quantity = 10, carried = 0, cargoVersion = 1): CargoPurchase => ({ actorId: ACTOR, expectedCargoVersion: cargoVersion, itemDefinitionId: SEED, quantity, expectedQuantity: carried, expectedVersion: carried === 0 ? 0 : 1, timestamp: EVENT });
const economy = (quantity = 10, balance = 100): EconomyMutation => ({ transactionId: parseEconomyTransactionId("econ_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), playerId: PLAYER_ONE_ID, currencyDefinitionId: GOLD, delta: -(quantity * 2), balanceBefore: balance, balanceAfter: balance - quantity * 2, expectedWalletVersion: 1, reason: "SHOP_BUY", referenceType: "SHOP_ENTRY", referenceId: "shop_carrot_seed" as EconomyMutation["referenceId"], requestId: "semantic-purchase", createdAt: EVENT });

describe("D1 Atomic Auto Supply - real repository proof", () => {
  let db: NodeD1Database;
  let service: D1AutoSupplySettlementService;
  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    service = new D1AutoSupplySettlementService(db, new D1CargoRepository(db), new D1EconomySettlementRepository(db), new D1AutoTravelRepository(db), { now: () => EVENT });
  });
  afterEach(() => { db.close(); });

  it("LOAD conserves stock and advances Auto in the same batch", async () => {
    await service.settleLoad({ load: load(25), expectedCargo: null, idempotency: receipt("AUTO_LOAD_INPUT"), context: context() });
    expect(state(db)).toMatchObject({ warehouse: [], cargo: [{ quantity: 25, version: 1 }], actor: [{ cargo_version: 2 }], auto: [{ version: 5, simulation_at: EVENT }], receipts: [{ operation: "AUTO_LOAD_INPUT" }] });
  });

  it("LOAD supports partial capacity/availability quantities without a ten-unit batch", async () => {
    db.close(); db = new NodeD1Database(schemaSql()); seed(db, 50, 7); service = new D1AutoSupplySettlementService(db, new D1CargoRepository(db), new D1EconomySettlementRepository(db), new D1AutoTravelRepository(db), { now: () => EVENT });
    await service.settleLoad({ load: load(23, 50), expectedCargo: { quantity: 7, version: 1 }, idempotency: receipt("AUTO_LOAD_INPUT"), context: context() });
    expect(state(db)).toMatchObject({ warehouse: [{ quantity: 27 }], cargo: [{ quantity: 30 }], auto: [{ version: 5 }] });
  });

  it("LOAD semantic replay and same-transition concurrency apply once", async () => {
    const input = { load: load(), expectedCargo: null, idempotency: receipt("AUTO_LOAD_INPUT"), context: context() };
    const results = await Promise.allSettled([service.settleLoad(input), service.settleLoad({ ...input, idempotency: { ...input.idempotency, requestId: "new-http" } })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(state(db)).toMatchObject({ warehouse: [], cargo: [{ quantity: 25 }], auto: [{ version: 5 }], receipts: [{ operation: "AUTO_LOAD_INPUT" }] });
  });

  it("stale Auto or Cargo/Warehouse state rolls LOAD back on both sides", async () => {
    for (const input of [
      { load: load(), expectedCargo: null, idempotency: receipt("AUTO_LOAD_INPUT"), context: context(3) },
      { load: load(25, 24), expectedCargo: null, idempotency: receipt("AUTO_LOAD_INPUT"), context: context() },
      { load: load(25, 25, 0), expectedCargo: null, idempotency: receipt("AUTO_LOAD_INPUT"), context: context() }
    ]) {
      const before = state(db);
      await expect(service.settleLoad(input)).rejects.toThrow();
      expect(state(db)).toEqual(before);
    }
  });

  it("PURCHASE debits authoritative gold, grants cargo, writes ledger and advances Auto", async () => {
    await service.settlePurchase({ economy: economy(10), purchase: purchase(10), idempotency: receipt("AUTO_PURCHASE_INPUT"), context: context() });
    expect(state(db)).toMatchObject({ cargo: [{ quantity: 10 }], wallet: [{ balance: 80, version: 2 }], ledger: [{ delta: -20, balance_before: 100, balance_after: 80 }], auto: [{ version: 5 }], receipts: [{ operation: "AUTO_PURCHASE_INPUT" }] });
  });

  it("PURCHASE supports capacity/affordability-bounded quantity", async () => {
    db.close(); db = new NodeD1Database(schemaSql()); seed(db, 0, 27, 5); service = new D1AutoSupplySettlementService(db, new D1CargoRepository(db), new D1EconomySettlementRepository(db), new D1AutoTravelRepository(db), { now: () => EVENT });
    await service.settlePurchase({ economy: economy(2, 5), purchase: purchase(2, 27), idempotency: receipt("AUTO_PURCHASE_INPUT"), context: context() });
    expect(state(db)).toMatchObject({ cargo: [{ quantity: 29 }], wallet: [{ balance: 1 }], ledger: [{ delta: -4 }] });
  });

  it("PURCHASE semantic replay/concurrency debits and grants once", async () => {
    const input = { economy: economy(), purchase: purchase(), idempotency: receipt("AUTO_PURCHASE_INPUT"), context: context() };
    const results = await Promise.allSettled([service.settlePurchase(input), service.settlePurchase({ ...input, idempotency: { ...input.idempotency, requestId: "new-http" } })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(state(db)).toMatchObject({ cargo: [{ quantity: 10 }], wallet: [{ balance: 80 }], ledger: [{ delta: -20 }], auto: [{ version: 5 }] });
  });

  it("stale Auto and full/stale Cargo roll PURCHASE back including wallet and ledger", async () => {
    const before = state(db);
    await expect(service.settlePurchase({ economy: economy(), purchase: purchase(), idempotency: receipt("AUTO_PURCHASE_INPUT"), context: context(3) })).rejects.toThrow();
    expect(state(db)).toEqual(before);
    db.sqlite.prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, 30, 1, ?)").run(ACTOR, SEED, NOW);
    const full = state(db);
    await expect(service.settlePurchase({ economy: economy(1), purchase: purchase(1, 30), idempotency: receipt("AUTO_PURCHASE_INPUT"), context: context() })).rejects.toThrow();
    expect(state(db)).toEqual(full);
  });
});
