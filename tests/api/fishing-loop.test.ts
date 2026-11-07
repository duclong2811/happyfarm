import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActorContext,
  AuthenticationPort,
  Clock,
  ConstructionIdGenerator,
  CropIdGenerator,
  EconomyTransactionIdGenerator,
  FishingIdGenerator,
  FishingRandomPort,
  IdGenerator,
  TreeIdGenerator
} from "@happy-farm/application";
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
import { createHandler } from "../../workers/api/src/handler";
import {
  CryptoFishingRandom,
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataFishingCatalogue,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataLandSale
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";
import { schemaSql } from "../support/migrations";

/**
 * The whole fishing loop, through the real API.
 *
 * A player fishes the island's pond, is refused before the wait is up, settles a catch the server
 * chose, finds it in the inventory, gains experience, sells it for gold, and fishes again - while a
 * replay, a second concurrent settle and every malformed request are refused. The clock is the
 * server's and is moved by the test, so no real seconds pass.
 */

const MIGRATIONS = schemaSql();

const POND_SPOT = "spot_pond_north";
const HARBOUR_SPOT = "spot_harbour_quay";
const ACTION_SECONDS = 15;
/** Rolls in the freshwater table (tilapia [0,0.5), carp [0.5,0.8), catfish [0.8,1)). */
const ROLL_CATFISH = 0.9;
const ROLL_TILAPIA = 0.1;

class MutableClock implements Clock {
  private current = NOW;
  now(): string {
    return this.current;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(Date.parse(this.current) + seconds * 1000).toISOString();
  }
}

class MutableAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

class FishingIds implements IdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator, FishingIdGenerator {
  private sequence = 1;
  newFarmId(): FarmId {
    return FARM_ONE_ID;
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

/** A random source a test can script: the next `roll()` is the next value. */
class ScriptedRandom implements FishingRandomPort {
  private readonly rolls: number[];
  constructor(...rolls: number[]) {
    this.rolls = rolls;
  }
  roll(): number {
    const next = this.rolls.shift();
    if (next === undefined) throw new Error("the test ran out of scripted rolls");
    return next;
  }
}

describe("the fishing loop", () => {
  let db: NodeD1Database;
  let clock: MutableClock;
  let auth: MutableAuth;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    clock = new MutableClock();
    auth = new MutableAuth({ playerId: PLAYER_ONE_ID });
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Angler One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 0, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    handle = createHandler({
      db,
      authenticator: auth,
      ids: new FishingIds(),
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
      fishing: {
        catalogue: new GameDataFishingCatalogue(),
        ids: new FishingIds(),
        random: new ScriptedRandom(ROLL_CATFISH, ROLL_TILAPIA, ROLL_TILAPIA, ROLL_CATFISH)
      },
      clock
    });
  });

  afterEach(() => {
    db.close();
  });

  async function body(response: Response): Promise<unknown> {
    const value: unknown = await response.json();
    return value;
  }

  function post(path: string, payload: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof payload === "string" ? payload : JSON.stringify(payload)
      })
    );
  }

  function get(path: string): Promise<Response> {
    return handle(new Request(`https://api.test${path}`));
  }

  async function start(spotId: string, requestId: string) {
    return post("/fishing/start", { requestId, spotId });
  }

  async function settle(actionId: string, version: number, requestId: string) {
    return post(`/fishing/${actionId}/settle`, { requestId, expectedActionVersion: version });
  }

  async function cancel(actionId: string, version: number, requestId: string) {
    return post(`/fishing/${actionId}/cancel`, { requestId, expectedActionVersion: version });
  }

  function held(itemDefinitionId: string, player = PLAYER_ONE_ID): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(player, itemDefinitionId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function balance(): number {
    const row = db.sqlite
      .prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'")
      .get(PLAYER_ONE_ID) as { balance: number };
    return row.balance;
  }

  function xp(): number {
    const row = db.sqlite
      .prepare("SELECT xp FROM player_progression WHERE player_id = ?")
      .get(PLAYER_ONE_ID) as { xp: number } | undefined;
    return row?.xp ?? 0;
  }

  /** Creates the player's island: fishing resolves its zone from the farm the player owns. */
  async function createFarm(): Promise<void> {
    const created = await post("/farms", { name: "Angler Island" });
    expect(created.status).toBe(201);
  }

  it("serves the catalogue without reading player state", async () => {
    const response = await get("/fishing");
    expect(response.status).toBe(200);
    const data = (await body(response)) as {
      data: { spots: readonly { spotId: string; zoneKind: string }[]; fish: readonly { fishDefinitionId: string; itemDefinitionId: string }[] };
    };
    expect(data.data.spots.map((spot) => spot.spotId)).toEqual([
      "spot_pond_north",
      "spot_pond_west",
      "spot_pond_east",
      "spot_harbour_quay"
    ]);
    expect(data.data.spots.every((spot) => spot.zoneKind === "HOME_ISLAND")).toBe(true);
    expect(data.data.fish).toHaveLength(7);
    expect(data.data.fish.map((entry) => entry.itemDefinitionId)).toContain("item_fish_tuna");
  });

  it("fishes, waits, catches, sells, and fishes again - with replay and concurrency refused", async () => {
    await createFarm();

    // 1. Start. The client named a spot; the server chose the zone and the wait.
    const started = await start(POND_SPOT, "fish_start_1");
    expect(started.status).toBe(201);
    const action = ((await body(started)) as {
      data: { action: { actionId: string; spotId: string; status: string; secondsUntilReady: number; version: number; zone: { kind: string; zoneId: string } } };
    }).data.action;
    expect(action).toMatchObject({ spotId: POND_SPOT, status: "ACTIVE", secondsUntilReady: ACTION_SECONDS, version: 1 });
    expect(action.zone.kind).toBe("HOME_ISLAND");
    expect(action.zone.zoneId).toContain(FARM_ONE_ID);

    // 2. A second attempt while one is live is refused, and a replay of the start returns the same one.
    expect((await start(POND_SPOT, "fish_start_2")).status).toBe(409);
    const replayedStart = await start(POND_SPOT, "fish_start_1");
    expect(replayedStart.status).toBe(201);
    const replayedAction = ((await body(replayedStart)) as { data: { action: { actionId: string } } }).data.action;
    expect(replayedAction.actionId).toBe(action.actionId);

    // 3. Settling before the server's clock says so is refused, and writes nothing.
    const early = await settle(action.actionId, action.version, "fish_settle_early");
    expect(early.status).toBe(409);
    await expect(body(early)).resolves.toMatchObject({ ok: false, error: { code: "FISHING_NOT_READY" } });
    expect(held("item_fish_catfish")).toBe(0);
    expect(xp()).toBe(0);

    // 4. The active attempt survives a "refresh": the targeted read reports it.
    const active = await get("/fishing/active");
    expect(active.status).toBe(200);
    await expect(body(active)).resolves.toMatchObject({ data: { action: { actionId: action.actionId, status: "ACTIVE" } } });

    // 5. Advance the authoritative clock and settle: the server picks catfish (roll 0.9).
    clock.advanceSeconds(ACTION_SECONDS + 1);
    const settled = await settle(action.actionId, action.version, "fish_settle_1");
    expect(settled.status).toBe(200);
    const settledBody = await body(settled);
    const result = (settledBody as {
      data: { catch: { itemDefinitionId: string; quantity: number }; progression: { xpAwarded: number; leveledUp: boolean; progression: { level: number; xp: number } } };
    }).data;
    expect(result.catch).toEqual({ itemDefinitionId: "item_fish_catfish", quantity: 1 });
    expect(result.progression).toMatchObject({ xpAwarded: 3, leveledUp: false, progression: { level: 1, xp: 3 } });
    expect(held("item_fish_catfish")).toBe(1);
    expect(xp()).toBe(3);

    // 6. The replay is the same settlement, not a second fish.
    const replayedSettle = await settle(action.actionId, action.version, "fish_settle_1");
    expect(replayedSettle.status).toBe(200);
    expect(await body(replayedSettle)).toEqual(settledBody);
    expect(held("item_fish_catfish")).toBe(1);
    expect(xp()).toBe(3);

    // 7. No live attempt remains, and a settle or cancel of the finished action is refused.
    await expect(body(await get("/fishing/active"))).resolves.toMatchObject({ data: { action: null } });
    expect((await settle(action.actionId, action.version, "fish_settle_again")).status).toBe(409);
    expect((await cancel(action.actionId, action.version, "fish_cancel_after")).status).toBe(409);

    // 8. Sell the catch through the same market as produce.
    const sold = await post("/shop/sell", { requestId: "fish_sell_1", shopEntryId: "shop_fish_catfish", quantity: 1 });
    expect(sold.status).toBe(200);
    expect(balance()).toBe(6);
    expect(held("item_fish_catfish")).toBe(0);

    // 9. Fish again from the harbour: a different table, a different catch.
    const second = await start(HARBOUR_SPOT, "fish_start_3");
    expect(second.status).toBe(201);
    const secondAction = ((await body(second)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(ACTION_SECONDS + 1);
    const secondSettle = await settle(secondAction.actionId, secondAction.version, "fish_settle_3");
    expect(secondSettle.status).toBe(200);
    // The scripted roll 0.1 in the coastal table is a sardine.
    await expect(body(secondSettle)).resolves.toMatchObject({
      data: { catch: { itemDefinitionId: "item_fish_sardine", quantity: 1 } }
    });
    expect(held("item_fish_sardine")).toBe(1);

    // 10. Cancelling grants nothing and closes the action for good.
    const third = await start(POND_SPOT, "fish_start_4");
    const thirdAction = ((await body(third)) as { data: { action: { actionId: string; version: number } } }).data.action;
    const cancelled = await cancel(thirdAction.actionId, thirdAction.version, "fish_cancel_1");
    expect(cancelled.status).toBe(200);
    await expect(body(cancelled)).resolves.toEqual({ ok: true, data: { cancelled: true } });
    clock.advanceSeconds(ACTION_SECONDS + 1);
    const afterCancel = await settle(thirdAction.actionId, thirdAction.version, "fish_settle_after_cancel");
    expect(afterCancel.status).toBe(409);
    await expect(body(afterCancel)).resolves.toMatchObject({ ok: false, error: { code: "FISHING_ACTION_NOT_ACTIVE" } });
    expect(held("item_fish_tilapia")).toBe(0);
    expect(xp()).toBe(4);
  });

  it("settles exactly one of two concurrent attempts", async () => {
    await createFarm();
    const started = await start(POND_SPOT, "race_start");
    const action = ((await body(started)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(ACTION_SECONDS + 1);

    const [first, second] = await Promise.all([
      settle(action.actionId, action.version, "race_settle_a"),
      settle(action.actionId, action.version, "race_settle_b")
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(held("item_fish_catfish")).toBe(1);
    expect(xp()).toBe(3);

    const settledRows = db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM fishing_actions WHERE status = 'SETTLED'")
      .get() as { count: number };
    expect(settledRows.count).toBe(1);
  });

  it("refuses an unknown spot, a missing island, a wrong actor and malformed input", async () => {
    await createFarm();

    const unknownSpot = await start("spot_nowhere", "bad_spot");
    expect(unknownSpot.status).toBe(404);
    await expect(body(unknownSpot)).resolves.toMatchObject({ ok: false, error: { code: "FISHING_SPOT_NOT_FOUND" } });

    // A client cannot name a fish, a reward or a price: the schemas are strict.
    const smuggled = await post("/fishing/start", { requestId: "bad_smuggle", spotId: POND_SPOT, fishId: "fish_tuna" });
    expect(smuggled.status).toBe(400);
    const smuggledSettle = await post("/fishing/fishact_11111111-1111-4111-8111-111111111111/settle", {
      requestId: "bad_smuggle_settle",
      expectedActionVersion: 1,
      xp: 1000
    });
    expect(smuggledSettle.status).toBe(400);

    const malformed = await post("/fishing/start", "{not json");
    expect(malformed.status).toBe(400);

    const badActionId = await settle("not-an-action", 1, "bad_action_id");
    expect(badActionId.status).toBe(400);
    const missingAction = await settle("fishact_11111111-1111-4111-8111-999999999999", 1, "missing_action");
    expect(missingAction.status).toBe(404);

    auth.setActor(null);
    expect((await get("/fishing")).status).toBe(401);
    expect((await start(POND_SPOT, "unauthenticated")).status).toBe(401);
    expect((await settle("fishact_11111111-1111-4111-8111-111111111111", 1, "unauthenticated")).status).toBe(401);
  });

  it("refuses fishing for an actor who has no island yet", async () => {
    // No farm: the HOME_ISLAND zone cannot be resolved, so the spot is not this actor's to use.
    const response = await start(POND_SPOT, "no_island");
    expect(response.status).toBe(403);
    await expect(body(response)).resolves.toMatchObject({ ok: false, error: { code: "FISHING_ZONE_NOT_ALLOWED" } });
  });

  it("keeps every player's attempts and catches their own", async () => {
    await createFarm();
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Angler Two', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_TWO_ID, NOW, NOW);
    const started = await start(POND_SPOT, "own_start");
    const action = ((await body(started)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(ACTION_SECONDS + 1);

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const notMine = await settle(action.actionId, action.version, "not_mine");
    expect(notMine.status).toBe(404);
    expect((await get("/fishing/active")).status).toBe(200);
    await expect(body(await get("/fishing/active"))).resolves.toMatchObject({ data: { action: null } });

    auth.setActor({ playerId: PLAYER_ONE_ID });
    const mine = await settle(action.actionId, action.version, "settle_mine");
    expect(mine.status).toBe(200);
    expect(held("item_fish_catfish", PLAYER_TWO_ID)).toBe(0);
    expect(held("item_fish_catfish", PLAYER_ONE_ID)).toBe(1);
  });

  it("uses real entropy in production, not a fixed value", () => {
    const random = new CryptoFishingRandom();
    const rolls = Array.from({ length: 64 }, () => random.roll());
    for (const roll of rolls) {
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });
});
