import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator, ActorIdGenerator, JobIdGenerator, WorkAreaIdGenerator, ResourceIdGenerator } from "@happy-farm/application";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataConstructionDefinitions, GameDataCropDefinitions, GameDataCurrencyDefinitions, GameDataItemDefinitions, GameDataPlotDefinitions, GameDataResourceCatalogue, GameDataShopEntries, GameDataTreeDefinitions, Sha256Fingerprint, gameDataCargoCapacities, gameDataLandSale, gameDataProgressionDefinition, gameDataStarterWorld, gameDataTileTerrain, gameDataWorkAreaGround } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, PLAYER_ONE_ID } from "../support/fixtures";
import { parseActorId, parseConstructionId, parseCropInstanceId, parseEconomyTransactionId, parseJobId, parseResourceActionId, parseTreeInstanceId, parseWorkAreaId, type FarmId, type ActorId, type JobId, type WorkAreaId } from "@happy-farm/domain";

const T0 = "2026-10-08T00:00:00.000Z";

class TestClock implements Clock {
  value = T0;
  now(): string { return this.value; }
  advanceHours(hours: number): void { this.value = new Date(Date.parse(this.value) + hours * 3_600_000).toISOString(); }
  advanceSeconds(seconds: number): void { this.value = new Date(Date.parse(this.value) + seconds * 1_000).toISOString(); }
}

class Auth implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext> { return Promise.resolve({ playerId: PLAYER_ONE_ID }); }
}

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

describe("V16.2.3D2 Forestry and Mining Production Rate", () => {
  let db: NodeD1Database;
  let clock: TestClock;
  let farmId: string;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    db = new NodeD1Database(schemaSql());
    clock = new TestClock();
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'D2 Owner', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, PLAYER_ONE_ID, T0, T0);
    handle = createHandler({
      db,
      authenticator: new Auth(),
      ids: new Ids(),
      fingerprints: new Sha256Fingerprint(),
      clock,
      cropDefinitions: new GameDataCropDefinitions(),
      itemDefinitions: new GameDataItemDefinitions(),
      currencyDefinitions: new GameDataCurrencyDefinitions(),
      shopEntries: new GameDataShopEntries(),
      plotDefinitions: new GameDataPlotDefinitions(),
      treeDefinitions: new GameDataTreeDefinitions(),
      constructionDefinitions: new GameDataConstructionDefinitions(),
      progressionDefinition: gameDataProgressionDefinition,
      starterWorld: gameDataStarterWorld,
      terrain: gameDataTileTerrain,
      landSale: gameDataLandSale,
      workAreas: { ground: gameDataWorkAreaGround, ids: new Ids() },
      resources: { catalogue: new GameDataResourceCatalogue(), ids: new Ids(), random: { roll: () => 0.5 } },
      workers: { ids: new Ids() },
      cargoCapacities: gameDataCargoCapacities
    });
    await post("/farms", { name: "D2 Resource Farm" });
    farmId = (db.sqlite.prepare("SELECT id FROM farms WHERE owner_player_id = ?").get(PLAYER_ONE_ID) as { id: string }).id;
  });

  afterEach(() => { db.close(); });

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return handle(new Request(`https://api.test${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    }));
  }
  async function post(path: string, body: unknown): Promise<Response> { return request("POST", path, body); }
  async function json<T>(response: Response): Promise<T> { return response.json(); }
  function seedNode(nodeId: string): void {
    const zoneId = `zone_home_island_${farmId}`;
    db.sqlite.prepare("INSERT INTO resource_node_states (zone_kind, zone_id, node_id, available_at, depleted_at, version, created_at, updated_at) VALUES ('HOME_ISLAND', ?, ?, ?, ?, 1, ?, ?)").run(zoneId, nodeId, T0, T0, T0, T0);
  }
  async function createResourceJob(input: { readonly kind: "FORESTRY" | "MINING"; readonly target: string; readonly cell: { readonly x: number; readonly y: number }; readonly item: string; readonly nodeId: string }): Promise<string> {
    const area = await post(`/farms/${farmId}/work-areas`, { requestId: `${input.kind.toLowerCase()}_area_01`, kind: input.kind, name: `${input.kind} Area`, cells: [input.cell] });
    if (area.status !== 201) throw new Error(`work area ${String(area.status)} ${await area.text()}`);
    const areaBody = await json<{ data: { workArea: { workAreaId: string } } }>(area);
    seedNode(input.nodeId);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, 10, 1, ?)").run(PLAYER_ONE_ID, input.item, T0);
    const jobResponse = await post(`/farms/${farmId}/jobs`, { requestId: `${input.kind.toLowerCase()}_job_01`, workAreaId: areaBody.data.workArea.workAreaId, kind: input.kind, targetDefinitionId: input.target });
    expect(jobResponse.status).toBe(201);
    const job = await json<{ data: { job: { jobId: string } } }>(jobResponse);
    return job.data.job.jobId;
  }

  it("cuts Forestry over through HTTP/D1 and depletes the same CHOP node", async () => {
    const jobId = await createResourceJob({ kind: "FORESTRY", target: "resource_wildwood", cell: { x: 36, y: -18 }, item: "item_wood", nodeId: "node_wildwood_north_1" });
    const binding = db.sqlite.prepare("SELECT p.settlement_cursor, s.rate_per_hour, s.output_item_definition_id FROM production_assignments p JOIN production_sources s ON s.id = p.source_id WHERE p.actor_job_id = ?").get(jobId) as { settlement_cursor: string; rate_per_hour: number; output_item_definition_id: string };
    expect(binding).toEqual({ settlement_cursor: T0, rate_per_hour: 1, output_item_definition_id: "item_wood" });
    clock.advanceHours(5);
    const first = await post(`/farms/${farmId}/production/reconcile`, { requestId: "forestry_reconcile_01" });
    expect(first.status).toBe(200);
    const body = await json<{ data: { producedItems: { itemDefinitionId: string; quantity: number }[] } }>(first);
    expect(body.data.producedItems).toEqual([{ itemDefinitionId: "item_wood", quantity: 5 }]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_wood'").get(PLAYER_ONE_ID)).toEqual({ quantity: 15 });
    expect(db.sqlite.prepare("SELECT depleted_at, version FROM resource_node_states WHERE node_id = 'node_wildwood_north_1'").get()).toEqual({ depleted_at: "2026-10-08T05:00:00.000Z", version: 2 });
    const retry = await post(`/farms/${farmId}/production/reconcile`, { requestId: "forestry_reconcile_02" });
    expect((await json<{ data: { producedItems: unknown[] } }>(retry)).data.producedItems).toEqual([]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_wood'").get(PLAYER_ONE_ID)).toEqual({ quantity: 15 });
  });

  it("binds unified Mining to the actor labor path instead of warehouse rate settlement", async () => {
    const jobId = await createResourceJob({ kind: "MINING", target: "resource_ore", cell: { x: 12, y: -12 }, item: "item_ore", nodeId: "node_stone_ridge" });
    const binding = db.sqlite.prepare("SELECT p.settlement_cursor, s.rate_per_hour, s.output_item_definition_id FROM production_assignments p JOIN production_sources s ON s.id = p.source_id WHERE p.actor_job_id = ?").get(jobId) as { settlement_cursor: string; rate_per_hour: number; output_item_definition_id: string };
    expect(binding).toEqual({ settlement_cursor: T0, rate_per_hour: 1_200, output_item_definition_id: "item_ore" });
    clock.advanceHours(3);
    const first = await post(`/farms/${farmId}/production/reconcile`, { requestId: "mining_reconcile_01" });
    expect(first.status).toBe(200);
    expect((await json<{ data: { producedItems: { itemDefinitionId: string; quantity: number }[] } }>(first)).data.producedItems).toEqual([]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_ore'").get(PLAYER_ONE_ID)).toEqual({ quantity: 10 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count, MAX(version) AS version FROM resource_node_states WHERE node_id = 'node_stone_ridge'").get()).toEqual({ count: 1, version: 1 });
    const retry = await post(`/farms/${farmId}/production/reconcile`, { requestId: "mining_reconcile_02" });
    expect((await json<{ data: { producedItems: unknown[] } }>(retry)).data.producedItems).toEqual([]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_ore'").get(PLAYER_ONE_ID)).toEqual({ quantity: 10 });
  });

  it("lets manual CHOP reduce the same authoritative stock before binding", async () => {
    seedNode("node_wildwood_north_1");
    const start = await post("/resource-actions/start", { nodeId: "node_wildwood_north_1", requestId: "manual_chop_start_01" });
    expect(start.status).toBe(201);
    const action = await json<{ data: { action: { actionId: string; version: number } } }>(start);
    clock.advanceSeconds(5);
    const settled = await post(`/resource-actions/${action.data.action.actionId}/settle`, { requestId: "manual_chop_settle_01", expectedActionVersion: action.data.action.version });
    expect(settled.status).toBe(200);
    const area = await post(`/farms/${farmId}/work-areas`, { requestId: "manual_area_01", kind: "FORESTRY", name: "Manual Area", cells: [{ x: 36, y: -18 }] });
    const areaBody = await json<{ data: { workArea: { workAreaId: string } } }>(area);
    const job = await post(`/farms/${farmId}/jobs`, { requestId: "manual_job_01", workAreaId: areaBody.data.workArea.workAreaId, kind: "FORESTRY", targetDefinitionId: "resource_wildwood" });
    expect(job.status).toBe(201);
    const assignment = db.sqlite.prepare("SELECT s.rate_per_hour FROM production_assignments p JOIN production_sources s ON s.id = p.source_id").get() as { rate_per_hour: number };
    expect(assignment).toEqual({ rate_per_hour: 0 });
    const reconcile = await post(`/farms/${farmId}/production/reconcile`, { requestId: "manual_reconcile_01" });
    expect((await json<{ data: { producedItems: unknown[] } }>(reconcile)).data.producedItems).toEqual([]);
  });
});
