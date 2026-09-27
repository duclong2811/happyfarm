import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import { parseCropInstanceId, type CropInstanceId, type FarmId } from "@happy-farm/domain";
import { createHandler } from "../../workers/api/src/handler";
import { GameDataCropDefinitions, GameDataItemDefinitions, Sha256Fingerprint } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

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
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
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

  it("plants and reads server-derived crop state without accepting client time", async () => {
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    db.sqlite
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'SOIL', 'IDLE', 1, ?)"
      )
      .run(FARM_ONE_ID, NOW);

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
    db.sqlite
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'SOIL', 'IDLE', 1, ?)"
      )
      .run(FARM_ONE_ID, NOW);
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
    db.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'SOIL', 'IDLE', 1, ?)").run(FARM_ONE_ID, NOW);
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
});
