import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The cargo migration is additive, and the guard it installs is the database's.
 *
 * The staging database holds real players, actors, work areas and stock, so the honest proof is to
 * build the schema *without* the cargo table, put a save in it, apply the migration, and re-read what
 * was there - then check that the capacity guard refuses an over-capacity row on its own.
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
  "0023_actors_and_jobs.sql"
];

const CARGO = "0024_actor_cargo.sql";
const ACTOR_ID = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function seedSave(db: NodeD1Database, withActor: boolean): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 7, 1, ?)"
    )
    .run(PLAYER_ONE_ID, NOW);
  if (withActor) {
    db.sqlite
      .prepare(
        "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'PLAYER_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?)"
      )
      .run(ACTOR_ID, PLAYER_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, NOW, NOW);
  }
}

describe("actor cargo migration", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("adds one table and two columns to a live save, leaving every existing row alone", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n"));
    seedSave(db, true);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'actor_cargo_items'").get()
    ).toEqual({ n: 0 });

    db.sqlite.exec(migration(CARGO));

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'actor_cargo_items'").get()
    ).toEqual({ n: 1 });
    // Existing inventory is untouched: it stays warehouse stock, and no cargo row is invented.
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ quantity: 7 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_cargo_items").get()).toEqual({ n: 0 });
    // An existing actor gains the starter capacity and an empty container, not a converted one.
    expect(db.sqlite.prepare("SELECT cargo_capacity, cargo_version FROM actors WHERE id = ?").get(ACTOR_ID)).toEqual({
      cargo_capacity: 30,
      cargo_version: 1
    });
  });

  it("refuses an over-capacity row in the database itself, and allows emptying one", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(CARGO));
    seedSave(db, true);
    const insert = (itemDefinitionId: string, quantity: number): void => {
      db?.sqlite
        .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?)")
        .run(ACTOR_ID, itemDefinitionId, quantity, NOW);
    };
    insert("item_carrot", 30);
    expect(() => {
      insert("item_wood", 1);
    }).toThrow(/cargo_full/u);
    // Growing a row is guarded the same way.
    expect(() => {
      db?.sqlite.prepare("UPDATE actor_cargo_items SET quantity = 31 WHERE actor_id = ? AND item_definition_id = 'item_carrot'").run(ACTOR_ID);
    }).toThrow(/cargo_full/u);
    // Emptying is always allowed, which is what lets a grandfathered container unload.
    db.sqlite.prepare("DELETE FROM actor_cargo_items WHERE actor_id = ?").run(ACTOR_ID);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_cargo_items").get()).toEqual({ n: 0 });

    // A non-item id, a zero stack and a negative one are refused by the table's own checks.
    expect(() => {
      insert("currency_gold", 1);
    }).toThrow();
    expect(() => {
      insert("item_wood", 0);
    }).toThrow();
    expect(() => {
      insert("item_wood", -1);
    }).toThrow();
  });

  it("takes an actor's cargo with the actor, and refuses cargo for an actor that does not exist", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(CARGO));
    seedSave(db, true);
    db.sqlite
      .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 3, 1, ?)")
      .run(ACTOR_ID, NOW);
    expect(() =>
      db?.sqlite
        .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES ('actor_zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz', 'item_carrot', 1, 1, ?)")
        .run(NOW)
    ).toThrow();
    db.sqlite.prepare("DELETE FROM actors WHERE id = ?").run(ACTOR_ID);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_cargo_items").get()).toEqual({ n: 0 });
  });
});
