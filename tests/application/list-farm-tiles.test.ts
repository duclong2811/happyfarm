import { describe, expect, it } from "vitest";
import { ListFarmTiles } from "@happy-farm/application";
import type {
  ApplicationError,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository
} from "@happy-farm/application";
import { createInitialFarmTiles, INITIAL_LAND_SIZE } from "@happy-farm/domain";
import type { Farm, FarmId, FarmMember, FarmTile, PlayerId } from "@happy-farm/domain";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

class MemoryFarms implements FarmRepository, FarmMemberRepository {
  private readonly farm: Farm = {
    id: FARM_ONE_ID,
    ownerPlayerId: PLAYER_ONE_ID,
    name: "Starter Farm",
    createdAt: NOW,
    updatedAt: NOW
  };

  createWithOwner(): Promise<void> {
    return Promise.resolve();
  }

  findById(id: FarmId): Promise<Farm | null> {
    return Promise.resolve(this.farm.id === id ? this.farm : null);
  }

  findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null> {
    return Promise.resolve(
      farmId === this.farm.id && playerId === this.farm.ownerPlayerId
        ? { farmId, playerId, role: "OWNER", createdAt: NOW }
        : null
    );
  }
}

class MemoryTiles implements FarmTileRepository {
  constructor(private readonly tiles: readonly FarmTile[] = []) {}

  insert(): Promise<void> {
    return Promise.resolve();
  }

  find(): Promise<FarmTile | null> {
    return Promise.resolve(null);
  }

  listByFarm(): Promise<readonly FarmTile[]> {
    return Promise.resolve(this.tiles);
  }

  updateVersion(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

describe("ListFarmTiles", () => {
  it("returns the farm's unlocked land for a member", async () => {
    const tiles = createInitialFarmTiles(FARM_ONE_ID, NOW);
    const result = await new ListFarmTiles(new MemoryFarms(), new MemoryFarms(), new MemoryTiles(tiles)).execute(
      { playerId: PLAYER_ONE_ID },
      FARM_ONE_ID
    );
    expect(result).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(result[0]).toMatchObject({ terrainType: "SOIL", version: 1 });
  });

  it("requires authentication", async () => {
    await expect(
      new ListFarmTiles(new MemoryFarms(), new MemoryFarms(), new MemoryTiles()).execute(null, FARM_ONE_ID)
    ).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" } satisfies Partial<ApplicationError>);
  });

  it("hides farms that do not exist", async () => {
    await expect(
      new ListFarmTiles(new MemoryFarms(), new MemoryFarms(), new MemoryTiles()).execute(
        { playerId: PLAYER_ONE_ID },
        FARM_TWO_ID
      )
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" } satisfies Partial<ApplicationError>);
  });

  it("rejects actors without a farm membership", async () => {
    await expect(
      new ListFarmTiles(new MemoryFarms(), new MemoryFarms(), new MemoryTiles()).execute(
        { playerId: PLAYER_TWO_ID },
        FARM_ONE_ID
      )
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" } satisfies Partial<ApplicationError>);
  });
});