import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator, WorkAreaIdGenerator } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  parseWorkAreaId,
  parseActorId,
  parseJobId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type PlayerId,
  type TreeInstanceId,
  type ActorId,
  type JobId,
  type WorkAreaId
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
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataWorkAreaGround,
  gameDataCargoCapacities
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { D1WorkAreaRepository } from "../../workers/api/src/d1-repositories";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "../../workers/api/src/d1-types";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";
import { schemaSql } from "../support/migrations";

/**
 * D1 counts the rows an `ON DELETE CASCADE` removed as part of the deleting statement's change
 * count; `node:sqlite` does not. A repository that decides "did my delete apply?" from that count is
 * therefore correct in the test double and wrong in production - which is exactly the bug the staging
 * smoke found. This wrapper inflates the count the way D1 does, so the regression is reproducible
 * locally without a network.
 */
class CascadeInflatingDatabase implements D1DatabaseLike {
  constructor(private readonly inner: NodeD1Database) {}
  prepare(query: string): D1PreparedStatementLike {
    return new CascadeInflatingStatement(this.inner.prepare(query), query);
  }
  batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]> {
    // `NodeD1Database.batch` runs each statement it is handed, so the wrapper's `run` is used here too.
    return this.inner.batch(statements);
  }
}

class CascadeInflatingStatement implements D1PreparedStatementLike {
  constructor(
    private readonly inner: D1PreparedStatementLike,
    private readonly sql: string
  ) {}
  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new CascadeInflatingStatement(this.inner.bind(...values), this.sql);
  }
  first<T>(): Promise<T | null> {
    return this.inner.first<T>();
  }
  // The generic mirrors D1's typed row projection at the query boundary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  all<T>(): Promise<{ readonly results: T[] }> {
    return this.inner.all<T>();
  }
  async run(): Promise<D1RunResultLike> {
    const result = await this.inner.run();
    if (!/^\s*DELETE\s+FROM\s+work_areas/i.test(this.sql)) return result;
    return { ...result, meta: { ...result.meta, changes: (result.meta.changes ?? 0) + 1 } };
  }
}

/**
 * Work areas: player-named groups of cells a future Job may be asked to work.
 *
 * The whole point of these tests is the shape of the feature, not its size: an area is metadata, so
 * naming one must cost nothing, reserve nothing and require no tile row - and it must refuse ground a
 * player could never work, refuse an edit made against a stale version, and refuse a caller who is not
 * the farm's owner.
 */

const migration = schemaSql();

/** A cell the free-land suite already proves is natural, unprotected dry land with no tile row. */
const NATURAL_LAND = { x: 9, y: 26 };
/** A second natural cell beside it, for membership edits. */
const NATURAL_LAND_2 = { x: 10, y: 26 };
/** Open ocean, far outside the island. */
const OCEAN = { x: 500, y: 500 };
/** The pond's water. */
const POND = { x: -3, y: 45 };
/** The volcano's crater. */
const VOLCANO_CORE = { x: 12, y: -23 };
/** The volcano's steep flank, the one ground a quarry could be cut into. */
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

class FixedIds implements IdGenerator, WorkAreaIdGenerator {
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
  newWorkAreaId(): WorkAreaId {
    return parseWorkAreaId(
      `workarea_aaaaaaaa-aaaa-4aaa-8aaa-${String(this.workAreaSequence++).padStart(12, "0")}`
    );
  }
  newActorId(): ActorId {
    return parseActorId(`actor_aaaaaaaa-aaaa-4aaa-8aaa-${String(this.workAreaSequence++).padStart(12, "0")}`);
  }
  newJobId(): JobId {
    return parseJobId(`job_bbbbbbbb-bbbb-4bbb-8bbb-${String(this.workAreaSequence++).padStart(12, "0")}`);
  }
}

describe("work area foundation", () => {
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
    handle = createHandler({
      db,
      authenticator: auth,
      ids: new FixedIds(),
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
      workAreas: { ground: gameDataWorkAreaGround, ids: new FixedIds() },
      cargoCapacities: gameDataCargoCapacities,
      workers: { ids: new FixedIds() },
      clock: new FixedClock()
    });
    await post("/farms", { name: "Work Area Farm" });
    // A known, non-zero account: creating an area must not move a single unit of either.
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_wood', 7, 1, ?)"
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
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } })
      })
    );
  }

  async function post(path: string, body: unknown): Promise<Response> {
    return request("POST", path, body);
  }

  async function json<T>(response: Response): Promise<T> {
    // The house pattern (`const body: unknown = await response.json()`) with the cast the typed call
    // sites need: the wire shape is asserted by the API's own schemas, not by this helper.
    const body: unknown = await response.json();
    return body as T;
  }

  function createArea(body: unknown): Promise<Response> {
    return post(`/farms/${FARM_ONE_ID}/work-areas`, body);
  }

  async function area(id: string): Promise<Response> {
    return request("GET", `/farms/${FARM_ONE_ID}/work-areas/${id}`);
  }

  async function listAreas(): Promise<{ ok: boolean; data: { workAreas: { workAreaId: string; cellCount: number; displayName: string; kind: string; version: number }[] } }> {
    return json(await request("GET", `/farms/${FARM_ONE_ID}/work-areas`));
  }

  function walletBalance(): number {
    const row = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID) as
      | { balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  function woodQuantity(): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_wood'")
      .get(PLAYER_ONE_ID) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  it("names an area on natural land that has no tile row, and costs nothing", async () => {
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?").get(FARM_ONE_ID, NATURAL_LAND.x, NATURAL_LAND.y)
    ).toEqual({ n: 0 });

    const created = await createArea({
      requestId: "wa_create_0001",
      kind: "FARM",
      name: "East Field",
      cells: [NATURAL_LAND, NATURAL_LAND_2]
    });
    expect(created.status).toBe(201);
    const body = await json<{ ok: boolean; data: { workArea: { workAreaId: string; cellCount?: number; cells: { x: number; y: number }[]; kind: string } } }>(created);
    expect(body.ok).toBe(true);
    expect(body.data.workArea.kind).toBe("FARM");
    expect(body.data.workArea.cells).toEqual([NATURAL_LAND, NATURAL_LAND_2]);

    // No gold, no inventory, no land, no tile rows: the area is metadata.
    expect(walletBalance()).toBe(1000);
    expect(woodQuantity()).toBe(7);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?").get(FARM_ONE_ID, NATURAL_LAND.x, NATURAL_LAND.y)
    ).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ n: 0 });

    const listed = await listAreas();
    expect(listed.data.workAreas).toEqual([
      expect.objectContaining({ displayName: "East Field", kind: "FARM", cellCount: 2 })
    ]);
  });

  it("accepts Unicode and the maximum length, and refuses empty, whitespace and over-long names", async () => {
    // Written with escapes so the literal survives any editor or terminal: what matters is that the
    // *server* round-trips a Vietnamese name with an emoji in it, not how this file is encoded.
    const unicodeName = "C\u00e1nh \u0111\u1ed3ng ph\u00eda \u0110\u00f4ng " + String.fromCodePoint(0x1f33e);
    const unicode = await createArea({
      requestId: "wa_create_unicode",
      kind: "FARM",
      name: `  ${unicodeName}  `,
      cells: [NATURAL_LAND]
    });
    expect(unicode.status).toBe(201);
    expect(
      (await json<{ data: { workArea: { displayName: string } } }>(unicode)).data.workArea.displayName
    ).toBe(unicodeName);

    // A non-BMP character is two UTF-16 units but one code point, which is exactly the boundary the
    // contract and the domain have to agree about. Built from its code point so the file needs no
    // literal emoji to survive an editor or a terminal.
    const maxLength = String.fromCodePoint(0x1f331).repeat(40);
    expect((await createArea({ requestId: "wa_create_max", kind: "FARM", name: maxLength, cells: [NATURAL_LAND] })).status).toBe(201);

    const blank = await createArea({ requestId: "wa_create_blank", kind: "FARM", name: "   ", cells: [NATURAL_LAND] });
    expect(blank.status).toBe(400);
    expect((await json<{ error: { code: string } }>(blank)).error.code).toBe("WORK_AREA_NAME_INVALID");

    const tooLong = await createArea({ requestId: "wa_create_long", kind: "FARM", name: "a".repeat(41), cells: [NATURAL_LAND] });
    expect(tooLong.status).toBe(400);
    expect((await json<{ error: { code: string } }>(tooLong)).error.code).toBe("WORK_AREA_NAME_INVALID");
  });

  it("allows two areas to share a name and to overlap cells", async () => {
    const first = await createArea({ requestId: "wa_overlap_a", kind: "FARM", name: "East Field", cells: [NATURAL_LAND] });
    const second = await createArea({ requestId: "wa_overlap_b", kind: "FARM", name: "East Field", cells: [NATURAL_LAND] });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await json<{ data: { workArea: { workAreaId: string } } }>(first)).data.workArea.workAreaId;
    const b = (await json<{ data: { workArea: { workAreaId: string } } }>(second)).data.workArea.workAreaId;
    expect(a).not.toBe(b);
    expect((await listAreas()).data.workAreas).toHaveLength(2);
  });

  it("refuses ground a work area of that kind could never be worked on", async () => {
    const ocean = await createArea({ requestId: "wa_ocean_0001", kind: "FARM", name: "Open Sea", cells: [OCEAN] });
    expect(ocean.status).toBe(400);
    expect((await json<{ error: { code: string } }>(ocean)).error.code).toBe("WORK_AREA_CELL_INVALID");

    const pond = await createArea({ requestId: "wa_pond_0001", kind: "FARM", name: "The Pond", cells: [POND] });
    expect(pond.status).toBe(400);

    const crater = await createArea({ requestId: "wa_crater_0001", kind: "MINING", name: "Crater", cells: [VOLCANO_CORE] });
    expect(crater.status).toBe(400);

    // Farmland is not quarry ground and the mountain is not farmland.
    expect((await createArea({ requestId: "wa_mine_land", kind: "MINING", name: "Wrong Way", cells: [NATURAL_LAND] })).status).toBe(400);
    const mine = await createArea({ requestId: "wa_mine_slope", kind: "MINING", name: "North Iron Mine", cells: [VOLCANO_SLOPE] });
    expect(mine.status).toBe(201);
  });

  it("refuses coordinates outside the world and more cells than the cap", async () => {
    const outOfBounds = await createArea({
      requestId: "wa_bounds_0001",
      kind: "FARM",
      name: "Nowhere",
      cells: [{ x: 5_000_000, y: 0 }]
    });
    expect(outOfBounds.status).toBe(400);

    const tooMany = await createArea({
      requestId: "wa_many_0001",
      kind: "FARM",
      name: "Too Big",
      cells: Array.from({ length: 257 }, (_value, index) => ({ x: index % 40, y: 60 + Math.floor(index / 40) }))
    });
    expect(tooMany.status).toBe(400);
  });

  it("renames with a version guard and refuses a stale edit", async () => {
    const created = await createArea({ requestId: "wa_rename_a", kind: "FARM", name: "Old Name", cells: [NATURAL_LAND] });
    const wa = (await json<{ data: { workArea: { workAreaId: string; version: number } } }>(created)).data.workArea;

    const renamed = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/rename`, {
      requestId: "wa_rename_b",
      name: "New Name",
      expectedVersion: wa.version
    });
    expect(renamed.status).toBe(200);
    expect((await json<{ data: { workArea: { displayName: string; version: number } } }>(renamed)).data.workArea).toEqual(
      expect.objectContaining({ displayName: "New Name", version: wa.version + 1 })
    );

    const stale = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/rename`, {
      requestId: "wa_rename_c",
      name: "Stale Name",
      expectedVersion: wa.version
    });
    expect(stale.status).toBe(409);
    expect((await json<{ error: { code: string } }>(stale)).error.code).toBe("CONFLICT_STALE_STATE");
    expect((await json<{ data: { workArea: { displayName: string } } }>(await area(wa.workAreaId))).data.workArea.displayName).toBe(
      "New Name"
    );
  });

  it("replaces membership, refuses ground the kind cannot use, and refuses a stale set", async () => {
    const created = await createArea({ requestId: "wa_cells_a", kind: "FARM", name: "Field", cells: [NATURAL_LAND] });
    const wa = (await json<{ data: { workArea: { workAreaId: string; version: number } } }>(created)).data.workArea;

    const replaced = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/cells`, {
      requestId: "wa_cells_b",
      cells: [NATURAL_LAND, NATURAL_LAND_2],
      expectedVersion: wa.version
    });
    expect(replaced.status).toBe(200);
    expect((await json<{ data: { workArea: { cells: unknown[]; version: number } } }>(replaced)).data.workArea).toEqual(
      expect.objectContaining({ cells: [NATURAL_LAND, NATURAL_LAND_2], version: wa.version + 1 })
    );

    const badGround = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/cells`, {
      requestId: "wa_cells_c",
      cells: [OCEAN],
      expectedVersion: wa.version + 1
    });
    expect(badGround.status).toBe(400);
    expect((await json<{ data: { workArea: { cells: unknown[] } } }>(await area(wa.workAreaId))).data.workArea.cells).toHaveLength(2);

    const stale = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/cells`, {
      requestId: "wa_cells_d",
      cells: [NATURAL_LAND],
      expectedVersion: wa.version
    });
    expect(stale.status).toBe(409);
  });

  it("deletes an area and its cells, and refuses a stale delete", async () => {
    const created = await createArea({ requestId: "wa_delete_a", kind: "FARM", name: "Gone Soon", cells: [NATURAL_LAND, NATURAL_LAND_2] });
    const wa = (await json<{ data: { workArea: { workAreaId: string; version: number } } }>(created)).data.workArea;

    const stale = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/delete`, {
      requestId: "wa_delete_b",
      expectedVersion: wa.version + 5
    });
    expect(stale.status).toBe(409);

    const deleted = await post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/delete`, {
      requestId: "wa_delete_c",
      expectedVersion: wa.version
    });
    expect(deleted.status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas WHERE id = ?").get(wa.workAreaId)).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_area_cells WHERE work_area_id = ?").get(wa.workAreaId)).toEqual({ n: 0 });
    expect((await area(wa.workAreaId)).status).toBe(404);
  });

  it("replays a create instead of making a second area", async () => {
    const body = { requestId: "wa_replay_001", kind: "FARM", name: "Once", cells: [NATURAL_LAND] };
    const first = await createArea(body);
    const second = await createArea(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await json<{ data: { workArea: { workAreaId: string } } }>(second)).data.workArea.workAreaId).toBe(
      (await json<{ data: { workArea: { workAreaId: string } } }>(first)).data.workArea.workAreaId
    );
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({ n: 1 });

    const different = await createArea({ ...body, name: "Different" });
    expect(different.status).toBe(409);
    expect((await json<{ error: { code: string } }>(different)).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("lets only one of two racing renames win", async () => {
    const created = await createArea({ requestId: "wa_race_create", kind: "FARM", name: "Raced", cells: [NATURAL_LAND] });
    const wa = (await json<{ data: { workArea: { workAreaId: string; version: number } } }>(created)).data.workArea;
    const [left, right] = await Promise.all([
      post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/rename`, {
        requestId: "wa_race_left",
        name: "Left",
        expectedVersion: wa.version
      }),
      post(`/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}/rename`, {
        requestId: "wa_race_right",
        name: "Right",
        expectedVersion: wa.version
      })
    ]);
    const codes = [left.status, right.status].sort();
    expect(codes).toEqual([200, 409]);
    expect((await json<{ data: { workArea: { version: number } } }>(await area(wa.workAreaId))).data.workArea.version).toBe(
      wa.version + 1
    );
  });

  it("refuses a caller who does not own the farm, and a farm that does not exist", async () => {
    auth.player = PLAYER_TWO_ID;
    const stranger = await createArea({ requestId: "wa_stranger_1", kind: "FARM", name: "Not Mine", cells: [NATURAL_LAND] });
    expect(stranger.status).toBe(403);
    expect((await json<{ error: { code: string } }>(stranger)).error.code).toBe("NOT_AUTHORIZED");

    // EDITOR is not OWNER: work-area editing is Home Island editing, which is OWNER-only today.
    db.sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'EDITOR', ?)")
      .run(FARM_ONE_ID, PLAYER_TWO_ID, NOW);
    const editor = await createArea({ requestId: "wa_editor_001", kind: "FARM", name: "Editor Area", cells: [NATURAL_LAND] });
    expect(editor.status).toBe(403);

    const missingFarm = await post("/farms/farm_00000000-0000-4000-8000-000000000000/work-areas", {
      requestId: "wa_missing_1",
      kind: "FARM",
      name: "Nowhere",
      cells: [NATURAL_LAND]
    });
    expect(missingFarm.status).toBe(404);
  });

  it("keeps an area invisible to another farm's reader", async () => {
    const created = await createArea({ requestId: "wa_foreign_1", kind: "FARM", name: "Private", cells: [NATURAL_LAND] });
    const wa = (await json<{ data: { workArea: { workAreaId: string } } }>(created)).data.workArea;
    auth.player = PLAYER_TWO_ID;
    const otherFarm = await request("GET", `/farms/${FARM_ONE_ID}/work-areas/${wa.workAreaId}`);
    expect(otherFarm.status).toBe(403);
    expect((await request("GET", `/farms/${FARM_ONE_ID}/work-areas`)).status).toBe(403);
  });

  it("reports a delete as applied even when D1 folds the cascaded cells into its change count", async () => {
    const counting = new NodeD1Database(migration);
    counting.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Owner', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    counting.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    const areaId = "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    counting.sqlite
      .prepare(
        "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, 'HOME_ISLAND', ?, 'FARM', 'East Field', 1, ?, ?, ?)"
      )
      .run(areaId, FARM_ONE_ID, `zone_home_island_${FARM_ONE_ID}`, PLAYER_ONE_ID, NOW, NOW);
    counting.sqlite
      .prepare("INSERT INTO work_area_cells (work_area_id, x, y) VALUES (?, 9, 26)")
      .run(areaId);

    const repository = new D1WorkAreaRepository(new CascadeInflatingDatabase(counting));
    expect(await repository.findById(parseWorkAreaId(areaId))).not.toBe(null);
    // The bug: the delete applied, but the change count read 2 and the caller answered a stale conflict.
    expect(await repository.deleteAtomically(parseWorkAreaId(areaId), 1)).toBe(true);
    expect(counting.sqlite.prepare("SELECT COUNT(*) AS n FROM work_areas").get()).toEqual({ n: 0 });
    expect(counting.sqlite.prepare("SELECT COUNT(*) AS n FROM work_area_cells").get()).toEqual({ n: 0 });
    counting.close();
  });

  it("leaves manual gameplay untouched with zero work areas", async () => {
    expect((await listAreas()).data.workAreas).toHaveLength(0);
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', 5, 1, ?)"
      )
      .run(PLAYER_ONE_ID, NOW);
    const planted = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "wa_manual_plant",
      cropDefinitionId: "crop_carrot",
      x: NATURAL_LAND.x,
      y: NATURAL_LAND.y
    });
    // Zero work areas, and planting still works exactly as it did: an area is never a precondition.
    expect(planted.status).toBe(201);
    expect((await listAreas()).data.workAreas).toHaveLength(0);
  });
});
