import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { ApiClient, ApiError } from "../../apps/web/src/api";
import { createTranslator, errorMessage } from "../../apps/web/src/i18n";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The land quote's runtime contract, end to end.
 *
 * The bug this test exists for: a real browser saw raw `invalid_union path: ["quote","cells",0,
 * "reason"]` in the HUD because the worker it was talking to emitted a reason the web parser did not
 * accept. This drives the *real* Worker handler, hands its response to the *real* web `ApiClient`
 * (the same envelope handling and the same zod parsers the browser uses), and proves three things:
 * every reason the server emits parses, no obsolete reason survives anywhere, and a mismatched
 * response becomes a localised sentence instead of a validation dump.
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
  constructor(private actor: ActorContext | null) {}
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
  private constructionSequence = 1;
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

describe("land quote runtime contract", () => {
  let db: NodeD1Database;
  let worker: (request: Request) => Promise<Response>;
  let client: ApiClient;

  /** Route the web client's `/api/*` fetches into the real Worker handler. */
  function routeToWorker(): void {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(target, "https://api.test");
      const path = url.pathname.replace(/^\/api/, "");
      return worker(new Request(`https://api.test${path}`, init));
    });
  }

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Player One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    worker = createHandler({
      db,
      authenticator: new FixedAuth({ playerId: PLAYER_ONE_ID }),
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
    await worker(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Contract Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 50000, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    // Level 8: 60 * 7 * 8 = 3,360 experience on the shipped curve.
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 8, 3360, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    client = new ApiClient();
    routeToWorker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it("parses a real distant unowned quote through the web client", async () => {
    // (40,40) is ~29 tiles from the starter square and touches none of it.
    const { quote } = await client.quoteLandCells(FARM_ONE_ID, [{ x: 40, y: 40 }]);
    expect(quote.cells).toHaveLength(1);
    expect(quote.cells[0]).toMatchObject({ x: 40, y: 40, eligible: true, reason: "ELIGIBLE" });
    expect(quote.cells[0]?.price).toBeGreaterThan(0);
    expect(quote.totalPrice).toBe(quote.cells[0]?.price);
  });

  it("parses a distant unowned cell inside the plot reservation too", async () => {
    // (30,30) is the exact shape of the bug report: unowned, far from the starter square, and inside
    // the plot catalogue's reservation. The pre-correction worker answered NOT_ADJACENT here, which
    // the new client rejects; the corrected worker answers ELIGIBLE.
    const { quote } = await client.quoteLandCells(FARM_ONE_ID, [{ x: 30, y: 30 }]);
    expect(quote.cells[0]).toMatchObject({ x: 30, y: 30, eligible: true, reason: "ELIGIBLE" });
  });

  it("parses a multi-cell footprint quote, as the build flow sends", async () => {
    const footprint: { x: number; y: number }[] = [];
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 4; dx += 1) footprint.push({ x: 39 + dx, y: 39 + dy });
    }
    const { quote } = await client.quoteLandCells(FARM_ONE_ID, footprint);
    expect(quote.cells).toHaveLength(12);
    expect(quote.cells.every((cell) => cell.eligible)).toBe(true);
    expect(quote.totalPrice).toBe(quote.cells.reduce((total, cell) => total + cell.price, 0));
  });

  it("parses an already-owned cell and a non-developable cell", async () => {
    const owned = await client.quoteLandCells(FARM_ONE_ID, [{ x: 0, y: 0 }]);
    expect(owned.quote.cells[0]).toMatchObject({ eligible: false, reason: "ALREADY_OWNED", price: 0 });

    // The pond: inland water, not developable for a farm.
    const pond = await client.quoteLandCells(FARM_ONE_ID, [{ x: -3, y: 45 }]);
    expect(pond.quote.cells[0]).toMatchObject({ eligible: false, reason: "NOT_DEVELOPABLE" });
  });

  it("parses a level-gated quote as LEVEL_REQUIRED", async () => {
    db.sqlite.prepare("DELETE FROM player_progression WHERE player_id = ?").run(PLAYER_ONE_ID);
    const { quote } = await client.quoteLandCells(FARM_ONE_ID, [{ x: 40, y: 40 }]);
    expect(quote.cells[0]).toMatchObject({ eligible: false, reason: "LEVEL_REQUIRED" });
  });

  it("never emits the obsolete NOT_ADJACENT reason", async () => {
    const response = await worker(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/land/quote`, {
        method: "POST",
        body: JSON.stringify({ cells: [{ x: 40, y: 40 }, { x: 30, y: 30 }, { x: 0, y: 0 }, { x: -3, y: 45 }] }),
        headers: { "content-type": "application/json" }
      })
    );
    const body = await response.text();
    expect(body).not.toContain("NOT_ADJACENT");
  });

  it("turns a mismatched response into a typed error, never a raw validation dump", async () => {
    // A stale worker that still speaks the old contract: exactly the response that produced the
    // `invalid_union path: ["quote","cells",0,"reason"]` the player saw.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              quote: {
                cells: [
                  { x: 40, y: 40, eligible: false, reason: "NOT_ADJACENT", plotIndex: 1, price: 5, currencyId: "currency_gold" }
                ],
                totalPrice: 0,
                currencyId: null
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const failure = await client.quoteLandCells(FARM_ONE_ID, [{ x: 40, y: 40 }]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    const apiError = failure as ApiError;
    expect(apiError.code).toBe("INVALID_RESPONSE");
    expect(apiError.message).not.toContain("invalid_union");
    expect(apiError.message).not.toContain("path");
    expect(apiError.message).not.toContain("NOT_ADJACENT");
    // The technical cause is kept for development tools only.
    expect(apiError.cause).toBeDefined();
  });

  it("localises a contract failure, so no validator text can reach the HUD", () => {
    for (const language of ["en", "vi"] as const) {
      const t = createTranslator(language);
      const message = errorMessage(t, "INVALID_RESPONSE");
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("invalid_union");
      expect(message).not.toBe("INVALID_RESPONSE");
    }
  });
});
