import type {
  CropDefinition,
  CropDefinitionId,
  CropInstance,
  CropInstanceId,
  Farm,
  FarmId,
  FarmMember,
  FarmTile,
  InventoryAddition,
  InventoryItem,
  ItemDefinition,
  ItemDefinitionId,
  Player,
  PlayerId
} from "@happy-farm/domain";

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

export interface CropIdGenerator {
  newCropInstanceId(): CropInstanceId;
}

export interface PayloadFingerprint {
  hash(canonicalPayload: string): Promise<string>;
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

export interface CropDefinitionRepository {
  findById(id: CropDefinitionId): CropDefinition | null;
}

export interface ItemDefinitionRepository {
  findById(id: ItemDefinitionId): ItemDefinition | null;
}

export interface InventoryRepository {
  find(playerId: PlayerId, itemDefinitionId: ItemDefinitionId): Promise<InventoryItem | null>;
  listByPlayer(playerId: PlayerId): Promise<readonly InventoryItem[]>;
}

export interface IdempotencyRecord {
  readonly actorPlayerId: PlayerId;
  readonly operation: string;
  readonly requestId: string;
  readonly payloadFingerprint: string;
  readonly resourceId: string;
  readonly responseJson: string;
  readonly status: "COMPLETED";
  readonly createdAt: string;
}

export interface IdempotencyRepository {
  find(actorPlayerId: PlayerId, operation: string, requestId: string): Promise<IdempotencyRecord | null>;
}

export interface CropInstanceRepository {
  findById(id: CropInstanceId): Promise<CropInstance | null>;
  findAtTile(farmId: FarmId, x: number, y: number): Promise<CropInstance | null>;
  listByFarm(farmId: FarmId): Promise<readonly CropInstance[]>;
  plantAtomically(
    crop: CropInstance,
    expectedTileVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

export interface HarvestSettlementRepository {
  settleHarvestAtomically(
    crop: CropInstance,
    addition: InventoryAddition,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}
