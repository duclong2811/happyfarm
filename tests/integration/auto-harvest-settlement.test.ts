import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoHarvestSettlementContext, CargoGrant, IdempotencyRecord } from "@happy-farm/application";
import { CargoService, HarvestCrop, InventoryService, autoTransitionId } from "@happy-farm/application";
import {
  parseActorId,
  parseCropInstanceId,
  parseItemDefinitionId,
  parseJobId,
  type CropInstance,
  type XpAward
} from "@happy-farm/domain";
import { D1AutoHarvestSettlementService } from "../../workers/api/src/d1-auto-harvest-settlement";
import {
  D1ActorRepository,
  D1AutoTravelRepository,
  D1CargoRepository,
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1HarvestSettlementRepository,
  D1IdempotencyRepository,
  D1InventoryRepository,
  D1ProgressionRepository
} from "../../workers/api/src/d1-repositories";
import {
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  Sha256Fingerprint,
  gameDataCargoCapacities,
  gameDataProgressionDefinition
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const ACTOR_ID = parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const JOB_ID = parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const CROP_ID = parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const CARROT = parseItemDefinitionId("item_carrot");
const WATERMARK = "2026-10-05T00:00:00.000Z";
const EVENT = "2026-10-05T00:01:00.000Z";
const AUTO_VERSION = 4;

interface SeedOptions {
  readonly cropVersion?: number;
  readonly autoVersion?: number;
  readonly simulationAt?: string | null;
  readonly cargoCapacity?: number;
  readonly carried?: number;
  readonly carriedVersion?: number;
  readonly plantedAt?: string;
}

function rows(db: NodeD1Database, sql: string): readonly Record<string, unknown>[] {
  return db.sqlite.prepare(sql).all();
}

/** Everything the harvest could touch, read after the fact rather than inferred from exceptions. */
function snapshot(db: NodeD1Database) {
  return {
    crops: rows(db, "SELECT id, farm_id, crop_definition_id, version FROM crop_instances ORDER BY id"),
    cargo: rows(db, "SELECT actor_id, item_definition_id, quantity, version FROM actor_cargo_items ORDER BY item_definition_id"),
    actors: rows(db, "SELECT id, cargo_version, cargo_transfer_id FROM actors ORDER BY id"),
    progression: rows(db, "SELECT player_id, level, xp, progression_version FROM player_progression ORDER BY player_id"),
    auto: rows(db, "SELECT actor_id, anchor_kind, anchor_x, anchor_y, version, simulation_at FROM actor_auto_state ORDER BY actor_id"),
    receipts: rows(db, "SELECT actor_player_id, operation, request_id, resource_id FROM idempotency_keys ORDER BY operation, request_id"),
    settlements: rows(db, "SELECT actor_player_id, operation, request_id, crop_instance_id, quantity, destination FROM harvest_settlements ORDER BY request_id")
  };
}

function seed(db: NodeD1Database, options: SeedOptions = {}): void {
  const cargoCapacity = options.cargoCapacity ?? 30;
  const autoVersion = options.autoVersion ?? AUTO_VERSION;
  const simulationAt = options.simulationAt === undefined ? WATERMARK : options.simulationAt;
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'harvest-proof', 'Harvest Proof', 'ACTIVE', ?, ?)"
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
      "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at, cargo_capacity, cargo_version, cargo_transfer_id) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?, ?, 1, NULL)"
    )
    .run(ACTOR_ID, PLAYER_ONE_ID, FARM_ONE_ID, NOW, NOW, cargoCapacity);
  db.sqlite
    .prepare(
      "INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'CELL', 9, 26, NULL, NULL, NULL, NULL, ?, ?, ?)"
    )
    .run(ACTOR_ID, autoVersion, NOW, simulationAt);
  db.sqlite
    .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 9, 26, 'SOIL', 'IDLE', 1, ?)")
    .run(FARM_ONE_ID, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 9, 26, 'crop_carrot', ?, ?, ?, ?, ?)"
    )
    .run(CROP_ID, FARM_ONE_ID, PLAYER_ONE_ID, options.plantedAt ?? "2026-10-04T22:00:00.000Z", options.cropVersion ?? 1, NOW, NOW);
  if (options.carried !== undefined && options.carried > 0) {
    db.sqlite
      .prepare(
        "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(ACTOR_ID, CARROT, options.carried, options.carriedVersion ?? 1, NOW);
  }
}

const context = (overrides: Partial<AutoHarvestSettlementContext> = {}): AutoHarvestSettlementContext => ({
  actorId: ACTOR_ID,
  assignmentId: JOB_ID,
  eventTime: EVENT,
  expectedAutoVersion: AUTO_VERSION,
  expectedSimulationAt: WATERMARK,
  ...overrides
});

const crop: CropInstance = {
  id: CROP_ID,
  farmId: FARM_ONE_ID,
  tileX: 9,
  tileY: 26,
  cropDefinitionId: "crop_carrot" as CropInstance["cropDefinitionId"],
  plantedByPlayerId: PLAYER_ONE_ID,
  plantedAt: "2026-10-04T22:00:00.000Z",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW
};

const grant: CargoGrant = { actorId: ACTOR_ID, itemDefinitionId: CARROT, quantity: 2, timestamp: EVENT };

const award = (xpBefore = 0, expectedProgressionVersion = 1, xpAwarded = 4): XpAward => ({
  playerId: PLAYER_ONE_ID,
  xpBefore,
  expectedProgressionVersion,
  xpAfter: xpBefore + xpAwarded,
  levelAfter: 1,
  xpAwarded,
  leveledUp: false,
  timestamp: EVENT
});

const record = (ctx: AutoHarvestSettlementContext): IdempotencyRecord => ({
  actorPlayerId: PLAYER_ONE_ID,
  operation: "AUTO_HARVEST",
  requestId: autoTransitionId({ ...ctx, kind: "HARVEST" }),
  payloadFingerprint: "b".repeat(64),
  status: "COMPLETED",
  resourceId: CROP_ID,
  responseJson: "{}",
  createdAt: EVENT
});

describe("D1 Atomic Auto Harvest - real repository proof", () => {
  let db: NodeD1Database;
  let service: D1AutoHarvestSettlementService;
  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    service = new D1AutoHarvestSettlementService(
      db,
      new D1HarvestSettlementRepository(db),
      new D1AutoTravelRepository(db),
      { now: () => EVENT }
    );
  });
  afterEach(() => {
    db.close();
  });

  const settle = (
    overrides: Partial<{
      expectedCargo: { quantity: number; version: number } | null;
      containerVersion: number;
      ctx: AutoHarvestSettlementContext;
    }> = {}
  ) => {
    const ctx = overrides.ctx ?? context();
    return service.settle({
      crop,
      grant,
      award: award(),
      expectedCargo: overrides.expectedCargo === undefined ? null : overrides.expectedCargo,
      containerVersion: overrides.containerVersion ?? 1,
      idempotency: record(ctx),
      context: ctx
    });
  };

  it("harvests into cargo and advances the Auto timeline in one batch", async () => {
    await settle();
    expect(snapshot(db)).toMatchObject({
      crops: [],
      cargo: [{ actor_id: ACTOR_ID, item_definition_id: CARROT, quantity: 2, version: 1 }],
      actors: [{ id: ACTOR_ID, cargo_version: 2 }],
      progression: [{ player_id: PLAYER_ONE_ID, level: 1, xp: 4, progression_version: 2 }],
      auto: [{ actor_id: ACTOR_ID, version: AUTO_VERSION + 1, simulation_at: EVENT }],
      receipts: [
        { operation: "AUTO_HARVEST", request_id: autoTransitionId({ ...context(), kind: "HARVEST" }) },
        { operation: "HARVEST_CROP", request_id: autoTransitionId({ ...context(), kind: "HARVEST" }) }
      ],
      settlements: [{ operation: "HARVEST_CROP", crop_instance_id: CROP_ID, quantity: 2, destination: "CARGO" }]
    });
    const marker = rows(db, "SELECT cargo_transfer_id FROM actors")[0]?.cargo_transfer_id;
    expect(marker).toBe(autoTransitionId({ ...context(), kind: "HARVEST" }));
  });

  it("grows the carried stack the actor already had instead of replacing it", async () => {
    db.close();
    db = new NodeD1Database(schemaSql());
    seed(db, { carried: 5, carriedVersion: 3 });
    service = new D1AutoHarvestSettlementService(db, new D1HarvestSettlementRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
    await settle({ expectedCargo: { quantity: 5, version: 3 } });
    expect(snapshot(db)).toMatchObject({
      cargo: [{ actor_id: ACTOR_ID, item_definition_id: CARROT, quantity: 7, version: 4 }],
      progression: [{ xp: 4 }]
    });
  });

  it("exact semantic replay and a retry with a new HTTP request id harvest once", async () => {
    const ctx = context();
    await settle({ ctx });
    const after = snapshot(db);
    // Same semantic transition, different HTTP request id: the receipt is the economic identity.
    await expect(
      service.settle({
        crop,
        grant,
        award: award(),
        expectedCargo: null,
        containerVersion: 1,
        idempotency: { ...record(ctx), requestId: "a-brand-new-http-request" },
        context: ctx
      })
    ).rejects.toThrow();
    expect(snapshot(db)).toEqual(after);
  });

  it("lets only one of two same-transition attempts harvest", async () => {
    const ctx = context();
    const attempt = () =>
      service.settle({
        crop,
        grant,
        award: award(),
        expectedCargo: null,
        containerVersion: 1,
        idempotency: record(ctx),
        context: ctx
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(snapshot(db)).toMatchObject({
      crops: [],
      cargo: [{ quantity: 2 }],
      progression: [{ xp: 4 }],
      auto: [{ version: AUTO_VERSION + 1, simulation_at: EVENT }]
    });
  });

  it("gives one crop at most one harvest when two different transitions compete", async () => {
    await settle({ ctx: context() });
    const after = snapshot(db);
    // A second transition - a later event time, so a different semantic identity - against the same crop.
    const later = context({ eventTime: "2026-10-05T00:02:00.000Z", expectedAutoVersion: AUTO_VERSION + 1, expectedSimulationAt: EVENT });
    await expect(settle({ ctx: later })).rejects.toThrow();
    expect(snapshot(db)).toEqual(after);
  });

  it("rolls the whole harvest back when the Auto timeline is stale", async () => {
    const before = snapshot(db);
    await expect(settle({ ctx: context({ expectedAutoVersion: AUTO_VERSION - 1 }) })).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
  });

  it("rolls back when the crop has already moved on, and when the container is stale", async () => {
    for (const input of [
      { cropOverride: { ...crop, version: 5 }, containerVersion: 1 },
      { cropOverride: crop, containerVersion: 9 }
    ]) {
      const before = snapshot(db);
      await expect(
        service.settle({
          crop: input.cropOverride,
          grant,
          award: award(),
          expectedCargo: null,
          containerVersion: input.containerVersion,
          idempotency: record(context()),
          context: context()
        })
      ).rejects.toThrow();
      expect(snapshot(db)).toEqual(before);
    }
  });

  it("keeps the crop standing, the experience unpaid and no receipt when cargo is full", async () => {
    db.close();
    db = new NodeD1Database(schemaSql());
    seed(db, { carried: 30, cargoCapacity: 30 });
    service = new D1AutoHarvestSettlementService(db, new D1HarvestSettlementRepository(db), new D1AutoTravelRepository(db), {
      now: () => EVENT
    });
    const before = snapshot(db);
    await expect(settle({ expectedCargo: { quantity: 30, version: 1 } })).rejects.toThrow();
    expect(snapshot(db)).toEqual(before);
    expect(rows(db, "SELECT quantity FROM actor_cargo_items")[0]?.quantity).toBe(30);
  });
});

describe("HarvestCrop.executeIntoCargoAuto - real use case proof", () => {
  let db: NodeD1Database;
  let harvest: HarvestCrop;
  const clock = { now: () => EVENT };

  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    const settlement = new D1HarvestSettlementRepository(db);
    harvest = new HarvestCrop(
      new D1FarmRepository(db),
      new D1FarmMemberRepository(db),
      new D1CropRepository(db),
      new D1InventoryRepository(db),
      new D1IdempotencyRepository(db),
      settlement,
      new GameDataCropDefinitions(),
      new InventoryService(new GameDataItemDefinitions(), clock),
      new D1ProgressionRepository(db),
      gameDataProgressionDefinition,
      new Sha256Fingerprint(),
      clock,
      {
        cargo: new D1CargoRepository(db),
        cargoService: new CargoService(new GameDataItemDefinitions(), gameDataCargoCapacities, clock),
        actors: new D1ActorRepository(db)
      },
      new D1AutoHarvestSettlementService(db, settlement, new D1AutoTravelRepository(db), clock)
    );
  });
  afterEach(() => {
    db.close();
  });

  const command = (ctx: AutoHarvestSettlementContext) => ({
    cropInstanceId: CROP_ID,
    expectedCropVersion: 1,
    requestId: "http-request-id",
    assignmentId: ctx.assignmentId,
    actorId: ctx.actorId,
    eventTime: ctx.eventTime,
    expectedAutoVersion: ctx.expectedAutoVersion,
    expectedSimulationAt: ctx.expectedSimulationAt
  });

  it("pays the crop definition's own reward and experience, and advances the timeline", async () => {
    const result = await harvest.executeIntoCargoAuto({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command(context()));
    expect(result.harvest).toMatchObject({ cropInstanceId: CROP_ID, itemDefinitionId: CARROT, quantityAdded: 2 });
    expect(result.progression).toMatchObject({ xpAwarded: 4, leveledUp: false });
    expect(snapshot(db)).toMatchObject({
      crops: [],
      cargo: [{ quantity: 2 }],
      progression: [{ xp: 4, progression_version: 2 }],
      auto: [{ version: AUTO_VERSION + 1, simulation_at: EVENT }]
    });
  });

  it("refuses a crop that is not mature yet, and writes nothing", async () => {
    db.close();
    db = new NodeD1Database(schemaSql());
    seed(db, { plantedAt: EVENT });
    const settlement = new D1HarvestSettlementRepository(db);
    harvest = new HarvestCrop(
      new D1FarmRepository(db),
      new D1FarmMemberRepository(db),
      new D1CropRepository(db),
      new D1InventoryRepository(db),
      new D1IdempotencyRepository(db),
      settlement,
      new GameDataCropDefinitions(),
      new InventoryService(new GameDataItemDefinitions(), clock),
      new D1ProgressionRepository(db),
      gameDataProgressionDefinition,
      new Sha256Fingerprint(),
      clock,
      {
        cargo: new D1CargoRepository(db),
        cargoService: new CargoService(new GameDataItemDefinitions(), gameDataCargoCapacities, clock),
        actors: new D1ActorRepository(db)
      },
      new D1AutoHarvestSettlementService(db, settlement, new D1AutoTravelRepository(db), clock)
    );
    const before = snapshot(db);
    await expect(
      harvest.executeIntoCargoAuto({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command(context()))
    ).rejects.toMatchObject({ code: "CROP_NOT_MATURE" });
    expect(snapshot(db)).toEqual(before);
  });

  it("refuses a caller who does not own the farm", async () => {
    await expect(
      harvest.executeIntoCargoAuto({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, command(context()))
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});
