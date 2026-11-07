import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort } from "@happy-farm/application";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../../workers/api/src/d1-types";
import { createHandler } from "../../workers/api/src/handler";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataFishingCatalogue,
  GameDataResourceCatalogue,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain,
  gameDataLandSale
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The static catalogues must not cost a single farm row.
 *
 * V14.3.2 found the staging database read 5.83M rows in a day, almost all of it polls re-reading
 * farm lists. The catalogue endpoints (shop, crop and tree definitions, the build catalogue, the
 * world objects) are pure projections of game data - they are what a client refreshes when it *does*
 * need them - so this pins that they read no player or farm table at all. A future "just look it up
 * in the database" refactor fails here instead of in the next quota alert.
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

/** A D1 that remembers every statement it was asked to prepare. */
class RecordingDatabase implements D1DatabaseLike {
  readonly statements: string[] = [];
  constructor(private readonly inner: NodeD1Database) {}
  prepare(query: string): D1PreparedStatementLike {
    this.statements.push(query);
    return this.inner.prepare(query);
  }
  batch(statements: readonly D1PreparedStatementLike[]) {
    return this.inner.batch(statements);
  }
}

class FixedAuth implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve({ playerId: PLAYER_ONE_ID });
  }
}

describe("static catalogue reads", () => {
  let inner: NodeD1Database;
  let db: RecordingDatabase;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(() => {
    inner = new NodeD1Database(MIGRATIONS);
    db = new RecordingDatabase(inner);
    handle = createHandler({
      db,
      authenticator: new FixedAuth(),
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
      fishing: {
        catalogue: new GameDataFishingCatalogue(),
        ids: {
          newFishingActionId: () => {
            throw new Error("not used");
          }
        },
        random: {
          roll: () => 0
        }
      },
      resources: {
        catalogue: new GameDataResourceCatalogue(),
        ids: {
          newResourceActionId: () => {
            throw new Error("not used");
          }
        },
        random: {
          roll: () => 0
        }
      },
      clock: { now: () => NOW },
      ids: {
        newFarmId: () => {
          throw new Error("not used");
        },
        newCropInstanceId: () => {
          throw new Error("not used");
        },
        newTreeInstanceId: () => {
          throw new Error("not used");
        },
        newEconomyTransactionId: () => {
          throw new Error("not used");
        },
        newConstructionId: () => {
          throw new Error("not used");
        }
      }
    });
  });

  afterEach(() => {
    inner.close();
  });

  it("serves the shop, catalogues, and world objects without reading a farm row", async () => {
    for (const path of [
      "/shop",
      "/crop-definitions",
      "/tree-definitions",
      "/fishing",
      "/build-catalog",
      "/world-objects"
    ]) {
      const response = await handle(new Request(`https://api.test${path}`));
      expect(response.status, path).toBe(200);
    }
    for (const statement of db.statements) {
      expect(statement, `catalogue read touches no player state: ${statement}`).toMatch(
        /^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i
      );
      expect(statement).not.toMatch(
        /farm_tiles|crop_instances|tree_instances|farm_constructions|inventory_items|wallets|economy_ledger|player_progression|player_identities|starter_grants|farm_members|\bfarms\b|\bplayers\b/i
      );
    }
  });

  it("reads a resource node's availability with bounded, zone-scoped statements only", async () => {
    // Unlike the static catalogues, a node's availability is mutable state, so this one legitimately
    // touches the database. What it must not do is read the world: the statements are the actor's own
    // farm (to resolve the home-island zone) and the states of that zone's nodes, in that order.
    const response = await handle(new Request("https://api.test/resource-nodes"));
    expect(response.status).toBe(200);
    expect(db.statements.length).toBeGreaterThan(0);
    for (const statement of db.statements) {
      expect(statement, `bounded node read: ${statement}`).toMatch(
        /FROM farms WHERE owner_player_id = \?|FROM resource_node_states WHERE zone_id = \?/
      );
    }
    // Nothing here scans the island, the inventory, the wallet or the ledger.
    expect(
      db.statements.some((statement) =>
        /farm_tiles|crop_instances|tree_instances|farm_constructions|inventory_items|wallets|economy_ledger/i.test(
          statement
        )
      )
    ).toBe(false);
  });
});
