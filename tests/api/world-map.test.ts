import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreateFarm, type ActorContext, type AuthenticationPort, type Clock, type IdGenerator, type ShipCatalogue, type WorldChartPort } from "@happy-farm/application";
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
import { chartedArchipelagos, findSeaSlot, seaChart, shipClassById, voyageSeconds } from "@happy-farm/game-data";
import {
  createSeaBattle,
  cumulativeXpForLevel,
  runSeaBattle,
  SEA_BATTLE_ACTIONS,
  seaBattleResult,
  stepSeaBattle,
  type SeaBattleInput,
  type SeaBattleSetup
} from "@happy-farm/domain";
import {
  EnsureWorldSlotResponseSchema,
  GetMyFarmResponseSchema,
  GetWorldArchipelagoResponseSchema,
  GetWorldChartResponseSchema,
  VisitWorldPlaceResponseSchema,
  FleetResponseSchema,
  FightAmbushResponseSchema
} from "@happy-farm/contracts";
import { createHandler } from "../../workers/api/src/handler";
import { gameDataShipCatalogue } from "../../workers/api/src/runtime";
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
import { gunner } from "../support/sea-captain";

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

/** The test's server clock; `advance` moves it on, so a voyage can arrive. */
let clockMs = Date.parse(NOW);
const clock: Clock = { now: () => new Date(clockMs).toISOString() };
function advance(seconds: number): void {
  clockMs += seconds * 1000;
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

describe("the world map", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let ids: WorldIds;
  let handle: (request: Request) => Promise<Response>;

  function build(world: WorldChartPort | null = gameDataWorldChart, ships?: ShipCatalogue): void {
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
      ...(world === null ? {} : { world: { chart: world, ...(ships === undefined ? {} : { ships }) } }),
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

  let requestCounter = 0;
  /** Sails the current actor's ship to `slotId` and lets the voyage arrive. */
  async function sailTo(slotId: string): Promise<void> {
    requestCounter += 1;
    const response = await request("/voyages", { slotId, requestId: `voyage-request-${String(requestCounter)}` });
    expect(response.status).toBe(200);
    advance(4 * 60 * 60);
  }

  beforeEach(() => {
    clockMs = Date.parse(NOW);
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
    expect((await request("/ships/fleet")).status).toBe(404);
    expect((await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-request-1" })).status).toBe(404);
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
      archipelago: null,
      readAt: NOW,
      voyages: []
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
    // Looking at a place takes being there: no voyage, no visit.
    expect(await codeOf(await request("/world/visit", { slotId: edge }))).toBe("VOYAGE_NOT_ARRIVED");
    await sailTo(edge);
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
    await sailTo("slot_north_1_2");
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
    await sailTo("slot_north_1_3");
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

  /** Puts player `n` at `level`, with `gold`, `wood` and `ore` in hand. */
  function equip(n: number, level: number, gold: number, wood: number, ore: number): void {
    db.sqlite
      .prepare("INSERT OR REPLACE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .run(playerId(n), level, cumulativeXpForLevel(gameDataProgressionDefinition, level), NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = excluded.balance, version = wallets.version + 1, updated_at = excluded.updated_at"
      )
      .run(playerId(n), gold, NOW, NOW);
    const item = db.sqlite.prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1"
    );
    item.run(playerId(n), "item_wood", wood, NOW);
    item.run(playerId(n), "item_ore", ore, NOW);
  }

  function holdings(n: number): { gold: number; wood: number; ore: number; ledger: number } {
    const gold = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'").get(playerId(n)) as { balance: number } | undefined;
    const item = (id: string): number =>
      (db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(playerId(n), id) as { quantity: number } | undefined)?.quantity ?? 0;
    const ledger = db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ? AND reason = 'SHIP_BUILD'").get(playerId(n)) as { n: number };
    return { gold: gold?.balance ?? 0, wood: item("item_wood"), ore: item("item_ore"), ledger: ledger.n };
  }

  async function fleet(): Promise<ReturnType<typeof FleetResponseSchema.parse>> {
    return FleetResponseSchema.parse(await dataOf(await request("/ships/fleet")));
  }

  const sloop = shipClassById("ship_class_sloop");
  const rowboat = shipClassById("ship_class_rowboat");
  const lineBoat = shipClassById("ship_class_line_boat");

  /** The id of player `n`'s ship in `berth`. */
  function shipOf(n: number, berth = 1): string {
    const uuid = playerId(n).slice("player_".length);
    return berth === 1 ? `ship_${uuid}` : `ship_${uuid}_${String(berth)}`;
  }

  it("starts every player with the dock's rowboat, lent, a one-berth dock, and what each role would cost", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    const view = await fleet();
    if (rowboat === null || lineBoat === null || sloop === null) throw new Error("no ships");
    expect(view.location).toBe("HOME");
    expect(view.voyage).toBeNull();
    expect(view.ships).toHaveLength(1);
    expect(view.ship).toMatchObject({ shipId: shipOf(1), berth: 1, lent: true, classId: rowboat.id, role: "FISHING", rank: 1, tier: 1, hull: rowboat.hull, hullMax: rowboat.hull, cannons: 0, hold: rowboat.hold, away: false });
    // The rowboat's own ladder: it becomes a line boat, never a warship.
    expect(view.next).toMatchObject({ classId: lineBoat.id, role: "FISHING", rank: 2, requiredPlayerLevel: lineBoat.requiredPlayerLevel });
    expect(view.ship.upgrade).toEqual(view.next);
    expect(view.builds.map((build) => [build.role, build.classId])).toEqual([
      ["FISHING", "ship_class_rowboat"],
      ["MERCHANT", "ship_class_coaster"],
      ["WAR", "ship_class_sloop"]
    ]);
    expect(view.builds.find((build) => build.role === "WAR")?.cost).toEqual({
      currencyId: "currency_gold",
      gold: sloop.buildCost.gold,
      materials: [
        { itemDefinitionId: "item_wood", quantity: sloop.buildCost.wood },
        { itemDefinitionId: "item_ore", quantity: sloop.buildCost.ore }
      ]
    });
    expect(view.dock).toMatchObject({ tier: 1, berths: 1, freeBerths: 1, next: { tier: 2, berths: 2 } });
  });

  it("builds a warship for its price in place of the lent rowboat, through the ledger, once per request", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    if (sloop === null) throw new Error("no sloop");
    const war = (requestId: string) => request("/ships/build", { role: "WAR", requestId });
    // Too low a level, then too little wood, then too little gold: nothing is taken.
    equip(1, sloop.requiredPlayerLevel - 1, 5_000, 300, 200);
    expect(await codeOf(await war("build-request-1"))).toBe("SHIP_LEVEL_REQUIRED");
    equip(1, sloop.requiredPlayerLevel, 5_000, sloop.buildCost.wood - 1, 200);
    expect(await codeOf(await war("build-request-1"))).toBe("INSUFFICIENT_ITEMS");
    equip(1, sloop.requiredPlayerLevel, sloop.buildCost.gold - 1, 300, 200);
    expect(await codeOf(await war("build-request-1"))).toBe("INSUFFICIENT_FUNDS");
    expect(holdings(1)).toEqual({ gold: sloop.buildCost.gold - 1, wood: 300, ore: 200, ledger: 0 });

    equip(1, sloop.requiredPlayerLevel, 5_000, 300, 200);
    const built = FleetResponseSchema.parse(await dataOf(await war("build-request-2")));
    expect(built.ships).toHaveLength(1);
    expect(built.ship).toMatchObject({ shipId: shipOf(1), berth: 1, lent: false, classId: sloop.id, role: "WAR", tier: 2, hull: sloop.hull });
    expect(built.dock.freeBerths).toBe(0);
    const after = { gold: 5_000 - sloop.buildCost.gold, wood: 300 - sloop.buildCost.wood, ore: 200 - sloop.buildCost.ore, ledger: 1 };
    expect(holdings(1)).toEqual(after);
    const ledger = db.sqlite.prepare("SELECT delta, reason, reference_type, reference_id, request_id FROM economy_ledger WHERE reason = 'SHIP_BUILD'").get() as Record<string, unknown>;
    expect(ledger).toEqual({ delta: -sloop.buildCost.gold, reason: "SHIP_BUILD", reference_type: "SHIP", reference_id: shipOf(1), request_id: "build-request-2" });
    // The same request again answers from its receipt and charges nothing; the same id for another role is refused.
    const replayed = FleetResponseSchema.parse(await dataOf(await war("build-request-2")));
    expect(replayed.ship).toEqual(built.ship);
    expect(await codeOf(await request("/ships/build", { role: "FISHING", requestId: "build-request-2" }))).toBe("IDEMPOTENCY_CONFLICT");
    expect(holdings(1)).toEqual(after);
    expect((await fleet()).ship.classId).toBe(sloop.id);
    // A one-berth dock holds one ship of one's own.
    expect(await codeOf(await request("/ships/build", { role: "FISHING", requestId: "build-request-3" }))).toBe("DOCK_FULL");
  });

  it("charges one upgrade when two race for the same step, and moves the ship up its own ladder in place", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    if (lineBoat === null) throw new Error("no line boat");
    // Enough of everything for two upgrades of the lent rowboat: only the ship itself can decide the race.
    equip(1, lineBoat.requiredPlayerLevel, 50_000, 300, 100);
    const results = await Promise.all([
      request("/ships/upgrade", { shipId: shipOf(1), requestId: "race-request-1" }),
      request("/ships/upgrade", { shipId: shipOf(1), requestId: "race-request-2" })
    ]);
    expect(results.map((response) => response.status)).toContain(200);
    expect(holdings(1).ledger).toBe(1);
    const view = await fleet();
    // The rowboat is now the player's own, a line boat in the same berth, still a fishing boat.
    expect(view.ships).toHaveLength(1);
    expect(view.ship).toMatchObject({ shipId: shipOf(1), berth: 1, lent: false, classId: lineBoat.id, role: "FISHING", rank: 2, hull: lineBoat.hull });
    expect(holdings(1)).toEqual({ gold: 50_000 - lineBoat.buildCost.gold, wood: 300 - lineBoat.buildCost.wood, ore: 100 - lineBoat.buildCost.ore, ledger: 1 });
    // Another player's ship, or a ship id that is not one's own, is not found.
    expect(await codeOf(await request("/ships/upgrade", { shipId: shipOf(2), requestId: "upgrade-other-1" }))).toBe("RESOURCE_NOT_FOUND");
    expect(await codeOf(await request("/ships/upgrade", { shipId: shipOf(1, 2), requestId: "upgrade-empty-1" }))).toBe("RESOURCE_NOT_FOUND");
    for (const body of [{ requestId: "upgrade-bad-1" }, { shipId: "ship_1", requestId: "upgrade-bad-2" }, { shipId: shipOf(1), requestId: "upgrade-bad-3", classId: "ship_class_dragon" }]) {
      expect((await request("/ships/upgrade", body)).status).toBe(400);
    }
  });

  it("raises the dock through the ledger for a second berth, and fills it with a ship of another role", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    if (sloop === null || rowboat === null) throw new Error("no ships");
    const dock = (requestId: string) => request("/ships/dock", { requestId });
    equip(1, 14, 5_000, 500, 170);
    expect(await codeOf(await dock("dock-request-1"))).toBe("DOCK_LEVEL_REQUIRED");
    db.sqlite
      .prepare("UPDATE player_progression SET level = 15, xp = ?, progression_version = progression_version + 1 WHERE player_id = ?")
      .run(cumulativeXpForLevel(gameDataProgressionDefinition, 15), playerId(1));
    expect((await request("/ships/build", { role: "WAR", requestId: "dock-sloop-1" })).status).toBe(200);
    const before = holdings(1);
    const raised = FleetResponseSchema.parse(await dataOf(await dock("dock-request-2")));
    expect(raised.dock).toMatchObject({ tier: 2, berths: 2, freeBerths: 1, next: { tier: 3, berths: 3 } });
    expect(holdings(1)).toMatchObject({ gold: before.gold - 1_500, wood: before.wood - 300, ore: before.ore - 100 });
    const ledger = db.sqlite.prepare("SELECT delta, reference_type, reference_id, request_id FROM economy_ledger WHERE reason = 'DOCK_UPGRADE'").all();
    expect(ledger).toEqual([{ delta: -1_500, reference_type: "DOCK", reference_id: `dock_${playerId(1).slice("player_".length)}`, request_id: "dock-request-2" }]);
    // The same request again charges nothing.
    expect(FleetResponseSchema.parse(await dataOf(await dock("dock-request-2"))).dock.tier).toBe(2);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'DOCK_UPGRADE'").get()).toEqual({ n: 1 });
    // The next tier wants a higher level still.
    expect(await codeOf(await dock("dock-request-3"))).toBe("DOCK_LEVEL_REQUIRED");

    // The free berth takes a fishing boat; the sloop keeps berth 1.
    const built = FleetResponseSchema.parse(await dataOf(await request("/ships/build", { role: "FISHING", requestId: "dock-rowboat-1" })));
    expect(built.ships.map((ship) => [ship.berth, ship.shipId, ship.classId, ship.lent])).toEqual([
      [1, shipOf(1), sloop.id, false],
      [2, shipOf(1, 2), rowboat.id, false]
    ]);
    expect(built.dock.freeBerths).toBe(0);
    expect(db.sqlite.prepare("SELECT reference_id FROM economy_ledger WHERE request_id = 'dock-rowboat-1'").get()).toEqual({ reference_id: shipOf(1, 2) });
    expect(await codeOf(await request("/ships/build", { role: "FISHING", requestId: "dock-rowboat-2" }))).toBe("DOCK_FULL");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM player_ships WHERE player_id = ?").get(playerId(1))).toEqual({ n: 2 });
  });

  it("sails the ship it is told to, keeps the others at the dock, and lets no second ship out until the first is home", async () => {
    // Pirates on every voyage of any ship: a ship with no guns must still meet none.
    build(gameDataWorldChart, { ...gameDataShipCatalogue, planAmbush: () => ({ atShare: 0.5, seed: 9, pirates: ["pirate_cutter"] }) });
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    equip(1, 15, 5_000, 500, 170);
    expect((await request("/ships/build", { role: "WAR", requestId: "fleet-sloop-1" })).status).toBe(200);
    expect((await request("/ships/dock", { requestId: "fleet-dock-1" })).status).toBe(200);
    expect((await request("/ships/build", { role: "FISHING", requestId: "fleet-rowboat-1" })).status).toBe(200);

    const out = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "fleet-voyage-1", shipId: shipOf(1, 2) })));
    expect(out.voyage).toMatchObject({ shipId: shipOf(1, 2), ambush: null });
    expect(out.ship).toMatchObject({ shipId: shipOf(1, 2), away: true });
    expect(out.ships.map((ship) => ship.away)).toEqual([false, true]);
    expect(db.sqlite.prepare("SELECT ship_id, ship_tier FROM ship_voyages WHERE player_id = ?").get(playerId(1))).toEqual({ ship_id: shipOf(1, 2), ship_tier: 1 });
    // The sloop stays at the dock: it can be worked on, but cannot sail until the rowboat is home.
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_1_3", requestId: "fleet-voyage-2", shipId: shipOf(1) }))).toBe("VOYAGE_UNDERWAY");
    expect(await codeOf(await request("/ships/upgrade", { shipId: shipOf(1, 2), requestId: "fleet-upgrade-1" }))).toBe("SHIP_AT_SEA");
    advance((Date.parse(out.voyage?.arrivesAt ?? "") - Date.parse(NOW)) / 1000);
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_1_3", requestId: "fleet-voyage-3", shipId: shipOf(1) }))).toBe("VOYAGE_UNDERWAY");
    // The rowboat lying there sails on, unnamed.
    const onward = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_3", requestId: "fleet-voyage-4" })));
    expect(onward.voyage).toMatchObject({ shipId: shipOf(1, 2), fromSlotId: "slot_north_1_2" });
    await request("/voyages/end", {});
    // Home again, the sloop sails, and pirates find it.
    const sloopOut = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "fleet-voyage-5", shipId: shipOf(1) })));
    expect(sloopOut.voyage?.shipId).toBe(shipOf(1));
    expect(sloopOut.voyage?.ambush?.pirates).toEqual(["pirate_cutter"]);
    // Another player's ship is not one to sail.
    await request("/voyages/end", {});
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "fleet-voyage-6", shipId: shipOf(2) }))).toBe("RESOURCE_NOT_FOUND");
  });

  it("sails for as long as the distance takes, from wherever the ship lies, and comes home at once", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    const home = findSeaSlot("slot_north_1_1");
    const first = findSeaSlot("slot_north_1_2");
    const second = findSeaSlot("slot_north_1_4");
    if (home === null || first === null || second === null || rowboat === null) throw new Error("no chart");

    const out = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: first.slotId, requestId: "voyage-request-a" })));
    const seconds = voyageSeconds(Math.hypot(first.x - home.x, first.z - home.z), rowboat.speedTilesPerMinute);
    expect(out.location).toBe("AT_SEA");
    expect(out.voyage).toMatchObject({ fromSlotId: home.slotId, toSlotId: first.slotId, arrived: false });
    expect(Date.parse(out.voyage?.arrivesAt ?? "") - Date.parse(out.voyage?.departedAt ?? "")).toBe(seconds * 1000);
    // The same request again is the same voyage; another one waits for this to arrive.
    expect(FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: first.slotId, requestId: "voyage-request-a" }))).voyage).toEqual(out.voyage);
    expect(await codeOf(await request("/voyages", { slotId: second.slotId, requestId: "voyage-request-b" }))).toBe("VOYAGE_UNDERWAY");
    expect(await codeOf(await request("/ships/build", { role: "WAR", requestId: "build-at-sea-1" }))).toBe("SHIP_AT_SEA");
    expect(await codeOf(await request("/ships/upgrade", { shipId: shipOf(1), requestId: "build-at-sea-2" }))).toBe("SHIP_AT_SEA");
    expect(await codeOf(await request("/world/visit", { slotId: first.slotId }))).toBe("VOYAGE_NOT_ARRIVED");

    advance(seconds);
    const there = await fleet();
    expect(there.location).toBe("AT_PLACE");
    expect(there.voyage?.arrived).toBe(true);
    expect((await request("/world/visit", { slotId: first.slotId })).status).toBe(200);
    // The ship already lies there; sailing on leaves from here.
    expect(await codeOf(await request("/voyages", { slotId: first.slotId, requestId: "voyage-request-c" }))).toBe("INVALID_INPUT");
    const onward = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: second.slotId, requestId: "voyage-request-d" })));
    expect(onward.voyage?.fromSlotId).toBe(first.slotId);

    const ended = FleetResponseSchema.parse(await dataOf(await request("/voyages/end", {})));
    expect(ended.location).toBe("HOME");
    expect(ended.voyage).toBeNull();
    expect((await fleet()).location).toBe("HOME");
    expect((await request("/voyages/end", {})).status).toBe(200);
    // Home again, a visit to where the ship no longer is is refused.
    expect(await codeOf(await request("/world/visit", { slotId: first.slotId }))).toBe("VOYAGE_NOT_ARRIVED");
  });

  it("keeps each player's ship and voyage their own, and refuses uncharted or malformed voyages", async () => {
    await settle(1, "NORTH");
    await settle(2, "EAST");
    auth.setActor({ playerId: playerId(1) });
    expect(await codeOf(await request("/voyages", { slotId: "slot_east_1_1", requestId: "voyage-request-x" }))).toBe("WORLD_PLACE_UNCHARTED");
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_99_1", requestId: "voyage-request-y" }))).toBe("RESOURCE_NOT_FOUND");
    for (const body of [{}, { slotId: "slot_north_1_2" }, { slotId: "slot_north_1_2", requestId: "x" }, { slotId: "slot_north_1_2", requestId: "voyage-request-z", seconds: 1 }]) {
      expect((await request("/voyages", body)).status).toBe(400);
    }
    expect((await request("/ships/build", { requestId: "build-request-1", tier: 4 })).status).toBe(400);
    expect((await request("/ships/build", { role: "PIRATE", requestId: "build-request-1" })).status).toBe(400);
    expect((await request("/voyages/end", { slotId: "slot_north_1_1" })).status).toBe(400);
    await sailTo("slot_north_1_2");
    auth.setActor({ playerId: playerId(2) });
    expect((await fleet()).location).toBe("HOME");
    auth.setActor(null);
    expect((await request("/ships/fleet")).status).toBe(401);
    expect((await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-request-q" })).status).toBe(401);
  });

  it("shows the ships at sea in the reader's charted world, by island name and never by player", async () => {
    await settle(1, "NORTH");
    await settle(2, "NORTH");
    await settle(3, "EAST");
    auth.setActor({ playerId: playerId(2) });
    expect((await request("/voyages", { slotId: "slot_north_1_3", requestId: "voyage-request-sea" })).status).toBe(200);

    auth.setActor({ playerId: playerId(1) });
    const chartResponse = await request("/world/chart");
    const text = await chartResponse.text();
    expect(text).not.toContain(playerId(2));
    const body: { readonly data?: unknown } = JSON.parse(text) as { readonly data?: unknown };
    const chart = GetWorldChartResponseSchema.parse(body.data);
    expect(chart.readAt).toBe(NOW);
    expect(chart.voyages).toHaveLength(1);
    expect(chart.voyages?.[0]).toMatchObject({ fromSlotId: "slot_north_1_2", toSlotId: "slot_north_1_3", shipTier: 1, departedAt: NOW, name: "Isle 2", mine: false });
    expect(Date.parse(chart.voyages?.[0]?.arrivesAt ?? "")).toBeGreaterThan(Date.parse(NOW));
    const archipelago = GetWorldArchipelagoResponseSchema.parse(await dataOf(await request("/world/archipelago")));
    expect(archipelago.voyages?.map((voyage) => voyage.toSlotId)).toEqual(["slot_north_1_3"]);
    // The voyager sees their own ship as theirs; a reader whose chart does not reach it sees nothing.
    auth.setActor({ playerId: playerId(2) });
    expect(GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart"))).voyages?.[0]?.mine).toBe(true);
    auth.setActor({ playerId: playerId(3) });
    expect(GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart"))).voyages).toEqual([]);
    // A voyage that has ended is no longer at sea.
    auth.setActor({ playerId: playerId(2) });
    await request("/voyages/end", {});
    auth.setActor({ playerId: playerId(1) });
    expect(GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart"))).voyages).toEqual([]);
  });

  /** The game's own ship rules, with pirates on every voyage of a fighting ship: `party` decides who. */
  function alwaysAmbushed(party: readonly string[]): ShipCatalogue {
    return {
      ...gameDataShipCatalogue,
      planAmbush: (input) => (input.shipTier < 2 ? null : { atShare: 0.5, seed: 777, pirates: party })
    };
  }

  /** Plays a fight as a device does (an attentive captain), and returns its inputs as the wire carries them. */
  function playOnDevice(setup: SeaBattleSetup): { inputs: ([number, number] | [number, number, number])[]; result: ReturnType<typeof seaBattleResult> } {
    const state = createSeaBattle(setup);
    const decide = gunner();
    const inputs: ([number, number] | [number, number, number])[] = [];
    while (state.outcome === null) {
      const orders = decide(state);
      for (const order of orders) {
        const index = SEA_BATTLE_ACTIONS.indexOf(order.action);
        inputs.push(order.aim === undefined ? [state.tick, index] : [state.tick, index, order.aim]);
      }
      stepSeaBattle(state, orders);
    }
    return { inputs, result: seaBattleResult(state) };
  }

  /** The wire's inputs as the simulation takes them. */
  function asInputs(inputs: readonly ([number, number] | [number, number, number])[]): SeaBattleInput[] {
    return inputs.map(([tick, action, aim]) => {
      const name = SEA_BATTLE_ACTIONS[action] ?? "RUDDER_CENTER";
      return aim === undefined ? { tick, action: name } : { tick, action: name, aim };
    });
  }

  /** Player `n` with a sloop at its dock, in place of the lent rowboat. */
  async function withSloop(n: number): Promise<void> {
    if (sloop === null) throw new Error("no sloop");
    equip(n, sloop.requiredPlayerLevel, 50_000, 400, 200);
    expect((await request("/ships/build", { role: "WAR", requestId: `build-sloop-${String(n)}` })).status).toBe(200);
  }

  it("plans pirates for a fighting ship, never a rowboat, and gives the device the exact fight", async () => {
    build(gameDataWorldChart, alwaysAmbushed(["pirate_cutter"]));
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    const rowing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-rowboat-1" })));
    expect(rowing.voyage?.ambush).toBeNull();
    await request("/voyages/end", {});
    await withSloop(1);
    const sailing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-sloop-1" })));
    const ambush = sailing.voyage?.ambush;
    if (ambush == null || sailing.voyage === null) throw new Error("no ambush");
    expect(ambush.status).toBe("PENDING");
    expect(ambush.pirates).toEqual(["pirate_cutter"]);
    expect(ambush.setup.seed).toBe(777);
    expect(ambush.setup.player).toMatchObject({ hull: sloop?.hull, cannons: sloop?.cannons });
    expect(Date.parse(ambush.at)).toBeGreaterThan(Date.parse(sailing.voyage.departedAt));
    expect(Date.parse(ambush.at)).toBeLessThan(Date.parse(sailing.voyage.arrivesAt));
  });

  it("replays the device's fight to decide it, once, and keeps the visit waiting until it is fought", async () => {
    build(gameDataWorldChart, alwaysAmbushed(["pirate_cutter"]));
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    await withSloop(1);
    const sailing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-sloop-2" })));
    const ambush = sailing.voyage?.ambush;
    if (ambush == null || sailing.voyage === null) throw new Error("no ambush");
    const played = playOnDevice(ambush.setup);
    expect(await codeOf(await request("/voyages/ambush", { inputs: played.inputs }))).toBe("AMBUSH_NOT_READY");

    advance((Date.parse(sailing.voyage.arrivesAt) - Date.parse(sailing.voyage.departedAt)) / 1000);
    expect(await codeOf(await request("/world/visit", { slotId: "slot_north_1_2" }))).toBe("AMBUSH_PENDING");
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_1_3", requestId: "voyage-sloop-3" }))).toBe("AMBUSH_PENDING");

    const fought = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: played.inputs })));
    // The server's replay of the device's inputs is the device's own fight.
    expect(fought.battle).toEqual(played.result);
    expect(fought.battle).toEqual(runSeaBattle(ambush.setup, asInputs(played.inputs)));
    expect(fought.fleet.voyage?.ambush?.status).toBe(played.result.outcome);
    expect(fought.fleet.ship.hull).toBe(played.result.playerHull);
    // Asked again, the outcome stands and new inputs are not taken.
    const again = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: [] })));
    expect(again.battle).toBeNull();
    expect(again.fleet.ship.hull).toBe(played.result.playerHull);
    if (played.result.outcome !== "LOST") expect((await request("/world/visit", { slotId: "slot_north_1_2" })).status).toBe(200);
  });

  it("plays out struck pirates without orders when the ship is called home, and the damage stands", async () => {
    build(gameDataWorldChart, alwaysAmbushed(["pirate_corsair", "pirate_corsair", "pirate_raider"]));
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    await withSloop(1);
    const sailing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-sloop-4" })));
    const ambush = sailing.voyage?.ambush;
    if (ambush == null) throw new Error("no ambush");
    advance((Date.parse(ambush.at) - Date.parse(NOW)) / 1000 + 1);
    const home = FleetResponseSchema.parse(await dataOf(await request("/voyages/end", {})));
    const passive = runSeaBattle(ambush.setup, []);
    expect(home.location).toBe("HOME");
    expect(home.ship.hull).toBe(passive.playerHull);
    expect(home.ship.hull).toBeLessThan(home.ship.hullMax);
  });

  it("sends a sunk ship home to be repaired, for gold and wood through the ledger, once per request", async () => {
    build(gameDataWorldChart, alwaysAmbushed(["pirate_corsair", "pirate_corsair", "pirate_corsair", "pirate_corsair"]));
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    await withSloop(1);
    const sailing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-sloop-5" })));
    const ambush = sailing.voyage?.ambush;
    if (ambush == null) throw new Error("no ambush");
    advance((Date.parse(ambush.at) - Date.parse(NOW)) / 1000 + 1);
    const lost = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: [] })));
    expect(lost.battle?.outcome).toBe("LOST");
    expect(lost.fleet.location).toBe("HOME");
    expect(lost.fleet.ship.hull).toBe(0);
    expect(await codeOf(await request("/voyages", { slotId: "slot_north_1_3", requestId: "voyage-sloop-6" }))).toBe("SHIP_DAMAGED");

    const before = holdings(1);
    const hullMax = lost.fleet.ship.hullMax;
    const repaired = FleetResponseSchema.parse(await dataOf(await request("/ships/repair", { requestId: "repair-request-1" })));
    expect(repaired.ship.hull).toBe(hullMax);
    expect(holdings(1)).toMatchObject({ gold: before.gold - hullMax * 2, wood: before.wood - Math.ceil(hullMax * 0.25) });
    const ledger = db.sqlite.prepare("SELECT delta, reference_type FROM economy_ledger WHERE reason = 'SHIP_REPAIR'").all();
    expect(ledger).toEqual([{ delta: -hullMax * 2, reference_type: "SHIP" }]);
    // The same request again charges nothing; a ship that is whole needs no repair.
    expect((await request("/ships/repair", { requestId: "repair-request-1" })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'SHIP_REPAIR'").get()).toEqual({ n: 1 });
    expect(await codeOf(await request("/ships/repair", { requestId: "repair-request-2" }))).toBe("SHIP_NOT_DAMAGED");
  });

  /**
   * Sails player 1's sloop into `party` and brings the clock to the strike; the setup to fight. With
   * `brittle`, the pirates keep their bounty but sink at a touch: these tests are about what a win
   * pays, not about how hard one is to get.
   */
  async function struckBy(party: readonly string[], voyageRequestId: string, brittle = false): Promise<SeaBattleSetup> {
    const catalogue = alwaysAmbushed(party);
    build(
      gameDataWorldChart,
      brittle
        ? {
            ...catalogue,
            pirate: (id) => {
              const ship = gameDataShipCatalogue.pirate(id);
              return ship === null ? null : { ...ship, hull: 1 };
            }
          }
        : catalogue
    );
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    await withSloop(1);
    const sailing = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: voyageRequestId })));
    const ambush = sailing.voyage?.ambush;
    if (ambush == null) throw new Error("no ambush");
    advance((Date.parse(ambush.at) - clockMs) / 1000 + 1);
    return ambush.setup;
  }

  function experience(n: number): number {
    return (db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(playerId(n)) as { xp: number }).xp;
  }

  function bounties(n: number): { delta: number; reference_type: string; reference_id: string }[] {
    return db.sqlite
      .prepare("SELECT delta, reference_type, reference_id FROM economy_ledger WHERE player_id = ? AND reason = 'PIRATE_BOUNTY'")
      .all(playerId(n)) as { delta: number; reference_type: string; reference_id: string }[];
  }

  it("pays a won fight's bounty once: gold through the ledger, wood and experience with the outcome", async () => {
    const setup = await struckBy(["pirate_cutter"], "voyage-bounty-1", true);
    const played = playOnDevice(setup);
    expect(played.result.outcome).toBe("WON");
    const before = holdings(1);
    const xpBefore = experience(1);

    const won = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: played.inputs })));
    expect(won.battle?.outcome).toBe("WON");
    // A cutter's bounty, from game data: never a number the client sent.
    expect(won.bounty).toMatchObject({ currencyDefinitionId: "currency_gold", gold: 160, materials: [{ itemDefinitionId: "item_wood", quantity: 40, lost: 0 }], xpAwarded: 60 });
    expect(holdings(1)).toMatchObject({ gold: before.gold + 160, wood: before.wood + 40, ore: before.ore });
    expect(experience(1)).toBe(xpBefore + 60);
    expect(won.bounty?.progression.xp).toBe(xpBefore + 60);
    const shipId = `ship_${playerId(1).slice("player_".length)}`;
    expect(bounties(1)).toEqual([{ delta: 160, reference_type: "SHIP", reference_id: shipId }]);

    // Asked again, the same bounty is reported and nothing is paid twice.
    const again = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: played.inputs })));
    expect(again.battle).toBeNull();
    expect(again.bounty).toEqual(won.bounty);
    expect(bounties(1)).toHaveLength(1);
    expect(holdings(1)).toMatchObject({ gold: before.gold + 160, wood: before.wood + 40 });
    expect(experience(1)).toBe(xpBefore + 60);
  });

  it("pays a route's bounty once a day, however often the same fight is won again", async () => {
    const setup = await struckBy(["pirate_cutter"], "voyage-bounty-4", true);
    const played = playOnDevice(setup);
    const first = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: played.inputs })));
    expect(first.bounty?.gold).toBe(160);
    const afterFirst = holdings(1);

    // Home, and out again on the same route the same day: the same pirates, the same seed, so the
    // same recorded orders win the same fight. It is decided, and it pays nothing more.
    await request("/voyages/end", {});
    const again = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-bounty-5" })));
    const ambush = again.voyage?.ambush;
    if (ambush == null) throw new Error("no ambush");
    // The same encounter: the same seed and the same pirates (the ship's hull is what the last fight left).
    expect(ambush.setup.seed).toBe(setup.seed);
    expect(ambush.setup.pirates).toEqual(setup.pirates);
    advance((Date.parse(ambush.at) - clockMs) / 1000 + 1);
    const second = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: playOnDevice(ambush.setup).inputs })));
    expect(second.battle?.outcome).toBe("WON");
    expect(second.fleet.voyage?.ambush?.status).toBe("WON");
    expect(second.bounty).toBeNull();
    expect(bounties(1)).toHaveLength(1);
    expect(holdings(1)).toMatchObject({ gold: afterFirst.gold, wood: afterFirst.wood });
    // Asked again, this voyage still reports no bounty: the one paid today was the first voyage's.
    const replayed = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: [] })));
    expect(replayed.bounty).toBeNull();

    // A new day is a new encounter on the route, and pays again.
    await request("/voyages/end", {});
    advance(24 * 60 * 60);
    const tomorrow = FleetResponseSchema.parse(await dataOf(await request("/voyages", { slotId: "slot_north_1_2", requestId: "voyage-bounty-6" })));
    const next = tomorrow.voyage?.ambush;
    if (next == null) throw new Error("no ambush");
    advance((Date.parse(next.at) - clockMs) / 1000 + 1);
    const won = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: playOnDevice(next.setup).inputs })));
    expect(won.battle?.outcome).toBe("WON");
    expect(won.bounty?.gold).toBe(160);
    expect(bounties(1)).toHaveLength(2);
  });

  it("keeps out what the warehouse has no room for, in the bounty's order, and still pays the gold", async () => {
    const setup = await struckBy(["pirate_raider"], "voyage-bounty-2", true);
    const played = playOnDevice(setup);
    expect(played.result.outcome).toBe("WON");
    // Fill the island to ten short of its starter capacity: a raider's 120 wood and 40 ore will not fit.
    const used = (db.sqlite.prepare("SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory_items WHERE player_id = ?").get(playerId(1)) as { n: number }).n;
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', ?, ?, 1)")
      .run(playerId(1), 1000 - used - 10, NOW);
    const before = holdings(1);

    const won = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: played.inputs })));
    expect(won.bounty).toMatchObject({
      gold: 500,
      materials: [
        { itemDefinitionId: "item_wood", quantity: 10, lost: 110 },
        { itemDefinitionId: "item_ore", quantity: 0, lost: 40 }
      ],
      xpAwarded: 180
    });
    expect(holdings(1)).toMatchObject({ gold: before.gold + 500, wood: before.wood + 10, ore: before.ore });
    expect(bounties(1)).toHaveLength(1);
  });

  it("pays nothing for a fight that is lost", async () => {
    await struckBy(["pirate_corsair", "pirate_corsair", "pirate_corsair", "pirate_corsair"], "voyage-bounty-3");
    const before = holdings(1);
    const lost = FightAmbushResponseSchema.parse(await dataOf(await request("/voyages/ambush", { inputs: [] })));
    expect(lost.battle?.outcome).toBe("LOST");
    expect(lost.bounty).toBeNull();
    expect(bounties(1)).toEqual([]);
    expect(holdings(1)).toMatchObject({ gold: before.gold, wood: before.wood, ore: before.ore });
  });

  it("refuses a fight's inputs no device would send", async () => {
    await settle(1, "NORTH");
    auth.setActor({ playerId: playerId(1) });
    for (const inputs of [
      [[3_600, 0]],
      [[0, 11]],
      [[0]],
      [[-1, 0]],
      [[0.5, 0]],
      [[0, 6, 401]],
      [[0, 6, 1.5]],
      [[0, 6, 0, 0]],
      Array.from({ length: 3_601 }, () => [0, 0])
    ]) {
      expect((await request("/voyages/ambush", { inputs })).status).toBe(400);
    }
    expect((await request("/voyages/ambush", { inputs: [], hull: 999 })).status).toBe(400);
    expect(await codeOf(await request("/voyages/ambush", { inputs: [] }))).toBe("RESOURCE_NOT_FOUND");
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
