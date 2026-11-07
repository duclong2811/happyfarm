import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevWorker, type DevEnv } from "../../workers/api/src/dev-index";
import { DEV_AUTH_BOOTSTRAP_PATH, type DevAuthBindings } from "../../workers/api/src/dev-auth";
import { NodeD1Database } from "../support/node-d1";
import { schemaSql } from "../support/migrations";
import { GetNeighborResponseSchema } from "@happy-farm/contracts";

const PLAYER = "player_33333333-3333-4333-8333-333333333333";
const TOKEN = "neighbor-test-token";
const bindings: DevAuthBindings = {
  DEV_AUTH_ENABLED: "true", DEV_AUTH_TOKEN: TOKEN, DEV_PLAYER_ID: PLAYER,
  DEV_AUTH_ISSUER: "https://dev.happy-farm.local", DEV_AUTH_SUBJECT: "neighbor-test", DEV_PLAYER_DISPLAY_NAME: "Neighbour Test"
};

function request(path: string, options: { method?: string; body?: unknown } = {}): Request {
  return new Request(`https://neighbor.test${path}`, {
    method: options.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

describe("first neighbour island HTTP/D1 slice", () => {
  let db: NodeD1Database;
  let handle: (request: Request) => Promise<Response>;
  beforeEach(async () => {
    db = new NodeD1Database(schemaSql());
    handle = createDevWorker({ DB: db, ...bindings } satisfies DevEnv);
    expect((await handle(new Request(`https://neighbor.test${DEV_AUTH_BOOTSTRAP_PATH}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(200);
    expect((await handle(request("/farms", { method: "POST", body: { name: "Neighbour Farm" } }))).status).toBe(201);
  });
  afterEach(() => { db.close(); });

  it("persists the island, travels idempotently, and keeps NPC stock separate", async () => {
    const initial = await handle(request("/neighbor"));
    expect(initial.status).toBe(200);
    const envelope = await initial.clone().json();
    const contractBody = GetNeighborResponseSchema.parse((envelope as { readonly data: unknown }).data);
    expect(contractBody.neighbor.visit.currentIslandId).toBeNull();
    expect(contractBody.neighbor.islands).toHaveLength(3);
    const initialBody: { ok: true; data: { neighbor: { visit: { version: number }; island: { islandId: string } } } } = await initial.json();
    expect(initialBody.data.neighbor.island.islandId).toMatch(/^neighbor_island_farm_/);
    const version = initialBody.data.neighbor.visit.version;
    const foreign = await handle(request("/neighbor/travel", { method: "POST", body: { requestId: "neighbor-travel-foreign", expectedVersion: version, destination: "NEIGHBOR_ISLAND", islandId: "neighbor_island_someone_else" } }));
    expect(foreign.status).toBe(403);
    const first = await handle(request("/neighbor/travel", { method: "POST", body: { requestId: "neighbor-travel-1", expectedVersion: version, destination: "NEIGHBOR_ISLAND" } }));
    expect(first.status).toBe(200);
    const firstBody: { data: { neighbor: { visit: { currentPlace: string; currentIslandId: string | null } } } } = await first.json();
    expect(firstBody.data.neighbor.visit.currentPlace).toBe("NEIGHBOR_ISLAND");
    expect(firstBody.data.neighbor.visit.currentIslandId).toBe(initialBody.data.neighbor.island.islandId);
    const afterTravel = await handle(request("/neighbor"));
    expect(afterTravel.status).toBe(200);
    const afterTravelBody: { data: { neighbor: { visit: { currentIslandId: string | null } } } } = await afterTravel.json();
    expect(afterTravelBody.data.neighbor.visit.currentIslandId).toBe(initialBody.data.neighbor.island.islandId);
    const replay = await handle(request("/neighbor/travel", { method: "POST", body: { requestId: "neighbor-travel-1", expectedVersion: version, destination: "NEIGHBOR_ISLAND" } }));
    expect(replay.status).toBe(200);
    const replayBody: { data: { neighbor: { visit: { currentPlace: string } } } } = await replay.json();
    expect(replayBody.data.neighbor.visit.currentPlace).toBe("NEIGHBOR_ISLAND");
    const stale = await handle(request("/neighbor/travel", { method: "POST", body: { requestId: "neighbor-travel-2", expectedVersion: version, destination: "HOME_ISLAND" } }));
    expect(stale.status).toBe(409);
    const receiptCount = db.sqlite.prepare("SELECT COUNT(*) AS count FROM neighbor_travel_receipts").get();
    const woodCount = db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_wood'").get(PLAYER);
    expect(receiptCount?.count).toBe(1);
    expect(woodCount?.count).toBe(0);
  });

  it("reconciles an offline NPC milestone without a player mutation", async () => {
    await handle(request("/neighbor"));
    const beforeGoldRow = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER);
    const beforeGold = typeof beforeGoldRow?.balance === "number" ? beforeGoldRow.balance : undefined;
    db.sqlite.prepare("UPDATE neighbor_npc_states SET ready_at = '2000-01-01T00:00:00.000Z', last_reconciled_at = '2000-01-01T00:00:00.000Z' WHERE npc_id LIKE 'neighbor_npc_%'").run();
    const response = await handle(request("/neighbor"));
    expect(response.status).toBe(200);
    const body: { data: { neighbor: { npc: { phase: string; stockQuantity: number } } } } = await response.json();
    expect(body.data.neighbor.npc.phase).toBe("BUILT");
    expect(body.data.neighbor.npc.stockQuantity).toBe(3);
    const afterGoldRow = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(PLAYER);
    const afterGold = typeof afterGoldRow?.balance === "number" ? afterGoldRow.balance : undefined;
    expect(afterGold).toBe(beforeGold);
  });
});
