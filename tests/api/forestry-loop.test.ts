import { readFileSync } from "node:fs";
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
  IdGenerator,
  RandomPort,
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
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Forestry through the same API mining already uses.
 *
 * The point of V15.3 is that this file is boring: a CHOP node starts, settles, depletes and regenerates
 * through the *same* use cases, tables and guards as a MINE node. What it also proves is the safety
 * around that: the verb comes from the definition and cannot be sent by a client, an orchard tree and
 * a decorative object are not nodes, and a node's reward and depletion survive a replay and a race.
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
  "0015_player_identities.sql",
  "0016_fishing_actions.sql",
  "0017_resource_nodes.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const WILDWOOD = { node: "node_wildwood_north_1", item: "item_wood", quantity: 2, actionSeconds: 5, regenerationSeconds: 120, xp: 2 };
const PINE = { node: "node_pine_north_1", item: "item_resin", requiredLevel: 3 };
const HARDWOOD = { node: "node_hardwood_east_1", item: "item_hardwood", requiredLevel: 5 };
const STONE = { node: "node_stone_ridge", item: "item_stone" };

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

/** The shipped tables are deterministic, so any roll in range yields the same drop. */
class FixedRandom implements RandomPort {
  roll(): number {
    return 0.4;
  }
}

class ForestryIds
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
  newResourceActionId(): ResourceActionId {
    return parseResourceActionId(`resact_11111111-1111-4111-8111-${String(this.sequence++).padStart(12, "0")}`);
  }
}

describe("the forestry loop", () => {
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
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Forester', 'ACTIVE', ?, ?)"
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
      ids: new ForestryIds(),
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
      fishing: {
        catalogue: new GameDataFishingCatalogue(),
        ids: new ForestryIds(),
        random: new FixedRandom()
      },
      resources: {
        catalogue: new GameDataResourceCatalogue(),
        ids: new ForestryIds(),
        random: new FixedRandom()
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

  function start(nodeId: string, requestId: string, extra: Record<string, unknown> = {}): Promise<Response> {
    return post("/resource-actions/start", { requestId, nodeId, ...extra });
  }

  function settle(actionId: string, version: number, requestId: string): Promise<Response> {
    return post(`/resource-actions/${actionId}/settle`, { requestId, expectedActionVersion: version });
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

  function xp(): number {
    const row = db.sqlite
      .prepare("SELECT xp FROM player_progression WHERE player_id = ?")
      .get(PLAYER_ONE_ID) as { xp: number } | undefined;
    return row?.xp ?? 0;
  }

  async function createFarm(): Promise<void> {
    const created = await post("/farms", { name: "Forest Island" });
    expect(created.status).toBe(201);
  }

  async function nodes(): Promise<readonly { nodeId: string; available: boolean; verb: string }[]> {
    const raw: unknown = await (await get("/resource-nodes")).json();
    return (raw as { data: { nodes: readonly { nodeId: string; available: boolean; verb: string }[] } }).data.nodes;
  }

  async function chop(nodeId: string, step: string, actionSeconds: number) {
    const started = await start(nodeId, `forest_start_${step}`);
    expect(started.status, `start ${step}`).toBe(201);
    const action = ((await body(started)) as {
      data: { action: { actionId: string; version: number; verb: string; nodeId: string } };
    }).data.action;
    clock.advanceSeconds(actionSeconds + 1);
    const settled = await settle(action.actionId, action.version, `forest_settle_${step}`);
    return { action, settled };
  }

  it("chops a wild tree, depletes it, waits out the stump, and sells the wood", async () => {
    await createFarm();

    // 1. The catalogue carries the trees with their own verb and their stump.
    const list = await nodes();
    const wildwood = list.find((node) => node.nodeId === WILDWOOD.node);
    expect(wildwood).toMatchObject({ verb: "CHOP", available: true });
    const raw: unknown = await (await get("/resource-nodes")).json();
    const full = (raw as { data: { nodes: readonly { nodeId: string; depletedModelId: string | null }[] } }).data.nodes;
    expect(full.find((node) => node.nodeId === WILDWOOD.node)?.depletedModelId).toBe("resource_wildwood_stump");

    // 2. Start: the verb is the definition's, not the client's.
    const started = await start(WILDWOOD.node, "forest_start_1");
    expect(started.status).toBe(201);
    const action = ((await body(started)) as {
      data: { action: { actionId: string; version: number; verb: string; status: string } };
    }).data.action;
    expect(action).toMatchObject({ verb: "CHOP", status: "ACTIVE" });

    // 3. Early settlement is refused and moves nothing.
    const early = await settle(action.actionId, action.version, "forest_settle_early");
    expect(early.status).toBe(409);
    await expect(body(early)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_NOT_READY" } });
    expect(held(WILDWOOD.item)).toBe(0);
    expect(xp()).toBe(0);

    // 4. Advance the clock and settle: wood and experience, in one settlement.
    clock.advanceSeconds(WILDWOOD.actionSeconds + 1);
    const settled = await settle(action.actionId, action.version, "forest_settle_1");
    expect(settled.status).toBe(200);
    const settledBody = await body(settled);
    expect(settledBody).toMatchObject({
      data: {
        drop: { itemDefinitionId: WILDWOOD.item, quantity: WILDWOOD.quantity },
        progression: { xpAwarded: WILDWOOD.xp }
      }
    });
    expect(held(WILDWOOD.item)).toBe(WILDWOOD.quantity);
    expect(xp()).toBe(WILDWOOD.xp);

    // 5. The replay is the same chop, not a second one.
    expect(await body(await settle(action.actionId, action.version, "forest_settle_1"))).toEqual(settledBody);
    expect(held(WILDWOOD.item)).toBe(WILDWOOD.quantity);

    // 6. The tree is a stump and cannot be chopped again yet.
    const depleted = await start(WILDWOOD.node, "forest_depleted");
    expect(depleted.status).toBe(409);
    await expect(body(depleted)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_NODE_DEPLETED" } });
    expect((await nodes()).find((node) => node.nodeId === WILDWOOD.node)?.available).toBe(false);

    // 7. Regeneration is the server's clock alone: no request in between.
    clock.advanceSeconds(WILDWOOD.regenerationSeconds + 1);
    expect((await nodes()).find((node) => node.nodeId === WILDWOOD.node)?.available).toBe(true);
    const again = await chop(WILDWOOD.node, "again", WILDWOOD.actionSeconds);
    expect(again.settled.status).toBe(200);
    expect(held(WILDWOOD.item)).toBe(WILDWOOD.quantity * 2);

    // 8. Sell the wood through the same market as everything else.
    const sold = await post("/shop/sell", {
      requestId: "forest_sell_1",
      shopEntryId: "shop_wood",
      quantity: WILDWOOD.quantity
    });
    expect(sold.status).toBe(200);
    expect(balance()).toBe(WILDWOOD.quantity);
  });

  it("gates the advanced trees behind the same level check mining uses", async () => {
    await createFarm();
    for (const tree of [PINE, HARDWOOD]) {
      const refused = await start(tree.node, `forest_locked_${tree.item}`);
      expect(refused.status, tree.node).toBe(403);
      await expect(body(refused)).resolves.toMatchObject({
        ok: false,
        error: { code: "RESOURCE_LEVEL_REQUIRED" }
      });
    }
    // And a pine chops, at level 3, for resin.
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 3, 360, 1, ?, ?) ON CONFLICT(player_id) DO UPDATE SET level = 3, xp = 360"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    const pine = await chop(PINE.node, "pine", 7);
    expect(pine.settled.status).toBe(200);
    await expect(body(pine.settled)).resolves.toMatchObject({
      data: { drop: { itemDefinitionId: PINE.item, quantity: 2 } }
    });
  });

  it("keeps MINE and CHOP on one engine, and lets a client name neither", async () => {
    await createFarm();
    // A rock keeps its own verb through the same commands...
    const rock = await chop(STONE.node, "rock", 6);
    expect(rock.action.verb).toBe("MINE");
    expect(rock.settled.status).toBe(200);
    expect(held(STONE.item)).toBe(2);

    // ...and a client cannot ask for a verb of its own.
    const smuggled = await start(WILDWOOD.node, "forest_smuggle_verb", { verb: "MINE" });
    expect(smuggled.status).toBe(400);
    const smuggledReward = await start(WILDWOOD.node, "forest_smuggle_reward", { itemDefinitionId: "item_hardwood" });
    expect(smuggledReward.status).toBe(400);
  });

  it("will not chop an orchard tree or a decorative object", async () => {
    await createFarm();
    // A name from another family - an orchard tree, a crop, a world object, a construction - does not
    // even have a node's shape, so the request schema refuses it before any lookup happens.
    for (const nodeId of ["tree_apple", "cropinst_11111111-1111-4111-8111-111111111111", "world.tree_pine", "construct_11111111-1111-4111-8111-111111111111"]) {
      const refused = await start(nodeId, `forest_not_a_node_${nodeId.slice(0, 6)}`);
      expect(refused.status, nodeId).toBe(400);
      await expect(body(refused)).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    // And a node-shaped id that does not exist is a clean not-found rather than a reward.
    const unknown = await start("node_apple_orchard", "forest_unknown_node");
    expect(unknown.status).toBe(404);
    await expect(body(unknown)).resolves.toMatchObject({
      ok: false,
      error: { code: "RESOURCE_NODE_NOT_FOUND" }
    });
  });

  it("settles exactly one of two concurrent chops, and one depletion of a tree", async () => {
    await createFarm();
    const started = await start(WILDWOOD.node, "forest_race_start");
    const action = ((await body(started)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(WILDWOOD.actionSeconds + 1);

    const [first, second] = await Promise.all([
      settle(action.actionId, action.version, "forest_race_a"),
      settle(action.actionId, action.version, "forest_race_b")
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(held(WILDWOOD.item)).toBe(WILDWOOD.quantity);
    expect(xp()).toBe(WILDWOOD.xp);

    // A second action against the same stump - what a shared forest would produce - is refused.
    db.sqlite
      .prepare(
        "INSERT INTO resource_actions (action_id, actor_player_id, zone_kind, zone_id, node_id, definition_id, verb, status, started_at, ready_at, settled_at, version, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, ?, 'resource_wildwood', 'CHOP', 'ACTIVE', ?, ?, NULL, 1, ?, ?)"
      )
      .run(
        "resact_22222222-2222-4222-8222-222222222222",
        PLAYER_ONE_ID,
        `zone_home_island_${FARM_ONE_ID}`,
        WILDWOOD.node,
        NOW,
        NOW,
        NOW,
        NOW
      );
    const secondChop = await settle("resact_22222222-2222-4222-8222-222222222222", 1, "forest_race_c");
    expect(secondChop.status).toBe(409);
    await expect(body(secondChop)).resolves.toMatchObject({
      ok: false,
      error: { code: "RESOURCE_NODE_DEPLETED" }
    });
    expect(held(WILDWOOD.item)).toBe(WILDWOOD.quantity);
  });

  it("regenerates a felled tree for a player who closes the game", async () => {
    await createFarm();
    const { settled } = await chop(WILDWOOD.node, "offline", WILDWOOD.actionSeconds);
    expect(settled.status).toBe(200);
    expect((await nodes()).find((node) => node.nodeId === WILDWOOD.node)?.available).toBe(false);

    // No request at all until the player returns.
    clock.advanceSeconds(WILDWOOD.regenerationSeconds * 4);
    expect((await nodes()).find((node) => node.nodeId === WILDWOOD.node)?.available).toBe(true);
  });
});
