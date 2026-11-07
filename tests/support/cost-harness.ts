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
import { FarmIdSchema } from "@happy-farm/contracts";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "../../workers/api/src/d1-types";
import { createHash } from "node:crypto";
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
import { NodeD1Database } from "./node-d1";
import { schemaSql } from "./migrations";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "./fixtures";

/**
 * The Auto cost harness: the production handler, the production repositories and the shipped schema,
 * behind a database that counts what the run actually asked it to do.
 *
 * Nothing here reimplements an economic rule. The counting database is a `D1DatabaseLike` that
 * forwards every call to the real in-memory D1 double and records the shape of the work: batches,
 * statements by kind, rows returned by reads and `meta.changes` written. Those are all *measured*
 * facts about this run; nothing in the harness pretends to be a Cloudflare billing number.
 */

export interface CostCounters {
  batches: number;
  statements: number;
  reads: number;
  readRows: number;
  writes: number;
  writeRows: number;
  receiptWrites: number;
  autoStateWrites: number;
}

export interface SqlCost {
  count: number;
  rows: number;
}

export function emptyCounters(): CostCounters {
  return { batches: 0, statements: 0, reads: 0, readRows: 0, writes: 0, writeRows: 0, receiptWrites: 0, autoStateWrites: 0 };
}

export function counterDelta(before: CostCounters, after: CostCounters): CostCounters {
  return {
    batches: after.batches - before.batches,
    statements: after.statements - before.statements,
    reads: after.reads - before.reads,
    readRows: after.readRows - before.readRows,
    writes: after.writes - before.writes,
    writeRows: after.writeRows - before.writeRows,
    receiptWrites: after.receiptWrites - before.receiptWrites,
    autoStateWrites: after.autoStateWrites - before.autoStateWrites
  };
}

function classify(sql: string, counters: CostCounters): void {
  const head = sql.trimStart().slice(0, 6).toUpperCase();
  const isRead = head.startsWith("SELECT") || head.startsWith("WITH");
  if (isRead) counters.reads += 1;
  else counters.writes += 1;
  if (sql.includes("idempotency_keys")) counters.receiptWrites += 1;
  if (sql.includes("actor_auto_state")) counters.autoStateWrites += 1;
}

class CountingStatement implements D1PreparedStatementLike {
  constructor(
    private readonly inner: D1PreparedStatementLike,
    readonly sql: string,
    private readonly database: CountingD1,
    private readonly counted: boolean
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new CountingStatement(this.inner.bind(...values), this.sql, this.database, this.counted);
  }

  async first<T>(): Promise<T | null> {
    if (this.counted) {
      this.database.counters.statements += 1;
      classify(this.sql, this.database.counters);
    }
    const row = await this.inner.first<T>();
    if (this.counted) {
      this.database.counters.readRows += row === null ? 0 : 1;
      this.database.record(this.sql, row === null ? 0 : 1);
    }
    return row;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async all<T>(): Promise<{ readonly results: T[] }> {
    if (this.counted) {
      this.database.counters.statements += 1;
      classify(this.sql, this.database.counters);
    }
    const result = await this.inner.all<T>();
    if (this.counted) {
      this.database.counters.readRows += result.results.length;
      this.database.record(this.sql, result.results.length);
    }
    return result;
  }

  async run(): Promise<D1RunResultLike> {
    if (this.counted) {
      this.database.counters.statements += 1;
      classify(this.sql, this.database.counters);
    }
    const result = await this.inner.run();
    if (this.counted) {
      this.database.counters.writeRows += result.meta.changes ?? 0;
      this.database.record(this.sql, result.meta.changes ?? 0);
    }
    return result;
  }

  /** The same statement, executed inside a batch that has already accounted for it. */
  uncounted(): CountingStatement {
    return new CountingStatement(this.inner, this.sql, this.database, false);
  }
}

export class CountingD1 implements D1DatabaseLike {
  readonly counters: CostCounters = emptyCounters();
  readonly sql = new Map<string, SqlCost>();

  constructor(private readonly inner: D1DatabaseLike) {}

  record(query: string, rows: number): void {
    const key = query.replaceAll(/\s+/gu, " ").trim();
    const entry = this.sql.get(key) ?? { count: 0, rows: 0 };
    entry.count += 1;
    entry.rows += rows;
    this.sql.set(key, entry);
  }

  /** The measured hot SQL, ranked by executions. */
  topSql(limit = 8, by: "count" | "rows" = "count"): readonly { readonly query: string; readonly count: number; readonly rows: number }[] {
    return [...this.sql.entries()]
      .map(([query, cost]) => ({ query, ...cost }))
      .sort((left, right) => (by === "rows" ? right.rows - left.rows : right.count - left.count))
      .slice(0, limit);
  }

  /** How many statements matching a fragment were executed, for the read-reuse assertions. */
  countsMatching(fragment: string): number {
    let total = 0;
    for (const [query, cost] of this.sql) if (query.includes(fragment)) total += cost.count;
    return total;
  }

  prepare(query: string): D1PreparedStatementLike {
    return new CountingStatement(this.inner.prepare(query), query, this, true);
  }

  async batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]> {
    this.counters.batches += 1;
    for (const statement of statements) {
      this.counters.statements += 1;
      if (statement instanceof CountingStatement) {
        classify(statement.sql, this.counters);
        this.record(statement.sql, 0);
      }
    }
    const results = await this.inner.batch(
      statements.map((statement) => (statement instanceof CountingStatement ? statement.uncounted() : statement))
    );
    for (const result of results) this.counters.writeRows += result.meta.changes ?? 0;
    return results;
  }
}

class MutableAuth implements AuthenticationPort<Request> {
  player: PlayerId | null = PLAYER_ONE_ID;
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.player === null ? null : { playerId: this.player });
  }
}

/** A clock the harness moves, so a field's whole growth cycle passes in a few lines. */
export class MutableClock implements Clock {
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
    return parseTreeInstanceId(`treeinst_eeeeeeee-eeee-4eee-8eee-${String(this.serial++).padStart(12, "0")}`);
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

export interface StepSample {
  readonly phase: string;
  readonly step: string | null;
  readonly counters: CostCounters;
}

export interface CycleResult {
  readonly counters: CostCounters;
  readonly steps: number;
  readonly settlements: number;
  readonly byStep: Readonly<Record<string, CostCounters>>;
  readonly replantAction: string | null;
  readonly topSql: readonly { readonly query: string; readonly count: number; readonly rows: number }[];
  readonly digest: string;
  /** Simulated seconds the measured cycle advanced, from the harness clock it drove. */
  readonly elapsedSeconds: number;
  /** The HTTP status that ended the run early, when the harness was told to tolerate it. */
  readonly endedWith: number | null;
  /** Where the simulated time went, in seconds. MEASURED from the steps themselves. */
  readonly timeDistribution: {
    readonly travel: number;
    readonly growth: number;
    readonly supply: number;
    readonly resource: number;
    readonly work: number;
    readonly other: number;
  };
  /** Travel seconds split by the destination anchor of the walk, MEASURED from the step bodies. */
  readonly travelByDestination: {
    readonly cell: number;
    readonly warehouse: number;
    readonly market: number;
  };
  /** Travel seconds split by `from -> to` anchor leg, so input/output logistics are separable. */
  readonly travelByLeg: Readonly<Record<string, number>>;
  /** How many walks ended at each anchor kind. */
  readonly walksByDestination: {
    readonly cell: number;
    readonly warehouse: number;
    readonly market: number;
  };
  /** The logistics the loop actually performed, from the settled steps themselves. */
  readonly logistics: {
    readonly supplyTrips: number;
    readonly unloadTrips: number;
    readonly supplyUnits: number;
    readonly unloadUnits: number;
    /** Supply loads after which the hands were exactly full (the capacity bound was reached). */
    readonly supplyTripsFilledToCapacity: number;
    /** Unloads that began with the hands exactly full. */
    readonly unloadTripsAtCapacity: number;
    readonly totalUnusedCapacityAtUnload: number;
  };
  /** Cargo utilization, MEASURED from the step bodies' own `cargo` meter. */
  readonly cargoMetrics: {
    readonly capacity: number;
    readonly samples: number;
    readonly avgUsed: number;
    readonly peakUsed: number;
    readonly avgUtilization: number;
    readonly peakUtilization: number;
    readonly avgUnitsPerSupplyTrip: number;
    readonly avgUnitsPerUnloadTrip: number;
    readonly avgUnusedCapacityAtUnload: number;
  };
}

export interface CostWorld {
  readonly db: NodeD1Database;
  readonly counting: CountingD1;
  readonly clock: MutableClock;
  readonly handle: (request: Request) => Promise<Response>;
  readonly cells: readonly { readonly x: number; readonly y: number }[];
  /** The cargo capacity the actor is created with in this world (production default is 30). */
  readonly cargoCapacity: number;
  serial: number;
}

export interface CostWorldOptions {
  /**
   * A benchmark-only cargo capacity, injected through the *production* `CargoCapacityLookup` port so
   * the actor row (and therefore the database's own capacity guard) carries it. Left out, the world
   * uses the shipped `MAIN_CHARACTER: 30`; the override never touches production configuration.
   */
  readonly cargoCapacity?: number;
}

export function createCostWorld(cellCount: number, options: CostWorldOptions = {}): CostWorld {
  const db = new NodeD1Database(schemaSql());
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
  const counting = new CountingD1(db);
  const clock = new MutableClock();
  const ids = new FixedIds();
  const handle = createHandler({
    db: counting,
    authenticator: new MutableAuth(),
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
    cargoCapacities:
      options.cargoCapacity === undefined
        ? gameDataCargoCapacities
        : { forActorKind: (): number => options.cargoCapacity ?? 0 },
    clock
  });
  // The harness measures the loop, not the empty-database setup: reset after the world exists.
  counting.counters.statements = 0;
  counting.counters.batches = 0;
  counting.counters.reads = 0;
  counting.counters.readRows = 0;
  counting.counters.writes = 0;
  counting.counters.writeRows = 0;
  counting.counters.receiptWrites = 0;
  counting.counters.autoStateWrites = 0;

  // The first `cellCount` farm-capable cells in the field band, in a stable order.
  const cells: { x: number; y: number }[] = [];
  for (let y = 20; y < 70 && cells.length < cellCount; y += 1) {
    for (let x = 0; x < 60 && cells.length < cellCount; x += 1) {
      if (gameDataWorkAreaGround.capabilitiesAt({ x, y }).includes("FARM")) cells.push({ x, y });
    }
  }
  if (cells.length < cellCount) throw new Error(`Only ${String(cells.length)} farm cells are available`);
  return {
    db,
    counting,
    clock,
    handle,
    cells,
    cargoCapacity: options.cargoCapacity ?? 30,
    serial: 0
  };
}

/** A request helper so a test can drive the real handler without rebuilding `Request`s. */
export async function apiRequest(
  world: CostWorld,
  method: string,
  path: string,
  payload?: unknown
): Promise<Response> {
  return world.handle(
    new Request(`https://api.test${path}`, {
      method,
      ...(payload === undefined
        ? {}
        : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } })
    })
  );
}

export interface ReconcileView {
  readonly startedAt: string | null;
  readonly targetAt: string;
  readonly reconciledThrough: string;
  readonly elapsedConsumedSeconds: number;
  readonly transitionsProcessed: number;
  readonly economicSettlements: number;
  readonly steps: number;
  readonly stopReason: string;
  readonly budgetExhausted: boolean;
  readonly budget: { readonly transitions: number; readonly steps: number };
}

/** One reconciliation call through the real route, as a returning client makes it. */
export async function reconcileOnce(world: CostWorld, farmId: string): Promise<ReconcileView> {
  world.serial += 1;
  const response = await apiRequest(world, "POST", `/farms/${farmId}/auto/reconcile`, {
    requestId: `reconcile_${String(world.serial).padStart(6, "0")}`
  });
  if (response.status !== 200) throw new Error(`Reconcile failed: ${String(response.status)}`);
  const body: { readonly data: { readonly reconciliation: ReconcileView } } = await response.json();
  return body.data.reconciliation;
}

/** The durable Auto timeline, as the reconciliation tests assert on it. */
export function autoStateOf(world: CostWorld):
  | { readonly anchor_kind: string | null; readonly travel_kind: string | null; readonly travel_arrives_at: string | null; readonly version: number; readonly simulation_at: string | null }
  | undefined {
  return world.db.sqlite
    .prepare("SELECT anchor_kind, travel_kind, travel_arrives_at, version, simulation_at FROM actor_auto_state LIMIT 1")
    .get() as
    | { readonly anchor_kind: string | null; readonly travel_kind: string | null; readonly travel_arrives_at: string | null; readonly version: number; readonly simulation_at: string | null }
    | undefined;
}

export function scalar(world: CostWorld, sql: string): number {
  const row = world.db.sqlite.prepare(sql).get() as { readonly n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * A canonical digest of every durable row the loop could have produced.
 *
 * Two runs of the same scenario under the same fixed ids and clock produce the same digest only if
 * every economic and timeline table ended in the same state, which is what makes it a reference-vs-
 * optimized equivalence proof rather than a smoke test.
 */
export function durableDigest(db: NodeD1Database, farmId: string): string {
  const tables: readonly (readonly [string, string])[] = [
    ["crops", `SELECT id, farm_id, tile_x, tile_y, crop_definition_id, version FROM crop_instances ORDER BY id`],
    ["tiles", `SELECT farm_id, x, y, terrain_type, tile_state, version FROM farm_tiles ORDER BY y, x`],
    ["cargo", `SELECT actor_id, item_definition_id, quantity, version FROM actor_cargo_items ORDER BY item_definition_id`],
    ["inventory", `SELECT player_id, item_definition_id, quantity, version FROM inventory_items ORDER BY item_definition_id`],
    ["actors", `SELECT id, cargo_capacity, cargo_version, cargo_transfer_id, control_mode, version FROM actors ORDER BY id`],
    // The timeline watermark is deliberately *not* part of this digest: B3 changed its persistence on
    // purpose (a walk must not erase how far Auto has been reconciled), and the reconciliation tests
    // pin that column directly. Everything the economy produces is inside the digest.
    ["auto", `SELECT actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version FROM actor_auto_state ORDER BY actor_id`],
    ["progression", `SELECT player_id, level, xp, progression_version FROM player_progression ORDER BY player_id`],
    ["wallet", `SELECT player_id, currency_id, balance, version FROM wallets ORDER BY player_id, currency_id`],
    ["ledger", `SELECT id, delta, balance_before, balance_after, reason, reference_type, reference_id, request_id FROM economy_ledger ORDER BY id`],
    ["receipts", `SELECT actor_player_id, operation, request_id, resource_id FROM idempotency_keys ORDER BY operation, request_id`],
    ["plant_settlements", `SELECT id, crop_definition_id, version FROM crop_instances ORDER BY id`],
    ["harvest_settlements", `SELECT actor_player_id, operation, request_id, crop_instance_id, quantity, destination FROM harvest_settlements ORDER BY request_id`],
    ["jobs", `SELECT id, kind, target_definition_id, priority, enabled, auto_purchase_supplies, version FROM actor_jobs WHERE farm_id = '${farmId}' ORDER BY id`],
    ["areas", `SELECT id, kind, display_name, version FROM work_areas WHERE farm_id = '${farmId}' ORDER BY id`]
  ];
  const state = tables.map(([name, sql]) => [name, db.sqlite.prepare(sql).all()]);
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export interface StepBody {
  readonly ok: boolean;
  readonly data: {
    readonly step: {
      readonly phase: string;
      readonly step: string | null;
      readonly waitReason: string | null;
      readonly retryAfterMs: number;
      readonly itemDefinitionId: string | null;
      readonly quantity: number | null;
      readonly from: { readonly kind: string; readonly x: number | null; readonly y: number | null } | null;
      readonly to: { readonly kind: string; readonly x: number | null; readonly y: number | null } | null;
      readonly cargo: { readonly used: number; readonly capacity: number };
    };
  };
}

export interface DriveOptions {
  readonly cellCount: number;
  readonly seedQuantity: number;
  readonly maxSteps: number;
  /** How many harvests the measured cycle should cover (defaults to the cell count, at least 15). */
  readonly targetHarvests?: number;
  /**
   * The client's presentation window after a successful transition, in milliseconds.
   *
   * The deployed client waits `AUTO_GESTURE_MS` before asking for the next step while it plays the
   * work gesture; the harness advances its server clock by the same amount so the measurement models
   * the real online cadence. It changes nothing in the authoritative model.
   */
  readonly gestureMs?: number;
  /**
   * Stop once the simulated clock has advanced this far, instead of at a harvest count.
   *
   * A fixed simulated window is what makes two cadences comparable: the same hour of world time, with
   * whatever work each cadence managed to fit into it.
   */
  readonly untilSeconds?: number;
  /** Raise the warehouse above its starter capacity for the measurement. */
  readonly warehouseCapacity?: number;
  /**
   * Stop the measurement instead of throwing when a step answers an error (for example a full
   * warehouse refusing an all-or-nothing unload). The metrics gathered up to that point are kept and
   * `endedWith` names the status.
   */
  readonly tolerateStepFailure?: boolean;
}

/**
 * One full field cycle, driven exactly as the browser drives it: one request per step, the clock moved
 * past whatever the server said it was waiting for, and no step repeated while one is in flight.
 *
 * The cycle ends when every cell has been harvested once and the carrots have been delivered, which is
 * the point the loop is ready to replant; one more step is taken to observe that readiness.
 */
export async function driveCycle(world: CostWorld, options: DriveOptions): Promise<CycleResult> {
  const { handle, clock, db, counting } = world;
  const request = (method: string, path: string, payload?: unknown): Promise<Response> =>
    handle(
      new Request(`https://api.test${path}`, {
        method,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } })
      })
    );
  const post = (path: string, payload: unknown): Promise<Response> => request("POST", path, payload);
  const json = async <T>(response: Response): Promise<T> => {
    const body: unknown = await response.json();
    return body as T;
  };

  const farmId = await setupAutoFarm(world, {
    seedQuantity: options.seedQuantity,
    ...(options.warehouseCapacity === undefined ? {} : { warehouseCapacity: options.warehouseCapacity })
  });

  // The measurement starts here: from nothing planted to the field cycled once.
  const targetHarvests = options.targetHarvests ?? Math.max(options.cellCount, 15);
  const untilSeconds = options.untilSeconds ?? null;
  const gestureSeconds = (options.gestureMs ?? 500) / 1000;
  const distribution = { travel: 0, growth: 0, supply: 0, resource: 0, work: 0, other: 0 };
  const travelByDestination = { cell: 0, warehouse: 0, market: 0 };
  const walksByDestination = { cell: 0, warehouse: 0, market: 0 };
  const travelByLeg: Record<string, number> = {};
  const logistics = {
    supplyTrips: 0,
    unloadTrips: 0,
    supplyUnits: 0,
    unloadUnits: 0,
    supplyTripsFilledToCapacity: 0,
    unloadTripsAtCapacity: 0,
    totalUnusedCapacityAtUnload: 0
  };
  let cargoSamples = 0;
  let cargoUsedSum = 0;
  let cargoPeak = 0;
  let lastCargoUsed = 0;
  const cargoCapacity = world.cargoCapacity;
  const baseline = { ...counting.counters };
  const startedAt = clock.now();
  const byStep: Record<string, CostCounters> = {};
  let settlements = 0;
  let steps = 0;
  let serial = 0;
  let replantAction: string | null = null;
  let endedWith: number | null = null;

  const harvested = (): number =>
    (db.sqlite.prepare("SELECT COUNT(*) AS n FROM harvest_settlements WHERE operation = 'HARVEST_CROP'").get() as { n: number }).n;
  const carriedCarrots = (): number =>
    (
      db.sqlite
        .prepare("SELECT COALESCE(SUM(quantity), 0) AS n FROM actor_cargo_items WHERE item_definition_id = 'item_carrot'")
        .get() as { n: number }
    ).n;

  const runStep = async (): Promise<{ readonly key: string; readonly stall: boolean; readonly step: StepBody["data"]["step"] }> => {
    serial += 1;
    const before = { ...counting.counters };
    const response = await post(`/farms/${farmId}/auto/step`, {
      requestId: `cost_step_${String(serial).padStart(6, "0")}`
    });
    if (response.status !== 200 && options.tolerateStepFailure === true) {
      endedWith = response.status;
      return {
        key: "__ERROR__",
        stall: true,
        step: {
          phase: "WAITING",
          step: null,
          waitReason: null,
          retryAfterMs: 0,
          itemDefinitionId: null,
          quantity: null,
          from: null,
          to: null,
          cargo: { used: 0, capacity: 0 }
        }
      };
    }
    if (response.status !== 200) throw new Error(`Auto step failed: ${String(response.status)}`);
    const step = (await json<StepBody>(response)).data.step;
    steps += 1;
    if (step.phase === "WORKED") settlements += 1;
    const key = `${step.phase}:${step.step ?? "-"}`;
    const delta = counterDelta(before, counting.counters);
    byStep[key] = addCounters(byStep[key] ?? emptyCounters(), delta);
    clock.advanceSeconds(step.retryAfterMs / 1000 + 0.05);
    distribution.other += 0.05;
    if (step.phase === "TRAVELLING") {
      distribution.travel += step.retryAfterMs / 1000;
      const seconds = step.retryAfterMs / 1000;
      const to = step.to?.kind ?? "UNKNOWN";
      if (to === "CELL") {
        travelByDestination.cell += seconds;
        walksByDestination.cell += 1;
      } else if (to === "WAREHOUSE") {
        travelByDestination.warehouse += seconds;
        walksByDestination.warehouse += 1;
      } else if (to === "MARKET") {
        travelByDestination.market += seconds;
        walksByDestination.market += 1;
      }
      const leg = `${step.from?.kind ?? "UNKNOWN"}->${to}`;
      travelByLeg[leg] = (travelByLeg[leg] ?? 0) + seconds;
    }
    else if (step.phase === "WAITING" && step.waitReason === "WAITING_FOR_GROWTH") distribution.growth += step.retryAfterMs / 1000;
    else if (step.phase === "WAITING" && step.waitReason === "WAITING_FOR_RESOURCE") distribution.resource += step.retryAfterMs / 1000;
    else if (step.phase === "WAITING") distribution.supply += step.retryAfterMs / 1000;
    if (step.phase === "WORKED") {
      clock.advanceSeconds(gestureSeconds);
      distribution.work += gestureSeconds;
      const filled = step.cargo.used;
      if (step.step === "LOAD_INPUT" || step.step === "PURCHASE_INPUT" || step.step === "FUND_AND_PURCHASE_INPUT") {
        logistics.supplyTrips += 1;
        logistics.supplyUnits += step.quantity ?? Math.max(0, filled - lastCargoUsed);
        if (filled >= step.cargo.capacity) logistics.supplyTripsFilledToCapacity += 1;
      } else if (step.step === "UNLOAD") {
        logistics.unloadTrips += 1;
        logistics.unloadUnits += lastCargoUsed;
        logistics.totalUnusedCapacityAtUnload += Math.max(0, step.cargo.capacity - lastCargoUsed);
        if (lastCargoUsed >= step.cargo.capacity) logistics.unloadTripsAtCapacity += 1;
      }
    }
    // The cargo meter the panel sees after every step: the carried quantity that made this step's
    // decision, so average/peak utilization is measured and not modelled.
    cargoSamples += 1;
    cargoUsedSum += step.cargo.used;
    cargoPeak = Math.max(cargoPeak, step.cargo.used);
    lastCargoUsed = step.cargo.used;
    return { key, stall: step.phase === "WAITING" && step.retryAfterMs === 0, step };
  };

  // Phase 1: the cycle under test - every target harvest, with the planting and supply it needs.
  for (let index = 0; index < options.maxSteps; index += 1) {
    if (untilSeconds !== null) {
      if ((Date.parse(clock.now()) - Date.parse(startedAt)) / 1000 >= untilSeconds) break;
    } else if (harvested() >= targetHarvests) {
      break;
    }
    const { stall } = await runStep();
    if (stall) break;
  }

  // Phase 2: let the hands finish their delivery, which is the part of the loop a small field cannot
  // reach inside the harvest target alone. It stops at the first WORKED delivery or when nothing can
  // change without the player acting.
  if (untilSeconds === null && harvested() >= targetHarvests) {
    for (let index = 0; index < 8; index += 1) {
      if (carriedCarrots() === 0) break;
      const { key, stall } = await runStep();
      if (stall) break;
      if (key === "WORKED:UNLOAD") break;
    }
  }

  const measured = counterDelta(baseline, counting.counters);
  const elapsedSeconds = (Date.parse(clock.now()) - Date.parse(startedAt)) / 1000;

  // Replant readiness: what the loop would do next, without executing it. Its own reads are excluded
  // from the measured cycle above.
  if (harvested() >= targetHarvests) {
    const probe = await post(`/farms/${farmId}/auto/step`, { requestId: "cost_step_probe_000001" });
    if (probe.status === 200) {
      const step = (await json<StepBody>(probe)).data.step;
      replantAction = step.step ?? step.phase;
    }
  }

  return {
    counters: measured,
    steps,
    settlements,
    byStep,
    replantAction,
    topSql: counting.topSql(10, "count"),
    digest: durableDigest(db, farmId),
    elapsedSeconds,
    endedWith,
    timeDistribution: distribution,
    travelByDestination,
    travelByLeg,
    walksByDestination,
    logistics,
    cargoMetrics: {
      capacity: cargoCapacity,
      samples: cargoSamples,
      avgUsed: cargoSamples === 0 ? 0 : cargoUsedSum / cargoSamples,
      peakUsed: cargoPeak,
      avgUtilization: cargoSamples === 0 || cargoCapacity === 0 ? 0 : cargoUsedSum / cargoSamples / cargoCapacity,
      peakUtilization: cargoCapacity === 0 ? 0 : cargoPeak / cargoCapacity,
      avgUnitsPerSupplyTrip:
        logistics.supplyTrips === 0 ? 0 : logistics.supplyUnits / logistics.supplyTrips,
      avgUnitsPerUnloadTrip:
        logistics.unloadTrips === 0 ? 0 : logistics.unloadUnits / logistics.unloadTrips,
      avgUnusedCapacityAtUnload:
        logistics.unloadTrips === 0 ? 0 : logistics.totalUnusedCapacityAtUnload / logistics.unloadTrips
    }
  };
}

export interface AutoFarmOptions {
  readonly seedQuantity: number;
  /** Leave Auto off: the reconciliation must then do nothing at all. */
  readonly startAuto?: boolean;
  /** Skip the gold grant, so a purchase cannot be afforded. */
  readonly gold?: number;
  /**
   * Raise the Home Island warehouse above its starter capacity.
   *
   * A throughput measurement wants the *labor* to be the limit, not the starter 1000-unit shelf; the
   * starter capacity is a separate logistics question and is measured on its own.
   */
  readonly warehouseCapacity?: number;
}

/**
 * A farm with one FARM work area over the harness cells, one carrot assignment, a warehouse stock and
 * (by default) Auto switched on - the state an offline reconciliation expects to find.
 */
export async function setupAutoFarm(world: CostWorld, options: AutoFarmOptions): Promise<string> {
  const { handle, cells, db } = world;
  const request = (method: string, path: string, payload?: unknown): Promise<Response> =>
    handle(
      new Request(`https://api.test${path}`, {
        method,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } })
      })
    );
  const post = (path: string, payload: unknown): Promise<Response> => request("POST", path, payload);
  const json = async <T>(response: Response): Promise<T> => {
    const body: unknown = await response.json();
    return body as T;
  };

  // The harness's id generator always mints the fixture farm id, so the URL is known without parsing
  // the bootstrap response; the schema check keeps that assumption honest.
  const farmId = FARM_ONE_ID;
  if (!FarmIdSchema.safeParse(farmId).success) throw new Error("Harness farm id is invalid");
  await post("/farms", { name: "Cost Farm" });
  db.sqlite
    .prepare(
      "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = ?"
    )
    .run(PLAYER_ONE_ID, options.gold ?? 1000, NOW, NOW, options.gold ?? 1000);
  const created = await post(`/farms/${farmId}/work-areas`, {
    requestId: "cost_area_0000000001",
    kind: "FARM",
    name: "Cost Field",
    cells
  });
  if (created.status !== 201) {
    throw new Error(`Work area creation failed: ${String(created.status)} ${JSON.stringify(await created.json())}`);
  }
  const area = await json<{ data: { workArea: { workAreaId: string } } }>(created);
  const assignment = await post(`/farms/${farmId}/jobs`, {
    requestId: "cost_job_0000000001",
    workAreaId: area.data.workArea.workAreaId,
    kind: "FARM",
    targetDefinitionId: "crop_carrot"
  });
  if (assignment.status !== 201) throw new Error(`Job creation failed: ${String(assignment.status)}`);
  // Raise the shelf *before* stocking it: the warehouse guard is the database's own, and a deep seed
  // store for a long measurement would otherwise trip `warehouse_full` on the harness's own insert.
  if (options.warehouseCapacity !== undefined) {
    db.sqlite
      .prepare("UPDATE home_island_warehouses SET capacity = ? WHERE owner_player_id = ?")
      .run(options.warehouseCapacity, PLAYER_ONE_ID);
  }
  if (options.seedQuantity > 0) {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', ?, 1, ?)"
      )
      .run(PLAYER_ONE_ID, options.seedQuantity, NOW);
  }
  if (options.startAuto !== false) {
    const workers = await json<{ data: { actor: { version: number } } }>(await request("GET", `/farms/${farmId}/workers`));
    const started = await post(`/farms/${farmId}/workers/control`, {
      requestId: "cost_start_0000000001",
      startAuto: true,
      expectedVersion: workers.data.actor.version
    });
    if (started.status !== 200) throw new Error(`Auto start failed: ${String(started.status)}`);
  }
  return farmId;
}

export function addCounters(left: CostCounters, right: CostCounters): CostCounters {
  return {
    batches: left.batches + right.batches,
    statements: left.statements + right.statements,
    reads: left.reads + right.reads,
    readRows: left.readRows + right.readRows,
    writes: left.writes + right.writes,
    writeRows: left.writeRows + right.writeRows,
    receiptWrites: left.receiptWrites + right.receiptWrites,
    autoStateWrites: left.autoStateWrites + right.autoStateWrites
  };
}
