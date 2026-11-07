import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The Auto execution migration is additive, and it changes the harvest destination without changing
 * the harvest itself.
 *
 * The proof that matters: a save built without the migration keeps working, a `WAREHOUSE` harvest
 * behaves exactly as it always did, and a `CARGO` harvest credits the actor's cargo through the same
 * settlement row - with the cargo capacity trigger still the authority.
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
  "0021_farm_read_indexes.sql",
  "0022_work_areas.sql",
  "0023_actors_and_jobs.sql",
  "0024_actor_cargo.sql",
  "0025_assignment_auto_purchase.sql"
];

const AUTO = "0026_auto_execution.sql";
const ACTOR_ID = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function seedSave(db: NodeD1Database, cropId: string, cargoSeed: number): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?)"
    )
    .run(ACTOR_ID, PLAYER_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 4, 1, ?)")
    .run(PLAYER_ONE_ID, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 3, 4, 'SOIL', 'IDLE', 1, ?)"
    )
    .run(FARM_ONE_ID, NOW);
  db.sqlite
    .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', ?, 1, ?)")
    .run(ACTOR_ID, cargoSeed, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 3, 4, 'crop_carrot', ?, ?, 1, ?, ?)"
    )
    .run(cropId, FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW, NOW);
}

/** One harvest settlement row, with the destination this test is about. */
function settle(db: NodeD1Database, cropId: string, destination: string, quantity: number, requestId: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO harvest_settlements (actor_player_id, operation, request_id, farm_id, crop_instance_id, crop_version, crop_definition_id, item_definition_id, quantity, max_quantity, created_at, destination) VALUES (?, 'HARVEST_CROP', ?, ?, ?, 1, 'crop_carrot', 'item_carrot', ?, 2147483647, ?, ?)"
    )
    .run(PLAYER_ONE_ID, requestId, FARM_ONE_ID, cropId, quantity, NOW, destination);
}

describe("auto execution migration", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("adds the travel state table and a harvest destination, and leaves the manual path alone", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n"));
    seedSave(db, "cropinst_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 5);

    db.sqlite.exec(migration(AUTO));

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'actor_auto_state'").get()
    ).toEqual({ n: 1 });
    // A historical settlement (and every manual one) reads back as the warehouse destination.
    expect(
      db.sqlite.prepare("SELECT destination FROM harvest_settlements LIMIT 1").get() ?? null
    ).toBeNull();

    // The manual harvest is unchanged: the reward lands in the warehouse and the crop goes.
    settle(db, "cropinst_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "WAREHOUSE", 2, "harvest-warehouse-01");
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual({
      quantity: 6
    });
    expect(db.sqlite.prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = 'item_carrot'").get(ACTOR_ID)).toBeUndefined();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()).toEqual({ n: 0 });
  });

  it("lands an Auto harvest in the actor's cargo, through the same settlement and the same crop rules", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(AUTO));
    seedSave(db, "cropinst_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 25);

    settle(db, "cropinst_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "CARGO", 2, "harvest-cargo-01");

    // The warehouse is untouched and the cargo grew by exactly the reward.
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual({
      quantity: 4
    });
    expect(db.sqlite.prepare("SELECT quantity, version FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = 'item_carrot_seed'").get(ACTOR_ID)).toEqual({
      quantity: 25,
      version: 1
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT destination FROM harvest_settlements WHERE request_id = 'harvest-cargo-01'").get()).toEqual({
      destination: "CARGO"
    });
  });

  it("refuses a cargo harvest that does not fit, and refuses an unknown destination", () => {
    const active = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(AUTO));
    db = active;
    seedSave(active, "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", 29);

    // 29 + 10 would exceed the starter 30: the cargo capacity trigger aborts and the crop stays.
    expect(() => {
      settle(active, "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", "CARGO", 10, "harvest-cargo-overflow");
    }).toThrow();
    expect(active.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()).toEqual({ n: 1 });
    expect(active.sqlite.prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = ?").get(ACTOR_ID)).toEqual({ quantity: 29 });

    expect(() => {
      settle(active, "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", "SHIP", 1, "harvest-bad-destination");
    }).toThrow();
  });

  it("keeps one travel row per actor and refuses a cell anchor with no coordinates", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(AUTO));
    seedSave(db, "cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd", 5);

    db.sqlite
      .prepare(
        "INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at) VALUES (?, 'CELL', 3, 4, 'WAREHOUSE', NULL, NULL, ?, 1, ?)"
      )
      .run(ACTOR_ID, NOW, NOW);
    expect(
      db.sqlite.prepare("SELECT anchor_kind, travel_kind, travel_arrives_at FROM actor_auto_state WHERE actor_id = ?").get(ACTOR_ID)
    ).toEqual({ anchor_kind: "CELL", travel_kind: "WAREHOUSE", travel_arrives_at: NOW });

    expect(() => {
      db?.sqlite
        .prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, travel_kind, version, updated_at) VALUES ('actor_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'CELL', NULL, 0, ?)")
        .run(NOW);
    }).toThrow();
    // A walk with no arrival time is not a walk.
    expect(() => {
      db?.sqlite
        .prepare("UPDATE actor_auto_state SET travel_kind = 'MARKET', travel_arrives_at = NULL WHERE actor_id = ?")
        .run(ACTOR_ID);
    }).toThrow();
  });
});
