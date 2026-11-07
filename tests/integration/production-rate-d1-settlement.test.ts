import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settleProduction, type ProductionSettlementInput } from "@happy-farm/domain";
import { D1ProductionRateSettlementService, type ProductionSettlementPlan } from "../../workers/api/src/d1-production-rate-settlement";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";

const PLAYER = "player_11111111-1111-4111-8111-111111111111";
const FARM = "farm_22222222-2222-4222-8222-222222222222";
const ACTOR = "actor_33333333-3333-4333-8333-333333333333";
const SOURCE = "production_source_44444444-4444-4444-8444-444444444444";
const ASSIGNMENT = "production_assignment_55555555-5555-4555-8555-555555555555";
const T0 = "2026-10-06T00:00:00.000Z";
const T1 = "2026-10-06T01:00:00.000Z";

function seed(db: NodeD1Database, sourceKind: "RENEWABLE" | "FINITE", stock: number | null, capacity = 1000): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Production Test', 'ACTIVE', ?, ?)").run(PLAYER, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Production Farm', ?, ?)").run(FARM, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM, PLAYER, T0);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES ('workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, 'HOME_ISLAND', ?, 'FARM', 'Production Field', 1, ?, ?, ?)").run(FARM, FARM, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version) VALUES (?, ?, 'NPC_WORKER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, 30, 1)").run(ACTOR, PLAYER, FARM, T0, T0);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, execution_mode, created_at, updated_at) VALUES ('job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, ?, 'workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FARM', 'crop_carrot', 1, 'RATE_PRODUCTION', ?, ?)").run(ACTOR, FARM, T0, T0);
  db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version, created_at, updated_at) VALUES (?, ?, ?, 'item_test_output', 10, ?, 1, 1, ?, ?)").run(SOURCE, FARM, sourceKind, stock, T0, T0);
  db.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, enabled, settlement_cursor, production_remainder, version, created_at, updated_at) VALUES (?, ?, ?, 'job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, 1, ?, 0, 1, ?, ?)").run(ASSIGNMENT, FARM, ACTOR, SOURCE, T0, T0, T0);
  db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = ? WHERE owner_player_id = ?").run(capacity, PLAYER);
}

function input(db: NodeD1Database, now: string, settlementId: string, free = 1000): { readonly source: ProductionSettlementInput; readonly plan: ProductionSettlementPlan } {
  const assignmentRow = db.sqlite.prepare("SELECT id, farm_id, actor_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version FROM production_assignments WHERE id = ?").get(ASSIGNMENT) as { id: string; farm_id: string; actor_id: string; source_id: string; enabled: number; settlement_cursor: string; production_remainder: number; blocked_reason: "WAREHOUSE_FULL" | "SOURCE_DEPLETED" | "DISABLED" | "NOT_READY" | null; version: number };
  const sourceRow = db.sqlite.prepare("SELECT id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version FROM production_sources WHERE id = ?").get(SOURCE) as { id: string; farm_id: string; kind: "RENEWABLE" | "FINITE"; output_item_definition_id: string; rate_per_hour: number; remaining_stock: number | null; enabled: number; version: number };
  const assignment = { id: assignmentRow.id, farmId: assignmentRow.farm_id, actorId: assignmentRow.actor_id, workAreaId: null, sourceId: assignmentRow.source_id, enabled: assignmentRow.enabled === 1, settlementCursor: assignmentRow.settlement_cursor, productionRemainder: assignmentRow.production_remainder, ...(assignmentRow.blocked_reason === null ? {} : { blockedReason: assignmentRow.blocked_reason }), version: assignmentRow.version };
  const source = { id: sourceRow.id, farmId: sourceRow.farm_id, kind: sourceRow.kind, outputItemDefinitionId: sourceRow.output_item_definition_id, ratePerHour: sourceRow.rate_per_hour, remainingStock: sourceRow.remaining_stock, enabled: sourceRow.enabled === 1, version: sourceRow.version };
  const calculation = settleProduction({ assignment, source, serverNow: now, warehouseFreeCapacity: free });
  const warehouse = db.sqlite.prepare("SELECT version, capacity, (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = ?) AS used FROM home_island_warehouses WHERE owner_player_id = ?").get(PLAYER, PLAYER) as { version: number; capacity: number; used: number };
  const item = db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, source.outputItemDefinitionId) as { quantity: number; version: number } | undefined;
  return {
    source: { assignment, source, serverNow: now, warehouseFreeCapacity: free },
    plan: { playerId: PLAYER as never, assignmentId: ASSIGNMENT, farmId: FARM as never, expectedAssignmentVersion: assignment.version, expectedCursor: assignment.settlementCursor, expectedAssignmentEnabled: assignment.enabled, expectedSourceVersion: source.version, sourceId: SOURCE, finiteSource: source.kind === "FINITE", expectedSourceStock: source.remainingStock, itemDefinitionId: source.outputItemDefinitionId as never, expectedInventoryQuantity: item?.quantity ?? 0, expectedInventoryVersion: item?.version ?? 0, expectedWarehouseVersion: warehouse.version, expectedWarehouseUsed: warehouse.used, warehouseCapacity: warehouse.capacity, result: calculation, settlementId, settledAt: now }
  };
}

describe("Production Rate D1 atomic settlement", () => {
  let db: NodeD1Database;
  let service: D1ProductionRateSettlementService;
  beforeEach(() => { db = new NodeD1Database(schemaSql()); service = new D1ProductionRateSettlementService(db); });
  afterEach(() => { db.close(); });

  it("persists renewable output and assignment state in one real D1 batch", async () => {
    seed(db, "RENEWABLE", null);
    const prepared = input(db, T1, "settlement_renewable");
    await service.settle(prepared.plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 10, version: 1 });
    expect(db.sqlite.prepare("SELECT settlement_cursor, production_remainder, version FROM production_assignments WHERE id = ?").get(ASSIGNMENT)).toMatchObject({ settlement_cursor: T1, production_remainder: 0, version: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_settlement_receipts").get()).toEqual({ n: 1 });
  });

  it("persists finite depletion atomically", async () => {
    seed(db, "FINITE", 37);
    const prepared = input(db, "2026-10-06T05:00:00.000Z", "settlement_finite");
    await service.settle(prepared.plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 37, version: 1 });
    expect(db.sqlite.prepare("SELECT remaining_stock, version FROM production_sources WHERE id = ?").get(SOURCE)).toEqual({ remaining_stock: 0, version: 2 });
    expect(db.sqlite.prepare("SELECT blocked_reason FROM production_assignments WHERE id = ?").get(ASSIGNMENT)).toEqual({ blocked_reason: "SOURCE_DEPLETED" });
  });

  it("rejects an old prepared plan without partial D1 mutation", async () => {
    seed(db, "FINITE", 37);
    const prepared = input(db, T1, "settlement_stale");
    db.sqlite.prepare("UPDATE production_assignments SET version = 2 WHERE id = ?").run(ASSIGNMENT);
    await expect(service.settle(prepared.plan)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT remaining_stock FROM production_sources WHERE id = ?").get(SOURCE)).toEqual({ remaining_stock: 37 });
  });

  it("rejects semantic replay and an old plan under a new settlement id", async () => {
    seed(db, "RENEWABLE", null);
    const prepared = input(db, T1, "settlement_replay");
    await service.settle(prepared.plan);
    await expect(service.settle(prepared.plan)).rejects.toThrow();
    await expect(service.settle({ ...prepared.plan, settlementId: "settlement_new_id" })).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 10, version: 1 });
  });

  it("persists the exact partial-capacity boundary and blocked state", async () => {
    seed(db, "RENEWABLE", null, 1000);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_filler', 968, ?, 1)").run(PLAYER, T0);
    const prepared = input(db, "2026-10-06T05:00:00.000Z", "settlement_partial", 32);
    await service.settle(prepared.plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 32, version: 1 });
    expect(db.sqlite.prepare("SELECT settlement_cursor, production_remainder, blocked_reason FROM production_assignments WHERE id = ?").get(ASSIGNMENT)).toEqual({ settlement_cursor: "2026-10-06T03:12:00.000Z", production_remainder: 0, blocked_reason: "WAREHOUSE_FULL" });
  });

  it("preserves the Warehouse invariant when already full", async () => {
    seed(db, "FINITE", 37, 10);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_filler', 10, ?, 1)").run(PLAYER, T0);
    const prepared = input(db, T1, "settlement_full", 0);
    await service.settle(prepared.plan);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE item_definition_id = 'item_test_output'").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT blocked_reason, settlement_cursor FROM production_assignments WHERE id = ?").get(ASSIGNMENT)).toEqual({ blocked_reason: "WAREHOUSE_FULL", settlement_cursor: T0 });
    expect(db.sqlite.prepare("SELECT remaining_stock FROM production_sources WHERE id = ?").get(SOURCE)).toEqual({ remaining_stock: 37 });
  });

  it("proves persisted blocked time is not a production backlog", async () => {
    seed(db, "RENEWABLE", null, 1000);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_filler', 968, ?, 1)").run(PLAYER, T0);
    await service.settle(input(db, "2026-10-06T05:00:00.000Z", "blocked_boundary", 32).plan);
    await service.settle(input(db, "2026-10-06T05:00:00.000Z", "blocked_wait", 0).plan);
    db.sqlite.prepare("UPDATE inventory_items SET quantity = quantity - 100, version = version + 1 WHERE player_id = ? AND item_definition_id = 'item_filler'").run(PLAYER);
    await service.settle(input(db, "2026-10-06T06:00:00.000Z", "blocked_reopen", 100).plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 32, version: 1 });
    await service.settle(input(db, "2026-10-06T07:00:00.000Z", "productive_resume", 100).plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 42, version: 2 });
  });

  it("rejects stale Warehouse, source, cursor, and different-id concurrent plans", async () => {
    seed(db, "FINITE", 37);
    const prepared = input(db, T1, "stale_warehouse");
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_intervening', 1, ?, 1)").run(PLAYER, T0);
    await expect(service.settle(prepared.plan)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE item_definition_id = 'item_test_output'").get()).toEqual({ n: 0 });
  });

  it("allows exactly one winner for two different settlement ids from the same state", async () => {
    seed(db, "FINITE", 37);
    const left = input(db, T1, "concurrent_left").plan;
    const right = input(db, T1, "concurrent_right").plan;
    const results = await Promise.allSettled([service.settle(left), service.settle(right)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER, "item_test_output")).toEqual({ quantity: 10, version: 1 });
    expect(db.sqlite.prepare("SELECT remaining_stock, version FROM production_sources WHERE id = ?").get(SOURCE)).toEqual({ remaining_stock: 27, version: 2 });
  });

  it("rejects stale finite-source and cursor plans without output", async () => {
    seed(db, "FINITE", 37);
    const sourcePlan = input(db, T1, "stale_source").plan;
    db.sqlite.prepare("UPDATE production_sources SET remaining_stock = 36, version = 2 WHERE id = ?").run(SOURCE);
    await expect(service.settle(sourcePlan)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE item_definition_id = 'item_test_output'").get()).toEqual({ n: 0 });
    db.sqlite.prepare("UPDATE production_sources SET remaining_stock = 37, version = 1 WHERE id = ?").run(SOURCE);
    db.sqlite.prepare("UPDATE production_assignments SET settlement_cursor = ?, version = 2 WHERE id = ?").run("2026-10-06T00:30:00.000Z", ASSIGNMENT);
    const cursorPlan = { ...input(db, T1, "stale_cursor").plan, expectedAssignmentVersion: 1, expectedCursor: T0 };
    await expect(service.settle(cursorPlan)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE item_definition_id = 'item_test_output'").get()).toEqual({ n: 0 });
  });

  it("keeps Cargo and Wallet/Ledger unchanged and rejects legacy mode", async () => {
    seed(db, "RENEWABLE", null);
    db.sqlite.prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_cargo', 3, 1, ?)").run(ACTOR, T0);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 50, 1, ?, ?)").run(PLAYER, T0, T0);
    const prepared = input(db, T1, "isolation");
    await service.settle(prepared.plan);
    expect(db.sqlite.prepare("SELECT quantity, version FROM actor_cargo_items WHERE actor_id = ?").get(ACTOR)).toEqual({ quantity: 3, version: 1 });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER)).toEqual({ balance: 50, version: 1 });
    await expect(service.settle({ ...prepared.plan, settlementId: "legacy_mode", executionMode: "LEGACY_ACTION_AUTO" })).rejects.toThrow();
  });
});
