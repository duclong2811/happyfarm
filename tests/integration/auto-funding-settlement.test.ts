import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoFundingSaleLeg, CargoPurchase, AutoSupplySettlementContext, IdempotencyRecord } from "@happy-farm/application";
import { autoTransitionId } from "@happy-farm/application";
import {
  parseActorId,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseItemDefinitionId,
  parsePlayerId,
  type EconomyMutation
} from "@happy-farm/domain";
import { D1AutoFundingSettlementService } from "../../workers/api/src/d1-auto-funding-settlement";
import { D1AutoTravelRepository, D1EconomySettlementRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, NOW } from "../support/fixtures";

const PLAYER = parsePlayerId("player_11111111-1111-4111-8111-111111111111");
const ACTOR = parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const JOB = "job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GOLD = parseCurrencyDefinitionId("currency_gold");
const CARROT = parseItemDefinitionId("item_carrot");
const CORN = parseItemDefinitionId("item_corn");
const SEED = parseItemDefinitionId("item_carrot_seed");
const WATERMARK = "2026-10-05T00:00:00.000Z";
const EVENT = "2026-10-05T00:01:00.000Z";

function rows(db: NodeD1Database, sql: string): readonly Record<string, unknown>[] {
  return db.sqlite.prepare(sql).all();
}

function snapshot(db: NodeD1Database) {
  return {
    inventory: rows(db, "SELECT item_definition_id, quantity, version FROM inventory_items ORDER BY item_definition_id"),
    cargo: rows(db, "SELECT item_definition_id, quantity, version FROM actor_cargo_items ORDER BY item_definition_id"),
    wallet: rows(db, "SELECT balance, version FROM wallets"),
    ledger: rows(db, "SELECT reason, delta, request_id FROM economy_ledger ORDER BY request_id, reason"),
    auto: rows(db, "SELECT version, simulation_at FROM actor_auto_state"),
    receipts: rows(db, "SELECT operation, request_id FROM idempotency_keys ORDER BY operation, request_id")
  };
}

function seed(db: NodeD1Database, carrots = 40, corn = 40, gold = 0): void {
  db.sqlite
    .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'funding-proof', 'Funding Proof', 'ACTIVE', ?, ?)")
    .run(PLAYER, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Proof Farm', ?, ?)")
    .run(FARM_ONE_ID, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM_ONE_ID, PLAYER, NOW);
  db.sqlite
    .prepare("INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version, cargo_transfer_id) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, 30, 1, NULL)")
    .run(ACTOR, PLAYER, FARM_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, version, updated_at, simulation_at) VALUES (?, 'MARKET', 4, ?, ?)")
    .run(ACTOR, NOW, WATERMARK);
  db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?)").run(PLAYER, CARROT, carrots, NOW);
  db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?)").run(PLAYER, CORN, corn, NOW);
  db.sqlite
    .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
    .run(PLAYER, GOLD, gold, NOW, NOW);
}

const context = (overrides: Partial<AutoSupplySettlementContext> = {}): AutoSupplySettlementContext => ({
  actorId: ACTOR,
  assignmentId: JOB,
  eventTime: EVENT,
  expectedAutoVersion: 4,
  expectedSimulationAt: WATERMARK,
  ...overrides
});

const transitionId = (ctx: AutoSupplySettlementContext): string =>
  autoTransitionId({ actorId: ctx.actorId, assignmentId: ctx.assignmentId, kind: "PURCHASE_INPUT", eventTime: ctx.eventTime });

function legs(ctx: AutoSupplySettlementContext): readonly AutoFundingSaleLeg[] {
  const id = transitionId(ctx);
  return [
    {
      shopEntryId: "shop_carrot",
      itemDefinitionId: CARROT,
      quantity: 2,
      unitPrice: 2,
      transactionId: parseEconomyTransactionId("econ_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      requestId: `${id}-sell-1`,
      expectedInventoryQuantity: 40,
      expectedInventoryVersion: 1,
      inventoryAfterQuantity: 38,
      expectedWalletVersion: 1,
      balanceBefore: 0,
      balanceAfter: 4
    },
    {
      shopEntryId: "shop_corn",
      itemDefinitionId: CORN,
      quantity: 1,
      unitPrice: 6,
      transactionId: parseEconomyTransactionId("econ_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      requestId: `${id}-sell-2`,
      expectedInventoryQuantity: 40,
      expectedInventoryVersion: 1,
      inventoryAfterQuantity: 39,
      expectedWalletVersion: 2,
      balanceBefore: 4,
      balanceAfter: 10
    }
  ];
}

const economy = (ctx: AutoSupplySettlementContext): EconomyMutation => ({
  transactionId: parseEconomyTransactionId("econ_cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  playerId: PLAYER,
  currencyDefinitionId: GOLD,
  delta: -10,
  balanceBefore: 10,
  balanceAfter: 0,
  expectedWalletVersion: 3,
  reason: "SHOP_BUY",
  referenceType: "SHOP_ENTRY",
  referenceId: "shop_carrot_seed" as EconomyMutation["referenceId"],
  requestId: transitionId(ctx),
  createdAt: EVENT
});

const purchase: CargoPurchase = {
  actorId: ACTOR,
  expectedCargoVersion: 1,
  itemDefinitionId: SEED,
  quantity: 5,
  expectedQuantity: 0,
  expectedVersion: 0,
  timestamp: EVENT
};

const receipt = (ctx: AutoSupplySettlementContext): IdempotencyRecord => ({
  actorPlayerId: PLAYER,
  operation: "AUTO_FUND_AND_PURCHASE_INPUT",
  requestId: transitionId(ctx),
  payloadFingerprint: "e".repeat(64),
  status: "COMPLETED",
  resourceId: ACTOR,
  responseJson: "{}",
  createdAt: EVENT
});

describe("D1 Auto emergency funding - real repository proof", () => {
  let db: NodeD1Database;
  let service: D1AutoFundingSettlementService;
  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    service = new D1AutoFundingSettlementService(db, new D1EconomySettlementRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
  });
  afterEach(() => {
    db.close();
  });

  const settle = (overrides: Partial<{ ctx: AutoSupplySettlementContext; legs: readonly AutoFundingSaleLeg[]; economy: EconomyMutation; purchase: CargoPurchase }> = {}) => {
    const ctx = overrides.ctx ?? context();
    return service.settleFundedPurchase({
      saleLegs: overrides.legs ?? legs(ctx),
      economy: overrides.economy ?? economy(ctx),
      purchase: overrides.purchase ?? purchase,
      idempotency: receipt(ctx),
      context: ctx
    });
  };

  it("sells two resources, buys the input and advances the timeline in one batch", async () => {
    await settle();
    expect(snapshot(db)).toMatchObject({
      inventory: [
        { item_definition_id: CARROT, quantity: 38, version: 2 },
        { item_definition_id: CORN, quantity: 39, version: 2 }
      ],
      cargo: [{ item_definition_id: SEED, quantity: 5, version: 1 }],
      wallet: [{ balance: 0, version: 4 }],
      auto: [{ version: 5, simulation_at: EVENT }],
      receipts: [{ operation: "AUTO_FUND_AND_PURCHASE_INPUT" }]
    });
    // The ledger explains the whole movement: two sales in, one purchase out, summing to the wallet.
    const ledger = rows(db, "SELECT reason, delta FROM economy_ledger ORDER BY delta");
    expect(ledger).toEqual([
      { reason: "SHOP_BUY", delta: -10 },
      { reason: "SHOP_SELL", delta: 4 },
      { reason: "SHOP_SELL", delta: 6 }
    ]);
    const deltas = ledger.reduce((total, row) => total + Number(row.delta), 0);
    expect(deltas).toBe(0);
  });

  it("applies an exact replay once, and refuses a stale Auto timeline without touching anything", async () => {
    await settle();
    const after = snapshot(db);
    await expect(settle()).rejects.toThrow();
    expect(snapshot(db)).toEqual(after);

    const stale = { ...context(), expectedSimulationAt: "2026-10-05T00:00:30.000Z" };
    const before = snapshot(db);
    await expect(settle({ ctx: stale })).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });

  it("rolls everything back on a stale wallet, a stale cargo container and a stale Warehouse row", async () => {
    for (const broken of [
      { economy: { ...economy(context()), expectedWalletVersion: 9 } },
      { purchase: { ...purchase, expectedCargoVersion: 9 } },
      { legs: [{ ...(legs(context())[0] as AutoFundingSaleLeg), expectedInventoryQuantity: 999 }, legs(context())[1] as AutoFundingSaleLeg] }
    ]) {
      const before = snapshot(db);
      await expect(settle(broken)).rejects.toThrow();
      expect(snapshot(db)).toEqual(before);
    }
  });

  it("letting two same-transition attempts race applies at most one", async () => {
    const results = await Promise.allSettled([settle(), settle()]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(snapshot(db)).toMatchObject({
      inventory: [
        { item_definition_id: CARROT, quantity: 38 },
        { item_definition_id: CORN, quantity: 39 }
      ],
      wallet: [{ balance: 0 }],
      receipts: [{ operation: "AUTO_FUND_AND_PURCHASE_INPUT" }]
    });
  });
});
