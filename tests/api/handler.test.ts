import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import type { FarmId } from "@happy-farm/domain";
import { createHandler } from "../../workers/api/src/handler";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migrationPath = fileURLToPath(
  new URL("../../database/migrations/0001_phase_1_foundation.sql", import.meta.url)
);
const migration = readFileSync(migrationPath, "utf8");

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
    handle = createHandler({ db, authenticator: auth, ids: new FixedIds(), clock: new FixedClock() });
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
});
