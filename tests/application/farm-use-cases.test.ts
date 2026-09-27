import { describe, expect, it } from "vitest";
import { CreateFarm, GetFarm } from "@happy-farm/application";
import type {
  ApplicationError,
  Clock,
  FarmMemberRepository,
  FarmRepository,
  IdGenerator,
  PlayerRepository
} from "@happy-farm/application";
import type { Farm, FarmId, FarmMember, Player } from "@happy-farm/domain";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const player: Player = {
  id: PLAYER_ONE_ID,
  authIssuer: "https://identity.test",
  authSubject: "subject-one",
  displayName: "Player One",
  status: "ACTIVE",
  createdAt: NOW,
  updatedAt: NOW
};

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class FixedIds implements IdGenerator {
  newFarmId(): FarmId {
    return FARM_ONE_ID;
  }
}

class MemoryPlayers implements PlayerRepository {
  findById(id: typeof PLAYER_ONE_ID): Promise<Player | null> {
    return Promise.resolve(id === player.id ? player : null);
  }
}

class MemoryFarms implements FarmRepository, FarmMemberRepository {
  farm: Farm | null = null;
  owner: FarmMember | null = null;
  failMembership = false;

  createWithOwner(farm: Farm, ownerMembership: FarmMember): Promise<void> {
    if (this.failMembership) return Promise.reject(new Error("membership insert failed"));
    this.farm = farm;
    this.owner = ownerMembership;
    return Promise.resolve();
  }

  findById(id: FarmId): Promise<Farm | null> {
    return Promise.resolve(this.farm?.id === id ? this.farm : null);
  }

  findByFarmAndPlayer(farmId: FarmId, playerId: typeof PLAYER_ONE_ID): Promise<FarmMember | null> {
    return Promise.resolve(this.owner?.farmId === farmId && this.owner.playerId === playerId ? this.owner : null);
  }
}

describe("farm application use cases", () => {
  it("creates a farm for the authenticated actor with one owner membership", async () => {
    const storage = new MemoryFarms();
    const result = await new CreateFarm(new MemoryPlayers(), storage, new FixedIds(), new FixedClock()).execute(
      { playerId: PLAYER_ONE_ID },
      { name: "Starter Farm" }
    );
    expect(result.farm.ownerPlayerId).toBe(PLAYER_ONE_ID);
    expect(result.ownerMembership.role).toBe("OWNER");
    expect(storage.farm).not.toBeNull();
  });

  it("does not expose a partial farm when atomic owner persistence fails", async () => {
    const storage = new MemoryFarms();
    storage.failMembership = true;
    await expect(
      new CreateFarm(new MemoryPlayers(), storage, new FixedIds(), new FixedClock()).execute(
        { playerId: PLAYER_ONE_ID },
        { name: "Starter Farm" }
      )
    ).rejects.toThrow("membership insert failed");
    expect(storage.farm).toBeNull();
  });

  it("never accepts a requested owner and always uses the actor", async () => {
    const storage = new MemoryFarms();
    const result = await new CreateFarm(new MemoryPlayers(), storage, new FixedIds(), new FixedClock()).execute(
      { playerId: PLAYER_ONE_ID },
      { name: "Starter Farm" }
    );
    expect(result.farm.ownerPlayerId).not.toBe(PLAYER_TWO_ID);
  });

  it("rejects cross-player farm access", async () => {
    const storage = new MemoryFarms();
    await new CreateFarm(new MemoryPlayers(), storage, new FixedIds(), new FixedClock()).execute(
      { playerId: PLAYER_ONE_ID },
      { name: "Starter Farm" }
    );
    await expect(new GetFarm(storage, storage).execute({ playerId: PLAYER_TWO_ID }, FARM_ONE_ID)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED"
    } satisfies Partial<ApplicationError>);
  });
});
