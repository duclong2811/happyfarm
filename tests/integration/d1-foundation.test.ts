import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOwnedFarm, createFarmTile } from "@happy-farm/domain";
import {
  D1FarmRepository,
  D1FarmTileRepository
} from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migrationPath = fileURLToPath(
  new URL("../../database/migrations/0001_phase_1_foundation.sql", import.meta.url)
);
const migration = readFileSync(migrationPath, "utf8");

function seedPlayer(db: NodeD1Database, id: string, issuer: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)"
    )
    .run(id, issuer, subject, "Player", NOW, NOW);
}

describe("D1 Phase 1 migration and repositories", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    seedPlayer(db, PLAYER_ONE_ID, "https://identity.test", "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "https://identity.test", "subject-two");
  });

  afterEach(() => {
    db.close();
  });

  it("enforces unique issuer and subject pairs", () => {
    expect(() => {
      seedPlayer(db, "player_33333333-3333-4333-8333-333333333333", "https://identity.test", "subject-one");
    }).toThrow();
  });

  it("enforces role, membership uniqueness, owner matching, and one OWNER", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(aggregate.farm, aggregate.ownerMembership);

    expect(() =>
      db.sqlite
        .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'ADMIN', ?)")
        .run(FARM_ONE_ID, PLAYER_TWO_ID, NOW)
    ).toThrow();
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'VISITOR', ?)")
        .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW)
    ).toThrow();
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
        .run(FARM_ONE_ID, PLAYER_TWO_ID, NOW)
    ).toThrow();
    expect(() => db.sqlite.prepare("DELETE FROM farm_members WHERE farm_id = ? AND player_id = ?").run(FARM_ONE_ID, PLAYER_ONE_ID)).toThrow();
    expect(() => db.sqlite.prepare("UPDATE farms SET owner_player_id = ? WHERE id = ?").run(PLAYER_TWO_ID, FARM_ONE_ID)).toThrow();
  });

  it("enforces foreign-key deletion behavior", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(aggregate.farm, aggregate.ownerMembership);
    expect(() => db.sqlite.prepare("DELETE FROM players WHERE id = ?").run(PLAYER_ONE_ID)).toThrow();
    db.sqlite.prepare("DELETE FROM farms WHERE id = ?").run(FARM_ONE_ID);
    const memberCount = db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM farm_members WHERE farm_id = ?")
      .get(FARM_ONE_ID) as { count: number };
    expect(memberCount.count).toBe(0);
  });

  it("rolls back the farm insert when owner membership insertion fails", async () => {
    db.sqlite.exec(
      "CREATE TRIGGER fail_owner_insert BEFORE INSERT ON farm_members BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    );
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await expect(new D1FarmRepository(db).createWithOwner(aggregate.farm, aggregate.ownerMembership)).rejects.toThrow();
    const farmCount = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get() as { count: number };
    expect(farmCount.count).toBe(0);
  });

  it("enforces unique coordinates and optimistic tile versions", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(aggregate.farm, aggregate.ownerMembership);
    const tiles = new D1FarmTileRepository(db);
    const tile = createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "GRASS", NOW);
    await tiles.insert(tile);
    await expect(tiles.insert(tile)).rejects.toThrow();
    expect(await tiles.updateVersion({ ...tile, version: 2 }, 1)).toBe(true);
    expect(await tiles.updateVersion({ ...tile, version: 2 }, 1)).toBe(false);
  });

  it("rejects foreign keys, out-of-range coordinates, and arbitrary tile enums", () => {
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(FARM_ONE_ID, "player_ffffffff-ffff-4fff-8fff-ffffffffffff", "Farm", NOW, NOW)
    ).toThrow();

    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(aggregate.farm.id, aggregate.farm.ownerPlayerId, aggregate.farm.name, NOW, NOW);
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, updated_at) VALUES (?, 1000001, 0, 'GRASS', 'IDLE', ?)"
        )
        .run(FARM_ONE_ID, NOW)
    ).toThrow();
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, updated_at) VALUES (?, 0, 0, 'LAVA', 'IDLE', ?)"
        )
        .run(FARM_ONE_ID, NOW)
    ).toThrow();
  });
});
