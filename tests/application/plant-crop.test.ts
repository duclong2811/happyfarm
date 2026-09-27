import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlantCrop, type Clock, type CropIdGenerator } from "@happy-farm/application";
import type { CropInstanceId, UnlockedLandPolicy } from "@happy-farm/domain";
import { createOwnedFarm, createFarmTile } from "@happy-farm/domain";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository
} from "../../workers/api/src/d1-repositories";
import { GameDataCropDefinitions, Sha256Fingerprint } from "../../workers/api/src/runtime";
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

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

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

describe("PlantCrop", () => {
  let db: NodeD1Database;
  let farms: D1FarmRepository;
  let members: D1FarmMemberRepository;
  let tiles: D1FarmTileRepository;
  let crops: D1CropRepository;

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    seedPlayer(db, PLAYER_ONE_ID, "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "subject-two");
    farms = new D1FarmRepository(db);
    members = new D1FarmMemberRepository(db);
    tiles = new D1FarmTileRepository(db);
    crops = new D1CropRepository(db);
    const farm = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Farm One", NOW);
    await farms.createWithOwner(farm.farm, farm.ownerMembership);
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "SOIL", NOW));
  });

  afterEach(() => {
    db.close();
  });

  function useCase(unlocked = true, ids = new SequenceCropIds()): PlantCrop {
    return new PlantCrop(
      farms,
      members,
      tiles,
      crops,
      crops,
      new GameDataCropDefinitions(),
      new ConfiguredUnlockedLand(unlocked),
      ids,
      new Sha256Fingerprint(),
      new FixedClock()
    );
  }

  const command = {
    requestId: "request_plant_001",
    cropDefinitionId: "crop_carrot",
    x: 0,
    y: 0,
    expectedTileVersion: 1
  };

  it("plants on SOIL with server-owned ID and time", async () => {
    const result = await useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(result).toMatchObject({ cropInstanceId: CROP_ONE_ID, plantedAt: NOW, version: 1 });
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).not.toBeNull();
  });

  it("rejects unauthenticated and unauthorized actors", async () => {
    await expect(useCase().execute(null, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(useCase().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED"
    });
  });

  it("rejects unknown definitions, missing tiles, and locked land", async () => {
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropDefinitionId: "crop_unknown" })
    ).rejects.toMatchObject({ code: "CROP_DEFINITION_NOT_FOUND" });
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, x: 99 })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(useCase(false).execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it.each(["GRASS", "WATER", "BLOCKED"] as const)("rejects %s terrain", async (terrain) => {
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = ? WHERE farm_id = ? AND x = 0 AND y = 0").run(terrain, FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "TILE_NOT_PLANTABLE"
    });
  });

  it("rejects stale versions and occupied tiles", async () => {
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedTileVersion: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
    await useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId: "request_plant_002" })
    ).rejects.toMatchObject({ code: "TILE_OCCUPIED" });
  });

  it("returns the same crop for sequential and concurrent retries", async () => {
    const service = useCase();
    const first = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    const retry = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(retry.cropInstanceId).toBe(first.cropInstanceId);

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
  });

  it("rejects payload mismatch for the same actor and request ID", async () => {
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, cropDefinitionId: "crop_wheat" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rechecks resource access before replaying a completed request", async () => {
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    db.sqlite.prepare("DELETE FROM farms WHERE id = ?").run(FARM_ONE_ID);

    await expect(service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND"
    });
  });

  it("isolates the same request ID between actors", async () => {
    const secondFarm = createOwnedFarm(FARM_TWO_ID, PLAYER_TWO_ID, "Farm Two", NOW);
    await farms.createWithOwner(secondFarm.farm, secondFarm.ownerMembership);
    await tiles.insert(createFarmTile(FARM_TWO_ID, { x: 0, y: 0 }, "SOIL", NOW));
    const service = useCase(true, new SequenceCropIds());
    const first = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    const second = await service.execute({ playerId: PLAYER_TWO_ID }, FARM_TWO_ID, command);
    expect(second.cropInstanceId).not.toBe(first.cropInstanceId);
  });

  it("rolls back crop creation when idempotency persistence fails", async () => {
    db.sqlite.exec(
      "CREATE TRIGGER fail_idempotency BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    );
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toThrow();
    expect(await crops.findAtTile(FARM_ONE_ID, 0, 0)).toBeNull();
  });

  it("does not record failed validation, allowing a corrected retry", async () => {
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = 'GRASS' WHERE farm_id = ?").run(FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "TILE_NOT_PLANTABLE"
    });
    db.sqlite.prepare("UPDATE farm_tiles SET terrain_type = 'SOIL' WHERE farm_id = ?").run(FARM_ONE_ID);
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toMatchObject({
      cropInstanceId: CROP_ONE_ID
    });
  });
});
