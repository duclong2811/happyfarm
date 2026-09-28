import type {
  CropDefinition,
  CropDefinitionId,
  CropInstance,
  CropInstanceId,
  CurrencyDefinition,
  CurrencyDefinitionId,
  EconomyLedgerEntry,
  EconomyMutation,
  EconomyTransactionId,
  Farm,
  FarmId,
  FarmMember,
  FarmTile,
  InventoryAddition,
  InventoryItem,
  InventoryMutation,
  ItemDefinition,
  ItemDefinitionId,
  Player,
  PlayerId,
  PlayerProgression,
  ShopEntry,
  ShopEntryId,
  XpAward,
  Wallet
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

export interface EconomyTransactionIdGenerator {
  newEconomyTransactionId(): EconomyTransactionId;
}

export interface PlayerRepository {
  findById(id: PlayerId): Promise<Player | null>;
}

export interface FarmRepository {
  /** Atomically creates the farm, its OWNER membership, and its starter land tiles. */
  createWithOwner(
    farm: Farm,
    ownerMembership: FarmMember,
    initialTiles: readonly FarmTile[]
  ): Promise<void>;
  findById(id: FarmId): Promise<Farm | null>;
}

export interface FarmMemberRepository {
  findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null>;
}

export interface FarmTileRepository {
  insert(tile: FarmTile): Promise<void>;
  find(farmId: FarmId, x: number, y: number): Promise<FarmTile | null>;
  listByFarm(farmId: FarmId): Promise<readonly FarmTile[]>;
  updateVersion(tile: FarmTile, expectedVersion: number): Promise<boolean>;
}

export interface CropDefinitionRepository {
  findById(id: CropDefinitionId): CropDefinition | null;
  /**
   * Every crop this deployment can be asked to plant, in game-data order.
   *
   * The catalogue is projected to clients from here so no build has to hardcode a crop list, and a
   * crop the player cannot plant yet is still listed: the client needs to be able to say why it is
   * locked rather than hide it.
   */
  list(): readonly CropDefinition[];
}

export interface ItemDefinitionRepository {
  findById(id: ItemDefinitionId): ItemDefinition | null;
}

export interface CurrencyDefinitionRepository {
  findById(id: CurrencyDefinitionId): CurrencyDefinition | null;
}

export interface ShopEntryRepository {
  findById(id: ShopEntryId): ShopEntry | null;
  list(): readonly ShopEntry[];
}

export interface WalletRepository {
  find(playerId: PlayerId, currencyDefinitionId: CurrencyDefinitionId): Promise<Wallet | null>;
  listByPlayer(playerId: PlayerId): Promise<readonly Wallet[]>;
}

export interface EconomyLedgerRepository {
  findByTransactionId(transactionId: EconomyTransactionId): Promise<EconomyLedgerEntry | null>;
  listByPlayer(playerId: PlayerId, limit: number): Promise<readonly EconomyLedgerEntry[]>;
}

/** The sole Phase 3C write boundary for a wallet mutation and its ledger row. */
export interface EconomyMutationRepository {
  applyAtomically(mutation: EconomyMutation): Promise<void>;
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
  /**
   * Writes the harvest, its experience award, and the idempotency record as one transaction.
   *
   * The award is absolute after-values plus the pre-state they must replace, so a concurrent award
   * either applies against the state the caller read or fails the whole settlement.
   */
  settleHarvestAtomically(
    crop: CropInstance,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

export interface ProgressionRepository {
  find(playerId: PlayerId): Promise<PlayerProgression | null>;
}

export interface EconomySettlementRepository {
  settleShopAtomically(
    economy: EconomyMutation,
    inventory: InventoryMutation,
    expectedInventory: InventoryItem | null,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}
