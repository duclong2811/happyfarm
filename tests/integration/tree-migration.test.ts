import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  D1TreeHarvestSettlementRepository,
  D1TreeRepository
} from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID, TREE_ONE_ID } from "../support/fixtures";

function readMigration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

/** Everything a database has before the tree migration is applied. */
const BEFORE = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql"
]
  .map(readMigration)
  .join("\n");

const TREES = readMigration("0008_tree_instances.sql");

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare(
    "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)"
  );
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farms (id, name, owner_player_id, created_at, updated_at) VALUES (?, 'Farm', ?, ?, ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  db.sqlite
    .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
    .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  const tile = db.sqlite.prepare(
    "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, 'SOIL', 'IDLE', 1, ?)"
  );
  tile.run(FARM_ONE_ID, 0, 0, NOW);
  tile.run(FARM_ONE_ID, 1, 0, NOW);
  db.sqlite
    .prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 3, 360, 1, ?, ?)")
    .run(PLAYER_ONE_ID, NOW, NOW);
}

function insertCrop(db: NodeD1Database, x: number, id = "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc"): void {
  db.sqlite
    .prepare(
      "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, ?, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
    )
    .run(id, FARM_ONE_ID, x, PLAYER_ONE_ID, NOW, NOW, NOW);
}

function insertTree(db: NodeD1Database, x: number, version = 1, lastHarvestedAt: string | null = null): void {
  db.sqlite
    .prepare(
      "INSERT INTO tree_instances (id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at) VALUES (?, ?, ?, 0, 'tree_apple', ?, ?, ?, ?, ?, ?)"
    )
    .run(TREE_ONE_ID, FARM_ONE_ID, x, PLAYER_ONE_ID, NOW, lastHarvestedAt, version, NOW, NOW);
}

function treeRow(db: NodeD1Database): { version: number; last_harvested_at: string | null } {
  return db.sqlite
    .prepare("SELECT version, last_harvested_at FROM tree_instances WHERE id = ?")
    .get(TREE_ONE_ID) as { version: number; last_harvested_at: string | null };
}

function settlement(
  requestId: string,
  treeVersion: number,
  quantity = 3,
  award: {
    xpBefore?: number;
    expectedProgressionVersion?: number;
    xpAfter?: number;
  } = {}
): Parameters<D1TreeHarvestSettlementRepository["settleTreeHarvestAtomically"]> {
  return [
    {
      id: TREE_ONE_ID,
      farmId: FARM_ONE_ID,
      tileX: 0,
      tileY: 0,
      treeDefinitionId: "tree_apple",
      plantedByPlayerId: PLAYER_ONE_ID,
      plantedAt: NOW,
      lastHarvestedAt: null,
      version: treeVersion,
      createdAt: NOW,
      updatedAt: NOW
    } as never,
    {
      kind: "ADD",
      playerId: PLAYER_ONE_ID,
      itemDefinitionId: "item_apple",
      quantity,
      maxQuantity: 2_147_483_647,
      timestamp: NOW
    } as never,
    {
      playerId: PLAYER_ONE_ID,
      xpBefore: award.xpBefore ?? 360,
      expectedProgressionVersion: award.expectedProgressionVersion ?? 1,
      xpAfter: award.xpAfter ?? 370,
      levelAfter: 3,
      xpAwarded: 10,
      leveledUp: false,
      timestamp: NOW
    },
    {
      actorPlayerId: PLAYER_ONE_ID,
      operation: "HARVEST_TREE",
      requestId,
      payloadFingerprint: "a".repeat(64),
      resourceId: TREE_ONE_ID,
      responseJson: "{}",
      status: "COMPLETED",
      createdAt: NOW
    } as never
  ];
}

describe("tree migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(BEFORE);
    seedPlayers(db);
  });

  afterEach(() => {
    db.close();
  });

  it("adds the tree tables and their guards, leaving existing state alone", () => {
    insertCrop(db, 0);
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_apple_sapling', 4, ?, 1)")
      .run(PLAYER_ONE_ID, NOW);

    db.sqlite.exec(TREES);

    const tables = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%tree%' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(["tree_harvest_settlements", "tree_instances"]);
    const triggers = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE '%tree%' OR name LIKE 'crop_instance_requires%') ORDER BY name")
      .all() as { name: string }[];
    expect(triggers.map((row) => row.name)).toEqual([
      "crop_instance_requires_free_of_tree",
      "idempotency_tree_harvest_requires_settlement",
      "idempotency_tree_plant_requires_tree",
      "tree_harvest_settlement_apply",
      "tree_harvest_settlement_validate",
      "tree_instance_requires_free_of_crop"
    ]);
    // The crop planted before the migration is untouched: 0008 adds beside the crop path.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple_sapling'").get()
    ).toEqual({ quantity: 4 });
  });

  it("refuses a tree and a crop on the same tile, in both directions", () => {
    db.sqlite.exec(TREES);
    insertCrop(db, 0);

    expect(() => { insertTree(db, 0); }).toThrow(/tile already holds a crop/);
    db.sqlite.prepare("DELETE FROM crop_instances WHERE tile_x = 0").run();
    insertTree(db, 0);
    expect(() => { insertCrop(db, 0); }).toThrow(/tile already holds a tree/);
    // A different tile is still free for either occupant.
    expect(() => { insertCrop(db, 1, "cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd"); }).not.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances").get()).toEqual({ count: 1 });
  });

  it("allows exactly one settlement per cycle and the next cycle after it", async () => {
    db.sqlite.exec(TREES);
    insertTree(db, 0);
    const settlements = new D1TreeHarvestSettlementRepository(db);

    await settlements.settleTreeHarvestAtomically(...settlement("request_tree_cycle_a1", 1));
    expect(treeRow(db)).toEqual({ version: 2, last_harvested_at: NOW });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple'").get()
    ).toEqual({ quantity: 3 });
    expect(
      db.sqlite.prepare("SELECT xp, progression_version FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)
    ).toEqual({ xp: 370, progression_version: 2 });

    // A second request for the same cycle cannot pay again: the revision has moved on.
    await expect(
      settlements.settleTreeHarvestAtomically(...settlement("request_tree_cycle_a2", 1))
    ).rejects.toThrow();
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple'").get()
    ).toEqual({ quantity: 3 });

    // The next cycle is a new revision of the same tree, and it pays like the first: the same tree
    // row, the next version, and the progression state the first settlement left behind.
    db.sqlite
      .prepare("UPDATE tree_instances SET last_harvested_at = ? WHERE id = ?")
      .run(NOW, TREE_ONE_ID);
    await settlements.settleTreeHarvestAtomically(
      ...settlement("request_tree_cycle_b1", 2, 3, {
        xpBefore: 370,
        expectedProgressionVersion: 2,
        xpAfter: 380
      })
    );
    expect(treeRow(db)).toEqual({ version: 3, last_harvested_at: NOW });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple'").get()
    ).toEqual({ quantity: 6 });
    expect(
      db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)
    ).toEqual({ xp: 380 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
    ).toEqual({ count: 2 });
  });

  it("rolls a planting back when the sapling it was paid with is not there", async () => {
    db.sqlite.exec(TREES);
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_apple_sapling', 1, ?, 1)")
      .run(PLAYER_ONE_ID, NOW);
    const trees = new D1TreeRepository(db);

    await expect(
      trees.plantAtomically(
        {
          id: TREE_ONE_ID,
          farmId: FARM_ONE_ID,
          tileX: 0,
          tileY: 0,
          treeDefinitionId: "tree_apple",
          plantedByPlayerId: PLAYER_ONE_ID,
          plantedAt: NOW,
          lastHarvestedAt: null,
          version: 1,
          createdAt: NOW,
          updatedAt: NOW
        } as never,
        1,
        {
          kind: "REMOVE",
          playerId: PLAYER_ONE_ID,
          itemDefinitionId: "item_apple_sapling",
          quantity: 1,
          timestamp: NOW
        } as never,
        // The caller read a stack of two; the row says one, so the guard yields NULL and the batch
        // has to abort whole rather than leave a planted tree that was never paid for.
        {
          playerId: PLAYER_ONE_ID,
          itemDefinitionId: "item_apple_sapling",
          quantity: 2,
          version: 1,
          updatedAt: NOW
        } as never,
        {
          actorPlayerId: PLAYER_ONE_ID,
          operation: "PLANT_TREE",
          requestId: "request_tree_rollback_001",
          payloadFingerprint: "b".repeat(64),
          resourceId: TREE_ONE_ID,
          responseJson: "{}",
          status: "COMPLETED",
          createdAt: NOW
        } as never
      )
    ).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
    expect(
      db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE item_definition_id = 'item_apple_sapling'").get()
    ).toEqual({ quantity: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()
    ).toEqual({ count: 0 });
  });

  it("rolls a harvest back when the progression award lost its race", async () => {
    db.sqlite.exec(TREES);
    insertTree(db, 0);
    const settlements = new D1TreeHarvestSettlementRepository(db);
    const [tree, addition, award, record] = settlement("request_tree_rollback_harvest", 1);

    await expect(
      settlements.settleTreeHarvestAtomically(
        tree,
        addition,
        { ...(award as object), expectedProgressionVersion: 9 } as never,
        record
      )
    ).rejects.toThrow();
    expect(treeRow(db)).toEqual({ version: 1, last_harvested_at: null });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
    ).toEqual({ count: 0 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE item_definition_id = 'item_apple'").get()
    ).toEqual({ count: 0 });
  });

  it("removes a tree with no reward at all", async () => {
    db.sqlite.exec(TREES);
    insertTree(db, 0);
    const trees = new D1TreeRepository(db);

    await trees.removeAtomically(
      {
        id: TREE_ONE_ID,
        farmId: FARM_ONE_ID,
        tileX: 0,
        tileY: 0,
        treeDefinitionId: "tree_apple",
        plantedByPlayerId: PLAYER_ONE_ID,
        plantedAt: NOW,
        lastHarvestedAt: null,
        version: 1,
        createdAt: NOW,
        updatedAt: NOW
      } as never,
      1,
      {
        actorPlayerId: PLAYER_ONE_ID,
        operation: "REMOVE_TREE",
        requestId: "request_tree_remove_001",
        payloadFingerprint: "c".repeat(64),
        resourceId: TREE_ONE_ID,
        responseJson: "{}",
        status: "COMPLETED",
        createdAt: NOW
      } as never
    );

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get()).toEqual({ count: 0 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE operation = 'REMOVE_TREE'").get()
    ).toEqual({ count: 1 });
  });
});
