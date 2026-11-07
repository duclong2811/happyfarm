import type {
  CatchTableEntry,
  CellBounds,
  ConstructionDefinition,
  ConstructionId,
  ConstructionInstance,
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
  FishingAction,
  FishingActionId,
  FishingStockState,
  ResourceAction,
  ResourceActionId,
  ResourceDropEntry,
  ResourceNodeState,
  ResourceVerb,
  InventoryAddition,
  InventoryItem,
  InventoryMutation,
  InventoryRemoval,
  ItemDefinition,
  ItemDefinitionId,
  Player,
  PlayerId,
  PlayerProgression,
  PlotDefinition,
  ShopEntry,
  ShopEntryId,
  TreeDefinition,
  TreeDefinitionId,
  TreeInstance,
  TreeInstanceId,
  WarehouseState,
  WarehouseTierDefinition,
  Actor,
  ActorId,
  AutoTravelState,
  ActorJob,
  ActorCargoItem,
  JobId,
  WorkArea,
  WorkAreaCell,
  WorkAreaGroundCapability,
  WorkAreaId,
  XpAward,
  Wallet
} from "@happy-farm/domain";
import type { ProductionAssignmentSnapshot, ProductionSettlementResult, ProductionSourceSnapshot } from "@happy-farm/domain";
import type { NeighborSnapshot, NeighborVisitRecord } from "./neighbor";

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

export interface TreeIdGenerator {
  newTreeInstanceId(): TreeInstanceId;
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
  /**
   * The farm a player owns, or null.
   *
   * The player's own farm, by ownership rather than by an id the client sent. It exists so the
   * first-login path can answer "do they already have one?" - which is what makes creating a farm
   * safe to retry from a phone on a flaky connection.
   */
  findByOwner(playerId: PlayerId): Promise<Farm | null>;
  /**
   * The farm's owner and how much of the starter arrangement it has been given.
   *
   * Separate from `findById` on purpose: this is bookkeeping for the seeding pass alone, and every
   * other reader of a farm would be carrying a number it never looks at.
   */
  starterWorldState(farmId: FarmId): Promise<{ readonly ownerPlayerId: PlayerId; readonly version: number } | null>;
}

export interface FarmMemberRepository {
  findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null>;
}

export interface NeighborRepository {
  ensure(farmId: FarmId, now: string): Promise<void>;
  reconcile(farmId: FarmId, now: string): Promise<void>;
  visit(farmId: FarmId, playerId: PlayerId): Promise<NeighborVisitRecord>;
  snapshot(farmId: FarmId, playerId: PlayerId): Promise<NeighborSnapshot>;
  findTravelReplay(playerId: PlayerId, requestId: string, fingerprint: string): Promise<boolean>;
  travelAtomically(farmId: FarmId, playerId: PlayerId, current: NeighborVisitRecord, input: { requestId: string; expectedVersion: number; destination: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; islandId?: string | undefined }, now: string): Promise<void>;
}

export interface ProductionAssignmentRecord extends ProductionAssignmentSnapshot {
  readonly actorJobId?: JobId;
  readonly executionMode: "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
}

export interface ProductionAssignmentRepository {
  findByFarmAndId(farmId: FarmId, assignmentId: string): Promise<ProductionAssignmentRecord | null>;
  listByFarm(farmId: FarmId): Promise<readonly ProductionAssignmentRecord[]>;
}

export interface ProductionSourceRepository {
  findByFarmAndId(farmId: FarmId, sourceId: string): Promise<ProductionSourceSnapshot | null>;
}

export interface OrchardProductionBinding {
  readonly assignmentId: string;
  readonly sourceId: string;
  readonly farmId: FarmId;
  readonly actorJobId: JobId;
  readonly ratePerHour: number;
  readonly settlementCursor: string;
  readonly version: number;
}

export interface OrchardProductionBindingRepository {
  ensureAtomically(input: {
    readonly assignmentId: string;
    readonly sourceId: string;
    readonly farmId: FarmId;
    readonly actorId: ActorId;
    readonly actorJobId: JobId;
    readonly workAreaId: WorkAreaId;
    readonly ratePerHour: number;
    readonly activatedAt: string;
  }): Promise<OrchardProductionBinding>;
}

export interface ProductionSettlementPlan {
  readonly playerId: PlayerId;
  readonly assignmentId: string;
  readonly farmId: FarmId;
  readonly expectedAssignmentVersion: number;
  readonly expectedCursor: string;
  readonly expectedAssignmentEnabled: boolean;
  readonly expectedSourceVersion: number;
  /** Optional dynamic resource rate guard; omitted for legacy callers and Apple settlements. */
  readonly expectedSourceRatePerHour?: number;
  /** The source rate to persist after this settlement. */
  readonly nextSourceRatePerHour?: number;
  /** Optional authoritative-stock snapshot for a finite wild-fishery source. */
  readonly nextSourceRemainingStock?: number | null;
  readonly sourceId: string;
  readonly finiteSource: boolean;
  readonly expectedSourceStock: number | null;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly expectedInventoryQuantity: number;
  readonly expectedInventoryVersion: number;
  readonly expectedWarehouseVersion: number;
  readonly expectedWarehouseUsed: number;
  readonly warehouseCapacity: number;
  readonly result: ProductionSettlementResult;
  readonly settlementId: string;
  readonly settledAt: string;
  readonly executionMode?: "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
  /** Existing resource-node states consumed by a resource-backed production settlement. */
  readonly resourceNodeDepletions?: readonly {
    readonly zoneKind: string;
    readonly zoneId: string;
    readonly nodeId: string;
    readonly expectedAvailableAt: string | null;
    readonly expectedVersion: number | null;
    readonly availableAt: string;
    readonly depletedAt: string;
    readonly nextVersion: number;
  }[];
  /** Wild-fishery stock mutations, guarded in the same batch as warehouse and assignment state. */
  readonly fishingSpotConsumptions?: readonly {
    readonly zoneKind: string;
    readonly zoneId: string;
    readonly spotId: string;
    readonly expectedStock: number;
    readonly expectedLastRegeneratedAt: string | null;
    readonly expectedVersion: number | null;
    readonly stock: number;
    readonly lastRegeneratedAt: string;
    readonly nextVersion: number;
  }[];
}

export interface ProductionSettlementCommitter {
  settle(plan: ProductionSettlementPlan): Promise<{ readonly applied: boolean; readonly result: ProductionSettlementResult }>;
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

/**
 * The land this deployment sells.
 *
 * The catalogue is game data rather than player state, so a plot is looked up by the layout slot the
 * purchase targets — never by anything a client sends. `findByIndex` returning null is how the
 * application learns a farm has bought all the land there is.
 */
export interface PlotDefinitionRepository {
  findByIndex(index: number): PlotDefinition | null;
  list(): readonly PlotDefinition[];
}

/**
 * The trees this deployment ships.
 *
 * A catalogue like the crop one: game data rather than player state, looked up by the definition a
 * command names and never by anything a client invents. Two trees cannot share a sapling, and the
 * game-data registry refuses that at load rather than leaving it to be interpreted here.
 */
export interface TreeDefinitionRepository {
  findById(id: TreeDefinitionId): TreeDefinition | null;
  list(): readonly TreeDefinition[];
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

export interface AquaculturePondCohort {
  readonly cohortId: string;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly stockedAt: string;
  readonly readyAt: string;
}

/** Summary state keyed by the reusable construction; cohorts preserve each stock event. */
export interface AquaculturePondState {
  readonly constructionId: ConstructionId;
  readonly farmId: FarmId;
  readonly itemDefinitionId: ItemDefinitionId | null;
  readonly stockedAt: string | null;
  readonly readyAt: string | null;
  readonly version: number;
  readonly cohorts: readonly AquaculturePondCohort[];
}

/** The one D1 write boundary for stocking input and settling a pond harvest. */
export interface AquaculturePondRepository {
  listByFarm(farmId: FarmId): Promise<readonly AquaculturePondState[]>;
  findByConstruction(farmId: FarmId, constructionId: ConstructionId): Promise<AquaculturePondState | null>;
  stockAtomically(input: {
    readonly state: AquaculturePondState | null;
    readonly farmId: FarmId;
    readonly itemDefinitionId: ItemDefinitionId;
    readonly stockedAt: string;
    readonly readyAt: string;
    readonly cohortId: string;
    readonly quantity: number;
    readonly expectedInventory: InventoryItem;
    readonly removal: InventoryRemoval;
    readonly idempotency: IdempotencyRecord;
  }): Promise<void>;
  settleAtomically(input: {
    readonly state: AquaculturePondState;
    readonly addition: InventoryAddition;
    readonly expectedInventory: InventoryItem | null;
    readonly operation: "HARVEST_AQUACULTURE_POND" | "WITHDRAW_AQUACULTURE_POND";
    readonly allocations: readonly { readonly cohortId: string; readonly quantity: number }[];
    readonly idempotency: IdempotencyRecord;
  }): Promise<void>;
}

/**
 * One stack a settlement is taking out of an actor's cargo.
 *
 * The mirror of `InventoryRemoval` for the *other* container, and the reason a plant can be paid for
 * from the actor's hands: the subtraction is scoped to the row and version the caller read, inside the
 * same transaction as the crop, so a concurrent consumption rolls the whole planting back.
 */
export interface CargoRemoval {
  readonly actorId: ActorId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  /** The quantity and version the caller read: what makes the subtraction scoped, not blind. */
  readonly expectedQuantity: number;
  readonly expectedVersion: number;
  readonly timestamp: string;
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

/**
 * A receipt boundary for commands that settle several independent tree cycles.
 *
 * The individual tree settlement remains the economic authority; this receipt only makes a bounded
 * HTTP group replayable as one user action after a network response is lost.  It deliberately has no
 * domain-specific write method so the application cannot bypass the existing tree settlement.
 */
export interface TreeHarvestBatchReceiptRepository {
  find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<boolean>;
}

/** Receipt boundary for a bounded group of crop harvests. Each crop still uses HarvestCrop's settlement. */
export interface CropHarvestBatchReceiptRepository {
  find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<boolean>;
}

/** Receipt boundary for a bounded planting group. Individual cells still use PlantCrop/PlantTree settlement. */
export interface PlantBatchReceiptRepository {
  find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<boolean>;
}

/**
 * The Island Warehouse: finite Home Island storage, as capacity over the existing inventory.
 *
 * It is a port rather than a domain `InventoryRepository` method because it is a different axis: the
 * inventory answers "how much of this item does the player hold", and the warehouse answers "how many
 * units may the island hold in total". The upgrade is one atomic boundary, so the tier change, the
 * gold debit, the materials consumed and the receipt are all or nothing.
 */
export interface WarehouseUpgrade {
  readonly playerId: PlayerId;
  /** The warehouse id the ledger row cites. */
  readonly warehouseId: string;
  readonly expectedFromTier: number;
  readonly expectedVersion: number;
  readonly toTier: number;
  readonly capacity: number;
  readonly economy: EconomyMutation;
  readonly removals: readonly InventoryRemoval[];
  readonly expectedInventory: readonly InventoryItem[];
  readonly createdAt: string;
}

export interface WarehouseRepository {
  find(playerId: PlayerId): Promise<WarehouseState | null>;
  /** The sum of every stored item's quantity: the warehouse's used capacity. */
  usedCapacity(playerId: PlayerId): Promise<number>;
  /** Writes the tier, capacity, gold debit, consumed materials and the receipt in one transaction. */
  upgradeAtomically(upgrade: WarehouseUpgrade, idempotency: IdempotencyRecord): Promise<void>;
}

export interface WarehouseTierRepository {
  list(): readonly WarehouseTierDefinition[];
}

/**
 * Fishing: the catalogue, the randomness, and the one write boundary.
 *
 * The catalogue and the random source are ports because the *rules* live in the domain and the
 * *values* live in game data: the use case must be testable with a table and a fixed roll, and the
 * production roll must come from the platform's own entropy rather than from `Math.random` scattered
 * through a command.
 */
export interface FishingIdGenerator {
  newFishingActionId(): FishingActionId;
}

/**
 * Where the actor's home island is, as a zone.
 *
 * A port rather than a `FarmRepository` call because fishing is not farm-scoped: the use case needs
 * the *zone*, and the derivation from a farm to a `HOME_ISLAND` zone belongs to whoever owns that
 * vocabulary. It returns null when the actor has no island yet, which the caller refuses.
 */
export interface HomeIslandZoneResolver {
  resolveForPlayer(actorPlayerId: PlayerId): Promise<{ readonly kind: string; readonly id: string } | null>;
}

export interface FishingSpotDefinition {
  readonly id: string;
  readonly displayNameKey: string;
  readonly zoneKind: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly interactionRadiusTiles: number;
  readonly tableId: string;
  readonly enabled: boolean;
  readonly maxStock: number;
  readonly regenerationSeconds: number;
  readonly productionUnitsPerHour: number;
}

export interface FishingTableDefinition {
  readonly id: string;
  readonly entries: readonly CatchTableEntry[];
}

export interface FishDefinition {
  readonly id: string;
  readonly displayNameKey: string;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly itemDisplayNameKey: string;
  readonly modelId: string | null;
  readonly sellPrice: number;
  readonly xp: number;
  readonly requiredLevel: number;
}

export interface FishingCataloguePort {
  listSpots(): readonly FishingSpotDefinition[];
  findSpot(spotId: string): FishingSpotDefinition | null;
  findTable(tableId: string): FishingTableDefinition | null;
  findFish(fishId: string): FishDefinition | null;
  readonly actionSeconds: number;
}

export interface FishingSpotStateRepository {
  listByZone(zoneKind: string, zoneId: string): Promise<readonly FishingStockState[]>;
  isAvailable?(): boolean;
}

export interface WildFisheryProductionBinding {
  readonly assignmentId: string;
  readonly sourceId: string;
  readonly farmId: FarmId;
  readonly actorJobId: JobId;
  readonly ratePerHour: number;
  readonly settlementCursor: string;
  readonly version: number;
}

export interface WildFisheryProductionBindingRepository {
  ensureAtomically(input: {
    readonly assignmentId: string;
    readonly sourceId: string;
    readonly farmId: FarmId;
    readonly actorId: ActorId;
    readonly actorJobId: JobId;
    readonly workAreaId: WorkAreaId;
    readonly outputItemDefinitionId: string;
    readonly ratePerHour: number;
    readonly initialStock: number;
    readonly activatedAt: string;
  }): Promise<WildFisheryProductionBinding>;
}

/**
 * One roll in `[0, 1)`.
 *
 * Shared by every system that has to choose an outcome the server owns: fishing's catch and mining's
 * drop both draw from this one port, so production has one entropy source and a test has one place to
 * inject a script.
 */
export interface RandomPort {
  roll(): number;
}

/** The fishing-specific name, kept so V15.1 call sites keep reading the way they were written. */
export type FishingRandomPort = RandomPort;

export interface FishingActionRepository {
  /** Pin server entropy before payout so a failed settlement cannot reroll this attempt. */
  pinRoll(action: FishingAction, draw: () => number): Promise<number>;
  findById(actionId: FishingActionId): Promise<FishingAction | null>;
  /** The actor's one live attempt, if any. Indexed, and the only read a refresh performs. */
  findActiveByActor(actorPlayerId: PlayerId): Promise<FishingAction | null>;
  create(action: FishingAction, idempotency: IdempotencyRecord): Promise<void>;
}

export interface FishingSettlementRepository {
  settleFishingAtomically(
    action: FishingAction,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord,
    stockConsumption?: {
      readonly zoneKind: string;
      readonly zoneId: string;
      readonly spotId: string;
      readonly expectedStock: number;
      readonly expectedLastRegeneratedAt: string | null;
      readonly expectedVersion: number | null;
      readonly stock: number;
      readonly lastRegeneratedAt: string;
      readonly nextVersion: number;
    }
  ): Promise<void>;
  cancelFishingAtomically(action: FishingAction, idempotency: IdempotencyRecord): Promise<void>;
}

/**
 * Resource nodes: the generic gather lifecycle's ports.
 *
 * The catalogue holds the static half (definitions, placements, drop tables); the two repositories
 * hold the mutable half (node availability, gather attempts). Mining uses them today and forestry
 * reuses them with `verb: "CHOP"` and a tree model - nothing in these shapes names a rock.
 */
export interface ResourceIdGenerator {
  newResourceActionId(): ResourceActionId;
}

export interface ResourceDefinitionView {
  readonly id: string;
  readonly displayNameKey: string;
  readonly verb: ResourceVerb;
  readonly actionSeconds: number;
  readonly regenerationSeconds: number;
  readonly productionUnitsPerHour: number;
  readonly settlementMode?: "REGENERATING_NODE" | "CONTINUOUS_LABOR";
  readonly dropTableId: string;
  readonly xp: number;
  readonly modelId: string;
  /** What a depleted node draws instead, when the type has a better answer than shrinking. */
  readonly depletedModelId: string | null;
  readonly requiredLevel: number;
}

/** One authored placement: which definition stands where, in which zone. */
export interface ResourceNodePlacement {
  readonly id: string;
  readonly definitionId: string;
  readonly zoneKind: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly interactionRadiusTiles: number;
}

export interface ResourceDropTableView {
  readonly id: string;
  readonly entries: readonly ResourceDropEntry[];
}

export interface ResourceCataloguePort {
  listDefinitions(): readonly ResourceDefinitionView[];
  listNodes(): readonly ResourceNodePlacement[];
  findDefinition(id: string): ResourceDefinitionView | null;
  findNode(id: string): ResourceNodePlacement | null;
  findDropTable(id: string): ResourceDropTableView | null;
}

export interface ResourceNodeStateRepository {
  /** Every state row for one zone. Bounded by the primary key, never a scan of the world. */
  listByZone(zoneId: string): Promise<readonly ResourceNodeState[]>;
  find(zoneId: string, nodeId: string): Promise<ResourceNodeState | null>;
}

export interface ResourceProductionBinding {
  readonly assignmentId: string;
  readonly sourceId: string;
  readonly farmId: FarmId;
  readonly actorJobId: JobId;
  readonly ratePerHour: number;
  readonly settlementCursor: string;
  readonly version: number;
}

export interface ResourceProductionBindingRepository {
  ensureAtomically(input: {
    readonly assignmentId: string;
    readonly sourceId: string;
    readonly sourceFamily: "FORESTRY" | "MINING";
    readonly outputItemDefinitionId: string;
    readonly farmId: FarmId;
    readonly actorId: ActorId;
    readonly actorJobId: JobId;
    readonly workAreaId: WorkAreaId;
    readonly ratePerHour: number;
    readonly activatedAt: string;
  }): Promise<ResourceProductionBinding>;
}

export interface ResourceActionRepository {
  /** Pin selection and quantity together, independently of the payout transaction. */
  pinRolls(action: ResourceAction, draw: () => number): Promise<readonly [number, number]>;
  findById(actionId: ResourceActionId): Promise<ResourceAction | null>;
  findActiveByActor(actorPlayerId: PlayerId): Promise<ResourceAction | null>;
  create(action: ResourceAction, idempotency: IdempotencyRecord): Promise<void>;
}

export interface ResourceSettlementRepository {
  settleResourceAtomically(
    action: ResourceAction,
    addition: InventoryAddition,
    award: XpAward,
    nodeState: ResourceNodeState,
    idempotency: IdempotencyRecord
  ): Promise<void>;
  cancelResourceAtomically(action: ResourceAction, idempotency: IdempotencyRecord): Promise<void>;
}

/** Mints the identifier of one player construction. */
export interface ConstructionIdGenerator {
  newConstructionId(): ConstructionId;
}

/**
 * A placement waiting to be written: the row a player built, and the wallet mutation that pays for it.
 *
 * They travel together because they are one transaction. A repository that writes one without the
 * other is a repository that can give away a building or take gold for nothing.
 */
export interface ConstructionPlacement {
  readonly construction: ConstructionInstance;
  readonly economy: EconomyMutation;
  /**
   * The tile rows this placement needs and does not have yet, created with it for free.
   *
   * V14.5.2: the natural Home Island is already the player's land, so a footprint on valid natural
   * ground is not refused for missing rows - the settlement writes them. The only money is the
   * construction's own price in `economy`.
   */
  readonly tiles: readonly FarmTile[];
}

/**
 * The tile row a plant expects, or the row it needs created.
 *
 * `EXISTING` means the client was looking at a tile the server already had, and the write is guarded
 * on that version. `CREATE` means the cell is fresh natural land with no row yet - the natural Home
 * Island is free to use (V14.5.2) - so the settlement writes the row, with no land charge, so the
 * crop's foreign key and the tile-state checks keep working.
 */
export type TilePlan =
  | { readonly kind: "EXISTING"; readonly version: number }
  | { readonly kind: "CREATE"; readonly tile: FarmTile };

/**
 * An object being moved or turned, and the version the caller believes it is on.
 *
 * The version is not decoration: the repository writes only when the row still has it, so a move
 * built on a stale read is refused rather than silently overwriting somebody else's change.
 */
export interface ConstructionRelocation {
  readonly construction: ConstructionInstance;
  readonly expectedVersion: number;
  /**
   * The tile rows the destination needs and the farm does not have yet, created with the write, free.
   *
   * A move or a restore onto valid natural land is not refused for missing rows (V14.5.2); the
   * settlement writes them so the crop/construction cross-occupancy triggers keep working.
   */
  readonly tiles: readonly FarmTile[];
}

/**
 * An object being taken down, and the money that comes back for it.
 *
 * `refund` is null when the asset's policy returns nothing - which is a real policy, not a missing
 * value - and the removal then has no ledger row at all.
 */
export interface ConstructionRemoval {
  /** The farm the object stands on: the delete is filtered by it as well as by the version. */
  readonly farmId: FarmId;
  readonly constructionId: ConstructionId;
  readonly expectedVersion: number;
  readonly refund: EconomyMutation | null;
}

/**
 * A farm's starter arrangement, written in one batch.
 *
 * `version` travels with it because the two must succeed together: the rows and the stamp that says
 * the farm has been given them. A repository that wrote one without the other would either seed the
 * island twice or leave a farm that never gets it.
 */
export interface ConstructionSeed {
  readonly farmId: FarmId;
  readonly version: number;
  readonly constructions: readonly ConstructionInstance[];
  readonly seededAt: string;
}

/**
 * What the island's geography says about a tile.
 *
 * A port rather than an import, because `packages/application` owns rules and `packages/game-data`
 * owns the world: the host hands the one implementation in, exactly as it hands the catalogue and the
 * progression curve in. Until V13.3 the placement rule inferred "an owned tile is land" from the
 * farm's own rows; it can now be told what the ground actually is, which is what lets it refuse water,
 * a beach or protected ground for the *physical* reason rather than by accident of ownership.
 */
export interface TileTerrainLookup {
  classify(tile: { readonly x: number; readonly y: number }): {
    readonly terrain: "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";
    readonly shallowWater: boolean;
    readonly protectedGround: boolean;
  };
}

/**
 * Where the island lets a farm own land.
 *
 * A port for the same reason `TileTerrainLookup` is one: `packages/application` owns the rules and
 * `packages/game-data` owns the island, so the host hands in the island's own answer about a tile.
 * "Developable" is the ground the player is allowed to turn into a farm at all - dry, inside the
 * island, and not ground the island keeps for itself - and it is deliberately *not* ownership, which
 * is what lets a purchase be refused for the reason it is actually refused.
 */
export interface LandSaleLookup {
  isDevelopable(tile: { readonly x: number; readonly y: number }): boolean;
}

/**
 * The one write boundary for player construction.
 *
 * `listBounds` is what the collision rule reads: the rectangles already covered on this farm, so a
 * new footprint can be refused before a row is written. `placeAtomically` writes the construction, the
 * wallet movement, its ledger row, and the idempotency receipt as one batch - and the database itself
 * refuses a second construction on the same ground, so two racing placements cannot both win.
 *
 * `relocateAtomically` and `removeAtomically` are the editing half, and they are guarded the same way:
 * the object's own cells are excluded from the overlap rule, the destination cells are checked against
 * ownership and the crop/tree cross-occupancy triggers, and the receipt is written only if the effect
 * it names actually happened.
 */
export interface ConstructionRepository {
  findById(id: ConstructionId): Promise<ConstructionInstance | null>;
  listByFarm(farmId: FarmId): Promise<readonly ConstructionInstance[]>;
  /** The rectangles of the objects *standing* on the farm: stored objects occupy no ground. */
  listBounds(farmId: FarmId): Promise<readonly CellBounds[]>;
  placeAtomically(placement: ConstructionPlacement, idempotency: IdempotencyRecord): Promise<void>;
  relocateAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void>;
  removeAtomically(removal: ConstructionRemoval, idempotency: IdempotencyRecord): Promise<void>;
  /**
   * Writes the starter rows and the farm's seed version together, and writes *nothing* if the farm
   * already has this version. Returns how many rows it actually created.
   */
  seedAtomically(seed: ConstructionSeed): Promise<number>;
  /**
   * Moving one object between the world and storage: the same row, a new state.
   *
   * One method for both directions because they are one statement - `state`, `stored_at` and the
   * rectangle change together or not at all - and because a second method would be a second place for
   * the version predicate to be forgotten.
   */
  setStoredAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void>;
}

/**
 * The server-owned lifecycle of an editable forestry construction. The construction row remains the
 * stable identity and the lifecycle row remains independent from its position/state, so moving or
 * storing a tree cannot reset a stump into a free log source.
 */
export interface ForestryConstructionState {
  readonly constructionId: ConstructionId;
  readonly farmId: FarmId;
  readonly entryId: string;
  readonly lastChoppedAt: string | null;
  readonly regenerationAt: string | null;
  readonly version: number;
}

export interface ForestryConstructionStateRepository {
  listByFarm(farmId: FarmId): Promise<readonly ForestryConstructionState[]>;
  findByConstruction(farmId: FarmId, constructionId: ConstructionId): Promise<ForestryConstructionState | null>;
  settleChopAtomically(
    state: ForestryConstructionState,
    nextState: ForestryConstructionState,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

export interface ForestryConstructionDefinition {
  readonly entryId: string;
  readonly dropItemDefinitionId: string;
  readonly dropQuantity: number;
  readonly regenerationSeconds: number;
  readonly xp: number;
}

export interface ForestryConstructionDefinitionRepository {
  findByEntryId(entryId: string): ForestryConstructionDefinition | null;
}

/** The catalogue, as the placement rules need it: what may be built, and what it costs. */
export interface ConstructionDefinitionRepository {
  findById(entryId: string): ConstructionDefinition | null;
}

export interface CropInstanceRepository {
  findById(id: CropInstanceId): Promise<CropInstance | null>;
  findAtTile(farmId: FarmId, x: number, y: number): Promise<CropInstance | null>;
  listByFarm(farmId: FarmId): Promise<readonly CropInstance[]>;
  /**
   * Plants one crop, spends exactly one seed, and finalizes idempotency in a single transaction.
   *
   * The removal is prepared by `InventoryService` and the expected inventory row is the state the
   * caller read, so a concurrent consumption either applies against that state or rolls the whole
   * planting back. There is no separate "consume a seed" write path.
   */
  plantAtomically(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void>;
  /**
   * The same planting settlement, paid for out of the actor's **cargo** instead of the Warehouse.
   *
   * Identical in every other respect: the same tile plan, the same crop row, the same crop-state
   * guard, the same receipt, and the same one-seed-per-crop rule. Only the container the seed leaves
   * differs, which is what makes an Auto plant physically honest rather than a remote warehouse spend.
   */
  plantFromCargoAtomically(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: CargoRemoval,
    expectedCargo: ActorCargoItem,
    idempotency: IdempotencyRecord
  ): Promise<void>;
  /**
   * Deletes one crop and finalizes idempotency in a single transaction.
   *
   * Uprooting is a pure removal: no inventory, currency, or experience is written, so the only two
   * states that have to agree are the crop row and the receipt that says it is gone.
   */
  removeAtomically(
    crop: CropInstance,
    expectedCropVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

/**
 * A starter package grant: the player it belongs to, the receipt key it is filed under, the seed
 * credit, the currency credit, and the ledger identity that credit settles under.
 *
 * `transactionId` and `requestId` are prepared by the use case through the centralized economy
 * boundary, exactly as a shop purchase's are, and `itemDefinitionId`/`itemQuantity` are prepared
 * through the centralized inventory boundary. Nothing here is a client input.
 */
export interface StarterGrant {
  readonly playerId: PlayerId;
  readonly grantKey: string;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly itemQuantity: number;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly goldAmount: number;
  readonly transactionId: EconomyTransactionId;
  readonly requestId: string;
  readonly timestamp: string;
}

/**
 * The one-time starter package receipt.
 *
 * The receipt, the seed credit, the wallet, and the ledger row are written together in one
 * statement, and `(player, grant key)` is the primary key, so a repeated call -- a second farm, a
 * replayed sign-in, a retried request, a concurrent pair -- finds the receipt and credits nothing.
 * Returns whether this call is the one that created the receipt.
 */
export interface StarterGrantRepository {
  grantStarterPackageAtomically(grant: StarterGrant): Promise<boolean>;
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
  /**
   * The same harvest settlement, with the reward landing in the actor's **cargo**.
   *
   * One settlement row, one reward rule, one crop-state guard, one XP award, one receipt - the same
   * everywhere except the container the goods arrive in. The cargo capacity trigger is the authority
   * on whether they fit, so a harvest that would overflow is refused and the crop stays in the ground
   * rather than paying out goods that cannot be carried.
   */
  settleHarvestIntoCargoAtomically(
    crop: CropInstance,
    grant: CargoGrant,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

/**
 * The tree plant and removal boundaries: one tile's occupant, and the receipt that says so.
 *
 * Planting consumes exactly one sapling and inserts exactly one tree in the same transaction, the
 * same shape as planting a crop. Removal deletes one tree and records one receipt, with no inventory,
 * currency, or experience written at all: a removed tree is simply gone.
 */
export interface TreeInstanceRepository {
  findById(id: TreeInstanceId): Promise<TreeInstance | null>;
  findAtTile(farmId: FarmId, x: number, y: number): Promise<TreeInstance | null>;
  listByFarm(farmId: FarmId): Promise<readonly TreeInstance[]>;
  plantAtomically(
    tree: TreeInstance,
    tile: TilePlan,
    saplingRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void>;
  removeAtomically(
    tree: TreeInstance,
    expectedTreeVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void>;
  /** Moves, turns, stores, or restores one tree row and its receipt in one transaction. */
  manageAtomically(
    tree: TreeInstance,
    expectedTreeVersion: number,
    tile: TilePlan | null,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

/**
 * The one write boundary for harvesting a tree's cycle.
 *
 * The receipt identifies the cycle by the revision the tree was at, so a repeated or concurrent
 * harvest of one cycle can settle exactly once, and the fruit, the experience award, the harvest
 * anchor, and the revision advance together or not at all.
 */
export interface TreeHarvestSettlementRepository {
  settleTreeHarvestAtomically(
    tree: TreeInstance,
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
  /**
   * A shop purchase whose destination is the buyer's cargo instead of the warehouse.
   *
   * Deliberately the *same* settlement: the ledger row, the wallet balance and version it must move
   * to, and the receipt are identical to an ordinary buy; only the item destination differs. That is
   * what keeps a supply purchase economically indistinguishable from any other purchase - it is not a
   * second economy, and it needs no new ledger reason.
   */
  settleSupplyIntoCargoAtomically(
    economy: EconomyMutation,
    purchase: CargoPurchase,
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

/**
 * The one write boundary for buying land: the wallet mutation, its ledger row, every new tile, and
 * the idempotency record, all or nothing.
 *
 * A tile row is the farm's state on a cell, so this settlement is what records the plot the player
 * bought. The tiles are inserted rather than a bound being widened, which is what keeps the crop
 * foreign key and the construction triggers working unchanged.
 *
 * V14.5.2 deprecates this as gameplay: the natural Home Island is already the player's to develop,
 * and no control sells plots any more. The settlement stays for compatibility with existing saves,
 * tests and the legacy routes.
 */
export interface FarmExpansionRepository {
  expandFarmAtomically(
    economy: EconomyMutation,
    tiles: readonly FarmTile[],
    idempotency: IdempotencyRecord
  ): Promise<void>;
  /**
   * Buys some cells of ground: the wallet mutation, its ledger row, every new tile, and the
   * idempotency record, all or nothing.
   *
   * The same write boundary as a plot purchase, with a cohort the caller chose instead of a whole
   * plot. The database's own `farm_tiles` primary key refuses a cell that already exists, so two
   * racing purchases of the same cell cannot both be charged.
   */
  buyLandCellsAtomically(
    economy: EconomyMutation,
    tiles: readonly FarmTile[],
    idempotency: IdempotencyRecord
  ): Promise<void>;
}

/**
 * The player-named work areas of one farm.
 *
 * The area rows and their member cells are separate reads on purpose: listing areas shows names, the
 * editor loads membership, and a list must never drag every cell of every area with it. Neither read
 * is global - both are bounded to one farm's or one area's own rows.
 */
export interface WorkAreaRepository {
  /**
   * Every area of one farm, in a stable order, as one bounded range scan of its own rows.
   *
   * The count travels with the row so a management list never opens every area's cells to show a
   * number.
   */
  listByFarm(farmId: FarmId): Promise<readonly WorkAreaListEntry[]>;
  findById(id: WorkAreaId): Promise<WorkArea | null>;
  /** One area's member cells. The membership read, never part of a farm list. */
  listCells(id: WorkAreaId): Promise<readonly WorkAreaCell[]>;
  /**
   * The area, its first cells, and the receipt that claims them, written together or not at all.
   *
   * The three travel as one transaction because a create must be idempotent: a retried request has to
   * find the receipt and the area it describes, or neither.
   */
  createAtomically(
    area: WorkArea,
    cells: readonly WorkAreaCell[],
    idempotency: IdempotencyRecord
  ): Promise<void>;
  /** Renames one area if it is still at `expectedVersion`; false when a race moved it first. */
  renameAtomically(area: WorkArea, expectedVersion: number): Promise<boolean>;
  /**
   * Replaces one area's membership if it is still at `expectedVersion`.
   *
   * Replace, not patch: the editor sends the set it wants, and the write is delete-then-insert inside
   * one transaction guarded by the version. Two editors on one area cannot interleave into a set
   * neither of them drew.
   */
  replaceCellsAtomically(
    area: WorkArea,
    cells: readonly WorkAreaCell[],
    expectedVersion: number
  ): Promise<boolean>;
  /** Deletes one area - its member cells go with it - if it is still at `expectedVersion`. */
  deleteAtomically(id: WorkAreaId, expectedVersion: number): Promise<boolean>;
}

/**
 * What the ground under a cell can be worked for, in the work-area vocabulary.
 *
 * A port for the same reason `TileTerrainLookup` is one: the application owns the rule and
 * `packages/game-data` owns the island, so the host hands the one implementation in. It reports
 * capabilities, never permission - a cell that supports `FARM` says nothing about who may name it.
 */
export interface WorkAreaGroundLookup {
  capabilitiesAt(tile: { readonly x: number; readonly y: number }): readonly WorkAreaGroundCapability[];
}

/** Mints the identifier of one work area. */
export interface WorkAreaIdGenerator {
  newWorkAreaId(): WorkAreaId;
}

/** One row of a farm's work-area list: the area, and how many cells it holds. */
export interface WorkAreaListEntry {
  readonly area: WorkArea;
  readonly cellCount: number;
}

/**
 * The entities that can perform jobs.
 *
 * An actor is not a player: `owner_player_id` is identity, and the actor's own id is what a job
 * references. Today a player has exactly one - their Main Character - and the database's partial
 * unique index is what makes that true under concurrency rather than a check somebody has to remember.
 */
export interface ActorRepository {
  /** The player's Main Character, or null when this save predates the actor spine. */
  findMainCharacter(ownerPlayerId: PlayerId): Promise<Actor | null>;
  /**
   * Creates the player's Main Character if it does not exist, and returns whichever row won.
   *
   * Idempotent by construction: the insert ignores a conflict on `(owner_player_id)` for
   * MAIN_CHARACTER rows, so a repeated login, a second tab, a refreshed guest session or two
   * simultaneous bootstraps all end with the same actor, and the loser reads the winner's row back.
   */
  ensureMainCharacter(actor: Actor): Promise<Actor>;
  findById(id: ActorId): Promise<Actor | null>;
  /**
   * Moves the actor between player control and Auto, under the version the caller read.
   *
   * Returns false when the actor has moved on, so two tabs toggling Auto converge on one outcome
   * rather than overwriting each other. It changes control and nothing else: no cargo, no assignment,
   * no economy.
   */
  setControlModeAtomically(actor: Actor, expectedVersion: number): Promise<boolean>;
}

/** One configured job's new place in its actor's order. */
export interface JobOrderEntry {
  readonly id: JobId;
  readonly priority: number;
  readonly updatedAt: string;
}

/**
 * The configured jobs of one actor.
 *
 * Every read is bounded to one actor's own rows in priority order - the query a future executor asks,
 * and never a scan of the job table. `countByWorkArea` exists so a work area's delete can refuse
 * *before* the database's own foreign key would, and say why.
 */
export interface ActorJobRepository {
  listByActor(actorId: ActorId): Promise<readonly ActorJob[]>;
  listByFarm(farmId: FarmId): Promise<readonly ActorJob[]>;
  findById(id: JobId): Promise<ActorJob | null>;
  /** How many jobs name this work area, for the delete guard. One indexed range scan. */
  countByWorkArea(workAreaId: WorkAreaId): Promise<number>;
  createAtomically(job: ActorJob, idempotency: IdempotencyRecord): Promise<void>;
  updateTargetAtomically(job: ActorJob, expectedVersion: number): Promise<boolean>;
  setEnabledAtomically(job: ActorJob, expectedVersion: number): Promise<boolean>;
  /**
   * Rewrites one actor's whole order under the actor's own version guard.
   *
   * The guard is the actor's version, so two tabs reordering at once cannot interleave into an order
   * neither of them asked for, and the loser is told the world moved. All priorities are written in
   * the one batch, which is what keeps them dense and duplicate-free.
   */
  reorderAtomically(
    actorId: ActorId,
    expectedActorVersion: number,
    ordered: readonly JobOrderEntry[],
    /** The actor's own new `updated_at`, which an empty order still needs. */
    updatedAt: string
  ): Promise<boolean>;
  /**
   * Deletes one job and renumbers the actor's survivors densely, in one transaction.
   *
   * The renumbering is what keeps "priority" meaning position: without it, deleting the first job
   * would leave a gap for a new one to fall into and two jobs could share a priority.
   */
  deleteAtomically(actorId: ActorId, id: JobId, expectedVersion: number): Promise<boolean>;
  /** Sets one assignment's Auto Purchase policy, under the version the caller read. */
  setAutoPurchaseAtomically(job: ActorJob, expectedVersion: number): Promise<boolean>;
  /**
   * The assignment's emergency-funding whitelist, in priority order.
   *
   * One bounded read of the assignment's own rows, and only the planner asks for it - and only when
   * Gold is actually short. Returns `{ itemDefinitionId, priority }` in ascending priority.
   */
  listFundingItems(jobId: JobId): Promise<readonly AutoFundingItem[]>;
  /**
   * Writes the funding flag and the whole ordered whitelist as one guarded change.
   *
   * The flag lives on the assignment row and the items live in their own table, so they move together
   * or not at all: a stale caller cannot leave an enabled policy with the wrong list. Returns false
   * when the version the caller read has moved on.
   */
  setFundingAtomically(job: ActorJob, items: readonly string[], expectedVersion: number): Promise<boolean>;
}

/** One whitelisted funding item, as stored. Priority 1 sells first. */
export interface AutoFundingItem {
  readonly itemDefinitionId: string;
  readonly priority: number;
}

/** Mints the identifier of one actor. */
export interface ActorIdGenerator {
  newActorId(): ActorId;
}

/**
 * Where an Auto-driven actor is, and where it is walking to.
 *
 * One row per actor, and only ever written by the executor. It exists so the server can refuse a
 * distant action without persisting a per-frame position: a walk is recorded as "left this anchor,
 * arrives at this time", and the next action may only settle once the server's clock has passed that
 * time. `saveAtomically` is guarded on the version the caller read, so an arrival and a new departure
 * cannot overwrite each other.
 */
export interface AutoTravelRepository {
  find(actorId: ActorId): Promise<AutoTravelState>;
  /** Writes the new state if the row is still at `expectedVersion` (0 for a row that does not exist). */
  saveAtomically(
    actorId: ActorId,
    expectedVersion: number,
    next: AutoTravelState,
    updatedAt: string
  ): Promise<boolean>;
  /** Renews only the finite Auto lease; it never changes the actor's location or watermark. */
  renewLeaseAtomically?(actorId: ActorId, now: string, leaseUntil: string): Promise<boolean>;
}

/** Mints the identifier of one job. */
export interface JobIdGenerator {
  newJobId(): JobId;
}

/**
 * Where a container's capacity comes from.
 *
 * A port for the same reason `TileTerrainLookup` is one: the application owns the rule ("nothing may
 * exceed its capacity") and `packages/game-data` owns the numbers, so the host hands the one
 * implementation in. Returning null means "this kind of actor has no capacity defined yet", which is
 * a refusal rather than a zero.
 */
export interface CargoCapacityLookup {
  forActorKind(kind: string): number | null;
}

/** One authoritative grant to an actor's cargo: a validated item, a positive quantity, a time. */
export interface CargoGrant {
  readonly actorId: ActorId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly timestamp: string;
}

/** One stack an unload is taking out of cargo. */
export interface CargoUnloadStack {
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
}

/**
 * One all-or-nothing unload: the cargo that leaves, and the warehouse rows that arrive.
 *
 * They travel together because they are one transaction. `additions` are prepared through the
 * centralized inventory boundary, and the destination's own capacity guard is the authority on
 * whether they fit - so a repository that writes one without the other cannot exist.
 */
export interface CargoUnload {
  readonly actorId: ActorId;
  /** The cargo container version the caller read; the guard for the whole transfer. */
  readonly expectedCargoVersion: number;
  readonly stacks: readonly CargoUnloadStack[];
  readonly additions: readonly InventoryAddition[];
  readonly timestamp: string;
}

/**
 * One Warehouse -> Cargo load.
 *
 * The expected inventory state travels with it because the subtraction must be scoped to exactly the
 * row the caller read: a row sold or consumed out from under the request must fail the whole load
 * rather than credit cargo from a subtraction that never happened.
 */
export interface CargoLoad {
  readonly actorId: ActorId;
  /** The player whose warehouse is the source - the farm's owner, never a client claim. */
  readonly playerId: PlayerId;
  /** The cargo container version the caller read; the guard for the whole transfer. */
  readonly expectedCargoVersion: number;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly expectedInventoryQuantity: number;
  readonly expectedInventoryVersion: number;
  readonly timestamp: string;
}

/** The cargo side of one supply purchase, for the settlement that also debits gold. */
export interface CargoPurchase {
  readonly actorId: ActorId;
  readonly expectedCargoVersion: number;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  /** What the actor carried before, and that row's version (0 and 0 when it carried none). */
  readonly expectedQuantity: number;
  readonly expectedVersion: number;
  readonly timestamp: string;
}

/**
 * Actor cargo: what one actor is physically carrying.
 *
 * Reads are bounded to the actor's own rows, which are themselves bounded by the container's capacity.
 * Every mutation is a single transaction with the receipt that claims it, and the destination's
 * warehouse guard runs inside that same transaction, so a transfer either moves every item or moves
 * none.
 */
export interface CargoRepository {
  listByActor(actorId: ActorId): Promise<readonly ActorCargoItem[]>;
  usedCapacity(actorId: ActorId): Promise<number>;
  /**
   * Writes one authoritative grant, refusing anything that would exceed the container.
   *
   * The capacity guard trigger inside the transaction is the authority; the application pre-checks so
   * the caller gets a clean `CARGO_FULL` rather than a raw database error.
   */
  grantAtomically(grant: CargoGrant): Promise<void>;
  /**
   * Moves every listed stack out of cargo and into the warehouse, or nothing at all.
   *
   * Returns false when the cargo version the caller read has moved on (a stale unload, which is
   * refused rather than applied), and throws when the destination refuses the whole transfer - in
   * which case the cargo is untouched and the receipt is not written.
   */
  unloadAllAtomically(unload: CargoUnload, idempotency: IdempotencyRecord): Promise<boolean>;
  /**
   * Moves one stack out of the warehouse and into cargo, or nothing at all.
   *
   * Returns false when the cargo version the caller read has moved on, and throws when the load
   * cannot be satisfied - in which case the warehouse is untouched and no receipt is written.
   */
  loadAllAtomically(load: CargoLoad, idempotency: IdempotencyRecord): Promise<boolean>;
}
