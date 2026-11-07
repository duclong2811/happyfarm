import { afterEach, describe, expect, it } from "vitest";
import { D1OrchardProductionBindingRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { parseActorId, parseFarmId, parseJobId, parseWorkAreaId } from "@happy-farm/domain";

const NOW = "2026-10-07T00:00:00.000Z";
const PLAYER = "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FARM = "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function seed(db: NodeD1Database): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Owner', 'ACTIVE', ?, ?)").run(PLAYER, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', 'zone', 'ORCHARD', 'Orchard', 1, ?, ?, ?)").run(AREA, FARM, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, zone_kind, zone_id, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'HOME_ISLAND', 'zone', ?, ?)").run(ACTOR, PLAYER, NOW, NOW);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, execution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'ORCHARD', 'tree_apple', 1, 'RATE_PRODUCTION', ?, ?)").run(JOB, ACTOR, FARM, AREA, NOW, NOW);
}

describe("Apple Orchard persisted production binding", () => {
  let db: NodeD1Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it("creates one renewable Apple source and assignment with an activation cursor", async () => {
    db = new NodeD1Database(schemaSql()); seed(db);
    const result = await new D1OrchardProductionBindingRepository(db).ensureAtomically({
      assignmentId: "production_assignment_job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceId: "production_source_orchard_job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      farmId: parseFarmId(FARM), actorId: parseActorId(ACTOR), actorJobId: parseJobId(JOB), workAreaId: parseWorkAreaId(AREA), ratePerHour: 0, activatedAt: NOW
    });
    expect(result).toMatchObject({ farmId: parseFarmId(FARM), actorJobId: parseJobId(JOB), ratePerHour: 0, settlementCursor: NOW, version: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_sources").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT kind, output_item_definition_id FROM production_sources").get()).toEqual({ kind: "RENEWABLE", output_item_definition_id: "item_apple" });
  });

  it("is retry-safe and preserves persisted settlement state", async () => {
    db = new NodeD1Database(schemaSql()); seed(db);
    const repository = new D1OrchardProductionBindingRepository(db);
    const input = { assignmentId: "production_assignment_job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceId: "production_source_orchard_job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", farmId: parseFarmId(FARM), actorId: parseActorId(ACTOR), actorJobId: parseJobId(JOB), workAreaId: parseWorkAreaId(AREA), ratePerHour: 1, activatedAt: NOW };
    await repository.ensureAtomically(input);
    db.sqlite.prepare("UPDATE production_assignments SET settlement_cursor = ?, production_remainder = 7, version = 4 WHERE actor_job_id = ?").run("2026-10-07T01:00:00.000Z", JOB);
    const result = await repository.ensureAtomically({ ...input, ratePerHour: 99, activatedAt: "2026-10-07T02:00:00.000Z" });
    expect(result).toMatchObject({ ratePerHour: 1, settlementCursor: "2026-10-07T01:00:00.000Z", version: 4 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_assignments").get()).toEqual({ n: 1 });
  });
});
