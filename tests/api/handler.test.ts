import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  GetBuildCatalogResponseSchema,
  GetCropDefinitionsResponseSchema,
  GetFarmTilesResponseSchema,
  GetProgressionResponseSchema,
  GetTreeDefinitionsResponseSchema,
  TreeStateDTOSchema,
  GetShopResponseSchema,
  GetWalletResponseSchema
  ,ConstructionDTOSchema
} from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE, PLOT_TILE_COUNT, parseConstructionId, parseCropInstanceId, parseEconomyTransactionId, plotTiles, type ConstructionId, type CropInstanceId, type EconomyTransactionId, type FarmId } from "@happy-farm/domain";
import { parseTreeInstanceId, type TreeInstanceId } from "@happy-farm/domain";
import { itemRegistry, shops } from "@happy-farm/game-data";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataConstructionDefinitions, GameDataCropDefinitions, GameDataCurrencyDefinitions, GameDataItemDefinitions, GameDataPlotDefinitions, GameDataShopEntries, GameDataTreeDefinitions, Sha256Fingerprint, gameDataProgressionDefinition, gameDataStarterWorld, gameDataTileTerrain } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql", "0005_player_progression.sql", "0006_farm_expansion.sql", "0007_seed_economy.sql", "0008_tree_instances.sql", "0009_starter_package.sql", "0010_farm_constructions.sql", "0011_construction_editing.sql", "0012_world_objects.sql", "0013_world_objects_v2.sql", "0014_one_farm_per_player.sql", "0015_player_identities.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const ShopEnvelopeSchema = z.object({ ok: z.literal(true), data: GetShopResponseSchema }).strict();
const FarmEnvelopeSchema = z.object({ ok: z.literal(true), data: z.object({ farm: z.looseObject({ id: z.string() }) }) });
const ConstructionEnvelopeSchema = z.object({ ok: z.literal(true), data: z.object({ construction: ConstructionDTOSchema }) });
const ConstructionsEnvelopeSchema = z.object({ ok: z.literal(true), data: z.object({ constructions: z.array(ConstructionDTOSchema) }) });
const RemovedEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    constructionId: z.string(),
    refundAmount: z.number().int().nonnegative(),
    refundCurrencyDefinitionId: z.string()
  })
});
const FailureEnvelopeSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) });
const WalletEnvelopeSchema = z.object({ ok: z.literal(true), data: GetWalletResponseSchema }).strict();
const TilesEnvelopeSchema = z.object({ ok: z.literal(true), data: GetFarmTilesResponseSchema }).strict();
const CropDefinitionsEnvelopeSchema = z
  .object({ ok: z.literal(true), data: GetCropDefinitionsResponseSchema })
  .strict();
const TreeDefinitionsEnvelopeSchema = z
  .object({ ok: z.literal(true), data: GetTreeDefinitionsResponseSchema })
  .strict();
const ProgressionEnvelopeSchema = z.object({ ok: z.literal(true), data: GetProgressionResponseSchema }).strict();
const BuildCatalogEnvelopeSchema = z
  .object({ ok: z.literal(true), data: GetBuildCatalogResponseSchema })
  .strict();

class FixedAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class FixedIds implements IdGenerator {
  private economySequence = 1;
  /**
   * A construction id per call, for the same reason the economy's ids count: a farm may hold more
   * than one object now, and a generator that returned one id would make the *second* building
   * collide with the first's primary key rather than testing what the test meant to test.
   */
  private constructionSequence = 1;
  /**
   * A farm id per call, for the same reason the others count.
   *
   * V13.6.1 opens the alpha to several testers, so a test has to be able to create *two* farms through
   * the API and see them be different; a generator that returned one id would collide on the primary
   * key and prove nothing about multi-user isolation.
   */
  private farmSequence = 1;
  newFarmId(): FarmId {
    return this.farmSequence++ === 1 ? FARM_ONE_ID : FARM_TWO_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.economySequence++).padStart(12, "0")}`);
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(
      `construct_11111111-1111-4111-8111-${String(this.constructionSequence++).padStart(12, "0")}`
    );
  }
}

describe("Worker API foundation", () => {
  let db: NodeD1Database;
  let auth: FixedAuth;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, "https://identity.test", "subject-one", "Player One", NOW, NOW);
    auth = new FixedAuth({ playerId: PLAYER_ONE_ID });
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
      clock: new FixedClock()
    });
  });

  afterEach(() => {
    db.close();
  });

  /** Stock one item for a player so a planting or a sale has something to spend. */
  function giveItem(itemDefinitionId: string, quantity: number, player = PLAYER_ONE_ID): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)"
      )
      .run(player, itemDefinitionId, quantity, NOW);
  }

  it("serves health without authentication", async () => {
    auth.setActor(null);
    const response = await handle(new Request("https://api.test/health"));
    expect(response.status).toBe(200);
  });

  it("does not offer a session route on a host that has no session concept", async () => {
    // The development bridge has no cookie identity, so `/session` is absent rather than a route
    // that would have to invent one. The deployed worker is the host that serves it.
    const response = await handle(new Request("https://api.test/session"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "RESOURCE_NOT_FOUND" } });
  });

  it("refuses a mutation a browser reports from another origin, before it authenticates anyone", async () => {
    const response = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ name: "Cross" })
      })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("rejects malformed JSON without leaking parser details", async () => {
    const response = await handle(
      new Request("https://api.test/farms", { method: "POST", body: "{", headers: { "content-type": "application/json" } })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("treats a malformed percent-encoded path segment as invalid input, not a server error", async () => {
    const cases = [
      { method: "GET", path: "/farms/%/tiles" },
      { method: "GET", path: "/farms/%/crops" },
      { method: "GET", path: "/farms/%zz" },
      { method: "POST", path: "/farms/%/crops/cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc/harvest" }
    ];
    for (const entry of cases) {
      const response = await handle(new Request(`https://api.test${entry.path}`, { method: entry.method }));
      expect(response.status, entry.path).toBe(400);
      expect(await response.json(), entry.path).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
  });

  it("rejects unauthenticated farm creation", async () => {
    auth.setActor(null);
    const response = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects client-selected ownership fields", async () => {
    const response = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm", playerId: PLAYER_TWO_ID }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(response.status).toBe(400);
  });

  it("refuses a command that carries a client-supplied location", async () => {
    // V14.1: where a player is standing is a *place*, never a permission. No command has a field for
    // one, and the strict request schemas refuse the attempt rather than dropping it silently - so a
    // client cannot name a zone (or an owner) to gain anything, and the actor still comes only from
    // the authenticated session.
    const response = await handle(
      new Request(
        `https://api.test/farms/${FARM_ONE_ID}/crops/cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc/harvest`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: "req_zone_smuggling_1",
            expectedCropVersion: 1,
            zoneId: `zone_home_island_${FARM_TWO_ID}`,
            playerId: PLAYER_TWO_ID
          })
        }
      )
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("creates and reads a farm for the authenticated owner", async () => {
    const created = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(created.status).toBe(201);
    const fetched = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}`));
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({ ok: true, data: { farm: { ownerPlayerId: PLAYER_ONE_ID } } });
  });

  it("rejects cross-player farm access", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    auth.setActor({ playerId: PLAYER_TWO_ID });
    const response = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}`));
    expect(response.status).toBe(403);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("SQLITE");
    expect(bodyText).not.toContain("stack");
  });

  it("exposes starter land with tile versions so planting needs no hand-seeded tile", async () => {
    const created = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(created.status).toBe(201);
    giveItem("item_carrot_seed", 3);

    const response = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`));
    expect(response.status).toBe(200);
    const body = TilesEnvelopeSchema.parse(await response.json());
    expect(body.data.tiles).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(body.data.tiles[0]).toMatchObject({ x: 0, y: 0, terrainType: "SOIL", state: "IDLE", version: 1 });

    const planted = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify({
          requestId: "starter_land_plant_001",
          cropDefinitionId: "crop_carrot",
          x: 0,
          y: 0,
          expectedTileVersion: 1
        }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(planted.status).toBe(201);

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const forbidden = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`));
    expect(forbidden.status).toBe(403);

    auth.setActor(null);
    const anonymous = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/tiles`));
    expect(anonymous.status).toBe(401);

    const malformed = await handle(new Request("https://api.test/farms/not-a-farm-id/tiles"));
    expect(malformed.status).toBe(400);
  });

  it("plants and reads server-derived crop state without accepting client time", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    giveItem("item_carrot_seed", 2);

    const rejectedTime = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify({
          requestId: "request_api_001",
          cropDefinitionId: "crop_carrot",
          x: 0,
          y: 0,
          expectedTileVersion: 1,
          plantedAt: "2000-01-01T00:00:00.000Z"
        }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(rejectedTime.status).toBe(400);

    const request = {
      requestId: "request_api_001",
      cropDefinitionId: "crop_carrot",
      x: 0,
      y: 0,
      expectedTileVersion: 1
    };
    const planted = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" }
      })
    );
    expect(planted.status).toBe(201);
    expect(await planted.json()).toMatchObject({
      ok: true,
      data: { crop: { cropInstanceId: "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", plantedAt: NOW } }
    });

    const retry = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" }
      })
    );
    expect(retry.status).toBe(201);

    const crops = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`));
    expect(crops.status).toBe(200);
    expect(await crops.json()).toMatchObject({ ok: true, data: { crops: [{ definitionId: "crop_carrot" }] } });
    // The seed was spent by the server, once, in the same transaction as the crop.
    expect(
      db.sqlite
        .prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 1, version: 2 });

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const unauthorized = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`));
    expect(unauthorized.status).toBe(403);
  });

  it("returns a stable idempotency conflict for payload mismatch", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    giveItem("item_carrot_seed", 2);

    const post = (cropDefinitionId: string) =>
      handle(
        new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
          method: "POST",
          body: JSON.stringify({
            requestId: "request_api_002",
            cropDefinitionId,
            x: 0,
            y: 0,
            expectedTileVersion: 1
          }),
          headers: { "content-type": "application/json" }
        })
      );
    expect((await post("crop_carrot")).status).toBe(201);
    // A different crop is not the difference that matters, and the gated crops are refused before
    // the replay is consulted, so the conflict is provoked with an ungated crop at a new coordinate.
    const conflict = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify({
          requestId: "request_api_002",
          cropDefinitionId: "crop_carrot",
          x: 1,
          y: 0,
          expectedTileVersion: 1
        }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("serves the crop catalogue and gates planting by the level it reports", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    giveItem("item_wheat_seed", 1);
    const plant = (cropDefinitionId: string, x: number, requestId: string) =>
      handle(
        new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
          method: "POST",
          body: JSON.stringify({ requestId, cropDefinitionId, x, y: 0, expectedTileVersion: 1 }),
          headers: { "content-type": "application/json" }
        })
      );

    const catalogue = await handle(new Request("https://api.test/crop-definitions"));
    expect(catalogue.status).toBe(200);
    const body = CropDefinitionsEnvelopeSchema.parse(await catalogue.json());
    expect(body.data.definitions.map((entry) => [entry.cropDefinitionId, entry.requiredLevel])).toEqual([
      ["crop_carrot", 1],
      ["crop_wheat", 2],
      ["crop_corn", 3]
    ]);
    // The catalogue carries the seed each planting spends and the display keys the client
    // translates, and nothing that belongs to the player: no count, no level, no inventory.
    for (const entry of body.data.definitions) {
      expect(Object.keys(entry).sort()).toEqual([
        "baseQuantity",
        "cropDefinitionId",
        "displayNameKey",
        "growthDurationSeconds",
        "harvestItemDefinitionId",
        "harvestXp",
        "requiredLevel",
        "seedItemDefinitionId",
        "seedItemDisplayNameKey"
      ]);
    }
    expect(body.data.definitions[0]).toMatchObject({
      cropDefinitionId: "crop_carrot",
      seedItemDefinitionId: "item_carrot_seed",
      seedItemDisplayNameKey: "item.carrot_seed.name"
    });

    auth.setActor(null);
    expect((await handle(new Request("https://api.test/crop-definitions"))).status).toBe(401);
    auth.setActor({ playerId: PLAYER_ONE_ID });

    const locked = await plant("crop_wheat", 0, "request_api_locked_wheat");
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ ok: false, error: { code: "CROP_LEVEL_REQUIRED" } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });

    // The build catalogue is read-only reference data, on the same terms as the crop list: the player
    // has to be authenticated, and what comes back is the deployment's own catalogue rather than
    // anything about this player - no owned land, no inventory, no purchase.
    const build = await handle(new Request("https://api.test/build-catalog"));
    expect(build.status).toBe(200);
    const buildBody = BuildCatalogEnvelopeSchema.parse(await build.json());
    expect(buildBody.data.entries.length).toBeGreaterThan(20);
    const roads = buildBody.data.entries.filter((entry) => entry.category === "ROAD");
    expect(roads.map((entry) => [entry.entryId, entry.requiredLevel, entry.price])).toEqual([
      ["place_road_dirt", 1, 100],
      ["place_road_gravel", 2, 250],
      ["place_road_stone", 3, 500],
      ["place_road_paved", 4, 900]
    ]);
    // Every row carries a name the client can show before it has a translation, and no row claims a
    // capability the island does not have.
    for (const entry of buildBody.data.entries) {
      expect(entry.label.length, entry.entryId).toBeGreaterThan(0);
      expect(entry.requiredLevel, entry.entryId).toBeGreaterThanOrEqual(1);
      expect(entry.price, entry.entryId).toBeGreaterThanOrEqual(0);
    }
    auth.setActor(null);
    expect((await handle(new Request("https://api.test/build-catalog"))).status).toBe(401);
    auth.setActor({ playerId: PLAYER_ONE_ID });

    // The catalogue is a promise the API keeps: a player who reached level 2 can plant the crop the
    // catalogue said level 2 unlocks.
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 2, 120, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    const unlocked = await plant("crop_wheat", 0, "request_api_unlocked_wheat");
    expect(unlocked.status).toBe(201);
    expect(await unlocked.json()).toMatchObject({ ok: true, data: { crop: { definitionId: "crop_wheat" } } });
    const stillLocked = await plant("crop_corn", 1, "request_api_locked_corn");
    expect(stillLocked.status).toBe(403);
    expect(await stillLocked.json()).toMatchObject({ ok: false, error: { code: "CROP_LEVEL_REQUIRED" } });
    expect(
      db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_wheat_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 0 });
  });

  it("refuses to plant without a seed and leaves the tile free", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    const planted = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
        method: "POST",
        body: JSON.stringify({ requestId: "no_seed_plant_001", cropDefinitionId: "crop_carrot", x: 0, y: 0, expectedTileVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(planted.status).toBe(409);
    expect(await planted.json()).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_ITEMS" } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
  });

  it("uproots a growing crop through an explicit owner command and replays safely", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    giveItem("item_carrot_seed", 1);
    const plantUrl = `https://api.test/farms/${FARM_ONE_ID}/crops`;
    const planted = await handle(
      new Request(plantUrl, {
        method: "POST",
        body: JSON.stringify({ requestId: "uproot_setup_001", cropDefinitionId: "crop_carrot", x: 0, y: 0, expectedTileVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    const cropId = "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(await planted.json()).toMatchObject({ ok: true, data: { crop: { cropInstanceId: cropId, mature: false } } });

    const uprootUrl = `https://api.test/farms/${FARM_ONE_ID}/crops/${cropId}/uproot`;
    const rejected = await handle(
      new Request(uprootUrl, {
        method: "POST",
        body: JSON.stringify({ requestId: "uproot_api_001", expectedCropVersion: 1, refund: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(rejected.status).toBe(400);

    const removed = await handle(
      new Request(uprootUrl, {
        method: "POST",
        body: JSON.stringify({ requestId: "uproot_api_001", expectedCropVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, data: { removed: { cropInstanceId: cropId } } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 0 });
    // The seed is not refunded: uprooting deletes the crop and nothing else.
    expect(
      db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 0 });

    const replay = await handle(
      new Request(uprootUrl, {
        method: "POST",
        body: JSON.stringify({ requestId: "uproot_api_001", expectedCropVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, data: { removed: { cropInstanceId: cropId } } });

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const forbidden = await handle(
      new Request(uprootUrl, {
        method: "POST",
        body: JSON.stringify({ requestId: "uproot_api_002", expectedCropVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(forbidden.status).toBe(403);
  });

  it("harvests through an explicit command and exposes only the actor inventory", async () => {
    await handle(new Request("https://api.test/farms", {
      method: "POST",
      body: JSON.stringify({ name: "Starter Farm" }),
      headers: { "content-type": "application/json" }
    }));
    db.sqlite.prepare("INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 0, 0, 'crop_carrot', ?, '2026-09-26T23:55:00.000Z', 1, ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);

    const rejectedReward = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops/cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc/harvest`, {
      method: "POST",
      body: JSON.stringify({ requestId: "harvest_api_001", expectedCropVersion: 1, quantity: 999 }),
      headers: { "content-type": "application/json" }
    }));
    expect(rejectedReward.status).toBe(400);

    const harvested = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops/cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc/harvest`, {
      method: "POST",
      body: JSON.stringify({ requestId: "harvest_api_001", expectedCropVersion: 1 }),
      headers: { "content-type": "application/json" }
    }));
    expect(harvested.status).toBe(200);
    expect(await harvested.json()).toMatchObject({ ok: true, data: { harvest: { itemDefinitionId: "item_carrot", quantityAdded: 2 } } });

    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_wheat', 9, ?, 1)").run(PLAYER_TWO_ID, NOW);
    const response = await handle(new Request("https://api.test/inventory"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { items: [
      { itemDefinitionId: "item_carrot", displayNameKey: "item.carrot.name", category: "CROP", quantity: 2 }
    ] } });
    auth.setActor(null);
    expect((await handle(new Request("https://api.test/inventory"))).status).toBe(401);
  });

  it("reports derived levelling for the actor and answers a harvest replay from the stored award", async () => {
    await handle(new Request("https://api.test/farms", {
      method: "POST",
      body: JSON.stringify({ name: "Starter Farm" }),
      headers: { "content-type": "application/json" }
    }));
    db.sqlite.prepare("INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 0, 0, 'crop_carrot', ?, '2026-09-26T23:55:00.000Z', 1, ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);

    // A player who has never earned experience reads as level 1, and reading stores nothing. The
    // response is parsed by the schema the client validates against, so the served shape is checked.
    expect(ProgressionEnvelopeSchema.parse(await (await handle(new Request("https://api.test/progression"))).json())).toEqual({
      ok: true,
      data: { progression: { level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 120, maxLevel: 50 } }
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM player_progression").get()).toEqual({ count: 0 });

    const harvestUrl = `https://api.test/farms/${FARM_ONE_ID}/crops/cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc/harvest`;
    const harvested = await handle(new Request(harvestUrl, {
      method: "POST",
      body: JSON.stringify({ requestId: "harvest_progression_001", expectedCropVersion: 1 }),
      headers: { "content-type": "application/json" }
    }));
    const award = await harvested.json();
    expect(award).toEqual({
      ok: true,
      data: {
        harvest: { cropInstanceId: "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", itemDefinitionId: "item_carrot", quantityAdded: 2 },
        progression: { xpAwarded: 4, leveledUp: false, progression: { level: 1, xp: 4, xpIntoLevel: 4, xpForNextLevel: 120, maxLevel: 50 } }
      }
    });

    // Reading afterwards agrees with the award the harvest already reported, in a shape the client's
    // own validator accepts — this is the same row the planting gate reads.
    expect(ProgressionEnvelopeSchema.parse(await (await handle(new Request("https://api.test/progression"))).json())).toEqual({
      ok: true,
      data: { progression: { level: 1, xp: 4, xpIntoLevel: 4, xpForNextLevel: 120, maxLevel: 50 } }
    });

    // The replay is answered from the stored award rather than recomputed, and the crop it names no
    // longer exists, so a harvest can never pay its experience twice.
    expect(await (await handle(new Request(harvestUrl, {
      method: "POST",
      body: JSON.stringify({ requestId: "harvest_progression_001", expectedCropVersion: 1 }),
      headers: { "content-type": "application/json" }
    }))).json()).toEqual(award);
    expect(db.sqlite.prepare("SELECT xp, level, progression_version FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ xp: 4, level: 1, progression_version: 2 });

    // Ownership, and any levelling input a client could name, are ignored exactly as for wallets.
    expect(await (await handle(new Request(`https://api.test/progression?playerId=${PLAYER_TWO_ID}&level=99&xp=147000`))).json()).toEqual({
      ok: true,
      data: { progression: { level: 1, xp: 4, xpIntoLevel: 4, xpForNextLevel: 120, maxLevel: 50 } }
    });

    auth.setActor(null);
    expect((await handle(new Request("https://api.test/progression"))).status).toBe(401);
  });

  it("settles explicit Buy/Sell commands and rejects client-authored authority fields", async () => {
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const post = (path: string, body: unknown) => handle(new Request(`https://api.test${path}`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
    }));
    const valid = { requestId: "shop_api_001", shopEntryId: "shop_carrot_seed", quantity: 2 };
    for (const injected of [
      { price: 1 }, { unitPrice: 1 }, { total: 1 }, { currencyId: "currency_fake" },
      { currencyDelta: 999 }, { reward: 999 }, { balance: 999 }, { playerId: PLAYER_TWO_ID }
    ]) {
      const response = await post("/shop/buy", { ...valid, ...injected });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    const bought = await post("/shop/buy", valid);
    expect(bought.status).toBe(200);
    expect(await bought.json()).toEqual({ ok: true, data: { settlement: {
      itemDefinitionId: "item_carrot_seed", quantity: 2, currencyId: "currency_gold", amountSpent: 4, newBalance: 96
    } } });
    giveItem("item_carrot", 3);
    const sold = await post("/shop/sell", { requestId: "shop_api_002", shopEntryId: "shop_carrot", quantity: 1 });
    expect(sold.status).toBe(200);
    expect(await sold.json()).toMatchObject({ ok: true, data: { settlement: { amountReceived: 2, newBalance: 98 } } });
    // The loop is closed in both directions: gold buys seeds, produce is sold, and neither entry
    // trades the other way.
    const produceNotForSale = await post("/shop/buy", { requestId: "shop_api_004", shopEntryId: "shop_carrot", quantity: 1 });
    expect(produceNotForSale.status).toBe(400);
    expect(await produceNotForSale.json()).toMatchObject({ ok: false, error: { code: "SHOP_ENTRY_NOT_ALLOWED" } });
    const seedsNotBought = await post("/shop/sell", { requestId: "shop_api_005", shopEntryId: "shop_carrot_seed", quantity: 1 });
    expect(seedsNotBought.status).toBe(400);
    expect(await seedsNotBought.json()).toMatchObject({ ok: false, error: { code: "SHOP_ENTRY_NOT_ALLOWED" } });
    auth.setActor(null);
    expect((await post("/shop/buy", { ...valid, requestId: "shop_api_003" })).status).toBe(401);
  });

  it("treats a per-entry quantity bound violation as a client error, not an internal error", async () => {
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const response = await handle(new Request("https://api.test/shop/buy", {
      method: "POST",
      body: JSON.stringify({ requestId: "shop_bound_001", shopEntryId: "shop_carrot_seed", quantity: 1_001 }),
      headers: { "content-type": "application/json" }
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_QUANTITY" } });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 100, version: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
  });

  it("isolates wallets, inventory, and stored results across players", async () => {
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 7, 1, ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', 5, ?, 1)").run(PLAYER_TWO_ID, NOW);
    const post = (path: string, body: unknown) => handle(new Request(`https://api.test${path}`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
    }));

    const sharedRequest = { requestId: "shared_economy_request", shopEntryId: "shop_carrot_seed", quantity: 2 };
    const authored = await post("/shop/buy", sharedRequest);
    expect(authored.status).toBe(200);
    expect(await authored.json()).toMatchObject({ ok: true, data: { settlement: { newBalance: 96 } } });

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const replayed = await post("/shop/buy", { ...sharedRequest, quantity: 1 });
    expect(await replayed.json()).toMatchObject({ ok: true, data: { settlement: { newBalance: 5 } } });

    auth.setActor({ playerId: PLAYER_ONE_ID });
    const crossPlayerSale = await post("/shop/sell", { requestId: "cross_player_sell_001", shopEntryId: "shop_carrot", quantity: 5 });
    expect(crossPlayerSale.status).toBe(409);
    expect(await crossPlayerSale.json()).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_ITEMS" } });

    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 96 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_TWO_ID)).toEqual({ balance: 5 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'").get(PLAYER_ONE_ID)).toEqual({ quantity: 2 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'").get(PLAYER_TWO_ID)).toEqual({ quantity: 1 });
    expect(db.sqlite.prepare("SELECT player_id, COUNT(*) AS count FROM economy_ledger GROUP BY player_id ORDER BY player_id").all()).toEqual([
      { player_id: PLAYER_ONE_ID, count: 1 },
      { player_id: PLAYER_TWO_ID, count: 1 }
    ]);
  });

  it("keeps a request ID isolated between farm and shop operations", async () => {
    await handle(new Request("https://api.test/farms", {
      method: "POST", body: JSON.stringify({ name: "Starter Farm" }), headers: { "content-type": "application/json" }
    }));
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    giveItem("item_carrot_seed", 1);
    const sharedRequestId = "shared_operation_request";
    const planted = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
      method: "POST",
      body: JSON.stringify({ requestId: sharedRequestId, cropDefinitionId: "crop_carrot", x: 0, y: 0, expectedTileVersion: 1 }),
      headers: { "content-type": "application/json" }
    }));
    expect(planted.status).toBe(201);

    const bought = await handle(new Request("https://api.test/shop/buy", {
      method: "POST",
      body: JSON.stringify({ requestId: sharedRequestId, shopEntryId: "shop_carrot_seed", quantity: 1 }),
      headers: { "content-type": "application/json" }
    }));
    expect(bought.status).toBe(200);
    expect(await bought.json()).toMatchObject({ ok: true, data: { settlement: { amountSpent: 2, newBalance: 98 } } });
    expect(db.sqlite.prepare("SELECT operation FROM idempotency_keys ORDER BY operation").all()).toEqual([
      { operation: "BUY_ITEM" },
      { operation: "PLANT_CROP" }
    ]);
  });

  it("exposes no generic wallet, inventory, or ledger mutation surface", async () => {
    const routes = [
      ["POST", "/wallet"], ["PATCH", "/wallet"], ["POST", "/wallet/add"], ["POST", "/wallet/set"],
      ["POST", "/wallet/debit"], ["POST", "/inventory/grant"], ["POST", "/inventory/add"],
      ["POST", "/inventory/remove"], ["GET", "/ledger"], ["POST", "/ledger/create"],
      ["GET", "/shop/buy"], ["PUT", "/shop/buy"], ["DELETE", "/shop/sell"]
    ] as const;
    for (const [method, path] of routes) {
      const response = await handle(new Request(`https://api.test${path}`, { method }));
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("serves the read-only authoritative shop catalog without side effects", async () => {
    const counts = () => ({
      wallets: db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get(),
      inventory: db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get(),
      ledger: db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get(),
      idempotency: db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()
    });
    const before = counts();
    auth.setActor(null);
    expect((await handle(new Request("https://api.test/shop"))).status).toBe(401);
    auth.setActor({ playerId: PLAYER_ONE_ID });

    const response = await handle(new Request("https://api.test/shop"));
    expect(response.status).toBe(200);
    const body = ShopEnvelopeSchema.parse(await response.json());
    expect(body).toEqual({
      ok: true,
      data: {
        entries: shops.map((entry) => ({
          shopEntryId: entry.id,
          itemDefinitionId: entry.itemDefinitionId,
          itemDisplayNameKey: itemRegistry.get(entry.itemDefinitionId)?.displayNameKey,
          category: itemRegistry.get(entry.itemDefinitionId)?.category,
          currencyId: entry.currencyDefinitionId,
          currencyDisplayNameKey: "currency.gold.name",
          // Game data leaves the closed direction absent; the contract makes that an explicit null.
          buyPrice: entry.buyPrice ?? null,
          sellPrice: entry.sellPrice ?? null,
          maxQuantityPerRequest: entry.maxQuantityPerRequest
        }))
      }
    });
    expect(body.data.entries).toHaveLength(shops.length);
    expect(body.data.entries).toContainEqual({
      shopEntryId: "shop_carrot_seed",
      itemDefinitionId: "item_carrot_seed",
      itemDisplayNameKey: "item.carrot_seed.name",
      category: "SEED",
      currencyId: "currency_gold",
      currencyDisplayNameKey: "currency.gold.name",
      buyPrice: 2,
      sellPrice: null,
      maxQuantityPerRequest: 1_000
    });
    expect(body.data.entries).toContainEqual({
      shopEntryId: "shop_carrot",
      itemDefinitionId: "item_carrot",
      itemDisplayNameKey: "item.carrot.name",
      category: "CROP",
      currencyId: "currency_gold",
      currencyDisplayNameKey: "currency.gold.name",
      buyPrice: null,
      sellPrice: 2,
      maxQuantityPerRequest: 1_000
    });
    for (const entry of body.data.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "buyPrice", "category", "currencyDisplayNameKey", "currencyId", "itemDefinitionId",
        "itemDisplayNameKey", "maxQuantityPerRequest", "sellPrice", "shopEntryId"
      ]);
    }
    expect(counts()).toEqual(before);
  });

  it("returns only the authenticated actor's wallet and ignores client-selected owners", async () => {
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 7, 1, ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);

    const mine = await handle(new Request("https://api.test/wallet"));
    expect(mine.status).toBe(200);
    const body = WalletEnvelopeSchema.parse(await mine.json());
    const goldWallet = { currencyId: "currency_gold", displayNameKey: "currency.gold.name" };
    expect(body).toEqual({ ok: true, data: { wallets: [{ ...goldWallet, balance: 100 }] } });

    for (const injected of [
      `https://api.test/wallet?playerId=${PLAYER_TWO_ID}`,
      "https://api.test/wallet?userId=2",
      "https://api.test/wallet?walletOwner=other"
    ]) {
      const response = await handle(new Request(injected, { headers: { "x-player-id": PLAYER_TWO_ID } }));
      expect(await response.json(), injected).toEqual({
        ok: true,
        data: { wallets: [{ ...goldWallet, balance: 100 }] }
      });
    }

    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ ...goldWallet, balance: 7 }] }
    });

    auth.setActor(null);
    expect((await handle(new Request("https://api.test/wallet"))).status).toBe(401);
  });

  it("returns an empty wallet list for a wallet-less actor without writing state", async () => {
    const counts = () => ({
      wallets: db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get(),
      ledger: db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get(),
      idempotency: db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()
    });
    const before = counts();
    const response = await handle(new Request("https://api.test/wallet"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { wallets: [] } });
    expect(counts()).toEqual(before);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ count: 0 });
  });

  it("reflects authoritative balances after read-only shop browsing, Buy, and Sell", async () => {
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const post = (path: string, body: unknown) => handle(new Request(`https://api.test${path}`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
    }));

    // Browsing the shop does not grant pricing authority to the client.
    const catalog = ShopEnvelopeSchema.parse(await (await handle(new Request("https://api.test/shop"))).json());
    expect(catalog.data.entries).toContainEqual(expect.objectContaining({ shopEntryId: "shop_carrot_seed", buyPrice: 2 }));
    expect((await post("/shop/buy", { requestId: "wallet_read_buy_injected", shopEntryId: "shop_carrot_seed", quantity: 2, buyPrice: 1 })).status).toBe(400);

    expect(await (await post("/shop/buy", { requestId: "wallet_read_buy_001", shopEntryId: "shop_carrot_seed", quantity: 2 })).json())
      .toMatchObject({ data: { settlement: { amountSpent: 4, newBalance: 96 } } });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", displayNameKey: "currency.gold.name", balance: 96 }] }
    });

    giveItem("item_carrot", 2);
    expect(await (await post("/shop/sell", { requestId: "wallet_read_sell_001", shopEntryId: "shop_carrot", quantity: 1 })).json())
      .toMatchObject({ data: { settlement: { amountReceived: 2, newBalance: 98 } } });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", displayNameKey: "currency.gold.name", balance: 98 }] }
    });
  });

  it("lists and atomically buys the next server-selected plot with idempotent replay", async () => {
    const created = await handle(new Request("https://api.test/farms", {
      method: "POST",
      body: JSON.stringify({ name: "Expansion Farm" }),
      headers: { "content-type": "application/json" }
    }));
    expect(created.status).toBe(201);
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 500, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);

    const catalogue = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/plots`));
    expect(catalogue.status).toBe(200);
    const catalogueBody: { data: { plots: unknown[] } } = await catalogue.json();
    expect(catalogueBody.data.plots).toHaveLength(8);
    expect(catalogueBody.data.plots[0]).toMatchObject({
      plotId: "plot_1", plotIndex: 1, price: 100, requiredLevel: 1, unlocked: false
    });

    const request = () => handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/plots`, {
      method: "POST",
      body: JSON.stringify({ requestId: "expand_farm_001" }),
      headers: { "content-type": "application/json" }
    }));
    const first = await request();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      data: { expansion: { plotId: "plot_1", plotIndex: 1, amountSpent: 100, newBalance: 400, tilesAdded: PLOT_TILE_COUNT } }
    });
    const replay = await request();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ data: { expansion: { plotId: "plot_1", newBalance: 400 } } });

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE + PLOT_TILE_COUNT
    });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 400, version: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE reason = 'FARM_EXPANSION'").get()).toEqual({ count: 1 });
  });

  it("gates the next plot by the player's level, not by the client", async () => {
    await handle(new Request("https://api.test/farms", {
      method: "POST",
      body: JSON.stringify({ name: "Gated Farm" }),
      headers: { "content-type": "application/json" }
    }));
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 5000, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    // The farm owns plot 1, so the frontier is plot 2, which the catalogue gates at level 2.
    const insertTile = db.sqlite.prepare(
      "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, 'SOIL', 'IDLE', 1, ?)"
    );
    for (const tile of plotTiles(FARM_ONE_ID, 1, NOW)) insertTile.run(tile.farmId, tile.x, tile.y, tile.updatedAt);

    const expand = (requestId: string) => handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/plots`, {
      method: "POST",
      body: JSON.stringify({ requestId }),
      headers: { "content-type": "application/json" }
    }));

    // A level 1 player: the server refuses, and nothing is charged or bought.
    const refused = await expand("expand_gated_001");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: "PLOT_LEVEL_REQUIRED" } });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 5000 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });

    db.sqlite
      .prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 2, 120, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    const allowed = await expand("expand_gated_002");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      data: { expansion: { plotId: "plot_2", plotIndex: 2, tilesAdded: PLOT_TILE_COUNT } }
    });
  });

  it("allows only the owner to expand and lets only one concurrent purchase win", async () => {
    await handle(new Request("https://api.test/farms", {
      method: "POST", body: JSON.stringify({ name: "Concurrent Farm" }),
      headers: { "content-type": "application/json" }
    }));
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 500, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const expand = (requestId: string) => handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/plots`, {
      method: "POST", body: JSON.stringify({ requestId }), headers: { "content-type": "application/json" }
    }));

    const responses = await Promise.all([expand("expand_race_001"), expand("expand_race_002")]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 403 || status === 409)).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE + PLOT_TILE_COUNT
    });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 400 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE reason = 'FARM_EXPANSION'").get()).toEqual({ count: 1 });

    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'other', 'Other', 'ACTIVE', ?, ?)").run(PLAYER_TWO_ID, NOW, NOW);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await expand("expand_other_001")).status).toBe(403);
  });

  it("serves the tree catalogue and gates planting, harvesting and removal by level and server time", async () => {
    const catalogue = await handle(new Request("https://api.test/tree-definitions"));
    expect(catalogue.status).toBe(200);
    const catalogueBody = TreeDefinitionsEnvelopeSchema.parse(await catalogue.json());
    expect(catalogueBody.data.definitions).toHaveLength(1);
    expect(catalogueBody.data.definitions[0]).toMatchObject({
      treeDefinitionId: "tree_apple",
      saplingItemDefinitionId: "item_apple_sapling",
      firstReadySeconds: 3600,
      regrowSeconds: 900,
      harvestItemDefinitionId: "item_apple",
      baseQuantity: 3,
      harvestXp: 10,
      requiredLevel: 3
    });
    // The catalogue carries only what the client renders from: the sapling's own id and name, and
    // never a reward, a price, or a timer the client could set.
    expect(Object.keys(catalogueBody.data.definitions[0] ?? {}).sort()).toEqual([
      "baseQuantity",
      "displayNameKey",
      "firstReadySeconds",
      "growthStages",
      "harvestItemDefinitionId",
      "harvestXp",
      "regrowSeconds",
      "requiredLevel",
      "saplingItemDefinitionId",
      "saplingItemDisplayNameKey",
      "treeDefinitionId"
    ]);

    const created = await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Tree Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(created.status).toBe(201);
    const farmId = FARM_ONE_ID;
    giveItem("item_apple_sapling", 2);
    const plant = (body: unknown) =>
      handle(
        new Request(`https://api.test/farms/${farmId}/trees`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" }
        })
      );
    const plantBody = {
      requestId: "tree_api_plant_001",
      treeDefinitionId: "tree_apple",
      x: 0,
      y: 0,
      expectedTileVersion: 1
    };

    // Level 1 cannot plant the level-3 tree, and the sapling is untouched.
    const locked = await plant(plantBody);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ error: { code: "TREE_LEVEL_REQUIRED" } });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple_sapling'").get()
    ).toEqual({ quantity: 2 });

    // Level 3 plants it; the tree spends one sapling and starts growing.
    db.sqlite
      .prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 3, 360, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    const planted = await plant(plantBody);
    expect(planted.status).toBe(201);
    const plantedBody = z
      .object({ ok: z.literal(true), data: z.object({ tree: TreeStateDTOSchema }).strict() })
      .strict()
      .parse(await planted.json());
    expect(plantedBody.data.tree).toMatchObject({ phase: "GROWING", ready: false, version: 1 });
    const treeInstanceId = plantedBody.data.tree.treeInstanceId;
    expect(parseTreeInstanceId(treeInstanceId)).toBe(treeInstanceId);
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple_sapling'").get()
    ).toEqual({ quantity: 1 });

    const trees = await handle(new Request(`https://api.test/farms/${farmId}/trees`));
    expect(trees.status).toBe(200);
    expect(await trees.json()).toMatchObject({ data: { trees: [{ treeInstanceId }] } });

    // A tree that is not ready cannot be harvested, and a client cannot claim it is.
    const notReady = await handle(
      new Request(`https://api.test/farms/${farmId}/trees/${treeInstanceId}/harvest`, {
        method: "POST",
        body: JSON.stringify({ requestId: "tree_api_harvest_early", expectedTreeVersion: 1 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ error: { code: "TREE_NOT_READY" } });

    // Once the server's own clock says the fruit is ready, one harvest pays fruit and experience.
    db.sqlite.prepare("UPDATE tree_instances SET planted_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", treeInstanceId);
    const harvest = (requestId: string) =>
      handle(
        new Request(`https://api.test/farms/${farmId}/trees/${treeInstanceId}/harvest`, {
          method: "POST",
          body: JSON.stringify({ requestId, expectedTreeVersion: 1 }),
          headers: { "content-type": "application/json" }
        })
      );
    const harvested = await harvest("tree_api_harvest_ready");
    expect(harvested.status).toBe(200);
    expect(await harvested.json()).toMatchObject({
      data: {
        harvest: { treeInstanceId, itemDefinitionId: "item_apple", quantityAdded: 3 },
        progression: { xpAwarded: 10 }
      }
    });
    // Replaying the same request returns the same reward and pays nothing again.
    const replay = await harvest("tree_api_harvest_ready");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ data: { harvest: { quantityAdded: 3 } } });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple'").get()
    ).toEqual({ quantity: 3 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
    ).toEqual({ count: 1 });

    // The tree survives its harvest at the next revision.
    expect(
      db.sqlite.prepare("SELECT version FROM tree_instances WHERE id = ?").get(treeInstanceId)
    ).toEqual({ version: 2 });

    // Removing it needs the owner and the exact revision, and refunds nothing.
    auth.setActor({ playerId: PLAYER_TWO_ID });
    const foreignRemove = await handle(
      new Request(`https://api.test/farms/${farmId}/trees/${treeInstanceId}/remove`, {
        method: "POST",
        body: JSON.stringify({ requestId: "tree_api_remove_other", expectedTreeVersion: 2 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(foreignRemove.status).toBe(403);
    auth.setActor({ playerId: PLAYER_ONE_ID });
    const removed = await handle(
      new Request(`https://api.test/farms/${farmId}/trees/${treeInstanceId}/remove`, {
        method: "POST",
        body: JSON.stringify({ requestId: "tree_api_remove_owner", expectedTreeVersion: 2 }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ data: { removed: { treeInstanceId } } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple_sapling'").get()
    ).toEqual({ quantity: 1 });

    // A body that tries to name authoritative state is rejected outright.
    const injectedBodies: Record<string, unknown>[] = [
      { ...plantBody, xp: 999 },
      { ...plantBody, level: 9 },
      { ...plantBody, saplingItemDefinitionId: "item_carrot_seed" },
      { requestId: "tree_api_injected_harvest", expectedTreeVersion: 2, ready: true }
    ];
    for (const injected of injectedBodies) {
      const response = injected.requestId === "tree_api_injected_harvest"
        ? await handle(
            new Request(`https://api.test/farms/${farmId}/trees/${treeInstanceId}/harvest`, {
              method: "POST",
              body: JSON.stringify(injected),
              headers: { "content-type": "application/json" }
            })
          )
        : await plant(injected);
      expect(response.status, JSON.stringify(injected)).toBe(400);
    }
  });

  /**
   * Construction, end to end through the API.
   *
   * This is the V13 acceptance scenario in miniature: the server charges the catalogue's own price,
   * writes the row, refuses an overlap without charging, refuses a client that names a price or a
   * level, refuses another player's farm, and hands the same farm back after a "reload" - a fresh
   * read through the same handler with the same database.
   */
  describe("construction", () => {
    const post = (path: string, body: unknown) =>
      handle(
        new Request(`https://api.test${path}`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" }
        })
      );

    async function farmWithGold(gold: number): Promise<string> {
      const created = await handle(
        new Request("https://api.test/farms", {
          method: "POST",
          body: JSON.stringify({ name: "Construction Farm" }),
          headers: { "content-type": "application/json" }
        })
      );
      const farmId = FarmEnvelopeSchema.parse(await created.json()).data.farm.id;
      db.sqlite
        .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)")
        .run(PLAYER_ONE_ID, gold, NOW, NOW);
      return farmId;
    }

    const goldOf = (player = PLAYER_ONE_ID): number =>
      (db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(player) as { balance: number })
        .balance;

    /** The failure envelope's code, read without trusting the shape of a JSON body in a test. */
    const codeOf = async (response: Response): Promise<string> =>
      FailureEnvelopeSchema.parse(await response.json()).error.code;

    /** The construction a success envelope carries. */
    const constructionOf = async (response: Response) =>
      ConstructionEnvelopeSchema.parse(await response.json()).data.construction;

    it("builds a tree, charges the catalogue price, and still has it after a reload", async () => {
      const farmId = await farmWithGold(761);
      const built = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_api_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(built.status).toBe(201);
      const construction = await constructionOf(built);
      expect(construction.entryId).toBe("place_tree_broad");
      expect(construction.footprint).toEqual({ widthCells: 1, depthCells: 1 });
      expect(goldOf()).toBe(721);

      // The money went through the ledger, with the construction as its reference.
      const ledger = db.sqlite
        .prepare("SELECT delta, reason, reference_type, reference_id FROM economy_ledger WHERE player_id = ?")
        .get(PLAYER_ONE_ID) as { delta: number; reason: string; reference_type: string; reference_id: string };
      expect(ledger.delta).toBe(-40);
      expect(ledger.reason).toBe("CONSTRUCTION");
      expect(ledger.reference_type).toBe("CONSTRUCTION");
      expect(ledger.reference_id).toBe(construction.constructionId);

      // Reload: a fresh read of the farm reports the same building, at the same cell.
      const reloaded = await handle(new Request(`https://api.test/farms/${farmId}/constructions`));
      expect(reloaded.status).toBe(200);
      const list = ConstructionsEnvelopeSchema.parse(await reloaded.json()).data.constructions;
      // The farm's own objects sit alongside the starter arrangement it was given on this same first
      // read, so the count is "the island plus one", not one.
      const mine = list.filter((entry) => entry.source === "PLAYER_PLACED");
      expect(mine).toHaveLength(1);
      expect(mine[0]?.entryId).toBe("place_tree_broad");
      expect(mine[0]?.anchorX).toBe(5);
      expect(goldOf()).toBe(721);
    });

    it("refuses an overlapping placement without charging again", async () => {
      const farmId = await farmWithGold(761);
      const first = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_overlap_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(first.status).toBe(201);
      const second = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_overlap_002",
        // A level-one decoration, so the refusal under test is the collision rather than the level.
        entryId: "place_tree_pine",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(second.status).toBe(409);
      expect(await codeOf(second)).toBe("CONSTRUCTION_OCCUPIED");
      expect(goldOf()).toBe(721);
      const count = db.sqlite
        .prepare("SELECT COUNT(*) AS total FROM farm_constructions WHERE farm_id = ?")
        .get(farmId) as { total: number };
      expect(count.total).toBe(1);
    });

    it("refuses land the farm does not own", async () => {
      const farmId = await farmWithGold(761);
      const response = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_offland_001",
        entryId: "place_tree_broad",
        anchorX: 4_000,
        anchorY: 4_000,
        rotation: 0
      });
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("CONSTRUCTION_NOT_OWNED");
      expect(goldOf()).toBe(761);
    });

    it("refuses a client that tries to name a price, a level or a footprint", async () => {
      const farmId = await farmWithGold(761);
      for (const injected of [
        { requestId: "build_price_001", entryId: "place_tree_broad", anchorX: 5, anchorY: 5, rotation: 0, price: 0 },
        { requestId: "build_level_001", entryId: "place_tree_broad", anchorX: 5, anchorY: 5, rotation: 0, level: 99 },
        { requestId: "build_foot_001", entryId: "place_tree_broad", anchorX: 5, anchorY: 5, rotation: 0, footprint: { widthCells: 9, depthCells: 9 } }
      ]) {
        const response = await post(`/farms/${farmId}/constructions`, injected);
        expect(response.status, JSON.stringify(injected)).toBe(400);
      }
      expect(goldOf()).toBe(761);
    });

    it("refuses a level the player has not reached, and a road that cannot be built yet", async () => {
      const farmId = await farmWithGold(100_000);
      const locked = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_locked_001",
        entryId: "place_barn_t3",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(locked.status).toBe(403);
      expect(await codeOf(locked)).toBe("CONSTRUCTION_LEVEL_REQUIRED");

      const road = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_road_001",
        entryId: "place_road_dirt",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(road.status).toBe(403);
      expect(await codeOf(road)).toBe("CONSTRUCTION_NOT_ALLOWED");
      expect(goldOf()).toBe(100_000);
    });

    it("refuses a placement the player cannot pay for", async () => {
      const farmId = await farmWithGold(10);
      const response = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_poor_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("INSUFFICIENT_FUNDS");
      expect(goldOf()).toBe(10);
    });

    it("charges once for a repeated request id, and refuses one reused for another payload", async () => {
      const farmId = await farmWithGold(761);
      const body = {
        requestId: "build_repeat_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      };
      const first = await post(`/farms/${farmId}/constructions`, body);
      const second = await post(`/farms/${farmId}/constructions`, body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (await constructionOf(first)).constructionId;
      const secondId = (await constructionOf(second)).constructionId;
      expect(secondId).toBe(firstId);
      expect(goldOf()).toBe(721);

      const reused = await post(`/farms/${farmId}/constructions`, { ...body, anchorX: 6 });
      expect(reused.status).toBe(409);
      expect(await codeOf(reused)).toBe("IDEMPOTENCY_CONFLICT");
      expect(goldOf()).toBe(721);
    });

    it("refuses another player's farm, and an unauthenticated caller", async () => {
      const farmId = await farmWithGold(761);
      db.sqlite
        .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)")
        .run(PLAYER_TWO_ID, NOW, NOW);
      auth.setActor({ playerId: PLAYER_TWO_ID });
      const foreign = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_foreign_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(foreign.status).toBe(403);

      auth.setActor(null);
      const anonymous = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_anon_001",
        entryId: "place_tree_broad",
        anchorX: 5,
        anchorY: 5,
        rotation: 0
      });
      expect(anonymous.status).toBe(401);
      expect(goldOf()).toBe(761);
    });

    /**
     * The freeform rule, end to end: a tree goes on ordinary owned land, and nowhere else.
     *
     * This is the bug the pass opened with. The client used to call every cell inside the plot
     * reservation "owned", so a tree placed at (20,20) - inside the 36x36 rectangle the catalogue can
     * sell, and outside the twelve-tile square this farm actually has - previewed green and was then
     * refused with CONSTRUCTION_NOT_OWNED. The server was right; the preview was wrong. Both now say
     * the same thing, and this pins the server half: owned land takes the tree, and a cell nobody has
     * bought does not.
     */
    it("places a tree on any owned cell, and refuses land the farm has not bought", async () => {
      const farmId = await farmWithGold(400);
      for (const [index, anchor] of [[0, 0], [11, 11]] .entries()) {
        const built = await post(`/farms/${farmId}/constructions`, {
          requestId: `build_owned_${String(index)}`,
          entryId: "place_tree_broad",
          anchorX: anchor[0] ?? 0,
          anchorY: anchor[1] ?? 0,
          rotation: 0
        });
        expect(built.status, `tree at ${String(anchor[0])},${String(anchor[1])}`).toBe(201);
      }
      // Inside the reservation, outside the farm's own rows: the same refusal the bug reported, and
      // now the refusal the preview predicts rather than contradicts.
      const reserved = await post(`/farms/${farmId}/constructions`, {
        requestId: "build_reserved_001",
        entryId: "place_tree_broad",
        anchorX: 20,
        anchorY: 20,
        rotation: 0
      });
      expect(reserved.status).toBe(403);
      expect(await codeOf(reserved)).toBe("CONSTRUCTION_NOT_OWNED");
    });

    describe("editing a built thing", () => {
      /** Builds one thing and returns the row the server wrote. */
      async function build(
        farmId: string,
        body: { readonly requestId: string; readonly entryId: string; readonly anchorX: number; readonly anchorY: number; readonly rotation: 0 | 1 | 2 | 3 }
      ) {
        const response = await post(`/farms/${farmId}/constructions`, body);
        expect(response.status).toBe(201);
        return constructionOf(response);
      }

      it("moves an object for free, releases the old cells, and persists the new place", async () => {
        const farmId = await farmWithGold(2_000);
        const tree = await build(farmId, {
          requestId: "edit_move_001",
          entryId: "place_tree_broad",
          anchorX: 5,
          anchorY: 5,
          rotation: 0
        });
        const goldAfterBuild = goldOf();

        const moved = await post(`/farms/${farmId}/constructions/${tree.constructionId}/move`, {
          requestId: "edit_move_002",
          anchorX: 7,
          anchorY: 8,
          rotation: 0,
          expectedVersion: tree.version
        });
        expect(moved.status).toBe(200);
        const after = await constructionOf(moved);
        expect(after.constructionId).toBe(tree.constructionId);
        expect(after.anchorX).toBe(7);
        expect(after.anchorY).toBe(8);
        // One version further on, and the move cost nothing: moving is not buying again.
        expect(after.version).toBe(tree.version + 1);
        expect(goldOf()).toBe(goldAfterBuild);

        // The old ground is free again: another tree goes where the first one stood.
        const replacement = await build(farmId, {
          requestId: "edit_move_003",
          entryId: "place_tree_pine",
          anchorX: 5,
          anchorY: 5,
          rotation: 0
        });
        expect(replacement.anchorX).toBe(5);

        // A reload reports one object at the new place and one at the old, and no ghost anywhere.
        const reloaded = await handle(new Request(`https://api.test/farms/${farmId}/constructions`));
        const list = ConstructionsEnvelopeSchema.parse(await reloaded.json()).data.constructions;
        // The player's own objects only: the starter arrangement is the rest of the list.
        const mine = list.filter((entry) => entry.source === "PLAYER_PLACED");
        expect(mine).toHaveLength(2);
        expect(mine.filter((entry) => entry.anchorX === 7 && entry.anchorY === 8)).toHaveLength(1);
        expect(mine.filter((entry) => entry.anchorX === 5 && entry.anchorY === 5)).toHaveLength(1);
      });

      it("refuses a move onto unowned land, into another object, or from a stale copy - and changes nothing", async () => {
        const farmId = await farmWithGold(2_000);
        const tree = await build(farmId, {
          requestId: "edit_bad_001",
          entryId: "place_tree_broad",
          anchorX: 5,
          anchorY: 5,
          rotation: 0
        });
        await build(farmId, {
          requestId: "edit_bad_002",
          entryId: "place_tree_pine",
          anchorX: 8,
          anchorY: 8,
          rotation: 0
        });
        const move = (body: Record<string, unknown>) =>
          post(`/farms/${farmId}/constructions/${tree.constructionId}/move`, body);

        const unowned = await move({ requestId: "edit_bad_003", anchorX: 20, anchorY: 20, rotation: 0, expectedVersion: tree.version });
        expect(unowned.status).toBe(403);
        expect(await codeOf(unowned)).toBe("CONSTRUCTION_NOT_OWNED");

        const ontoAnother = await move({ requestId: "edit_bad_004", anchorX: 8, anchorY: 8, rotation: 0, expectedVersion: tree.version });
        expect(ontoAnother.status).toBe(409);
        expect(await codeOf(ontoAnother)).toBe("CONSTRUCTION_OCCUPIED");

        const stale = await move({ requestId: "edit_bad_005", anchorX: 6, anchorY: 6, rotation: 0, expectedVersion: tree.version + 5 });
        expect(stale.status).toBe(409);
        expect(await codeOf(stale)).toBe("CONFLICT_STALE_STATE");

        // Through all of it the object has not moved a cell, and no gold moved either.
        const row = db.sqlite
          .prepare("SELECT anchor_x, anchor_y, version FROM farm_constructions WHERE id = ?")
          .get(tree.constructionId) as { anchor_x: number; anchor_y: number; version: number };
        expect(row.anchor_x).toBe(5);
        expect(row.anchor_y).toBe(5);
        expect(row.version).toBe(tree.version);
        expect(goldOf()).toBe(2_000 - 40 - 40);
      });

      it("turns an object, swapping the cells a rectangle covers", async () => {
        const farmId = await farmWithGold(3_000);
        const barn = await build(farmId, {
          requestId: "edit_turn_001",
          entryId: "place_barn_t1",
          anchorX: 6,
          anchorY: 6,
          rotation: 0
        });
        expect(barn.footprint).toEqual({ widthCells: 4, depthCells: 3 });

        const turned = await post(`/farms/${farmId}/constructions/${barn.constructionId}/rotate`, {
          requestId: "edit_turn_002",
          rotation: 1,
          expectedVersion: barn.version
        });
        expect(turned.status).toBe(200);
        const after = await constructionOf(turned);
        // 4x3 becomes 3x4, and the anchor is the same cell it always was.
        expect(after.footprint).toEqual({ widthCells: 3, depthCells: 4 });
        expect(after.rotation).toBe(1);
        expect(after.anchorX).toBe(6);
        expect(after.anchorY).toBe(6);
        expect(after.version).toBe(barn.version + 1);
        expect(goldOf()).toBe(3_000 - 900);
      });

      it("refuses to turn something the catalogue says is fixed", async () => {
        const farmId = await farmWithGold(3_000);
        // A silo unlocks at level five, so the player is given the experience this test is about
        // rather than the level gate it is not. The level is derived from xp by the one curve, which
        // is why the row carries xp rather than a level somebody typed.
        db.sqlite
          .prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 5, 100000, 1, ?, ?)")
          .run(PLAYER_ONE_ID, NOW, NOW);
        // The silo is the one entry whose asset policy says it does not turn.
        const silo = await build(farmId, {
          requestId: "edit_fixed_001",
          entryId: "place_silo",
          anchorX: 6,
          anchorY: 6,
          rotation: 0
        });
        const turned = await post(`/farms/${farmId}/constructions/${silo.constructionId}/rotate`, {
          requestId: "edit_fixed_002",
          rotation: 1,
          expectedVersion: silo.version
        });
        // 403, the same answer the catalogue gives for a thing that may not be built at all: the
        // caller is allowed to edit their island, and this asset's own policy says not this.
        expect(turned.status).toBe(403);
        expect(await codeOf(turned)).toBe("CONSTRUCTION_NOT_ROTATABLE");
      });

      it("removes an object for the refund its asset declares, exactly once", async () => {
        const farmId = await farmWithGold(3_000);
        const barn = await build(farmId, {
          requestId: "edit_remove_001",
          entryId: "place_barn_t1",
          anchorX: 6,
          anchorY: 6,
          rotation: 0
        });
        expect(goldOf()).toBe(2_100);

        const removed = await post(`/farms/${farmId}/constructions/${barn.constructionId}/remove`, {
          requestId: "edit_remove_002",
          expectedVersion: barn.version
        });
        expect(removed.status).toBe(200);
        const body = RemovedEnvelopeSchema.parse(await removed.json());
        expect(body.data.constructionId).toBe(barn.constructionId);
        // Half of 900, from the asset's own rate rather than from anything the client said.
        expect(body.data.refundAmount).toBe(450);
        expect(goldOf()).toBe(2_550);

        const refundRow = db.sqlite
          .prepare("SELECT delta, reason, reference_id FROM economy_ledger WHERE reason = 'CONSTRUCTION_REFUND'")
          .get() as { delta: number; reason: string; reference_id: string };
        expect(refundRow.delta).toBe(450);
        expect(refundRow.reference_id).toBe(barn.constructionId);

        // Repeating the same request is the same answer, not a second refund.
        const again = await post(`/farms/${farmId}/constructions/${barn.constructionId}/remove`, {
          requestId: "edit_remove_002",
          expectedVersion: barn.version
        });
        expect(again.status).toBe(200);
        expect(goldOf()).toBe(2_550);

        // A new request for an object that no longer exists is a 404, and still no gold.
        const missing = await post(`/farms/${farmId}/constructions/${barn.constructionId}/remove`, {
          requestId: "edit_remove_003",
          expectedVersion: barn.version + 1
        });
        expect(missing.status).toBe(404);
        expect(goldOf()).toBe(2_550);

        // The ground it stood on is free: something else may be built there now.
        const replacement = await build(farmId, {
          requestId: "edit_remove_004",
          entryId: "place_tree_broad",
          anchorX: 6,
          anchorY: 6,
          rotation: 0
        });
        expect(replacement.anchorX).toBe(6);
      });

      it("lets nobody else edit it: not another farm's owner, and not a colleague who did not build it", async () => {
        const farmId = await farmWithGold(2_000);
        const tree = await build(farmId, {
          requestId: "edit_auth_001",
          entryId: "place_tree_broad",
          anchorX: 5,
          anchorY: 5,
          rotation: 0
        });
        db.sqlite
          .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)")
          .run(PLAYER_TWO_ID, NOW, NOW);

        // A stranger: not a member of this farm at all.
        auth.setActor({ playerId: PLAYER_TWO_ID });
        const foreign = await post(`/farms/${farmId}/constructions/${tree.constructionId}/move`, {
          requestId: "edit_auth_002",
          anchorX: 7,
          anchorY: 7,
          rotation: 0,
          expectedVersion: tree.version
        });
        expect(foreign.status).toBe(403);
        expect(await codeOf(foreign)).toBe("NOT_AUTHORIZED");

        // A colleague with the editor role, who did not build this one: the farm's owner may
        // administer it, but another editor may not quietly move somebody else's work.
        db.sqlite
          .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'EDITOR', ?)")
          .run(farmId, PLAYER_TWO_ID, NOW);
        const colleague = await post(`/farms/${farmId}/constructions/${tree.constructionId}/move`, {
          requestId: "edit_auth_003",
          anchorX: 7,
          anchorY: 7,
          rotation: 0,
          expectedVersion: tree.version
        });
        expect(colleague.status).toBe(403);
        expect(await codeOf(colleague)).toBe("OBJECT_NOT_OWNED");

        const row = db.sqlite
          .prepare("SELECT anchor_x, anchor_y FROM farm_constructions WHERE id = ?")
          .get(tree.constructionId) as { anchor_x: number; anchor_y: number };
        expect(row.anchor_x).toBe(5);
        expect(row.anchor_y).toBe(5);
      });
    });

    /**
     * The starter island, as the API gives it and as the player changes it.
     *
     * The whole point of V13.3: the objects that were always there are ordinary rows, seeded once,
     * editable like anything bought, and impossible to turn into gold or into duplicates.
     */
    describe("the starter island", () => {
      const listOf = async (farmId: string) => {
        const response = await handle(new Request(`https://api.test/farms/${farmId}/constructions`));
        expect(response.status).toBe(200);
        return ConstructionsEnvelopeSchema.parse(await response.json()).data.constructions;
      };

      it("gives a farm the whole arrangement exactly once, and the same arrangement every read", async () => {
        const farmId = await farmWithGold(100);
        const first = await listOf(farmId);
        const seeded = first.filter((entry) => entry.source === "STARTER");
        // The whole island: 37 authored objects (V13.3) plus the 344 the V13.3.1 arrangement promotes
        // - the procedural forest, the buildings and the set dressing.
        expect(seeded).toHaveLength(37 + 344);
        // Every starter object is the farm's, paid for by nobody, and carries its placement key.
        for (const entry of seeded) {
          expect(entry.paidAmount).toBe(0);
          expect(entry.placementKey).not.toBeNull();
          expect(entry.state).toBe("ACTIVE");
        }
        // Reading again - the poll the client runs every few seconds - adds nothing at all.
        const second = await listOf(farmId);
        expect(second).toHaveLength(first.length);
        const again = await listOf(farmId);
        expect(again.filter((entry) => entry.source === "STARTER")).toHaveLength(seeded.length);
        // The version is stamped, so the seeding pass is behind the farm for good. A farm created
        // today is given both versions at once and stamped at the current one.
        const version = db.sqlite
          .prepare("SELECT starter_world_version FROM farms WHERE id = ?")
          .get(farmId) as { starter_world_version: number };
        expect(version.starter_world_version).toBe(2);
        expect(goldOf()).toBe(100);
      });

      it("seeds an existing farm on its next read, which is how the development database migrates", async () => {
        // A farm that predates V13.3: no seed version, no starter rows. The first read gives it the
        // arrangement, once, without anybody deleting a database.
        const farmId = await farmWithGold(100);
        db.sqlite.prepare("UPDATE farms SET starter_world_version = 0 WHERE id = ?").run(farmId);
        expect((await listOf(farmId)).filter((entry) => entry.source === "STARTER").length).toBeGreaterThan(20);
        const after = await listOf(farmId);
        expect(after.filter((entry) => entry.source === "STARTER").length).toBe(
          (await listOf(farmId)).filter((entry) => entry.source === "STARTER").length
        );
      });

      it("gives a version-1 farm only what version 2 added, exactly once", async () => {
        // The V13.3 development farm, reproduced: it already has the authored arrangement and is
        // stamped version 1. The next read must add the promoted island and nothing else - replaying
        // version 1 would collide with rows that are already there, and stamping without inserting
        // would leave the player with a forest that never appears.
        const farmId = await farmWithGold(100);
        db.sqlite.prepare("DELETE FROM farm_constructions WHERE farm_id = ?").run(farmId);
        db.sqlite.prepare("UPDATE farms SET starter_world_version = 1 WHERE id = ?").run(farmId);

        const migrated = await listOf(farmId);
        expect(migrated.filter((entry) => entry.source === "STARTER")).toHaveLength(344);
        // And every one of them is a version-2 object: nothing from version 1 was re-created.
        expect(migrated.every((entry) => entry.placementKey !== null && !entry.placementKey.includes(".west."))).toBe(true);
        // Reading again adds nothing at all.
        expect(await listOf(farmId)).toHaveLength(344);
      });

      it("lets the player move a promoted pine, and the island does not grow it back", async () => {
        // A tree the *generator* grew, not one the layout authored: its anchor is fractional because
        // it stands where it grew. It is an ordinary row, so it moves like one.
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const pine = seeded.find((entry) => entry.entryId === "world.tree_pine" && entry.placementKey?.startsWith("starter.pine."));
        expect(pine).toBeDefined();
        if (pine === undefined) return;
        const home = { x: pine.anchorX, y: pine.anchorY };

        const moved = await post(`/farms/${farmId}/constructions/${pine.constructionId}/move`, {
          requestId: "promoted_move_001",
          anchorX: 4,
          anchorY: 4,
          rotation: 2,
          expectedVersion: pine.version
        });
        expect(moved.status).toBe(200);
        const after = await constructionOf(moved);
        expect(after.anchorX).toBe(4);
        expect(after.anchorY).toBe(4);
        expect(after.rotation).toBe(2);
        expect(goldOf()).toBe(100);

        const reloaded = await listOf(farmId);
        const same = reloaded.filter((entry) => entry.constructionId === pine.constructionId);
        expect(same).toHaveLength(1);
        expect(same[0]?.anchorX).toBe(4);
        // Nothing stands where it grew, and the island still has exactly as many pines as it started
        // with - a generator that re-created it would show a second tree at the old spot.
        expect(reloaded.filter((entry) => entry.anchorX === home.x && entry.anchorY === home.y && entry.entryId === "world.tree_pine")).toHaveLength(0);
        expect(reloaded.filter((entry) => entry.entryId === "world.tree_pine")).toHaveLength(
          seeded.filter((entry) => entry.entryId === "world.tree_pine").length
        );
      });

      it("stores a promoted rock and removes a promoted bush, and neither comes back", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const rock = seeded.find((entry) => entry.entryId === "world.rock" && entry.placementKey?.startsWith("starter.rock."));
        const bush = seeded.find((entry) => entry.entryId === "world.bush" && entry.placementKey?.startsWith("starter.bush."));
        expect(rock).toBeDefined();
        expect(bush).toBeDefined();
        if (rock === undefined || bush === undefined) return;

        const stored = await post(`/farms/${farmId}/constructions/${rock.constructionId}/store`, {
          requestId: "promoted_store_001",
          expectedVersion: rock.version
        });
        expect(stored.status).toBe(200);
        const removed = await post(`/farms/${farmId}/constructions/${bush.constructionId}/remove`, {
          requestId: "promoted_remove_001",
          expectedVersion: bush.version
        });
        expect(removed.status).toBe(200);
        // A promoted object was paid for by nobody, so removing it returns nothing.
        expect(goldOf()).toBe(100);

        const reloaded = await listOf(farmId);
        expect(reloaded.filter((entry) => entry.constructionId === bush.constructionId)).toHaveLength(0);
        const storedRock = reloaded.find((entry) => entry.constructionId === rock.constructionId);
        expect(storedRock?.state).toBe("STORED");
        // One fewer of each on the island, and no replacement grew in the gap.
        expect(reloaded.filter((entry) => entry.entryId === "world.bush" && entry.state === "ACTIVE")).toHaveLength(
          seeded.filter((entry) => entry.entryId === "world.bush").length - 1
        );
        expect(reloaded.filter((entry) => entry.entryId === "world.rock" && entry.state === "ACTIVE")).toHaveLength(
          seeded.filter((entry) => entry.entryId === "world.rock").length - 1
        );
      });

      it("lets the player move an authored building, and it keeps its new ground", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const barn = seeded.find((entry) => entry.entryId === "world.barn");
        expect(barn).toBeDefined();
        if (barn === undefined) return;

        const moved = await post(`/farms/${farmId}/constructions/${barn.constructionId}/move`, {
          requestId: "building_move_001",
          anchorX: 2,
          anchorY: 2,
          rotation: 1,
          expectedVersion: barn.version
        });
        expect(moved.status).toBe(200);
        const after = await constructionOf(moved);
        expect(after.anchorX).toBe(2);
        expect(after.anchorY).toBe(2);
        expect(after.rotation).toBe(1);
        // A move costs nothing, however large the building.
        expect(goldOf()).toBe(100);
        const reloaded = await listOf(farmId);
        expect(reloaded.find((entry) => entry.constructionId === barn.constructionId)?.anchorX).toBe(2);
      });

      it("lets the player move a starter tree, and never puts it back where it started", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const tree = seeded.find((entry) => entry.entryId === "world.tree_broad");
        expect(tree).toBeDefined();
        if (tree === undefined) return;
        expect(tree.source).toBe("STARTER");
        expect(tree.placementKey).toBe("starter.tree.west.01");

        const moved = await post(`/farms/${farmId}/constructions/${tree.constructionId}/move`, {
          requestId: "starter_move_001",
          // Onto the player's own field, which is where a starter tree may be carried to.
          anchorX: 3,
          anchorY: 3,
          rotation: 1,
          expectedVersion: tree.version
        });
        expect(moved.status).toBe(200);
        const after = await constructionOf(moved);
        expect(after.constructionId).toBe(tree.constructionId);
        expect(after.anchorX).toBe(3);
        expect(after.anchorY).toBe(3);
        expect(after.version).toBe(tree.version + 1);
        expect(goldOf()).toBe(100);

        // Reload: *this* tree is at the new cell, and the cell it came from is empty. A generator
        // that re-created it would show a second row at the old place.
        const reloaded = await listOf(farmId);
        const same = reloaded.filter((entry) => entry.constructionId === tree.constructionId);
        expect(same).toHaveLength(1);
        expect(same[0]?.anchorX).toBe(3);
        expect(same[0]?.anchorY).toBe(3);
        expect(reloaded.filter((entry) => entry.anchorX === -4 && entry.anchorY === -1)).toHaveLength(0);
        // And the island still has exactly as many broadleaf trees as the arrangement defines.
        expect(reloaded.filter((entry) => entry.entryId === "world.tree_broad").length).toBe(
          seeded.filter((entry) => entry.entryId === "world.tree_broad").length
        );
      });

      it("stores a starter rock and places it again, for nothing, exactly once", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const rock = seeded.find((entry) => entry.entryId === "world.rock");
        expect(rock).toBeDefined();
        if (rock === undefined) return;

        const storeRequest = { requestId: "starter_store_001", expectedVersion: rock.version };
        const stored = await post(`/farms/${farmId}/constructions/${rock.constructionId}/store`, storeRequest);
        expect(stored.status).toBe(200);
        const storedRow = await constructionOf(stored);
        expect(storedRow.state).toBe("STORED");
        expect(storedRow.storedAt).not.toBeNull();
        expect(goldOf()).toBe(100);

        // It is gone from the world: no other object may be built on the ground it held, and the row
        // itself is out of the active set.
        expect((await listOf(farmId)).filter((entry) => entry.state === "ACTIVE" && entry.constructionId === rock.constructionId)).toHaveLength(0);

        // Storing twice with the same request is the same answer, not two stored rocks.
        const again = await post(`/farms/${farmId}/constructions/${rock.constructionId}/store`, storeRequest);
        expect(again.status).toBe(200);

        const restored = await post(`/farms/${farmId}/constructions/${rock.constructionId}/restore`, {
          requestId: "starter_restore_001",
          anchorX: 5,
          anchorY: 6,
          rotation: 2,
          expectedVersion: storedRow.version
        });
        expect(restored.status).toBe(200);
        const restoredRow = await constructionOf(restored);
        expect(restoredRow.state).toBe("ACTIVE");
        expect(restoredRow.constructionId).toBe(rock.constructionId);
        expect(restoredRow.anchorX).toBe(5);
        expect(restoredRow.anchorY).toBe(6);
        expect(restoredRow.rotation).toBe(2);
        expect(goldOf()).toBe(100);
      });

      it("refuses to place a stored object somewhere it could not stand", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const bush = seeded.find((entry) => entry.entryId === "world.bush");
        expect(bush).toBeDefined();
        if (bush === undefined) return;
        const stored = await constructionOf(
          await post(`/farms/${farmId}/constructions/${bush.constructionId}/store`, {
            requestId: "starter_store_002",
            expectedVersion: bush.version
          })
        );
        const unowned = await post(`/farms/${farmId}/constructions/${bush.constructionId}/restore`, {
          requestId: "starter_restore_002",
          anchorX: 400,
          anchorY: 400,
          rotation: 0,
          expectedVersion: stored.version
        });
        expect(unowned.status).toBe(403);
        expect(await codeOf(unowned)).toBe("CONSTRUCTION_NOT_OWNED");
        // A failed restore leaves it in storage rather than half-placed.
        const row = db.sqlite
          .prepare("SELECT state FROM farm_constructions WHERE id = ?")
          .get(bush.constructionId) as { state: string };
        expect(row.state).toBe("STORED");
      });

      it("removes a free starter object for nothing, and it does not come back", async () => {
        const farmId = await farmWithGold(100);
        const seeded = await listOf(farmId);
        const flowers = seeded.find((entry) => entry.entryId === "world.flowers");
        expect(flowers).toBeDefined();
        if (flowers === undefined) return;

        const removed = await post(`/farms/${farmId}/constructions/${flowers.constructionId}/remove`, {
          requestId: "starter_remove_001",
          expectedVersion: flowers.version
        });
        expect(removed.status).toBe(200);
        const body = RemovedEnvelopeSchema.parse(await removed.json());
        // The P0 invariant: a thing nobody paid for pays nothing back, whatever it is worth.
        expect(body.data.refundAmount).toBe(0);
        expect(goldOf()).toBe(100);
        const refunds = db.sqlite
          .prepare("SELECT COUNT(*) AS total FROM economy_ledger WHERE reason = 'CONSTRUCTION_REFUND'")
          .get() as { total: number };
        expect(refunds.total).toBe(0);

        // Reload: still gone, and the seeding pass does not put it back.
        const reloaded = await listOf(farmId);
        expect(reloaded.filter((entry) => entry.constructionId === flowers.constructionId)).toHaveLength(0);
        expect(reloaded.filter((entry) => entry.entryId === "world.flowers")).toHaveLength(
          seeded.filter((entry) => entry.entryId === "world.flowers").length - 1
        );
      });

      it("keeps two farms' islands apart", async () => {
        db.sqlite
          .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-two', 'Player Two', 'ACTIVE', ?, ?)")
          .run(PLAYER_TWO_ID, NOW, NOW);
        const mine = await farmWithGold(100);
        const myTree = (await listOf(mine)).find((entry) => entry.entryId === "world.tree_broad");
        expect(myTree).toBeDefined();
        if (myTree === undefined) return;

        auth.setActor({ playerId: PLAYER_TWO_ID });
        // A second farm, written directly: the harness mints one farm id, so the second one is made
        // here rather than through the create route.
        const theirFarmId = "farm_22222222-2222-4222-8222-222222222222";
        db.sqlite
          .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at, starter_world_version) VALUES (?, ?, 'Second Farm', ?, ?, 0)")
          .run(theirFarmId, PLAYER_TWO_ID, NOW, NOW);
        db.sqlite
          .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
          .run(theirFarmId, PLAYER_TWO_ID, NOW);
        for (let y = 0; y < 12; y += 1) {
          for (let x = 0; x < 12; x += 1) {
            db.sqlite
              .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, 'SOIL', 'IDLE', 1, ?)")
              .run(theirFarmId, x, y, NOW);
          }
        }
        const theirSeeded = await listOf(theirFarmId);
        // Their island has its own copy, with its own row id, and cannot touch mine.
        expect(theirSeeded.filter((entry) => entry.source === "STARTER").length).toBeGreaterThan(20);
        expect(theirSeeded.map((entry) => entry.constructionId)).not.toContain(myTree.constructionId);
        const trespass = await post(`/farms/${theirFarmId}/constructions/${myTree.constructionId}/remove`, {
          requestId: "starter_cross_001",
          expectedVersion: myTree.version
        });
        expect(trespass.status).toBe(404);
        const stillThere = db.sqlite
          .prepare("SELECT COUNT(*) AS total FROM farm_constructions WHERE id = ? AND state = 'ACTIVE'")
          .get(myTree.constructionId) as { total: number };
        expect(stillThere.total).toBe(1);
      });
    });

    /**
     * The alpha's own acceptance test: two testers, two worlds, no shared authority.
     *
     * V13.6.1 opens staging to a handful of real people, and the risk that matters is not a missing
     * feature - it is one tester's command reaching another tester's farm. Each of the brief's checks
     * is here against the *authenticated* actor: distinct players and farms, a purchase that moves only
     * the buyer's gold, an edit that leaves the other island byte-identical, and a cross-farm request
     * that is refused without leaking whether the thing exists.
     */
    it("gives two testers their own world, and lets neither touch the other's", async () => {
      db.sqlite
        .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Tester Two', 'ACTIVE', ?, ?)")
        .run(PLAYER_TWO_ID, NOW, NOW);
      for (const player of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
        db.sqlite
          .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)")
          .run(player, NOW, NOW);
      }

      // Each tester creates their own farm; the harness mints a fresh id for each.
      const createdA = await handle(
        new Request("https://api.test/farms", {
          method: "POST",
          body: JSON.stringify({ name: "Farm A" }),
          headers: { "content-type": "application/json" }
        })
      );
      expect(createdA.status).toBe(201);
      const farmA = FarmEnvelopeSchema.parse(await createdA.json()).data.farm.id;

      auth.setActor({ playerId: PLAYER_TWO_ID });
      const createdB = await handle(
        new Request("https://api.test/farms", {
          method: "POST",
          body: JSON.stringify({ name: "Farm B" }),
          headers: { "content-type": "application/json" }
        })
      );
      expect(createdB.status).toBe(201);
      const farmB = FarmEnvelopeSchema.parse(await createdB.json()).data.farm.id;
      expect(farmB).not.toBe(farmA);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 2 });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_members WHERE role = 'OWNER'").get()).toEqual({
        count: 2
      });

      // Both islands seed their own starter arrangement, on their own first read.
      auth.setActor({ playerId: PLAYER_ONE_ID });
      const islandA = await handle(new Request(`https://api.test/farms/${farmA}/constructions`));
      expect(islandA.status).toBe(200);
      const rowsA = ConstructionsEnvelopeSchema.parse(await islandA.json()).data.constructions;
      const treeA = rowsA.find((row) => row.constructionId.length > 0);
      expect(rowsA.length).toBeGreaterThan(20);

      auth.setActor({ playerId: PLAYER_TWO_ID });
      const islandB = await handle(new Request(`https://api.test/farms/${farmB}/constructions`));
      const rowsBBefore = ConstructionsEnvelopeSchema.parse(await islandB.json()).data.constructions;
      expect(rowsBBefore.length).toBeGreaterThan(20);
      expect(rowsBBefore.map((row) => row.constructionId)).not.toContain(treeA?.constructionId);

      // Tester A buys seeds: A's gold moves, B's does not, and only A gets a ledger row.
      auth.setActor({ playerId: PLAYER_ONE_ID });
      const bought = await handle(
        new Request("https://api.test/shop/buy", {
          method: "POST",
          body: JSON.stringify({ requestId: "alpha_buy_a_001", shopEntryId: "shop_carrot_seed", quantity: 2 }),
          headers: { "content-type": "application/json" }
        })
      );
      expect(bought.status).toBe(200);
      expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
        balance: 96
      });
      expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_TWO_ID)).toEqual({
        balance: 100
      });
      expect(
        db.sqlite.prepare("SELECT player_id, COUNT(*) AS count FROM economy_ledger GROUP BY player_id").all()
      ).toEqual([{ player_id: PLAYER_ONE_ID, count: 1 }]);

      // Tester A edits their own island: B's rows are untouched, anchor for anchor.
      const own = rowsA.find((row) => row.anchorX !== 0 || row.anchorY !== 0);
      expect(own).toBeDefined();
      if (own === undefined) return;
      const moved = await handle(
        new Request(`https://api.test/farms/${farmA}/constructions/${own.constructionId}/store`, {
          method: "POST",
          body: JSON.stringify({ requestId: "alpha_store_a_001", expectedVersion: 1 }),
          headers: { "content-type": "application/json" }
        })
      );
      // Storing a starter object is free and legal; the point here is that it changed nothing on B.
      expect([200, 409]).toContain(moved.status);

      auth.setActor({ playerId: PLAYER_TWO_ID });
      const islandBAfter = await handle(new Request(`https://api.test/farms/${farmB}/constructions`));
      const rowsBAfter = ConstructionsEnvelopeSchema.parse(await islandBAfter.json()).data.constructions;
      expect(rowsBAfter).toEqual(rowsBBefore);

      // And A cannot reach into B's world at all - by farm id, or by naming B's farm with A's identity.
      auth.setActor({ playerId: PLAYER_ONE_ID });
      const foreignFarm = await handle(new Request(`https://api.test/farms/${farmB}/tiles`));
      expect(foreignFarm.status).toBe(403);
      const foreignObjects = await handle(new Request(`https://api.test/farms/${farmB}/constructions`));
      expect(foreignObjects.status).toBe(403);
      // B's island is still exactly as it was.
      expect(
        db.sqlite
          .prepare("SELECT COUNT(*) AS count FROM farm_constructions WHERE farm_id = ?")
          .get(farmB)
      ).toEqual({ count: rowsBBefore.length });
    });

    it("gives a player one farm, however many times they ask for one", async () => {
      // A phone that loses the response to "create my farm" asks again. It must be given the world it
      // already has - not a second, empty one while its gold and fields sit on the first.
      const ask = (): Promise<Response> =>
        handle(
          new Request("https://api.test/farms", {
            method: "POST",
            body: JSON.stringify({ name: "Starter Farm" }),
            headers: { "content-type": "application/json" }
          })
        );

      const first = await ask();
      expect(first.status).toBe(201);
      const firstFarm = FarmEnvelopeSchema.parse(await first.json()).data.farm.id;

      const second = await ask();
      expect(second.status).toBe(200);
      expect(FarmEnvelopeSchema.parse(await second.json()).data.farm.id).toBe(firstFarm);

      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 1 });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_members WHERE role = 'OWNER'").get()).toEqual({
        count: 1
      });
      // The starter land is seeded once with the farm, not once per request.
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(firstFarm)).toEqual({
        count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE
      });
      // The database itself is the last line of defence, not the use case.
      expect(() =>
        db.sqlite
          .prepare(
            "INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES ('farm_ffffffff-ffff-4fff-8fff-ffffffffffff', ?, 'Second Farm', ?, ?)"
          )
          .run(PLAYER_ONE_ID, NOW, NOW)
      ).toThrow();
    });
  });
});
