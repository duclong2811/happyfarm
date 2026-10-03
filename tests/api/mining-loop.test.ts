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
  CryptoResourceRandom,
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
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * The whole mining loop, through the real API.
 *
 * A player walks to the volcano, mines a stone outcrop, is refused early, settles a drop the server
 * chose, finds it in the inventory, gains experience, sees the node depleted, watches it come back by
 * the server's clock alone, mines again, and sells the material - while replays, races and two
 * attempts at one node are all refused a second reward.
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

const STONE = { node: "node_stone_ridge", item: "item_stone", quantity: 2, actionSeconds: 6, regenerationSeconds: 120, xp: 3 };
const IRON = { node: "node_iron_west", requiredLevel: 6 };

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
    return 0.25;
  }
}

class MiningIds
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

describe("the mining loop", () => {
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
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Miner One', 'ACTIVE', ?, ?)"
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
      ids: new MiningIds(),
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
        ids: new MiningIds(),
        random: new FixedRandom()
      },
      resources: {
        catalogue: new GameDataResourceCatalogue(),
        ids: new MiningIds(),
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

  function start(nodeId: string, requestId: string): Promise<Response> {
    return post("/resource-actions/start", { requestId, nodeId });
  }

  function settle(actionId: string, version: number, requestId: string): Promise<Response> {
    return post(`/resource-actions/${actionId}/settle`, { requestId, expectedActionVersion: version });
  }

  function cancel(actionId: string, version: number, requestId: string): Promise<Response> {
    return post(`/resource-actions/${actionId}/cancel`, { requestId, expectedActionVersion: version });
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

  async function createFarm(): Promise<void> {
    const created = await post("/farms", { name: "Mining Island" });
    expect(created.status).toBe(201);
  }

  async function nodes(): Promise<
    readonly { nodeId: string; available: boolean; secondsUntilAvailable: number; requiredLevel: number }[]
  > {
    const raw: unknown = await (await get("/resource-nodes")).json();
    const body = raw as {
      data: {
        nodes: readonly {
          nodeId: string;
          available: boolean;
          secondsUntilAvailable: number;
          requiredLevel: number;
        }[];
      };
    };
    return body.data.nodes;
  }

  async function startAndSettle(nodeId: string, step: string) {
    const started = await start(nodeId, `res_start_${step}`);
    expect(started.status, `start ${step}`).toBe(201);
    const action = ((await body(started)) as {
      data: { action: { actionId: string; version: number; secondsUntilReady: number; verb: string; nodeId: string } };
    }).data.action;
    clock.advanceSeconds(STONE.actionSeconds + 1);
    const settled = await settle(action.actionId, action.version, `res_settle_${step}`);
    return { action, settled };
  }

  it("serves the node catalogue from static data", async () => {
    // Nodes belong to a zone; without an island there is nothing to list, which is itself the rule.
    expect(await nodes()).toEqual([]);
    await createFarm();
    const response = await get("/resource-nodes");
    expect(response.status).toBe(200);
    const list = await nodes();
    // Nine mining deposits and twelve wild forestry trees share one catalogue and one state table.
    expect(list).toHaveLength(21);
    expect(list.every((node) => node.available)).toBe(true);
    expect(list.map((node) => node.nodeId)).toContain(STONE.node);
    expect(list.map((node) => node.nodeId)).toContain(IRON.node);
  });

  it("mines, depletes, regenerates, mines again, and sells - with replay and races refused", async () => {
    await createFarm();

    // 1. Iron is behind a level; a new player is refused before anything starts.
    const locked = await start(IRON.node, "res_locked");
    expect(locked.status).toBe(403);
    await expect(body(locked)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_LEVEL_REQUIRED" } });

    // 2. Start stone. The client named a node; the server owns the wait and the verb.
    const started = await start(STONE.node, "res_start_1");
    expect(started.status).toBe(201);
    const action = ((await body(started)) as {
      data: {
        action: { actionId: string; version: number; secondsUntilReady: number; verb: string; nodeId: string; status: string };
      };
    }).data.action;
    expect(action).toMatchObject({
      nodeId: STONE.node,
      verb: "MINE",
      status: "ACTIVE",
      secondsUntilReady: STONE.actionSeconds,
      version: 1
    });

    // 3. Early settlement is refused, and nothing moves.
    const early = await settle(action.actionId, action.version, "res_settle_early");
    expect(early.status).toBe(409);
    await expect(body(early)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_NOT_READY" } });
    expect(held(STONE.item)).toBe(0);
    expect(xp()).toBe(0);

    // 4. A refresh finds the live gather.
    await expect(body(await get("/resource-actions/active"))).resolves.toMatchObject({
      data: { action: { actionId: action.actionId, status: "ACTIVE" } }
    });

    // 5. Advance the authoritative clock and settle: 2 stone and 3 experience.
    clock.advanceSeconds(STONE.actionSeconds + 1);
    const settled = await settle(action.actionId, action.version, "res_settle_1");
    expect(settled.status).toBe(200);
    const settledBody = await body(settled);
    expect(settledBody).toMatchObject({
      data: {
        drop: { itemDefinitionId: STONE.item, quantity: STONE.quantity },
        progression: { xpAwarded: STONE.xp, leveledUp: false }
      }
    });
    expect(held(STONE.item)).toBe(STONE.quantity);
    expect(xp()).toBe(STONE.xp);

    // 6. The replay is the same settlement, not a second drop.
    const replay = await settle(action.actionId, action.version, "res_settle_1");
    expect(replay.status).toBe(200);
    expect(await body(replay)).toEqual(settledBody);
    expect(held(STONE.item)).toBe(STONE.quantity);
    expect(xp()).toBe(STONE.xp);

    // 7. The node is depleted and cannot be mined again yet.
    const depleted = await start(STONE.node, "res_depleted");
    expect(depleted.status).toBe(409);
    await expect(body(depleted)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_NODE_DEPLETED" } });
    const afterMining = (await nodes()).find((node) => node.nodeId === STONE.node);
    expect(afterMining?.available).toBe(false);
    expect(afterMining?.secondsUntilAvailable).toBeGreaterThan(0);

    // 8. Regeneration is the server's clock and nothing else: no request in between.
    clock.advanceSeconds(STONE.regenerationSeconds + 1);
    const regenerated = (await nodes()).find((node) => node.nodeId === STONE.node);
    expect(regenerated?.available).toBe(true);
    expect(regenerated?.secondsUntilAvailable).toBe(0);
    const secondMine = await startAndSettle(STONE.node, "second");
    expect(secondMine.settled.status).toBe(200);
    expect(held(STONE.item)).toBe(STONE.quantity * 2);

    // 9. Cancel leaves the node untouched: no drop, no depletion.
    const cancelStart = await start(STONE.node, "res_start_cancel");
    // The node was just mined, so it is depleted; wait it out first.
    expect(cancelStart.status).toBe(409);
    clock.advanceSeconds(STONE.regenerationSeconds + 1);
    const cancellable = await start(STONE.node, "res_start_cancel_2");
    const cancelAction = ((await body(cancellable)) as { data: { action: { actionId: string; version: number } } })
      .data.action;
    const cancelled = await cancel(cancelAction.actionId, cancelAction.version, "res_cancel_1");
    expect(cancelled.status).toBe(200);
    await expect(body(cancelled)).resolves.toEqual({ ok: true, data: { cancelled: true } });
    clock.advanceSeconds(STONE.actionSeconds + 1);
    expect((await settle(cancelAction.actionId, cancelAction.version, "res_settle_after_cancel")).status).toBe(409);
    // Not depleted by the cancel: a new gather starts immediately.
    expect((await start(STONE.node, "res_start_after_cancel")).status).toBe(201);

    // 10. Sell the material through the same market as produce.
    const before = balance();
    const sold = await post("/shop/sell", {
      requestId: "res_sell_1",
      shopEntryId: "shop_stone",
      quantity: STONE.quantity
    });
    expect(sold.status).toBe(200);
    expect(balance()).toBe(before + STONE.quantity);
  });

  it("settles exactly one of two concurrent attempts at one node", async () => {
    await createFarm();
    const started = await start(STONE.node, "race_start");
    const action = ((await body(started)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(STONE.actionSeconds + 1);

    const [first, second] = await Promise.all([
      settle(action.actionId, action.version, "race_settle_a"),
      settle(action.actionId, action.version, "race_settle_b")
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(held(STONE.item)).toBe(STONE.quantity);
    expect(xp()).toBe(STONE.xp);

    // And two *separate* attempts at the same node can only deplete it once. The second action is
    // seeded directly, which is what a second player in a shared zone would produce later.
    db.sqlite
      .prepare(
        "INSERT INTO resource_actions (action_id, actor_player_id, zone_kind, zone_id, node_id, definition_id, verb, status, started_at, ready_at, settled_at, version, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, ?, 'resource_stone', 'MINE', 'ACTIVE', ?, ?, NULL, 1, ?, ?)"
      )
      .run(
        "resact_22222222-2222-4222-8222-222222222222",
        PLAYER_ONE_ID,
        `zone_home_island_${FARM_ONE_ID}`,
        STONE.node,
        NOW,
        NOW,
        NOW,
        NOW
      );
    const secondAttempt = await settle(
      "resact_22222222-2222-4222-8222-222222222222",
      1,
      "race_settle_c"
    );
    expect(secondAttempt.status).toBe(409);
    await expect(body(secondAttempt)).resolves.toMatchObject({
      ok: false,
      error: { code: "RESOURCE_NODE_DEPLETED" }
    });
    expect(held(STONE.item)).toBe(STONE.quantity);
  });

  it("keeps an offline player's node regeneration: time alone restores it", async () => {
    await createFarm();
    const { settled } = await startAndSettle(STONE.node, "offline");
    expect(settled.status).toBe(200);
    expect((await nodes()).find((node) => node.nodeId === STONE.node)?.available).toBe(false);

    // The player closes the game: no request at all until they return.
    clock.advanceSeconds(STONE.regenerationSeconds * 3);
    const list = await nodes();
    expect(list.find((node) => node.nodeId === STONE.node)?.available).toBe(true);
    expect(list.every((node) => node.available || node.secondsUntilAvailable > 0)).toBe(true);
  });

  it("refuses unknown nodes, unknown actions, foreign actors and smuggled rewards", async () => {
    await createFarm();

    const unknown = await start("node_nowhere", "bad_node");
    expect(unknown.status).toBe(404);
    await expect(body(unknown)).resolves.toMatchObject({ ok: false, error: { code: "RESOURCE_NODE_NOT_FOUND" } });

    // A client cannot name a quantity, an item, or an experience reward: the schemas are strict.
    expect((await post("/resource-actions/start", { requestId: "bad_smuggle", nodeId: STONE.node, quantity: 99 })).status).toBe(400);
    expect(
      (
        await post("/resource-actions/resact_11111111-1111-4111-8111-111111111111/settle", {
          requestId: "bad_smuggle_settle",
          expectedActionVersion: 1,
          itemDefinitionId: "item_iron_ore"
        })
      ).status
    ).toBe(400);
    expect((await post("/resource-actions/start", "{not json")).status).toBe(400);
    expect((await settle("not-an-action", 1, "bad_action_id")).status).toBe(400);
    expect((await settle("resact_11111111-1111-4111-8111-999999999999", 1, "missing_action")).status).toBe(404);

    // Another player's action is not theirs to settle.
    const started = await start(STONE.node, "mine_start");
    const action = ((await body(started)) as { data: { action: { actionId: string; version: number } } }).data.action;
    clock.advanceSeconds(STONE.actionSeconds + 1);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Miner Two', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_TWO_ID, NOW, NOW);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await settle(action.actionId, action.version, "not_mine")).status).toBe(404);
    auth.setActor(null);
    expect((await get("/resource-nodes")).status).toBe(401);
    expect((await start(STONE.node, "unauthenticated")).status).toBe(401);
  });

  it("uses real entropy in production, not a fixed value", () => {
    const random = new CryptoResourceRandom();
    const rolls = Array.from({ length: 64 }, () => random.roll());
    for (const roll of rolls) {
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });
});
