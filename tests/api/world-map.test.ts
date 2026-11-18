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
import { seaChart } from "@happy-farm/game-data";
import { EnsureWorldSlotResponseSchema, GetWorldChartResponseSchema } from "@happy-farm/contracts";
import { createHandler } from "../../workers/api/src/handler";
import { D1FarmMemberRepository, D1FarmRepository, D1PlayerRepository, D1WorldSlotRepository } from "../../workers/api/src/d1-repositories";
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

    auth.setActor({ playerId: playerId(size + 1) });
    const chart = GetWorldChartResponseSchema.parse(await dataOf(await request("/world/chart")));
    const north = chart.regions.find((entry) => entry.region === "NORTH");
    expect(north?.archipelagos.map((archipelago) => archipelago.archipelagoId)).toEqual(["sea_north_1", "sea_north_2"]);
    expect(chart.mySlotId).toBe("slot_north_2_1");
    // Every other region shows its first archipelago, open from the start and still empty.
    for (const region of ["EAST", "SOUTH", "WEST"]) {
      const entry = chart.regions.find((candidate) => candidate.region === region);
      expect(entry?.archipelagos).toHaveLength(1);
      expect(entry?.archipelagos[0]?.slots.every((slot) => !slot.claimed)).toBe(true);
    }
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
      { chart: gameDataWorldChart, slots: new StaleOnce(db) }
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

  it("validates what a client sends and who is asking", async () => {
    auth.setActor({ playerId: playerId(1) });
    expect((await request("/farms", { name: "Isle", island: CHOICE, region: "CENTRE" })).status).toBe(400);
    expect((await request("/farms", { name: "Isle", island: CHOICE, slotId: "slot_north_1_1" })).status).toBe(400);
    expect((await request("/world/slot", { region: "UP" })).status).toBe(400);
    auth.setActor(null);
    expect((await request("/world/chart")).status).toBe(401);
  });
});
