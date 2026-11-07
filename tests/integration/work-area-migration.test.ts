import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The work-area migration is additive and safe against a live save.
 *
 * The staging database is not a fixture: it holds real players, farms, crops and ledgers. The only
 * honest way to prove a new pair of tables is safe is to build the schema *without* them, put a save
 * in it, then apply the migration and re-read what was there.
 */

function migration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

const BEFORE = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql",
  "0009_starter_package.sql",
  "0010_farm_constructions.sql",
  "0011_construction_editing.sql",
  "0012_world_objects.sql",
  "0013_world_objects_v2.sql",
  "0014_one_farm_per_player.sql",
  "0015_player_identities.sql",
  "0016_fishing_actions.sql",
  "0017_resource_nodes.sql",
  "0018_island_warehouses.sql",
  "0019_warehouse_upgrade_marker.sql",
  "0020_action_reward_rolls.sql",
  "0021_farm_read_indexes.sql"
];

const WORK_AREAS = "0022_work_areas.sql";

describe("work-area migration", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("adds two tables to a database that already holds a save, and touches nothing that was there", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n"));
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Old Farm', ?, ?)"
      )
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 321, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 3, 4, 'SOIL', 'IDLE', 1, ?)"
      )
      .run(FARM_ONE_ID, NOW);

    // Before: the tables do not exist at all.
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'work_areas'").get()
    ).toEqual({ n: 0 });

    db.sqlite.exec(migration(WORK_AREAS));

    // After: the new tables exist, and every row that was already there is exactly as it was.
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'work_areas'").get()
    ).toEqual({ n: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'work_area_cells'").get()
    ).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 321 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({ n: 1 });
  });

  it("cascades a deleted area's cells and refuses a cell whose area does not exist", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(WORK_AREAS));
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)"
      )
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES ('workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, 'HOME_ISLAND', ?, 'FARM', 'East Field', 1, ?, ?, ?)"
      )
      .run(FARM_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO work_area_cells (work_area_id, x, y) VALUES ('workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3, 4)"
      )
      .run();

    // The same cell twice is refused by the primary key, like every other membership list.
    expect(() =>
      db?.sqlite
        .prepare(
          "INSERT INTO work_area_cells (work_area_id, x, y) VALUES ('workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3, 4)"
        )
        .run()
    ).toThrow();
    // A cell for an area that does not exist is refused by the foreign key.
    expect(() =>
      db?.sqlite
        .prepare(
          "INSERT INTO work_area_cells (work_area_id, x, y) VALUES ('workarea_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 1)"
        )
        .run()
    ).toThrow();
    // A kind outside the stable set is refused by the table's own check.
    expect(() =>
      db?.sqlite
        .prepare(
          "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES ('workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 'HOME_ISLAND', ?, 'MIXED', 'Mixed', 1, ?, ?, ?)"
        )
        .run(FARM_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, PLAYER_ONE_ID, NOW, NOW)
    ).toThrow();

    // Deleting the area takes its cells with it.
    db.sqlite.prepare("DELETE FROM work_areas WHERE id = ?").run("workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_area_cells").get()).toEqual({ n: 0 });
  });
});
