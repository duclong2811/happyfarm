import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreateFarm, type ActorContext, type AuthenticationPort, type Clock, type IdGenerator, type WorldChartPort } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseFarmId,
  parsePlayerId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type PlayerId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { chartedArchipelagos, seaChart } from "@happy-farm/game-data";
import {
  EnsureWorldSlotResponseSchema,
  GetMyFarmResponseSchema,
  GetWorldArchipelagoResponseSchema,
  GetWorldChartResponseSchema,
  VisitWorldPlaceResponseSchema
} from "@happy-farm/contracts";
import { createHandler } from "../../workers/api/src/handler";
import { D1FarmMemberRepository, D1FarmRepository, D1PlayerRepository, D1WorldSlotRepository, D1WorldVisitRepository } from "../../workers/api/src/d1-repositories";
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
  gameDataTileTerrain,
  gameDataWorldChart
} from "../../workers/api/src/runtime";
import { schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { NOW } from "../support/fixtures";

/**
 * The world map's places (docs/design/WORLD_MAP.md) through the real Worker handler.
 *
 * A chosen island takes the next free slot of the region its player named (or the emptiest region),
 * in the same transaction as the farm. A slot holds one island and an island one slot, a repeat
 * creation changes nothing, an island beaten to its slot takes the next, archipelagos open as they
 * fill, and the client never names a slot.
 */

const MIGRATIONS = schemaSql();
const CHOICE = { element: "HOA", outline: "ROUND", seed: 1234 } as const;

function playerId(n: number): PlayerId {
  return parsePlayerId(`player_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

class WorldIds implements IdGenerator {
  private farm = 0;
  private sequence = 1;
  newFarmId(): FarmId {
    this.farm += 1;
    return parseFarmId(`farm_00000000-0000-4000-8000-${String(this.farm).padStart(12, "0")}`);
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

const clock: Clock = { now: () => NOW };

class SwitchableAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

describe("the world map", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let ids: WorldIds;
  let handle: (request: Request) => Promise<Response>;

  function build(world: WorldChartPort | null = gameDataWorldChart): void {
    handle = createHandler({
      db,
      authenticator: auth,
      ids,
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
      islands: { choiceEnabled: true, builder: gameDataIslandGroundBuilder },
      ...(world === null ? {} : { world: { chart: world } }),
      clock
    });
  }

  function request(path: string, body?: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    );
  }

  async function dataOf(response: Response): Promise<unknown> {
    const body: { readonly data?: unknown } = await response.json();
    return body.data;
  }

  async function codeOf(response: Response): Promise<unknown> {
    const body: { readonly error?: { readonly code?: unknown } } = await response.json();
    return body.error?.code;
  }

  function addPlayer(n: number): void {
    db.sqlite
      .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Sailor', 'ACTIVE', ?, ?)")
      .run(playerId(n), `subject-${String(n)}`, NOW, NOW);
  }

  /** Player `n` creates a farm on a chosen island, in `region` if one is given. */
  async function settle(n: number, region?: string): Promise<Response> {
    auth.setActor({ playerId: playerId(n) });
    return request("/farms", { name: `Isle ${String(n)}`, island: CHOICE, ...(region === undefined ? {} : { region }) });
  }

  function slotOf(n: number): string | null {
    const row = db.sqlite
      .prepare("SELECT ws.slot_id FROM world_slots ws JOIN farms f ON f.id = ws.farm_id WHERE f.owner_player_id = ?")
      .get(playerId(n)) as { slot_id: string } | undefined;
    return row?.slot_id ?? null;
  }

  function farmOf(n: number): string {
    const row = db.sqlite.prepare("SELECT id FROM farms WHERE owner_player_id = ?").get(playerId(n)) as { id: string } | undefined;
    if (row === undefined) throw new Error(`player ${String(n)} has no farm`);
    return row.id;
  }

  function visitsOf(n: number): string[] {
    return (db.sqlite.prepare("SELECT slot_id FROM world_visits WHERE player_id = ? ORDER BY slot_id").all(playerId(n)) as { slot_id: string }[]).map(
      (row) => row.slot_id
    );
  }

  /** Every row an island's look is made of, to show a visit leaves them as they were. */
  function islandRows(farmId: string): unknown {
    return ["farm_tiles", "crop_instances", "tree_instances", "farm_constructions", "farm_islands", "farms"].map((table) =>
      db.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table === "farms" ? "id" : "farm_id"} = ? ORDER BY 1, 2`).all(farmId)
    );
  }

  async function chartIds(): Promise<string[]> {
    const chart = GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart")));
    return chart.regions.flatMap((entry) => entry.archipelagos.map((archipelago) => archipelago.archipelagoId));
  }

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    auth = new SwitchableAuth(null);
    ids = new WorldIds();
    for (let n = 1; n <= 12; n += 1) addPlayer(n);
    build();
  });

  afterEach(() => {
    db.close();
  });

  it("tells a client whether the world map is on, and answers its routes only then", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect(GetMyFarmResponseSchema.parse(await dataOf(await request("/farms/mine"))).worldMap).toEqual({ enabled: true });
    build(null);
    expect(GetMyFarmResponseSchema.parse(await dataOf(await request("/farms/mine"))).worldMap).toEqual({ enabled: false });
    expect((await request("/world/chart")).status).toBe(404);
    expect((await request("/world/archipelago")).status).toBe(404);
    expect((await request("/world/visit", { slotId: "slot_north_1_1" })).status).toBe(404);
  });

  it("places a chosen island in the next free slot of the region it named", async () => {
    for (const n of [1, 2, 3]) expect((await settle(n, "NORTH")).status).toBe(201);
    expect([slotOf(1), slotOf(2), slotOf(3)]).toEqual(["slot_north_1_1", "slot_north_1_2", "slot_north_1_3"]);
  });

  it("places an island that names no region in the emptiest one", async () => {
    await settle(1, "NORTH");
    await settle(2);
    expect(slotOf(2)).toBe("slot_east_1_1");
  });

  it("fills an archipelago, then opens the next one in that region", async () => {
    const first = seaChart().get("NORTH")?.[0];
    if (first === undefined) throw new Error("no northern archipelago");
    const size = first.slots.length;
    for (let n = 1; n <= size + 1; n += 1) expect((await settle(n, "NORTH")).status).toBe(201);
    expect(slotOf(size)).toBe(`slot_north_1_${String(size)}`);
    expect(slotOf(size + 1)).toBe("slot_north_2_1");

    // A newcomer, still choosing a sea, reads the harbour's chart: every open archipelago.
    auth.setActor({ playerId: playerId(size + 2) });
    const harbour = GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart")));
    const north = harbour.regions.find((entry) => entry.region === "NORTH");
    expect(north?.archipelagos.map((archipelago) => archipelago.archipelagoId)).toEqual(["sea_north_1", "sea_north_2"]);
    expect(harbour.mySlotId).toBeNull();
    // Every other region shows its first archipelago, open from the start and still empty.
    for (const region of ["EAST", "SOUTH", "WEST"]) {
      const entry = harbour.regions.find((candidate) => candidate.region === region);
      expect(entry?.archipelagos).toHaveLength(1);
      expect(entry?.archipelagos[0]?.slots.every((slot) => !slot.claimed)).toBe(true);
    }

    // The island that opened the second archipelago knows only its own waters.
    auth.setActor({ playerId: playerId(size + 1) });
    const own = GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart")));
    expect(own.mySlotId).toBe("slot_north_2_1");
    expect(own.regions.flatMap((entry) => entry.archipelagos.map((archipelago) => archipelago.archipelagoId))).toEqual(["sea_north_2"]);
  });

  it("draws a claimed slot with its owner's island and a free one with its wild island", async () => {
    await settle(1, "WEST");
    auth.setActor({ playerId: playerId(1) });
    const chart = GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart")));
    const slots = chart.regions.find((entry) => entry.region === "WEST")?.archipelagos[0]?.slots ?? [];
    const mine = slots.find((slot) => slot.slotId === "slot_west_1_1");
    expect(mine).toMatchObject({ claimed: true, mine: true, island: { ...CHOICE, generatorVersion: 2 } });
    const wild = seaChart().get("WEST")?.[0]?.slots[1];
    expect(slots[1]).toMatchObject({ claimed: false, mine: false, island: { ...wild?.wild, generatorVersion: 2 } });
  });

  it("shows a player their own archipelago: its places, its islands, and which is theirs", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect(GetWorldArchipelagoResponseSchema.parse(await dataOf(await request("/world/archipelago")))).toEqual({
      mySlotId: null,
      region: null,
      archipelago: null
    });
    for (const n of [1, 2, 3]) await settle(n, "NORTH");
    await settle(4, "EAST");
    auth.setActor({ playerId: playerId(2) });
    const view = GetWorldArchipelagoResponseSchema.parse(await dataOf(await request("/world/archipelago")));
    const first = seaChart().get("NORTH")?.[0];
    expect(view.mySlotId).toBe("slot_north_1_2");
    expect(view.region).toBe("NORTH");
    expect(view.archipelago?.archipelagoId).toBe("sea_north_1");
    expect(view.archipelago?.slots.map((slot) => slot.slotId)).toEqual(first?.slots.map((slot) => slot.slotId));
    expect(view.archipelago?.slots.filter((slot) => slot.claimed).map((slot) => slot.slotId)).toEqual(["slot_north_1_1", "slot_north_1_2", "slot_north_1_3"]);
    expect(view.archipelago?.slots.filter((slot) => slot.mine).map((slot) => slot.slotId)).toEqual(["slot_north_1_2"]);
    expect(view.archipelago?.slots[0]?.island).toEqual({ ...CHOICE, generatorVersion: 2 });
    expect(view.archipelago?.slots[3]?.island).toEqual({ ...first?.slots[3]?.wild, generatorVersion: 2 });
  });

  it("gives a farm on the composed island no place, and a repeat creation no second one", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect((await request("/farms", { name: "Composed" })).status).toBe(201);
    expect(slotOf(1)).toBeNull();

    expect((await settle(2, "SOUTH")).status).toBe(201);
    expect((await settle(2, "NORTH")).status).toBe(200);
    expect(slotOf(2)).toBe("slot_south_1_1");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM world_slots").get()).toEqual({ n: 1 });
  });

  it("moves an island beaten to its slot on to the next free one", async () => {
    // Player 1 takes north 1-1. Player 2's view of the map is stale: it still thinks north 1-1 is free.
    await settle(1, "NORTH");
    class StaleOnce extends D1WorldSlotRepository {
      private stale = true;
      override async claimedSlotIds(): Promise<ReadonlySet<string>> {
        if (this.stale) {
          this.stale = false;
          return new Set();
        }
        return super.claimedSlotIds();
      }
    }
    const createFarm = new CreateFarm(
      new D1PlayerRepository(db),
      new D1FarmRepository(db),
      new D1FarmMemberRepository(db),
      ids,
      clock,
      { enabled: true, builder: gameDataIslandGroundBuilder },
      { chart: gameDataWorldChart, slots: new StaleOnce(db), visits: new D1WorldVisitRepository(db) }
    );
    const result = await createFarm.execute({ playerId: playerId(2) }, { name: "Late", island: CHOICE, region: "NORTH" });
    expect(result.created).toBe(true);
    expect(slotOf(2)).toBe("slot_north_1_2");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM farms WHERE owner_player_id = ?").get(playerId(2))).toEqual({ n: 1 });
  });

  it("refuses an island when its region has no free place left", async () => {
    const full: WorldChartPort = { ...gameDataWorldChart, nextFreeSlot: () => null };
    build(full);
    const refused = await settle(1, "EAST");
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("WORLD_REGION_FULL");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM farms").get()).toEqual({ n: 0 });
  });

  it("places an existing island farm on request, once, and refuses a farm without an island", async () => {
    build(null);
    await settle(1);
    expect(slotOf(1)).toBeNull();
    build();
    auth.setActor({ playerId: playerId(1) });
    const placed = await request("/world/slot", { region: "SOUTH" });
    expect(placed.status).toBe(200);
    const slot = EnsureWorldSlotResponseSchema.parse(await dataOf(placed)).slot;
    expect(slot).toMatchObject({ slotId: "slot_south_1_1", region: "SOUTH", archipelagoId: "sea_south_1" });
    const again = EnsureWorldSlotResponseSchema.parse(await dataOf(await request("/world/slot", { region: "NORTH" }))).slot;
    expect(again.slotId).toBe("slot_south_1_1");

    auth.setActor({ playerId: playerId(2) });
    expect((await request("/farms", { name: "Composed" })).status).toBe(201);
    const composed = await request("/world/slot", {});
    expect(composed.status).toBe(403);
  });

  it("charts only a newcomer's own waters, and grows the chart with each visit", async () => {
    await settle(1, "NORTH");
    await settle(2, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    expect(await chartIds()).toEqual(["sea_north_1"]);
    // A visit to the archipelago's outer edge brings the next archipelagos into sight.
    const edge = "slot_north_1_5";
    expect((await request("/world/visit", { slotId: edge })).status).toBe(200);
    const grown = await chartIds();
    expect(grown).toEqual(chartedArchipelagos("slot_north_1_1", [edge]).map((archipelago) => archipelago.archipelagoId));
    expect(grown.length).toBeGreaterThan(1);
    // Another player's chart is their own: it did not grow.
    auth.setActor({ playerId: playerId(2) });
    expect(await chartIds()).toEqual(["sea_north_1"]);
  });

  it("refuses a place that is not on the reader's chart, and records nothing", async () => {
    await settle(1, "NORTH");
    await settle(2, "EAST");
    auth.setActor({ playerId: playerId(1) });
    const refused = await request("/world/visit", { slotId: "slot_east_1_1" });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("WORLD_PLACE_UNCHARTED");
    expect(visitsOf(1)).toEqual([]);
  });

  it("shows a settled island as anyone sailing by would see it, and changes nothing on it", async () => {
    await settle(1, "NORTH");
    await settle(2, "NORTH");
    const other = farmOf(2);
    const before = islandRows(other);
    auth.setActor({ playerId: playerId(1) });
    const response = await request("/world/visit", { slotId: "slot_north_1_2" });
    expect(response.status).toBe(200);
    const text = await response.text();
    // No id of the other farm, its owner, or anything on it leaves the server.
    expect(text).not.toContain(other);
    expect(text).not.toContain(playerId(2));
    expect(text).not.toMatch(/"(farmId|ownerPlayerId|cropInstanceId|treeInstanceId|constructionId|playerId)"/);
    const body: { readonly data?: unknown } = JSON.parse(text) as { readonly data?: unknown };
    const view = VisitWorldPlaceResponseSchema.parse(body.data);
    expect(view.place).toMatchObject({ slotId: "slot_north_1_2", claimed: true, mine: false, name: "Isle 2", island: { ...CHOICE, generatorVersion: 2 } });
    expect(view.farm?.name).toBe("Isle 2");
    expect(view.farm?.island).toMatchObject(CHOICE);
    expect(view.farm?.tiles.length).toBeGreaterThan(0);
    expect(islandRows(other)).toEqual(before);
    // A second visit records nothing new.
    await request("/world/visit", { slotId: "slot_north_1_2" });
    expect(visitsOf(1)).toEqual(["slot_north_1_2"]);
  });

  it("shows a free place's wild island, and home as home", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    const wild = VisitWorldPlaceResponseSchema.parse(await dataOf(await request("/world/visit", { slotId: "slot_north_1_3" })));
    const template = seaChart().get("NORTH")?.[0]?.slots[2]?.wild;
    expect(wild.place).toMatchObject({ claimed: false, mine: false, name: null, island: { ...template, generatorVersion: 2 } });
    expect(wild.farm).toBeNull();
    const home = VisitWorldPlaceResponseSchema.parse(await dataOf(await request("/world/visit", { slotId: "slot_north_1_1" })));
    expect(home.place).toMatchObject({ claimed: true, mine: true, name: "Isle 1" });
    expect(home.farm).toBeNull();
    expect(visitsOf(1)).toEqual(["slot_north_1_3"]);
  });

  it("lets only an island with a place on the chart sail", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect(await codeOf(await request("/world/visit", { slotId: "slot_north_1_1" }))).toBe("WORLD_PLACE_UNCHARTED");
    expect((await request("/farms", { name: "Composed" })).status).toBe(201);
    const refused = await request("/world/visit", { slotId: "slot_north_1_1" });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("WORLD_PLACE_UNCHARTED");
  });

  it("validates what a client sends and who is asking", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect((await request("/farms", { name: "Isle", island: CHOICE, region: "CENTRE" })).status).toBe(400);
    expect((await request("/farms", { name: "Isle", island: CHOICE, slotId: "slot_north_1_1" })).status).toBe(400);
    expect((await request("/world/slot", { region: "UP" })).status).toBe(400);
    for (const body of [{}, { slotId: "north" }, { slotId: "slot_north_1_1", farmId: "farm_x" }, { slotId: "slot_north_1111_1" }, { slotId: 7 }]) {
      expect((await request("/world/visit", body)).status).toBe(400);
    }
    await settle(1, "NORTH");
    expect(await codeOf(await request("/world/visit", { slotId: "slot_north_99_1" }))).toBe("RESOURCE_NOT_FOUND");
    auth.setActor(null);
    expect((await request("/world/visit", { slotId: "slot_north_1_1" })).status).toBe(401);
    expect((await request("/world/chart")).status).toBe(401);
    expect((await request("/world/archipelago")).status).toBe(401);
  });
});
