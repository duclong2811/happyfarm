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
 * The Auto executor foundation, through the real handler.
 *
 * D1 decides and shows; it does not act. The regression that matters most here is the zero-effect
 * assertion: switching control and evaluating the resolver must leave crops, trees, nodes, cargo,
 * inventory, gold, experience and the ledger exactly as they were. Everything else is the ordinary
 * discipline - one actor, version guards, convergent control changes, and a plan the client can read
 * without being able to write it.
 */

const migration = schemaSql();

const NATURAL_LAND = { x: 9, y: 26 };

class MutableAuth implements AuthenticationPort<Request> {
  player: PlayerId | null = PLAYER_ONE_ID;
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.player === null ? null : { playerId: this.player });
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

describe("Auto executor foundation", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;
  let auth: MutableAuth;

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
      clock: new FixedClock()
    });
    await post("/farms", { name: "Auto Farm" });
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

  async function json<T>(response: Response): Promise<T> {
    const parsed: unknown = await response.json();
    return parsed as T;
  }

  interface ActorBody {
    readonly data: {
      readonly actor: { readonly actorId: string; readonly controlMode: string; readonly version: number };
      readonly jobs: readonly {
        readonly jobId: string;
        readonly version: number;
        readonly priority: number;
        readonly autoPurchaseSupplies: boolean;
      }[];
    };
  }

  interface PlanBody {
    readonly ok: boolean;
    readonly data: {
      readonly plan: {
        readonly actorId: string;
        readonly controlMode: string;
        readonly action: { readonly kind: string; readonly itemDefinitionId?: string; readonly cells?: number } | null;
        readonly jobId: string | null;
        readonly waitReason: string | null;
        readonly perAssignment: readonly {
          readonly jobId: string;
          readonly skillId: string;
          readonly action: { readonly kind: string } | null;
          readonly waitReason: string | null;
          readonly claimed: boolean;
        }[];
      };
    };
  }

  function workers(): Promise<ActorBody> {
    return request("GET", `/farms/${FARM_ONE_ID}/workers`).then((response) => json<ActorBody>(response));
  }

  function autoPlan(): Promise<PlanBody> {
    return request("GET", `/farms/${FARM_ONE_ID}/auto-plan`).then((response) => json<PlanBody>(response));
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

  function count(table: string): number {
    const row = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { readonly n: number };
    return row.n;
  }

  function seedWarehouse(itemDefinitionId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1, updated_at = excluded.updated_at"
      )
      .run(PLAYER_ONE_ID, itemDefinitionId, quantity, NOW);
  }

  async function createArea(kind: string, name: string, cells: readonly { x: number; y: number }[]): Promise<string> {
    const created = await post(`/farms/${FARM_ONE_ID}/work-areas`, {
      requestId: `auto_area_${name.replace(/\W/gu, "")}_01`,
      kind,
      name,
      cells
    });
    expect(created.status).toBe(201);
    return (await json<{ data: { workArea: { workAreaId: string } } }>(created)).data.workArea.workAreaId;
  }

  async function createAssignment(workAreaId: string, requestId: string, target = "crop_carrot"): Promise<ActorBody["data"]["jobs"][number]> {
    const created = await post(`/farms/${FARM_ONE_ID}/jobs`, {
      requestId,
      workAreaId,
      kind: "FARM",
      targetDefinitionId: target
    });
    expect(created.status).toBe(201);
    return (await json<{ data: { job: ActorBody["data"]["jobs"][number] } }>(created)).data.job;
  }

  function control(startAuto: boolean, expectedVersion: number, requestId = "auto_control_01"): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/workers/control`, { requestId, startAuto, expectedVersion });
  }

  it("switches to Auto and back on the same actor, and never touches an assignment or a coin", async () => {
    const panel = await workers();
    expect(panel.data.actor.controlMode).toBe("PLAYER_CONTROLLED");

    const started = await control(true, panel.data.actor.version);
    expect(started.status).toBe(200);
    const afterStart = (await json<{ data: { actor: { controlMode: string; version: number } } }>(started)).data.actor;
    expect(afterStart.controlMode).toBe("AUTO_CONTROLLED");
    expect(afterStart.version).toBe(panel.data.actor.version + 1);
    expect((await workers()).data.actor.actorId).toBe(panel.data.actor.actorId);

    const stopped = await control(false, afterStart.version, "auto_control_02");
    expect(stopped.status).toBe(200);
    expect(
      (await json<{ data: { actor: { controlMode: string; version: number } } }>(stopped)).data.actor.controlMode
    ).toBe("PLAYER_CONTROLLED");

    // One actor, one row, and nothing else moved.
    expect(count("actors")).toBe(1);
    expect(count("crop_instances")).toBe(0);
    expect(count("actor_cargo_items")).toBe(0);
    expect(count("economy_ledger")).toBe(0);
    expect(count("player_progression")).toBe(0);
    expect(gold()).toBe(500);
  });

  it("replays a START, and converges two simultaneous STARTS on one mode", async () => {
    const version = (await workers()).data.actor.version;
    const [first, second] = await Promise.all([control(true, version, "auto_race_01"), control(true, version, "auto_race_02")]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const mode = (await workers()).data.actor.controlMode;
    expect(mode).toBe("AUTO_CONTROLLED");
    expect(count("actors")).toBe(1);
    expect(db.sqlite.prepare("SELECT version FROM actors").get()).toEqual({ version: version + 1 });

    // A replay of the intent is a no-op that succeeds, whatever version it carries.
    const replay = await control(true, version, "auto_race_01");
    expect(replay.status).toBe(200);
    expect((await json<{ data: { actor: { controlMode: string; version: number } } }>(replay)).data.actor.version).toBe(
      version + 1
    );
  });

  it("refuses a stale actor version, and a STOP built on the version START moved past", async () => {
    const version = (await workers()).data.actor.version;
    const staleStart = await control(true, version + 5, "auto_stale_01");
    expect(staleStart.status).toBe(409);
    expect((await json<{ error: { code: string } }>(staleStart)).error.code).toBe("CONFLICT_STALE_STATE");
    expect((await workers()).data.actor.controlMode).toBe("PLAYER_CONTROLLED");

    expect((await control(true, version, "auto_stale_02")).status).toBe(200);
    // The second tab still holds the pre-START version; its STOP is out of date, not silently applied.
    const staleStop = await control(false, version, "auto_stale_03");
    expect(staleStop.status).toBe(409);
    expect((await workers()).data.actor.controlMode).toBe("AUTO_CONTROLLED");
  });

  it("refuses a caller who does not own the farm, and one with no identity at all", async () => {
    auth.player = PLAYER_TWO_ID;
    expect((await request("GET", `/farms/${FARM_ONE_ID}/auto-plan`)).status).toBe(403);
    expect((await control(true, 1, "auto_auth_01")).status).toBe(403);
    auth.player = null;
    expect((await request("GET", `/farms/${FARM_ONE_ID}/auto-plan`)).status).toBe(401);
    expect((await control(true, 1, "auto_auth_02")).status).toBe(401);
    expect(count("actors")).toBe(0);
  });

  it("plans LOAD_INPUT for an empty field whose seed is in the warehouse, and performs none of it", async () => {
    const areaId = await createArea("FARM", "East Field", [NATURAL_LAND]);
    await createAssignment(areaId, "auto_job_01");
    seedWarehouse("item_carrot_seed", 10);

    // The plan reads even while the player is driving: that is what the panel shows before START.
    const preview = await autoPlan();
    expect(preview.data.plan.controlMode).toBe("PLAYER_CONTROLLED");
    expect(preview.data.plan.waitReason).toBe("NOT_AUTO_CONTROLLED");
    expect(preview.data.plan.perAssignment[0]?.action).toMatchObject({ kind: "LOAD_INPUT" });

    const version = (await workers()).data.actor.version;
    expect((await control(true, version, "auto_zero_01")).status).toBe(200);

    const before = {
      crops: count("crop_instances"),
      gold: gold(),
      ledger: count("economy_ledger"),
      cargo: count("actor_cargo_items"),
      seeds: db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID),
      progression: count("player_progression"),
      nodes: count("resource_node_states"),
      trees: count("tree_instances")
    };

    const plan = await autoPlan();
    expect(plan.data.plan.controlMode).toBe("AUTO_CONTROLLED");
    expect(plan.data.plan.action).toEqual({ kind: "LOAD_INPUT", itemDefinitionId: "item_carrot_seed", quantity: 1 });
    expect(plan.data.plan.jobId).not.toBeNull();
    expect(plan.data.plan.perAssignment[0]?.skillId).toBe("farm.carrot");

    // The resolver evaluated and changed nothing.
    expect(count("crop_instances")).toBe(before.crops);
    expect(gold()).toBe(before.gold);
    expect(count("economy_ledger")).toBe(before.ledger);
    expect(count("actor_cargo_items")).toBe(before.cargo);
    expect(
      db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual(before.seeds);
    expect(count("player_progression")).toBe(before.progression);
    expect(count("resource_node_states")).toBe(before.nodes);
    expect(count("tree_instances")).toBe(before.trees);

    // STOP is the same kind of no-op on the world.
    const stopVersion = (await workers()).data.actor.version;
    expect((await control(false, stopVersion, "auto_zero_02")).status).toBe(200);
    expect((await autoPlan()).data.plan.waitReason).toBe("NOT_AUTO_CONTROLLED");
    expect(count("crop_instances")).toBe(before.crops);
    expect(gold()).toBe(before.gold);
    expect(count("economy_ledger")).toBe(before.ledger);
    expect(count("actor_cargo_items")).toBe(before.cargo);
  });

  it("waits for supply, then plans a purchase only once the assignment policy allows it", async () => {
    const areaId = await createArea("FARM", "South Field", [NATURAL_LAND]);
    const job = await createAssignment(areaId, "auto_job_02");
    expect(job.autoPurchaseSupplies).toBe(false);
    const version = (await workers()).data.actor.version;
    await control(true, version, "auto_buy_01");

    // No seed anywhere, and buying is off: wait, never plant.
    let plan = await autoPlan();
    expect(plan.data.plan.action).toBeNull();
    expect(plan.data.plan.waitReason).toBe("WAITING_FOR_SUPPLY");

    // Turning the policy on is one boolean on the assignment, and still moves nothing else.
    const ledgerBefore = count("economy_ledger");
    const turnedOn = await post(`/farms/${FARM_ONE_ID}/assignments/${job.jobId}/policy`, {
      requestId: "auto_policy_01",
      autoPurchaseSupplies: true,
      expectedVersion: job.version
    });
    expect(turnedOn.status).toBe(200);
    expect((await json<{ data: { job: { autoPurchaseSupplies: boolean } } }>(turnedOn)).data.job.autoPurchaseSupplies).toBe(true);
    expect(count("economy_ledger")).toBe(ledgerBefore);
    expect(gold()).toBe(500);

    plan = await autoPlan();
    expect(plan.data.plan.action).toEqual({ kind: "PURCHASE_INPUT", itemDefinitionId: "item_carrot_seed", quantity: 1 });
    // ...and the plan still bought nothing.
    expect(gold()).toBe(500);
    expect(count("economy_ledger")).toBe(ledgerBefore);
    expect(count("actor_cargo_items")).toBe(0);

    // With almost no gold it waits for funds instead of pretending.
    setGold(1);
    plan = await autoPlan();
    expect(plan.data.plan.action).toBeNull();
    expect(plan.data.plan.waitReason).toBe("WAITING_FOR_FUNDS");
  });

  it("keeps Auto Purchase off for every existing assignment unless the player turns it on", async () => {
    const areaId = await createArea("FARM", "Old Field", [NATURAL_LAND]);
    await createAssignment(areaId, "auto_default_01");
    expect(db.sqlite.prepare("SELECT auto_purchase_supplies FROM actor_jobs").get()).toEqual({
      auto_purchase_supplies: 0
    });
  });

  it("refuses a malformed control body, an unknown assignment, and a stale policy version", async () => {
    const areaId = await createArea("FARM", "Guarded Field", [NATURAL_LAND]);
    const job = await createAssignment(areaId, "auto_guard_01");

    // The body is the intent and a version, and nothing else is optional or inferred.
    const missingIntent = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "auto_guard_bad",
      expectedVersion: 1
    });
    expect(missingIntent.status).toBe(400);
    expect((await json<{ error: { code: string } }>(missingIntent)).error.code).toBe("INVALID_INPUT");

    const negativeVersion = await post(`/farms/${FARM_ONE_ID}/workers/control`, {
      requestId: "auto_guard_neg",
      startAuto: true,
      expectedVersion: -1
    });
    expect(negativeVersion.status).toBe(400);

    // A job the farm does not own answers exactly like a missing one.
    const foreignJob = await post(
      `/farms/${FARM_ONE_ID}/assignments/job_00000000-0000-4000-8000-000000000000/policy`,
      { requestId: "auto_guard_missing", autoPurchaseSupplies: true, expectedVersion: 1 }
    );
    expect(foreignJob.status).toBe(404);
    expect((await json<{ error: { code: string } }>(foreignJob)).error.code).toBe("JOB_NOT_FOUND");

    // The policy is version-guarded, like every other assignment edit.
    const stale = await post(`/farms/${FARM_ONE_ID}/assignments/${job.jobId}/policy`, {
      requestId: "auto_guard_stale",
      autoPurchaseSupplies: true,
      expectedVersion: job.version + 3
    });
    expect(stale.status).toBe(409);
    expect((await json<{ error: { code: string } }>(stale)).error.code).toBe("CONFLICT_STALE_STATE");
    expect(db.sqlite.prepare("SELECT auto_purchase_supplies FROM actor_jobs").get()).toEqual({
      auto_purchase_supplies: 0
    });
  });

  it("lets one waiting assignment make way for another, and says which targets were claimed", async () => {
    const field = await createArea("FARM", "Rice Field", [NATURAL_LAND]);
    const orchard = await createArea("ORCHARD", "Apple Orchard", [NATURAL_LAND]);
    await createAssignment(field, "auto_prio_01", "crop_carrot");
    const apple = await json<{ data: { job: { jobId: string } } }>(
      await post(`/farms/${FARM_ONE_ID}/jobs`, {
        requestId: "auto_prio_02",
        workAreaId: orchard,
        kind: "ORCHARD",
        targetDefinitionId: "tree_apple"
      })
    ).then((body) => body);
    expect(apple.data.job.jobId).not.toBe("");

    const version = (await workers()).data.actor.version;
    await control(true, version, "auto_prio_03");
    const plan = await autoPlan();
    // Priority 1 is the carrot field with no seed: it waits. Priority 2 is the empty orchard with no
    // sapling: it waits too. Neither is actionable, so the plan reports the highest-priority reason.
    expect(plan.data.plan.action).toBeNull();
    expect(plan.data.plan.waitReason).toBe("WAITING_FOR_SUPPLY");
    expect(plan.data.plan.perAssignment.map((entry) => entry.waitReason)).toEqual([
      "WAITING_FOR_SUPPLY",
      "WAITING_FOR_SUPPLY"
    ]);
    expect(plan.data.plan.perAssignment.every((entry) => !entry.claimed)).toBe(true);
  });
});
