import { describe, expect, it } from "vitest";
import { SettleProductionAssignment, type Clock } from "@happy-farm/application";
import { CountingD1, type CostCounters } from "../support/cost-harness";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { D1FarmMemberRepository, D1FarmRepository, D1InventoryRepository, D1ProductionAssignmentRepository, D1ProductionSourceRepository, D1WarehouseRepository } from "../../workers/api/src/d1-repositories";
import { D1ProductionRateSettlementService } from "../../workers/api/src/d1-production-rate-settlement";

const PLAYER = "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FARM = "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = "production_source_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSIGNMENT = "production_assignment_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T0 = "2026-10-07T00:00:00.000Z";

class BenchmarkClock implements Clock {
  constructor(private current = T0) {}
  now(): string { return this.current; }
  advance(hours: number): void { this.current = new Date(Date.parse(T0) + hours * 3_600_000).toISOString(); }
}

interface Sample { readonly name: string; readonly output: number; readonly counters: CostCounters; readonly cursor: string; readonly remainder: number; readonly receipts: number; }

function seed(db: NodeD1Database, rate: number, kind: "RENEWABLE" | "FINITE", stock: number | null, capacity: number, filler = 0): void {
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'benchmark', ?, 'Benchmark', 'ACTIVE', ?, ?)").run(PLAYER, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Benchmark Farm', ?, ?)").run(FARM, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM, PLAYER, T0);
  db.sqlite.prepare("INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'Benchmark', 1, ?, ?, ?)").run(AREA, FARM, FARM, PLAYER, T0, T0);
  db.sqlite.prepare("INSERT INTO actors (id, owner_player_id, kind, zone_kind, zone_id, created_at, updated_at) VALUES (?, ?, 'MAIN_CHARACTER', 'HOME_ISLAND', ?, ?, ?)").run(ACTOR, PLAYER, FARM, T0, T0);
  db.sqlite.prepare("INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, execution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'FARM', 'crop_carrot', 1, 'RATE_PRODUCTION', ?, ?)").run(JOB, ACTOR, FARM, AREA, T0, T0);
  db.sqlite.prepare("INSERT INTO production_sources (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, created_at, updated_at) VALUES (?, ?, ?, 'item_carrot', ?, ?, ?, ?)").run(SOURCE, FARM, kind, rate, stock, T0, T0);
  db.sqlite.prepare("INSERT INTO production_assignments (id, farm_id, actor_id, actor_job_id, source_id, settlement_cursor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(ASSIGNMENT, FARM, ACTOR, JOB, SOURCE, T0, T0, T0);
  db.sqlite.prepare("UPDATE home_island_warehouses SET zone_id = ?, capacity = ? WHERE owner_player_id = ?").run(FARM, capacity, PLAYER);
  if (filler > 0) db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_filler', ?, ?, 1)").run(PLAYER, filler, T0);
}

async function runCase(hours: number, rate = 10, kind: "RENEWABLE" | "FINITE" = "RENEWABLE", stock: number | null = null, capacity = 100000, filler = 0): Promise<Sample> {
  const raw = new NodeD1Database(schemaSql());
  const db = new CountingD1(raw);
  const clock = new BenchmarkClock();
  seed(raw, rate, kind, stock, capacity, filler);
  clock.advance(hours);
  const useCase = new SettleProductionAssignment(
    new D1FarmRepository(db), new D1FarmMemberRepository(db), new D1ProductionAssignmentRepository(db),
    new D1ProductionSourceRepository(db), new D1InventoryRepository(db), new D1WarehouseRepository(db),
    new D1ProductionRateSettlementService(db), clock
  );
  const result = await useCase.execute({ playerId: PLAYER as never, farmId: FARM as never, assignmentId: ASSIGNMENT });
  const state = raw.sqlite.prepare("SELECT settlement_cursor, production_remainder FROM production_assignments WHERE id = ?").get(ASSIGNMENT) as { settlement_cursor: string; production_remainder: number };
  const receipts = raw.sqlite.prepare("SELECT COUNT(*) AS count FROM production_settlement_receipts").get() as { count: number };
  const sample = { name: `${String(hours)}h`, output: result.producedQuantity, counters: { ...db.counters }, cursor: state.settlement_cursor, remainder: state.production_remainder, receipts: receipts.count };
  raw.close();
  return sample;
}

describe("Production Rate bounded cost benchmark", () => {
  it("prints the complete copyable benchmark table without per-unit setup", async () => {
    const samples = [
      await runCase(1), await runCase(6), await runCase(24), await runCase(48),
      { ...(await runCase(24, 1000)), name: "large-output" },
      { ...(await runCase(24, 10, "FINITE", 37)), name: "finite" },
      { ...(await runCase(5, 10, "RENEWABLE", null, 1000, 968)), name: "warehouse-block" }
    ];
    const rows = samples.map(({ name, output, counters, cursor, remainder, receipts }) => ({
      case: name, output, batches: counters.batches, statements: counters.statements, reads: counters.reads,
      rowsRead: counters.readRows, writes: counters.writes, rowsWritten: counters.writeRows, receipts, cursor, remainder
    }));
    process.stdout.write(`PRODUCTION_RATE_BENCHMARK\n${JSON.stringify(rows)}\n`);
    expect(samples[0]?.counters.batches).toBe(1);
    expect(samples[0]?.counters.statements).toBeGreaterThan(0);
    expect(samples[0]?.output).toBe(10);
    expect(samples[2]?.output).toBe(240);
    expect(samples[3]?.output).toBe(240);
    expect(samples[4]?.output).toBe(24000);
    expect(samples[5]?.output).toBe(37);
    expect(samples[6]?.output).toBe(32);
  });
});
