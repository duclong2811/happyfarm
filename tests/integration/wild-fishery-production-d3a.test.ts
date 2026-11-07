import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, FishingIdGenerator, IdGenerator, ActorIdGenerator, JobIdGenerator, WorkAreaIdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator } from "@happy-farm/application";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataConstructionDefinitions, GameDataCropDefinitions, GameDataCurrencyDefinitions, GameDataFishingCatalogue, GameDataItemDefinitions, GameDataPlotDefinitions, GameDataShopEntries, GameDataTreeDefinitions, Sha256Fingerprint, gameDataCargoCapacities, gameDataLandSale, gameDataProgressionDefinition, gameDataStarterWorld, gameDataTileTerrain, gameDataWorkAreaGround } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, PLAYER_ONE_ID } from "../support/fixtures";
import { parseActorId, parseConstructionId, parseCropInstanceId, parseEconomyTransactionId, parseFishingActionId, parseJobId, parseTreeInstanceId, parseWorkAreaId, type ActorId, type ConstructionId, type CropInstanceId, type EconomyTransactionId, type FarmId, type FishingActionId, type JobId, type TreeInstanceId, type WorkAreaId } from "@happy-farm/domain";

const T0 = "2026-10-08T00:00:00.000Z";
const POND_CELL = { x: -3, y: 42 };

class TestClock implements Clock {
  value = T0;
  now(): string { return this.value; }
  advanceHours(hours: number): void { this.value = new Date(Date.parse(this.value) + hours * 3_600_000).toISOString(); }
  advanceSeconds(seconds: number): void { this.value = new Date(Date.parse(this.value) + seconds * 1_000).toISOString(); }
}

class Auth implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext> { return Promise.resolve({ playerId: PLAYER_ONE_ID }); }
}

class Ids implements IdGenerator, ActorIdGenerator, JobIdGenerator, WorkAreaIdGenerator, FishingIdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator {
  newFarmId(): FarmId { return FARM_ONE_ID; }
  newActorId(): ActorId { return parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); }
  newJobId(): JobId { return parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); }
  newWorkAreaId(): WorkAreaId { return parseWorkAreaId("workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc"); }
  newFishingActionId(): FishingActionId { return parseFishingActionId("fishact_dddddddd-dddd-4ddd-8ddd-dddddddddddd"); }
  newCropInstanceId(): CropInstanceId { return parseCropInstanceId("cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"); }
  newTreeInstanceId(): TreeInstanceId { return parseTreeInstanceId("treeinst_ffffffff-ffff-4fff-8fff-ffffffffffff"); }
  newConstructionId(): ConstructionId { return parseConstructionId("construct_11111111-1111-4111-8111-111111111111"); }
  newEconomyTransactionId(): EconomyTransactionId { return parseEconomyTransactionId("econ_22222222-2222-4222-8222-222222222222"); }
}

describe("V16.2.3D3A wild fishery Production Rate", () => {
  let db: NodeD1Database;
  let clock: TestClock;
  let farmId: string;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    db = new NodeD1Database(schemaSql());
    clock = new TestClock();
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Fishery Owner', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, PLAYER_ONE_ID, T0, T0);
    handle = createHandler({
      db, authenticator: new Auth(), ids: new Ids(), fingerprints: new Sha256Fingerprint(), clock,
      cropDefinitions: new GameDataCropDefinitions(), itemDefinitions: new GameDataItemDefinitions(),
      currencyDefinitions: new GameDataCurrencyDefinitions(), shopEntries: new GameDataShopEntries(),
      plotDefinitions: new GameDataPlotDefinitions(), treeDefinitions: new GameDataTreeDefinitions(),
      constructionDefinitions: new GameDataConstructionDefinitions(), progressionDefinition: gameDataProgressionDefinition,
      starterWorld: gameDataStarterWorld, terrain: gameDataTileTerrain, landSale: gameDataLandSale,
      workAreas: { ground: gameDataWorkAreaGround, ids: new Ids() },
      fishing: { catalogue: new GameDataFishingCatalogue(), ids: new Ids(), random: { roll: () => 0.1 } },
      workers: { ids: new Ids() }, cargoCapacities: gameDataCargoCapacities
    });
    const farm = await post("/farms", { name: "Wild Fishery Farm" });
    expect(farm.status).toBe(201);
    farmId = (db.sqlite.prepare("SELECT id FROM farms WHERE owner_player_id = ?").get(PLAYER_ONE_ID) as { id: string }).id;
  });

  afterEach(() => { db.close(); });

  async function post(path: string, body: unknown): Promise<Response> {
    return handle(new Request(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
  }
  async function json<T>(response: Response): Promise<T> { return response.json(); }

  it("binds only after a real FISHERY area/job and settles stock through HTTP/D1", async () => {
    const manualStart = await post("/fishing/start", { spotId: "spot_pond_north", requestId: "manual_fish_start_01" });
    expect(manualStart.status).toBe(201);
    const action = await json<{ data: { action: { actionId: string; version: number } } }>(manualStart);
    clock.advanceSeconds(15);
    const manualSettle = await post(`/fishing/${action.data.action.actionId}/settle`, { requestId: "manual_fish_settle_01", expectedActionVersion: action.data.action.version });
    expect(manualSettle.status).toBe(200);
    expect(db.sqlite.prepare("SELECT stock, version FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ?").get(`zone_home_island_${farmId}`, "spot_pond_north")).toMatchObject({ stock: 4, version: 1 });

    const areaResponse = await post(`/farms/${farmId}/work-areas`, { requestId: "fishery_area_01", kind: "FISHERY", name: "Pond Fishery", cells: [POND_CELL] });
    expect(areaResponse.status).toBe(201);
    const area = await json<{ data: { workArea: { workAreaId: string } } }>(areaResponse);
    const jobResponse = await post(`/farms/${farmId}/jobs`, { requestId: "fishery_job_01", workAreaId: area.data.workArea.workAreaId, kind: "FISHERY", targetDefinitionId: "spot_pond_north" });
    expect(jobResponse.status).toBe(201);
    const job = await json<{ data: { job: { jobId: string; executionMode?: string } } }>(jobResponse);
    expect(job.data.job.executionMode).toBeUndefined();

    const binding = db.sqlite.prepare("SELECT p.settlement_cursor, s.kind, s.rate_per_hour, s.remaining_stock, s.output_item_definition_id FROM production_assignments p JOIN production_sources s ON s.id = p.source_id WHERE p.actor_job_id = ?").get(job.data.job.jobId);
    expect(binding).toMatchObject({ settlement_cursor: "2026-10-08T00:00:15.000Z", kind: "FINITE", rate_per_hour: 1, remaining_stock: 4, output_item_definition_id: "item_fish_tilapia" });

    clock.advanceHours(5);
    const reconcile = await post(`/farms/${farmId}/production/reconcile`, { requestId: "fishery_reconcile_01" });
    expect(reconcile.status).toBe(200);
    const result = await json<{ data: { producedItems: { itemDefinitionId: string; quantity: number }[] } }>(reconcile);
    expect(result.data.producedItems).toEqual([{ itemDefinitionId: "item_fish_tilapia", quantity: 5 }]);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 6 });
    expect(db.sqlite.prepare("SELECT stock, version FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ?").get(`zone_home_island_${farmId}`, "spot_pond_north")).toMatchObject({ stock: 0, version: 2 });

    const retry = await post(`/farms/${farmId}/production/reconcile`, { requestId: "fishery_reconcile_02" });
    expect((await json<{ data: { producedItems: unknown[] } }>(retry)).data.producedItems).toEqual([]);
  });

  it("refuses land work areas and keeps aquaculture out of the wild-fishery target path", async () => {
    const land = await post(`/farms/${farmId}/work-areas`, { requestId: "fishery_land_01", kind: "FISHERY", name: "Invalid Fishery", cells: [{ x: 0, y: 0 }] });
    expect(land.status).toBe(400);
    const water = await post(`/farms/${farmId}/work-areas`, { requestId: "aqua_water_01", kind: "AQUACULTURE", name: "Future Aqua", cells: [POND_CELL] });
    expect(water.status).toBe(400);
    const outside = await post(`/farms/${farmId}/work-areas`, { requestId: "fishery_outside_01", kind: "FISHERY", name: "Other Pond Cell", cells: [{ x: -3, y: 43 }] });
    expect(outside.status).toBe(201);
    const outsideArea = await json<{ data: { workArea: { workAreaId: string } } }>(outside);
    const excludedTarget = await post(`/farms/${farmId}/jobs`, { requestId: "fishery_resource_target_01", workAreaId: outsideArea.data.workArea.workAreaId, kind: "FISHERY", targetDefinitionId: "resource_stone" });
    expect(excludedTarget.status).toBe(400);
    const excludedSpot = await post(`/farms/${farmId}/jobs`, { requestId: "fishery_outside_job_01", workAreaId: outsideArea.data.workArea.workAreaId, kind: "FISHERY", targetDefinitionId: "spot_pond_north" });
    expect(excludedSpot.status).toBe(201);
    const job = await json<{ data: { job: { jobId: string } } }>(excludedSpot);
    expect(db.sqlite.prepare("SELECT rate_per_hour, remaining_stock FROM production_sources WHERE id = ?").get(`production_source_fishery_${job.data.job.jobId}`)).toEqual({ rate_per_hour: 0, remaining_stock: 0 });
  });
});
