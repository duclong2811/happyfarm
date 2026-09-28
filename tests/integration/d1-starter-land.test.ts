import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialFarmTiles, createOwnedFarm, INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { D1FarmRepository, D1FarmTileRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

const migration = readFileSync(
  fileURLToPath(new URL("../../database/migrations/0001_phase_1_foundation.sql", import.meta.url)),
  "utf8"
);

function countRows(db: NodeD1Database, table: string): number {
  const row = db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

describe("starter land persistence", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Player One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("persists the farm, its OWNER membership, and its starter land in one transaction", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    const initialTiles = createInitialFarmTiles(FARM_ONE_ID, NOW);
    await new D1FarmRepository(db).createWithOwner(aggregate.farm, aggregate.ownerMembership, initialTiles);

    expect(countRows(db, "farms")).toBe(1);
    expect(countRows(db, "farm_members")).toBe(1);
    expect(countRows(db, "farm_tiles")).toBe(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);

    const tiles = new D1FarmTileRepository(db);
    expect(await tiles.find(FARM_ONE_ID, 0, 0)).toMatchObject({ terrainType: "SOIL", version: 1 });
    const listed = await tiles.listByFarm(FARM_ONE_ID);
    expect(listed).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(listed[0]).toMatchObject({ x: 0, y: 0 });
    expect(listed.at(-1)).toMatchObject({ x: INITIAL_LAND_SIZE - 1, y: INITIAL_LAND_SIZE - 1 });
  });

  it("rolls back the farm, membership, and land when a tile insert fails", async () => {
    db.sqlite.exec(
      "CREATE TRIGGER fail_last_tile BEFORE INSERT ON farm_tiles WHEN NEW.x = 5 AND NEW.y = 5 BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    );
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await expect(
      new D1FarmRepository(db).createWithOwner(
        aggregate.farm,
        aggregate.ownerMembership,
        createInitialFarmTiles(FARM_ONE_ID, NOW)
      )
    ).rejects.toThrow();

    expect(countRows(db, "farms")).toBe(0);
    expect(countRows(db, "farm_members")).toBe(0);
    expect(countRows(db, "farm_tiles")).toBe(0);
  });
});