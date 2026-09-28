import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import { GetFarmTilesResponseSchema, GetShopResponseSchema, GetWalletResponseSchema } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE, parseCropInstanceId, parseEconomyTransactionId, type CropInstanceId, type EconomyTransactionId, type FarmId } from "@happy-farm/domain";
import { shops } from "@happy-farm/game-data";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataCropDefinitions, GameDataCurrencyDefinitions, GameDataItemDefinitions, GameDataShopEntries, Sha256Fingerprint, gameDataProgressionDefinition } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql", "0005_player_progression.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const ShopEnvelopeSchema = z.object({ ok: z.literal(true), data: GetShopResponseSchema }).strict();
const WalletEnvelopeSchema = z.object({ ok: z.literal(true), data: GetWalletResponseSchema }).strict();
const TilesEnvelopeSchema = z.object({ ok: z.literal(true), data: GetFarmTilesResponseSchema }).strict();

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
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.economySequence++).padStart(12, "0")}`);
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
      progressionDefinition: gameDataProgressionDefinition,
      clock: new FixedClock()
    });
  });

  afterEach(() => {
    db.close();
  });

  it("serves health without authentication", async () => {
    auth.setActor(null);
    const response = await handle(new Request("https://api.test/health"));
    expect(response.status).toBe(200);
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
    const conflict = await post("crop_wheat");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
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
    expect(await response.json()).toEqual({ ok: true, data: { items: [{ itemDefinitionId: "item_carrot", quantity: 2 }] } });
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

    // A player who has never earned experience reads as level 1, and reading stores nothing.
    expect(await (await handle(new Request("https://api.test/progression"))).json()).toEqual({
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

    // Reading afterwards agrees with the award the harvest already reported.
    expect(await (await handle(new Request("https://api.test/progression"))).json()).toEqual({
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
    const valid = { requestId: "shop_api_001", shopEntryId: "shop_carrot", quantity: 2 };
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
      itemDefinitionId: "item_carrot", quantity: 2, currencyId: "currency_gold", amountSpent: 8, newBalance: 92
    } } });
    const sold = await post("/shop/sell", { requestId: "shop_api_002", shopEntryId: "shop_carrot", quantity: 1 });
    expect(sold.status).toBe(200);
    expect(await sold.json()).toMatchObject({ ok: true, data: { settlement: { amountReceived: 2, newBalance: 94 } } });
    auth.setActor(null);
    expect((await post("/shop/buy", { ...valid, requestId: "shop_api_003" })).status).toBe(401);
  });

  it("treats a per-entry quantity bound violation as a client error, not an internal error", async () => {
    db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 100, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
    const response = await handle(new Request("https://api.test/shop/buy", {
      method: "POST",
      body: JSON.stringify({ requestId: "shop_bound_001", shopEntryId: "shop_carrot", quantity: 1_001 }),
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

    const sharedRequest = { requestId: "shared_economy_request", shopEntryId: "shop_carrot", quantity: 2 };
    const authored = await post("/shop/buy", sharedRequest);
    expect(authored.status).toBe(200);
    expect(await authored.json()).toMatchObject({ ok: true, data: { settlement: { newBalance: 92 } } });

    auth.setActor({ playerId: PLAYER_TWO_ID });
    const replayed = await post("/shop/buy", { ...sharedRequest, quantity: 1 });
    expect(await replayed.json()).toMatchObject({ ok: true, data: { settlement: { newBalance: 3 } } });

    auth.setActor({ playerId: PLAYER_ONE_ID });
    const crossPlayerSale = await post("/shop/sell", { requestId: "cross_player_sell_001", shopEntryId: "shop_carrot", quantity: 5 });
    expect(crossPlayerSale.status).toBe(409);
    expect(await crossPlayerSale.json()).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_ITEMS" } });

    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 92 });
    expect(db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER_TWO_ID)).toEqual({ balance: 3 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_ONE_ID)).toEqual({ quantity: 2 });
    expect(db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot'").get(PLAYER_TWO_ID)).toEqual({ quantity: 6 });
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
    const sharedRequestId = "shared_operation_request";
    const planted = await handle(new Request(`https://api.test/farms/${FARM_ONE_ID}/crops`, {
      method: "POST",
      body: JSON.stringify({ requestId: sharedRequestId, cropDefinitionId: "crop_carrot", x: 0, y: 0, expectedTileVersion: 1 }),
      headers: { "content-type": "application/json" }
    }));
    expect(planted.status).toBe(201);

    const bought = await handle(new Request("https://api.test/shop/buy", {
      method: "POST",
      body: JSON.stringify({ requestId: sharedRequestId, shopEntryId: "shop_carrot", quantity: 1 }),
      headers: { "content-type": "application/json" }
    }));
    expect(bought.status).toBe(200);
    expect(await bought.json()).toMatchObject({ ok: true, data: { settlement: { amountSpent: 4, newBalance: 96 } } });
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
          currencyId: entry.currencyDefinitionId,
          buyPrice: entry.buyPrice,
          sellPrice: entry.sellPrice,
          maxQuantityPerRequest: entry.maxQuantityPerRequest
        }))
      }
    });
    expect(body.data.entries).toHaveLength(shops.length);
    expect(body.data.entries).toContainEqual({
      shopEntryId: "shop_carrot",
      itemDefinitionId: "item_carrot",
      currencyId: "currency_gold",
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 1_000
    });
    for (const entry of body.data.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "buyPrice", "currencyId", "itemDefinitionId", "maxQuantityPerRequest", "sellPrice", "shopEntryId"
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
    expect(body).toEqual({ ok: true, data: { wallets: [{ currencyId: "currency_gold", balance: 100 }] } });

    for (const injected of [
      `https://api.test/wallet?playerId=${PLAYER_TWO_ID}`,
      "https://api.test/wallet?userId=2",
      "https://api.test/wallet?walletOwner=other"
    ]) {
      const response = await handle(new Request(injected, { headers: { "x-player-id": PLAYER_TWO_ID } }));
      expect(await response.json(), injected).toEqual({
        ok: true,
        data: { wallets: [{ currencyId: "currency_gold", balance: 100 }] }
      });
    }

    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", balance: 7 }] }
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
    expect(catalog.data.entries).toContainEqual(expect.objectContaining({ shopEntryId: "shop_carrot", buyPrice: 4 }));
    expect((await post("/shop/buy", { requestId: "wallet_read_buy_injected", shopEntryId: "shop_carrot", quantity: 2, buyPrice: 1 })).status).toBe(400);

    expect(await (await post("/shop/buy", { requestId: "wallet_read_buy_001", shopEntryId: "shop_carrot", quantity: 2 })).json())
      .toMatchObject({ data: { settlement: { amountSpent: 8, newBalance: 92 } } });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", balance: 92 }] }
    });

    expect(await (await post("/shop/sell", { requestId: "wallet_read_sell_001", shopEntryId: "shop_carrot", quantity: 1 })).json())
      .toMatchObject({ data: { settlement: { amountReceived: 2, newBalance: 94 } } });
    expect(await (await handle(new Request("https://api.test/wallet"))).json()).toEqual({
      ok: true,
      data: { wallets: [{ currencyId: "currency_gold", balance: 94 }] }
    });
  });
});
