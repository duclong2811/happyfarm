import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The Assignment policy migration is one additive column with a safe default.
 *
 * Auto Purchase is a policy, not a fact, and the honest proof is the same one the cargo migration
 * makes: build the schema without the column, put a real save in it, apply the migration, and check
 * that every existing row was left exactly as it was - reading as "never buy" rather than being
 * rewritten to either answer.
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
  "0024_actor_cargo.sql"
];

const POLICY = "0025_assignment_auto_purchase.sql";
const AREA_ID = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_ID = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "job_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function seedSave(db: NodeD1Database): void {
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
      "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'East Field', 1, ?, ?, ?)"
    )
    .run(AREA_ID, FARM_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'PLAYER_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?)"
    )
    .run(ACTOR_ID, PLAYER_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, NOW, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, enabled, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 1, 1, 1, ?, ?)"
    )
    .run(JOB_ID, ACTOR_ID, FARM_ONE_ID, AREA_ID, NOW, NOW);
}

describe("assignment policy migration", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("adds one column to a live save and reads every existing assignment as 'never buy'", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n"));
    seedSave(db);
    const columns = db.sqlite.prepare("SELECT name FROM pragma_table_info('actor_jobs')").all() as unknown as readonly {
      readonly name: string;
    }[];
    expect(columns.map((column) => column.name)).not.toContain("auto_purchase_supplies");

    db.sqlite.exec(migration(POLICY));

    // The existing assignment keeps its place, its order and its enabled flag, and gains the policy
    // in its safe direction - off.
    expect(
      db.sqlite
        .prepare("SELECT priority, enabled, version, auto_purchase_supplies FROM actor_jobs WHERE id = ?")
        .get(JOB_ID)
    ).toEqual({ priority: 1, enabled: 1, version: 1, auto_purchase_supplies: 0 });
  });

  it("refuses a value that is not a boolean, at the database itself", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(POLICY));
    seedSave(db);
    db.sqlite.prepare("UPDATE actor_jobs SET auto_purchase_supplies = 1 WHERE id = ?").run(JOB_ID);
    expect(
      db.sqlite.prepare("SELECT auto_purchase_supplies FROM actor_jobs WHERE id = ?").get(JOB_ID)
    ).toEqual({ auto_purchase_supplies: 1 });
    expect(() => {
      db?.sqlite.prepare("UPDATE actor_jobs SET auto_purchase_supplies = 2 WHERE id = ?").run(JOB_ID);
    }).toThrow();
  });
});
