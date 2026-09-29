import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GrantStarterSeed, InventoryService, type Clock } from "@happy-farm/application";
import { STARTER_SEED_QUANTITY, starterSeedGrant } from "@happy-farm/game-data";
import { D1StarterSeedGrantRepository } from "../../workers/api/src/d1-repositories";
import { GameDataItemDefinitions } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0007_seed_economy.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const clock: Clock = { now: () => NOW };

function seedPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

describe("the one-time starter seed grant", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    seedPlayer(db, PLAYER_ONE_ID, "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "subject-two");
  });

  afterEach(() => {
    db.close();
  });

  function service(): GrantStarterSeed {
    return new GrantStarterSeed(
      new D1StarterSeedGrantRepository(db),
      new InventoryService(new GameDataItemDefinitions(), clock),
      starterSeedGrant
    );
  }

  function quantity(player = PLAYER_ONE_ID): unknown {
    return db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(player, starterSeedGrant.itemDefinitionId);
  }

  it("gives a new player exactly 36 carrot seeds, and says so", async () => {
    await expect(service().execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
      itemDefinitionId: "item_carrot_seed",
      quantity: 36,
      granted: true
    });
    expect(quantity()).toEqual({ quantity: STARTER_SEED_QUANTITY });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 1 });
  });

  it("grants nothing more on a repeated call, an extra farm, or a replayed bootstrap", async () => {
    const grant = service();
    await grant.execute({ playerId: PLAYER_ONE_ID });
    // Every later onboarding pass -- a refresh, a second farm, a replayed request -- reports that
    // nothing was granted and leaves the stack where it was.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(grant.execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
        itemDefinitionId: "item_carrot_seed",
        quantity: 36,
        granted: false
      });
    }
    expect(quantity()).toEqual({ quantity: 36 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT version FROM inventory_items WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      version: 1
    });
  });

  it("keeps 36 seeds when concurrent bootstraps race", async () => {
    const grant = service();
    const results = await Promise.all([
      grant.execute({ playerId: PLAYER_ONE_ID }),
      grant.execute({ playerId: PLAYER_ONE_ID }),
      grant.execute({ playerId: PLAYER_ONE_ID })
    ]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
    expect(quantity()).toEqual({ quantity: 36 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 1 });
  });

  it("scopes the grant to the player, not to the farm or the session", async () => {
    await service().execute({ playerId: PLAYER_ONE_ID });
    await service().execute({ playerId: PLAYER_TWO_ID });
    expect(quantity()).toEqual({ quantity: 36 });
    expect(quantity(PLAYER_TWO_ID)).toEqual({ quantity: 36 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 2 });
  });

  it("requires an authenticated actor", async () => {
    await expect(service().execute(null)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get()).toEqual({ count: 0 });
  });
});
