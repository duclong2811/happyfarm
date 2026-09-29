import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UprootCrop, type Clock } from "@happy-farm/application";
import { createOwnedFarm, createFarmTile } from "@happy-farm/domain";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository
} from "../../workers/api/src/d1-repositories";
import { Sha256Fingerprint } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import {
  CROP_ONE_ID,
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
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const clock: Clock = { now: () => NOW };
const PLANTED_AT = "2026-09-26T00:00:00.000Z";

function seedPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

describe("UprootCrop", () => {
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
    await farms.createWithOwner(farm.farm, farm.ownerMembership, []);
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "SOIL", NOW));
  });

  afterEach(() => {
    db.close();
  });

  function useCase(): UprootCrop {
    return new UprootCrop(farms, members, crops, crops, new Sha256Fingerprint(), clock);
  }

  /** One crop row, planted at a chosen time so the same fixture can be grown or mature. */
  function plantCrop(plantedAt = PLANTED_AT): void {
    db.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 0, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
      )
      .run(CROP_ONE_ID, FARM_ONE_ID, PLAYER_ONE_ID, plantedAt, NOW, NOW);
  }

  const command = { requestId: "request_uproot_01", cropInstanceId: CROP_ONE_ID, expectedCropVersion: 1 };

  it("frees the tile for a crop that is still growing", async () => {
    // Carrot takes 300 seconds; one minute in, the crop is nowhere near harvestable.
    plantCrop("2026-09-27T23:59:00.000Z");
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toEqual({
      cropInstanceId: CROP_ONE_ID
    });
    expect(await crops.findById(CROP_ONE_ID)).toBeNull();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
  });

  it("frees the tile for a mature crop too, without paying anything", async () => {
    // The crop was planted long before NOW, so the server's own timing says it is ready. Uprooting it
    // is still allowed; it just does not become a harvest.
    plantCrop("2026-09-01T00:00:00.000Z");
    const before = () => ({
      inventory: db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get(),
      ledger: db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get(),
      progression: db.sqlite.prepare("SELECT COUNT(*) AS count FROM player_progression").get()
    });
    const snapshot = before();
    await expect(useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).resolves.toEqual({
      cropInstanceId: CROP_ONE_ID
    });
    // No refund of any kind: uprooting is a deletion, not a settlement.
    expect(before()).toEqual(snapshot);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM harvest_settlements").get()).toEqual({ count: 0 });
  });

  it("replays the same request without deleting a second crop", async () => {
    plantCrop();
    const service = useCase();
    const first = await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    expect(await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).toEqual(first);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
  });

  it("allows only one receipt when two different requests claim the same crop revision", async () => {
    plantCrop();
    const crop = await crops.findById(CROP_ONE_ID);
    if (crop === null) throw new Error("crop fixture missing");
    const receipt = (requestId: string) => ({
      actorPlayerId: PLAYER_ONE_ID,
      operation: "UPROOT_CROP",
      requestId,
      payloadFingerprint: "a".repeat(64),
      resourceId: CROP_ONE_ID,
      responseJson: JSON.stringify({ cropInstanceId: CROP_ONE_ID }),
      status: "COMPLETED" as const,
      createdAt: NOW
    });

    await crops.removeAtomically(crop, 1, receipt("request_uproot_race_01"));
    await expect(
      crops.removeAtomically(crop, 1, receipt("request_uproot_race_02"))
    ).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
  });

  it("rejects a payload mismatch for the same request id", async () => {
    plantCrop();
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedCropVersion: 2 })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("does not delete anything on a fresh request for an already-removed crop", async () => {
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 1, y: 0 }, "SOIL", NOW));
    db.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ?, 1, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
      )
      .run(FARM_ONE_ID, PLAYER_ONE_ID, PLANTED_AT, NOW, NOW);
    plantCrop();
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    await expect(
      service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, requestId: "request_uproot_02" })
    ).rejects.toMatchObject({ code: "CROP_NOT_FOUND" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
  });

  it("refuses a stale crop version without deleting the crop", async () => {
    plantCrop();
    await expect(
      useCase().execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { ...command, expectedCropVersion: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
    expect(await crops.findById(CROP_ONE_ID)).not.toBeNull();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
  });

  it("rejects unauthenticated, unauthorized, and cross-farm requests", async () => {
    plantCrop();
    await expect(useCase().execute(null, FARM_ONE_ID, command)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(useCase().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED"
    });
    // A crop ID is addressed under a farm, and the two have to agree: naming another farm must not
    // reach this farm's crop.
    const secondFarm = createOwnedFarm(FARM_TWO_ID, PLAYER_TWO_ID, "Farm Two", NOW);
    await farms.createWithOwner(secondFarm.farm, secondFarm.ownerMembership, []);
    await expect(
      useCase().execute({ playerId: PLAYER_TWO_ID }, FARM_TWO_ID, command)
    ).rejects.toMatchObject({ code: "CROP_NOT_FOUND" });
    expect(await crops.findById(CROP_ONE_ID)).not.toBeNull();
  });

  it("rechecks current access before answering a replay", async () => {
    plantCrop();
    const service = useCase();
    await service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command);
    // The membership is gone with the farm, so the stored result must not be readable any more: the
    // replay re-reads the farm and the membership instead of trusting the receipt on its own.
    db.sqlite.prepare("DELETE FROM farms WHERE id = ?").run(FARM_ONE_ID);
    await expect(service.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND"
    });
  });

  it("rolls the deletion back when the receipt cannot be written", async () => {
    let armed = false;
    const failing = new NodeD1Database(migration, {
      afterStatement: (index) => {
        // Armed only for the uproot batch, so setting the fixture up is not what fails.
        if (armed && index === 0) throw new Error("injected receipt failure");
      }
    });
    seedPlayer(failing, PLAYER_ONE_ID, "subject-one");
    const failingFarms = new D1FarmRepository(failing);
    const farm = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Farm One", NOW);
    await failingFarms.createWithOwner(farm.farm, farm.ownerMembership, []);
    await new D1FarmTileRepository(failing).insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "SOIL", NOW));
    failing.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 0, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
      )
      .run(CROP_ONE_ID, FARM_ONE_ID, PLAYER_ONE_ID, PLANTED_AT, NOW, NOW);
    const failingCrops = new D1CropRepository(failing);
    const uproot = new UprootCrop(
      failingFarms,
      new D1FarmMemberRepository(failing),
      failingCrops,
      failingCrops,
      new Sha256Fingerprint(),
      clock
    );
    armed = true;
    await expect(uproot.execute({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, command)).rejects.toThrow(
      "injected receipt failure"
    );
    expect(await failingCrops.findById(CROP_ONE_ID)).not.toBeNull();
    expect(failing.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
    failing.close();
  });
});
