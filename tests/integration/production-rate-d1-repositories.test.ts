import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { D1ProductionAssignmentRepository, D1ProductionSourceRepository } from "../../workers/api/src/d1-repositories";

const NOW = "2026-10-07T00:00:00.000Z";
const PLAYER = "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PLAYER = "player_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FARM = "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_FARM = "farm_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = "production_source_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSIGNMENT = "production_assignment_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function seed(db: NodeD1Database, mode = "RATE_PRODUCTION"): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Owner', 'ACTIVE', ?, ?)").run(PLAYER, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Other Owner', 'ACTIVE', ?, ?)").run(OTHER_PLAYER, OTHER_PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(OTHER_FARM, OTHER_PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', 'zone', 'FARM', 'Field', 1, ?, ?, ?)").run(AREA, FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, zone_kind, zone_id, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'HOME_ISLAND', 'zone', ?, ?)").run(ACTOR, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, execution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 1, ?, ?, ?)").run(JOB, ACTOR, FARM, AREA, mode, NOW, NOW);
  db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, created_at, updated_at) VALUES (?, ?, 'RENEWABLE', 'item_carrot', 60, NULL, ?, ?)").run(SOURCE, FARM, NOW, NOW);
  db.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 123456789, 'WAREHOUSE_FULL', 7, ?, ?)").run(ASSIGNMENT, FARM, ACTOR, JOB, SOURCE, NOW, NOW, NOW);
}

describe("production rate D1 read adapters", () => {
  let db: NodeD1Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it("joins the assignment to the authoritative RATE_PRODUCTION job and preserves state", async () => {
    db = new NodeD1Database(schemaSql()); seed(db);
    const row = await new D1ProductionAssignmentRepository(db).findByFarmAndId(FARM as never, ASSIGNMENT);
    expect(row).toMatchObject({ farmId: FARM, actorId: ACTOR, sourceId: SOURCE, settlementCursor: NOW, productionRemainder: 123456789, blockedReason: "WAREHOUSE_FULL", version: 7, executionMode: "RATE_PRODUCTION" });
    expect(row?.enabled).toBe(true);
  });

  it("faithfully loads LEGACY_ACTION_AUTO and does not infer rate mode", async () => {
    db = new NodeD1Database(schemaSql()); seed(db, "LEGACY_ACTION_AUTO");
    const row = await new D1ProductionAssignmentRepository(db).findByFarmAndId(FARM as never, ASSIGNMENT);
    expect(row?.executionMode).toBe("LEGACY_ACTION_AUTO");
  });

  it("rejects a linked job from another farm and returns missing rows safely", async () => {
    db = new NodeD1Database(schemaSql()); seed(db);
    db.sqlite.prepare("UPDATE actor_jobs SET farm_id = ? WHERE id = ?").run(OTHER_FARM, JOB);
    const assignments = new D1ProductionAssignmentRepository(db);
    expect(await assignments.findByFarmAndId(FARM as never, ASSIGNMENT)).toBeNull();
    expect(await assignments.findByFarmAndId(FARM as never, "production_assignment_missing")).toBeNull();
  });

  it("maps renewable, finite, and depleted sources without changing stock semantics", async () => {
    db = new NodeD1Database(schemaSql()); seed(db);
    const sources = new D1ProductionSourceRepository(db);
    expect(await sources.findByFarmAndId(FARM as never, SOURCE)).toMatchObject({ kind: "RENEWABLE", remainingStock: null, version: 1 });
    db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, version, created_at, updated_at) VALUES ('production_source_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ?, 'FINITE', 'item_carrot', 60, 4, 9, ?, ?)").run(FARM, NOW, NOW);
    db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, version, created_at, updated_at) VALUES ('production_source_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 'FINITE', 'item_carrot', 60, 0, 10, ?, ?)").run(FARM, NOW, NOW);
    expect(await sources.findByFarmAndId(FARM as never, "production_source_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toMatchObject({ kind: "FINITE", remainingStock: 4, version: 9 });
    expect(await sources.findByFarmAndId(FARM as never, "production_source_cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toMatchObject({ kind: "FINITE", remainingStock: 0, version: 10 });
    expect(await sources.findByFarmAndId(FARM as never, "production_source_missing")).toBeNull();
  });
});
