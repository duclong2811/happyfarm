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
import { DEFAULT_PLAYER_CHARACTER_ID, PLAYER_CHARACTERS } from "@happy-farm/game-data";
import { GetPlayerAppearanceResponseSchema } from "@happy-farm/contracts";
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
import { schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * Player appearance: the character a player chose.
 *
 * Holds the rules: identity comes from the verified actor, only a catalogue character may be chosen,
 * one player's choice never touches another's, and a player who never chose appears as the default.
 */

const MIGRATIONS = schemaSql();

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

class SwitchableAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}


describe("player appearance", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let handle: (request: Request) => Promise<Response>;

  function request(path: string, body?: unknown): Request {
    return new Request(`https://dev.happy-farm.local${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  async function appearance(response: Response) {
    const body: unknown = await response.json();
    return GetPlayerAppearanceResponseSchema.parse((body as { readonly data: unknown }).data).appearance;
  }

  async function codeOf(response: Response): Promise<unknown> {
    const body: unknown = await response.json();
    return (body as { readonly error?: { readonly code?: unknown } }).error?.code;
  }

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Player', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }
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
      landSale: gameDataLandSale,
      clock: new FixedClock()
    });
  });

  afterEach(() => {
    db.close();
  });

  it("starts every player as the default character, not yet chosen", async () => {
    expect(await appearance(await handle(request("/players/me/appearance")))).toEqual({
      characterId: DEFAULT_PLAYER_CHARACTER_ID,
      chosen: false,
      version: 0
    });
  });

  it("saves a catalogue character for the caller only, and bumps the version", async () => {
    const first = await appearance(await handle(request("/players/me/appearance", { characterId: "character.kenney_female_c" })));
    expect(first).toEqual({ characterId: "character.kenney_female_c", chosen: true, version: 1 });
    const second = await appearance(await handle(request("/players/me/appearance", { characterId: "character.kenney_robot" })));
    expect(second.version).toBe(2);
    expect((await appearance(await handle(request("/players/me/appearance")))).characterId).toBe("character.kenney_robot");

    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await appearance(await handle(request("/players/me/appearance")))).characterId).toBe(DEFAULT_PLAYER_CHARACTER_ID);
  });

  it("offers every catalogue character", async () => {
    for (const character of PLAYER_CHARACTERS) {
      const response = await handle(request("/players/me/appearance", { characterId: character.id }));
      expect(response.status).toBe(200);
    }
  });

  it("refuses ids outside the catalogue and malformed requests, writing nothing", async () => {
    const unknown = await handle(request("/players/me/appearance", { characterId: "character.kenney_zombie" }));
    expect(unknown.status).toBe(403);
    expect(await codeOf(unknown)).toBe("CHARACTER_NOT_AVAILABLE");
    for (const body of [
      { characterId: "../../player-farmer.glb" },
      { characterId: "character.x", playerId: PLAYER_TWO_ID },
      { characterId: 7 },
      {}
    ]) {
      expect((await handle(request("/players/me/appearance", body))).status).toBe(400);
    }
    expect((db.sqlite.prepare("SELECT COUNT(*) AS count FROM player_appearance").get() as { count: number }).count).toBe(0);
  });

  it("requires a verified player", async () => {
    auth.setActor(null);
    expect((await handle(request("/players/me/appearance"))).status).toBe(401);
    expect((await handle(request("/players/me/appearance", { characterId: "character.kenney_female_a" }))).status).toBe(401);
  });
});
