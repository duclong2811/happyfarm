import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IdempotencyRecord, TilePlan } from "@happy-farm/application";
import {
  parseActorId,
  parseCropInstanceId,
  parseItemDefinitionId,
  parseJobId,
  parseWorkAreaId,
  type ActorCargoItem,
  type CropInstance
} from "@happy-farm/domain";
import { D1AutoPlantSettlementService, type D1AutoPlantSettlementInput } from "../../workers/api/src/d1-auto-plant-settlement";
import { D1AutoTravelRepository, D1CropRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

const ACTOR_ID = parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const JOB_ID = parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const AREA_ID = parseWorkAreaId("workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const SEED_ID = parseItemDefinitionId("item_carrot_seed");
const WATERMARK = "2026-10-05T00:00:00.000Z";
const EVENT_TIME = "2026-10-05T00:01:00.000Z";

interface DurableSnapshot {
  readonly cargo: readonly unknown[];
  readonly crops: readonly unknown[];
  readonly tiles: readonly unknown[];
  readonly auto: readonly unknown[];
  readonly receipts: readonly unknown[];
  readonly gold: readonly unknown[];
  readonly progression: readonly unknown[];
}

function rows(db: NodeD1Database, sql: string): readonly unknown[] {
  return db.sqlite.prepare(sql).all();
}

function snapshot(db: NodeD1Database): DurableSnapshot {
  return {
    cargo: rows(db, "SELECT actor_id, item_definition_id, quantity, version, updated_at FROM actor_cargo_items ORDER BY actor_id, item_definition_id"),
    crops: rows(db, "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, version FROM crop_instances ORDER BY id"),
    tiles: rows(db, "SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at FROM farm_tiles ORDER BY y, x"),
    auto: rows(db, "SELECT actor_id, version, simulation_at, updated_at FROM actor_auto_state ORDER BY actor_id"),
    receipts: rows(db, "SELECT actor_player_id, operation, request_id, resource_id FROM idempotency_keys ORDER BY operation, request_id"),
    gold: rows(db, "SELECT player_id, currency_id, balance, version FROM wallets ORDER BY player_id, currency_id"),
    progression: rows(db, "SELECT player_id, xp, level, progression_version FROM player_progression ORDER BY player_id")
  };
}

function seedRealFixture(db: NodeD1Database, cargoQuantity = 2): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'auto-proof', 'Auto Proof', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Proof Farm', ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'Proof Field', 1, ?, ?, ?)").run(AREA_ID, FARM_ONE_ID, FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO work_area_cells (work_area_id, x, y) VALUES (?, 9, 26), (?, 10, 26)").run(AREA_ID, AREA_ID);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version, cargo_transfer_id) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, 30, 1, NULL)").run(ACTOR_ID, PLAYER_ONE_ID, FARM_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, enabled, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 1, 1, 1, ?, ?)").run(JOB_ID, ACTOR_ID, FARM_ONE_ID, AREA_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 9, 26, 'SOIL', 'IDLE', 1, ?), (?, 10, 26, 'SOIL', 'IDLE', 1, ?)").run(FARM_ONE_ID, NOW, FARM_ONE_ID, NOW);
  db.sqlite.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'CELL', 9, 26, NULL, NULL, NULL, NULL, 4, ?, ?)").run(ACTOR_ID, NOW, WATERMARK);
  if (cargoQuantity > 0) {
    db.sqlite.prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?)").run(ACTOR_ID, SEED_ID, cargoQuantity, NOW);
  }
}

function settlementInput(x = 9, cropSerial = "1", expectedVersion = 4, expectedCargoQuantity = 2): D1AutoPlantSettlementInput {
  const crop: CropInstance = {
    id: parseCropInstanceId(`cropinst_aaaaaaaa-aaaa-4aaa-8aaa-${cropSerial.padStart(12, "0")}`),
    farmId: FARM_ONE_ID,
    tileX: x,
    tileY: 26,
    cropDefinitionId: "crop_carrot" as CropInstance["cropDefinitionId"],
    plantedByPlayerId: PLAYER_ONE_ID,
    plantedAt: EVENT_TIME,
    version: 1,
    createdAt: EVENT_TIME,
    updatedAt: EVENT_TIME
  };
  const expectedCargo: ActorCargoItem = {
    actorId: ACTOR_ID,
    itemDefinitionId: SEED_ID,
    quantity: expectedCargoQuantity,
    version: 1,
    updatedAt: NOW
  };
  const tile: TilePlan = { kind: "EXISTING", version: 1 };
  const idempotency: IdempotencyRecord = {
    actorPlayerId: PLAYER_ONE_ID,
    operation: "AUTO_PLANT",
    requestId: "http-request-is-not-economic-identity",
    payloadFingerprint: "a".repeat(64),
    status: "COMPLETED",
    resourceId: crop.id,
    responseJson: JSON.stringify({ cropInstanceId: crop.id }),
    createdAt: EVENT_TIME
  };
  return {
    crop,
    tile,
    expectedCargo,
    seedRemoval: {
      actorId: ACTOR_ID,
      itemDefinitionId: SEED_ID,
      quantity: 1,
      expectedQuantity: expectedCargoQuantity,
      expectedVersion: 1,
      timestamp: EVENT_TIME
    },
    idempotency,
    context: {
      actorId: ACTOR_ID,
      assignmentId: JOB_ID,
      x,
      y: 26,
      eventTime: EVENT_TIME,
      expectedAutoVersion: expectedVersion,
      expectedSimulationAt: WATERMARK
    }
  };
}

describe("D1 Auto Plant settlement service - real repository proof", () => {
  let db: NodeD1Database;
  let service: D1AutoPlantSettlementService;

  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seedRealFixture(db);
    service = new D1AutoPlantSettlementService(
      db,
      new D1CropRepository(db),
      new D1AutoTravelRepository(db),
      { now: () => EVENT_TIME }
    );
  });

  afterEach(() => { db.close(); });

  it("prepares without any durable mutation", () => {
    const before = snapshot(db);
    const prepared = service.prepare(settlementInput());
    expect(prepared.plant.statements.length).toBeGreaterThan(0);
    expect(prepared.auto.statements.length).toBeGreaterThan(0);
    expect(snapshot(db)).toEqual(before);
  });

  it("settles once and exact semantic replay cannot duplicate economy", async () => {
    const input = settlementInput();
    const transitionId = service.prepare(input).transitionId;
    await service.settle(input);
    await expect(service.settle({ ...input, idempotency: { ...input.idempotency, requestId: "different-http-request" } })).rejects.toThrow();
    expect(snapshot(db)).toMatchObject({
      cargo: [{ quantity: 1, version: 2 }],
      crops: [{ id: input.crop.id, tile_x: 9, tile_y: 26 }],
      auto: [{ version: 5, simulation_at: EVENT_TIME }],
      receipts: [{ operation: "AUTO_PLANT", resource_id: transitionId }]
    });
  });

  it("allows only one same-transition concurrent attempt", async () => {
    const input = settlementInput();
    const results = await Promise.allSettled([service.settle(input), service.settle(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(snapshot(db)).toMatchObject({ cargo: [{ quantity: 1 }], crops: [{ id: input.crop.id }], auto: [{ version: 5 }], receipts: [{ operation: "AUTO_PLANT" }] });
  });

  it("allows at most one competing transition from the same Auto state", async () => {
    const left = settlementInput(9, "1");
    const right = settlementInput(10, "2");
    const results = await Promise.allSettled([service.settle(left), service.settle(right)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const after = snapshot(db);
    expect(after.cargo).toMatchObject([{ quantity: 1 }]);
    expect(after.crops).toHaveLength(1);
    expect(after.auto).toMatchObject([{ version: 5 }]);
    expect(after.receipts).toHaveLength(1);
  });

  it("rolls back completely when Cargo is stale or short", async () => {
    const before = snapshot(db);
    await expect(service.settle(settlementInput(9, "1", 4, 3))).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });

  it("rolls back completely when the target is occupied", async () => {
    const existing = settlementInput(9, "9").crop;
    db.sqlite.prepare("INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 9, 26, 'crop_carrot', ?, ?, 1, ?, ?)").run(existing.id, FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW, NOW);
    const before = snapshot(db);
    await expect(service.settle(settlementInput())).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });

  it("rolls back Plant when the Auto version is stale", async () => {
    const before = snapshot(db);
    await expect(service.settle(settlementInput(9, "1", 3))).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });
});
