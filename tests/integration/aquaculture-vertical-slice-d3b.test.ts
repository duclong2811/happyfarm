import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActorContext,
  AuthenticationPort,
  Clock,
  ConstructionIdGenerator,
  CropIdGenerator,
  EconomyTransactionIdGenerator,
  IdGenerator,
  TreeIdGenerator,
  WorkAreaIdGenerator
} from "@happy-farm/application";
import { createHandler } from "../../workers/api/src/handler";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataWorkAreaGround
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { FARM_ONE_ID, FARM_TWO_ID, PLAYER_ONE_ID } from "../support/fixtures";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  parseWorkAreaId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type TreeInstanceId,
  type WorkAreaId
} from "@happy-farm/domain";

const T0 = "2026-10-08T00:00:00.000Z";

class TestClock implements Clock {
  value = T0;
  now(): string { return this.value; }
  advanceSeconds(seconds: number): void { this.value = new Date(Date.parse(this.value) + seconds * 1_000).toISOString(); }
}

class Auth implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext> { return Promise.resolve({ playerId: PLAYER_ONE_ID }); }
}

class Ids implements IdGenerator, WorkAreaIdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator {
  private economyTransactionSequence = 0;
  newFarmId(): FarmId { return FARM_ONE_ID; }
  newWorkAreaId(): WorkAreaId { return parseWorkAreaId("workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc"); }
  newCropInstanceId(): CropInstanceId { return parseCropInstanceId("cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"); }
  newTreeInstanceId(): TreeInstanceId { return parseTreeInstanceId("treeinst_ffffffff-ffff-4fff-8fff-ffffffffffff"); }
  newConstructionId(): ConstructionId { return parseConstructionId("construct_11111111-1111-4111-8111-111111111111"); }
  newEconomyTransactionId(): EconomyTransactionId {
    this.economyTransactionSequence += 1;
    const suffix = this.economyTransactionSequence.toString(16).padStart(12, "0");
    return parseEconomyTransactionId(`econ_00000000-0000-4000-8000-${suffix}`);
  }
}

describe("V16.2.3D3B aquaculture manual vertical slice", () => {
  let db: NodeD1Database;
  let clock: TestClock;
  let handle: (request: Request) => Promise<Response>;
  let aquaCell: { readonly x: number; readonly y: number } = { x: 0, y: 0 };
  let foundAquaCell = false;
  let secondAquaCell: { readonly x: number; readonly y: number } | null = null;

  beforeEach(async () => {
    db = new NodeD1Database(schemaSql());
    clock = new TestClock();
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Aqua Owner', 'ACTIVE', ?, ?)").run(PLAYER_ONE_ID, PLAYER_ONE_ID, T0, T0);
    for (let y = -34; y <= 70 && secondAquaCell === null; y += 1) {
      for (let x = -34; x <= 70; x += 1) {
        const classification = gameDataTileTerrain.classify({ x, y });
        if (classification.terrain === "WATER" && classification.shallowWater && !classification.protectedGround) {
          if (!foundAquaCell) {
            aquaCell = { x, y };
            foundAquaCell = true;
          } else {
            secondAquaCell = { x, y };
            break;
          }
        }
      }
    }
    expect(foundAquaCell).toBe(true);
    expect(secondAquaCell).not.toBeNull();
    handle = createHandler({
      db, authenticator: new Auth(), ids: new Ids(), fingerprints: new Sha256Fingerprint(), clock,
      cropDefinitions: new GameDataCropDefinitions(), itemDefinitions: new GameDataItemDefinitions(),
      currencyDefinitions: new GameDataCurrencyDefinitions(), shopEntries: new GameDataShopEntries(),
      plotDefinitions: new GameDataPlotDefinitions(), treeDefinitions: new GameDataTreeDefinitions(),
      constructionDefinitions: new GameDataConstructionDefinitions(), progressionDefinition: gameDataProgressionDefinition,
      starterWorld: gameDataStarterWorld, terrain: gameDataTileTerrain, landSale: gameDataLandSale,
      workAreas: { ground: gameDataWorkAreaGround, ids: new Ids() }
    });
    const farm = await post("/farms", { name: "Aquaculture Farm" });
    expect(farm.status).toBe(201);
    db.sqlite.prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 5, 1200, 1, ?, ?)").run(PLAYER_ONE_ID, T0, T0);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?)").run(PLAYER_ONE_ID, T0, T0);
  });

  afterEach(() => { db.close(); foundAquaCell = false; secondAquaCell = null; });

  async function post(path: string, body: unknown): Promise<Response> {
    return handle(new Request(`https://api.test${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" }
    }));
  }
  async function get(path: string): Promise<Response> {
    return handle(new Request(`https://api.test${path}`, { method: "GET" }));
  }
  async function json<T>(response: Response): Promise<T> { return response.json(); }

  it("stocks, grows offline, harvests once, and preserves state on warehouse failure", async () => {
    const purchased = await post("/shop/buy", {
      requestId: "aqua_buy_01", shopEntryId: "shop_fish_tilapia", quantity: 1
    });
    expect(purchased.status, await purchased.clone().text()).toBe(200);
    expect(await purchased.json()).toMatchObject({ data: { settlement: {
      itemDefinitionId: "item_fish_tilapia", quantity: 1, amountSpent: 3
    } } });
    const purchaseReplay = await post("/shop/buy", {
      requestId: "aqua_buy_01", shopEntryId: "shop_fish_tilapia", quantity: 1
    });
    expect(purchaseReplay.status).toBe(200);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 1 });

    const areaResponse = await post(`/farms/${FARM_ONE_ID}/work-areas`, {
      requestId: "aqua_area_01", kind: "AQUACULTURE", name: "Tilapia Ponds", cells: [aquaCell, secondAquaCell]
    });
    expect(areaResponse.status).toBe(201);

    const landPond = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "aqua_bad_place_01", entryId: "place_fish_cage", anchorX: 0, anchorY: 0, rotation: 0
    });
    expect(landPond.status, await landPond.clone().text()).toBe(400);

    const placed = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "aqua_place_01", entryId: "place_fish_cage", anchorX: aquaCell.x, anchorY: aquaCell.y, rotation: 0
    });
    expect(placed.status, await placed.clone().text()).toBe(201);
    const construction = await json<{ data: { construction: { constructionId: string; version: number } } }>(placed);
    const pondId = construction.data.construction.constructionId;
    expect(db.sqlite.prepare("SELECT item_definition_id, stocked_at, ready_at, version FROM aquaculture_pond_states WHERE construction_id = ?").get(pondId)).toEqual({
      item_definition_id: null,
      stocked_at: null,
      ready_at: null,
      version: 0
    });

    const empty = await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`);
    expect((await json<{ data: { ponds: { status: string; version: number }[] } }>(empty)).data.ponds).toMatchObject([
      { status: "EMPTY", version: 0 }
    ]);

    const stocked = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_01", expectedPondVersion: 0, quantity: 1
    });
    expect(stocked.status).toBe(200);
    expect((await json<{ data: { pond: { status: string; version: number; itemDefinitionId: string } } }>(stocked)).data.pond).toMatchObject({
      status: "STOCKED", version: 1, itemDefinitionId: "item_fish_tilapia"
    });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });

    const moved = await post(`/farms/${FARM_ONE_ID}/constructions/${pondId}/move`, {
      requestId: "aqua_move_01",
      anchorX: secondAquaCell?.x,
      anchorY: secondAquaCell?.y,
      rotation: 0,
      expectedVersion: construction.data.construction.version
    });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const movedBody = await json<{ data: { construction: { version: number; anchorX: number; anchorY: number } } }>(moved);
    expect(movedBody.data.construction).toMatchObject({ anchorX: secondAquaCell?.x, anchorY: secondAquaCell?.y });
    expect(db.sqlite.prepare("SELECT quantity FROM aquaculture_pond_cohorts WHERE construction_id = ?").get(pondId)).toEqual({ quantity: 1 });

    const stored = await post(`/farms/${FARM_ONE_ID}/constructions/${pondId}/store`, {
      requestId: "aqua_store_01",
      expectedVersion: movedBody.data.construction.version
    });
    expect(stored.status, await stored.clone().text()).toBe(200);
    const storedBody = await json<{ data: { construction: { state: string; version: number } } }>(stored);
    expect(storedBody.data.construction.state).toBe("STORED");
    expect(db.sqlite.prepare("SELECT quantity FROM aquaculture_pond_cohorts WHERE construction_id = ?").get(pondId)).toEqual({ quantity: 1 });

    const restored = await post(`/farms/${FARM_ONE_ID}/constructions/${pondId}/restore`, {
      requestId: "aqua_restore_01",
      anchorX: secondAquaCell?.x,
      anchorY: secondAquaCell?.y,
      rotation: 0,
      expectedVersion: storedBody.data.construction.version
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect((await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`)).status).toBe(200);
    const restoredPonds = await json<{ data: { ponds: { pondId: string; stockedCount: number; version: number }[] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(restoredPonds.data.ponds).toContainEqual(expect.objectContaining({ pondId, stockedCount: 1, version: 1 }));
    expect(db.sqlite.prepare("SELECT quantity FROM aquaculture_pond_cohorts WHERE construction_id = ?").get(pondId)).toEqual({ quantity: 1 });

    const staleStock = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_stale", expectedPondVersion: 0, quantity: 1
    });
    expect(staleStock.status).toBe(409);

    clock.advanceSeconds(1_800);
    const growing = await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`);
    expect((await json<{ data: { ponds: { status: string }[] } }>(growing)).data.ponds[0]?.status).toBe("GROWING");
    clock.advanceSeconds(1_800);
    const ready = await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`);
    expect((await json<{ data: { ponds: { status: string }[] } }>(ready)).data.ponds[0]?.status).toBe("READY");

    const harvested = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, {
      requestId: "aqua_harvest_01", expectedPondVersion: 1, quantity: 1
    });
    expect(harvested.status, await harvested.clone().text()).toBe(200);
    expect((await json<{ data: { pond: { status: string; version: number } } }>(harvested)).data.pond).toMatchObject({ status: "EMPTY", version: 2 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia_adult'").get(PLAYER_ONE_ID)).toEqual({ quantity: 1 });

    const sold = await post("/shop/sell", { requestId: "aqua_sell_adult_01", shopEntryId: "shop_fish_tilapia_adult", quantity: 1 });
    expect(sold.status, await sold.clone().text()).toBe(200);
    expect(await sold.json()).toMatchObject({ data: { settlement: {
      itemDefinitionId: "item_fish_tilapia_adult", quantity: 1, amountReceived: 5
    } } });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia_adult'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });

    const harvestReplay = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, {
      requestId: "aqua_harvest_01", expectedPondVersion: 1, quantity: 1
    });
    expect(harvestReplay.status).toBe(200);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia_adult'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });

    const duplicate = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, {
      requestId: "aqua_harvest_02", expectedPondVersion: 2, quantity: 1
    });
    expect(duplicate.status).toBe(409);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });

    const boughtAgain = await post("/shop/buy", { requestId: "aqua_buy_again_01", shopEntryId: "shop_fish_tilapia", quantity: 1 });
    expect(boughtAgain.status).toBe(200);
    const stockedAgain = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_02", expectedPondVersion: 2, quantity: 1
    });
    expect(stockedAgain.status).toBe(200);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', 1, ?, 1)").run(PLAYER_ONE_ID, T0);
    db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = 1 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    clock.advanceSeconds(3_600);
    const full = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, {
      requestId: "aqua_harvest_full", expectedPondVersion: 3, quantity: 1
    });
    expect(full.status).toBe(409);
    expect((await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`)).status).toBe(200);
    const preserved = await json<{ data: { ponds: { status: string; version: number }[] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(preserved.data.ponds[0]).toMatchObject({ status: "READY", version: 3 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia_adult'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });
  });

  it("refuses fish-fingerling purchases without funds", async () => {
    db.sqlite.prepare("UPDATE wallets SET balance = 2 WHERE player_id = ?").run(PLAYER_ONE_ID);
    const refused = await post("/shop/buy", {
      requestId: "aqua_buy_insufficient", shopEntryId: "shop_fish_tilapia", quantity: 1
    });
    expect(refused.status).toBe(409);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toBeUndefined();
  });

  it("keeps two five-fish batches independent at T+60 and T+90", async () => {
    const bought = await post("/shop/buy", { requestId: "aqua_buy_two_batches", shopEntryId: "shop_fish_tilapia", quantity: 10 });
    expect(bought.status).toBe(200);
    const area = await post(`/farms/${FARM_ONE_ID}/work-areas`, { requestId: "aqua_area_two_batches", kind: "AQUACULTURE", name: "Two batches", cells: [aquaCell] });
    expect(area.status).toBe(201);
    const placed = await post(`/farms/${FARM_ONE_ID}/constructions`, { requestId: "aqua_place_two_batches", entryId: "place_fish_cage", anchorX: aquaCell.x, anchorY: aquaCell.y, rotation: 0 });
    const pondId = (await json<{ data: { construction: { constructionId: string } } }>(placed)).data.construction.constructionId;

    const first = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, { requestId: "aqua_stock_batch_first", expectedPondVersion: 0, quantity: 5 });
    expect(first.status).toBe(200);
    clock.advanceSeconds(1_800);
    const second = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, { requestId: "aqua_stock_batch_second", expectedPondVersion: 1, quantity: 5 });
    expect(second.status).toBe(200);

    clock.advanceSeconds(1_800);
    const atSixty = await json<{ data: { ponds: [{ status: string; readyCount: number; growingCount: number; version: number; cohorts: { quantity: number; stockedAt: string; readyAt: string }[] }] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(atSixty.data.ponds[0]).toMatchObject({ status: "GROWING", readyCount: 5, growingCount: 5, version: 2 });
    expect(atSixty.data.ponds[0].cohorts).toEqual([
      { cohortId: "cohort_aqua_stock_batch_first", itemDefinitionId: "item_fish_tilapia", quantity: 5, stockedAt: T0, readyAt: "2026-10-08T01:00:00.000Z" },
      { cohortId: "cohort_aqua_stock_batch_second", itemDefinitionId: "item_fish_tilapia", quantity: 5, stockedAt: "2026-10-08T00:30:00.000Z", readyAt: "2026-10-08T01:30:00.000Z" }
    ]);

    const partial = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, { requestId: "aqua_harvest_batch_partial", expectedPondVersion: 2, quantity: 2 });
    expect(partial.status).toBe(200);
    expect((await json<{ data: { pond: { readyCount: number; growingCount: number; version: number } } }>(partial)).data.pond).toMatchObject({ readyCount: 3, growingCount: 5, version: 3 });

    clock.advanceSeconds(1_800);
    const atNinety = await json<{ data: { ponds: [{ status: string; stockedCount: number; readyCount: number; growingCount: number; version: number; cohorts: { quantity: number }[] }] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(atNinety.data.ponds[0]).toMatchObject({ status: "READY", stockedCount: 8, readyCount: 8, growingCount: 0, version: 3 });
    expect(atNinety.data.ponds[0].cohorts.map((cohort) => cohort.quantity)).toEqual([3, 5]);
  });

  it("allows owner manual actions without an area, while retaining cross-farm protection", async () => {
    const bought = await post("/shop/buy", { requestId: "aqua_buy_no_area", shopEntryId: "shop_fish_tilapia", quantity: 1 });
    expect(bought.status).toBe(200);
    const placed = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "aqua_place_no_area", entryId: "place_fish_cage", anchorX: aquaCell.x, anchorY: aquaCell.y, rotation: 0
    });
    expect(placed.status, await placed.clone().text()).toBe(201);
    const pondId = (await json<{ data: { construction: { constructionId: string } } }>(placed)).data.construction.constructionId;
    const visibleWithoutArea = await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`);
    expect((await json<{ data: { ponds: { pondId: string; status: string; version: number }[] } }>(visibleWithoutArea)).data.ponds).toContainEqual(expect.objectContaining({ pondId, status: "EMPTY", version: 0 }));
    const missingFish = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_missing_fish", expectedPondVersion: 0, quantity: 2
    });
    expect(missingFish.status).toBe(409);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 1 });
    const noArea = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_no_area", expectedPondVersion: 0, quantity: 1
    });
    expect(noArea.status, await noArea.clone().text()).toBe(200);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 0 });
    clock.advanceSeconds(3_600);
    const harvestedWithoutArea = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, {
      requestId: "aqua_harvest_no_area", expectedPondVersion: 1, quantity: 1
    });
    expect(harvestedWithoutArea.status, await harvestedWithoutArea.clone().text()).toBe(200);

    const boughtForWithdraw = await post("/shop/buy", { requestId: "aqua_buy_withdraw_no_area", shopEntryId: "shop_fish_tilapia", quantity: 1 });
    expect(boughtForWithdraw.status).toBe(200);
    const secondStock = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_withdraw_no_area", expectedPondVersion: 2, quantity: 1
    });
    expect(secondStock.status).toBe(200);
    const withdrawnWithoutArea = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/withdraw`, {
      requestId: "aqua_withdraw_no_area", expectedPondVersion: 3, quantity: 1
    });
    expect(withdrawnWithoutArea.status, await withdrawnWithoutArea.clone().text()).toBe(200);
    const foreign = await post(`/farms/${FARM_TWO_ID}/aquaculture/ponds/${pondId}/stock`, {
      requestId: "aqua_stock_foreign", expectedPondVersion: 0, quantity: 1
    });
    expect(foreign.status).toBe(404);
  });

  it("settles multiple cohorts independently and preserves atomic guards", async () => {
    const bought = await post("/shop/buy", { requestId: "aqua_buy_multi", shopEntryId: "shop_fish_tilapia", quantity: 10 });
    expect(bought.status).toBe(200);
    const area = await post(`/farms/${FARM_ONE_ID}/work-areas`, { requestId: "aqua_area_multi", kind: "AQUACULTURE", name: "Multi pond", cells: [aquaCell] });
    expect(area.status).toBe(201);
    const placed = await post(`/farms/${FARM_ONE_ID}/constructions`, { requestId: "aqua_place_multi", entryId: "place_fish_cage", anchorX: aquaCell.x, anchorY: aquaCell.y, rotation: 0 });
    const pondId = (await json<{ data: { construction: { constructionId: string } } }>(placed)).data.construction.constructionId;

    const first = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, { requestId: "aqua_stock_eight", expectedPondVersion: 0, quantity: 8 });
    expect(first.status).toBe(200);
    clock.advanceSeconds(3_599);
    const second = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, { requestId: "aqua_stock_two", expectedPondVersion: 1, quantity: 2 });
    expect(second.status).toBe(200);
    const replay = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/stock`, { requestId: "aqua_stock_two", expectedPondVersion: 1, quantity: 2 });
    expect(replay.status).toBe(200);
    const mixed = await json<{ data: { ponds: [{ stockedCount: number; growingCount: number; readyCount: number; availableCapacity: number; cohorts: { quantity: number; stockedAt: string }[]; version: number }] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(mixed.data.ponds[0]).toMatchObject({ stockedCount: 10, growingCount: 10, readyCount: 0, availableCapacity: 0, version: 2 });
    expect(mixed.data.ponds[0].cohorts.map((cohort) => cohort.quantity)).toEqual([8, 2]);

    clock.advanceSeconds(1);
    const partial = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/harvest`, { requestId: "aqua_harvest_three", expectedPondVersion: 2, quantity: 3 });
    expect(partial.status).toBe(200);
    expect((await json<{ data: { pond: { stockedCount: number; readyCount: number; growingCount: number; version: number } } }>(partial)).data.pond).toMatchObject({ stockedCount: 7, readyCount: 5, growingCount: 2, version: 3 });
    const withdrawn = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/withdraw`, { requestId: "aqua_withdraw_one", expectedPondVersion: 3, quantity: 1 });
    expect(withdrawn.status).toBe(200);
    expect((await json<{ data: { pond: { stockedCount: number; readyCount: number; growingCount: number; version: number } } }>(withdrawn)).data.pond).toMatchObject({ stockedCount: 6, readyCount: 5, growingCount: 1, version: 4 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia'").get(PLAYER_ONE_ID)).toEqual({ quantity: 1 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_fish_tilapia_adult'").get(PLAYER_ONE_ID)).toEqual({ quantity: 3 });

    const stale = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/withdraw`, { requestId: "aqua_withdraw_stale", expectedPondVersion: 3, quantity: 1 });
    expect(stale.status).toBe(409);
    db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = 4 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    const full = await post(`/farms/${FARM_ONE_ID}/aquaculture/ponds/${pondId}/withdraw`, { requestId: "aqua_withdraw_full", expectedPondVersion: 4, quantity: 1 });
    expect(full.status).toBe(409);
    const afterFull = await json<{ data: { ponds: [{ stockedCount: number; version: number }] } }>(await get(`/farms/${FARM_ONE_ID}/aquaculture/ponds`));
    expect(afterFull.data.ponds[0]).toMatchObject({ stockedCount: 6, version: 4 });
  });
});
