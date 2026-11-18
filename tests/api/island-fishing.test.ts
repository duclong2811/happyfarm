import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, FishingIdGenerator, FishingRandomPort, IdGenerator } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseFishingActionId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type FishingActionId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { GetFishingResponseSchema } from "@happy-farm/contracts";
import { islandFishingSpots } from "@happy-farm/game-data";
import { createHandler } from "../../workers/api/src/handler";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataFishingCatalogue,
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
 * Deep-water fishing on a chosen island, through the real Worker handler.
 *
 * A chosen island fishes from its own sea: its spots are its stored FISHING sites, through
 * `islandFishingSpots` - the browser derives them from the island it already holds, and the server
 * accepts a start and a settle only at those spots. The catalogue listing stays static game data (it
 * reads no farm row). The composed island's pond and harbour are not on a chosen island, so they are
 * refused there; a farm on the composed island keeps the fixed spots and cannot name an island spot.
 */

const MIGRATIONS = schemaSql();
const ACTION_SECONDS = 15;
const THUY = { element: "THUY", outline: "ROUND", seed: 4242 } as const;
/** Coastal table rolls: sardine [0,0.45), mackerel [0.45,0.75), snapper [0.75,0.95), tuna [0.95,1). */
const ROLL_SNAPPER = 0.8;

class Ids implements IdGenerator, FishingIdGenerator {
  private farms = 0;
  private sequence = 1;
  newFarmId(): FarmId {
    this.farms += 1;
    return this.farms === 1 ? FARM_ONE_ID : FARM_TWO_ID;
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
  newFishingActionId(): FishingActionId {
    return parseFishingActionId(`fishact_11111111-1111-4111-8111-${String(this.sequence++).padStart(12, "0")}`);
  }
}

class MutableClock implements Clock {
  private current = NOW;
  now(): string {
    return this.current;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(Date.parse(this.current) + seconds * 1000).toISOString();
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

class FixedRandom implements FishingRandomPort {
  constructor(private readonly value: number) {}
  roll(): number {
    return this.value;
  }
}

describe("deep-water fishing on a chosen island", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let clock: MutableClock;
  let handle: (request: Request) => Promise<Response>;

  function request(path: string, body?: unknown): Promise<Response> {
    return handle(
      new Request(`https://dev.happy-farm.local${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    );
  }

  async function data(response: Response): Promise<unknown> {
    const body: { readonly data?: unknown; readonly error?: unknown } = await response.json();
    if (body.data === undefined) throw new Error(`expected success, got ${JSON.stringify(body.error)}`);
    return body.data;
  }

  async function codeOf(response: Response): Promise<unknown> {
    const body: unknown = await response.json();
    return (body as { readonly error?: { readonly code?: unknown } }).error?.code;
  }

  const spots = async () => GetFishingResponseSchema.parse(await data(await request("/fishing"))).spots;
  const start = (spotId: string, requestId: string) => request("/fishing/start", { requestId, spotId });
  const settle = (actionId: string, version: number, requestId: string) =>
    request(`/fishing/${actionId}/settle`, { requestId, expectedActionVersion: version });

  function held(itemId: string, playerId: string = PLAYER_ONE_ID): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(playerId, itemId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  beforeEach(async () => {
    db = new NodeD1Database(MIGRATIONS);
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Angler', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }
    auth = new SwitchableAuth({ playerId: PLAYER_ONE_ID });
    clock = new MutableClock();
    const ids = new Ids();
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
      fishing: { catalogue: new GameDataFishingCatalogue(), ids, random: new FixedRandom(ROLL_SNAPPER) },
      clock
    });
    // Player one chooses a Thủy island; player two takes the composed island.
    expect((await request("/farms", { name: "Đảo Thủy", island: THUY })).status).toBe(201);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await request("/farms", { name: "Đảo Ghép" })).status).toBe(201);
    auth.setActor({ playerId: PLAYER_ONE_ID });
  });

  afterEach(() => {
    db.close();
  });

  it("puts the island's spots on its stored FISHING sites, out on deep water, and accepts every one", async () => {
    const island = gameDataIslandGroundBuilder.build(THUY);
    const sites = island.sites.filter((site) => site.kind === "FISHING");
    expect(sites.length).toBeGreaterThanOrEqual(6);
    const derived = islandFishingSpots(island.sites);
    expect(derived.map((spot) => spot.id)).toEqual(sites.map((_, index) => `spot_isle_${String(index + 1)}`));
    expect(derived.map((spot) => [spot.position.x, spot.position.y])).toEqual(sites.map((site) => [site.x, site.y]));
    expect(derived.every((spot) => spot.displayNameKey === "spot.island_sea.name" && spot.tableId === "fishtable_coastal")).toBe(true);

    // The server agrees with the derivation: each spot starts (and is cancelled, to free the angler).
    for (const spot of derived) {
      const started = await start(spot.id, `isle_each_${spot.id}`);
      expect(started.status, spot.id).toBe(201);
      const action = ((await data(started)) as { action: { actionId: string; version: number } }).action;
      const cancelled = await request(`/fishing/${action.actionId}/cancel`, { requestId: `isle_cancel_${spot.id}`, expectedActionVersion: action.version });
      expect(cancelled.status, spot.id).toBe(200);
    }
  });

  it("keeps the catalogue listing static: the same fixed list whoever asks", async () => {
    const forIslandOwner = await spots();
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect(await spots()).toEqual(forIslandOwner);
    expect(forIslandOwner.map((spot) => spot.spotId)).toEqual(["spot_pond_north", "spot_pond_west", "spot_pond_east", "spot_harbour_quay"]);
  });

  it("fishes the open sea: starts at an island spot, settles a coastal catch the server chose", async () => {
    const started = await start("spot_isle_1", "isle_start_1");
    expect(started.status).toBe(201);
    const action = ((await data(started)) as { action: { actionId: string; version: number; spotId: string; zone: { kind: string; zoneId: string } } }).action;
    expect(action.spotId).toBe("spot_isle_1");
    expect(action.zone.kind).toBe("HOME_ISLAND");
    expect(action.zone.zoneId).toContain(FARM_ONE_ID);

    clock.advanceSeconds(ACTION_SECONDS + 1);
    const settled = await settle(action.actionId, action.version, "isle_settle_1");
    expect(settled.status).toBe(200);
    expect(((await data(settled)) as { catch: unknown }).catch).toEqual({ itemDefinitionId: "item_fish_snapper", quantity: 1 });
    expect(held("item_fish_snapper")).toBe(1);
  });

  it("refuses the composed island's spots and spots the island does not have", async () => {
    const count = islandFishingSpots(gameDataIslandGroundBuilder.build(THUY).sites).length;
    for (const spotId of ["spot_pond_north", "spot_harbour_quay", `spot_isle_${String(count + 1)}`]) {
      const refused = await start(spotId, `isle_refused_${spotId}`);
      expect(refused.status, spotId).toBe(404);
      expect(await codeOf(refused), spotId).toBe("FISHING_SPOT_NOT_FOUND");
    }
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fishing_actions").get()).toEqual({ n: 0 });
  });

  it("keeps the fixed spots for a farm on the composed island, and refuses it an island spot", async () => {
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await spots()).map((spot) => spot.spotId)).toEqual(["spot_pond_north", "spot_pond_west", "spot_pond_east", "spot_harbour_quay"]);
    const refused = await start("spot_isle_1", "composed_isle_1");
    expect(refused.status).toBe(404);
    expect(await codeOf(refused)).toBe("FISHING_SPOT_NOT_FOUND");
    expect((await start("spot_pond_north", "composed_pond_1")).status).toBe(201);
  });
});
