import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HarvestTree,
  InventoryService,
  PlantTree,
  PlantCrop,
  RemoveTree,
  type Clock,
  type TreeIdGenerator
} from "@happy-farm/application";
import {
  cumulativeXpForLevel,
  createFarmTile,
  createOwnedFarm,
  parseFarmId,
  type TreeInstanceId,
  type UnlockedLandPolicy
} from "@happy-farm/domain";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1IdempotencyRepository,
  D1InventoryRepository,
  D1ProgressionRepository,
  D1TreeHarvestSettlementRepository,
  D1TreeRepository
} from "../../workers/api/src/d1-repositories";
import {
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataProgressionDefinition
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import {
  FARM_ONE_ID,
  FARM_TWO_ID,
  NOW,
  PLAYER_ONE_ID,
  PLAYER_TWO_ID,
  TREE_ONE_ID,
  TREE_TWO_ID
} from "../support/fixtures";

const migration = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

/** The apple tree's game-data numbers, restated here so the expectations are readable. */
const FIRST_READY_SECONDS = 3600;
const APPLE_YIELD = 3;
const APPLE_XP = 10;
const SAPLING = "item_apple_sapling";
const APPLE = "item_apple";
/** Experience the level-3 fixture starts from, so the award assertions read as deltas on it. */
const START_XP = cumulativeXpForLevel(gameDataProgressionDefinition, 3);

const clock: Clock = { now: () => NOW };

class SequenceTreeIds implements TreeIdGenerator {
  private next = 0;
  constructor(private readonly ids: readonly TreeInstanceId[] = [TREE_ONE_ID, TREE_TWO_ID]) {}
  newTreeInstanceId(): TreeInstanceId {
    const id = this.ids[this.next];
    if (id === undefined) throw new Error("No tree ID fixture remains");
    this.next += 1;
    return id;
  }
}

class ConfiguredUnlockedLand implements UnlockedLandPolicy {
  constructor(private readonly unlocked: boolean) {}
  isUnlocked(): Promise<boolean> {
    return Promise.resolve(this.unlocked);
  }
}

function seedPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

function give(db: NodeD1Database, itemDefinitionId: string, quantity: number, player = PLAYER_ONE_ID): void {
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)"
    )
    .run(player, itemDefinitionId, quantity, NOW);
}

function setItem(db: NodeD1Database, itemDefinitionId: string, quantity: number, player = PLAYER_ONE_ID): void {
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1"
    )
    .run(player, itemDefinitionId, quantity, NOW);
}

function itemQuantity(db: NodeD1Database, itemDefinitionId: string, player = PLAYER_ONE_ID): unknown {
  return db.sqlite
    .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
    .get(player, itemDefinitionId);
}

/** Puts a player at an exact level by writing the experience that level means. */
function setLevel(db: NodeD1Database, level: number, player = PLAYER_ONE_ID): void {
  db.sqlite.prepare("DELETE FROM player_progression WHERE player_id = ?").run(player);
  db.sqlite
    .prepare(
      "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
    )
    .run(player, level, cumulativeXpForLevel(gameDataProgressionDefinition, level), NOW, NOW);
}

/** A time comfortably past the first cycle, so the tree is ready whatever the fixture clock says. */
const LONG_AGO = "2026-01-01T00:00:00.000Z";

describe("tree use cases", () => {
  let db: NodeD1Database;
  let farms: D1FarmRepository;
  let members: D1FarmMemberRepository;
  let tiles: D1FarmTileRepository;
  let trees: D1TreeRepository;
  let crops: D1CropRepository;
  let inventory: D1InventoryRepository;
  let progressions: D1ProgressionRepository;
  let idempotency: D1IdempotencyRepository;

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    seedPlayer(db, PLAYER_ONE_ID, "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "subject-two");
    farms = new D1FarmRepository(db);
    members = new D1FarmMemberRepository(db);
    tiles = new D1FarmTileRepository(db);
    trees = new D1TreeRepository(db);
    crops = new D1CropRepository(db);
    inventory = new D1InventoryRepository(db);
    progressions = new D1ProgressionRepository(db);
    idempotency = new D1IdempotencyRepository(db);
    const farm = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Farm One", NOW);
    await farms.createWithOwner(farm.farm, farm.ownerMembership, []);
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "SOIL", NOW));
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 1, y: 0 }, "SOIL", NOW));
    await tiles.insert(createFarmTile(FARM_ONE_ID, { x: 0, y: 1 }, "GRASS", NOW));
    // The apple tree unlocks at level 3, which is the level these cases plant at unless they say
    // otherwise; the level gate has its own case below.
    setLevel(db, 3);
  });

  afterEach(() => {
    db.close();
  });

  function plantTree(unlocked = true, ids = new SequenceTreeIds()): PlantTree {
    return new PlantTree({
      farms,
      members,
      tiles,
      trees,
      crops,
      inventory,
      idempotency,
      definitions: new GameDataTreeDefinitions(),
      progression: progressions,
      progressionDefinition: gameDataProgressionDefinition,
      unlockedLand: new ConfiguredUnlockedLand(unlocked),
      inventoryService: new InventoryService(new GameDataItemDefinitions(), clock),
      ids,
      fingerprints: new Sha256Fingerprint(),
      clock
    });
  }

  function harvestTree(): HarvestTree {
    return new HarvestTree(
      farms,
      members,
      trees,
      inventory,
      idempotency,
      new D1TreeHarvestSettlementRepository(db),
      new GameDataTreeDefinitions(),
      new InventoryService(new GameDataItemDefinitions(), clock),
      progressions,
      gameDataProgressionDefinition,
      new Sha256Fingerprint(),
      clock
    );
  }

  function removeTree(): RemoveTree {
    return new RemoveTree(farms, members, trees, idempotency, new Sha256Fingerprint(), clock);
  }

  const plantCommand = {
    requestId: "request_plant_tree_001",
    treeDefinitionId: "tree_apple",
    x: 0,
    y: 0,
    expectedTileVersion: 1
  };

  const actor = { playerId: PLAYER_ONE_ID };

  describe("PlantTree", () => {
    it("spends exactly one sapling and plants a growing tree", async () => {
      give(db, SAPLING, 3);

      const state = await plantTree().execute(actor, FARM_ONE_ID, plantCommand);

      expect(state.definitionId).toBe("tree_apple");
      expect(state.phase).toBe("GROWING");
      expect(state.ready).toBe(false);
      expect(state.lastHarvestedAt).toBeNull();
      expect(state.version).toBe(1);
      expect(state.secondsUntilReady).toBe(FIRST_READY_SECONDS);
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 2 });
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances WHERE farm_id = ?").get(FARM_ONE_ID)
      ).toEqual({ count: 1 });
      expect(
        db.sqlite
          .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE operation = 'PLANT_TREE'")
          .get()
      ).toEqual({ count: 1 });
    });

    it("returns the same tree for the same request and never spends a second sapling", async () => {
      give(db, SAPLING, 2);
      const useCase = plantTree(true, new SequenceTreeIds([TREE_ONE_ID, TREE_TWO_ID]));

      const first = await useCase.execute(actor, FARM_ONE_ID, plantCommand);
      const replay = await useCase.execute(actor, FARM_ONE_ID, plantCommand);

      expect(replay.treeInstanceId).toBe(first.treeInstanceId);
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 1 });
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()
      ).toEqual({ count: 1 });
    });

    it("refuses a replayed request id with a different payload", async () => {
      give(db, SAPLING, 2);
      const useCase = plantTree();
      await useCase.execute(actor, FARM_ONE_ID, plantCommand);

      await expect(
        useCase.execute(actor, FARM_ONE_ID, { ...plantCommand, y: 1, expectedTileVersion: 1 })
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    });

    it("refuses to plant without a sapling and writes nothing", async () => {
      await expect(plantTree().execute(actor, FARM_ONE_ID, plantCommand)).rejects.toMatchObject({
        code: "INSUFFICIENT_ITEMS"
      });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get()).toEqual({ count: 0 });
    });

    it("refuses a tree above the player's level without spending the sapling", async () => {
      give(db, SAPLING, 3);
      setLevel(db, 1);

      await expect(plantTree().execute(actor, FARM_ONE_ID, plantCommand)).rejects.toMatchObject({
        code: "TREE_LEVEL_REQUIRED"
      });
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 3 });
    });

    it("refuses an occupied tile, whichever occupant holds it", async () => {
      give(db, SAPLING, 3);
      db.sqlite
        .prepare(
          "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 0, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
        )
        .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW, NOW);

      await expect(plantTree().execute(actor, FARM_ONE_ID, plantCommand)).rejects.toMatchObject({
        code: "TILE_OCCUPIED"
      });
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 3 });
    });

    it("refuses a tile outside owned land, a non-soil tile, and a stale revision", async () => {
      give(db, SAPLING, 3);
      const outside = plantTree();
      await expect(outside.execute(actor, FARM_ONE_ID, { ...plantCommand, x: 50 })).rejects.toMatchObject({
        code: "RESOURCE_NOT_FOUND"
      });
      await expect(
        plantTree().execute(actor, FARM_ONE_ID, { ...plantCommand, x: 0, y: 1 })
      ).rejects.toMatchObject({ code: "TILE_NOT_PLANTABLE" });
      await expect(
        plantTree().execute(actor, FARM_ONE_ID, { ...plantCommand, expectedTileVersion: 9 })
      ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
      await expect(
        plantTree(false).execute(actor, FARM_ONE_ID, plantCommand)
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 3 });
    });

    it("refuses a non-owner, an unknown farm, and an unknown definition", async () => {
      give(db, SAPLING, 3);
      const otherFarm = createOwnedFarm(FARM_TWO_ID, PLAYER_TWO_ID, "Farm Two", NOW);
      await farms.createWithOwner(otherFarm.farm, otherFarm.ownerMembership, []);
      const useCase = plantTree();

      await expect(useCase.execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, plantCommand)).rejects.toMatchObject({
        code: "NOT_AUTHORIZED"
      });
      await expect(
        useCase.execute(actor, FARM_TWO_ID, { ...plantCommand, x: 0, y: 0 })
      ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
      await expect(
        useCase.execute(actor, parseFarmId("farm_cccccccc-cccc-4ccc-8ccc-cccccccccccc"), plantCommand)
      ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
      await expect(
        useCase.execute(actor, FARM_ONE_ID, { ...plantCommand, treeDefinitionId: "tree_pear" })
      ).rejects.toMatchObject({ code: "TREE_DEFINITION_NOT_FOUND" });
      await expect(useCase.execute(null, FARM_ONE_ID, plantCommand)).rejects.toMatchObject({
        code: "NOT_AUTHENTICATED"
      });
    });

    it("fails closed at the database when a crop already holds the tile", async () => {
      give(db, SAPLING, 3);
      // Bypass the application's own checks: the settlement is what has to refuse this, and the
      // whole batch has to roll back so the sapling survives.
      db.sqlite
        .prepare(
          "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES ('cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd', ?, 0, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
        )
        .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW, NOW);

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
            itemDefinitionId: SAPLING,
            quantity: 1,
            timestamp: NOW
          } as never,
          { playerId: PLAYER_ONE_ID, itemDefinitionId: SAPLING, quantity: 3, version: 1, updatedAt: NOW } as never,
          {
            actorPlayerId: PLAYER_ONE_ID,
            operation: "PLANT_TREE",
            requestId: "request_direct_plant_001",
            payloadFingerprint: "a".repeat(64),
            resourceId: TREE_ONE_ID,
            responseJson: "{}",
            status: "COMPLETED",
            createdAt: NOW
          } as never
        )
      ).rejects.toThrow(/tile already holds a crop/);
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 3 });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
    });
  });

  describe("HarvestTree", () => {
    async function plantedTree(plantedAt = NOW): Promise<string> {
      give(db, SAPLING, 5);
      const state = await plantTree().execute(actor, FARM_ONE_ID, plantCommand);
      db.sqlite.prepare("UPDATE tree_instances SET planted_at = ? WHERE id = ?").run(plantedAt, state.treeInstanceId);
      return state.treeInstanceId;
    }

    it("awards fruit and experience, keeps the tree, and starts the regrow cycle", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);

      const result = await harvestTree().execute(actor, FARM_ONE_ID, {
        treeInstanceId,
        expectedTreeVersion: 1,
        requestId: "request_harvest_tree_001"
      });

      expect(result.harvest).toEqual({
        treeInstanceId,
        itemDefinitionId: APPLE,
        quantityAdded: APPLE_YIELD
      });
      expect(result.progression.xpAwarded).toBe(APPLE_XP);
      expect(itemQuantity(db, APPLE)).toEqual({ quantity: APPLE_YIELD });
      const row = db.sqlite
        .prepare("SELECT last_harvested_at, version FROM tree_instances WHERE id = ?")
        .get(treeInstanceId) as { last_harvested_at: string; version: number };
      expect(row.version).toBe(2);
      expect(row.last_harvested_at).toBe(NOW);
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
      ).toEqual({ count: 1 });
      expect(
        db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)
      ).toEqual({ xp: START_XP + APPLE_XP });
    });

    it("can be harvested again on the next cycle, and only then", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);
      const first = await harvestTree().execute(actor, FARM_ONE_ID, {
        treeInstanceId,
        expectedTreeVersion: 1,
        requestId: "request_tree_cycle_001"
      });
      expect(first.harvest.quantityAdded).toBe(APPLE_YIELD);

      await expect(
        harvestTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId,
          expectedTreeVersion: 2,
          requestId: "request_tree_cycle_002"
        })
      ).rejects.toMatchObject({ code: "TREE_NOT_READY" });

      // Rewind the regrow anchor: the second cycle is a different revision of the same tree.
      db.sqlite
        .prepare("UPDATE tree_instances SET last_harvested_at = ? WHERE id = ?")
        .run(LONG_AGO, treeInstanceId);
      const second = await harvestTree().execute(actor, FARM_ONE_ID, {
        treeInstanceId,
        expectedTreeVersion: 2,
        requestId: "request_tree_cycle_003"
      });
      expect(second.harvest.quantityAdded).toBe(APPLE_YIELD);
      expect(itemQuantity(db, APPLE)).toEqual({ quantity: APPLE_YIELD * 2 });
      expect(
        db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)
      ).toEqual({ xp: START_XP + APPLE_XP * 2 });
      const row = db.sqlite
        .prepare("SELECT version FROM tree_instances WHERE id = ?")
        .get(treeInstanceId) as { version: number };
      expect(row.version).toBe(3);
    });

    it("settles one cycle exactly once when two requests race for it", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);
      const command = { treeInstanceId, expectedTreeVersion: 1 };

      const results = await Promise.allSettled([
        harvestTree().execute(actor, FARM_ONE_ID, { ...command, requestId: "request_tree_race_001" }),
        harvestTree().execute(actor, FARM_ONE_ID, { ...command, requestId: "request_tree_race_002" })
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(itemQuantity(db, APPLE)).toEqual({ quantity: APPLE_YIELD });
      expect(
        db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID)
      ).toEqual({ xp: START_XP + APPLE_XP });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()).toEqual({
        count: 1
      });
      const row = db.sqlite
        .prepare("SELECT version FROM tree_instances WHERE id = ?")
        .get(treeInstanceId) as { version: number };
      expect(row.version).toBe(2);
    });

    it("replays the same request without paying twice", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);
      const command = { treeInstanceId, expectedTreeVersion: 1, requestId: "request_tree_replay_001" };

      const first = await harvestTree().execute(actor, FARM_ONE_ID, command);
      const replay = await harvestTree().execute(actor, FARM_ONE_ID, command);

      expect(replay).toEqual(first);
      expect(itemQuantity(db, APPLE)).toEqual({ quantity: APPLE_YIELD });
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()
      ).toEqual({ count: 1 });
    });

    it("refuses a tree that is not ready, and never awards fruit for it", async () => {
      const treeInstanceId = await plantedTree(NOW);

      await expect(
        harvestTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId,
          expectedTreeVersion: 1,
          requestId: "request_tree_not_ready_001"
        })
      ).rejects.toMatchObject({ code: "TREE_NOT_READY" });
      expect(itemQuantity(db, APPLE)).toBeUndefined();
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_harvest_settlements").get()).toEqual({
        count: 0
      });
    });

    it("refuses a stale revision, an unknown tree, another farm's tree, and a non-owner", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);
      const otherFarm = createOwnedFarm(FARM_TWO_ID, PLAYER_TWO_ID, "Farm Two", NOW);
      await farms.createWithOwner(otherFarm.farm, otherFarm.ownerMembership, []);

      await expect(
        harvestTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId,
          expectedTreeVersion: 7,
          requestId: "request_tree_stale_001"
        })
      ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
      await expect(
        harvestTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId: TREE_TWO_ID,
          expectedTreeVersion: 1,
          requestId: "request_tree_unknown_001"
        })
      ).rejects.toMatchObject({ code: "TREE_NOT_FOUND" });
      await expect(
        harvestTree().execute(actor, FARM_TWO_ID, {
          treeInstanceId,
          expectedTreeVersion: 1,
          requestId: "request_tree_other_farm_001"
        })
      ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
      await expect(
        harvestTree().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, {
          treeInstanceId,
          expectedTreeVersion: 1,
          requestId: "request_tree_non_owner_001"
        })
      ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
      expect(itemQuantity(db, APPLE)).toBeUndefined();
    });

    it("refuses a harvest that would overflow the stack", async () => {
      const treeInstanceId = await plantedTree(LONG_AGO);
      setItem(db, APPLE, 2_147_483_647);

      await expect(
        harvestTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId,
          expectedTreeVersion: 1,
          requestId: "request_tree_capacity_001"
        })
      ).rejects.toMatchObject({ code: "INVENTORY_LIMIT_EXCEEDED" });
      expect(itemQuantity(db, APPLE)).toEqual({ quantity: 2_147_483_647 });
    });
  });

  describe("RemoveTree", () => {
    it("removes the tree with no reward, no refund, and one receipt", async () => {
      give(db, SAPLING, 5);
      const state = await plantTree().execute(actor, FARM_ONE_ID, plantCommand);

      const removed = await removeTree().execute(actor, FARM_ONE_ID, {
        treeInstanceId: state.treeInstanceId,
        expectedTreeVersion: 1,
        requestId: "request_remove_tree_001"
      });

      expect(removed).toEqual({ treeInstanceId: state.treeInstanceId });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances").get()).toEqual({ count: 0 });
      expect(itemQuantity(db, SAPLING)).toEqual({ quantity: 4 });
      expect(itemQuantity(db, APPLE)).toBeUndefined();
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE operation = 'REMOVE_TREE'").get()
      ).toEqual({ count: 1 });
    });

    it("replays the same removal, and refuses a stale revision or another farm", async () => {
      give(db, SAPLING, 5);
      const state = await plantTree().execute(actor, FARM_ONE_ID, plantCommand);
      const command = {
        treeInstanceId: state.treeInstanceId,
        expectedTreeVersion: 1,
        requestId: "request_remove_tree_replay"
      };

      const first = await removeTree().execute(actor, FARM_ONE_ID, command);
      const replay = await removeTree().execute(actor, FARM_ONE_ID, command);
      expect(replay).toEqual(first);

      await expect(
        removeTree().execute(actor, FARM_ONE_ID, {
          treeInstanceId: TREE_ONE_ID,
          expectedTreeVersion: 1,
          requestId: "request_remove_tree_gone"
        })
      ).rejects.toMatchObject({ code: "TREE_NOT_FOUND" });
      await expect(
        removeTree().execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID, {
          treeInstanceId: TREE_ONE_ID,
          expectedTreeVersion: 1,
          requestId: "request_remove_tree_other"
        })
      ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    });

    it("frees the tile for a crop again once the tree is gone", async () => {
      give(db, SAPLING, 5);
      const state = await plantTree().execute(actor, FARM_ONE_ID, plantCommand);
      await removeTree().execute(actor, FARM_ONE_ID, {
        treeInstanceId: state.treeInstanceId,
        expectedTreeVersion: 1,
        requestId: "request_remove_tree_free"
      });

      setItem(db, "item_carrot_seed", 2);
      const plantCrop = new PlantCrop({
        farms,
        members,
        tiles,
        crops,
        inventory,
        idempotency: crops,
        definitions: new GameDataCropDefinitions(),
        progression: progressions,
        progressionDefinition: gameDataProgressionDefinition,
        unlockedLand: new ConfiguredUnlockedLand(true),
        inventoryService: new InventoryService(new GameDataItemDefinitions(), clock),
        ids: { newCropInstanceId: () => "cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as never },
        fingerprints: new Sha256Fingerprint(),
        clock
      });
      const crop = await plantCrop.execute(actor, FARM_ONE_ID, {
        requestId: "request_crop_after_tree_001",
        cropDefinitionId: "crop_carrot",
        x: 0,
        y: 0,
        expectedTileVersion: 1
      });
      expect(crop.tileX).toBe(0);
    });
  });
});
