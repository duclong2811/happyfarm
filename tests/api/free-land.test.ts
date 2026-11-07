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
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * V14.5.2: the natural Home Island is free land.
 *
 * A player plants and builds anywhere the island is valid without buying anything - no quote, no
 * purchase, no land Gold. The only costs are the ones the game already had (a seed, a construction
 * price), and the geography rules are unchanged: ocean, the pond, the beach, the volcano and reserved
 * ground still refuse.
 */

const migration = [
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

class FixedAuth implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve({ playerId: PLAYER_ONE_ID });
  }
}
class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}
class FixedIds implements IdGenerator {
  private economySequence = 1;
  private cropSequence = 1;
  private constructionSequence = 1;
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId(
      `cropinst_cccccccc-cccc-4ccc-8ccc-${String(this.cropSequence++).padStart(12, "0")}`
    );
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(
      `econ_eeeeeeee-eeee-4eee-8eee-${String(this.economySequence++).padStart(12, "0")}`
    );
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(
      `construct_11111111-1111-4111-8111-${String(this.constructionSequence++).padStart(12, "0")}`
    );
  }
}

describe("free natural Home Island land", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Player One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    handle = createHandler({
      db,
      authenticator: new FixedAuth(),
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
      clock: new FixedClock()
    });
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Free Land Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    // Deliberately zero gold: if anything charged for land, the plant and the build below would fail.
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 0, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  function post(path: string, body: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" }
      })
    );
  }

  function give(itemDefinitionId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)"
      )
      .run(PLAYER_ONE_ID, itemDefinitionId, quantity, NOW);
  }

  function gold(): number {
    const row = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID) as { balance: number };
    return row.balance;
  }

  async function codeOf(response: Response): Promise<string> {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "";
    const error = (body as { readonly error?: unknown }).error;
    if (typeof error !== "object" || error === null) return "";
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }

  async function cropIdOf(response: Response): Promise<string> {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "";
    const data = (body as { readonly data?: unknown }).data;
    if (typeof data !== "object" || data === null) return "";
    const crop = (data as { readonly crop?: unknown }).crop;
    if (typeof crop !== "object" || crop === null) return "";
    const id = (crop as { readonly cropInstanceId?: unknown }).cropInstanceId;
    return typeof id === "string" ? id : "";
  }

  function seedQuantity(): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
      .get(PLAYER_ONE_ID) as { quantity: number };
    return row.quantity;
  }

  function setLevel(xp: number): void {
    db.sqlite
      .prepare(
        "INSERT OR REPLACE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, ?, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, xp, NOW, NOW);
  }

  function plant(x: number, y: number, requestId: string, expectedTileVersion?: number) {
    const body: Record<string, unknown> = { requestId, cropDefinitionId: "crop_carrot", x, y };
    if (expectedTileVersion !== undefined) body.expectedTileVersion = expectedTileVersion;
    return post(`/farms/${FARM_ONE_ID}/crops`, body);
  }

  function tileRowCount(x: number, y: number): number {
    const row = db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?")
      .get(FARM_ONE_ID, x, y) as { count: number };
    return row.count;
  }

  /**
   * The exact real-browser first-use shape: a distant natural grass cell with no farm_tiles row, a
   * plant request that carries no `expectedTileVersion` at all, and no land purchase anywhere.
   */
  it("plants a completely unused natural cell, the QA (9,26) shape", async () => {
    give("item_carrot_seed", 1);
    expect(tileRowCount(9, 26)).toBe(0);
    const response = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "qa_first_use_9_26",
      cropDefinitionId: "crop_carrot",
      x: 9,
      y: 26
    });
    expect(response.status).toBe(201);
    expect(tileRowCount(9, 26)).toBe(1);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE farm_id = ? AND tile_x = 9 AND tile_y = 26").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
    expect(seedQuantity()).toBe(0);
    expect(gold()).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
  });

  it("plants on the starter square and on distant natural land, charging no land Gold", async () => {
    give("item_carrot_seed", 2);
    const starter = await plant(5, 5, "free_plant_starter", 1);
    expect(starter.status).toBe(201);
    // (20,20) has no farm_tiles row: it is natural land, and the plant writes the row it needs.
    const distant = await plant(20, 20, "free_plant_distant");
    expect(distant.status).toBe(201);

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = 20 AND y = 20").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
    // The only cost was the seed.
    expect(seedQuantity()).toBe(0);
    expect(gold()).toBe(0);
  });

  it("leaves every existing ownership row in place when planting far away", async () => {
    give("item_carrot_seed", 1);
    const before = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID);
    await plant(20, 20, "free_plant_keeps_rows");
    const after = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID);
    // One new row for the planted cell; not one existing row removed.
    expect((after as { count: number }).count).toBe((before as { count: number }).count + 1);
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        expect(
          db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?").get(FARM_ONE_ID, x, y)
        ).toEqual({ count: 1 });
      }
    }
  });

  it("still refuses the ocean, the pond and protected ground", async () => {
    give("item_carrot_seed", 3);
    const ocean = await plant(2_000, 2_000, "free_plant_ocean");
    expect(await codeOf(ocean)).toBe("TILE_NOT_PLANTABLE");
    const pond = await plant(-3, 45, "free_plant_pond");
    expect(await codeOf(pond)).toBe("TILE_NOT_PLANTABLE");
    // The village square is ground the island keeps for itself.
    const plaza = await plant(45, 3, "free_plant_plaza");
    expect(await codeOf(plaza)).toBe("TILE_NOT_PLANTABLE");
    expect(seedQuantity()).toBe(3);
    expect(gold()).toBe(0);
  });

  it("creates no tile row when a rowless natural cell is refused", async () => {
    give("item_carrot_seed", 2);
    for (const [x, y, requestId] of [
      [2_000, 2_000, "free_no_row_ocean"],
      [-3, 45, "free_no_row_pond"],
      [45, 3, "free_no_row_plaza"]
    ] as const) {
      const refused = await post(`/farms/${FARM_ONE_ID}/crops`, {
        requestId,
        cropDefinitionId: "crop_carrot",
        x,
        y
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(tileRowCount(x, y)).toBe(0);
    }
    expect(seedQuantity()).toBe(2);
  });

  it("creates no orphan tile row when the seed is missing", async () => {
    // No seed stocked at all: the plant must fail before the settlement writes anything.
    const refused = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "free_no_seed",
      cropDefinitionId: "crop_carrot",
      x: 23,
      y: 23
    });
    expect(await codeOf(refused)).toBe("INSUFFICIENT_ITEMS");
    expect(tileRowCount(23, 23)).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
  });

  it("plants a production tree on a rowless natural cell", async () => {
    // Level 3 is 60 * 2 * 3 = 360 experience; tree_apple unlocks there.
    setLevel(360);
    give("item_apple_sapling", 1);
    expect(tileRowCount(22, 22)).toBe(0);
    const planted = await post(`/farms/${FARM_ONE_ID}/trees`, {
      requestId: "free_tree_rowless",
      treeDefinitionId: "tree_apple",
      x: 22,
      y: 22
    });
    expect(planted.status).toBe(201);
    expect(tileRowCount(22, 22)).toBe(1);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances WHERE farm_id = ? AND tile_x = 22 AND tile_y = 22").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
    expect(gold()).toBe(0);
  });

  it("replays a duplicate first-use request exactly once", async () => {
    give("item_carrot_seed", 2);
    const body = { requestId: "free_duplicate", cropDefinitionId: "crop_carrot", x: 24, y: 24 };
    expect((await post(`/farms/${FARM_ONE_ID}/crops`, body)).status).toBe(201);
    expect((await post(`/farms/${FARM_ONE_ID}/crops`, body)).status).toBe(201);
    expect(tileRowCount(24, 24)).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
    // One seed, one crop, however many times the same request id arrives.
    expect(seedQuantity()).toBe(1);
  });

  it("lets exactly one of two concurrent first-use plants on a rowless cell win", async () => {
    give("item_carrot_seed", 2);
    const first = post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "free_concurrent_a",
      cropDefinitionId: "crop_carrot",
      x: 25,
      y: 25
    });
    const second = post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "free_concurrent_b",
      cropDefinitionId: "crop_carrot",
      x: 25,
      y: 25
    });
    const responses = await Promise.all([first, second]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(tileRowCount(25, 25)).toBe(1);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE farm_id = ? AND tile_x = 25 AND tile_y = 25").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
    // Exactly one seed for the one successful planting.
    expect(seedQuantity()).toBe(1);
  });

  it("still detects a stale version on an existing tile row", async () => {
    give("item_carrot_seed", 1);
    // (5,5) is a starter row at version 1: a client that read a different version is refused.
    const stale = await plant(5, 5, "free_stale_version", 99);
    expect(await codeOf(stale)).toBe("CONFLICT_STALE_STATE");
    expect(seedQuantity()).toBe(1);
  });

  it("replants a cell that was cleared after an uproot", async () => {
    give("item_carrot_seed", 2);
    const planted = await plant(5, 5, "free_replant_first", 1);
    expect(planted.status).toBe(201);
    const cropId = await cropIdOf(planted);
    const uprooted = await post(`/farms/${FARM_ONE_ID}/crops/${cropId}/uproot`, {
      requestId: "free_replant_uproot",
      expectedCropVersion: 1
    });
    expect(uprooted.status).toBeLessThan(300);
    // The tile row remains after an uproot, so the replant uses the ordinary versioned path.
    const replanted = await plant(5, 5, "free_replant_second", 1);
    expect(replanted.status).toBe(201);
    expect(seedQuantity()).toBe(0);
  });

  it("builds a construction on distant natural land for its own price only", async () => {
    db.sqlite.prepare("UPDATE wallets SET balance = 40 WHERE player_id = ?").run(PLAYER_ONE_ID);
    const built = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "free_build_distant",
      entryId: "place_tree_broad",
      anchorX: 30,
      anchorY: 30,
      rotation: 0
    });
    expect(built.status).toBe(201);
    // Exactly the tree's own 40 gold - no land fee.
    expect(gold()).toBe(0);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = 30 AND y = 30").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
  });

  it("refuses an ocean footprint without charging or placing anything", async () => {
    db.sqlite.prepare("UPDATE wallets SET balance = 5_000 WHERE player_id = ?").run(PLAYER_ONE_ID);
    // A 4x3 barn anchored in open sea.
    const refused = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "free_build_ocean",
      entryId: "place_barn_t1",
      anchorX: 2_000,
      anchorY: 2_000,
      rotation: 0
    });
    expect(refused.status).toBe(400);
    expect(await codeOf(refused)).toBe("CONSTRUCTION_UNSUITABLE_GROUND");
    expect(gold()).toBe(5_000);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_constructions").get()).toEqual({ count: 0 });
  });
});
