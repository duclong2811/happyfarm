import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { buildIslandGround, classifyIslandTile, classifyTile } from "@happy-farm/game-data";
import { GetFarmIslandResponseSchema, GetMyFarmResponseSchema } from "@happy-farm/contracts";
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
  gameDataIslandGroundBuilder,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * Home Island choice: a new farm may be created on an island the player picked.
 *
 * The rules this file holds: the server builds the island from three values and stores it with the
 * farm in one batch; an existing farm can never swap islands; a host that has not opted in refuses
 * a choice instead of quietly ignoring it; and only the farm's members may read its ground.
 */

const MIGRATIONS = schemaSql();

class SequenceIds implements IdGenerator {
  private sequence = 1;
  newFarmId(): FarmId {
    return this.sequence++ === 1 ? FARM_ONE_ID : FARM_TWO_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId(`cropinst_cccccccc-cccc-4ccc-8ccc-${String(this.sequence++).padStart(12, "0")}`);
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId(`treeinst_eeeeeeee-eeee-4eee-8eee-${String(this.sequence++).padStart(12, "0")}`);
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.sequence++).padStart(12, "0")}`);
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(`construct_11111111-1111-4111-8111-${String(this.sequence++).padStart(12, "0")}`);
  }
}

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class SwitchableAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

const CHOICE = { element: "THUY", outline: "ATOLL", seed: 4242 } as const;

describe("Home Island choice", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;

  function handler(choiceEnabled: boolean | null): (request: Request) => Promise<Response> {
    return createHandler({
      db,
      authenticator: auth,
      ids: new SequenceIds(),
      fingerprints: new Sha256Fingerprint(),
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
      ...(choiceEnabled === null ? {} : { islands: { choiceEnabled, builder: gameDataIslandGroundBuilder } }),
      clock: new FixedClock()
    });
  }

  function request(path: string, body?: unknown): Request {
    return new Request(`https://dev.happy-farm.local${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  async function data(response: Response): Promise<Record<string, unknown>> {
    const body: unknown = await response.json();
    const envelope = body as { readonly data?: Record<string, unknown>; readonly error?: { readonly code?: unknown } };
    return envelope.data ?? { error: envelope.error?.code };
  }

  function islandRows(): number {
    return (db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_islands").get() as { readonly count: number }).count;
  }

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Player', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }
    auth = new SwitchableAuth({ playerId: PLAYER_ONE_ID });
  });

  afterEach(() => {
    db.close();
  });

  it("tells a new player they may choose, and an existing player which island they have", async () => {
    const handle = handler(true);
    const before = GetMyFarmResponseSchema.parse(await data(await handle(request("/farms/mine"))));
    expect(before).toEqual({ farm: null, island: null, islandChoice: { enabled: true } });

    const created = await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
    expect(created.status).toBe(201);
    expect((await data(created)).island).toEqual({ ...CHOICE, revision: 1 });

    const after = GetMyFarmResponseSchema.parse(await data(await handle(request("/farms/mine"))));
    expect(after.farm?.name).toBe("Đảo Ngọc");
    expect(after.island).toEqual({ ...CHOICE, revision: 1 });
  });

  it("builds the island on the server and stores exactly what it built", async () => {
    const handle = handler(true);
    await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
    const response = await handle(request(`/farms/${FARM_ONE_ID}/island`));
    expect(response.status).toBe(200);
    const { island } = GetFarmIslandResponseSchema.parse(await data(response));
    const expected = buildIslandGround(CHOICE);
    expect(island.cells).toBe(expected.cells);
    expect(island.sites).toEqual(expected.sites);
    expect(island).toMatchObject({ ...CHOICE, size: expected.size, originX: expected.originX, revision: 1 });

    const farm = await data(await handle(request(`/farms/${FARM_ONE_ID}`)));
    expect(farm.island).toEqual({ ...CHOICE, revision: 1 });
  });

  it("never swaps the island of a farm that already exists", async () => {
    const handle = handler(true);
    await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
    const again = await handle(request("/farms", { name: "Khác", island: { element: "KIM", outline: "ROUND", seed: 7 } }));
    expect(again.status).toBe(200);
    expect((await data(again)).island).toEqual({ ...CHOICE, revision: 1 });
    expect(islandRows()).toBe(1);
  });

  it("keeps a farm created without a choice on the hand-composed island", async () => {
    const handle = handler(true);
    const created = await handle(request("/farms", { name: "Starter Farm" }));
    expect(created.status).toBe(201);
    expect((await data(created)).island).toBeNull();
    expect(islandRows()).toBe(0);
    const ground = await handle(request(`/farms/${FARM_ONE_ID}/island`));
    expect(ground.status).toBe(404);
  });

  it("refuses a choice on a host that has not opted in, and creates nothing", async () => {
    for (const handle of [handler(false), handler(null)]) {
      const mine = GetMyFarmResponseSchema.parse(await data(await handle(request("/farms/mine"))));
      expect(mine.islandChoice.enabled).toBe(false);
      const refused = await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
      expect(refused.status).toBe(403);
      expect((await data(refused)).error).toBe("ISLAND_CHOICE_UNAVAILABLE");
    }
    expect((db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get() as { readonly count: number }).count).toBe(0);
    expect(islandRows()).toBe(0);
  });

  it("validates the choice at the edge", async () => {
    const handle = handler(true);
    for (const island of [
      { ...CHOICE, outline: "SQUARE" },
      { ...CHOICE, element: "WATER" },
      { ...CHOICE, seed: 0 },
      { ...CHOICE, seed: 2_147_483_648 },
      { ...CHOICE, seed: 1.5 },
      { ...CHOICE, cells: "dddd" }
    ]) {
      const response = await handle(request("/farms", { name: "Đảo Ngọc", island }));
      expect(response.status).toBe(400);
    }
    expect(islandRows()).toBe(0);
  });

  it("shows a farm's ground to its members only", async () => {
    const handle = handler(true);
    await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await handle(request(`/farms/${FARM_ONE_ID}/island`))).status).toBe(403);
    auth.setActor(null);
    expect((await handle(request(`/farms/${FARM_ONE_ID}/island`))).status).toBe(401);
    expect((await handle(request("/farms/mine"))).status).toBe(401);
  });

  it("judges planting by the farm's own island, not the hand-composed one", async () => {
    const handle = handler(true);
    await handle(request("/farms", { name: "Đảo Ngọc", island: CHOICE }));
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot_seed', 5, ?, 1)")
      .run(PLAYER_ONE_ID, NOW);
    const ground = buildIslandGround(CHOICE);
    const tiles: { readonly x: number; readonly y: number }[] = [];
    for (let y = ground.originY; y < ground.originY + ground.size; y += 1) {
      for (let x = ground.originX; x < ground.originX + ground.size; x += 1) tiles.push({ x, y });
    }
    const usable = (classification: { readonly terrain: string; readonly protectedGround: boolean }): boolean =>
      classification.terrain === "LAND" && !classification.protectedGround;
    // Land here that the old island calls sea or mountain, and sea here that the old island calls land.
    const ownLandOnly = tiles.find((tile) => usable(classifyIslandTile(ground, tile)) && !usable(classifyTile(tile)));
    const ownSeaOnly = tiles.find((tile) => classifyIslandTile(ground, tile).terrain === "WATER" && usable(classifyTile(tile)));
    expect(ownLandOnly).toBeDefined();
    expect(ownSeaOnly).toBeDefined();
    if (ownLandOnly === undefined || ownSeaOnly === undefined) return;

    const plant = (tile: { readonly x: number; readonly y: number }, requestId: string) =>
      handle(request(`/farms/${FARM_ONE_ID}/crops`, { requestId, cropDefinitionId: "crop_carrot", x: tile.x, y: tile.y }));
    expect((await plant(ownLandOnly, "island_plant_land")).status).toBe(201);
    const refused = await plant(ownSeaOnly, "island_plant_sea");
    expect((await data(refused)).error).toBe("TILE_NOT_PLANTABLE");
  });

  it("seeds a chosen island's own forest, never the old island's starter objects", async () => {
    const handle = handler(true);
    const choice = { element: "MOC", outline: "ROUND", seed: 77 } as const;
    await handle(request("/farms", { name: "Rừng Xanh", island: choice }));
    const listed = await handle(request(`/farms/${FARM_ONE_ID}/constructions`));
    expect(listed.status).toBe(200);
    const rows = db.sqlite
      .prepare("SELECT placement_key, anchor_x, anchor_y, catalogue_entry_id FROM farm_constructions WHERE farm_id = ?")
      .all(FARM_ONE_ID) as { placement_key: string; anchor_x: number; anchor_y: number; catalogue_entry_id: string }[];
    const trees = buildIslandGround(choice).sites.filter((site) => site.kind === "TREE");
    expect(trees.length).toBeGreaterThanOrEqual(120);
    expect(rows.length).toBe(trees.length);
    expect(rows.every((row) => row.placement_key.startsWith("island.tree."))).toBe(true);
    expect(rows.every((row) => row.catalogue_entry_id === "world.tree_pine" || row.catalogue_entry_id === "world.tree_broad")).toBe(true);
    const ground = buildIslandGround(choice);
    expect(rows.every((row) => classifyIslandTile(ground, { x: row.anchor_x, y: row.anchor_y }).terrain === "LAND")).toBe(true);

    // A second read seeds nothing more.
    await handle(request(`/farms/${FARM_ONE_ID}/constructions`));
    expect((db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_constructions WHERE farm_id = ?").get(FARM_ONE_ID) as { count: number }).count).toBe(trees.length);
  });
});
