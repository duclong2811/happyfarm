import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  cumulativeXpForLevel,
  levelForXp,
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
 * One early farming journey, through the real API.
 *
 * A brand-new player plants a carrot, sells it, crosses a level, unlocks wheat, then the orchard,
 * and harvests a repeating tree cycle twice - every mutation is a request the browser makes and a
 * settlement the server performs. Where the journey would otherwise grind through a thousand
 * harvests (level 9 is 4,320 experience), it moves the player's own progression row and continues
 * through the real endpoints; no test-only shortcut reaches a settlement.
 *
 * The point is the *seams*: the exact threshold, the plant that is refused before a level and
 * accepted after it, the buy-ahead rule, a tree that repeats, and a replayed cycle that pays once.
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

const CARROT = { seed: "item_carrot_seed", produce: "item_carrot", growthSeconds: 300, xp: 4, yield: 2 };
const WHEAT = { seed: "item_wheat_seed", produce: "item_wheat", growthSeconds: 900, xp: 12, yield: 3 };
const APPLE = { sapling: "item_apple_sapling", fruit: "item_apple", firstReadySeconds: 3600, regrowSeconds: 900, xp: 9, yield: 3 };
const ORANGE = { sapling: "item_orange_sapling", fruit: "item_orange", firstReadySeconds: 5400, regrowSeconds: 1200, xp: 12, yield: 3 };
const PEACH = { sapling: "item_peach_sapling" };

const STARTING_GOLD = 400;
const STARTER_CARROT_SEEDS = 10;

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

class JourneyIds implements IdGenerator {
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

describe("an early farming journey", () => {
  let db: NodeD1Database;
  let clock: MutableClock;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    clock = new MutableClock();
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Farmer One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, STARTING_GOLD, NOW, NOW);
    // The starter package's seeds, handed in directly: onboarding is not what this journey tests.
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot_seed', ?, ?, 1)"
      )
      .run(PLAYER_ONE_ID, STARTER_CARROT_SEEDS, NOW);
    handle = createHandler({
      db,
      authenticator: new FixedAuth({ playerId: PLAYER_ONE_ID }),
      ids: new JourneyIds(),
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

  function get(path: string): Promise<Response> {
    return handle(new Request(`https://api.test${path}`));
  }

  /** A response body as `unknown`, so the caller's cast is a real narrowing rather than a no-op. */
  async function bodyOf(response: Response): Promise<unknown> {
    const value: unknown = await response.json();
    return value;
  }

  function held(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, itemDefinitionId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function balance(): number {
    const row = db.sqlite
      .prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'")
      .get(PLAYER_ONE_ID) as { balance: number };
    return row.balance;
  }

  /**
   * Moves the player's own progression row.
   *
   * The row is the server's authoritative state, so writing it is exactly the state a long grind
   * would have produced; the journey then continues through the real endpoints. The level is derived
   * from the experience with the shipped curve, so the two can never disagree.
   */
  function setXp(xp: number): void {
    db.sqlite.prepare("DELETE FROM player_progression WHERE player_id = ?").run(PLAYER_ONE_ID);
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, levelForXp(gameDataProgressionDefinition, xp), xp, NOW, NOW);
  }

  async function progression(): Promise<{ level: number; xp: number; xpIntoLevel: number }> {
    const body = (await bodyOf(await get("/progression"))) as {
      data: { progression: { level: number; xp: number; xpIntoLevel: number } };
    };
    return body.data.progression;
  }

  async function tiles(): Promise<
    readonly { x: number; y: number; version: number; terrainType: string }[]
  > {
    const body = (await bodyOf(await get(`/farms/${FARM_ONE_ID}/tiles`))) as {
      data: { tiles: readonly { x: number; y: number; version: number; terrainType: string }[] };
    };
    return body.data.tiles;
  }

  async function tile(x: number, y: number): Promise<{ x: number; y: number; version: number }> {
    const found = (await tiles()).find((row) => row.x === x && row.y === y && row.terrainType === "SOIL");
    if (found === undefined) throw new Error(`no soil tile at ${String(x)},${String(y)}`);
    return { x: found.x, y: found.y, version: found.version };
  }

  async function plantCrop(definitionId: string, at: { x: number; y: number; version: number }, requestId: string) {
    return post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId,
      cropDefinitionId: definitionId,
      x: at.x,
      y: at.y,
      expectedTileVersion: at.version
    });
  }

  async function harvestCrop(cropInstanceId: string, version: number, requestId: string) {
    return post(`/farms/${FARM_ONE_ID}/crops/${cropInstanceId}/harvest`, {
      requestId,
      expectedCropVersion: version
    });
  }

  async function plantTree(definitionId: string, at: { x: number; y: number; version: number }, requestId: string) {
    return post(`/farms/${FARM_ONE_ID}/trees`, {
      requestId,
      treeDefinitionId: definitionId,
      x: at.x,
      y: at.y,
      expectedTileVersion: at.version
    });
  }

  /** Plants, grows, harvests, and returns the settlement - the shape every crop step has. */
  async function growAndHarvestCrop(
    definitionId: string,
    at: { x: number; y: number; version: number },
    growthSeconds: number,
    step: string
  ) {
    const planted = await plantCrop(definitionId, at, `journey_plant_${step}`);
    const plantedBody = await bodyOf(planted.clone());
    expect(planted.status, `plant ${definitionId}: ${JSON.stringify(plantedBody)}`).toBe(201);
    const crop = (plantedBody as { data: { crop: { cropInstanceId: string; version: number } } }).data.crop;
    clock.advanceSeconds(growthSeconds + 5);
    const harvested = await harvestCrop(crop.cropInstanceId, crop.version, `journey_harvest_${step}`);
    expect(harvested.status, `harvest ${definitionId}`).toBe(200);
    return (await bodyOf(harvested)) as {
      data: {
        harvest: { itemDefinitionId: string; quantityAdded: number };
        progression: { xpAwarded: number; leveledUp: boolean; progression: { level: number; xp: number } };
      };
    };
  }

  it("plants, sells, levels, unlocks wheat and the orchard, and repeats a tree cycle", async () => {
    const created = await post("/farms", { name: "Journey Farm" });
    expect(created.status).toBe(201);
    const at = await tile(0, 0);

    // 1. A brand-new player: level 1, no experience, the starter seeds in hand.
    expect(await progression()).toMatchObject({ level: 1, xp: 0 });
    expect(held(CARROT.seed)).toBe(STARTER_CARROT_SEEDS);

    // 2. The market sells ahead of the planting level: wheat seed can be bought now...
    expect(
      (await post("/shop/buy", { requestId: "journey_buy_wheat", shopEntryId: "shop_wheat_seed", quantity: 1 })).status
    ).toBe(200);
    expect(held(WHEAT.seed)).toBe(1);
    // ...but planting it is refused until level 2, and the refusal writes nothing.
    const lockedWheat = await plantCrop("crop_wheat", at, "journey_plant_wheat_locked");
    expect(lockedWheat.status).toBe(403);
    await expect(lockedWheat.json()).resolves.toMatchObject({ ok: false, error: { code: "CROP_LEVEL_REQUIRED" } });
    expect(held(WHEAT.seed)).toBe(1);

    // 3. The starter loop: plant, grow, harvest, sell.
    const firstCarrot = await growAndHarvestCrop("crop_carrot", at, CARROT.growthSeconds, "carrot_1");
    expect(firstCarrot.data.harvest).toMatchObject({ itemDefinitionId: CARROT.produce, quantityAdded: CARROT.yield });
    expect(firstCarrot.data.progression).toMatchObject({ xpAwarded: CARROT.xp, leveledUp: false });
    expect(await progression()).toMatchObject({ level: 1, xp: CARROT.xp });
    const goldBeforeSelling = balance();
    expect(
      (await post("/shop/sell", { requestId: "journey_sell_carrot", shopEntryId: "shop_carrot", quantity: CARROT.yield })).status
    ).toBe(200);
    expect(balance()).toBe(goldBeforeSelling + CARROT.yield * 2);
    expect(held(CARROT.produce)).toBe(0);

    // 4. The exact threshold: the harvest that reaches 120 experience is level 2.
    setXp(120 - CARROT.xp);
    const crossing = await growAndHarvestCrop("crop_carrot", at, CARROT.growthSeconds, "carrot_2");
    expect(crossing.data.progression).toMatchObject({
      leveledUp: true,
      progression: { level: 2, xp: 120 }
    });
    expect(await progression()).toMatchObject({ level: 2, xp: 120, xpIntoLevel: 0 });

    // 5. Wheat, planted with the seed bought a level ago.
    const wheat = await growAndHarvestCrop("crop_wheat", at, WHEAT.growthSeconds, "wheat_1");
    expect(wheat.data.harvest).toMatchObject({ itemDefinitionId: WHEAT.produce, quantityAdded: WHEAT.yield });
    expect(wheat.data.progression).toMatchObject({ xpAwarded: WHEAT.xp, leveledUp: false });
    expect(await progression()).toMatchObject({ level: 2, xp: 120 + WHEAT.xp });

    // 6. The first orchard tree is level 3, so a level-2 player can buy the sapling but not plant it.
    expect(
      (await post("/shop/buy", { requestId: "journey_buy_apple", shopEntryId: "shop_apple_sapling", quantity: 1 })).status
    ).toBe(200);
    const treeTile = await tile(1, 0);
    const lockedApple = await plantTree("tree_apple", treeTile, "journey_plant_apple_locked");
    expect(lockedApple.status).toBe(403);
    await expect(lockedApple.json()).resolves.toMatchObject({ ok: false, error: { code: "TREE_LEVEL_REQUIRED" } });
    expect(held(APPLE.sapling)).toBe(1);

    // 7. Cross level 3 exactly, then plant the sapling. The tile stays free until it is planted.
    expect(
      (await post("/shop/buy", { requestId: "journey_buy_wheat_2", shopEntryId: "shop_wheat_seed", quantity: 1 })).status
    ).toBe(200);
    setXp(cumulativeXpForLevel(gameDataProgressionDefinition, 3) - WHEAT.xp);
    const levelThree = await growAndHarvestCrop("crop_wheat", at, WHEAT.growthSeconds, "wheat_2");
    expect(levelThree.data.progression).toMatchObject({
      leveledUp: true,
      progression: { level: 3, xp: cumulativeXpForLevel(gameDataProgressionDefinition, 3) }
    });

    const plantedApple = await plantTree("tree_apple", treeTile, "journey_plant_apple");
    expect(plantedApple.status).toBe(201);
    const appleTree = ((await bodyOf(plantedApple)) as { data: { tree: { treeInstanceId: string; version: number; ready: boolean } } })
      .data.tree;
    expect(appleTree.ready).toBe(false);
    expect(held(APPLE.sapling)).toBe(0);

    // 8. A tree is not a crop: it matures once, then repeats. Two cycles pay two harvests, and a
    //    replay of the second pays nothing more.
    clock.advanceSeconds(APPLE.firstReadySeconds + 5);
    const settledTree = (
      (await bodyOf(await get(`/farms/${FARM_ONE_ID}/trees`))) as {
        data: { trees: readonly { treeInstanceId: string; ready: boolean; version: number }[] };
      }
    ).data.trees.find((row) => row.treeInstanceId === appleTree.treeInstanceId);
    expect(settledTree?.ready).toBe(true);

    const firstCycle = await post(`/farms/${FARM_ONE_ID}/trees/${appleTree.treeInstanceId}/harvest`, {
      requestId: "journey_apple_cycle_1",
      expectedTreeVersion: settledTree?.version
    });
    expect(firstCycle.status).toBe(200);
    const firstCycleBody = (await bodyOf(firstCycle)) as {
      data: { harvest: { itemDefinitionId: string; quantityAdded: number }; progression: { xpAwarded: number } };
    };
    expect(firstCycleBody.data.harvest).toMatchObject({ itemDefinitionId: APPLE.fruit, quantityAdded: APPLE.yield });
    expect(firstCycleBody.data.progression.xpAwarded).toBe(APPLE.xp);

    clock.advanceSeconds(APPLE.regrowSeconds + 5);
    const regrown = (
      (await bodyOf(await get(`/farms/${FARM_ONE_ID}/trees`))) as {
        data: { trees: readonly { treeInstanceId: string; ready: boolean; version: number; phase: string }[] };
      }
    ).data.trees.find((row) => row.treeInstanceId === appleTree.treeInstanceId);
    expect(regrown?.ready).toBe(true);
    const secondCycle = await post(`/farms/${FARM_ONE_ID}/trees/${appleTree.treeInstanceId}/harvest`, {
      requestId: "journey_apple_cycle_2",
      expectedTreeVersion: regrown?.version
    });
    expect(secondCycle.status).toBe(200);
    const secondCycleBody = (await bodyOf(secondCycle)) as {
      data: { harvest: { quantityAdded: number } };
    };
    expect(held(APPLE.fruit)).toBe(APPLE.yield * 2);
    expect(secondCycleBody.data.harvest.quantityAdded).toBe(APPLE.yield);

    // The same request replayed is the same settlement, not a third harvest.
    const replay = await post(`/farms/${FARM_ONE_ID}/trees/${appleTree.treeInstanceId}/harvest`, {
      requestId: "journey_apple_cycle_2",
      expectedTreeVersion: regrown?.version
    });
    expect(replay.status).toBe(200);
    expect(held(APPLE.fruit)).toBe(APPLE.yield * 2);

    // 9. The second species shares the same lifecycle. Orange needs level 5; peach needs level 9.
    const orangeTile = await tile(2, 0);
    const peachTile = await tile(3, 0);
    expect(
      (await post("/shop/buy", { requestId: "journey_buy_orange", shopEntryId: "shop_orange_sapling", quantity: 1 })).status
    ).toBe(200);
    expect(
      (await post("/shop/buy", { requestId: "journey_buy_peach", shopEntryId: "shop_peach_sapling", quantity: 1 })).status
    ).toBe(200);
    setXp(cumulativeXpForLevel(gameDataProgressionDefinition, 5));
    const plantedOrange = await plantTree("tree_orange", orangeTile, "journey_plant_orange");
    expect(plantedOrange.status).toBe(201);
    const orangeTree = ((await bodyOf(plantedOrange)) as { data: { tree: { treeInstanceId: string } } }).data.tree;
    clock.advanceSeconds(ORANGE.firstReadySeconds + 5);
    const orangeCycle = await post(`/farms/${FARM_ONE_ID}/trees/${orangeTree.treeInstanceId}/harvest`, {
      requestId: "journey_orange_cycle_1",
      expectedTreeVersion: 1
    });
    expect(orangeCycle.status).toBe(200);
    await expect(orangeCycle.json()).resolves.toMatchObject({
      data: { harvest: { itemDefinitionId: ORANGE.fruit, quantityAdded: ORANGE.yield } }
    });
    expect(held(ORANGE.fruit)).toBe(ORANGE.yield);
    // Peach is still locked at level 5...
    expect((await plantTree("tree_peach", peachTile, "journey_plant_peach_locked")).status).toBe(403);
    // ...and plants once the level arrives.
    setXp(cumulativeXpForLevel(gameDataProgressionDefinition, 9));
    expect((await plantTree("tree_peach", peachTile, "journey_plant_peach")).status).toBe(201);
    expect(held(PEACH.sapling)).toBe(0);

    // 10. The new content reaches the client through the catalogues, not a compiled-in list.
    const cropCatalogue = (await bodyOf(await get("/crop-definitions"))) as {
      data: { definitions: readonly { cropDefinitionId: string; requiredLevel: number; harvestXp: number }[] };
    };
    const pumpkin = cropCatalogue.data.definitions.find((row) => row.cropDefinitionId === "crop_pumpkin");
    expect(pumpkin).toMatchObject({ requiredLevel: 8, harvestXp: 72 });
    expect(cropCatalogue.data.definitions.map((row) => row.cropDefinitionId)).toEqual([
      "crop_carrot",
      "crop_wheat",
      "crop_corn",
      "crop_potato",
      "crop_tomato",
      "crop_strawberry",
      "crop_cabbage",
      "crop_pumpkin"
    ]);

    const treeCatalogue = (await bodyOf(await get("/tree-definitions"))) as {
      data: { definitions: readonly { treeDefinitionId: string; requiredLevel: number; harvestXp: number }[] };
    };
    expect(treeCatalogue.data.definitions).toEqual([
      expect.objectContaining({ treeDefinitionId: "tree_apple", requiredLevel: 3, harvestXp: 9 }),
      expect.objectContaining({ treeDefinitionId: "tree_orange", requiredLevel: 5, harvestXp: 12 }),
      expect.objectContaining({ treeDefinitionId: "tree_peach", requiredLevel: 9, harvestXp: 15 })
    ]);

    const shop = (await bodyOf(await get("/shop"))) as {
      data: { entries: readonly { itemDefinitionId: string; buyPrice: number | null; sellPrice: number | null }[] };
    };
    for (const item of ["item_potato_seed", "item_pumpkin_seed", "item_orange_sapling", "item_peach_sapling"]) {
      expect(shop.data.entries.find((row) => row.itemDefinitionId === item)?.buyPrice, item).toBeGreaterThan(0);
    }
    for (const item of ["item_potato", "item_pumpkin", "item_orange", "item_peach"]) {
      expect(shop.data.entries.find((row) => row.itemDefinitionId === item)?.sellPrice, item).toBeGreaterThan(0);
    }
  });
});
