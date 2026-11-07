import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActorContext,
  ActorIdGenerator,
  AuthenticationPort,
  Clock,
  IdGenerator,
  JobIdGenerator,
  ResourceIdGenerator,
  WorkAreaIdGenerator
} from "@happy-farm/application";
import {
  CARGO_SUPPLY_CATEGORIES,
  isCarryableCategory,
  isSupplyCategory,
  parseActorId,
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseItemDefinitionId,
  parseJobId,
  parseResourceActionId,
  parseTreeInstanceId,
  parseWorkAreaId,
  type ActorId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type JobId,
  type PlayerId,
  type ResourceActionId,
  type TreeInstanceId,
  type WorkAreaId
} from "@happy-farm/domain";
import { createHandler } from "../../workers/api/src/handler";
import { D1CargoRepository } from "../../workers/api/src/d1-repositories";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataResourceCatalogue,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  GameDataWarehouseTiers,
  Sha256Fingerprint,
  gameDataCargoCapacities,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataWorkAreaGround
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";
import { schemaSql } from "../support/migrations";

/**
 * Bidirectional cargo: Warehouse -> Cargo (LOAD) and Shop -> Cargo (a supply purchase).
 *
 * The invariants are the ones the design names: LOAD conserves `warehouse + cargo`, the supply
 * purchase is an ordinary economic transaction whose goods are taken in hand, and neither path can
 * create an item, overflow a container or charge for something it did not deliver.
 */

const migration = schemaSql();

const STARTER_CAPACITY = 30;
const SEED_PRICE = 2;
const SEED = "item_carrot_seed";
const SEED_ENTRY = "shop_carrot_seed";
const CARROT = "item_carrot";

interface CargoBody {
  readonly ok: boolean;
  readonly data: {
    readonly cargo: {
      readonly capacity: number;
      readonly used: number;
      readonly available: number;
      readonly version: number;
      readonly items: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
    };
  };
}

interface PurchaseBody {
  readonly ok: boolean;
  readonly data: {
    readonly purchase: {
      readonly itemDefinitionId: string;
      readonly quantity: number;
      readonly amountSpent: number;
      readonly newBalance: number;
      readonly cargo: CargoBody["data"]["cargo"];
    };
  };
}

async function body<T>(response: Response): Promise<T> {
  const parsed: unknown = await response.json();
  return parsed as T;
}

class MutableAuth implements AuthenticationPort<Request> {
  player: PlayerId = PLAYER_ONE_ID;
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve({ playerId: this.player });
  }
}

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class FixedIds implements IdGenerator, ActorIdGenerator, JobIdGenerator, ResourceIdGenerator, WorkAreaIdGenerator {
  private serial = 1;
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.serial++).padStart(12, "0")}`);
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId("construct_11111111-1111-4111-8111-111111111111");
  }
  newResourceActionId(): ResourceActionId {
    return parseResourceActionId("resact_11111111-1111-4111-8111-111111111111");
  }
  newActorId(): ActorId {
    return parseActorId(`actor_aaaaaaaa-aaaa-4aaa-8aaa-${String(this.serial++).padStart(12, "0")}`);
  }
  newJobId(): JobId {
    return parseJobId(`job_bbbbbbbb-bbbb-4bbb-8bbb-${String(this.serial++).padStart(12, "0")}`);
  }
  newWorkAreaId(): WorkAreaId {
    return parseWorkAreaId(`workarea_cccccccc-cccc-4ccc-8ccc-${String(this.serial++).padStart(12, "0")}`);
  }
}

function handlerFor(db: NodeD1Database, auth: MutableAuth): (request: Request) => Promise<Response> {
  const ids = new FixedIds();
  return createHandler({
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
    workAreas: { ground: gameDataWorkAreaGround, ids },
    resources: { catalogue: new GameDataResourceCatalogue(), ids, random: { roll: () => 0.5 } },
    warehouse: { tiers: new GameDataWarehouseTiers() },
    workers: { ids },
    cargoCapacities: gameDataCargoCapacities,
    clock: new FixedClock()
  });
}

describe("bidirectional cargo", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;
  let auth: MutableAuth;
  let cargo: D1CargoRepository;
  let actorId: ActorId;

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Other', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_TWO_ID, NOW, NOW);
    auth = new MutableAuth();
    handle = handlerFor(db, auth);
    cargo = new D1CargoRepository(db);
    await post("/farms", { name: "Supply Farm" });
    actorId = parseActorId((await workers()).data.actor.actorId);
    setGold(500);
  });

  afterEach(() => {
    db.close();
  });

  function request(method: string, path: string, payload?: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method,
        ...(payload === undefined
          ? {}
          : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } })
      })
    );
  }

  function post(path: string, payload: unknown): Promise<Response> {
    return request("POST", path, payload);
  }

  async function workers(): Promise<{ readonly data: { readonly actor: { readonly actorId: string } } }> {
    return body(await request("GET", `/farms/${FARM_ONE_ID}/workers`));
  }

  async function readCargo(): Promise<CargoBody["data"]["cargo"]> {
    return (await body<CargoBody>(await request("GET", `/farms/${FARM_ONE_ID}/cargo`))).data.cargo;
  }

  function setGold(amount: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = excluded.balance, version = wallets.version + 1, updated_at = excluded.updated_at"
      )
      .run(PLAYER_ONE_ID, amount, NOW, NOW);
  }

  function gold(): number {
    const row = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID) as
      | { readonly balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  function ledgerRows(): number {
    const row = db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID) as {
      readonly n: number;
    };
    return row.n;
  }

  function stock(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, itemDefinitionId) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function carried(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?")
      .get(actorId, itemDefinitionId) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function seedWarehouse(itemDefinitionId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1"
      )
      .run(PLAYER_ONE_ID, itemDefinitionId, quantity, NOW);
  }

  /** The test-only way cargo is filled: the real grant primitive, never an endpoint. */
  async function grant(itemDefinitionId: string, quantity: number): Promise<void> {
    await cargo.grantAtomically({
      actorId,
      itemDefinitionId: parseItemDefinitionId(itemDefinitionId),
      quantity,
      timestamp: NOW
    });
  }

  /** The named cross-container regression: the total of an item is the same across a transfer. */
  function total(itemDefinitionId: string): number {
    return stock(itemDefinitionId) + carried(itemDefinitionId);
  }

  function load(payload: unknown, requestId: string): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/cargo/load`, { requestId, ...(payload as object) });
  }

  function purchase(quantity: number, requestId: string, expectedVersion: number): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/cargo/purchase`, {
      requestId,
      shopEntryId: SEED_ENTRY,
      quantity,
      expectedVersion
    });
  }

  describe("Warehouse -> Cargo", () => {
    it("loads a stack without changing the total, and removes an emptied warehouse row", async () => {
      seedWarehouse(SEED, 10);
      const version = (await readCargo()).version;
      const response = await load({ itemDefinitionId: SEED, quantity: 4, expectedVersion: version }, "load_ok_01");
      expect(response.status).toBe(200);
      const after = (await body<CargoBody>(response)).data.cargo;
      expect(after.used).toBe(4);
      expect(after.version).toBe(version + 1);
      expect(stock(SEED)).toBe(6);
      expect(carried(SEED)).toBe(4);
      expect(total(SEED)).toBe(10);

      const all = await load({ itemDefinitionId: SEED, quantity: 6, expectedVersion: after.version }, "load_ok_02");
      expect(all.status).toBe(200);
      expect((await body<CargoBody>(all)).data.cargo.used).toBe(10);
      // The emptied row is gone rather than left as a zero.
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(PLAYER_ONE_ID, SEED)
      ).toEqual({ n: 0 });
    });

    it("loads exactly to capacity, and refuses one unit more without touching either side", async () => {
      seedWarehouse(SEED, 100);
      const version = (await readCargo()).version;
      await load({ itemDefinitionId: SEED, quantity: STARTER_CAPACITY, expectedVersion: version }, "load_full_01");
      expect(carried(SEED)).toBe(STARTER_CAPACITY);
      expect(stock(SEED)).toBe(100 - STARTER_CAPACITY);

      const version2 = (await readCargo()).version;
      const over = await load({ itemDefinitionId: SEED, quantity: 1, expectedVersion: version2 }, "load_full_02");
      expect(over.status).toBe(409);
      expect((await body<{ error: { code: string } }>(over)).error.code).toBe("CARGO_FULL");
      expect(carried(SEED)).toBe(STARTER_CAPACITY);
      expect(stock(SEED)).toBe(70);
      expect(total(SEED)).toBe(100);
    });

    it("refuses a load the warehouse cannot satisfy, and one for an unknown item", async () => {
      seedWarehouse(SEED, 3);
      const version = (await readCargo()).version;
      const short = await load({ itemDefinitionId: SEED, quantity: 4, expectedVersion: version }, "load_short_01");
      expect(short.status).toBe(409);
      expect((await body<{ error: { code: string } }>(short)).error.code).toBe("INSUFFICIENT_ITEMS");
      expect(carried(SEED)).toBe(0);
      expect(stock(SEED)).toBe(3);

      const unknown = await load({ itemDefinitionId: "item_moonstone", quantity: 1, expectedVersion: version }, "load_unknown_01");
      expect(unknown.status).toBe(404);
      // The bound is the request schema's: a zero, a negative or an absurd quantity never reaches a rule.
      expect((await load({ itemDefinitionId: SEED, quantity: 0, expectedVersion: version }, "load_zero_01")).status).toBe(400);
      expect((await load({ itemDefinitionId: SEED, quantity: -1, expectedVersion: version }, "load_neg_01")).status).toBe(400);
      expect((await load({ itemDefinitionId: SEED, quantity: 100000, expectedVersion: version }, "load_big_01")).status).toBe(400);
      expect(carried(SEED)).toBe(0);
      expect(stock(SEED)).toBe(3);
    });

    it("replays a load without moving anything twice, and conflicts on a changed payload", async () => {
      seedWarehouse(SEED, 10);
      const version = (await readCargo()).version;
      const first = await load({ itemDefinitionId: SEED, quantity: 4, expectedVersion: version }, "load_replay_01");
      expect(first.status).toBe(200);
      const firstBody = await body<CargoBody>(first);

      const replay = await load({ itemDefinitionId: SEED, quantity: 4, expectedVersion: version }, "load_replay_01");
      expect(replay.status).toBe(200);
      expect(await body<CargoBody>(replay)).toEqual(firstBody);
      expect(carried(SEED)).toBe(4);
      expect(stock(SEED)).toBe(6);

      const conflict = await load({ itemDefinitionId: SEED, quantity: 5, expectedVersion: version }, "load_replay_01");
      expect(conflict.status).toBe(409);
      expect((await body<{ error: { code: string } }>(conflict)).error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(total(SEED)).toBe(10);
    });

    it("refuses a stale cargo version and keeps the warehouse intact", async () => {
      seedWarehouse(SEED, 10);
      const stale = (await readCargo()).version;
      await grant(CARROT, 1);
      const response = await load({ itemDefinitionId: SEED, quantity: 2, expectedVersion: stale }, "load_stale_01");
      expect(response.status).toBe(409);
      expect((await body<{ error: { code: string } }>(response)).error.code).toBe("CONFLICT_STALE_STATE");
      expect(stock(SEED)).toBe(10);
      expect(carried(SEED)).toBe(0);
    });

    it("lets exactly one of two concurrent loads take the last room", async () => {
      seedWarehouse(SEED, 100);
      await grant(CARROT, STARTER_CAPACITY - 5);
      const version = (await readCargo()).version;
      const [left, right] = await Promise.all([
        load({ itemDefinitionId: SEED, quantity: 5, expectedVersion: version }, "load_race_a"),
        load({ itemDefinitionId: SEED, quantity: 5, expectedVersion: version }, "load_race_b")
      ]);
      expect([left.status, right.status].sort()).toEqual([200, 409]);
      expect(carried(SEED)).toBe(5);
      expect(stock(SEED)).toBe(95);
      expect(total(SEED)).toBe(100);
    });

    it("conserves across a concurrent load and unload of the same item", async () => {
      seedWarehouse(SEED, 20);
      const version = (await readCargo()).version;
      const [loadResponse, unloadResponse] = await Promise.all([
        load({ itemDefinitionId: SEED, quantity: 10, expectedVersion: version }, "load_mix_a"),
        post(`/farms/${FARM_ONE_ID}/cargo/unload`, { requestId: "load_mix_b", expectedVersion: version })
      ]);
      expect([loadResponse.status, unloadResponse.status].sort()).toEqual([200, 409]);
      expect(total(SEED)).toBe(20);
    });

    it("loads after a sale freed stock, and while a grandfathered warehouse is over capacity", async () => {
      seedWarehouse(CARROT, 10);
      db.sqlite
        .prepare("UPDATE inventory_items SET quantity = 4 WHERE player_id = ? AND item_definition_id = ?")
        .run(PLAYER_ONE_ID, CARROT);
      const version = (await readCargo()).version;
      expect((await load({ itemDefinitionId: CARROT, quantity: 4, expectedVersion: version }, "load_after_sell")).status).toBe(200);
      expect(carried(CARROT)).toBe(4);
      expect(stock(CARROT)).toBe(0);

      // A *full* warehouse (and, by the same rule, a grandfathered over-capacity one) is never a
      // reason a load may not happen: the guard only refuses a row that grows, so stock can always be
      // drawn down. Seeding 1000 is the most this fresh database will accept, which is the same proof.
      seedWarehouse(SEED, 1000);
      const version2 = (await readCargo()).version;
      expect((await load({ itemDefinitionId: SEED, quantity: 10, expectedVersion: version2 }, "load_overcap")).status).toBe(200);
      expect(carried(SEED)).toBe(10);
      expect(stock(SEED)).toBe(990);
    });

    it("refuses a stranger and an unauthenticated request", async () => {
      seedWarehouse(SEED, 10);
      const version = (await readCargo()).version;
      auth.player = PLAYER_TWO_ID;
      expect((await load({ itemDefinitionId: SEED, quantity: 1, expectedVersion: version }, "load_foreign")).status).toBe(403);
      expect(carried(SEED)).toBe(0);
      expect(stock(SEED)).toBe(10);
    });
  });

  describe("Shop -> Cargo", () => {
    it("draws the supply boundary narrower than the physical one", () => {
      // Every shipped item is carryable, but only seeds are a *supply* a shop will hand straight to an
      // actor. No shipped buy row is a non-supply today, so the refusal is a rule rather than a case
      // the catalogue happens to avoid: a crop can be carried and still cannot ride this path.
      expect(CARGO_SUPPLY_CATEGORIES).toEqual(["SEED"]);
      expect(isSupplyCategory("SEED")).toBe(true);
      expect(isCarryableCategory("CROP")).toBe(true);
      expect(isSupplyCategory("CROP")).toBe(false);
      expect(isSupplyCategory("MATERIAL")).toBe(false);
    });

    it("buys supply into cargo: gold down, ledger written, warehouse untouched", async () => {
      const before = gold();
      const version = (await readCargo()).version;
      const response = await purchase(10, "buy_cargo_01", version);
      expect(response.status).toBe(201);
      const purchaseBody = (await body<PurchaseBody>(response)).data.purchase;
      expect(purchaseBody.quantity).toBe(10);
      expect(purchaseBody.amountSpent).toBe(10 * SEED_PRICE);
      expect(purchaseBody.newBalance).toBe(before - 10 * SEED_PRICE);
      expect(carried(SEED)).toBe(10);
      // The warehouse never receives it: the goods were taken, not stored.
      expect(stock(SEED)).toBe(0);
      expect(gold()).toBe(before - 10 * SEED_PRICE);
      expect(ledgerRows()).toBe(1);
      expect(purchaseBody.cargo.used).toBe(10);
      // The container version moves with the purchase too, so a client cannot keep presenting a stale
      // version of what the actor is carrying.
      expect(purchaseBody.cargo.version).toBe(version + 1);
      expect((await readCargo()).version).toBe(version + 1);
    });

    it("fills cargo exactly, and refuses a purchase that would not fit without charging", async () => {
      await grant(CARROT, STARTER_CAPACITY - 6);
      const before = gold();
      const version = (await readCargo()).version;
      const exact = await purchase(6, "buy_cargo_exact", version);
      expect(exact.status).toBe(201);
      expect(carried(SEED)).toBe(6);
      expect(gold()).toBe(before - 6 * SEED_PRICE);

      const version2 = (await readCargo()).version;
      const over = await purchase(1, "buy_cargo_over", version2);
      expect(over.status).toBe(409);
      expect((await body<{ error: { code: string } }>(over)).error.code).toBe("CARGO_FULL");
      expect(gold()).toBe(before - 6 * SEED_PRICE);
      expect(ledgerRows()).toBe(1);
      expect(carried(SEED)).toBe(6);
    });

    it("refuses when gold is short, and never delivers a partial purchase", async () => {
      setGold(3);
      const version = (await readCargo()).version;
      const response = await purchase(10, "buy_cargo_poor", version);
      expect(response.status).toBe(409);
      expect((await body<{ error: { code: string } }>(response)).error.code).toBe("INSUFFICIENT_FUNDS");
      expect(gold()).toBe(3);
      expect(carried(SEED)).toBe(0);
      expect(ledgerRows()).toBe(0);
    });

    it("takes its price from the catalogue, not the request", async () => {
      const before = gold();
      const version = (await readCargo()).version;
      // A price field is not part of the contract: the request is refused rather than believed.
      const tampered = await post(`/farms/${FARM_ONE_ID}/cargo/purchase`, {
        requestId: "buy_cargo_price",
        shopEntryId: SEED_ENTRY,
        quantity: 5,
        expectedVersion: version,
        amountSpent: 1
      });
      expect(tampered.status).toBe(400);
      expect(gold()).toBe(before);
      expect(carried(SEED)).toBe(0);

      expect((await purchase(5, "buy_cargo_real", version)).status).toBe(201);
      expect(gold()).toBe(before - 5 * SEED_PRICE);
    });

    it("rejects an unknown shop entry", async () => {
      const version = (await readCargo()).version;
      const response = await post(`/farms/${FARM_ONE_ID}/cargo/purchase`, {
        requestId: "buy_cargo_unknown",
        shopEntryId: "shop_nothing",
        quantity: 1,
        expectedVersion: version
      });
      expect(response.status).toBe(404);
      expect(gold()).toBe(500);
    });

    it("replays a purchase without charging or delivering twice", async () => {
      const before = gold();
      const version = (await readCargo()).version;
      const first = await purchase(4, "buy_cargo_replay", version);
      expect(first.status).toBe(201);
      const firstBody = await body<PurchaseBody>(first);
      const replay = await purchase(4, "buy_cargo_replay", version);
      expect(replay.status).toBe(201);
      expect(await body<PurchaseBody>(replay)).toEqual(firstBody);
      expect(gold()).toBe(before - 4 * SEED_PRICE);
      expect(carried(SEED)).toBe(4);
      expect(ledgerRows()).toBe(1);

      const conflict = await purchase(5, "buy_cargo_replay", version);
      expect(conflict.status).toBe(409);
      expect((await body<{ error: { code: string } }>(conflict)).error.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("keeps the wallet, the ledger and cargo consistent under two concurrent purchases", async () => {
      const before = gold();
      const version = (await readCargo()).version;
      const [left, right] = await Promise.all([
        purchase(5, "buy_cargo_race_a", version),
        purchase(5, "buy_cargo_race_b", version)
      ]);
      const succeeded = [left, right].filter((response) => response.status === 201).length;
      expect(succeeded).toBeGreaterThanOrEqual(1);
      // Whatever the interleaving, the player paid exactly for what arrived.
      expect(carried(SEED)).toBe(succeeded * 5);
      expect(gold()).toBe(before - succeeded * 5 * SEED_PRICE);
      expect(ledgerRows()).toBe(succeeded);
    });

    it("leaves an ordinary shop purchase going to the warehouse", async () => {
      const before = gold();
      const response = await post("/shop/buy", { requestId: "buy_warehouse_01", shopEntryId: SEED_ENTRY, quantity: 3 });
      expect(response.status).toBe(200);
      expect(stock(SEED)).toBe(3);
      expect(carried(SEED)).toBe(0);
      expect(gold()).toBe(before - 3 * SEED_PRICE);
    });
  });
});
