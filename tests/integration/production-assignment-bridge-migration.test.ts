import { afterEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";

const NOW = "2026-10-07T00:00:00.000Z";
const PLAYER = "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FARM = "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = "production_source_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function seed(db: NodeD1Database, executionMode = "LEGACY_ACTION_AUTO"): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Owner', 'ACTIVE', ?, ?)").run(PLAYER, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', 'zone', 'FARM', 'Field', 1, ?, ?, ?)").run(AREA, FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, zone_kind, zone_id, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'HOME_ISLAND', 'zone', ?, ?)").run(ACTOR, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, execution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 1, ?, ?, ?)").run(JOB, ACTOR, FARM, AREA, executionMode, NOW, NOW);
  db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, created_at, updated_at) VALUES (?, ?, 'RENEWABLE', 'item_carrot', 60, ?, ?)").run(SOURCE, FARM, NOW, NOW);
}

function insertAssignment(db: NodeD1Database, id = "production_assignment_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", jobId = JOB): void {
  db.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, settlement_cursor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, FARM, ACTOR, jobId, SOURCE, NOW, NOW, NOW);
}

describe("production assignment / work assignment bridge", () => {
  let db: NodeD1Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it("accepts explicit legacy and rate jobs through the bridge", () => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    insertAssignment(db);
    expect(db.sqlite.prepare("SELECT actor_job_id FROM production_assignments").get()).toEqual({ actor_job_id: JOB });
    expect(db.sqlite.prepare("SELECT execution_mode FROM actor_jobs WHERE id = ?").get(JOB)).toEqual({ execution_mode: "LEGACY_ACTION_AUTO" });
  });

  it("accepts a RATE_PRODUCTION job without duplicating its mode", () => {
    db = new NodeD1Database(schemaSql());
    seed(db, "RATE_PRODUCTION");
    insertAssignment(db);
    expect(db.sqlite.prepare("SELECT execution_mode FROM actor_jobs WHERE id = ?").get(JOB)).toEqual({ execution_mode: "RATE_PRODUCTION" });
    expect(db.sqlite.prepare("PRAGMA table_info(production_assignments)").all()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "execution_mode" })]));
  });

  it("enforces the actor_job foreign key and one-to-zero-or-one cardinality", () => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    expect(() => { db?.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, settlement_cursor, created_at, updated_at) VALUES (?, ?, ?, 'job_missing', ?, ?, ?, ?)").run("production_assignment_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", FARM, ACTOR, SOURCE, NOW, NOW, NOW); }).toThrow();
    insertAssignment(db);
    expect(() => { insertAssignment(db as NodeD1Database, "production_assignment_cccccccc-cccc-4ccc-8ccc-cccccccccccc"); }).toThrow();
  });

  it("preserves an assignment when its job deletion is attempted", () => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    insertAssignment(db);
    expect(() => { db?.sqlite.prepare("DELETE FROM actor_jobs WHERE id = ?").run(JOB); }).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_assignments").get()).toEqual({ n: 1 });
  });

  it("keeps the source foreign key intact", () => {
    db = new NodeD1Database(schemaSql());
    seed(db);
    expect(() => db?.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, settlement_cursor, created_at, updated_at) VALUES (?, ?, ?, ?, 'production_source_missing', ?, ?, ?)").run("production_assignment_dddddddd-dddd-4ddd-8ddd-dddddddddddd", FARM, ACTOR, JOB, NOW, NOW, NOW)).toThrow();
  });
});
