import { describe, expect, it } from "vitest";
import { FarmTileService } from "@happy-farm/application";
import type {
  Clock,
  FarmMemberRepository,
  FarmTileRepository
} from "@happy-farm/application";
import type {
  FarmId,
  FarmMember,
  FarmTile,
  PlayerId,
  UnlockedLandPolicy
} from "@happy-farm/domain";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class OwnerMemberships implements FarmMemberRepository {
  findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null> {
    if (farmId !== FARM_ONE_ID || playerId !== PLAYER_ONE_ID) return Promise.resolve(null);
    return Promise.resolve({ farmId, playerId, role: "OWNER", createdAt: NOW });
  }
}

class ConfiguredLand implements UnlockedLandPolicy {
  constructor(private readonly unlocked: boolean) {}
  isUnlocked(): Promise<boolean> {
    return Promise.resolve(this.unlocked);
  }
}

class MemoryTiles implements FarmTileRepository {
  tile: FarmTile | null = null;
  insert(tile: FarmTile): Promise<void> {
    this.tile = tile;
    return Promise.resolve();
  }
  find(): Promise<FarmTile | null> {
    return Promise.resolve(this.tile);
  }
  listByFarm(): Promise<readonly FarmTile[]> {
    return Promise.resolve(this.tile === null ? [] : [this.tile]);
  }
  updateVersion(tile: FarmTile, expectedVersion: number): Promise<boolean> {
    if (this.tile?.version !== expectedVersion) return Promise.resolve(false);
    this.tile = tile;
    return Promise.resolve(true);
  }
}

describe("FarmTileService", () => {
  it("creates a version-one tile only on unlocked land", async () => {
    const tiles = new MemoryTiles();
    const service = new FarmTileService(new OwnerMemberships(), tiles, new ConfiguredLand(true), new FixedClock());
    const tile = await service.create({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { x: 0, y: 0 }, "GRASS");
    expect(tile.version).toBe(1);
  });

  it("rejects locked land and unauthorized actors", async () => {
    const tiles = new MemoryTiles();
    await expect(
      new FarmTileService(new OwnerMemberships(), tiles, new ConfiguredLand(false), new FixedClock()).create(
        { playerId: PLAYER_ONE_ID },
        FARM_ONE_ID,
        { x: 0, y: 0 },
        "GRASS"
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      new FarmTileService(new OwnerMemberships(), tiles, new ConfiguredLand(true), new FixedClock()).create(
        { playerId: PLAYER_TWO_ID },
        FARM_ONE_ID,
        { x: 0, y: 0 },
        "GRASS"
      )
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("rejects invalid coordinates before consulting unlocked land or persistence", async () => {
    const service = new FarmTileService(
      new OwnerMemberships(),
      new MemoryTiles(),
      new ConfiguredLand(true),
      new FixedClock()
    );
    await expect(
      service.create({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { x: 0.5, y: 0 }, "GRASS")
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns a stale-state conflict when optimistic persistence loses a race", async () => {
    const tiles = new MemoryTiles();
    const service = new FarmTileService(new OwnerMemberships(), tiles, new ConfiguredLand(true), new FixedClock());
    await service.create({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { x: 0, y: 0 }, "GRASS");
    await service.touch({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { x: 0, y: 0 }, 1);
    await expect(
      service.touch({ playerId: PLAYER_ONE_ID }, FARM_ONE_ID, { x: 0, y: 0 }, 1)
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_STATE" });
  });
});
