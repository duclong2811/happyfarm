import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { allMigrationNames } from "../support/migrations";

const T0 = "2026-10-09T00:00:00.000Z";
const PLAYER = "player_11111111-1111-4111-8111-111111111111";
const FARM = "farm_22222222-2222-4222-8222-222222222222";
const AREA = "workarea_33333333-3333-4333-8333-333333333333";
const ACTOR = "actor_44444444-4444-4444-8444-444444444444";
const JOB = "job_55555555-5555-4555-8555-555555555555";
const SOURCE = "production_source_66666666-6666-4666-8666-666666666666";
const ASSIGNMENT = "production_assignment_77777777-7777-4777-8777-777777777777";
const CONSTRUCTION = "construct_88888888-8888-4888-8888-888888888888";

function migration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

function before0030(): string {
  return allMigrationNames()
    .filter((name) => name < "0030_wild_fishery_stock.sql")
    .map(migration)
    .join("\n");
}

function tableColumns(db: NodeD1Database, table: string): readonly unknown[] {
  return db.sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row);
}

function indexNames(db: NodeD1Database, table: string): readonly string[] {
  return (db.sqlite.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[])
    .map((row) => row.name)
    .sort();
}

function foreignKeyTargets(db: NodeD1Database, table: string): readonly string[] {
  return (db.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[])
    .map((row) => row.table)
    .sort();
}

function applyMigration(db: NodeD1Database, name: string): void {
  db.sqlite.exec("BEGIN IMMEDIATE");
  try {
    db.sqlite.exec(migration(name));
    db.sqlite.exec("COMMIT");
  } catch (error: unknown) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function seedPersistedSave(db: NodeD1Database): void {
  db.sqlite
    .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Migration Fixture', 'ACTIVE', ?, ?)")
    .run(PLAYER, PLAYER, T0, T0);
  db.sqlite
    .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Migration Farm', ?, ?)")
    .run(FARM, PLAYER, T0, T0);
  db.sqlite
    .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
    .run(FARM, PLAYER, T0);
  db.sqlite
    .prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'Existing Field', 4, ?, ?, ?)")
    .run(AREA, FARM, FARM, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO work_area_cells (work_area_id, x, y) VALUES (?, 4, 5)").run(AREA);
  db.sqlite
    .prepare("INSERT INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, version, created_at, updated_at) VALUES (?, ?, 'NPC_WORKER', 'AUTO_CONTROLLED', 'HOME_ISLAND', ?, 2, ?, ?)")
    .run(ACTOR, PLAYER, FARM, T0, T0);
  db.sqlite
    .prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, enabled, version, created_at, updated_at, auto_purchase_supplies, auto_funding_enabled, execution_mode) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 3, 1, 7, ?, ?, 1, 1, 'RATE_PRODUCTION')")
    .run(JOB, ACTOR, FARM, AREA, T0, T0);
  db.sqlite
    .prepare("INSERT INTO auto_funding_items (job_id, item_definition_id, priority, created_at, updated_at) VALUES (?, 'item_carrot_seed', 1, ?, ?)")
    .run(JOB, T0, T0);
  db.sqlite
    .prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version, created_at, updated_at) VALUES (?, ?, 'FINITE', 'item_stone', 4, 80, 1, 3, ?, ?)")
    .run(SOURCE, FARM, T0, T0);
  db.sqlite
    .prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, work_area_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 2, NULL, 5, ?, ?)")
    .run(ASSIGNMENT, FARM, ACTOR, JOB, AREA, SOURCE, T0, T0, T0);
  db.sqlite
    .prepare("INSERT INTO production_settlement_receipts (assignment_id, request_id, cursor_before, cursor_after, produced_quantity, created_at) VALUES (?, 'receipt_00000001', ?, ?, 4, ?)")
    .run(ASSIGNMENT, T0, "2026-10-09T01:00:00.000Z", T0);
  db.sqlite
    .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_existing_stock', 12, ?, 2)")
    .run(PLAYER, T0);
  db.sqlite
    .prepare("INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, 'place_fish_cage', 'FISHERY', 20, 20, 0, 1, 1, 20, 20, 20, 20, 1, 'STORED', ?, 'PLAYER_PLACED', NULL, 0, 0, 'currency_gold', ?, ?, ?, 1)")
    .run(CONSTRUCTION, FARM, PLAYER, T0, T0, T0);
}

describe("wild fishery migration 0030", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(before0030());
    seedPersistedSave(db);
  });

  afterEach(() => {
    db.close();
  });

  it("rebuilds the complete dependency graph without losing a persisted save", () => {
    const beforeCounts = db.sqlite
      .prepare("SELECT (SELECT COUNT(*) FROM work_areas) AS work_areas, (SELECT COUNT(*) FROM work_area_cells) AS work_area_cells, (SELECT COUNT(*) FROM actor_jobs) AS actor_jobs, (SELECT COUNT(*) FROM auto_funding_items) AS auto_funding_items, (SELECT COUNT(*) FROM production_assignments) AS production_assignments, (SELECT COUNT(*) FROM production_settlement_receipts) AS production_settlement_receipts, (SELECT COUNT(*) FROM inventory_items) AS inventory_items, (SELECT COUNT(*) FROM farm_constructions) AS farm_constructions")
      .get();
    const beforeColumns = new Map([
      ["work_areas", tableColumns(db, "work_areas")],
      ["actor_jobs", tableColumns(db, "actor_jobs")],
      ["work_area_cells", tableColumns(db, "work_area_cells")],
      ["auto_funding_items", tableColumns(db, "auto_funding_items")],
      ["production_assignments", tableColumns(db, "production_assignments")],
      ["production_settlement_receipts", tableColumns(db, "production_settlement_receipts")]
    ]);
    const beforeIndexes = new Map([
      ["work_areas", indexNames(db, "work_areas")],
      ["actor_jobs", indexNames(db, "actor_jobs")],
      ["work_area_cells", indexNames(db, "work_area_cells")],
      ["auto_funding_items", indexNames(db, "auto_funding_items")],
      ["production_assignments", indexNames(db, "production_assignments")]
    ]);
    const beforeTriggers = db.sqlite
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('work_areas', 'actor_jobs', 'work_area_cells', 'auto_funding_items', 'production_assignments', 'production_settlement_receipts') ORDER BY name")
      .all();

    expect(() => {
      applyMigration(db, "0030_wild_fishery_stock.sql");
    }).not.toThrow();

    expect(db.sqlite.prepare("SELECT kind, version, created_by_player_id FROM work_areas WHERE id = ?").get(AREA)).toEqual({ kind: "FARM", version: 4, created_by_player_id: PLAYER });
    expect(db.sqlite.prepare("SELECT work_area_id, kind, priority, execution_mode FROM actor_jobs WHERE id = ?").get(JOB)).toEqual({ work_area_id: AREA, kind: "FARM", priority: 3, execution_mode: "RATE_PRODUCTION" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_area_cells WHERE work_area_id = ?").get(AREA)).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM auto_funding_items WHERE job_id = ?").get(JOB)).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT work_area_id FROM production_assignments WHERE id = ?").get(ASSIGNMENT)).toEqual({ work_area_id: AREA });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_settlement_receipts WHERE assignment_id = ?").get(ASSIGNMENT)).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_existing_stock'").get(PLAYER)).toEqual({ quantity: 12 });
    expect(db.sqlite.prepare("SELECT owner_player_id, state FROM farm_constructions WHERE id = ?").get(CONSTRUCTION)).toEqual({ owner_player_id: PLAYER, state: "STORED" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas WHERE kind = 'FISHERY'").get()).toEqual({ n: 0 });

    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'fishing_spot_states'").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_fishing_spot_states_zone'").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE '%v16_2_3d3a'").get()).toEqual({ n: 0 });
    expect(foreignKeyTargets(db, "work_area_cells")).toEqual(["work_areas"]);
    expect(foreignKeyTargets(db, "actor_jobs")).toEqual(["actors", "farms", "work_areas"]);
    expect(foreignKeyTargets(db, "auto_funding_items")).toEqual(["actor_jobs"]);
    expect(foreignKeyTargets(db, "production_assignments")).toEqual(["actor_jobs", "actors", "farms", "production_sources", "work_areas"]);
    expect(foreignKeyTargets(db, "production_settlement_receipts")).toEqual(["production_assignments"]);
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%v16_2_3d3a%'").get()).toEqual({ n: 0 });
    expect(beforeTriggers).toEqual([]);

    for (const [table, columns] of beforeColumns) expect(tableColumns(db, table)).toEqual(columns);
    for (const [table, indexes] of beforeIndexes) expect(indexNames(db, table)).toEqual(indexes);
    expect(db.sqlite.prepare("SELECT (SELECT COUNT(*) FROM work_areas) AS work_areas, (SELECT COUNT(*) FROM work_area_cells) AS work_area_cells, (SELECT COUNT(*) FROM actor_jobs) AS actor_jobs, (SELECT COUNT(*) FROM auto_funding_items) AS auto_funding_items, (SELECT COUNT(*) FROM production_assignments) AS production_assignments, (SELECT COUNT(*) FROM production_settlement_receipts) AS production_settlement_receipts, (SELECT COUNT(*) FROM inventory_items) AS inventory_items, (SELECT COUNT(*) FROM farm_constructions) AS farm_constructions").get()).toEqual(beforeCounts);
  });

  it("keeps 0031 compatible after the corrected 0030 rebuild", () => {
    applyMigration(db, "0030_wild_fishery_stock.sql");
    expect(() => {
      applyMigration(db, "0031_aquaculture_pond_cycle.sql");
    }).not.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('aquaculture_pond_states', 'aquaculture_harvest_settlements')").get()).toEqual({ n: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN ('aquaculture_harvest_validate', 'aquaculture_harvest_apply')").get()).toEqual({ n: 2 });
    expect(db.sqlite.prepare("SELECT owner_player_id, state FROM farm_constructions WHERE id = ?").get(CONSTRUCTION)).toEqual({ owner_player_id: PLAYER, state: "STORED" });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
