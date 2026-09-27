import type { Farm, FarmId, FarmMember, FarmTile, Player, PlayerId } from "@happy-farm/domain";

export interface ActorContext {
  readonly playerId: PlayerId;
}

export interface AuthenticationPort<TCredentials> {
  authenticate(credentials: TCredentials): Promise<ActorContext | null>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  newFarmId(): FarmId;
}

export interface PlayerRepository {
  findById(id: PlayerId): Promise<Player | null>;
}

export interface FarmRepository {
  createWithOwner(farm: Farm, ownerMembership: FarmMember): Promise<void>;
  findById(id: FarmId): Promise<Farm | null>;
}

export interface FarmMemberRepository {
  findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null>;
}

export interface FarmTileRepository {
  insert(tile: FarmTile): Promise<void>;
  find(farmId: FarmId, x: number, y: number): Promise<FarmTile | null>;
  updateVersion(tile: FarmTile, expectedVersion: number): Promise<boolean>;
}
