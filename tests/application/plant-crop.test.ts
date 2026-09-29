import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InventoryService,
  PlantCrop,
  type Clock,
  type CropIdGenerator
} from "@happy-farm/application";
import type { CropInstanceId, UnlockedLandPolicy } from "@happy-farm/domain";
import { createOwnedFarm, createFarmTile } from "@happy-farm/domain";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1InventoryRepository,
  D1ProgressionRepository
} from "../../workers/api/src/d1-repositories";
import {
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  Sha256Fingerprint,
  gameDataProgressionDefinition
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import {
  CROP_ONE_ID,
  CROP_TWO_ID,
  FARM_ONE_ID,
  FARM_TWO_ID,
  NOW,
  PLAYER_ONE_ID,
  PLAYER_TWO_ID
} from "../support/fixtures";

const migration = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0005_player_progression.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const clock: Clock = { now: () => NOW };

class SequenceCropIds implements CropIdGenerator {
  private next = 0;
  constructor(private readonly ids: readonly CropInstanceId[] = [CROP_ONE_ID, CROP_TWO_ID]) {}
  newCropInstanceId(): CropInstanceId {
    const id = this.ids[this.next];
    if (id === undefined) throw new Error("No crop ID fixture remains");
    this.next += 1;
    return id;
  }
}

class ConfiguredUnlockedLand implements UnlockedLandPolicy {
  constructor(private readonly unlocked: boolean) {}
  isUnlocked(): Promise<boolean> {
    return Promise.resolve(this.unlocked);
  }
}

function seedPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

function giveSeeds(db: NodeD1Database, itemDefinitionId: string, quantity: number, player = PLAYER_ONE_ID): void {
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)"
    )
    .run(player, itemDefinitionId, quantity, NOW);
}

describe("PlantCrop", () => {
  let db: NodeD1Database;
  let farms: D1FarmRepository;
  let members: D1FarmMemberRepository;
  let tiles: D1FarmTileRepository;
  let crops: D1CropRepository;
  let inventory: D1InventoryRepository;
  let progressions: D1ProgressionRepository;

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    seedPlayer(db, PLAYER_ONE_ID, "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "subject-two");
    farms = new D1FarmRepository(db);
    members = new D1FarmMemberRepository(db);
    tiles = new D1FarmTileRepository(db);
    crops = new D1CropRepository(db);
    inventory = new D1InventoryRepository(db);
    progressions = new D1ProgressionRepository(db);
    const farm = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Farm One", NOW);
    await farms.createWithOwner(farm.farm, farm.ownerMembership, []);
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "SOIL", NOW));
  });

  afterEach(() => {
    db.close();
  });

  function useCase(unlocked = true, ids = new SequenceCropIds()): PlantCrop {
    return new PlantCrop({
      farms,
      members,
      tiles,
      crops,
      inventory,
      idempotency: crops,
      definitions: new GameDataCropDefinitions(),
      progression: progressions,
      progressionDefinition: gameDataProgressionDefinition,
      unlockedLand: new ConfiguredUnlockedLand(unlocked),
      inventoryService: new InventoryService(new GameDataItemDefinitions(), clock),
      ids,
      fingerprints: new Sha256Fingerprint(),
      clock
    });
  }

  const command = {
    requestId: "request_plant_001",
    cropDefinitionId: "crop_carrot",
    x: 0,
    y: 0,
    expectedTileVersion: 1
  };

  function seedQuantity(itemDefinitionId = "item_carrot_seed", player = PLAYER_ONE_ID): unknown {
    return db.sqlite
      .prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(player, itemDefinitionId);
  }

  it("plants on SOIL with server-owned ID and time, spending exactly one seed", async () => {
    giveSeeds(db, "item_carrot_seed", 5);
    const result = await useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(result).toMatchObject({ cropInstanceId: CROP_ONE_ID, plantedAt: NOW, version: 1 });
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).not.toBeNull();
    // The seed is spent by the server, in the same transaction, from the crop's own definition. The
    // command never carried an item ID or a quantity.
    expect(seedQuantity()).toEqual({ quantity: 4, version: 2 });
  });

  it("leaves an empty seed stack at zero rather than negative", async () => {
    giveSeeds(db, "item_carrot_seed", 1);
    await useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(seedQuantity()).toEqual({ quantity: 0, version: 2 });
  });

  it("rejects unauthenticated and unauthorized actors", async () => {
    giveSeeds(db, "item_carrot_seed", 5);
    await expect(useCase().execute(null, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(useCase().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED"
    });
    expect(seedQuantity()).toEqual({ quantity: 5, version: 1 });
  });

  it("refuses to plant with no seed without writing anything", async () => {
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "INSUFFICIENT_ITEMS"
    });
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).toBeNull();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
    expect(seedQuantity()).toBeUndefined();
  });

  it("refuses a crop whose own seed stack is empty even when another seed is stocked", async () => {
    giveSeeds(db, "item_wheat_seed", 10);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "INSUFFICIENT_ITEMS"
    });
    expect(seedQuantity("item_wheat_seed")).toEqual({ quantity: 10, version: 1 });
  });

  it("rejects unknown definitions, missing tiles, and locked land without spending a seed", async () => {
    giveSeeds(db, "item_carrot_seed", 5);
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropDefinitionId: "crop_unknown" })
    ).rejects.toMatchObject({ code: "CROP_DEFINITION_NOT_FOUND" });
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, x: 99 })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(useCase(false).execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    expect(seedQuantity()).toEqual({ quantity: 5, version: 1 });
  });

  it.each(["GRASS", "WATER", "BLOCKED"] as const)("rejects %s terrain without spending a seed", async (terrain) => {
    giveSeeds(db, "item_carrot_seed", 3);
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = ? WHERE farm_id = ? AND x = 0 AND y = 0").run(terrain, FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "TILE_NOT_PLANTABLE"
    });
    expect(seedQuantity()).toEqual({ quantity: 3, version: 1 });
  });

  it("rejects stale versions and occupied tiles without spending a seed", async () => {
    giveSeeds(db, "item_carrot_seed", 4);
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedTileVersion: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
    await useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId: "request_plant_002" })
    ).rejects.toMatchObject({ code: "TILE_OCCUPIED" });
    expect(seedQuantity()).toEqual({ quantity: 3, version: 2 });
  });

  it("returns the same crop for sequential and concurrent retries and spends one seed", async () => {
    giveSeeds(db, "item_carrot_seed", 5);
    const service = useCase();
    const first = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    const retry = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(retry.cropInstanceId).toBe(first.cropInstanceId);
    expect(seedQuantity()).toEqual({ quantity: 4, version: 2 });

    db.sqlite.prepare("DELETE FROM idempotency_keys").run();
    db.sqlite.prepare("DELETE FROM crop_instances").run();
    const concurrentService = useCase(true, new SequenceCropIds());
    const results = await Promise.all([
      concurrentService.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command),
      concurrentService.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)
    ]);
    expect(new Set(results.map((result) => result.cropInstanceId)).size).toBe(1);
    const count = db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get() as { count: number };
    expect(count.count).toBe(1);
    // One sequential planting and one concurrent winner: two calls that landed, and the losing
    // duplicate of the concurrent pair consumed nothing.
    expect(seedQuantity()).toEqual({ quantity: 3, version: 3 });
  });

  it("lets only one of two concurrent plantings spend the last seed", async () => {
    giveSeeds(db, "item_carrot_seed", 1);
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 1, y: 0 }, "SOIL", NOW));
    const service = useCase();
    const results = await Promise.allSettled([
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command),
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId: "request_plant_002", x: 1 })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "INSUFFICIENT_ITEMS" }
    });
    expect(seedQuantity()).toEqual({ quantity: 0, version: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
  });

  it("rejects payload mismatch for the same actor and request ID without spending twice", async () => {
    giveSeeds(db, "item_carrot_seed", 2);
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    // A different coordinate, not a different crop: the gated crops are refused before the
    // idempotency replay in some orderings, so a payload the gate would reject is a weak witness.
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, x: 1 })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(seedQuantity()).toEqual({ quantity: 1, version: 2 });
  });

  it("refuses a crop above the player's level without writing anything or spending a seed", async () => {
    giveSeeds(db, "item_wheat_seed", 5);
    giveSeeds(db, "item_corn_seed", 5);
    const counts = () => ({
      crops: db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get(),
      idempotency: db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()
    });
    const before = counts();
    for (const [requestId, cropDefinitionId] of [
      ["request_plant_locked_wheat", "crop_wheat"],
      ["request_plant_locked_corn", "crop_corn"]
    ] as const) {
      await expect(
        useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId, cropDefinitionId })
      ).rejects.toMatchObject({ code: "CROP_LEVEL_REQUIRED" });
    }
    // A refusal is not a processed request: no crop, no idempotency row, and no seed spent, so the
    // same request id stays usable once the player is allowed to plant.
    expect(counts()).toEqual(before);
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).toBeNull();
    expect(seedQuantity("item_wheat_seed")).toEqual({ quantity: 5, version: 1 });
    expect(seedQuantity("item_corn_seed")).toEqual({ quantity: 5, version: 1 });
  });

  it("unlocks wheat at level 2 and keeps corn locked until level 3", async () => {
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 1, y: 0 }, "SOIL", NOW));
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 2, y: 0 }, "SOIL", NOW));
    giveSeeds(db, "item_wheat_seed", 1);
    giveSeeds(db, "item_corn_seed", 1);
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 2, 120, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    const service = useCase(true, new SequenceCropIds());
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
        ...command,
        requestId: "request_plant_wheat_001",
        cropDefinitionId: "crop_wheat",
        x: 1
      })
    ).resolves.toMatchObject({ definitionId: "crop_wheat", tileX: 1, tileY: 0 });
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
        ...command,
        requestId: "request_plant_corn_001",
        cropDefinitionId: "crop_corn",
        x: 2
      })
    ).rejects.toMatchObject({ code: "CROP_LEVEL_REQUIRED" });
    // Wheat's own seed was spent; the refused corn cost nothing.
    expect(seedQuantity("item_wheat_seed")).toEqual({ quantity: 0, version: 2 });
    expect(seedQuantity("item_corn_seed")).toEqual({ quantity: 1, version: 1 });
  });

  it("derives the level from experience rather than trusting the stored level column", async () => {
    // A row whose cached level disagrees with its experience must never unlock anything. The gate
    // reads the same authoritative experience the harvest writes and re-derives the level from it.
    giveSeeds(db, "item_wheat_seed", 1);
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 25, 0, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, {
        ...command,
        requestId: "request_plant_cached_level",
        cropDefinitionId: "crop_wheat"
      })
    ).rejects.toMatchObject({ code: "CROP_LEVEL_REQUIRED" });
    expect(seedQuantity("item_wheat_seed")).toEqual({ quantity: 1, version: 1 });
  });

  it("rechecks resource access before replaying a completed request", async () => {
    giveSeeds(db, "item_carrot_seed", 1);
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    db.sqlite.prepare("DELETE FROM farms WHERE id = ?").run(FARM_ONE_ID);

    await expect(service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND"
    });
  });

  it("isolates the same request ID between actors", async () => {
    giveSeeds(db, "item_carrot_seed", 2);
    giveSeeds(db, "item_carrot_seed", 2, PLAYER_TWO_ID);
    const secondFarm = createOwnedFarm(FARM_TWO_ID, PLAYER_TWO_ID, "Farm Two", NOW);
    await farms.createWithOwner(secondFarm.farm, secondFarm.ownerMembership, []);
    await tiles.insert(createFarmTile(FARM_TWO_ID, { x: 0, y: 0 }, "SOIL", NOW));
    const service = useCase(true, new SequenceCropIds());
    const first = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    const second = await service.execute({ playerId: PLAYER_TWO_ID }, FARM_TWO_ID, command);
    expect(second.cropInstanceId).not.toBe(first.cropInstanceId);
    expect(seedQuantity()).toEqual({ quantity: 1, version: 2 });
    expect(seedQuantity("item_carrot_seed", PLAYER_TWO_ID)).toEqual({ quantity: 1, version: 2 });
  });

  it("rolls back the crop, the seed, and the receipt when idempotency persistence fails", async () => {
    giveSeeds(db, "item_carrot_seed", 1);
    db.sqlite.exec(
      "CREATE TRIGGER fail_idempotency BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    );
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toThrow();
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).toBeNull();
    expect(seedQuantity()).toEqual({ quantity: 1, version: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
  });

  it("does not record failed validation, allowing a corrected retry", async () => {
    giveSeeds(db, "item_carrot_seed", 1);
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = 'GRASS' WHERE farm_id = ?").run(FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "TILE_NOT_PLANTABLE"
    });
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = 'SOIL' WHERE farm_id = ?").run(FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toMatchObject({
      cropInstanceId: CROP_ONE_ID
    });
    expect(seedQuantity()).toEqual({ quantity: 0, version: 2 });
  });
});
