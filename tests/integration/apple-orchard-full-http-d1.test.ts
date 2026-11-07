import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator, ActorIdGenerator, JobIdGenerator, WorkAreaIdGenerator, ResourceIdGenerator } from "@happy-farm/application";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataConstructionDefinitions, GameDataCropDefinitions, GameDataCurrencyDefinitions, GameDataItemDefinitions, GameDataPlotDefinitions, GameDataResourceCatalogue, GameDataShopEntries, GameDataTreeDefinitions, Sha256Fingerprint, gameDataCargoCapacities, gameDataLandSale, gameDataProgressionDefinition, gameDataStarterWorld, gameDataTileTerrain, gameDataWorkAreaGround } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, PLAYER_ONE_ID } from "../support/fixtures";
import { parseActorId, parseConstructionId, parseCropInstanceId, parseEconomyTransactionId, parseJobId, parseResourceActionId, parseTreeInstanceId, parseWorkAreaId, type FarmId, type ActorId, type JobId, type WorkAreaId } from "@happy-farm/domain";

const T0 = "2026-10-08T00:00:00.000Z";
class TestClock implements Clock { value = T0; now(): string { return this.value; } advanceHours(hours: number): void { this.value = new Date(Date.parse(this.value) + hours * 3600000).toISOString(); } }
class Auth implements AuthenticationPort<Request> { authenticate(): Promise<ActorContext> { return Promise.resolve({ playerId: PLAYER_ONE_ID }); } }
class Ids implements IdGenerator, ActorIdGenerator, JobIdGenerator, WorkAreaIdGenerator, ResourceIdGenerator {
  newFarmId(): FarmId { return FARM_ONE_ID; }
  newActorId(): ActorId { return parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); }
  newJobId(): JobId { return parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); }
  newWorkAreaId(): WorkAreaId { return parseWorkAreaId("workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc"); }
  newCropInstanceId() { return parseCropInstanceId("cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd"); }
  newTreeInstanceId() { return parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"); }
  newConstructionId() { return parseConstructionId("construct_ffffffff-ffff-4fff-8fff-ffffffffffff"); }
  newEconomyTransactionId() { return parseEconomyTransactionId("econ_11111111-1111-4111-8111-111111111111"); }
  newResourceActionId() { return parseResourceActionId("resact_22222222-2222-4222-8222-222222222222"); }
}

describe("full HTTP/D1 Apple Orchard offline acceptance", () => {
  let db: NodeD1Database; let clock: TestClock; let farmId: string; let handle: (request: Request) => Promise<Response>;
  beforeEach(async () => {
    db = new NodeD1Database(schemaSql()); clock = new TestClock();
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Offline Owner', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, PLAYER_ONE_ID, T0, T0);
    handle = createHandler({ db, authenticator: new Auth(), ids: new Ids(), fingerprints: new Sha256Fingerprint(), clock,
      cropDefinitions: new GameDataCropDefinitions(), itemDefinitions: new GameDataItemDefinitions(), currencyDefinitions: new GameDataCurrencyDefinitions(), shopEntries: new GameDataShopEntries(), plotDefinitions: new GameDataPlotDefinitions(), treeDefinitions: new GameDataTreeDefinitions(), constructionDefinitions: new GameDataConstructionDefinitions(), progressionDefinition: gameDataProgressionDefinition, starterWorld: gameDataStarterWorld, terrain: gameDataTileTerrain, landSale: gameDataLandSale, workAreas: { ground: gameDataWorkAreaGround, ids: new Ids() }, resources: { catalogue: new GameDataResourceCatalogue(), ids: new Ids(), random: { roll: () => 0.5 } }, workers: { ids: new Ids() }, cargoCapacities: gameDataCargoCapacities });
    await post("/farms", { name: "Offline Acceptance Farm" });
    farmId = (db.sqlite.prepare("SELECT id FROM farms WHERE owner_player_id = ?").get(PLAYER_ONE_ID) as { id: string }).id;
  });
  afterEach(() => { db.close(); });
  async function request(method: string, path: string, body?: unknown): Promise<Response> { return handle(new Request(`https://api.test${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) })); }
  async function post(path: string, body: unknown): Promise<Response> { return request("POST", path, body); }
  async function json<T>(response: Response): Promise<T> { return response.json(); }

  it("creates binding at T0, credits 10 → 35 through HTTP, and retries without duplication", async () => {
    const area = await post(`/farms/${farmId}/work-areas`, { requestId: "area_offline_01", kind: "ORCHARD", name: "Apple Orchard", cells: [{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 22, y: 20 }, { x: 23, y: 20 }, { x: 24, y: 20 }] });
    if (area.status !== 201) throw new Error(`work area ${String(area.status)} ${await area.text()}`);
    const areaBody = await json<{ data: { workArea: { workAreaId: string } } }>(area);
    const areaId = areaBody.data.workArea.workAreaId;
    for (let i = 0; i < 5; i += 1) {
      const x = 20 + i;
      db.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, 20, 'SOIL', 'IDLE', 1, ?)").run(farmId, x, T0);
      db.sqlite.prepare("INSERT INTO tree_instances (id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at) VALUES (?, ?, ?, 20, 'tree_apple', ?, ?, NULL, 1, ?, ?)").run(`treeinst_${String(i + 1).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, farmId, x, PLAYER_ONE_ID, "2026-10-07T00:00:00.000Z", T0, T0);
    }
    await request("GET", `/farms/${farmId}/workers`);
    const jobResponse = await post(`/farms/${farmId}/jobs`, { requestId: "job_offline_01", workAreaId: areaId, kind: "ORCHARD", targetDefinitionId: "tree_apple" });
    expect(jobResponse.status).toBe(201);
    const job = await json<{ data: { job: { jobId: string } } }>(jobResponse);
    const binding = db.sqlite.prepare("SELECT p.settlement_cursor, s.rate_per_hour FROM production_assignments p JOIN production_sources s ON s.id = p.source_id WHERE p.actor_job_id = ?").get(job.data.job.jobId) as { settlement_cursor: string; rate_per_hour: number };
    expect(binding).toEqual({ settlement_cursor: T0, rate_per_hour: 5 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_assignments").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM production_sources").get()).toEqual({ n: 1 });
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_apple', 10, 1, ?)").run(PLAYER_ONE_ID, T0);
    clock.advanceHours(5);
    const first = await post(`/farms/${farmId}/production/reconcile`, { requestId: "reconcile_offline_01" });
    expect(first.status).toBe(200);
    const firstBody = await json<{ data: { producedItems: { itemDefinitionId: string; quantity: number }[] } }>(first);
    expect(firstBody.data.producedItems).toEqual([{ itemDefinitionId: "item_apple", quantity: 25 }]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_apple'").get(PLAYER_ONE_ID)).toEqual({ quantity: 35 });
    const retry = await post(`/farms/${farmId}/production/reconcile`, { requestId: "reconcile_offline_02" });
    const retryBody = await json<{ data: { producedItems: unknown[] } }>(retry);
    expect(retryBody.data.producedItems).toEqual([]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_apple'").get(PLAYER_ONE_ID)).toEqual({ quantity: 35 });
  });
});
