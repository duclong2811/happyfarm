import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HarvestCrop,
  InventoryService,
  type Clock,
  type FarmMemberRepository
} from "@happy-farm/application";
import { MAX_INVENTORY_QUANTITY, type FarmMember } from "@happy-farm/domain";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1HarvestSettlementRepository,
  D1InventoryRepository
} from "../../workers/api/src/d1-repositories";
import {
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  Sha256Fingerprint
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import {
  CROP_ONE_ID,
  CROP_TWO_ID,
  FARM_ONE_ID,
  NOW,
  PLAYER_ONE_ID,
  PLAYER_TWO_ID
} from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

class FixedClock implements Clock {
  constructor(private readonly value = NOW) {}
  now(): string {
    return this.value;
  }
}

class RevocableMembers implements FarmMemberRepository {
  allowed = true;
  constructor(private readonly inner: FarmMemberRepository) {}
  findByFarmAndPlayer(...args: Parameters<FarmMemberRepository["findByFarmAndPlayer"]>): Promise<FarmMember | null> {
    return this.allowed ? this.inner.findByFarmAndPlayer(...args) : Promise.resolve(null);
  }
}

describe("HarvestCrop", () => {
  let db: NodeD1Database;
  let crops: D1CropRepository;
  let inventory: D1InventoryRepository;
  let members: RevocableMembers;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    seedPlayer(PLAYER_ONE_ID, "subject-one");
    seedPlayer(PLAYER_TWO_ID, "subject-two");
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
    crops = new D1CropRepository(db);
    inventory = new D1InventoryRepository(db);
    members = new RevocableMembers(new D1FarmMemberRepository(db));
  });

  afterEach(() => {
    db.close();
  });

  function seedPlayer(id: string, subject: string): void {
    db.sqlite
      .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)")
      .run(id, subject, NOW, NOW);
  }

  function seedCrop(id = CROP_ONE_ID, x = 0, definitionId = "crop_carrot", plantedAt = "2026-09-26T23:55:00.000Z"): void {
    db.sqlite
      .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, 0, 'SOIL', 'IDLE', 1, ?)")
      .run(FARM_ONE_ID, x, NOW);
    db.sqlite
      .prepare("INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?)")
      .run(id, FARM_ONE_ID, x, definitionId, PLAYER_ONE_ID, plantedAt, plantedAt, plantedAt);
  }

  function service(clock: Clock = new FixedClock()): HarvestCrop {
    const cropDefinitions = new GameDataCropDefinitions();
    return new HarvestCrop(
      new D1FarmRepository(db),
      members,
      crops,
      inventory,
      crops,
      new D1HarvestSettlementRepository(db),
      cropDefinitions,
      new InventoryService(new GameDataItemDefinitions(), clock),
      new Sha256Fingerprint(),
      clock
    );
  }

  const command = { cropInstanceId: CROP_ONE_ID, expectedCropVersion: 1, requestId: "harvest_request_001" };

  it("settles a mature crop atomically and makes the tile available", async () => {
    seedCrop();
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toMatchObject({
      itemDefinitionId: "item_carrot",
      quantityAdded: 2
    });
    expect(await crops.findById(CROP_ONE_ID)).toBeNull();
    expect((await inventory.listByPlayer(PLAYER_ONE_ID))[0]).toMatchObject({ itemDefinitionId: "item_carrot", quantity: 2 });
  });

  it("accepts exact maturity and offline maturity but rejects an immature crop", async () => {
    seedCrop(CROP_ONE_ID, 0, "crop_carrot", "2026-09-26T23:55:00.000Z");
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toBeDefined();
    seedCrop(CROP_TWO_ID, 1, "crop_carrot", "2026-09-26T23:59:59.000Z");
    await expect(
      service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropInstanceId: CROP_TWO_ID, requestId: "harvest_request_002" })
    ).rejects.toMatchObject({ code: "CROP_NOT_MATURE" });
  });

  it("rejects unauthenticated, unauthorized, missing, and stale requests", async () => {
    seedCrop();
    await expect(service().execute(null, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(service().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedCropVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropInstanceId: "cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })).rejects.toMatchObject({ code: "CROP_NOT_FOUND" });
  });

  it("replays the same request once and rejects a mismatched payload", async () => {
    seedCrop();
    const harvest = service();
    const first = await harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(await harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).toEqual(first);
    await expect(harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedCropVersion: 2 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await inventory.listByPlayer(PLAYER_ONE_ID))[0]?.quantity).toBe(2);
  });

  it("allows exactly one of two concurrent requests for the same crop", async () => {
    seedCrop();
    const harvest = service();
    const results = await Promise.allSettled([
      harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command),
      harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId: "harvest_request_002" })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(["CROP_NOT_FOUND", "CROP_ALREADY_HARVESTED"]).toContain((rejected.reason as { code: string }).code);
    }
    expect((await inventory.listByPlayer(PLAYER_ONE_ID))[0]?.quantity).toBe(2);
  });

  it("atomically accumulates concurrent rewards for the same item", async () => {
    seedCrop();
    seedCrop(CROP_TWO_ID, 1);
    const harvest = service();
    await Promise.all([
      harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command),
      harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropInstanceId: CROP_TWO_ID, requestId: "harvest_request_002" })
    ]);
    expect((await inventory.listByPlayer(PLAYER_ONE_ID))[0]?.quantity).toBe(4);
  });

  it("keeps different item definitions in separate authoritative stacks", async () => {
    seedCrop();
    seedCrop(CROP_TWO_ID, 1, "crop_wheat", "2026-09-26T23:45:00.000Z");
    const harvest = service();
    await harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
      ...command,
      cropInstanceId: CROP_TWO_ID,
      requestId: "harvest_request_002"
    });
    expect(await inventory.listByPlayer(PLAYER_ONE_ID)).toMatchObject([
      { itemDefinitionId: "item_carrot", quantity: 2 },
      { itemDefinitionId: "item_wheat", quantity: 3 }
    ]);
  });

  it("rolls back inventory and crop removal when final idempotency persistence fails", async () => {
    seedCrop();
    db.sqlite.exec("CREATE TRIGGER fail_harvest_idempotency BEFORE INSERT ON idempotency_keys WHEN NEW.operation = 'HARVEST_CROP' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toThrow();
    expect(await crops.findById(CROP_ONE_ID)).not.toBeNull();
    expect(await inventory.listByPlayer(PLAYER_ONE_ID)).toEqual([]);
  });

  it("rolls back an inventory upsert when crop deletion fails", async () => {
    seedCrop();
    db.sqlite.exec("CREATE TRIGGER fail_crop_delete BEFORE DELETE ON crop_instances BEGIN SELECT RAISE(ABORT, 'test crop delete failure'); END");
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toThrow();
    expect(await crops.findById(CROP_ONE_ID)).not.toBeNull();
    expect(await inventory.listByPlayer(PLAYER_ONE_ID)).toEqual([]);
  });

  it("rejects overflow and rolls back the harvest", async () => {
    seedCrop();
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', ?, ?, 1)").run(PLAYER_ONE_ID, MAX_INVENTORY_QUANTITY - 1, NOW);
    await expect(service().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "INVENTORY_LIMIT_EXCEEDED" });
    expect(await crops.findById(CROP_ONE_ID)).not.toBeNull();
  });

  it("rechecks authorization and farm existence before replay", async () => {
    seedCrop();
    const harvest = service();
    await harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    members.allowed = false;
    await expect(harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    members.allowed = true;
    db.sqlite.prepare("DELETE FROM farms WHERE id = ?").run(FARM_ONE_ID);
    await expect(harvest.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});
