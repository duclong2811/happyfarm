import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoUnloadSettlementContext, CargoUnload, IdempotencyRecord } from "@happy-farm/application";
import { InventoryService, UnloadCargo, autoTransitionId } from "@happy-farm/application";
import {
  MAX_INVENTORY_QUANTITY,
  parseActorId,
  parseItemDefinitionId,
  type InventoryAddition
} from "@happy-farm/domain";
import { D1AutoUnloadSettlementService } from "../../workers/api/src/d1-auto-unload-settlement";
import {
  D1ActorRepository,
  D1AutoTravelRepository,
  D1CargoRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1IdempotencyRepository,
  D1WarehouseRepository
} from "../../workers/api/src/d1-repositories";
import {
  GameDataItemDefinitions,
  GameDataWarehouseTiers,
  Sha256Fingerprint,
  gameDataCargoCapacities
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const ACTOR_ID = parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const CARROT = parseItemDefinitionId("item_carrot");
const SEED = parseItemDefinitionId("item_carrot_seed");
const WATERMARK = "2026-10-05T00:00:00.000Z";
const EVENT = "2026-10-05T00:01:00.000Z";
const AUTO_VERSION = 4;

interface SeedOptions {
  readonly cargoVersion?: number;
  readonly autoVersion?: number;
  readonly simulationAt?: string | null;
  readonly warehouseCarrots?: number;
  readonly carried?: readonly { readonly itemDefinitionId: string; readonly quantity: number; readonly version: number }[];
}

function rows(db: NodeD1Database, sql: string): readonly Record<string, unknown>[] {
  return db.sqlite.prepare(sql).all();
}

function snapshot(db: NodeD1Database) {
  return {
    cargo: rows(db, "SELECT actor_id, item_definition_id, quantity, version FROM actor_cargo_items ORDER BY item_definition_id"),
    inventory: rows(db, "SELECT player_id, item_definition_id, quantity, version FROM inventory_items ORDER BY item_definition_id"),
    actors: rows(db, "SELECT id, cargo_version, cargo_transfer_id FROM actors ORDER BY id"),
    auto: rows(db, "SELECT actor_id, anchor_kind, version, simulation_at FROM actor_auto_state ORDER BY actor_id"),
    receipts: rows(db, "SELECT actor_player_id, operation, request_id, resource_id FROM idempotency_keys ORDER BY operation, request_id")
  };
}

function seed(db: NodeD1Database, options: SeedOptions = {}): void {
  const carried = options.carried ?? [
    { itemDefinitionId: CARROT, quantity: 2, version: 1 },
    { itemDefinitionId: SEED, quantity: 3, version: 2 }
  ];
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'unload-proof', 'Unload Proof', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Proof Farm', ?, ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version, cargo_transfer_id) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, 30, ?, NULL)"
    )
    .run(ACTOR_ID, PLAYER_ONE_ID, FARM_ONE_ID, NOW, NOW, options.cargoVersion ?? 2);
  db.sqlite
    .prepare(
      "INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'WAREHOUSE', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)"
    )
    .run(ACTOR_ID, options.autoVersion ?? AUTO_VERSION, NOW, options.simulationAt === undefined ? WATERMARK : options.simulationAt);
  for (const stack of carried) {
    db.sqlite
      .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(ACTOR_ID, stack.itemDefinitionId, stack.quantity, stack.version, NOW);
  }
  if (options.warehouseCarrots !== undefined) {
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)")
      .run(PLAYER_ONE_ID, CARROT, options.warehouseCarrots, NOW);
  }
}

const context = (overrides: Partial<AutoUnloadSettlementContext> = {}): AutoUnloadSettlementContext => ({
  actorId: ACTOR_ID,
  eventTime: EVENT,
  expectedAutoVersion: AUTO_VERSION,
  expectedSimulationAt: WATERMARK,
  ...overrides
});

const addition = (itemDefinitionId: string, quantity: number): InventoryAddition => ({
  kind: "ADD",
  playerId: PLAYER_ONE_ID,
  itemDefinitionId: itemDefinitionId as InventoryAddition["itemDefinitionId"],
  quantity,
  maxQuantity: MAX_INVENTORY_QUANTITY,
  timestamp: EVENT
});

const unload = (expectedCargoVersion = 2): CargoUnload => ({
  actorId: ACTOR_ID,
  expectedCargoVersion,
  stacks: [
    { itemDefinitionId: CARROT, quantity: 2 },
    { itemDefinitionId: SEED, quantity: 3 }
  ],
  additions: [addition(CARROT, 2), addition(SEED, 3)],
  timestamp: EVENT
});

const record = (ctx: AutoUnloadSettlementContext): IdempotencyRecord => ({
  actorPlayerId: PLAYER_ONE_ID,
  operation: "AUTO_UNLOAD",
  requestId: autoTransitionId({ actorId: ctx.actorId, assignmentId: null, kind: "UNLOAD", eventTime: ctx.eventTime }),
  payloadFingerprint: "c".repeat(64),
  status: "COMPLETED",
  resourceId: ACTOR_ID,
  responseJson: "{}",
  createdAt: EVENT
});

describe("D1 Atomic Auto Unload - real repository proof", () => {
  let db: NodeD1Database;
  let service: D1AutoUnloadSettlementService;
  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    service = new D1AutoUnloadSettlementService(db, new D1CargoRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
  });
  afterEach(() => {
    db.close();
  });

  const settle = (ctx = context(), body = unload()) =>
    service.settle({ unload: body, idempotency: record(ctx), context: ctx });

  it("delivers every carried stack into the warehouse and advances the Auto timeline", async () => {
    await settle();
    expect(snapshot(db)).toMatchObject({
      cargo: [],
      inventory: [
        { item_definition_id: CARROT, quantity: 2, version: 2 },
        { item_definition_id: SEED, quantity: 3, version: 2 }
      ],
      actors: [{ id: ACTOR_ID, cargo_version: 3 }],
      auto: [{ version: AUTO_VERSION + 1, simulation_at: EVENT }],
      receipts: [{ operation: "AUTO_UNLOAD", request_id: autoTransitionId({ actorId: ACTOR_ID, assignmentId: null, kind: "UNLOAD", eventTime: EVENT }) }]
    });
  });

  it("conserves each item exactly, and grows rows that already existed", async () => {
    db.close();
    db = new NodeD1Database(schemaSql());
    seed(db, { warehouseCarrots: 7 });
    service = new D1AutoUnloadSettlementService(db, new D1CargoRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
    await settle();
    const inventory = rows(db, "SELECT item_definition_id, quantity, version FROM inventory_items ORDER BY item_definition_id");
    expect(inventory).toEqual([
      { item_definition_id: CARROT, quantity: 9, version: 2 },
      { item_definition_id: SEED, quantity: 3, version: 2 }
    ]);
    // Nothing was created or destroyed: the five carried units are the five the warehouse gained.
    expect(rows(db, "SELECT COALESCE(SUM(quantity), 0) AS total FROM actor_cargo_items")).toEqual([{ total: 0 }]);
    expect(rows(db, "SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_items")).toEqual([{ total: 12 }]);
  });

  it("applies an exact semantic replay once, and lets one of two same-transition attempts win", async () => {
    const ctx = context();
    await settle(ctx);
    const after = snapshot(db);
    await expect(settle(ctx)).rejects.toThrow();
    expect(snapshot(db)).toEqual(after);
  });

  it("lets only one of two same-transition attempts deliver", async () => {
    const ctx = context();
    const attempt = () => settle(ctx);
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(snapshot(db)).toMatchObject({
      cargo: [],
      actors: [{ cargo_version: 3 }],
      auto: [{ version: AUTO_VERSION + 1, simulation_at: EVENT }]
    });
  });

  it("rolls back completely when the Auto timeline is stale", async () => {
    const before = snapshot(db);
    await expect(settle(context({ expectedAutoVersion: AUTO_VERSION - 1 }))).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });

  it("rolls back when the container version the caller read has moved on", async () => {
    const before = snapshot(db);
    await expect(settle(context(), unload(9))).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
    expect(rows(db, "SELECT item_definition_id, quantity FROM actor_cargo_items ORDER BY item_definition_id")).toEqual([
      { item_definition_id: CARROT, quantity: 2 },
      { item_definition_id: SEED, quantity: 3 }
    ]);
  });

  it("keeps the cargo on the actor and the warehouse untouched when the warehouse is full", async () => {
    db.close();
    db = new NodeD1Database(schemaSql());
    seed(db, { warehouseCarrots: 999 });
    service = new D1AutoUnloadSettlementService(db, new D1CargoRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
    const before = snapshot(db);
    await expect(settle()).rejects.toMatchObject({ code: "WAREHOUSE_FULL" });
    expect(snapshot(db)).toEqual(before);
    expect(rows(db, "SELECT SUM(quantity) AS total FROM actor_cargo_items")).toEqual([{ total: 5 }]);
    expect(rows(db, "SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_carrot'")).toEqual([{ quantity: 999 }]);
  });
});

describe("UnloadCargo.executeAuto - real use case proof", () => {
  let db: NodeD1Database;
  let unloadCargo: UnloadCargo;
  const clock = { now: () => EVENT };

  const build = () => {
    const cargo = new D1CargoRepository(db);
    unloadCargo = new UnloadCargo({
      farms: new D1FarmRepository(db),
      members: new D1FarmMemberRepository(db),
      actors: new D1ActorRepository(db),
      cargoCapacities: gameDataCargoCapacities,
      cargo,
      itemDefinitions: new GameDataItemDefinitions(),
      // The unload never mints an actor; the generator is present only because the shared
      // main-character dependency bundle carries it.
      ids: { newActorId: () => ACTOR_ID },
      inventory: new InventoryService(new GameDataItemDefinitions(), clock),
      warehouse: new D1WarehouseRepository(db),
      tiers: new GameDataWarehouseTiers(),
      idempotency: new D1IdempotencyRepository(db),
      fingerprints: new Sha256Fingerprint(),
      clock,
      autoSettlement: new D1AutoUnloadSettlementService(db, cargo, new D1AutoTravelRepository(db), clock)
    });
  };

  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    build();
  });
  afterEach(() => {
    db.close();
  });

  it("transfers the whole container and advances the timeline, twice-requested but once applied", async () => {
    const first = await unloadCargo.executeAuto({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
      requestId: "http-request-one",
      expectedVersion: 2,
      actorId: ACTOR_ID,
      eventTime: EVENT,
      expectedAutoVersion: AUTO_VERSION,
      expectedSimulationAt: WATERMARK
    });
    expect(first).toMatchObject({ used: 0, capacity: 30, version: 3, items: [] });
    const after = snapshot(db);
    // A retry of the same step with a *different* HTTP request id is the same economic transition: it
    // finds the receipt it wrote and moves nothing a second time.
    const retry = await unloadCargo.executeAuto({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
      requestId: "http-request-two",
      expectedVersion: 2,
      actorId: ACTOR_ID,
      eventTime: EVENT,
      expectedAutoVersion: AUTO_VERSION,
      expectedSimulationAt: WATERMARK
    });
    expect(retry).toEqual(first);
    expect(snapshot(db)).toEqual(after);
  });

  it("refuses a caller who does not own the farm", async () => {
    await expect(
      unloadCargo.executeAuto({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, {
        requestId: "http-request-three",
        expectedVersion: 2,
        actorId: ACTOR_ID,
        eventTime: EVENT,
        expectedAutoVersion: AUTO_VERSION,
        expectedSimulationAt: WATERMARK
      })
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});
