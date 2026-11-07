import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  ResourceIdGenerator,
  TreeIdGenerator
} from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseFishingActionId,
  parseResourceActionId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type FishingActionId,
  type ResourceActionId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { createHandler } from "../../workers/api/src/handler";
import { D1FishingActionRepository, D1ResourceActionRepository } from "../../workers/api/src/d1-repositories";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataFishingCatalogue,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataResourceCatalogue,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  GameDataWarehouseTiers
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * The warehouse as the capacity invariant of every reward path, through the real Worker handler.
 *
 * The point of the phase is that a full Home Island refuses a reward *without losing it*: the crop
 * stays in the ground, the tree stays ripe, the catch stays claimable and is not redrawn, the node
 * stays harvestable, and a purchase is not paid for. And the mirror image: anything that *frees*
 * space - selling above all - keeps working even while the island is over capacity.
 */

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const MIGRATIONS = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIRECTORY}${name}`, "utf8"))
  .join("\n");

const POND_SPOT = "spot_pond_north";
const CROP_ID = "cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TREE_ID = "treeinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve({ playerId: PLAYER_ONE_ID });
  }
}

class Ids
  implements
    IdGenerator,
    CropIdGenerator,
    TreeIdGenerator,
    EconomyTransactionIdGenerator,
    ConstructionIdGenerator,
    FishingIdGenerator,
    ResourceIdGenerator
{
  private sequence = 1;
  private next(): number {
    return this.sequence++;
  }
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId(`cropinst_cccccccc-cccc-4ccc-8ccc-${String(this.next()).padStart(12, "0")}`);
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId(`treeinst_eeeeeeee-eeee-4eee-8eee-${String(this.next()).padStart(12, "0")}`);
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.next()).padStart(12, "0")}`);
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(`construct_11111111-1111-4111-8111-${String(this.next()).padStart(12, "0")}`);
  }
  newFishingActionId(): FishingActionId {
    return parseFishingActionId(`fishact_11111111-1111-4111-8111-${String(this.next()).padStart(12, "0")}`);
  }
  newResourceActionId(): ResourceActionId {
    return parseResourceActionId(`resact_11111111-1111-4111-8111-${String(this.next()).padStart(12, "0")}`);
  }
}

/** The pond's freshwater table is weighted, so a scripted roll is what makes "same catch" testable. */
class ScriptedRandom implements FishingRandomPort {
  onRoll: (() => void) | undefined;
  calls = 0;
  private readonly rolls: number[];
  constructor(...rolls: number[]) {
    this.rolls = rolls;
  }
  roll(): number {
    this.calls += 1;
    this.onRoll?.();
    const next = this.rolls.shift();
    if (next === undefined) throw new Error("the test ran out of scripted rolls");
    return next;
  }
}

describe("warehouse capacity across the reward paths", () => {
  let db: NodeD1Database;
  let clock: MutableClock;
  let handle: (request: Request) => Promise<Response>;
  let fishingRandom: ScriptedRandom;
  let resourceRandom: ScriptedRandom;

  beforeEach(async () => {
    db = new NodeD1Database(MIGRATIONS);
    clock = new MutableClock();
    fishingRandom = new ScriptedRandom(0.9, 0.1, 0.1, 0.9);
    resourceRandom = new ScriptedRandom(0.25, 0.25, 0.9, 0.9);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Storer', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100000, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    handle = createHandler({
      db,
      authenticator: new FixedAuth(),
      ids: new Ids(),
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
      warehouse: { tiers: new GameDataWarehouseTiers() },
      fishing: {
        catalogue: new GameDataFishingCatalogue(),
        ids: new Ids(),
        random: fishingRandom
      },
      resources: {
        catalogue: new GameDataResourceCatalogue(),
        ids: new Ids(),
        random: resourceRandom
      },
      clock
    });
    const created = await post("/farms", { name: "Storer Island" });
    expect(created.status).toBe(201);
  });

  afterEach(() => {
    db.close();
  });

  function post(path: string, payload: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  }

  async function errorCodeOf(response: Response): Promise<string> {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "";
    const error = (body as { readonly error?: unknown }).error;
    if (typeof error !== "object" || error === null) return "";
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }

  function used(): number {
    const row = db.sqlite
      .prepare("SELECT COALESCE(SUM(quantity), 0) AS used FROM inventory_items WHERE player_id = ?")
      .get(PLAYER_ONE_ID) as { used: number };
    return row.used;
  }

  function capacity(): number {
    const row = db.sqlite
      .prepare("SELECT capacity FROM home_island_warehouses WHERE owner_player_id = ?")
      .get(PLAYER_ONE_ID) as { capacity: number };
    return row.capacity;
  }

  function setCapacity(next: number): void {
    db.sqlite
      .prepare("UPDATE home_island_warehouses SET capacity = ? WHERE owner_player_id = ?")
      .run(next, PLAYER_ONE_ID);
  }

  function growItem(itemId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = inventory_items.quantity + excluded.quantity"
      )
      .run(PLAYER_ONE_ID, itemId, quantity, NOW);
  }

  function held(itemId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, itemId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function xp(): number {
    const row = db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID) as
      | { xp: number }
      | undefined;
    return row?.xp ?? 0;
  }

  function balance(): number {
    const row = db.sqlite
      .prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'")
      .get(PLAYER_ONE_ID) as { balance: number };
    return row.balance;
  }

  function fillToCapacity(): void {
    const free = capacity() - used();
    if (free > 0) growItem("item_wood", free);
    expect(used()).toBe(capacity());
  }

  function snapshot(): unknown {
    return {
      inventory: db.sqlite.prepare("SELECT * FROM inventory_items ORDER BY item_definition_id").all(),
      progression: db.sqlite.prepare("SELECT * FROM player_progression").all(),
      wallet: db.sqlite.prepare("SELECT * FROM wallets").all(),
      ledger: db.sqlite.prepare("SELECT * FROM economy_ledger ORDER BY id").all(),
      receipts: db.sqlite.prepare("SELECT * FROM idempotency_keys ORDER BY operation, request_id").all()
    };
  }

  async function sellWood(quantity: number, requestId: string): Promise<void> {
    expect((await post("/shop/sell", { requestId, shopEntryId: "shop_wood", quantity })).status).toBe(200);
  }

  it.each([995, 996, 1000])("atomically buys five units at %i / 1000", async (initial) => {
    growItem("item_wood", initial - used());
    expect(capacity()).toBe(1000);
    const before = snapshot();
    const seedsBefore = held("item_carrot_seed");
    const command = { requestId: "wh_buy_boundary", shopEntryId: "shop_carrot_seed", quantity: 5 };
    const response = await post("/shop/buy", command);
    if (initial === 995) {
      expect(response.status).toBe(200);
      const result: unknown = await response.json();
      expect(held("item_carrot_seed")).toBe(seedsBefore + 5);
      expect(used()).toBe(1000);
      const after = snapshot();
      expect(await (await post("/shop/buy", command)).json()).toEqual(result);
      expect(snapshot()).toEqual(after);
    } else {
      expect(response.status).toBe(409);
      expect(await errorCodeOf(response)).toBe("WAREHOUSE_FULL");
      expect(used()).toBe(initial);
      expect(snapshot()).toEqual(before);
    }
  });

  it("reads and sells legacy 1100 -> 1000 -> 900 without truncation", async () => {
    setCapacity(2500);
    growItem("item_wood", 1100 - used());
    setCapacity(1000);
    const before = snapshot();
    const response = await handle(new Request("https://api.test/warehouse"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { warehouse: { capacity: 1000, used: 1100, overCapacity: true } } });
    expect(snapshot()).toEqual(before);
    expect(await errorCodeOf(await post("/shop/buy", { requestId: "wh_legacy_refuse", shopEntryId: "shop_carrot_seed", quantity: 1 }))).toBe("WAREHOUSE_FULL");
    expect(snapshot()).toEqual(before);
    await sellWood(100, "wh_legacy_sell_1");
    expect(used()).toBe(1000);
    await sellWood(100, "wh_legacy_sell_2");
    expect(used()).toBe(900);
  });

  it.each([1000, 1100])("upgrades at usage %i, consuming only the required materials, then accepts grants", async (initial) => {
    setCapacity(2500);
    growItem("item_stone", 50);
    growItem("item_wood", initial - used());
    setCapacity(1000);
    const woodBefore = held("item_wood");
    const goldBefore = balance();
    expect((await post("/warehouse/upgrade", { requestId: "wh_full_upgrade" })).status).toBe(200);
    expect(capacity()).toBe(2500);
    expect(used()).toBe(initial - 100);
    expect(held("item_wood")).toBe(woodBefore - 50);
    expect(held("item_stone")).toBe(0);
    expect(balance()).toBe(goldBefore - 500);
    const after = snapshot();
    expect((await post("/warehouse/upgrade", { requestId: "wh_full_upgrade" })).status).toBe(200);
    expect(snapshot()).toEqual(after);
    expect((await post("/shop/buy", { requestId: "wh_upgraded_buy", shopEntryId: "shop_carrot_seed", quantity: 5 })).status).toBe(200);
    expect(used()).toBe(initial - 95);
  });

  it("consumes a seed while legacy inventory remains over capacity", async () => {
    setCapacity(2500);
    growItem("item_carrot_seed", 1);
    growItem("item_wood", 1100 - used());
    setCapacity(1000);
    const seedsBefore = held("item_carrot_seed");
    const woodBefore = held("item_wood");
    const tile = db.sqlite.prepare("SELECT x, y, version FROM farm_tiles WHERE farm_id = ? AND terrain_type = 'SOIL' LIMIT 1").get(FARM_ONE_ID) as { x: number; y: number; version: number };
    const command = { requestId: "wh_legacy_plant", cropDefinitionId: "crop_carrot", x: tile.x, y: tile.y, expectedTileVersion: tile.version };
    expect((await post(`/farms/${FARM_ONE_ID}/crops`, command)).status).toBe(201);
    expect(used()).toBe(1099);
    expect(held("item_carrot_seed")).toBe(seedsBefore - 1);
    expect(held("item_wood")).toBe(woodBefore);
    const after = snapshot();
    expect((await post(`/farms/${FARM_ONE_ID}/crops`, command)).status).toBe(201);
    expect(snapshot()).toEqual(after);
  });

  it.each(["node_wildwood_north_1"])("pins both rolls for %s across a write-time capacity refusal", async (nodeId) => {
    expect((await post("/resource-actions/start", { requestId: "wh_resource_race_start", nodeId })).status).toBe(201);
    const action = db.sqlite.prepare("SELECT action_id FROM resource_actions WHERE status = 'ACTIVE'").get() as { action_id: string };
    clock.advanceSeconds(30);
    growItem("item_wood", 998 - used());
    const xpBefore = xp();
    resourceRandom.onRoll = () => {
      resourceRandom.onRoll = undefined;
      growItem("item_wood", 2);
    };
    const path = `/resource-actions/${action.action_id}/settle`;
    const command = { requestId: "wh_resource_race_claim", expectedActionVersion: 1 };
    expect(await errorCodeOf(await post(path, command))).toBe("WAREHOUSE_FULL");
    expect(used()).toBe(1000);
    expect(xp()).toBe(xpBefore);
    expect(db.sqlite.prepare("SELECT * FROM resource_node_states").all()).toEqual([]);
    expect(db.sqlite.prepare("SELECT status, reward_roll, quantity_roll FROM resource_actions WHERE action_id = ?").get(action.action_id)).toEqual({ status: "ACTIVE", reward_roll: 0.25, quantity_roll: 0.25 });
    expect(() => db.sqlite.prepare("UPDATE resource_actions SET quantity_roll = 0.9 WHERE action_id = ?").run(action.action_id)).toThrow(/immutable/);
    await sellWood(2, "wh_resource_race_space");
    expect((await post(path, command)).status).toBe(200);
    expect(resourceRandom.calls).toBe(2);
    expect(used()).toBe(1000);
    const after = snapshot();
    expect((await post(path, command)).status).toBe(200);
    expect(snapshot()).toEqual(after);
  });

  function stockMatureCrop(): void {
    db.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, 5, 5, 'crop_carrot', ?, '2020-01-01T00:00:00.000Z', 1, ?, ?)"
      )
      .run(CROP_ID, FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  }

  it("pins one fishing roll across competing requests and fresh repository instances", async () => {
    expect((await post("/fishing/start", { requestId: "wh_pin_fish_start", spotId: POND_SPOT })).status).toBe(201);
    const repository = new D1FishingActionRepository(db);
    const action = await repository.findActiveByActor(PLAYER_ONE_ID);
    if (action === null) throw new Error("expected active fishing action");
    const before = snapshot();
    const rolls = await Promise.all([
      repository.pinRoll(action, () => 0.9),
      new D1FishingActionRepository(db).pinRoll(action, () => 0.1)
    ]);
    expect(rolls).toEqual([0.9, 0.9]);
    expect(await new D1FishingActionRepository(db).pinRoll(action, () => { throw new Error("must reuse durable roll"); })).toBe(0.9);
    await expect(repository.pinRoll({ ...action, actorPlayerId: PLAYER_TWO_ID }, () => 0.1)).rejects.toMatchObject({ code: "FISHING_ACTION_NOT_ACTIVE" });
    expect(snapshot()).toEqual(before);
  });

  it("pins one resource roll pair across competing requests and fresh repository instances", async () => {
    expect((await post("/resource-actions/start", { requestId: "wh_pin_resource_start", nodeId: "node_wildwood_north_1" })).status).toBe(201);
    const repository = new D1ResourceActionRepository(db);
    const action = await repository.findActiveByActor(PLAYER_ONE_ID);
    if (action === null) throw new Error("expected active resource action");
    const before = snapshot();
    expect(await Promise.all([
      repository.pinRolls(action, () => 0.25),
      new D1ResourceActionRepository(db).pinRolls(action, () => 0.9)
    ])).toEqual([[0.25, 0.25], [0.25, 0.25]]);
    expect(await new D1ResourceActionRepository(db).pinRolls(action, () => { throw new Error("must reuse durable rolls"); })).toEqual([0.25, 0.25]);
    await expect(repository.pinRolls({ ...action, actorPlayerId: PLAYER_TWO_ID }, () => 0.9)).rejects.toMatchObject({ code: "RESOURCE_ACTION_NOT_ACTIVE" });
    expect(snapshot()).toEqual(before);
    expect(db.sqlite.prepare("SELECT * FROM resource_node_states").all()).toEqual([]);
  });

  it("preserves the first fishing roll if a competing grant fills storage after the pre-check", async () => {
    expect((await post("/fishing/start", { requestId: "wh_fish_race_start", spotId: POND_SPOT })).status).toBe(201);
    const action = db.sqlite.prepare("SELECT action_id FROM fishing_actions WHERE status = 'ACTIVE'").get() as { action_id: string };
    clock.advanceSeconds(30);
    growItem("item_wood", 999 - used());
    const xpBefore = xp();
    // Deterministically force the write-time race after the capacity read, before settlement.
    fishingRandom.onRoll = () => {
      fishingRandom.onRoll = undefined;
      growItem("item_wood", 1);
    };
    const path = `/fishing/${action.action_id}/settle`;
    const command = { requestId: "wh_fish_race_settle", expectedActionVersion: 1 };
    expect(await errorCodeOf(await post(path, command))).toBe("WAREHOUSE_FULL");
    expect(used()).toBe(1000);
    expect(xp()).toBe(xpBefore);
    expect((await post("/shop/sell", { requestId: "wh_fish_race_space", shopEntryId: "shop_wood", quantity: 1 })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT reward_roll FROM fishing_actions WHERE action_id = ?").get(action.action_id)).toEqual({ reward_roll: 0.9 });
    expect(() => db.sqlite.prepare("UPDATE fishing_actions SET reward_roll = 0.1 WHERE action_id = ?").run(action.action_id)).toThrow(/immutable/);
    expect((await post(path, command)).status).toBe(200);
    expect(held("item_fish_catfish")).toBe(1);
    expect(held("item_fish_tilapia")).toBe(0);
    expect(fishingRandom.calls).toBe(1);
    const xpAfter = xp();
    expect((await post(path, command)).status).toBe(200);
    expect(xp()).toBe(xpAfter);
    expect(used()).toBe(1000);
  });

  function stockRipeTree(definitionId = "tree_apple"): void {
    db.sqlite
      .prepare(
        "INSERT INTO tree_instances (id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at) VALUES (?, ?, 6, 6, ?, ?, '2020-01-01T00:00:00.000Z', NULL, 1, ?, ?)"
      )
      .run(TREE_ID, FARM_ONE_ID, definitionId, PLAYER_ONE_ID, NOW, NOW);
  }

  it("refuses a crop harvest when full, keeps the crop, and pays it after space is freed", async () => {
    stockMatureCrop();
    fillToCapacity();
    const xpBefore = xp();
    const before = snapshot();

    const refused = await post(`/farms/${FARM_ONE_ID}/crops/${CROP_ID}/harvest`, {
      requestId: "wh_crop_full_1",
      expectedCropVersion: 1
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    // Nothing was consumed: the crop is still there and no reward or experience was paid.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE id = ?").get(CROP_ID)).toEqual({
      count: 1
    });
    expect(held("item_carrot")).toBe(0);
    expect(xp()).toBe(xpBefore);
    expect(snapshot()).toEqual(before);
    expect(used()).toBe(1000);

    // Freeing space (a sale, in play) lets the same harvest land.
    await sellWood(2, "wh_crop_free_space");
    const harvested = await post(`/farms/${FARM_ONE_ID}/crops/${CROP_ID}/harvest`, {
      requestId: "wh_crop_full_1",
      expectedCropVersion: 1
    });
    expect(harvested.status).toBe(200);
    expect(held("item_carrot")).toBe(2);
    expect(xp()).toBe(xpBefore + 4);
    expect(used()).toBe(1000);
    const after = snapshot();
    expect((await post(`/farms/${FARM_ONE_ID}/crops/${CROP_ID}/harvest`, { requestId: "wh_crop_full_1", expectedCropVersion: 1 })).status).toBe(200);
    expect(snapshot()).toEqual(after);
  });

  it.each([998, 999])("checks the crop's exact two-unit boundary at %i", async (initial) => {
    stockMatureCrop();
    growItem("item_wood", initial - used());
    const before = snapshot();
    const cropBefore = db.sqlite.prepare("SELECT * FROM crop_instances WHERE id = ?").get(CROP_ID);
    const response = await post(`/farms/${FARM_ONE_ID}/crops/${CROP_ID}/harvest`, { requestId: "wh_crop_boundary", expectedCropVersion: 1 });
    if (initial === 998) {
      expect(response.status).toBe(200);
      expect(used()).toBe(1000);
      expect(held("item_carrot")).toBe(2);
    } else {
      expect(await errorCodeOf(response)).toBe("WAREHOUSE_FULL");
      expect(snapshot()).toEqual(before);
      expect(db.sqlite.prepare("SELECT * FROM crop_instances WHERE id = ?").get(CROP_ID)).toEqual(cropBefore);
    }
  });

  it("refuses a tree harvest when full and keeps the tree ripe", async () => {
    stockRipeTree();
    fillToCapacity();
    const xpBefore = xp();
    const before = snapshot();

    const refused = await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, {
      requestId: "wh_tree_full_1",
      expectedTreeVersion: 1
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    const tree = db.sqlite
      .prepare("SELECT last_harvested_at, version FROM tree_instances WHERE id = ?")
      .get(TREE_ID) as { last_harvested_at: string | null; version: number };
    expect(tree.last_harvested_at).toBeNull();
    expect(tree.version).toBe(1);
    expect(xp()).toBe(xpBefore);
    expect(snapshot()).toEqual(before);

    await sellWood(3, "wh_tree_free_space");
    const harvested = await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, {
      requestId: "wh_tree_full_1",
      expectedTreeVersion: 1
    });
    expect(harvested.status).toBe(200);
    expect(held("item_apple")).toBe(3);
    expect(used()).toBe(1000);
    expect(xp()).toBe(xpBefore + 9);
    const after = snapshot();
    const treeAfter = db.sqlite.prepare("SELECT * FROM tree_instances WHERE id = ?").get(TREE_ID);
    expect((await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, { requestId: "wh_tree_full_1", expectedTreeVersion: 1 })).status).toBe(200);
    expect(snapshot()).toEqual(after);
    expect(db.sqlite.prepare("SELECT * FROM tree_instances WHERE id = ?").get(TREE_ID)).toEqual(treeAfter);
  });

  it("keeps a one-shot Wildwood harvest atomic when full and replays the same receipt", async () => {
    stockRipeTree("tree_wildwood");
    fillToCapacity();
    const before = snapshot();

    const refused = await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, {
      requestId: "wh_wildwood_full_1",
      expectedTreeVersion: 1
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    expect(db.sqlite.prepare("SELECT last_harvested_at, version FROM tree_instances WHERE id = ?").get(TREE_ID)).toMatchObject({
      last_harvested_at: null,
      version: 1
    });
    expect(held("item_wood")).toBe(1000);
    expect(snapshot()).toEqual(before);

    await sellWood(12, "wh_wildwood_free_space");
    const harvested = await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, {
      requestId: "wh_wildwood_full_1",
      expectedTreeVersion: 1
    });
    expect(harvested.status).toBe(200);
    expect(await harvested.json()).toMatchObject({
      data: { harvest: { itemDefinitionId: "item_wood", quantityAdded: 12 } }
    });
    expect(held("item_wood")).toBe(1000);
    const after = snapshot();
    expect((await post(`/farms/${FARM_ONE_ID}/trees/${TREE_ID}/harvest`, {
      requestId: "wh_wildwood_full_1",
      expectedTreeVersion: 1
    })).status).toBe(200);
    expect(snapshot()).toEqual(after);
    expect(db.sqlite.prepare("SELECT last_harvested_at, version FROM tree_instances WHERE id = ?").get(TREE_ID)).toMatchObject({ version: 2 });
  });

  it("refuses a shop purchase when full without debiting gold or writing a purchase row", async () => {
    fillToCapacity();
    const goldBefore = balance();
    const ledgerBefore = db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get() as { count: number };

    const refused = await post("/shop/buy", {
      requestId: "wh_buy_full_1",
      shopEntryId: "shop_carrot_seed",
      quantity: 10
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    expect(balance()).toBe(goldBefore);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual(ledgerBefore);
  });

  it("sells while the island is over capacity, and only then does a harvest fit", async () => {
    // A grandfathering shape: the capacity is below what the island already holds.
    growItem("item_carrot", 200);
    setCapacity(used() - 100);
    const overUsed = used();
    const goldBefore = balance();

    // Selling is a *decrease*, so an over-capacity island may still do it.
    const sold = await post("/shop/sell", {
      requestId: "wh_sell_over_1",
      shopEntryId: "shop_carrot",
      quantity: 150
    });
    expect(sold.status).toBe(200);
    expect(used()).toBe(overUsed - 150);
    expect(balance()).toBeGreaterThan(goldBefore);
  });

  it("lets exactly one of two concurrent purchases fit into the last slot", async () => {
    growItem("item_wood", 995 - used());
    const goldBefore = balance();
    const xpBefore = xp();
    const seedsBefore = held("item_carrot_seed");
    const first = post("/shop/buy", { requestId: "wh_buy_race_a", shopEntryId: "shop_carrot_seed", quantity: 5 });
    const second = post("/shop/buy", { requestId: "wh_buy_race_b", shopEntryId: "shop_carrot_seed", quantity: 5 });
    const responses = await Promise.all([first, second]);
    const succeeded = responses.filter((response) => response.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(used()).toBe(1000);
    expect(capacity()).toBe(1000);
    expect(held("item_carrot_seed")).toBe(seedsBefore + 5);
    expect(xp()).toBe(xpBefore);
    const failed = responses.find((response) => response.status !== 200);
    expect(failed).toBeDefined();
    if (failed !== undefined) expect(await errorCodeOf(failed)).toBe("WAREHOUSE_FULL");
    const ledger = db.sqlite.prepare("SELECT delta FROM economy_ledger WHERE reason = 'SHOP_BUY'").all() as { delta: number }[];
    expect(ledger).toHaveLength(1);
    expect(balance()).toBe(goldBefore + (ledger[0]?.delta ?? 0));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE request_id IN ('wh_buy_race_a', 'wh_buy_race_b')").get()).toEqual({ n: 1 });
  });

  it("keeps a fishing catch claimable, and does not redraw it after a full-storage refusal", async () => {
    const started = await post("/fishing/start", { requestId: "wh_fish_start", spotId: POND_SPOT });
    expect(started.status).toBe(201);
    const action = db.sqlite
      .prepare("SELECT action_id, version FROM fishing_actions WHERE actor_player_id = ? AND status = 'ACTIVE'")
      .get(PLAYER_ONE_ID) as { action_id: string; version: number };
    clock.advanceSeconds(30);
    fillToCapacity();
    const before = snapshot();

    // The scripted first roll (0.9 -> catfish) must NOT be spent by a refusal.
    const refused = await post(`/fishing/${action.action_id}/settle`, {
      requestId: "wh_fish_settle_1",
      expectedActionVersion: action.version
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    expect(snapshot()).toEqual(before);
    expect(fishingRandom.calls).toBe(0);
    expect(
      db.sqlite.prepare("SELECT status FROM fishing_actions WHERE action_id = ?").get(action.action_id)
    ).toEqual({ status: "ACTIVE" });

    // Free space and claim: the same attempt, and the first roll is the one that pays.
    await sellWood(1, "wh_fish_free_space");
    const claimed = await post(`/fishing/${action.action_id}/settle`, {
      requestId: "wh_fish_settle_2",
      expectedActionVersion: action.version
    });
    expect(claimed.status).toBe(200);
    // catfish is the 0.9 roll in the pond's table; tilapia is 0.1, which would prove a redraw.
    expect(held("item_fish_catfish")).toBe(1);
    expect(held("item_fish_tilapia")).toBe(0);
    const after = snapshot();
    // A replayed settle pays nothing more.
    const replay = await post(`/fishing/${action.action_id}/settle`, {
      requestId: "wh_fish_settle_2",
      expectedActionVersion: action.version
    });
    expect(replay.status).toBe(200);
    expect(held("item_fish_catfish")).toBe(1);
    expect(used()).toBe(1000);
    expect(snapshot()).toEqual(after);
    expect(fishingRandom.calls).toBe(1);
  });

  it.each([
    ["node_wildwood_north_1", "item_wood", 2]
  ] as const)("keeps %s claimable without depletion or duplicate reward", async (nodeId, itemId, quantity) => {
    const started = await post("/resource-actions/start", { requestId: "wh_mine_start", nodeId });
    expect(started.status).toBe(201);
    const action = db.sqlite
      .prepare("SELECT action_id, version FROM resource_actions WHERE actor_player_id = ? AND status = 'ACTIVE'")
      .get(PLAYER_ONE_ID) as { action_id: string; version: number };
    clock.advanceSeconds(30);
    fillToCapacity();
    const xpBefore = xp();
    const heldBefore = held(itemId);
    const before = snapshot();

    const refused = await post(`/resource-actions/${action.action_id}/settle`, {
      requestId: "wh_mine_settle_1",
      expectedActionVersion: action.version
    });
    expect(await errorCodeOf(refused)).toBe("WAREHOUSE_FULL");
    expect(snapshot()).toEqual(before);
    // The node was not depleted and the action is still the player's claimable one.
    expect(
      db.sqlite.prepare("SELECT status FROM resource_actions WHERE action_id = ?").get(action.action_id)
    ).toEqual({ status: "ACTIVE" });
    const nodeState = db.sqlite
      .prepare("SELECT available_at FROM resource_node_states WHERE node_id = ?")
      .get(nodeId) as { available_at: string | null } | undefined;
    expect(nodeState?.available_at ?? null).toBeNull();
    expect(held(itemId)).toBe(heldBefore);
    expect(xp()).toBe(xpBefore);

    await sellWood(quantity, "wh_gather_free_space");
    const heldAfterSale = held(itemId);
    const settled = await post(`/resource-actions/${action.action_id}/settle`, {
      requestId: "wh_mine_settle_1",
      expectedActionVersion: action.version
    });
    expect(settled.status).toBe(200);
    // The shipped stone table is stone x2, so the retry pays exactly that - once.
    expect(held(itemId)).toBe(heldAfterSale + quantity);
    expect(xp()).toBeGreaterThan(xpBefore);
    expect(used()).toBe(1000);
    const after = snapshot();
    const nodeAfter = db.sqlite.prepare("SELECT * FROM resource_node_states").all();
    expect((await post(`/resource-actions/${action.action_id}/settle`, { requestId: "wh_mine_settle_1", expectedActionVersion: action.version })).status).toBe(200);
    expect(snapshot()).toEqual(after);
    expect(db.sqlite.prepare("SELECT * FROM resource_node_states").all()).toEqual(nodeAfter);
  });
});
