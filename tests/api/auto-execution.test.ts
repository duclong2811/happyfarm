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
  parseActorId,
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
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
 * The Auto executor, end to end, through the real handler.
 *
 * Every assertion here is about the *world* the server changed, not about the shape of a response: a
 * crop row, a cargo stack, a warehouse count, a wallet, a ledger row. The loop is driven exactly as the
 * browser drives it - one step per call, with the clock moved past each walk - so a run that needed a
 * client to be trusted would fail here.
 */

const migration = schemaSql();

/** The starter field cell the world data calls usable natural land. */
const FIELD_CELLS = [
  { x: 9, y: 26 },
  { x: 9, y: 27 },
  { x: 10, y: 26 }
];

class MutableAuth implements AuthenticationPort<Request> {
  player: PlayerId | null = PLAYER_ONE_ID;
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.player === null ? null : { playerId: this.player });
  }
}

/** A clock the test moves, so a walk and a crop's growth both pass in a few lines. */
class MutableClock implements Clock {
  private millis = Date.parse(NOW);
  now(): string {
    return new Date(this.millis).toISOString();
  }
  advanceSeconds(seconds: number): void {
    this.millis += Math.round(seconds * 1000);
  }
}

class FixedIds implements IdGenerator, ActorIdGenerator, JobIdGenerator, ResourceIdGenerator, WorkAreaIdGenerator {
  private serial = 1;
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId(`cropinst_cccccccc-cccc-4ccc-8ccc-${String(this.serial++).padStart(12, "0")}`);
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

interface StepBody {
  readonly ok: boolean;
  readonly data: {
    readonly step: {
      readonly controlMode: string;
      readonly phase: string;
      readonly step: string | null;
      readonly waitReason: string | null;
      readonly jobId: string | null;
      readonly skillId: string | null;
      readonly targetDefinitionId: string | null;
      readonly itemDefinitionId: string | null;
      readonly quantity: number | null;
      readonly cell: { readonly x: number; readonly y: number } | null;
      readonly from: { readonly kind: string; readonly x: number | null; readonly y: number | null } | null;
      readonly to: { readonly kind: string; readonly x: number | null; readonly y: number | null } | null;
      readonly arrivesAt: string | null;
      readonly retryAfterMs: number;
      readonly progress: { readonly planted: number; readonly empty: number; readonly mature: number } | null;
      readonly cargo: { readonly used: number; readonly capacity: number };
    };
  };
}

describe("Auto execution (D2)", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;
  let auth: MutableAuth;
  let clock: MutableClock;
  let stepSerial = 0;

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
    clock = new MutableClock();
    const ids = new FixedIds();
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
      workAreas: { ground: gameDataWorkAreaGround, ids },
      resources: { catalogue: new GameDataResourceCatalogue(), ids, random: { roll: () => 0.5 } },
      warehouse: { tiers: new GameDataWarehouseTiers() },
      workers: { ids },
      cargoCapacities: gameDataCargoCapacities,
      clock
    });
    await post("/farms", { name: "Auto Execution Farm" });
    setGold(100);
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

  async function json<T>(response: Response): Promise<T> {
    const parsed: unknown = await response.json();
    return parsed as T;
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

  function count(table: string, where = ""): number {
    const row = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { readonly n: number };
    return row.n;
  }

  function warehouseQuantity(item: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(PLAYER_ONE_ID, item) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function cargoQuantity(item: string): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM actor_cargo_items WHERE actor_id = (SELECT id FROM actors LIMIT 1) AND item_definition_id = ?")
      .get(item) as { readonly quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function autoState():
    | { readonly anchor_kind: string | null; readonly anchor_x: number | null; readonly version: number; readonly simulation_at: string | null; readonly lease_until: string | null; readonly lease_issued_at: string | null }
    | undefined {
    return db.sqlite.prepare("SELECT anchor_kind, anchor_x, version, simulation_at, lease_until, lease_issued_at FROM actor_auto_state LIMIT 1").get() as
      | { readonly anchor_kind: string | null; readonly anchor_x: number | null; readonly version: number; readonly simulation_at: string | null; readonly lease_until: string | null; readonly lease_issued_at: string | null }
      | undefined;
  }

  function receipts(operation: string): number {
    return count("idempotency_keys", `WHERE operation = '${operation}'`);
  }

  function seedWarehouse(item: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1, updated_at = excluded.updated_at"
      )
      .run(PLAYER_ONE_ID, item, quantity, NOW);
  }

  async function createArea(kind: string, name: string, cells: readonly { readonly x: number; readonly y: number }[]): Promise<string> {
    const created = await post(`/farms/${FARM_ONE_ID}/work-areas`, {
      requestId: `exec_area_${name.replace(/\W/gu, "")}_01`,
      kind,
      name,
      cells
    });
    expect(created.status).toBe(201);
    return (await json<{ data: { workArea: { workAreaId: string } } }>(created)).data.workArea.workAreaId;
  }

  async function createJob(workAreaId: string, kind: string, target: string): Promise<{ readonly jobId: string; readonly version: number }> {
    const created = await post(`/farms/${FARM_ONE_ID}/jobs`, {
      requestId: `exec_job_${kind}_${target}_01`,
      workAreaId,
      kind,
      targetDefinitionId: target
    });
    expect(created.status).toBe(201);
    return (await json<{ data: { job: { jobId: string; version: number } } }>(created)).data.job;
  }

  async function startAuto(): Promise<number> {
    const workers = await json<{ data: { actor: { version: number; controlMode: string } } }>(
      await request("GET", `/farms/${FARM_ONE_ID}/workers`)
    );
    const started = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "exec_start_01",
      startAuto: true,
      expectedVersion: workers.data.actor.version
    });
    expect(started.status).toBe(200);
    return (await json<{ data: { actor: { version: number } } }>(started)).data.actor.version;
  }

  async function stopAuto(expectedVersion: number): Promise<void> {
    const stopped = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "exec_stop_01",
      startAuto: false,
      expectedVersion
    });
    expect(stopped.status).toBe(200);
  }

  async function step(): Promise<StepBody["data"]["step"]> {
    stepSerial += 1;
    const response = await post(`/farms/${FARM_ONE_ID}/auto/step`, {
      requestId: `exec_step_${String(stepSerial).padStart(4, "0")}`
    });
    expect(response.status).toBe(200);
    return (await json<StepBody>(response)).data.step;
  }

  /**
   * Drive the loop the way the browser does: one step, then move the clock past whatever the server
   * said it was waiting for. It stops early when there is nothing left to wake up for, so a caller
   * asking for more steps than the run has cannot spin.
   */
  async function drive(limit = 40): Promise<StepBody["data"]["step"][]> {
    const seen: StepBody["data"]["step"][] = [];
    for (let index = 0; index < limit; index += 1) {
      const current = await step();
      seen.push(current);
      if (current.phase === "STOPPED" || current.phase === "RETRY") break;
      if (current.phase === "WAITING" && current.retryAfterMs === 0) break;
      clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
      // The client plays a short gesture after a settlement, then asks again.
      if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    }
    return seen;
  }

  /** One step, with the clock moved past whatever it was waiting for. */
  async function one(): Promise<StepBody["data"]["step"]> {
    const current = await step();
    clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
    if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    return current;
  }

  it("bootstraps an empty field from Warehouse seed: load, walk, plant - one bounded step at a time", async () => {
    const area = await createArea("FARM", "East Field", FIELD_CELLS);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 10);
    await startAuto();

    // One load, then a walk and a plant per cell - seven steps, exactly, with no hidden batch action.
    const loaded = await one();
    expect(loaded.phase).toBe("WORKED");
    expect(loaded.step).toBe("LOAD_INPUT");
    expect(loaded.quantity).toBe(FIELD_CELLS.length);
    expect(warehouseQuantity("item_carrot_seed")).toBe(10 - FIELD_CELLS.length);
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length);

    const planted: StepBody["data"]["step"][] = [];
    for (let index = 0; index < FIELD_CELLS.length; index += 1) {
      const travel = await one();
      expect(travel.phase).toBe("TRAVELLING");
      expect(travel.cell).not.toBeNull();
      // Nothing is planted while the actor is still walking.
      expect(count("crop_instances")).toBe(index);
      const plant = await one();
      expect(plant.phase).toBe("WORKED");
      expect(plant.step).toBe("PLANT");
      planted.push(plant);
    }
    expect(count("crop_instances")).toBe(FIELD_CELLS.length);
    expect(cargoQuantity("item_carrot_seed")).toBe(0);
    expect(planted.at(-1)?.progress?.planted).toBe(FIELD_CELLS.length);

    // Everything is in the ground now, so the next step is a wait the server itself can time.
    const waiting = await step();
    expect(waiting.phase).toBe("WAITING");
    expect(waiting.waitReason).toBe("WAITING_FOR_GROWTH");
    expect(waiting.retryAfterMs).toBeGreaterThan(0);
    expect(count("crop_instances")).toBe(FIELD_CELLS.length);
  });

  it("refuses to settle a distant plant before the walk has landed", async () => {
    const area = await createArea("FARM", "Slow Field", FIELD_CELLS);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 5);
    await startAuto();

    // Load is immediate (the actor starts at the Warehouse), then the walk to the field begins.
    let current = await step();
    expect(current.step).toBe("LOAD_INPUT");
    expect(current.phase).toBe("WORKED");

    current = await step();
    expect(current.phase).toBe("TRAVELLING");
    const arrivesAt = current.arrivesAt;
    expect(arrivesAt).not.toBeNull();

    // Asking again while the walk is still under way changes nothing: no crop, no seed spent.
    const early = await step();
    expect(early.phase).toBe("TRAVELLING");
    expect(early.arrivesAt).toBe(arrivesAt);
    expect(count("crop_instances")).toBe(0);
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length);

    // One second short of arrival is still too early.
    clock.advanceSeconds(Math.max(0.01, early.retryAfterMs / 1000 - 1));
    const stillEarly = await step();
    expect(stillEarly.phase).toBe("TRAVELLING");
    expect(count("crop_instances")).toBe(0);

    // Past arrival it plants.
    clock.advanceSeconds(2);
    const planted = await step();
    expect(planted.phase).toBe("WORKED");
    expect(planted.step).toBe("PLANT");
    expect(count("crop_instances")).toBe(1);
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length - 1);
  });

  it("waits for supply without moving or spending when purchase is off", async () => {
    const area = await createArea("FARM", "Bare Field", FIELD_CELLS);
    await createJob(area, "FARM", "crop_carrot");
    await startAuto();

    const waiting = await step();
    expect(waiting.phase).toBe("WAITING");
    expect(waiting.waitReason).toBe("WAITING_FOR_SUPPLY");
    expect(waiting.retryAfterMs).toBe(0);
    expect(gold()).toBe(100);
    expect(count("economy_ledger")).toBe(0);
    expect(count("crop_instances")).toBe(0);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_auto_state WHERE travel_kind IS NOT NULL").get()
    ).toEqual({ n: 0 });
  });

  it("buys missing seed at the Market and takes it in hand", async () => {
    const area = await createArea("FARM", "Market Field", FIELD_CELLS);
    const job = await createJob(area, "FARM", "crop_carrot");
    await post(`/farms/${FARM_ONE_ID}/assignments/${job.jobId}/policy`, {
      requestId: "exec_policy_01",
      autoPurchaseSupplies: true,
      expectedVersion: job.version
    });
    await startAuto();

    const toMarket = await one();
    expect(toMarket.phase).toBe("TRAVELLING");
    expect(toMarket.to?.kind).toBe("MARKET");
    const bought = await one();
    expect(bought.phase).toBe("WORKED");
    expect(bought.step).toBe("PURCHASE_INPUT");
    expect(bought.quantity).toBe(FIELD_CELLS.length);
    // 3 seeds at the catalogue's own price of 2 gold each, through the ordinary shop settlement.
    expect(gold()).toBe(100 - FIELD_CELLS.length * 2);
    expect(count("economy_ledger", "WHERE reason = 'SHOP_BUY'")).toBe(1);
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length);
  });

  it("runs the whole cycle: plant, wait for maturity, harvest into cargo, unload, replant", async () => {
    const area = await createArea("FARM", "Cycle Field", [{ x: 9, y: 26 }]);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 4);
    await startAuto();

    // One load, one walk, one plant.
    const first = await drive(3);
    expect(first.filter((entry) => entry.step === "PLANT" && entry.phase === "WORKED")).toHaveLength(1);
    expect(count("crop_instances")).toBe(1);
    // The hands are empty again and the field is planted, so growth is the only thing left.
    expect(cargoQuantity("item_carrot_seed")).toBe(0);
    expect(warehouseQuantity("item_carrot_seed")).toBe(3);

    // Grow: the wait the server timed ends at maturity, and the harvest lands in cargo - not the store.
    const grew = await drive(8);
    const harvested = grew.find((entry) => entry.step === "HARVEST" && entry.phase === "WORKED");
    expect(harvested).toBeDefined();
    expect(count("crop_instances")).toBe(0);
    expect(cargoQuantity("item_carrot")).toBe(2);
    expect(warehouseQuantity("item_carrot")).toBe(0);
    expect(count("player_progression")).toBe(1);

    // And the loop continues: the freed cell is replanted with the seed still in the Warehouse.
    const replanted = await drive(3);
    expect(replanted.map((entry) => `${entry.phase}:${entry.step ?? ""}`)).toEqual(["WORKED:LOAD_INPUT", "TRAVELLING:", "WORKED:PLANT"]);
    expect(count("crop_instances")).toBe(1);
    // The 2 carrots are still carried: this design sends the actor home when the hands are *full*, not
    // after every harvest - which is what keeps a small field from being a walk per crop.
    expect(cargoQuantity("item_carrot")).toBe(2);
  });

  it("walks home and unloads when the hands are full, before doing any more field work", async () => {
    const area = await createArea("FARM", "Loaded Field", [{ x: 9, y: 26 }]);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 2);
    // A full pair of hands, legitimately carried: 30 carrots the actor is holding.
    await startAuto();
    const actor = db.sqlite.prepare("SELECT id FROM actors LIMIT 1").get() as { readonly id: string };
    db.sqlite
      .prepare(
        "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 30, 1, ?)"
      )
      .run(actor.id, NOW);

    const seen = await drive(4);
    const unloaded = seen.find((entry) => entry.step === "UNLOAD" && entry.phase === "WORKED");
    expect(unloaded).toBeDefined();
    expect(cargoQuantity("item_carrot")).toBe(0);
    expect(warehouseQuantity("item_carrot")).toBe(30);
    // Nothing was planted before the hands were free.
    const plantIndex = seen.findIndex((entry) => entry.step === "PLANT");
    const unloadIndex = seen.findIndex((entry) => entry.step === "UNLOAD");
    expect(unloadIndex).toBeLessThan(plantIndex === -1 ? Number.MAX_SAFE_INTEGER : plantIndex);
  });

  it("commits the harvest and the Auto timeline in one batch", async () => {
    const area = await createArea("FARM", "Timeline Harvest Field", [{ x: 9, y: 26 }]);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 3);
    await startAuto();
    await drive(3);
    expect(count("crop_instances")).toBe(1);

    let harvestedAt: string | null = null;
    let versionBefore: number | null = null;
    for (let index = 0; index < 12 && harvestedAt === null; index += 1) {
      const before = autoState();
      const at = clock.now();
      const current = await step();
      if (current.step === "HARVEST" && current.phase === "WORKED") {
        harvestedAt = at;
        versionBefore = before?.version ?? null;
      }
      clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
      if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    }

    expect(harvestedAt).not.toBeNull();
    // The watermark the receipt guards is the *harvest's own* event time, so the timeline moved with
    // the economic mutation rather than on a later request.
    expect(autoState()?.simulation_at).toBe(harvestedAt);
    expect(autoState()?.version).toBe((versionBefore ?? 0) + 1);
    expect(autoState()?.anchor_kind).toBe("CELL");
    expect(receipts("AUTO_HARVEST")).toBe(1);
    expect(receipts("HARVEST_CROP")).toBe(1);
    expect(count("harvest_settlements", "WHERE destination = 'CARGO'")).toBe(1);
  });

  it("commits the delivery and the Auto timeline in one batch", async () => {
    const area = await createArea("FARM", "Timeline Delivery Field", [{ x: 9, y: 26 }]);
    await createJob(area, "FARM", "crop_carrot");
    await startAuto();
    const actor = db.sqlite.prepare("SELECT id FROM actors LIMIT 1").get() as { readonly id: string };
    db.sqlite
      .prepare(
        "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 30, 1, ?)"
      )
      .run(actor.id, NOW);

    let deliveredAt: string | null = null;
    let versionBefore: number | null = null;
    for (let index = 0; index < 8 && deliveredAt === null; index += 1) {
      const before = autoState();
      const at = clock.now();
      const current = await step();
      if (current.step === "UNLOAD" && current.phase === "WORKED") {
        deliveredAt = at;
        versionBefore = before?.version ?? null;
      }
      clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
      if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    }

    expect(deliveredAt).not.toBeNull();
    expect(autoState()?.simulation_at).toBe(deliveredAt);
    expect(autoState()?.version).toBe((versionBefore ?? 0) + 1);
    expect(autoState()?.anchor_kind).toBe("WAREHOUSE");
    expect(receipts("AUTO_UNLOAD")).toBe(1);
    expect(receipts("UNLOAD_CARGO")).toBe(0);
    expect(cargoQuantity("item_carrot")).toBe(0);
    expect(warehouseQuantity("item_carrot")).toBe(30);
  });

  it("stops mid-walk without losing the actor, the cargo or the assignment", async () => {
    const area = await createArea("FARM", "Takeover Field", FIELD_CELLS);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 5);
    const version = await startAuto();

    await step(); // LOAD
    const walking = await step();
    expect(walking.phase).toBe("TRAVELLING");
    const anchorBefore = walking.from;

    await stopAuto(version);
    const stopped = await step();
    expect(stopped.phase).toBe("STOPPED");
    expect(stopped.controlMode).toBe("PLAYER_CONTROLLED");
    // The seed is still in hand, the field is still empty, and the walk was abandoned rather than
    // fast-forwarded: the actor stays where the last walk finished.
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length);
    expect(warehouseQuantity("item_carrot_seed")).toBe(5 - FIELD_CELLS.length);
    expect(count("crop_instances")).toBe(0);
    expect(stopped.from?.kind).toBe(anchorBefore?.kind);
    expect(count("actor_jobs")).toBe(1);

    // Starting again resumes from the world as it is, and the seed remains where it was.
    const restarted = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "exec_start_02",
      startAuto: true,
      expectedVersion: version + 1
    });
    expect(restarted.status).toBe(200);
    // The actor is back at the Warehouse (the abandoned walk never landed), so the field is a walk
    // away again - exactly what "resume from the world as it is" means.
    const walkingAgain = await step();
    expect(walkingAgain.phase).toBe("TRAVELLING");
    clock.advanceSeconds(walkingAgain.retryAfterMs / 1000 + 0.05);
    const resumed = await step();
    expect(resumed.step).toBe("PLANT");
    // One was spared for the walk, and this plant spends it.
    expect(cargoQuantity("item_carrot_seed")).toBe(FIELD_CELLS.length - 1);
    expect(count("crop_instances")).toBe(1);
  });

  it("never harvests into hands that cannot hold the reward: the crop waits for room", async () => {
    const area = await createArea("FARM", "Full Hands", [{ x: 9, y: 26 }]);
    await createJob(area, "FARM", "crop_carrot");
    seedWarehouse("item_carrot_seed", 1);
    await startAuto();
    await drive(3);
    expect(count("crop_instances")).toBe(1);

    // Fill the actor's hands to capacity-1 with something else entirely, then let the crop ripen: the
    // 2-unit reward would not fit.
    // Keep the online Auto session alive through the 300-second crop growth by using the existing
    // step cadence; there is no separate lease poll.
    for (let index = 0; index < 6; index += 1) {
      const keepAlive = await step();
      clock.advanceSeconds(keepAlive.retryAfterMs / 1000 + 0.05);
      if (keepAlive.phase === "WORKED") clock.advanceSeconds(0.75);
    }
    const actor = db.sqlite.prepare("SELECT id FROM actors LIMIT 1").get() as { readonly id: string };
    db.sqlite
      .prepare(
        "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', 29, 1, ?) ON CONFLICT(actor_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity"
      )
      .run(actor.id, NOW);

    const first = await step();
    // The hands are the blocker, so the delivery is the next step - and nothing is harvested or
    // destroyed on the way: the crop stays in the ground until there is room for its reward.
    expect(first.phase).toBe("TRAVELLING");
    expect(first.to?.kind).toBe("WAREHOUSE");
    expect(count("crop_instances")).toBe(1);
    expect(cargoQuantity("item_carrot")).toBe(0);

    const rest = await drive(8);
    const unloadIndex = rest.findIndex((entry) => entry.step === "UNLOAD" && entry.phase === "WORKED");
    const harvestIndex = rest.findIndex((entry) => entry.step === "HARVEST" && entry.phase === "WORKED");
    expect(unloadIndex).toBeGreaterThanOrEqual(0);
    expect(harvestIndex).toBeGreaterThan(unloadIndex);
    expect(cargoQuantity("item_carrot")).toBe(2);
  });

  it("does not execute a retired Mining target", async () => {
    const area = await createArea("MINING", "North Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_stone");
    await startAuto();

    const current = await step();
    expect(current.phase).toBe("WAITING");
    expect(current.waitReason).toBe("NO_ELIGIBLE_TARGETS");
    expect(count("resource_actions")).toBe(0);
    expect(count("resource_node_states")).toBe(0);
  });

  it("proves the Main Character Mining lifecycle, direct API exclusivity, replay, stop and lease expiry", async () => {
    const area = await createArea("MINING", "Unified Ore Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    const autoVersion = await startAuto();

    // A second production start is rejected at the API boundary while the same actor is AUTO_CONTROLLED.
    const competing = await post("/resource-actions/start", {
      requestId: "mine_manual_race_01",
      nodeId: "node_stone_west"
    });
    expect(competing.status).toBeGreaterThanOrEqual(400);
    expect(competing.status).toBeLessThan(500);
    seedWarehouse("item_carrot_seed", 1);
    const manualPlant = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "mine_manual_plant_01",
      x: 9,
      y: 26,
      cropDefinitionId: "crop_carrot"
    });
    expect(manualPlant.status).toBeGreaterThanOrEqual(400);
    expect(manualPlant.status).toBeLessThan(500);
    expect(count("crop_instances")).toBe(0);

    // Two API sessions can ask at once, but the actor timeline/cargo boundary permits at most one
    // transition. A second response may observe the same walk; it must not mint a second reward.
    const concurrent = await Promise.all([
      request("POST", `/farms/${FARM_ONE_ID}/auto/step`, { requestId: "mine_tab_a_01" }),
      request("POST", `/farms/${FARM_ONE_ID}/auto/step`, { requestId: "mine_tab_b_01" })
    ]);
    expect(concurrent.some((response) => response.status >= 200 && response.status < 300)).toBe(true);
    expect(count("idempotency_keys", "WHERE operation = 'AUTO_MINE'")).toBe(0);

    let workedMining = 0;
    let sawFullCargo = false;
    let sawUnload = false;
    let sawReturn = false;
    let replayed = false;
    for (let index = 0; index < 100 && !sawReturn; index += 1) {
      const nextRequestId = `exec_step_${String(stepSerial + 1).padStart(4, "0")}`;
      const current = await step();
      if (current.phase === "TRAVELLING") {
        // The actor cannot produce while walking: no work token, item or quantity is returned.
        expect(current.step).toBeNull();
        expect(current.itemDefinitionId).toBeNull();
        expect(current.quantity).toBeNull();
      }
      if (current.phase === "WORKED" && current.step === "MINE") {
        workedMining += 1;
        if (current.cargo.used === current.cargo.capacity) sawFullCargo = true;
        if (sawUnload && !replayed) {
          const before = current.cargo.used;
          const retry = await post(`/farms/${FARM_ONE_ID}/auto/step`, { requestId: nextRequestId });
          expect(retry.status).toBe(200);
          expect((await json<StepBody>(retry)).data.step.cargo.used).toBe(before);
          replayed = true;
        }
        if (sawUnload) sawReturn = true;
      }
      if (current.phase === "TRAVELLING" && current.to?.kind === "WAREHOUSE" && current.cargo.used === current.cargo.capacity) sawFullCargo = true;
      if (current.phase === "WORKED" && current.step === "UNLOAD") {
        sawUnload = true;
        expect(current.cargo.used).toBe(0);
        expect(warehouseQuantity("item_ore")).toBeGreaterThan(0);
      }
      clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
      if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    }

    expect(workedMining).toBeGreaterThanOrEqual(4);
    expect(sawFullCargo).toBe(true);
    expect(sawUnload).toBe(true);
    expect(sawReturn).toBe(true);
    expect(replayed).toBe(true);

    const cargoBeforeExpiry = count("actor_cargo_items");
    clock.advanceSeconds(181);
    const expired = await step();
    expect(expired.phase).toBe("STOPPED");
    expect(count("actor_cargo_items")).toBe(cargoBeforeExpiry);
    await stopAuto(autoVersion);
  });

  it("keeps the Mining lease through read-only panel reads and a reload", async () => {
    const area = await createArea("MINING", "Read Only Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    await startAuto();

    const trace: Array<{
      readonly phase: string;
      readonly step: string | null;
      readonly cargo: number;
      readonly warehouseOre: number;
      readonly watermark: string | null;
      readonly lease: string | null;
    }> = [];
    const record = (current: StepBody["data"]["step"]): void => {
      const timeline = autoState();
      trace.push({
        phase: current.phase,
        step: current.step,
        cargo: current.cargo.used,
        warehouseOre: warehouseQuantity("item_ore"),
        watermark: timeline?.simulation_at ?? null,
        lease: timeline?.lease_until ?? null
      });
    };

    const first = await step();
    record(first);
    expect(first.controlMode).toBe("AUTO_CONTROLLED");
    const reloadedWorkers = await json<{ data: { actor: { controlMode: string } } }>(
      await request("GET", `/farms/${FARM_ONE_ID}/workers`)
    );
    await request("GET", `/farms/${FARM_ONE_ID}/auto-plan`);
    await request("GET", `/farms/${FARM_ONE_ID}/cargo`);
    expect(reloadedWorkers.data.actor.controlMode).toBe("AUTO_CONTROLLED");
    expect(autoState()?.lease_until).not.toBeNull();

    let sawUnload = false;
    let sawReturn = false;
    for (let index = 0; index < 100 && !sawReturn; index += 1) {
      const current = await step();
      record(current);
      if (current.phase === "WORKED" && current.step === "UNLOAD") {
        sawUnload = true;
        expect(current.cargo.used).toBe(0);
        expect(warehouseQuantity("item_ore")).toBeGreaterThan(0);
      }
      if (sawUnload && current.phase === "WORKED" && current.step === "MINE") sawReturn = true;
      clock.advanceSeconds(current.retryAfterMs / 1000 + 0.05);
      if (current.phase === "WORKED") clock.advanceSeconds(0.75);
    }

    expect(trace.filter((entry) => entry.phase === "WORKED" && entry.step === "MINE").length).toBeGreaterThanOrEqual(3);
    expect(trace.some((entry) => entry.phase === "TRAVELLING" && entry.cargo > 0)).toBe(true);
    expect(sawUnload).toBe(true);
    expect(sawReturn).toBe(true);
    expect(trace.some((entry) => entry.lease !== null)).toBe(true);
    expect(trace.at(-1)?.phase).not.toBe("STOPPED");
  });

  it("stops at the server watermark, preserves cargo, and makes Stop replay-safe", async () => {
    const area = await createArea("MINING", "Stop Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    const startedVersion = await startAuto();
    const first = await step();
    expect(first.phase).toBe("TRAVELLING");
    clock.advanceSeconds(first.retryAfterMs / 1000 + 0.05);
    const mined = await step();
    expect(mined.step).toBe("MINE");
    clock.advanceSeconds(mined.retryAfterMs / 1000 + 0.05);
    const secondMined = await step();
    expect(secondMined.step).toBe("MINE");
    const cargoBeforeStop = cargoQuantity("item_ore");
    const stopAt = clock.now();
    clock.advanceSeconds(7);
    const requestedStopAt = clock.now();
    const stopped = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "stop_watermark_01",
      startAuto: false,
      expectedVersion: startedVersion
    });
    expect(stopped.status).toBe(200);
    expect(cargoQuantity("item_ore")).toBe(cargoBeforeStop);
    expect(autoState()?.simulation_at).toBe(requestedStopAt);
    expect(autoState()?.lease_until).toBeNull();
    const receiptsBeforeRetry = receipts("AUTO_MINE");

    const replay = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "stop_watermark_01",
      startAuto: false,
      expectedVersion: startedVersion
    });
    expect(replay.status).toBe(200);
    expect(receipts("AUTO_MINE")).toBe(receiptsBeforeRetry);
    expect(cargoQuantity("item_ore")).toBe(cargoBeforeStop);
    expect(Date.parse(autoState()?.simulation_at ?? "")).toBeGreaterThanOrEqual(Date.parse(stopAt));
  });

  it("does not renew after expiry and normalizes a legacy 24-hour lease", async () => {
    const area = await createArea("MINING", "Legacy Lease Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    await startAuto();
    const legacyLease = new Date(Date.parse(NOW) + 24 * 60 * 60 * 1000).toISOString();
    db.sqlite.prepare("UPDATE actor_auto_state SET lease_until = ?, simulation_at = ?").run(legacyLease, NOW);
    clock.advanceSeconds(181);
    const expired = await step();
    expect(expired.phase).toBe("STOPPED");
    expect(receipts("AUTO_MINE")).toBe(0);
    expect(autoState()?.lease_until).toBeNull();
    const lateReconcile = await post(`/farms/${FARM_ONE_ID}/auto/reconcile`, { requestId: "legacy_late_reconcile_01" });
    expect(lateReconcile.status).toBe(200);
    expect(receipts("AUTO_MINE")).toBe(0);

    const workers = await json<{ data: { actor: { version: number } } }>(await request("GET", `/farms/${FARM_ONE_ID}/workers`));
    const resumed = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "legacy_resume_after_expiry_01",
      startAuto: true,
      expectedVersion: workers.data.actor.version
    });
    expect(resumed.status).toBe(200);
    expect(autoState()?.simulation_at).toBe(clock.now());
    expect(autoState()?.lease_issued_at).toBe(clock.now());
    expect(autoState()?.lease_until).toBe(new Date(Date.parse(clock.now()) + 180_000).toISOString());
    expect(receipts("AUTO_MINE")).toBe(0);
  });

  it("renews at the 60-second boundary, not on every Auto step", async () => {
    const area = await createArea("MINING", "Renew Cadence Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    await startAuto();
    const first = await step();
    clock.advanceSeconds(first.retryAfterMs / 1000 + 0.05);
    await step();
    const issuedAt = autoState()?.lease_issued_at;
    expect(issuedAt).toBe(NOW);
    clock.advanceSeconds(47.4);
    await step();
    expect(autoState()?.lease_issued_at).toBe(issuedAt);
    clock.advanceSeconds(1.3);
    await step();
    expect(Date.parse(autoState()?.lease_issued_at ?? "")).toBeGreaterThan(Date.parse(issuedAt ?? ""));
  });

  it("leaves full cargo and a full warehouse untouched when Stop arrives", async () => {
    const area = await createArea("MINING", "Full Stop Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    const actorVersion = await startAuto();
    const actor = db.sqlite.prepare("SELECT id FROM actors LIMIT 1").get() as { readonly id: string };
    db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = 30 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    seedWarehouse("item_ore", 30);
    db.sqlite
      .prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_ore', 30, 1, ?)")
      .run(actor.id, NOW);
    const before = { cargo: cargoQuantity("item_ore"), warehouse: warehouseQuantity("item_ore"), mines: receipts("AUTO_MINE") };
    const stopped = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "stop_full_state_01",
      startAuto: false,
      expectedVersion: actorVersion
    });
    expect(stopped.status).toBe(200);
    expect(cargoQuantity("item_ore")).toBe(before.cargo);
    expect(warehouseQuantity("item_ore")).toBe(before.warehouse);
    expect(receipts("AUTO_MINE")).toBe(before.mines);
  });

  it("serializes Stop against a simultaneous step without losing a completed cargo load", async () => {
    const area = await createArea("MINING", "Stop Race Mine", [{ x: 12, y: -12 }]);
    await createJob(area, "MINING", "resource_ore");
    const actorVersion = await startAuto();
    const first = await step();
    clock.advanceSeconds(first.retryAfterMs / 1000 + 0.05);
    await step();
    const cargoBeforeRace = cargoQuantity("item_ore");
    const [stop, advance] = await Promise.all([
      post(`/farms/${FARM_ONE_ID}/workers/control`, {
        requestId: "stop_race_01",
        startAuto: false,
        expectedVersion: actorVersion
      }),
      post(`/farms/${FARM_ONE_ID}/auto/step`, { requestId: "stop_race_step_01" })
    ]);
    expect([200, 409]).toContain(stop.status);
    expect([200, 409]).toContain(advance.status);
    expect(cargoQuantity("item_ore")).toBeGreaterThanOrEqual(cargoBeforeRace);
    expect(receipts("AUTO_MINE")).toBeLessThanOrEqual(2);
    const finalStop = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "stop_race_retry_01",
      startAuto: false,
      expectedVersion: actorVersion
    });
    expect(finalStop.status).toBe(200);
    expect(autoState()?.lease_until).toBeNull();
  });

  it("refuses a foreign farm and an unauthenticated caller", async () => {
    auth.player = PLAYER_TWO_ID;
    expect((await post(`/farms/${FARM_ONE_ID}/auto/step`, { requestId: "exec_foreign_01" })).status).toBe(403);
    auth.player = null;
    expect((await post(`/farms/${FARM_ONE_ID}/auto/step`, { requestId: "exec_anon_01" })).status).toBe(401);
    expect(count("actors")).toBe(0);
  });

  it("refuses a malformed step body", async () => {
    expect((await post(`/farms/${FARM_ONE_ID}/auto/step`, {})).status).toBe(400);
    expect((await post(`/farms/${FARM_ONE_ID}/auto/step`, { requestId: "no" })).status).toBe(400);
  });
});
