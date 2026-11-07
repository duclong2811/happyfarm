import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The actor/job migration is additive and safe against a live save.
 *
 * The staging database holds real players, farms, work areas, crops and ledgers, so the honest proof
 * is to build the schema *without* the two new tables, put a save in it, apply the migration, and
 * re-read what was already there - then check the constraints the spine depends on.
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
  "0022_work_areas.sql"
];

const ACTORS_AND_JOBS = "0023_actors_and_jobs.sql";
const AREA_ID = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_ID = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NPC_ID = "actor_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
      "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 777, 1, ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'East Field', 1, ?, ?, ?)"
    )
    .run(AREA_ID, FARM_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO work_area_cells (work_area_id, x, y) VALUES (?, 9, 26)").run(AREA_ID);
  db.sqlite
    .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 3, 4, 'SOIL', 'IDLE', 1, ?)")
    .run(FARM_ONE_ID, NOW);
}

describe("actor and job migration", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("adds two tables to a live save and leaves everything that was there alone", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n"));
    seedSave(db);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'actors'").get()
    ).toEqual({ n: 0 });

    db.sqlite.exec(migration(ACTORS_AND_JOBS));

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('actors','actor_jobs')").get()
    ).toEqual({ n: 2 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 777 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_area_cells").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({ n: 1 });
    // A save that had no actors gains none until somebody asks for the panel.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actors").get()).toEqual({ n: 0 });
  });

  it("allows exactly one Main Character per player, and still room for the NPCs to come", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(ACTORS_AND_JOBS));
    seedSave(db);
    const insert = (id: string, kind: string): void => {
      db?.sqlite
        .prepare(
          "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, ?, 'PLAYER_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?)"
        )
        .run(id, PLAYER_ONE_ID, kind, `zone_home_island_${FARM_ONE_ID}`, NOW, NOW);
    };
    insert(ACTOR_ID, "MAIN_CHARACTER");
    expect(() => {
      insert("actor_dddddddd-dddd-4ddd-8ddd-dddddddddddd", "MAIN_CHARACTER");
    }).toThrow();
    // A second actor of another kind is what a later slice adds, and the partial index allows it.
    insert(NPC_ID, "NPC_WORKER");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actors").get()).toEqual({ n: 2 });
  });

  it("refuses to delete a work area a job names, and takes a job with its actor", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(ACTORS_AND_JOBS));
    seedSave(db);
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

    // The area's delete is refused by the database itself, so no cascade can quietly remove the job.
    expect(() => {
      db?.sqlite.prepare("DELETE FROM work_areas WHERE id = ?").run(AREA_ID);
    }).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs WHERE id = ?").get(JOB_ID)).toEqual({ n: 1 });

    // A job goes with its actor: an actor's work is its own.
    db.sqlite.prepare("DELETE FROM actors WHERE id = ?").run(ACTOR_ID);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs").get()).toEqual({ n: 0 });
  });

  it("refuses an unknown kind, an out-of-range priority and a non-boolean enabled flag", () => {
    db = new NodeD1Database(BEFORE.map(migration).join("\n") + "\n" + migration(ACTORS_AND_JOBS));
    seedSave(db);
    const insertJob = (overrides: { readonly kind?: string; readonly priority?: number; readonly enabled?: number }): void => {
      db?.sqlite
        .prepare(
          "INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, enabled, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'crop_carrot', ?, ?, 1, ?, ?)"
        )
        .run(
          `job_${String(Math.random()).slice(2, 10)}-cccc-4ccc-8ccc-cccccccccccc`,
          ACTOR_ID,
          FARM_ONE_ID,
          AREA_ID,
          overrides.kind ?? "FARM",
          overrides.priority ?? 1,
          overrides.enabled ?? 1,
          NOW,
          NOW
        );
    };
    // The actor row is needed first, and the job's foreign keys point at it.
    db.sqlite
      .prepare(
        "INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'PLAYER_CONTROLLED', 'HOME_ISLAND', ?, 1, ?, ?)"
      )
      .run(ACTOR_ID, PLAYER_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, NOW, NOW);
    expect(() => {
      insertJob({ kind: "MIXED" });
    }).toThrow();
    expect(() => {
      insertJob({ priority: 0 });
    }).toThrow();
    expect(() => {
      insertJob({ priority: 25 });
    }).toThrow();
    expect(() => {
      insertJob({ enabled: 2 });
    }).toThrow();
    insertJob({});
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs").get()).toEqual({ n: 1 });
  });
});
