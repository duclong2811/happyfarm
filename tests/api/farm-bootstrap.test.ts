import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { createDevWorker, type DevEnv } from "../../workers/api/src/dev-index";
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
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * Farm bootstrap: one player, one farm, however often they ask.
 *
 * The local development database that could not start was full of duplicate farms from before the
 * unique index existed (see `tests/integration/farm-uniqueness-repair.test.ts`). This file holds the
 * behaviour that must be true now: a first request creates exactly one farm, every later request
 * resolves that same one, concurrent first requests settle on one farm, the starter package is granted
 * once, and a farm that already has progress is returned untouched.
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
  "0015_player_identities.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const DEV_TOKEN = "dev-bootstrap-token-0123456789";

class SequenceIds implements IdGenerator {
  private sequence = 1;
  newFarmId(): FarmId {
    return this.sequence++ === 1 ? FARM_ONE_ID : FARM_TWO_ID;
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
}

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

/** The development host's identity, as `.dev.vars` supplies it. */
function devEnv(db: NodeD1Database): DevEnv {
  return {
    DB: db,
    DEV_AUTH_ENABLED: "true",
    DEV_AUTH_TOKEN: DEV_TOKEN,
    DEV_PLAYER_ID: PLAYER_ONE_ID,
    DEV_AUTH_ISSUER: "https://dev.happy-farm.local",
    DEV_AUTH_SUBJECT: "dev-player-one",
    DEV_PLAYER_DISPLAY_NAME: "Dev Player One"
  };
}

function devRequest(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Request {
  const headers = new Headers({ authorization: `Bearer ${DEV_TOKEN}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://dev.happy-farm.local${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

describe("development farm bootstrap", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    handle = createDevWorker(devEnv(db));
  });

  afterEach(() => {
    db.close();
  });

  function farmCount(): number {
    const row: unknown = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get();
    return (row as { readonly count: number }).count;
  }

  /** The farm a response describes, so the tests read as "which farm came back". */
  async function farmOf(response: Response): Promise<{ readonly id: string; readonly name: string }> {
    const body: unknown = await response.json();
    return (body as { readonly data: { readonly farm: { readonly id: string; readonly name: string } } }).data.farm;
  }

  it("creates one farm for a player who has none, and returns it on every later request", async () => {
    const bootstrap = await handle(devRequest("/__dev/bootstrap", undefined, "POST"));
    expect(bootstrap.status).toBe(200);

    const created = await handle(devRequest("/farms", { name: "Starter Farm" }));
    expect(created.status).toBe(201);
    const first = await farmOf(created);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const again = await handle(devRequest("/farms", { name: "Starter Farm" }));
      // 200: the farm already existed, and it is the same one.
      expect(again.status).toBe(200);
      expect((await farmOf(again)).id).toBe(first.id);
    }
    expect(farmCount()).toBe(1);
  });

  it("returns a farm that already has progress, untouched", async () => {
    await handle(devRequest("/__dev/bootstrap", undefined, "POST"));
    const created = await handle(devRequest("/farms", { name: "Starter Farm" }));
    const farmId = (await farmOf(created)).id;

    // Progress: a planted crop and a built thing, plus the starter land every farm is created with.
    db.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 5, 5, 'crop_carrot', ?, ?, 1, ?, ?)"
      )
      .run(farmId, PLAYER_ONE_ID, NOW, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES ('construct_11111111-1111-4111-8111-111111111111', ?, 'world.market_stall', 'BUILDING', 10, 4, 0, 2, 2, 10, 11, 4, 5, 4, 'ACTIVE', ?, 'STARTER', 'starter.building.market_stall', 0, 0, 'currency_gold', ?, ?, NULL, 1)"
      )
      .run(farmId, PLAYER_ONE_ID, NOW, NOW);
    const tileRow: unknown = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(farmId);
    const tiles = (tileRow as { readonly count: number }).count;

    const again = await handle(devRequest("/farms", { name: "Renamed" }));
    expect(again.status).toBe(200);
    const repeat = await farmOf(again);
    // The same farm, with the name it already had: a repeat is a read, not a rename.
    expect(repeat.id).toBe(farmId);
    expect(repeat.name).toBe("Starter Farm");
    expect(farmCount()).toBe(1);
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE farm_id = ?").get(farmId) as {
        readonly count: number;
      }).count
    ).toBe(1);
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_constructions WHERE farm_id = ?").get(farmId) as {
        readonly count: number;
      }).count
    ).toBe(1);
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(farmId) as {
        readonly count: number;
      }).count
    ).toBe(tiles);
  });

  it("absorbs two first requests that race each other", async () => {
    await handle(devRequest("/__dev/bootstrap", undefined, "POST"));
    const [first, second] = await Promise.all([
      handle(devRequest("/farms", { name: "Starter Farm" })),
      handle(devRequest("/farms", { name: "Starter Farm" }))
    ]);
    const firstFarm = await farmOf(first);
    const secondFarm = await farmOf(second);

    // One created the farm and one read the winner's; neither saw a unique-constraint failure.
    expect([first.status, second.status].sort((left, right) => left - right)).toEqual([200, 201]);
    expect(firstFarm.id).toBe(secondFarm.id);
    expect(farmCount()).toBe(1);
  });

  it("grants the starter package once, however often the player bootstraps", async () => {
    await handle(devRequest("/__dev/bootstrap", undefined, "POST"));
    await handle(devRequest("/farms", { name: "Starter Farm" }));
    await handle(devRequest("/__dev/bootstrap", undefined, "POST"));
    await handle(devRequest("/farms", { name: "Starter Farm" }));

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets").get()).toEqual({ balance: 100 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items").get()).toEqual({ quantity: 10 });
    expect(farmCount()).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles").get()).toEqual({ count: 144 });
  });

  it("refuses a second farm for one player at the database itself", () => {
    // The invariant is the index, not the use case: even a direct insert cannot fork one player into
    // two farms, which is what makes the application's resolve-then-create path safe under a race.
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', 'dev-player-one', 'Dev', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'First', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Second', ?, ?)")
        .run(FARM_TWO_ID, PLAYER_ONE_ID, NOW, NOW)
    ).toThrow(/UNIQUE constraint failed: farms\.owner_player_id/);
  });
});

describe("two players", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let handle: (request: Request) => Promise<Response>;

  class SwitchableAuth implements AuthenticationPort<Request> {
    constructor(private actor: ActorContext | null) {}
    setActor(actor: ActorContext | null): void {
      this.actor = actor;
    }
    authenticate(): Promise<ActorContext | null> {
      return Promise.resolve(this.actor);
    }
  }

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    auth = new SwitchableAuth({ playerId: PLAYER_ONE_ID });
    handle = createHandler({
      db,
      authenticator: auth,
      ids: new SequenceIds(),
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
      clock: new FixedClock()
    });
  });

  afterEach(() => {
    db.close();
  });

  it("gives two players two farms, and neither the other's", async () => {
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Player', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }

    auth.setActor({ playerId: PLAYER_ONE_ID });
    const first = await handle(
      new Request("https://dev.happy-farm.local/farms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "First Farm" })
      })
    );
    auth.setActor({ playerId: PLAYER_TWO_ID });
    const second = await handle(
      new Request("https://dev.happy-farm.local/farms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Second Farm" })
      })
    );
    const firstFarm: unknown = await first.json();
    const secondFarm: unknown = await second.json();
    const firstId = (firstFarm as { readonly data: { readonly farm: { readonly id: string } } }).data.farm.id;
    const secondId = (secondFarm as { readonly data: { readonly farm: { readonly id: string } } }).data.farm.id;

    expect(firstId).not.toBe(secondId);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 2 });
    // And the first player still cannot reach the second's farm.
    auth.setActor({ playerId: PLAYER_ONE_ID });
    const stranger = await handle(new Request(`https://dev.happy-farm.local/farms/${secondId}`));
    expect(stranger.status).toBe(403);
  });
});
