import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActorContext,
  ActorIdGenerator,
  AuthenticationPort,
  Clock,
  CargoGrant,
  IdGenerator,
  JobIdGenerator,
  ResourceIdGenerator,
  WorkAreaIdGenerator
} from "@happy-farm/application";
import { CargoService } from "@happy-farm/application";
import {
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
 * Actor cargo and the one transfer that empties it.
 *
 * The invariants under test are the ones the brief names: cargo is a **separate container** from the
 * warehouse, nothing may exceed its capacity, and a transfer either moves every item or moves none.
 * Conservation is asserted directly - `cargo[item] + warehouse[item]` is the same before and after a
 * success, a failure and a replay - because "no duplication, no loss" is the whole point of the slice.
 */

const migration = schemaSql();

const STARTER_CAPACITY = 30;
const CARROT = "item_carrot";
const WOOD = "item_wood";

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

/** The house pattern for reading a response in a test: unknown in, the asserted shape out. */
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
    return parseEconomyTransactionId("econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
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

describe("actor cargo and the warehouse transfer", () => {
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
    await post("/farms", { name: "Cargo Farm" });
    const panel = await workers();
    actorId = parseActorId(panel.data.actor.actorId);
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 500, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  function request(method: string, path: string, body?: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } })
      })
    );
  }

  function post(path: string, body: unknown): Promise<Response> {
    return request("POST", path, body);
  }

  async function json<T>(response: Response): Promise<T> {
    const body: unknown = await response.json();
    return body as T;
  }

  async function readCargo(): Promise<CargoBody> {
    return json<CargoBody>(await request("GET", `/farms/${FARM_ONE_ID}/cargo`));
  }

  async function workers(): Promise<{ readonly data: { readonly actor: { readonly actorId: string } } }> {
    return json(await request("GET", `/farms/${FARM_ONE_ID}/workers`));
  }

  /** The test-only way cargo is filled: the real grant primitive, not an endpoint. */
  async function grant(itemDefinitionId: string, quantity: number): Promise<void> {
    const grant: CargoGrant = {
      actorId,
      itemDefinitionId: parseItemDefinitionId(itemDefinitionId),
      quantity,
      timestamp: NOW
    };
    await cargo.grantAtomically(grant);
  }

  function warehouseQuantity(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, itemDefinitionId) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function cargoQuantity(itemDefinitionId: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?")
      .get(actorId, itemDefinitionId) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  /** The named regression the brief asks for: the total of each item is the same across the transfer. */
  function total(itemDefinitionId: string): number {
    return cargoQuantity(itemDefinitionId) + warehouseQuantity(itemDefinitionId);
  }

  async function unload(requestId: string, expectedVersion: number): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/cargo/unload`, { requestId, expectedVersion });
  }

  it("starts empty, at the starter capacity, as a container separate from the warehouse", async () => {
    const body = await readCargo();
    expect(body.data.cargo).toEqual({
      capacity: STARTER_CAPACITY,
      used: 0,
      available: STARTER_CAPACITY,
      version: 1,
      items: []
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items").get()).toEqual({ n: 0 });
  });

  it("accepts a grant up to capacity and refuses one past it", async () => {
    await grant(CARROT, STARTER_CAPACITY - 1);
    expect((await readCargo()).data.cargo.used).toBe(STARTER_CAPACITY - 1);
    await grant(WOOD, 1);
    expect((await readCargo()).data.cargo.used).toBe(STARTER_CAPACITY);

    // The database's own guard, reached through the grant primitive rather than a pre-check.
    await expect(grant(CARROT, 1)).rejects.toMatchObject({ code: "CARGO_FULL" });
    expect((await readCargo()).data.cargo.used).toBe(STARTER_CAPACITY);

    // And the application's pre-check says the same thing before anything is written.
    const service = new CargoService(
      new GameDataItemDefinitions(),
      gameDataCargoCapacities,
      new FixedClock()
    );
    expect(() => service.prepareGrant(actorId, STARTER_CAPACITY, STARTER_CAPACITY, CARROT, 1)).toThrow(
      /carry any more/u
    );
    expect(service.prepareGrant(actorId, STARTER_CAPACITY, 0, CARROT, 5).quantity).toBe(5);
    expect(() => service.prepareGrant(actorId, STARTER_CAPACITY, 0, "item_moonstone", 1)).toThrow(
      /was not found/u
    );
    expect(() => service.prepareGrant(actorId, STARTER_CAPACITY, 0, CARROT, 0)).toThrow(/positive/u);
  });

  it("moves every carried stack into the warehouse and conserves the totals", async () => {
    await grant(CARROT, 20);
    await grant(WOOD, 5);
    const before = { carrot: total(CARROT), wood: total(WOOD) };
    const version = (await readCargo()).data.cargo.version;

    const response = await unload("cargo_unload_01", version);
    expect(response.status).toBe(200);
    const after = await json<CargoBody>(response);
    expect(after.data.cargo.used).toBe(0);
    expect(after.data.cargo.items).toEqual([]);
    expect(warehouseQuantity(CARROT)).toBe(20);
    expect(warehouseQuantity(WOOD)).toBe(5);
    // Conservation: nothing was created and nothing was lost.
    expect(total(CARROT)).toBe(before.carrot);
    expect(total(WOOD)).toBe(before.wood);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_cargo_items").get()).toEqual({ n: 0 });
  });

  it("refuses the whole transfer when the warehouse cannot take it, and leaves both sides untouched", async () => {
    await grant(CARROT, 20);
    // 995 of 1000 already stored: five units of room for twenty carried.
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_wood', 995, 1, ?)"
      )
      .run(PLAYER_ONE_ID, NOW);
    const cargoBefore = cargoQuantity(CARROT);
    const warehouseBefore = warehouseQuantity(WOOD);
    const version = (await readCargo()).data.cargo.version;

    const response = await unload("cargo_unload_02", version);
    expect(response.status).toBe(409);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe("WAREHOUSE_FULL");
    // No partial unload: the cargo is still on the actor and the warehouse is exactly as it was.
    expect(cargoQuantity(CARROT)).toBe(cargoBefore);
    expect(warehouseQuantity(WOOD)).toBe(warehouseBefore);
    expect(warehouseQuantity(CARROT)).toBe(0);
    expect(total(CARROT)).toBe(cargoBefore);
    // And no receipt was written for a transfer that never happened.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE operation = 'UNLOAD_CARGO'").get()).toEqual({ n: 0 });
  });

  it("allows an unload that exactly fills the warehouse, and one after selling frees room", async () => {
    await grant(CARROT, 5);
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_wood', 995, 1, ?)"
      )
      .run(PLAYER_ONE_ID, NOW);
    const version = (await readCargo()).data.cargo.version;
    expect((await unload("cargo_unload_03", version)).status).toBe(200);
    expect(warehouseQuantity(WOOD)).toBe(995);
    expect(warehouseQuantity(CARROT)).toBe(5);
    expect(total(CARROT) + total(WOOD)).toBe(1000);

    // Sell ten wood, then carry and unload five more carrots: the freed room is enough.
    await grant(WOOD, 5);
    const version2 = (await readCargo()).data.cargo.version;
    db.sqlite.prepare("UPDATE inventory_items SET quantity = 985 WHERE player_id = ? AND item_definition_id = 'item_wood'").run(PLAYER_ONE_ID);
    expect((await unload("cargo_unload_04", version2)).status).toBe(200);
    expect(warehouseQuantity(WOOD)).toBe(990);
    expect(cargoQuantity(WOOD)).toBe(0);
  });

  it("replays a successful unload without moving anything twice", async () => {
    await grant(CARROT, 12);
    const version = (await readCargo()).data.cargo.version;
    const first = await unload("cargo_replay_01", version);
    expect(first.status).toBe(200);
    const firstBody = await json<CargoBody>(first);
    const warehouseAfterFirst = warehouseQuantity(CARROT);

    const replay = await unload("cargo_replay_01", version);
    expect(replay.status).toBe(200);
    expect(await json<CargoBody>(replay)).toEqual(firstBody);
    expect(warehouseQuantity(CARROT)).toBe(warehouseAfterFirst);
    expect(cargoQuantity(CARROT)).toBe(0);

    const conflicting = await unload("cargo_replay_01", version + 9);
    expect(conflicting.status).toBe(409);
    expect((await json<{ error: { code: string } }>(conflicting)).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses a stale cargo version instead of unloading a state nobody read", async () => {
    await grant(CARROT, 4);
    const stale = (await readCargo()).data.cargo.version;
    await grant(WOOD, 4);
    const response = await unload("cargo_stale_01", stale);
    expect(response.status).toBe(409);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe("CONFLICT_STALE_STATE");
    expect(cargoQuantity(CARROT)).toBe(4);
    expect(cargoQuantity(WOOD)).toBe(4);
    expect(warehouseQuantity(CARROT)).toBe(0);
  });

  it("lets exactly one of two concurrent unloads win", async () => {
    await grant(CARROT, 7);
    const version = (await readCargo()).data.cargo.version;
    const [left, right] = await Promise.all([unload("cargo_race_a", version), unload("cargo_race_b", version)]);
    const codes = [left.status, right.status].sort();
    expect(codes).toEqual([200, 409]);
    // Exactly one transfer happened, and the item total is unchanged.
    expect(warehouseQuantity(CARROT)).toBe(7);
    expect(cargoQuantity(CARROT)).toBe(0);
    expect(total(CARROT)).toBe(7);
  });

  it("is a no-op on empty cargo and never writes a receipt for one", async () => {
    const version = (await readCargo()).data.cargo.version;
    const response = await unload("cargo_empty_01", version);
    expect(response.status).toBe(200);
    expect((await json<CargoBody>(response)).data.cargo.used).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE operation = 'UNLOAD_CARGO'").get()).toEqual({ n: 0 });
  });

  it("moves no gold, no experience and no ledger row", async () => {
    await grant(CARROT, 6);
    const version = (await readCargo()).data.cargo.version;
    expect((await unload("cargo_economy_01", version)).status).toBe(200);
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 500 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ n: 0 });
  });

  it("refuses a caller who does not own the farm, and never touches the actor", async () => {
    await grant(CARROT, 3);
    const version = (await readCargo()).data.cargo.version;
    auth.player = PLAYER_TWO_ID;
    expect((await request("GET", `/farms/${FARM_ONE_ID}/cargo`)).status).toBe(403);
    expect((await unload("cargo_auth_01", version)).status).toBe(403);
    expect(cargoQuantity(CARROT)).toBe(3);
  });
});

/**
 * The race the warehouse guard exists for: the pre-check passes, and a competing write fills the
 * warehouse *after* it, before the unload's own transaction commits. The guard must be the authority,
 * so the transfer refuses and the cargo stays put.
 */
describe("a warehouse that fills up after the unload's pre-check", () => {
  let db: NodeD1Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("refuses with WAREHOUSE_FULL and leaves the cargo on the actor", async () => {
    let filled = false;
    const racing = new NodeD1Database(migration, {
      afterStatement: (index) => {
        // Runs inside the unload's transaction, right after its guard: this is the competing grant that
        // arrives once the pre-check has already passed. Fires once, so the test's own cargo seeding
        // (a separate batch on the same database) does not trip it.
        if (index !== 0 || filled) return;
        filled = true;
        racing.sqlite
          .prepare(
            "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_wood', 1000, 1, ?)"
          )
          .run(PLAYER_ONE_ID, NOW);
      }
    });
    db = racing;
    racing.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    const auth = new MutableAuth();
    const handle = handlerFor(racing, auth);
    const cargo = new D1CargoRepository(racing);

    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Race Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    const panel = await body<{ data: { actor: { actorId: string } } }>(
      await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/workers`))
    );
    const actorId = parseActorId(panel.data.actor.actorId);
    await cargo.grantAtomically({
      actorId,
      itemDefinitionId: parseItemDefinitionId(CARROT),
      quantity: 5,
      timestamp: NOW
    });
    const version = (
      await body<CargoBody>(await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/cargo`)))
    ).data.cargo.version;

    const response = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/cargo/unload`, {
        method: "POST",
        body: JSON.stringify({ requestId: "cargo_race_precheck", expectedVersion: version }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(response.status).toBe(409);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("WAREHOUSE_FULL");
    // The transfer did not apply and the cargo is still carried: the guard, not the pre-check, decided.
    const carried = racing.sqlite
      .prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?")
      .get(actorId, CARROT) as { readonly quantity: number } | undefined;
    expect(carried?.quantity).toBe(5);
    const stored = racing.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, CARROT) as { readonly quantity: number } | undefined;
    expect(stored).toBeUndefined();
    // Nothing of the failed transfer survives - not even a receipt for it.
    expect(
      racing.sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE operation = 'UNLOAD_CARGO'").get()
    ).toEqual({ n: 0 });
  });
});
