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
  type TreeInstanceId
  ,
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
  Sha256Fingerprint,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataWorkAreaGround,
  gameDataCargoCapacities
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";
import { schemaSql } from "../support/migrations";

/**
 * The actor and job spine, through the real handler.
 *
 * The point of these tests is what a job does *not* do. Creating one is configuration: no crop is
 * planted, nothing is harvested, no inventory, experience, gold or warehouse row moves, and the
 * character does not move. Everything else here is the ordinary discipline - one actor per player,
 * bounded ordered lists, version guards, and an area that refuses to disappear while a job names it.
 */

const migration = schemaSql();

const NATURAL_LAND = { x: 9, y: 26 };
const VOLCANO_SLOPE = { x: 12, y: -12 };

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
  private actorSequence = 1;
  private jobSequence = 1;
  private workAreaSequence = 1;
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
    return parseActorId(`actor_aaaaaaaa-aaaa-4aaa-8aaa-${String(this.actorSequence++).padStart(12, "0")}`);
  }
  newJobId(): JobId {
    return parseJobId(`job_bbbbbbbb-bbbb-4bbb-8bbb-${String(this.jobSequence++).padStart(12, "0")}`);
  }
  newWorkAreaId(): WorkAreaId {
    return parseWorkAreaId(
      `workarea_cccccccc-cccc-4ccc-8ccc-${String(this.workAreaSequence++).padStart(12, "0")}`
    );
  }
}

describe("actor and job spine", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;
  let auth: MutableAuth;
  let ids: FixedIds;

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
    ids = new FixedIds();
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
      workers: { ids },
      cargoCapacities: gameDataCargoCapacities,
      clock: new FixedClock()
    });
    await post("/farms", { name: "Job Farm" });
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 500, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', 5, 1, ?)"
      )
      .run(PLAYER_ONE_ID, NOW);
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

  interface WorkersBody {
    readonly ok: boolean;
    readonly data: {
      readonly actor: { readonly actorId: string; readonly kind: string; readonly controlMode: string; readonly version: number };
      readonly jobs: readonly {
        readonly jobId: string;
        readonly workAreaId: string;
        readonly kind: string;
        readonly targetDefinitionId: string;
        readonly targetDisplayNameKey: string;
        readonly priority: number;
        readonly enabled: boolean;
        readonly version: number;
      }[];
    };
  }

  async function workers(): Promise<WorkersBody> {
    return json<WorkersBody>(await request("GET", `/farms/${FARM_ONE_ID}/workers`));
  }

  async function createArea(kind: string, name: string, cells: readonly { x: number; y: number }[]): Promise<string> {
    const created = await post(`/farms/${FARM_ONE_ID}/work-areas`, {
      requestId: `area_${name.replace(/\W/gu, "")}_01`,
      kind,
      name,
      cells
    });
    expect(created.status).toBe(201);
    return (await json<{ data: { workArea: { workAreaId: string } } }>(created)).data.workArea.workAreaId;
  }

  function createJob(body: unknown, requestId: string): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/jobs`, { requestId, ...(body as object) });
  }

  function ledgerRowCount(): number {
    const row = db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID) as {
      readonly n: number;
    };
    return row.n;
  }

  it("resolves exactly one Main Character, however many times the panel is opened", async () => {
    const first = await workers();
    expect(first.data.actor.kind).toBe("MAIN_CHARACTER");
    expect(first.data.actor.controlMode).toBe("PLAYER_CONTROLLED");
    expect(first.data.jobs).toEqual([]);

    const [a, b] = await Promise.all([workers(), workers()]);
    expect(a.data.actor.actorId).toBe(first.data.actor.actorId);
    expect(b.data.actor.actorId).toBe(first.data.actor.actorId);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actors").get()).toEqual({ n: 1 });
  });

  it("creates the actor for an existing save without touching anything else", async () => {
    const before = {
      wallets: db.sqlite.prepare("SELECT COUNT(*) AS n FROM wallets").get(),
      inventory: db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items").get(),
      tiles: db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles").get(),
      ledger: ledgerRowCount(),
      crops: db.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()
    };
    await workers();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM wallets").get()).toEqual(before.wallets);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_items").get()).toEqual(before.inventory);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles").get()).toEqual(before.tiles);
    expect(ledgerRowCount()).toBe(before.ledger);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()).toEqual(before.crops);
  });

  it("assigns a job without doing any work: no crop, no gold, no experience, no inventory, no movement", async () => {
    const areaId = await createArea("FARM", "East Field", [NATURAL_LAND]);
    const goldBefore = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID);
    const seedsBefore = db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'").get(PLAYER_ONE_ID);

    const created = await createJob(
      { workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" },
      "job_create_01"
    );
    expect(created.status).toBe(201);
    const job = (await json<{ data: { job: { jobId: string; priority: number; enabled: boolean; targetDisplayNameKey: string } } }>(created)).data.job;
    expect(job.priority).toBe(1);
    expect(job.enabled).toBe(true);
    expect(job.targetDisplayNameKey).toBe("crop.carrot.name");

    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM crop_instances").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tree_instances").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM resource_actions").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM resource_node_states").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual(goldBefore);
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'").get(PLAYER_ONE_ID)).toEqual(seedsBefore);
    expect(ledgerRowCount()).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ n: 0 });

    const panel = await workers();
    expect(panel.data.jobs).toHaveLength(1);
    expect(panel.data.jobs[0]?.jobId).toBe(job.jobId);
  });

  it("keeps the list in a dense deterministic order and reorders it transactionally", async () => {
    const field = await createArea("FARM", "Rice Field", [NATURAL_LAND]);
    const orchard = await createArea("ORCHARD", "Orange Grove", [NATURAL_LAND]);
    const mine = await createArea("MINING", "North Mine", [VOLCANO_SLOPE]);
    const first = (await json<{ data: { job: { jobId: string } } }>(await createJob({ workAreaId: field, kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_order_01"))).data.job.jobId;
    const second = (await json<{ data: { job: { jobId: string } } }>(await createJob({ workAreaId: orchard, kind: "ORCHARD", targetDefinitionId: "tree_apple" }, "job_order_02"))).data.job.jobId;
    const third = (await json<{ data: { job: { jobId: string } } }>(await createJob({ workAreaId: mine, kind: "MINING", targetDefinitionId: "resource_stone" }, "job_order_03"))).data.job.jobId;

    let panel = await workers();
    expect(panel.data.jobs.map((job) => job.jobId)).toEqual([first, second, third]);
    expect(panel.data.jobs.map((job) => job.priority)).toEqual([1, 2, 3]);

    const reordered = await post(`/farms/${FARM_ONE_ID}/jobs/order`, {
      requestId: "job_order_04",
      orderedJobIds: [third, first, second],
      expectedVersion: panel.data.actor.version
    });
    expect(reordered.status).toBe(200);
    panel = await workers();
    expect(panel.data.jobs.map((job) => job.jobId)).toEqual([third, first, second]);
    expect(panel.data.jobs.map((job) => job.priority)).toEqual([1, 2, 3]);

    // A reorder that is not exactly a permutation of the actor's jobs is refused.
    const missing = await post(`/farms/${FARM_ONE_ID}/jobs/order`, {
      requestId: "job_order_05",
      orderedJobIds: [third, first],
      expectedVersion: panel.data.actor.version
    });
    expect(missing.status).toBe(409);
    expect((await json<{ error: { code: string } }>(missing)).error.code).toBe("JOB_REORDER_MISMATCH");

    const stale = await post(`/farms/${FARM_ONE_ID}/jobs/order`, {
      requestId: "job_order_06",
      orderedJobIds: [first, second, third],
      expectedVersion: 1
    });
    expect(stale.status).toBe(409);
    expect((await json<{ error: { code: string } }>(stale)).error.code).toBe("CONFLICT_STALE_STATE");
  });

  it("disables and re-enables a job without deleting it, and refuses a stale edit", async () => {
    const areaId = await createArea("FARM", "Field", [NATURAL_LAND]);
    const job = (await json<{ data: { job: { jobId: string; version: number } } }>(await createJob({ workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_state_01"))).data.job;

    const disabled = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/enabled`, {
      requestId: "job_state_02",
      enabled: false,
      expectedVersion: job.version
    });
    expect(disabled.status).toBe(200);
    const afterDisable = (await json<{ data: { job: { enabled: boolean; version: number } } }>(disabled)).data.job;
    expect(afterDisable.enabled).toBe(false);
    expect(afterDisable.version).toBe(job.version + 1);
    expect((await workers()).data.jobs).toHaveLength(1);

    const reEnabled = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/enabled`, {
      requestId: "job_state_03",
      enabled: true,
      expectedVersion: afterDisable.version
    });
    expect(reEnabled.status).toBe(200);

    const stale = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/enabled`, {
      requestId: "job_state_04",
      enabled: false,
      expectedVersion: job.version
    });
    expect(stale.status).toBe(409);
  });

  it("changes a job's target, and refuses one the world does not hold", async () => {
    const areaId = await createArea("FARM", "Field", [NATURAL_LAND]);
    const job = (await json<{ data: { job: { jobId: string; version: number } } }>(await createJob({ workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_target_01"))).data.job;

    const changed = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/target`, {
      requestId: "job_target_02",
      targetDefinitionId: "crop_wheat",
      expectedVersion: job.version
    });
    expect(changed.status).toBe(200);
    expect((await json<{ data: { job: { targetDefinitionId: string } } }>(changed)).data.job.targetDefinitionId).toBe("crop_wheat");

    const unknown = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/target`, {
      requestId: "job_target_03",
      targetDefinitionId: "crop_dragonfruit",
      expectedVersion: job.version + 1
    });
    expect(unknown.status).toBe(400);
    expect((await json<{ error: { code: string } }>(unknown)).error.code).toBe("JOB_TARGET_INVALID");

    // A tree is not a crop, however real it is.
    const wrongShape = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/target`, {
      requestId: "job_target_04",
      targetDefinitionId: "tree_apple",
      expectedVersion: job.version + 1
    });
    expect(wrongShape.status).toBe(400);
    expect((await json<{ error: { code: string } }>(wrongShape)).error.code).toBe("JOB_TARGET_INVALID");
  });

  it("refuses an area of the wrong kind, a profession with no work behind it, and a foreign area", async () => {
    const field = await createArea("FARM", "Field", [NATURAL_LAND]);

    const mismatch = await createJob({ workAreaId: field, kind: "MINING", targetDefinitionId: "resource_stone" }, "job_bad_01");
    expect(mismatch.status).toBe(400);
    expect((await json<{ error: { code: string } }>(mismatch)).error.code).toBe("JOB_AREA_MISMATCH");

    // LIVESTOCK has real ground to name an area on, but no work behind it yet, so the *kind* is the
    // refusal. (AQUACULTURE needs the shallow shelf, which this fixture has no valid cell for; a job of
    // that kind on farmland is refused earlier, as a mismatch, which is also correct.)
    const pasture = await createArea("LIVESTOCK", "Cow Pasture", [NATURAL_LAND]);
    const unavailable = await createJob(
      { workAreaId: pasture, kind: "LIVESTOCK", targetDefinitionId: "resource_stone" },
      "job_bad_livestock"
    );
    expect(unavailable.status).toBe(400);
    expect((await json<{ error: { code: string } }>(unavailable)).error.code).toBe("JOB_KIND_UNAVAILABLE");

    const aquaculture = await createJob(
      { workAreaId: field, kind: "AQUACULTURE", targetDefinitionId: "resource_stone" },
      "job_bad_aquaculture"
    );
    expect(aquaculture.status).toBe(400);
    expect((await json<{ error: { code: string } }>(aquaculture)).error.code).toBe("JOB_AREA_MISMATCH");

    const missingArea = await createJob(
      { workAreaId: "workarea_00000000-0000-4000-8000-000000000000", kind: "FARM", targetDefinitionId: "crop_carrot" },
      "job_bad_02"
    );
    expect(missingArea.status).toBe(404);
    expect((await json<{ error: { code: string } }>(missingArea)).error.code).toBe("WORK_AREA_NOT_FOUND");
  });

  it("protects a work area that a job names, and frees it when the job goes", async () => {
    const areaId = await createArea("FARM", "Assigned Field", [NATURAL_LAND]);
    const job = (await json<{ data: { job: { jobId: string; version: number } } }>(await createJob({ workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_guard_01"))).data.job;
    const areaVersion = (await json<{ data: { workArea: { version: number } } }>(await request("GET", `/farms/${FARM_ONE_ID}/work-areas/${areaId}`))).data.workArea.version;

    const blocked = await post(`/farms/${FARM_ONE_ID}/work-areas/${areaId}/delete`, {
      requestId: "job_guard_02",
      expectedVersion: areaVersion
    });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: { code: string } }>(blocked)).error.code).toBe("WORK_AREA_IN_USE");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas WHERE id = ?").get(areaId)).toEqual({ n: 1 });
    // The job is untouched: no cascade took it.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs WHERE id = ?").get(job.jobId)).toEqual({ n: 1 });

    const deletedJob = await post(`/farms/${FARM_ONE_ID}/jobs/${job.jobId}/delete`, {
      requestId: "job_guard_03",
      expectedVersion: job.version
    });
    expect(deletedJob.status).toBe(200);
    const deletedArea = await post(`/farms/${FARM_ONE_ID}/work-areas/${areaId}/delete`, {
      requestId: "job_guard_04",
      expectedVersion: areaVersion
    });
    expect(deletedArea.status).toBe(200);
  });

  it("replays a create instead of assigning the same job twice", async () => {
    const areaId = await createArea("FARM", "Field", [NATURAL_LAND]);
    const body = { workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" };
    const first = await createJob(body, "job_replay_01");
    const second = await createJob(body, "job_replay_01");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await json<{ data: { job: { jobId: string } } }>(second)).data.job.jobId).toBe(
      (await json<{ data: { job: { jobId: string } } }>(first)).data.job.jobId
    );
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs").get()).toEqual({ n: 1 });

    const different = await createJob({ ...body, targetDefinitionId: "crop_wheat" }, "job_replay_01");
    expect(different.status).toBe(409);
    expect((await json<{ error: { code: string } }>(different)).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses a caller who does not own the farm", async () => {
    auth.player = PLAYER_TWO_ID;
    expect((await request("GET", `/farms/${FARM_ONE_ID}/workers`)).status).toBe(403);
    expect((await createJob({ workAreaId: "workarea_00000000-0000-4000-8000-000000000000", kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_auth_01")).status).toBe(403);

    db.sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'EDITOR', ?)")
      .run(FARM_ONE_ID, PLAYER_TWO_ID, NOW);
    expect((await request("GET", `/farms/${FARM_ONE_ID}/workers`)).status).toBe(403);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actors").get()).toEqual({ n: 0 });
  });

  it("renumbers the survivors when a job is deleted, so a new job can never collide with one", async () => {
    const areas = await Promise.all([
      createArea("FARM", "Field A", [NATURAL_LAND]),
      createArea("FARM", "Field B", [NATURAL_LAND]),
      createArea("FARM", "Field C", [NATURAL_LAND])
    ]);
    for (const [index, areaId] of areas.entries()) {
      await createJob(
        { workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" },
        `job_renumber_${String(index)}`
      );
    }
    const before = await workers();
    expect(before.data.jobs.map((job) => job.priority)).toEqual([1, 2, 3]);

    const firstJob = before.data.jobs[0];
    expect(firstJob).toBeDefined();
    const deleted = await post(`/farms/${FARM_ONE_ID}/jobs/${firstJob?.jobId ?? ""}/delete`, {
      requestId: "job_renumber_del",
      expectedVersion: firstJob?.version ?? 0
    });
    expect(deleted.status).toBe(200);

    // The survivors are dense again: 1 and 2, not 2 and 3.
    const after = await workers();
    expect(after.data.jobs.map((job) => job.priority)).toEqual([1, 2]);

    // And the next job appends after them rather than landing on a survivor's priority.
    const appended = await createJob(
      { workAreaId: areas[0], kind: "FARM", targetDefinitionId: "crop_wheat" },
      "job_renumber_add"
    );
    expect(appended.status).toBe(201);
    const final = await workers();
    expect(final.data.jobs.map((job) => job.priority)).toEqual([1, 2, 3]);
    expect(new Set(final.data.jobs.map((job) => job.priority)).size).toBe(3);
  });

  it("bounds an actor's jobs", async () => {
    for (let index = 0; index < 24; index += 1) {
      const areaId = await createArea("FARM", `Field ${String(index)}`, [NATURAL_LAND]);
      const created = await createJob({ workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" }, `job_limit_${String(index).padStart(2, "0")}`);
      expect(created.status).toBe(201);
    }
    const areaId = await createArea("FARM", "One Too Many", [NATURAL_LAND]);
    const refused = await createJob({ workAreaId: areaId, kind: "FARM", targetDefinitionId: "crop_carrot" }, "job_limit_25");
    expect(refused.status).toBe(409);
    expect((await json<{ error: { code: string } }>(refused)).error.code).toBe("JOB_LIMIT_REACHED");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM actor_jobs").get()).toEqual({ n: 24 });
  });
});
