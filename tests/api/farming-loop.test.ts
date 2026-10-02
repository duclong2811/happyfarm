import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  gameDataTileTerrain
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

const MIGRATIONS = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql",
  "0009_starter_package.sql",
  "0010_farm_constructions.sql",
  "0011_construction_editing.sql",
  "0012_world_objects.sql",
  "0013_world_objects_v2.sql",
  "0014_one_farm_per_player.sql",
  "0015_player_identities.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

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
});
