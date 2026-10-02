import { describe, expect, it } from "vitest";
import { PlaceConstruction, type TileTerrainLookup } from "@happy-farm/application";
import { createInitialFarmTiles, createOwnedFarm, parseFarmId } from "@happy-farm/domain";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";
import {
  GameDataConstructionDefinitions,
  gameDataProgressionDefinition,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";

/**
 * The island's geography, reaching the placement rule.
 *
 * V13.2 reported the gap: the server knew which tiles the farm owned and nothing else, so "an owned
 * tile is land" stood in for a world model. V13.3 hands it the same `classifyTile` the renderer reads,
 * and this is the assertion that the hand-off happens - a classifier that calls an owned cell the
 * volcano has to be refused *as the volcano* rather than allowed because the farm owns the cell.
 *
 * The ports are faked loosely on purpose: this test is about one wire, and every other dependency is
 * a stub that the placement under test never reaches.
 */

const FARM_ID = parseFarmId("farm_11111111-1111-4111-8111-111111111111");
const TREE = {
  requestId: "terrain_tree_001",
  entryId: "place_tree_broad",
  anchorX: 1,
  anchorY: 1,
  rotation: 0
} as const;

function useCaseWith(terrain: TileTerrainLookup): { run: () => Promise<unknown>; placed: () => number } {
  const { farm, ownerMembership } = createOwnedFarm(FARM_ID, PLAYER_ONE_ID, "Terrain Farm", NOW);
  const tiles = createInitialFarmTiles(FARM_ID, NOW, 4);
  let placed = 0;
  const dependencies = {
    farms: { findById: () => Promise.resolve(farm), starterWorldState: () => Promise.resolve(null) },
    members: { findByFarmAndPlayer: () => Promise.resolve(ownerMembership) },
    tiles: {
      find: (_farmId: unknown, x: number, y: number) =>
        Promise.resolve(tiles.find((tile) => tile.x === x && tile.y === y) ?? null)
    },
    terrain,
    constructions: {
      listBounds: () => Promise.resolve([]),
      placeAtomically: () => {
        placed += 1;
        return Promise.resolve();
      },
      findById: () => Promise.resolve(null),
      listByFarm: () => Promise.resolve([])
    },
    definitions: new GameDataConstructionDefinitions(),
    progression: { find: () => Promise.resolve(null) },
    progressionDefinition: gameDataProgressionDefinition,
    // Plenty of gold, so the refusal under test is the *ground* rather than the purse: the placement
    // rule answers status, level and funds before it asks about the cells.
    wallets: {
      find: () =>
        Promise.resolve({
          playerId: PLAYER_ONE_ID,
          currencyDefinitionId: "currency_gold",
          balance: 10_000,
          version: 1,
          updatedAt: NOW
        })
    },
    currencies: {
      findById: () =>
        Promise.resolve({ id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER })
    },
    economyService: { prepareMutation: () => ({ delta: -40, transactionId: "econ_x" }) },
    idempotency: { find: () => Promise.resolve(null) },
    ids: { newConstructionId: () => "construct_11111111-1111-4111-8111-111111111111" },
    fingerprints: { hash: () => Promise.resolve("a".repeat(64)) },
    clock: { now: () => NOW }
  };
  const useCase = new PlaceConstruction(
    dependencies as unknown as ConstructorParameters<typeof PlaceConstruction>[0]
  );
  return {
    run: () => useCase.execute({ playerId: PLAYER_ONE_ID }, FARM_ID, TREE),
    placed: () => placed
  };
}

const forced = (
  classification: ReturnType<TileTerrainLookup["classify"]>
): TileTerrainLookup => ({ classify: () => classification });

describe("the placement rule reads the island's geography", () => {
  it("allows a tree on an owned cell the geography calls ordinary land", async () => {
    const subject = useCaseWith(gameDataTileTerrain);
    await subject.run();
    expect(subject.placed()).toBe(1);
  });

  it("refuses an owned cell the geography calls the volcano, and says why", async () => {
    // The farm owns this cell - it is one of its own rows - and the rule still refuses it, because the
    // ground is not a place a tree may stand. That is the difference a shared geography makes.
    const subject = useCaseWith(forced({ terrain: "VOLCANO", shallowWater: false, protectedGround: true }));
    await expect(subject.run()).rejects.toMatchObject({ code: "CONSTRUCTION_BLOCKED" });
    expect(subject.placed()).toBe(0);
  });

  it("refuses an owned cell the geography calls water, and one it calls the beach", async () => {
    const water = useCaseWith(forced({ terrain: "WATER", shallowWater: true, protectedGround: false }));
    await expect(water.run()).rejects.toMatchObject({ code: "CONSTRUCTION_UNSUITABLE_GROUND" });
    const beach = useCaseWith(forced({ terrain: "SHORE", shallowWater: false, protectedGround: false }));
    await expect(beach.run()).rejects.toMatchObject({ code: "CONSTRUCTION_UNSUITABLE_GROUND" });
  });

  it("refuses land the farm does not own before any physical question, whatever the ground is", async () => {
    // Ownership first: land the farm does not have is "not yours", which is the honest answer and the
    // one the client's preview gives.
    const { farm, ownerMembership } = createOwnedFarm(FARM_ID, PLAYER_ONE_ID, "Terrain Farm", NOW);
    const useCase = new PlaceConstruction({
      farms: { findById: () => Promise.resolve(farm), starterWorldState: () => Promise.resolve(null) },
      members: { findByFarmAndPlayer: () => Promise.resolve(ownerMembership) },
      tiles: { find: () => Promise.resolve(null) },
      terrain: gameDataTileTerrain,
      constructions: { listBounds: () => Promise.resolve([]) },
      definitions: new GameDataConstructionDefinitions(),
      progression: { find: () => Promise.resolve(null) },
      progressionDefinition: gameDataProgressionDefinition,
      wallets: {
        find: () =>
          Promise.resolve({
            playerId: PLAYER_ONE_ID,
            currencyDefinitionId: "currency_gold",
            balance: 10_000,
            version: 1,
            updatedAt: NOW
          })
      },
      currencies: {
        findById: () =>
          Promise.resolve({ id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER })
      },
      economyService: { prepareMutation: () => ({}) },
      idempotency: { find: () => Promise.resolve(null) },
      ids: { newConstructionId: () => "construct_11111111-1111-4111-8111-111111111111" },
      fingerprints: { hash: () => Promise.resolve("a".repeat(64)) },
      clock: { now: () => NOW }
    } as unknown as ConstructorParameters<typeof PlaceConstruction>[0]);
    await expect(useCase.execute({ playerId: PLAYER_ONE_ID }, FARM_ID, TREE)).rejects.toMatchObject({
      code: "CONSTRUCTION_NOT_OWNED"
    });
  });

  it("classifies the island's real places the way a player would describe them", () => {
    // The one shared classifier, checked against places anybody can point at.
    expect(gameDataTileLocalLand()).toBe("LAND");
    expect(gameDataTileTerrain.classify({ x: 53, y: 53 }).terrain).toBe("LAND");
    expect(gameDataTileTerrain.classify({ x: 45, y: 3 }).protectedGround).toBe(true);
    expect(gameDataTileTerrain.classify({ x: 12, y: -23 }).terrain).toBe("VOLCANO");
    expect(gameDataTileTerrain.classify({ x: 120, y: 120 }).terrain).toBe("WATER");
  });
});

/** The starter field, through the shared classifier: the piece of land this whole game starts on. */
function gameDataTileLocalLand(): string {
  return gameDataTileTerrain.classify({ x: 5, y: 5 }).terrain;
}
