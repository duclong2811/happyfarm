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
import { createHandler } from "../../workers/api/src/handler";
import { schemaSql } from "../support/migrations";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
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
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The first complete economy loop, through the real API.
 *
 * Gold buys a seed, the seed goes in the ground, time passes, the harvest comes back into the
 * inventory, and the produce turns back into gold. Every step is a request a browser makes and a
 * settlement the server performs: there is no test-only shortcut into the database, and the clock is
 * the server's own - so this is the loop a player plays, not a model of one.
 *
 * The numbers come from the shipped catalogue, and the loop is positive on purpose: a carrot seed costs
 * 2 gold and a carrot sells for 2, and one planting yields two carrots.
 */

const MIGRATIONS = schemaSql();

const STARTING_GOLD = 100;
const SEED_PRICE = 2;
const CARROT_PRICE = 2;
const CARROTS_PER_PLANTING = 2;
const GROWTH_SECONDS = 300;

/** A clock the test can move, because "wait five minutes" is not a test. */
class MutableClock implements Clock {
  private current = NOW;
  now(): string {
    return this.current;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(Date.parse(this.current) + seconds * 1000).toISOString();
  }
}

class FixedAuth implements AuthenticationPort<Request> {
  constructor(private readonly actor: ActorContext | null) {}
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

/** Ids the loop can predict: one farm, one crop, and counters for everything else. */
class LoopIds implements IdGenerator {
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
}

describe("the first complete farm economy loop", () => {
  let db: NodeD1Database;
  let clock: MutableClock;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    clock = new MutableClock();
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, "https://identity.test", "subject-one", "Farmer One", NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, STARTING_GOLD, NOW, NOW);
    handle = createHandler({
      db,
      authenticator: new FixedAuth({ playerId: PLAYER_ONE_ID }),
      ids: new LoopIds(),
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
      clock
    });
  });

  afterEach(() => {
    db.close();
  });

  function post(path: string, body: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    );
  }

  function balance(): number {
    const row = db.sqlite
      .prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'")
      .get(PLAYER_ONE_ID) as { balance: number };
    return row.balance;
  }

  function held(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, itemDefinitionId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  /** The first soil tile the server reports, as the client reads it before planting. */
  async function soilTile(): Promise<{ readonly x: number; readonly y: number; readonly version: number }> {
    const body: unknown = await (
      await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`))
    ).json();
    const response = body as {
      readonly data: {
        readonly tiles: readonly {
          readonly x: number;
          readonly y: number;
          readonly version: number;
          readonly terrainType: string;
        }[];
      };
    };
    const tile = response.data.tiles.find((row) => row.terrainType === "SOIL");
    if (tile === undefined) throw new Error("the farm has no soil tile");
    return { x: tile.x, y: tile.y, version: tile.version };
  }

  it("buys a seed, plants it, grows it, harvests it, sells the produce, and can pay for the next seed", async () => {
    // 1. The farm exists: a retry-safe create, exactly what the client does at boot.
    const created = await post("/farms", { name: "Starter Farm" });
    expect(created.status).toBe(201);

    // 2. Gold buys seeds, at the catalogue's own price.
    const bought = await post("/shop/buy", {
      requestId: "loop_buy_seeds_1",
      shopEntryId: "shop_carrot_seed",
      quantity: 5
    });
    expect(bought.status).toBe(200);
    await expect(bought.json()).resolves.toMatchObject({
      ok: true,
      data: {
        settlement: {
          itemDefinitionId: "item_carrot_seed",
          quantity: 5,
          amountSpent: SEED_PRICE * 5,
          newBalance: STARTING_GOLD - SEED_PRICE * 5
        }
      }
    });
    expect(balance()).toBe(STARTING_GOLD - SEED_PRICE * 5);
    expect(held("item_carrot_seed")).toBe(5);

    // 3. Plant one of them on the farm's own soil, at the revision the server reported.
    const tilesResponse: unknown = await (
      await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`))
    ).json();
    const tiles = tilesResponse as {
      readonly data: {
        readonly tiles: readonly {
          readonly x: number;
          readonly y: number;
          readonly version: number;
          readonly terrainType: string;
        }[];
      };
    };
    const tile = tiles.data.tiles.find((row) => row.terrainType === "SOIL");
    expect(tile).toBeDefined();
    const planted = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "loop_plant_1",
      cropDefinitionId: "crop_carrot",
      x: tile?.x,
      y: tile?.y,
      expectedTileVersion: tile?.version
    });
    expect(planted.status).toBe(201);
    const cropResponse: unknown = await planted.json();
    const crop = cropResponse as {
      readonly data: {
        readonly crop: { readonly cropInstanceId: string; readonly version: number; readonly mature: boolean };
      };
    };
    expect(crop.data.crop.mature).toBe(false);
    expect(held("item_carrot_seed")).toBe(4);

    // 4. The server's clock decides maturity; nothing waits in real time.
    clock.advanceSeconds(GROWTH_SECONDS + 5);
    const grownResponse: unknown = await (
      await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`))
    ).json();
    const grown = grownResponse as {
      readonly data: {
        readonly crops: readonly {
          readonly cropInstanceId: string;
          readonly mature: boolean;
          readonly version: number;
        }[];
      };
    };
    const ripe = grown.data.crops.find((row) => row.cropInstanceId === crop.data.crop.cropInstanceId);
    expect(ripe?.mature).toBe(true);

    // 5. Harvest: the produce lands in the inventory and the numbers are the settlement's own.
    const harvested = await post(`/farms/${FARM_ONE_ID}/crops/${String(ripe?.cropInstanceId)}/harvest`, {
      requestId: "loop_harvest_1",
      expectedCropVersion: ripe?.version
    });
    expect(harvested.status).toBe(200);
    await expect(harvested.json()).resolves.toMatchObject({
      ok: true,
      data: { harvest: { itemDefinitionId: "item_carrot", quantityAdded: CARROTS_PER_PLANTING } }
    });
    expect(held("item_carrot")).toBe(CARROTS_PER_PLANTING);

    // 6. Sell the produce: the goods leave, the gold arrives.
    const sold = await post("/shop/sell", {
      requestId: "loop_sell_1",
      shopEntryId: "shop_carrot",
      quantity: CARROTS_PER_PLANTING
    });
    expect(sold.status).toBe(200);
    const expectedGold = STARTING_GOLD - SEED_PRICE * 5 + CARROT_PRICE * CARROTS_PER_PLANTING;
    await expect(sold.json()).resolves.toMatchObject({
      ok: true,
      data: {
        settlement: {
          itemDefinitionId: "item_carrot",
          quantity: CARROTS_PER_PLANTING,
          amountReceived: CARROT_PRICE * CARROTS_PER_PLANTING,
          newBalance: expectedGold
        }
      }
    });
    expect(balance()).toBe(expectedGold);
    expect(held("item_carrot")).toBe(0);

    // 7. The loop is positive: the seed paid for itself and left change, so the farm can plant again
    //    without ever being handed gold.
    expect(expectedGold).toBeGreaterThan(STARTING_GOLD - SEED_PRICE * 5);

    // And every movement was recorded, with the reasons the ledger's own readers expect.
    const rows = db.sqlite
      .prepare("SELECT reason FROM economy_ledger WHERE player_id = ? ORDER BY rowid")
      .all(PLAYER_ONE_ID);
    const reasons = rows.map((row) => String(row.reason));
    expect(reasons).toContain("SHOP_BUY");
    expect(reasons).toContain("SHOP_SELL");
  });

  it("refuses to skip the loop: produce cannot be bought and seeds cannot be sold", async () => {
    await post("/farms", { name: "Starter Farm" });
    expect(
      (await post("/shop/buy", { requestId: "loop_skip_1", shopEntryId: "shop_carrot", quantity: 1 })).status
    ).toBe(400);
    expect(
      (await post("/shop/sell", { requestId: "loop_skip_2", shopEntryId: "shop_carrot_seed", quantity: 1 })).status
    ).toBe(400);
    // Nothing moved: no gold, no items.
    expect(balance()).toBe(STARTING_GOLD);
    expect(held("item_carrot")).toBe(0);
  });

  it("harvests two ready carrots through the bounded area endpoint and replays safely", async () => {
    await post("/farms", { name: "Starter Farm" });
    await post("/shop/buy", { requestId: "area_buy_seeds", shopEntryId: "shop_carrot_seed", quantity: 2 });
    const tilesBody: { readonly data: { readonly tiles: readonly { readonly x: number; readonly y: number; readonly version: number; readonly terrainType: string }[] } } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`))).json();
    const soil = tilesBody.data.tiles.filter((tile) => tile.terrainType === "SOIL").slice(0, 2);
    expect(soil).toHaveLength(2);
    for (const [index, tile] of soil.entries()) {
      expect((await post(`/farms/${FARM_ONE_ID}/crops`, {
        requestId: `area_plant_${String(index)}`,
        cropDefinitionId: "crop_carrot",
        x: tile.x,
        y: tile.y,
        expectedTileVersion: tile.version
      })).status).toBe(201);
    }
    clock.advanceSeconds(GROWTH_SECONDS + 1);
    const grown: { readonly data: { readonly crops: readonly { readonly cropInstanceId: string; readonly version: number }[] } } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`))).json();
    const crops = grown.data.crops;
    expect(crops).toHaveLength(2);
    const payload = {
      requestId: "area_harvest_001",
      crops: crops.map((crop) => ({ cropInstanceId: crop.cropInstanceId, expectedCropVersion: crop.version }))
    };
    const first = await post(`/farms/${FARM_ONE_ID}/crops/harvest-area`, payload);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true, data: { harvestedCount: 2, skippedCount: 0 } });
    const replay = await post(`/farms/${FARM_ONE_ID}/crops/harvest-area`, payload);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, data: { harvestedCount: 2, skippedCount: 0 } });
    expect(held("item_carrot")).toBe(4);
    const after: { readonly data: { readonly crops: readonly unknown[] } } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`))).json();
    expect(after.data.crops).toEqual([]);
  });

  it("plants a crop area through the real API, debits each seed once, and replays safely", async () => {
    await post("/farms", { name: "Starter Farm" });
    await post("/shop/buy", { requestId: "plant_area_buy_seeds", shopEntryId: "shop_carrot_seed", quantity: 2 });
    const tilesBody: { readonly data: { readonly tiles: readonly { readonly x: number; readonly y: number; readonly version: number; readonly terrainType: string }[] } } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`))).json();
    const soil = tilesBody.data.tiles.filter((tile) => tile.terrainType === "SOIL").slice(0, 2);
    expect(soil).toHaveLength(2);
    const payload = {
      requestId: "plant_area_001",
      cropDefinitionId: "crop_carrot",
      cells: soil.map((tile) => ({ x: tile.x, y: tile.y, expectedTileVersion: tile.version }))
    };
    const first = await post(`/farms/${FARM_ONE_ID}/crops/plant-area`, payload);
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({ ok: true, data: { plantedCount: 2, skippedCount: 0 } });
    const replay = await post(`/farms/${FARM_ONE_ID}/crops/plant-area`, payload);
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, data: { plantedCount: 2, skippedCount: 0 } });
    expect(held("item_carrot_seed")).toBe(0);
    const crops: { readonly data: { readonly crops: readonly unknown[] } } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`))).json();
    expect(crops.data.crops).toHaveLength(2);
  });

  it("plants tree area groups through real HTTP/D1, reports an insufficient-sapling partial, and retries a lost second response safely", async () => {
    await post("/farms", { name: "Starter Farm" });
    // Wildwood is the level-one sapling used by the local planting loop. Buying 26 for 27 cells
    // deliberately makes the second bounded group partial without letting the test invent a
    // client-side quantity or bypass the shop settlement.
    const bought = await post("/shop/buy", {
      requestId: "tree_area_buy_saplings",
      shopEntryId: "shop_wildwood_sapling",
      quantity: 26
    });
    expect(bought.status).toBe(200);
    expect(held("item_wildwood_sapling")).toBe(26);

    const tilesBody: {
      readonly data: {
        readonly tiles: readonly {
          readonly x: number;
          readonly y: number;
          readonly version: number;
          readonly terrainType: string;
        }[];
      };
    } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`))).json();
    const soil = tilesBody.data.tiles.filter((tile) => tile.terrainType === "SOIL").slice(0, 27);
    expect(soil).toHaveLength(27);

    const firstCells = soil.slice(0, 25).map((tile) => ({
      x: tile.x,
      y: tile.y,
      expectedTileVersion: tile.version
    }));
    const secondCells = soil.slice(25).map((tile) => ({
      x: tile.x,
      y: tile.y,
      expectedTileVersion: tile.version
    }));
    const firstPayload = {
      requestId: "tree_area_group_001",
      treeDefinitionId: "tree_wildwood",
      cells: firstCells
    };
    const secondPayload = {
      requestId: "tree_area_group_002",
      treeDefinitionId: "tree_wildwood",
      cells: secondCells
    };

    const first = await post(`/farms/${FARM_ONE_ID}/trees/plant-area`, firstPayload);
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      data: { plantedCount: 25, skippedCount: 0 }
    });
    expect(held("item_wildwood_sapling")).toBe(1);

    // The first response of group two is intentionally discarded, representing a lost network
    // response after the D1 transaction committed. The retry must return the stored group receipt,
    // not create another tree or debit the remaining sapling again.
    const lostResponse = await post(`/farms/${FARM_ONE_ID}/trees/plant-area`, secondPayload);
    expect(lostResponse.status).toBe(201);
    const retry = await post(`/farms/${FARM_ONE_ID}/trees/plant-area`, secondPayload);
    expect(retry.status).toBe(201);
    const retryBody: {
      readonly ok: boolean;
      readonly data: {
        readonly plantedCount: number;
        readonly skippedCount: number;
        readonly results: readonly { readonly status: string; readonly reason: string | null }[];
      };
    } = await retry.json();
    expect(retryBody).toMatchObject({
      ok: true,
      data: { plantedCount: 1, skippedCount: 1 }
    });
    expect(retryBody.data.results.some((result) => result.status === "SKIPPED" && result.reason === "NO_SEEDS")).toBe(true);
    expect(held("item_wildwood_sapling")).toBe(0);

    const treeBody: {
      readonly data: { readonly trees: readonly unknown[] };
    } = await (await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/trees`))).json();
    expect(treeBody.data.trees).toHaveLength(26);

    // Replay of the already completed first group also remains a no-op after group two, proving
    // that a client retry cannot duplicate an earlier group while a later group is partial.
    const firstReplay = await post(`/farms/${FARM_ONE_ID}/trees/plant-area`, firstPayload);
    expect(firstReplay.status).toBe(201);
    await expect(firstReplay.json()).resolves.toMatchObject({
      ok: true,
      data: { plantedCount: 25, skippedCount: 0 }
    });
    expect(held("item_wildwood_sapling")).toBe(0);
  });

  it("turns harvested crops into experience, a level, and the next crop's unlock", async () => {
    await post("/farms", { name: "Starter Farm" });

    // The catalogue's own numbers: a carrot pays 4 experience, so level 2 (120) is thirty harvests.
    const CARROT_XP = 4;
    const LEVEL_TWO_XP = 120;
    const harvests = LEVEL_TWO_XP / CARROT_XP;

    // A player opens at level 1 with no experience: reads are side-effect free.
    const startBody: unknown = await (await handle(new Request("https://api.test/progression"))).json();
    const start = startBody as {
      readonly data: { readonly progression: { readonly level: number; readonly xp: number } };
    };
    expect(start.data.progression).toMatchObject({ level: 1, xp: 0 });

    // Gold buys seeds ahead of the level that plants them. The market has no purchase gate; only the
    // planting gate does, which is exactly the rule the next assertion proves.
    expect(
      (
        await post("/shop/buy", {
          requestId: "progress_buy_carrot",
          shopEntryId: "shop_carrot_seed",
          quantity: harvests
        })
      ).status
    ).toBe(200);
    expect(
      (
        await post("/shop/buy", {
          requestId: "progress_buy_wheat",
          shopEntryId: "shop_wheat_seed",
          quantity: 1
        })
      ).status
    ).toBe(200);
    expect(held("item_wheat_seed")).toBe(1);

    const tile = await soilTile();
    const refusedWheat = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "progress_plant_wheat_locked",
      cropDefinitionId: "crop_wheat",
      x: tile.x,
      y: tile.y,
      expectedTileVersion: tile.version
    });
    expect(refusedWheat.status).toBe(403);
    await expect(refusedWheat.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "CROP_LEVEL_REQUIRED" }
    });
    // The refusal wrote nothing: the seed the player owns is still owned and unplanted.
    expect(held("item_wheat_seed")).toBe(1);

    // Harvest carrots until the threshold. A crop's planting does not move the tile's revision, so
    // one read serves every cycle; each plant still spends exactly one seed.
    const awards: { readonly leveledUp: boolean; readonly level: number; readonly xp: number }[] = [];
    for (let cycle = 0; cycle < harvests; cycle += 1) {
      const planted = await post(`/farms/${FARM_ONE_ID}/crops`, {
        requestId: `progress_plant_${String(cycle)}`,
        cropDefinitionId: "crop_carrot",
        x: tile.x,
        y: tile.y,
        expectedTileVersion: tile.version
      });
      expect(planted.status).toBe(201);
      const plantedBody: unknown = await planted.json();
      const crop = (
        plantedBody as {
          readonly data: {
            readonly crop: { readonly cropInstanceId: string; readonly version: number };
          };
        }
      ).data.crop;

      clock.advanceSeconds(GROWTH_SECONDS + 5);
      const harvested = await post(`/farms/${FARM_ONE_ID}/crops/${crop.cropInstanceId}/harvest`, {
        requestId: `progress_harvest_${String(cycle)}`,
        expectedCropVersion: crop.version
      });
      expect(harvested.status).toBe(200);
      const harvestedBody: unknown = await harvested.json();
      const award = (
        harvestedBody as {
          readonly data: {
            readonly progression: {
              readonly leveledUp: boolean;
              readonly progression: { readonly level: number; readonly xp: number };
            };
          };
        }
      ).data.progression;
      awards.push({
        leveledUp: award.leveledUp,
        level: award.progression.level,
        xp: award.progression.xp
      });
    }

    // The threshold is exact: the harvest one below it is still level 1, and the harvest that reaches
    // it is level 2. The page never sees a level the award and the read disagree about.
    expect(awards[harvests - 2]).toMatchObject({
      leveledUp: false,
      level: 1,
      xp: LEVEL_TWO_XP - CARROT_XP
    });
    expect(awards[harvests - 1]).toMatchObject({ leveledUp: true, level: 2, xp: LEVEL_TWO_XP });
    expect(held("item_carrot")).toBe(CARROTS_PER_PLANTING * harvests);

    // The read route reports the level the harvest paid, with no client input and no recalculation.
    const reachedBody: unknown = await (await handle(new Request("https://api.test/progression"))).json();
    const reached = reachedBody as {
      readonly data: {
        readonly progression: {
          readonly level: number;
          readonly xp: number;
          readonly xpForNextLevel: number;
        };
      };
    };
    expect(reached.data.progression).toMatchObject({
      level: 2,
      xp: LEVEL_TWO_XP,
      xpForNextLevel: 240
    });

    // The crop that was locked one level ago now plants, with the same seed the shop sold ahead of time.
    const wheat = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "progress_plant_wheat_unlocked",
      cropDefinitionId: "crop_wheat",
      x: tile.x,
      y: tile.y,
      expectedTileVersion: tile.version
    });
    expect(wheat.status).toBe(201);
    expect(held("item_wheat_seed")).toBe(0);

    // Selling the carrots turns the whole loop positive, exactly as the economy-only loop does.
    const sold = await post("/shop/sell", {
      requestId: "progress_sell_carrot",
      shopEntryId: "shop_carrot",
      quantity: CARROTS_PER_PLANTING * harvests
    });
    expect(sold.status).toBe(200);
    const expectedGold =
      STARTING_GOLD - SEED_PRICE * harvests - 3 + CARROT_PRICE * CARROTS_PER_PLANTING * harvests;
    expect(balance()).toBe(expectedGold);
    expect(balance()).toBeGreaterThan(STARTING_GOLD);
  });
});
