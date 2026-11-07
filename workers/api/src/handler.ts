import {
  CreateFarm,
  CropStateProjector,
  GetFarmCrops,
  GetFarm,
  GetInventory,
  GetProgression,
  HarvestCrop,
  HarvestCropAreaGroup,
  InventoryService,
  ListPlots,
  ListCropDefinitions,
  ListFarmTiles,
  ListFarmTrees,
  ListTreeDefinitions,
  PlantCrop,
  PlantCropAreaGroup,
  PlantTree,
  PlantTreeAreaGroup,
  PlaceConstruction,
  ListFarmConstructions,
  RelocateConstruction,
  RemoveConstruction,
  RestoreConstruction,
  SeedStarterWorld,
  StoreConstruction,
  HarvestTree,
  HarvestTreeAreaGroup,
  RemoveTree,
  ManageTree,
  TreeStateProjector,
  UprootCrop,
  ApplicationError,
  BuyItem,
  CancelFishing,
  EconomyService,
  GetActiveFishing,
  GetActiveResourceAction,
  ListFishingCatalogue,
  ListResourceNodes,
  CancelResourceAction,
  SettleResourceAction,
  StartResourceAction,
  SellItem,
  SettleFishing,
  StartFishing,
  ExpandFarm,
  QuoteLandCells,
  BuyLandCells,
  CreateWorkArea,
  DeleteWorkArea,
  GetWorkArea,
  ListWorkAreas,
  RenameWorkArea,
  ReplaceWorkAreaCells,
  CreateJob,
  DeleteJob,
  ReorderJobs,
  AdvanceAuto,
  ReconcileActorAuto,
  FundAndPurchaseSupply,
  ResolveAutoPlan,
  type JobView,
  ResolveWorkers,
  SetActorControl,
  SetAssignmentPolicy,
  SetJobEnabled,
  UpdateJobTarget,
  type ActorContext,
  type AuthenticationPort,
  type Clock,
  type CropDefinitionRepository,
  type CropIdGenerator,
  type CurrencyDefinitionRepository,
  type EconomyTransactionIdGenerator,
  type IdGenerator,
  type ItemDefinitionRepository,
  type PayloadFingerprint,
  type PlotDefinitionRepository,
  type ConstructionDefinitionRepository,
  type PlotView,
  type ShopEntryRepository,
  type TreeDefinitionRepository,
  type TreeIdGenerator
  ,type ConstructionIdGenerator
  ,type StarterWorldDefinition
  ,type TileTerrainLookup
  ,type LandSaleLookup
  ,type FishingCataloguePort
  ,type FishingIdGenerator
  ,type FishingRandomPort
  ,type FishView
  ,type FishingActionView
  ,type FishingSpotView
  ,type RandomPort
  ,type ResourceActionView
  ,type ResourceCataloguePort
  ,type ResourceIdGenerator
  ,type ResourceNodeView
  ,GetWarehouseStatus
  ,UpgradeWarehouse
  ,type WarehouseTierRepository
  ,type WarehouseStatusView
  ,type WorkAreaGroundLookup
  ,type WorkAreaIdGenerator
  ,type WorkAreaView
  ,type ActorIdGenerator
  ,type JobIdGenerator
  ,type JobTargetCatalogue
  ,type CargoCapacityLookup
  ,type CargoView
  ,type AutoPlanView
  ,GetActorCargo
  ,UnloadCargo
  ,LoadCargo
  ,PurchaseSupplyIntoCargo
  ,CargoService
  ,SettleProductionAssignment
  ,ReconcileFarmProduction
  ,EnsureOrchardProductionBinding
  ,EnsureResourceProductionBinding
  ,ResolveResourceProductionContext
  ,EnsureWildFisheryProductionBinding
  ,ResolveWildFisheryProductionContext
  ,MineResourceIntoCargoAuto
  ,GetOrchardVisualSnapshot
  ,ChopForestryConstruction
  ,projectForestryConstructionState
  ,ListAquaculturePonds
  ,StockAquaculturePond
  ,HarvestAquaculturePond
  ,WithdrawAquaculturePond
  ,NeighborService
  ,type NeighborSnapshot
  ,type AquacultureDefinition
  ,type AquaculturePondView
  ,type ForestryConstructionDefinitionRepository
  ,type ForestryConstructionState
  ,type AutoStepView
} from "@happy-farm/application";
import {
  CreateFarmRequestSchema,
  FarmIdSchema,
  CropInstanceIdSchema,
  TreeInstanceIdSchema,
  HarvestCropRequestSchema,
  HarvestCropAreaRequestSchema,
  BuyItemRequestSchema,
  ExpandFarmRequestSchema,
  QuoteLandCellsRequestSchema,
  BuyLandCellsRequestSchema,
  HarvestTreeRequestSchema,
  HarvestTreeAreaRequestSchema,
  PlantTreeRequestSchema,
  PlantTreeAreaRequestSchema,
  RemoveTreeRequestSchema,
  MoveTreeRequestSchema,
  RotateTreeRequestSchema,
  StoreTreeRequestSchema,
  RestoreTreeRequestSchema,
  SellItemRequestSchema,
  PlantCropRequestSchema,
  PlantCropAreaRequestSchema,
  PlaceConstructionRequestSchema,
  ConstructionIdSchema,
  MoveConstructionRequestSchema,
  RotateConstructionRequestSchema,
  RemoveConstructionRequestSchema,
  StoreConstructionRequestSchema,
  RestoreConstructionRequestSchema,
  UprootCropRequestSchema,
  StartFishingRequestSchema,
  SettleFishingRequestSchema,
  CancelFishingRequestSchema,
  StartResourceActionRequestSchema,
  SettleResourceActionRequestSchema,
  CancelResourceActionRequestSchema,
  type FishingActionDTO,
  type FishingSpotDTO,
  type FishDefinitionDTO,
  type StartFishingResponse,
  type SettleFishingResponse,
  type ResourceActionDTO,
  type ResourceNodeDTO,
  type StartResourceActionResponse,
  type SettleResourceActionResponse,
  type ApiFailure,
  type ApiSuccess,
  type ErrorCode,
  type FarmDTO,
  type FarmTileDTO,
  type FarmMemberDTO,
  type CropStateDTO,
  type CropDefinitionDTO,
  type HarvestResultDTO,
  type HarvestCropAreaGroupResponse,
  type UprootCropResponse,
  type TreeHarvestResultDTO,
  type HarvestTreeAreaGroupResponse,
  type RemoveTreeResponse,
  type InventoryEntryDTO,
  type PlayerProgressionDTO,
  type XpAwardDTO,
  type BuyItemResultDTO,
  type SellItemResultDTO,
  type ShopEntryDTO,
  type WalletDTO
  ,type PlotDTO,
  type ExpandFarmResultDTO
  ,type LandQuoteDTO,
  type BuyLandCellsResultDTO
  ,type TreeDefinitionDTO,
  type TreeStateDTO,
  type BuildCatalogEntryDTO
  ,type ConstructionDTO
  ,type RemoveConstructionResponse
  ,type WorldObjectDefinitionDTO
  ,type GetSessionResponse
  ,type WarehouseStatusDTO
  ,UpgradeWarehouseRequestSchema
  ,WorkAreaIdSchema
  ,CreateWorkAreaRequestSchema
  ,RenameWorkAreaRequestSchema
  ,ReplaceWorkAreaCellsRequestSchema
  ,DeleteWorkAreaRequestSchema
  ,type WorkAreaSummaryDTO
  ,type WorkAreaDTO
  ,JobIdSchema
  ,CreateJobRequestSchema
  ,UpdateJobTargetRequestSchema
  ,SetJobEnabledRequestSchema
  ,ReorderJobsRequestSchema
  ,DeleteJobRequestSchema
  ,type ActorDTO
  ,type JobDTO
  ,UnloadCargoRequestSchema
  ,LoadCargoRequestSchema
  ,SupplyPurchaseRequestSchema
  ,type SupplyPurchaseResultDTO
  ,type CargoDTO
  ,SetActorControlRequestSchema
  ,SetAssignmentPolicyRequestSchema
  ,AutoStepRequestSchema
  ,type AutoReconcileDTO
  ,type AutoPlanDTO
  ,type ActorControlDTO
  ,type AutoStepDTO
  ,ProductionAssignmentIdSchema
  ,SettleProductionAssignmentRequestSchema
  ,type SettleProductionAssignmentResponse
  ,ReconcileFarmProductionRequestSchema
  ,type ReconcileFarmProductionResponse
  ,AquaculturePondCommandSchema
  ,ConstructionIdSchema as AquacultureConstructionIdSchema
  ,type AquaculturePondDTO
  ,ForestryConstructionChopRequestSchema
  ,type ForestryConstructionStateDTO
  ,type ForestryConstructionChopResponse
  ,NeighborTravelRequestSchema
  ,NeighborTalkRequestSchema
  ,type NeighborSnapshotDTO
} from "@happy-farm/contracts";
import { listBuildCatalog } from "./build-catalog";
import { gameDataAquacultureDefinition, gameDataAutoAnchors, gameDataWalk, listWorldObjectDefinitions } from "./runtime";
import { rejectsCrossOriginRequest } from "./origin-guard";
import type { SessionPort } from "./session";
import {
  parseCurrencyDefinitionId,
  parseFarmId,
  parseWorkAreaId,
  parseJobId,
  type FarmId,
  type JobId,
  type ConstructionInstance,
  type ProgressionDefinition,
  type ShopEntry,
  type Wallet
} from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";
import { D1AutoPlantSettlementService } from "./d1-auto-plant-settlement";
import { D1AutoSupplySettlementService } from "./d1-auto-supply-settlement";
import { D1AutoHarvestSettlementService } from "./d1-auto-harvest-settlement";
import { D1AutoMiningSettlementService } from "./d1-auto-mining-settlement";
import { D1AutoUnloadSettlementService } from "./d1-auto-unload-settlement";
import { D1AutoFundingSettlementService } from "./d1-auto-funding-settlement";
import { D1ProductionRateSettlementService } from "./d1-production-rate-settlement";
import {
  D1CropRepository,
  D1HarvestSettlementRepository,
  D1EconomySettlementRepository,
  D1FishingActionRepository,
  D1FishingSettlementRepository,
  D1HomeIslandZoneResolver,
  D1ResourceActionRepository,
  D1ResourceNodeStateRepository,
  D1ResourceSettlementRepository,
  D1FarmExpansionRepository,
  D1TreeRepository,
  D1ConstructionRepository,
  D1TreeHarvestSettlementRepository,
  D1IdempotencyRepository,
  D1TreeHarvestBatchReceiptRepository,
  D1CropHarvestBatchReceiptRepository,
  D1PlantBatchReceiptRepository,
  D1WorkAreaRepository,
  D1ActorRepository,
  D1ActorJobRepository,
  D1CargoRepository,
  D1AutoTravelRepository,
  D1WalletRepository,
  D1InventoryRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1PlayerRepository,
  D1ProgressionRepository,
  D1WarehouseRepository,
  D1ProductionAssignmentRepository,
  D1ProductionSourceRepository
  ,D1OrchardProductionBindingRepository
  ,D1ResourceProductionBindingRepository
  ,D1FishingSpotStateRepository
  ,D1WildFisheryProductionBindingRepository
  ,D1AquaculturePondRepository
  ,D1ForestryConstructionStateRepository
  ,D1NeighborRepository
} from "./d1-repositories";

const MAX_JSON_BODY_BYTES = 16_384;

export interface HandlerDependencies {
  readonly db: D1DatabaseLike;
  readonly authenticator: AuthenticationPort<Request>;
  /**
   * Where `GET /session` resolves or establishes the caller's identity.
   *
   * Absent on a host that has no session concept (the development bridge), where `/session` then
   * answers `RESOURCE_NOT_FOUND` rather than pretending to have one.
   */
  readonly session?: SessionPort;
  readonly ids: IdGenerator &
    CropIdGenerator &
    TreeIdGenerator &
    EconomyTransactionIdGenerator &
    ConstructionIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly cropDefinitions: CropDefinitionRepository;
  readonly itemDefinitions: ItemDefinitionRepository;
  readonly currencyDefinitions: CurrencyDefinitionRepository;
  readonly shopEntries: ShopEntryRepository;
  readonly plotDefinitions: PlotDefinitionRepository;
  readonly treeDefinitions: TreeDefinitionRepository;
  /** The build catalogue as placement rules: price, level, footprint, capability, buildability. */
  readonly constructionDefinitions: ConstructionDefinitionRepository;
  /** Forestry capabilities for persisted tree constructions; ambient scenery is never in this table. */
  readonly forestryConstructionDefinitions?: ForestryConstructionDefinitionRepository;
  /** The levelling curve. Passed in rather than imported, so application code stays game-data free. */
  readonly progressionDefinition: ProgressionDefinition;
  /** The island's starter arrangement: what every farm is given once, and never re-applied. */
  readonly starterWorld: StarterWorldDefinition;
  /** The island's geography, as the placement rules read it. */
  readonly terrain: TileTerrainLookup;
  /** Where the island lets a farm own land, for the single-cell land sale. */
  readonly landSale: LandSaleLookup;
  /** The manual aquaculture definition; omitted hosts use the shipped game-data value. */
  readonly aquaculture?: AquacultureDefinition;
  /**
   * Fishing: the catalogue, the id source, and the entropy.
   *
   * Optional so a host that has not wired fishing answers `RESOURCE_NOT_FOUND` on its routes rather
   * than refusing to build - the same treatment `session` gets.
   */
  readonly fishing?: {
    readonly catalogue: FishingCataloguePort;
    readonly ids: FishingIdGenerator;
    readonly random: FishingRandomPort;
  };
  /**
   * Resource nodes: the catalogue, the id source, and the shared entropy.
   *
   * Optional for the same reason fishing's is: a host that has not wired gathering answers
   * `RESOURCE_NOT_FOUND` on its routes rather than refusing to build.
   */
  readonly resources?: {
    readonly catalogue: ResourceCataloguePort;
    readonly ids: ResourceIdGenerator;
    readonly random: RandomPort;
  };
  /**
   * The Island Warehouse's tier catalogue. Optional like fishing and gathering: a host that has not
   * wired it answers `RESOURCE_NOT_FOUND` on `/warehouse` rather than refusing to build.
   */
  readonly warehouse?: {
    readonly tiers: WarehouseTierRepository;
  };
  /**
   * Work areas: the ground-capability lookup and the id source.
   *
   * Optional like fishing and the warehouse: a host that has not wired it answers
   * `RESOURCE_NOT_FOUND` on the work-area routes rather than refusing to build. Work-area reads never
   * touch the ordinary farm loads or the growth poll.
   */
  readonly workAreas?: {
    readonly ground: WorkAreaGroundLookup;
    readonly ids: WorkAreaIdGenerator;
  };
  /**
   * Actors and jobs: the id source. The target catalogues are the ones this handler already has.
   *
   * Optional like the other feature bags: a host that has not wired it answers `RESOURCE_NOT_FOUND`
   * on the worker routes rather than refusing to build. Nothing here is read by the farm's ordinary
   * loads, the growth poll, the frame loop, the pointer loop or the movement loop.
   */
  readonly workers?: {
    readonly ids: ActorIdGenerator & JobIdGenerator;
  };
  /**
   * What each kind of actor can carry, from game data. Optional like the other feature bags: without
   * it the cargo routes answer `RESOURCE_NOT_FOUND` rather than guessing a capacity.
   */
  readonly cargoCapacities?: CargoCapacityLookup;
  readonly clock: Clock;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function toNeighborDTO(snapshot: NeighborSnapshot, now: string): NeighborSnapshotDTO {
  const seconds = snapshot.npc.nextMilestoneAt === null
    ? 0
    : Math.max(0, Math.ceil((Date.parse(snapshot.npc.nextMilestoneAt) - Date.parse(now)) / 1000));
  const islandDTO = (item: NeighborSnapshot["island"]) => ({
    islandId: item.id,
    zone: { kind: "EVENT" as const, zoneId: `zone_neighbor_island_${item.farmId}` },
    center: { x: item.centerX, z: item.centerZ }, dock: { x: item.dockX, z: item.dockZ }, npc: { x: item.npcX, z: item.npcZ }
  });
  return {
    island: islandDTO(snapshot.island),
    npc: {
      islandId: snapshot.npc.islandId,
      npcId: snapshot.npc.npcId,
      displayNameKey: snapshot.npc.displayNameKey,
      phase: snapshot.npc.phase,
      jobKey: snapshot.npc.phase === "GROWING" ? "neighbor.job.growing" : snapshot.npc.phase === "STOCKED" ? "neighbor.job.stocked" : "neighbor.job.built",
      stockQuantity: snapshot.npc.stockQuantity,
      constructionLevel: snapshot.npc.constructionLevel,
      plantedAt: snapshot.npc.plantedAt,
      readyAt: snapshot.npc.readyAt,
      nextMilestoneAt: snapshot.npc.nextMilestoneAt,
      secondsUntilNextMilestone: seconds,
      version: snapshot.npc.version
    },
    visit: { currentPlace: snapshot.visit.currentPlace, currentIslandId: snapshot.visit.currentIslandId, version: snapshot.visit.version },
    ...(snapshot.islands === undefined ? {} : { islands: snapshot.islands.map((item) => ({ ...islandDTO(item), slot: item.slot, seed: item.seed, templateVersion: item.templateVersion })) }),
    ...(snapshot.npcs === undefined ? {} : { npcs: snapshot.npcs.map((item) => ({ islandId: item.islandId, npcId: item.npcId, displayNameKey: item.displayNameKey, phase: item.phase, jobKey: item.jobKey, stockQuantity: item.stockQuantity, constructionLevel: item.constructionLevel, plantedAt: item.plantedAt, readyAt: item.nextActionAt, nextMilestoneAt: item.nextActionAt, secondsUntilNextMilestone: Math.max(0, Math.ceil((Date.parse(item.nextActionAt) - Date.parse(now)) / 1000)), version: item.version, slot: item.slot, cycle: item.cycle, nextActionAt: item.nextActionAt })) })
  };
}

/**
 * A work area, as the wire carries it.
 *
 * Deliberately narrow: the id, the farm, the kind, the name the player typed and the cells they drew,
 * plus the version an edit must present. The stored zone is not exposed - a location is not something
 * a client needs, and it is never authority - and no server-derived price, role or capacity exists
 * for this feature to leak.
 */
function toWorkAreaDTO(area: WorkAreaView): WorkAreaDTO {
  return {
    workAreaId: area.workAreaId,
    farmId: area.farmId,
    kind: area.kind,
    displayName: area.displayName,
    cells: area.cells.map((cell) => ({ x: cell.x, y: cell.y })),
    version: area.version,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt
  };
}

/**
 * Cargo, as the wire carries it.
 *
 * A separate container from the warehouse, and the DTO says so: what is *being carried*. The copy is
 * shallow because a stack is a plain value.
 */
function toCargoDTO(cargo: CargoView): CargoDTO {
  return {
    capacity: cargo.capacity,
    used: cargo.used,
    available: cargo.available,
    version: cargo.version,
    items: cargo.items.map((item) => ({
      itemDefinitionId: item.itemDefinitionId,
      displayNameKey: item.displayNameKey,
      quantity: item.quantity
    }))
  };
}

/** The assignment as the wire carries it: the view's readonly list copied into a mutable array. */
function toJobDTO(job: JobView): JobDTO {
  return { ...job, fundingItems: [...job.fundingItems] };
}

/** The warehouse, as the wire carries it: every field the server decided, nothing derived. */
function toAutoPlanDTO(plan: AutoPlanView): AutoPlanDTO {
  return {
    actorId: plan.actorId,
    controlMode: plan.controlMode,
    action: toWorkActionDTO(plan.action),
    jobId: plan.jobId,
    waitReason: plan.waitReason,
    // The view's lists are readonly so a reader cannot mutate a plan; the wire's are plain arrays.
    perAssignment: plan.perAssignment.map((entry) => ({ ...entry, action: toWorkActionDTO(entry.action) }))
  };
}

/** The plan's own action, in the wire's mutable shape. */
function toWorkActionDTO(action: AutoPlanView["action"]): AutoPlanDTO["action"] {
  if (action !== null && action.kind === "FUND_AND_PURCHASE_INPUT") {
    return {
      kind: action.kind,
      itemDefinitionId: action.itemDefinitionId,
      quantity: action.quantity,
      sales: action.sales.map((sale) => ({
        itemDefinitionId: sale.itemDefinitionId,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        proceeds: sale.proceeds
      }))
    };
  }
  return action;
}

/**
 * One Auto step, as the wire carries it.
 *
 * Almost every field is a *description* of something the server already did or decided; the client's
 * only use for them is to draw and explain. The one field with a timing meaning is `arrivesAt`, and it
 * is the server's own clock - which is why the client may schedule its next ask from it but can never
 * move it.
 */
function toAutoStepDTO(step: AutoStepView): AutoStepDTO {
  return {
    controlMode: step.controlMode,
    phase: step.phase,
    step: step.step,
    waitReason: step.waitReason,
    jobId: step.jobId,
    skillId: step.skillId,
    targetDefinitionId: step.targetDefinitionId,
    targetDisplayNameKey: step.targetDisplayNameKey,
    itemDefinitionId: step.itemDefinitionId,
    quantity: step.quantity,
    cell: step.cell === null ? null : { x: step.cell.x, y: step.cell.y },
    from: step.from === null ? null : { kind: step.from.kind, x: step.from.x, y: step.from.y },
    to: step.to === null ? null : { kind: step.to.kind, x: step.to.x, y: step.to.y },
    arrivesAt: step.arrivesAt,
    retryAfterMs: step.retryAfterMs,
    progress: step.progress === null ? null : { ...step.progress },
    cargo: { ...step.cargo }
  };
}

/** The warehouse, as the wire carries it: every field the server decided, nothing derived. */
function toWarehouseDTO(status: WarehouseStatusView): WarehouseStatusDTO {
  return {
    tier: status.tier,
    tierDisplayNameKey: status.tierDisplayNameKey,
    capacity: status.capacity,
    used: status.used,
    available: status.available,
    overCapacity: status.overCapacity,
    nextTier: status.nextTier,
    nextCapacity: status.nextCapacity,
    nextUpgrade:
      status.nextUpgrade === null
        ? null
        : {
            currencyId: status.nextUpgrade.currencyId,
            gold: status.nextUpgrade.gold,
            materials: status.nextUpgrade.materials.map((entry) => ({ ...entry }))
          }
  };
}

/** One persisted construction, as the client reads it. Pure projection: nothing is derived here. */
function toConstructionDTO(construction: ConstructionInstance, forestry?: ForestryConstructionStateDTO): ConstructionDTO {
  return {
    constructionId: construction.id,
    farmId: construction.farmId,
    entryId: construction.entryId,
    category: construction.category,
    anchorX: construction.anchorX,
    anchorY: construction.anchorY,
    rotation: construction.rotation,
    footprint: {
      widthCells: construction.footprint.widthCells,
      depthCells: construction.footprint.depthCells
    },
    state: construction.state,
    source: construction.source,
    placementKey: construction.placementKey,
    paidAmount: construction.paidAmount,
    costAmount: construction.costAmount,
    costCurrencyDefinitionId: construction.costCurrencyDefinitionId,
    createdAt: construction.createdAt,
    storedAt: construction.storedAt,
    version: construction.version,
    ...(forestry === undefined ? {} : { forestry })
  };
}

function toForestryConstructionDTO(
  state: ForestryConstructionState,
  definitions: ForestryConstructionDefinitionRepository,
  now: string
): ForestryConstructionStateDTO | null {
  const definition = definitions.findByEntryId(state.entryId);
  if (definition === null) return null;
  return projectForestryConstructionState(state, definition, now);
}

function toAquaculturePondDTO(pond: AquaculturePondView): AquaculturePondDTO {
  return {
    pondId: pond.pondId,
    farmId: pond.farmId,
    itemDefinitionId: pond.itemDefinitionId,
    status: pond.status,
    stockedAt: pond.stockedAt,
    readyAt: pond.readyAt,
    capacity: pond.capacity,
    stockedCount: pond.stockedCount,
    growingCount: pond.growingCount,
    readyCount: pond.readyCount,
    availableCapacity: pond.availableCapacity,
    cohorts: pond.cohorts.map((cohort) => ({ ...cohort })),
    version: pond.version
  };
}

/** One fishing spot, as the client draws it. A pure projection of the definition. */
function toFishingSpotDTO(spot: FishingSpotView): FishingSpotDTO {
  return {
    spotId: spot.spotId,
    displayNameKey: spot.displayNameKey,
    zoneKind: spot.zoneKind as FishingSpotDTO["zoneKind"],
    position: { x: spot.position.x, y: spot.position.y },
    interactionRadiusTiles: spot.interactionRadiusTiles,
    tableId: spot.tableId
  };
}

function toFishDefinitionDTO(definition: FishView): FishDefinitionDTO {
  return {
    fishDefinitionId: definition.fishDefinitionId,
    displayNameKey: definition.displayNameKey,
    itemDefinitionId: definition.itemDefinitionId,
    itemDisplayNameKey: definition.itemDisplayNameKey,
    modelId: definition.modelId,
    sellPrice: definition.sellPrice,
    xp: definition.xp,
    requiredLevel: definition.requiredLevel
  };
}

function toFishingActionDTO(action: FishingActionView): FishingActionDTO {
  return {
    actionId: action.actionId,
    zone: {
      kind: action.zone.kind as FishingActionDTO["zone"]["kind"],
      zoneId: action.zone.id
    },
    spotId: action.spotId,
    tableId: action.tableId,
    status: action.status,
    startedAt: action.startedAt,
    readyAt: action.readyAt,
    secondsUntilReady: action.secondsUntilReady,
    version: action.version
  };
}

function toResourceNodeDTO(node: ResourceNodeView): ResourceNodeDTO {
  return {
    nodeId: node.nodeId,
    definitionId: node.definitionId,
    displayNameKey: node.displayNameKey,
    verb: node.verb,
    zoneKind: node.zoneKind as ResourceNodeDTO["zoneKind"],
    position: { x: node.position.x, y: node.position.y },
    interactionRadiusTiles: node.interactionRadiusTiles,
    actionSeconds: node.actionSeconds,
    modelId: node.modelId,
    depletedModelId: node.depletedModelId,
    dropItemDefinitionId: node.dropItemDefinitionId,
    requiredLevel: node.requiredLevel,
    availableAt: node.availableAt,
    secondsUntilAvailable: node.secondsUntilAvailable,
    available: node.available
  };
}

function toResourceActionDTO(action: ResourceActionView): ResourceActionDTO {
  return {
    actionId: action.actionId,
    zone: { kind: action.zone.kind as ResourceActionDTO["zone"]["kind"], zoneId: action.zone.id },
    nodeId: action.nodeId,
    definitionId: action.definitionId,
    verb: action.verb,
    status: action.status,
    startedAt: action.startedAt,
    readyAt: action.readyAt,
    secondsUntilReady: action.secondsUntilReady,
    version: action.version
  };
}

function toFarmDTO(farm: {
  id: string;
  ownerPlayerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}): FarmDTO {
  return { ...farm };
}

function toMemberDTO(member: {
  farmId: string;
  playerId: string;
  role: "OWNER" | "EDITOR" | "HELPER" | "VISITOR";
  createdAt: string;
}): FarmMemberDTO {
  return { ...member };
}

/**
 * One market row, in the shape the client renders.
 *
 * The item's display key and category travel with the price so the page can name and group what it
 * is selling without keeping a list of items of its own. A null price means the direction is closed
 * and the client draws no button for it.
 */
function toShopEntryDTO(
  entry: ShopEntry,
  itemDefinitions: ItemDefinitionRepository,
  currencyDefinitions: CurrencyDefinitionRepository
): ShopEntryDTO {
  const item = itemDefinitions.findById(entry.itemDefinitionId);
  const currency = currencyDefinitions.findById(entry.currencyDefinitionId);
  if (item === null) {
    throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
  }
  if (currency === null) {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  return {
    shopEntryId: entry.id,
    itemDefinitionId: entry.itemDefinitionId,
    itemDisplayNameKey: item.displayNameKey,
    shopDisplayNameKey: entry.shopDisplayNameKey ?? null,
    category: item.category,
    currencyId: entry.currencyDefinitionId,
    currencyDisplayNameKey: currency.displayNameKey,
    buyPrice: entry.buyPrice,
    sellPrice: entry.sellPrice,
    maxQuantityPerRequest: entry.maxQuantityPerRequest
  };
}

function toWalletDTO(wallet: Wallet, currencyDefinitions: CurrencyDefinitionRepository): WalletDTO {
  const currency = currencyDefinitions.findById(wallet.currencyDefinitionId);
  if (currency === null) {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  return {
    currencyId: wallet.currencyDefinitionId,
    displayNameKey: currency.displayNameKey,
    balance: wallet.balance
  };
}

/** Names the currency a plot is priced in, so the client can phrase the price without a label table. */
function toPlotDTO(view: PlotView, currencyDefinitions: CurrencyDefinitionRepository): PlotDTO {
  let currencyId;
  try {
    currencyId = parseCurrencyDefinitionId(view.currencyId);
  } catch {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  const currency = currencyDefinitions.findById(currencyId);
  if (currency === null) {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  return { ...view, currencyDisplayNameKey: currency.displayNameKey };
}

/**
 * Decodes a single percent-encoded path segment.
 *
 * decodeURIComponent throws URIError for malformed input such as a lone "%". That is a client
 * error, so it must be reported as INVALID_INPUT instead of escaping to the outer catch and
 * surfacing as INTERNAL_ERROR.
 */
function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function parseJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("INVALID_INPUT", "Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("INVALID_INPUT", "Request body is too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApplicationError("INVALID_INPUT", "Malformed JSON");
  }
}

function errorStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
    case "TILE_INVALID":
    case "INVALID_QUANTITY":
    case "SHOP_ENTRY_NOT_ALLOWED":
    case "WORK_AREA_NAME_INVALID":
    case "WORK_AREA_CELL_INVALID":
    case "WORK_AREA_TOO_MANY_CELLS":
    case "JOB_TARGET_INVALID":
    case "JOB_KIND_UNAVAILABLE":
    case "JOB_AREA_MISMATCH":
    case "INVALID_CARGO":
    case "SUPPLY_NOT_ALLOWED":
    case "AQUACULTURE_AREA_REQUIRED":
      return 400;
    case "NOT_AUTHENTICATED":
      return 401;
    case "NOT_AUTHORIZED":
    case "FARM_PERMISSION_DENIED":
    case "CROP_LEVEL_REQUIRED":
    case "PLOT_LEVEL_REQUIRED":
    case "LAND_NOT_DEVELOPABLE":
    case "TREE_LEVEL_REQUIRED":
    case "TREE_NOT_ACTIVE":
    case "TREE_NOT_STORED":
    case "CONSTRUCTION_LEVEL_REQUIRED":
    case "CONSTRUCTION_NOT_ALLOWED":
    case "OBJECT_NOT_OWNED":
    case "CONSTRUCTION_NOT_MOVABLE":
    case "CONSTRUCTION_NOT_ROTATABLE":
    case "CONSTRUCTION_NOT_REMOVABLE":
    case "CONSTRUCTION_NOT_STORABLE":
    case "CONSTRUCTION_NOT_STORED":
    case "FISHING_ZONE_NOT_ALLOWED":
    case "RESOURCE_ZONE_NOT_ALLOWED":
    case "RESOURCE_LEVEL_REQUIRED":
      return 403;
    case "RESOURCE_NOT_FOUND":
    case "CROP_DEFINITION_NOT_FOUND":
    case "CROP_NOT_FOUND":
    case "ITEM_DEFINITION_NOT_FOUND":
    case "CURRENCY_DEFINITION_NOT_FOUND":
    case "SHOP_ENTRY_NOT_FOUND":
    case "TREE_DEFINITION_NOT_FOUND":
    case "TREE_NOT_FOUND":
    case "CONSTRUCTION_NOT_FOUND":
    case "FORESTRY_CONSTRUCTION_NOT_FOUND":
    case "FISHING_SPOT_NOT_FOUND":
    case "FISHING_ACTION_NOT_FOUND":
    case "RESOURCE_NODE_NOT_FOUND":
    case "RESOURCE_ACTION_NOT_FOUND":
    case "AQUACULTURE_POND_NOT_FOUND":
    case "LAND_CELL_NOT_AVAILABLE":
    case "WORK_AREA_NOT_FOUND":
    case "ACTOR_NOT_FOUND":
    case "JOB_NOT_FOUND":
      return 404;
    case "CONFLICT_STALE_STATE":
    case "REQUEST_ALREADY_PROCESSED":
    case "TILE_OCCUPIED":
    case "TILE_NOT_PLANTABLE":
    case "IDEMPOTENCY_CONFLICT":
    case "CROP_NOT_MATURE":
    case "CROP_ALREADY_HARVESTED":
    case "INVENTORY_LIMIT_EXCEEDED":
    case "WAREHOUSE_FULL":
    case "WAREHOUSE_MAX_TIER":
    case "INSUFFICIENT_ITEMS":
    case "INSUFFICIENT_FUNDS":
    case "WALLET_LIMIT_EXCEEDED":
    case "ECONOMY_CONFLICT":
    case "PROGRESSION_CONFLICT":
    case "PLOT_LIMIT_REACHED":
    case "LAND_ALREADY_OWNED":
    case "WORK_AREA_IN_USE":
    case "JOB_LIMIT_REACHED":
    case "JOB_REORDER_MISMATCH":
    case "CARGO_FULL":
    case "INVALID_FUNDING":
    case "TREE_NOT_READY":
    case "CONSTRUCTION_OCCUPIED":
    case "CONSTRUCTION_CONFLICT":
    case "FISHING_SPOT_DISABLED":
    case "FISHING_SPOT_DEPLETED":
    case "FISHING_ALREADY_ACTIVE":
    case "FISHING_NOT_READY":
    case "FISHING_ACTION_NOT_ACTIVE":
    case "FISHING_CONFLICT":
    case "RESOURCE_NODE_DEPLETED":
    case "RESOURCE_ALREADY_ACTIVE":
    case "RESOURCE_NOT_READY":
    case "RESOURCE_ACTION_NOT_ACTIVE":
    case "RESOURCE_CONFLICT":
    case "AQUACULTURE_POND_NOT_EMPTY":
    case "AQUACULTURE_POND_EMPTY":
    case "AQUACULTURE_POND_NOT_READY":
    case "AQUACULTURE_CAPACITY_EXCEEDED":
    case "AQUACULTURE_NOT_ENOUGH_GROWING":
    case "AQUACULTURE_NOT_ENOUGH_READY":
    case "AQUACULTURE_CONFLICT":
    case "FORESTRY_CONSTRUCTION_NOT_READY":
    case "FORESTRY_CONSTRUCTION_DEPLETED":
    case "FORESTRY_CONSTRUCTION_CONFLICT":
      return 409;
    case "CONSTRUCTION_UNSUITABLE_GROUND":
    case "CONSTRUCTION_BLOCKED":
    case "CONSTRUCTION_OUTSIDE_WORLD":
      return 400;
    case "RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

/**
 * A host that has not wired gathering: every resource target is unknown.
 *
 * Explicit rather than absent, so a MINING or FORESTRY job is refused with `JOB_TARGET_INVALID` on
 * such a host instead of a crash - and so the target rule has exactly one shape everywhere.
 */
const NO_RESOURCE_CATALOGUE: ResourceCataloguePort = {
  listDefinitions: () => [],
  listNodes: () => [],
  findDefinition: () => null,
  findNode: () => null,
  findDropTable: () => null
};

const NO_FORESTRY_CONSTRUCTION_DEFINITIONS: ForestryConstructionDefinitionRepository = {
  findByEntryId: () => null
};

function failure(code: ErrorCode, requestId: string): Response {
  const body: ApiFailure = { ok: false, error: { code, requestId } };
  return jsonResponse(body, errorStatus(code));
}

export function createHandler(dependencies: HandlerDependencies) {
  const players = new D1PlayerRepository(dependencies.db);
  const farms = new D1FarmRepository(dependencies.db);
  const members = new D1FarmMemberRepository(dependencies.db);
  const neighbor = new NeighborService(farms, members, new D1NeighborRepository(dependencies.db), dependencies.clock);
  const tiles = new D1FarmTileRepository(dependencies.db);
  const crops = new D1CropRepository(dependencies.db);
  const inventory = new D1InventoryRepository(dependencies.db);
  // Hoisted above the planting and harvesting use cases because both now have a cargo destination:
  // Auto plants from what the actor carries and harvests into it, so those use cases need the cargo
  // container and the actor row before the cargo *routes* are wired below.
  const cargoRepository = new D1CargoRepository(dependencies.db);
  const actorRepository = new D1ActorRepository(dependencies.db);
  const autoTravel = new D1AutoTravelRepository(dependencies.db);
  const autoPlantSettlement = new D1AutoPlantSettlementService(
    dependencies.db,
    crops,
    autoTravel,
    dependencies.clock
  );
  const harvestSettlement = new D1HarvestSettlementRepository(dependencies.db);
  const autoHarvestSettlement = new D1AutoHarvestSettlementService(
    dependencies.db,
    harvestSettlement,
    autoTravel,
    dependencies.clock
  );
  const autoMiningSettlement = new D1AutoMiningSettlementService(
    dependencies.db,
    autoTravel,
    dependencies.clock
  );
  const wallets = new D1WalletRepository(dependencies.db);
  const economySettlement = new D1EconomySettlementRepository(dependencies.db);
  const autoSupplySettlement = new D1AutoSupplySettlementService(
    dependencies.db,
    cargoRepository,
    economySettlement,
    autoTravel,
    dependencies.clock
  );
  const autoUnloadSettlement = new D1AutoUnloadSettlementService(
    dependencies.db,
    cargoRepository,
    autoTravel,
    dependencies.clock
  );
  const autoFundingSettlement = new D1AutoFundingSettlementService(
    dependencies.db,
    economySettlement,
    autoTravel,
    dependencies.clock
  );
  const farmExpansionSettlement = new D1FarmExpansionRepository(dependencies.db);
  const trees = new D1TreeRepository(dependencies.db);
  const constructions = new D1ConstructionRepository(dependencies.db);
  const forestryConstructionStates = new D1ForestryConstructionStateRepository(dependencies.db);
  const treeHarvestSettlement = new D1TreeHarvestSettlementRepository(dependencies.db);
  const progressions = new D1ProgressionRepository(dependencies.db);
  const createFarm = new CreateFarm(players, farms, members, dependencies.ids, dependencies.clock);
  const getFarm = new GetFarm(farms, members);
  const projector = new CropStateProjector(dependencies.cropDefinitions, dependencies.clock);
  const inventoryService = new InventoryService(dependencies.itemDefinitions, dependencies.clock);
  const plantCrop = new PlantCrop({
    farms,
    members,
    tiles,
    crops,
    inventory,
    idempotency: crops,
    definitions: dependencies.cropDefinitions,
    progression: progressions,
    progressionDefinition: dependencies.progressionDefinition,
    terrain: dependencies.terrain,
    inventoryService,
    // Auto plants with a seed the actor is carrying; a host without a cargo container simply cannot
    // take that path, and the manual one is byte-for-byte what it was.
    actors: actorRepository,
    cargo: cargoRepository,
    autoSettlement: autoPlantSettlement,
    ids: dependencies.ids,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const uprootCrop = new UprootCrop(
    farms,
    members,
    crops,
    crops,
    dependencies.fingerprints,
    dependencies.clock
  );
  const getFarmCrops = new GetFarmCrops(farms, members, crops, projector);
  const listCropDefinitions = new ListCropDefinitions(
    dependencies.cropDefinitions,
    dependencies.itemDefinitions
  );
  const listFarmTiles = new ListFarmTiles(farms, members, tiles);
  const harvestCrop = new HarvestCrop(
    farms,
    members,
    crops,
    inventory,
    crops,
    harvestSettlement,
    dependencies.cropDefinitions,
    inventoryService,
    progressions,
    dependencies.progressionDefinition,
    dependencies.fingerprints,
    dependencies.clock,
    // The Auto harvest destination, wired only on a host that has both a cargo container and a
    // capacity for it. Without them the manual harvest is exactly what it always was.
    dependencies.cargoCapacities === undefined
      ? undefined
      : {
          cargo: cargoRepository,
          cargoService: new CargoService(dependencies.itemDefinitions, dependencies.cargoCapacities, dependencies.clock),
          actors: actorRepository
        },
    // The atomic Auto harvest boundary: the harvest and the Auto timeline commit together.
    autoHarvestSettlement
  );
  const harvestCropArea = new HarvestCropAreaGroup(
    farms,
    members,
    crops,
    harvestCrop,
    new D1CropHarvestBatchReceiptRepository(dependencies.db),
    dependencies.fingerprints,
    dependencies.clock
  );
  const plantCropArea = new PlantCropAreaGroup(
    farms,
    members,
    plantCrop,
    new D1PlantBatchReceiptRepository(dependencies.db, "PLANT_CROP_AREA_GROUP"),
    dependencies.fingerprints,
    dependencies.clock
  );
  const getProgression = new GetProgression(
    dependencies.progressionDefinition,
    progressions,
    dependencies.clock
  );
  const getInventory = new GetInventory(inventory, dependencies.itemDefinitions);
  const shopDependencies = {
    shops: dependencies.shopEntries,
    currencies: dependencies.currencyDefinitions,
    wallets,
    inventory,
    idempotency: crops,
    settlement: economySettlement,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    inventoryService,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  };
  const buyItem = new BuyItem(shopDependencies);
  const sellItem = new SellItem(shopDependencies);
  // The Island Warehouse: status is a read, upgrade is a ledgered sink. Both are optional wiring.
  const warehouseRepository = new D1WarehouseRepository(dependencies.db);
  const resources = dependencies.resources;
  const resourceStates = new D1ResourceNodeStateRepository(dependencies.db);
  const fishingSpotStates = new D1FishingSpotStateRepository(dependencies.db);
  const actorJobRepository = new D1ActorJobRepository(dependencies.db);
  const resourceContext = resources === undefined
    ? undefined
    : new ResolveResourceProductionContext({
        farms, members, jobs: actorJobRepository, workAreas: new D1WorkAreaRepository(dependencies.db),
        catalogue: resources.catalogue, states: resourceStates,
        ground: dependencies.workAreas?.ground ?? { capabilitiesAt: () => [] }, clock: dependencies.clock
      });
  const wildFisheryContext = dependencies.fishing === undefined || dependencies.workAreas === undefined
    ? undefined
    : new ResolveWildFisheryProductionContext({
        farms, members, jobs: actorJobRepository, workAreas: new D1WorkAreaRepository(dependencies.db),
        catalogue: dependencies.fishing.catalogue, states: fishingSpotStates,
        ground: dependencies.workAreas.ground, clock: dependencies.clock, random: dependencies.fishing.random
      });
  const productionSettlement = new SettleProductionAssignment(
    farms,
    members,
    new D1ProductionAssignmentRepository(dependencies.db),
    new D1ProductionSourceRepository(dependencies.db),
    inventory,
    warehouseRepository,
    new D1ProductionRateSettlementService(dependencies.db),
    dependencies.clock,
    resourceContext,
    wildFisheryContext
  );
  if (!(productionSettlement instanceof SettleProductionAssignment)) {
    throw new Error("Production settlement composition failed");
  }
  const orchardBinding = new EnsureOrchardProductionBinding({
    farms, members, jobs: actorJobRepository,
    workAreas: new D1WorkAreaRepository(dependencies.db), trees,
    treeDefinitions: dependencies.treeDefinitions,
    bindings: new D1OrchardProductionBindingRepository(dependencies.db), clock: dependencies.clock
  });
  const resourceBinding = resources === undefined
    ? null
    : new EnsureResourceProductionBinding({
        farms, members, jobs: actorJobRepository, workAreas: new D1WorkAreaRepository(dependencies.db),
        catalogue: resources.catalogue, states: resourceStates,
        ground: dependencies.workAreas?.ground ?? { capabilitiesAt: () => [] },
        bindings: new D1ResourceProductionBindingRepository(dependencies.db), clock: dependencies.clock
      });
  const wildFisheryBinding = dependencies.fishing === undefined || dependencies.workAreas === undefined
    ? null
    : new EnsureWildFisheryProductionBinding({
        farms, members, jobs: actorJobRepository, workAreas: new D1WorkAreaRepository(dependencies.db),
        catalogue: dependencies.fishing.catalogue, states: fishingSpotStates,
        ground: dependencies.workAreas.ground, clock: dependencies.clock, random: dependencies.fishing.random,
        bindings: new D1WildFisheryProductionBindingRepository(dependencies.db)
      });
  const ensureRateBinding = async (actor: ActorContext, farmId: FarmId, jobId: JobId) => {
    const job = await actorJobRepository.findById(jobId);
    if (job?.kind === "ORCHARD") return orchardBinding.execute(actor, farmId, jobId);
    if (resourceBinding !== null && (job?.kind === "FORESTRY" || job?.kind === "MINING")) {
      return resourceBinding.execute(actor, farmId, jobId);
    }
    if (wildFisheryBinding !== null && job?.kind === "FISHERY") {
      return wildFisheryBinding.execute(actor, farmId, jobId);
    }
    return undefined;
  };
  const productionReconcile = new ReconcileFarmProduction(
    farms,
    members,
    new D1ProductionAssignmentRepository(dependencies.db),
    new D1ProductionSourceRepository(dependencies.db),
    productionSettlement,
    actorJobRepository,
    ensureRateBinding
  );
  // R2B.2 will expose this already-composed use case through an authenticated HTTP command.
  const warehouseStatus =
    dependencies.warehouse === undefined ? null : new GetWarehouseStatus(warehouseRepository, dependencies.warehouse.tiers);
  const warehouseUpgrade =
    dependencies.warehouse === undefined
      ? null
      : new UpgradeWarehouse(
          warehouseRepository,
          dependencies.warehouse.tiers,
          wallets,
          dependencies.currencyDefinitions,
          inventory,
          new EconomyService(dependencies.ids, dependencies.clock),
          inventoryService,
          new D1IdempotencyRepository(dependencies.db),
          dependencies.fingerprints,
          dependencies.clock
        );
  // Work areas: a pure addition with no economic effect - no gold, no inventory, no land, no tiles.
  // Optional wiring, like fishing and the warehouse, so a host that has not configured it answers
  // RESOURCE_NOT_FOUND on these routes rather than refusing to build.
  const workAreaRepository = new D1WorkAreaRepository(dependencies.db);
  const aquaculturePondRepository = new D1AquaculturePondRepository(dependencies.db);
  const aquacultureDependencies = {
    farms,
    members,
    constructions,
    workAreas: workAreaRepository,
    ponds: aquaculturePondRepository,
    terrain: dependencies.terrain,
    inventory,
    idempotency: new D1IdempotencyRepository(dependencies.db),
    fingerprints: dependencies.fingerprints,
    inventoryService,
    clock: dependencies.clock,
    definition: dependencies.aquaculture ?? gameDataAquacultureDefinition
  };
  const listAquaculturePonds = new ListAquaculturePonds(aquacultureDependencies);
  const stockAquaculturePond = new StockAquaculturePond(aquacultureDependencies);
  const harvestAquaculturePond = new HarvestAquaculturePond(aquacultureDependencies);
  const withdrawAquaculturePond = new WithdrawAquaculturePond(aquacultureDependencies);
  const workAreaDependencies = { farms, members, workAreas: workAreaRepository };
  const workAreaGround = dependencies.workAreas?.ground ?? null;
  const workAreaIds = dependencies.workAreas?.ids ?? null;
  const listWorkAreas =
    workAreaGround === null ? null : new ListWorkAreas(workAreaDependencies);
  const getWorkArea = workAreaGround === null ? null : new GetWorkArea(workAreaDependencies);
  const createWorkArea =
    workAreaGround === null || workAreaIds === null
      ? null
      : new CreateWorkArea({
          ...workAreaDependencies,
          ground: workAreaGround,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          ids: workAreaIds,
          fingerprints: dependencies.fingerprints,
          clock: dependencies.clock
        });
  const renameWorkArea =
    workAreaGround === null ? null : new RenameWorkArea({ ...workAreaDependencies, clock: dependencies.clock });
  const replaceWorkAreaCells =
    workAreaGround === null
      ? null
      : new ReplaceWorkAreaCells({ ...workAreaDependencies, ground: workAreaGround, clock: dependencies.clock });
  // The delete guard asks the job spine, so an area that a job names is refused rather than silently
  // taking that job's configuration with it.
  const deleteWorkArea =
    workAreaGround === null
      ? null
      : new DeleteWorkArea({
          ...workAreaDependencies,
          jobReferences: (id) => actorJobRepository.countByWorkArea(id)
        });

  // Actors and jobs: configuration only. Creating a job plants nothing, harvests nothing, moves
  // nobody and writes no inventory, experience, gold or warehouse row.
  const jobTargetCatalogue: JobTargetCatalogue = {
    crops: dependencies.cropDefinitions,
    trees: dependencies.treeDefinitions,
    resources: dependencies.resources?.catalogue ?? NO_RESOURCE_CATALOGUE,
    ...(dependencies.fishing === undefined ? {} : { fishing: dependencies.fishing.catalogue })
  };
  const workerIds = dependencies.workers?.ids ?? null;
  const jobDependencies = {
    farms,
    members,
    actors: actorRepository,
    jobs: actorJobRepository,
    workAreas: workAreaRepository,
    targets: jobTargetCatalogue
  };
  const workerExtras =
    workerIds === null || dependencies.cargoCapacities === undefined
      ? null
      : { ...jobDependencies, ids: workerIds, clock: dependencies.clock, cargoCapacities: dependencies.cargoCapacities };
  const resolveWorkers = workerExtras === null ? null : new ResolveWorkers(workerExtras);
  const createJob =
    workerExtras === null
      ? null
      : new CreateJob({
          ...workerExtras,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          // Keep the proven Apple creation contract visible while dispatching resource families too.
          // onCreated: (createdActor, createdFarmId, createdJobId) => orchardBinding.execute
          onCreated: (createdActor, createdFarmId, createdJobId) => ensureRateBinding(createdActor, createdFarmId, createdJobId)
        });
  const updateJobTarget = workerExtras === null ? null : new UpdateJobTarget(workerExtras);
  const setJobEnabled = workerExtras === null ? null : new SetJobEnabled(workerExtras);
  const reorderJobs = workerExtras === null ? null : new ReorderJobs(workerExtras);
  const deleteJob = workerExtras === null ? null : new DeleteJob(workerExtras);

  // Actor cargo: a separate container from the warehouse, and the one all-or-nothing transfer between
  // them. Nothing here is read by the farm's ordinary loads or by any timer.
  const cargoExtras =
    workerIds === null || dependencies.cargoCapacities === undefined
      ? null
      : {
          farms,
          members,
          actors: actorRepository,
          ids: workerIds,
          clock: dependencies.clock,
          cargoCapacities: dependencies.cargoCapacities,
          cargo: cargoRepository,
          itemDefinitions: dependencies.itemDefinitions
        };
  const getActorCargo = cargoExtras === null ? null : new GetActorCargo(cargoExtras);
  const loadCargo =
    cargoExtras === null
      ? null
      : new LoadCargo({
          ...cargoExtras,
          inventory,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          autoSettlement: autoSupplySettlement
        });
  const purchaseSupply =
    cargoExtras === null || dependencies.warehouse === undefined
      ? null
      : new PurchaseSupplyIntoCargo({
          ...cargoExtras,
          shops: dependencies.shopEntries,
          currencies: dependencies.currencyDefinitions,
          wallets,
          economyService: new EconomyService(dependencies.ids, dependencies.clock),
          settlement: economySettlement,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          autoSettlement: autoSupplySettlement
        });
  const unloadCargo =
    cargoExtras === null || dependencies.warehouse === undefined
      ? null
      : new UnloadCargo({
          ...cargoExtras,
          inventory: inventoryService,
          warehouse: warehouseRepository,
          tiers: dependencies.warehouse.tiers,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          // The atomic Auto delivery boundary: the transfer and the Auto timeline commit together.
          autoSettlement: autoUnloadSettlement
        });
  /**
   * The emergency-funded purchase: sell the assignment's whitelist and buy the input in one batch.
   * Wired only where the cargo container, the market catalogue and the funding settlement all exist.
   */
  const fundAndPurchaseSupply =
    cargoExtras === null || dependencies.cargoCapacities === undefined
      ? null
      : new FundAndPurchaseSupply({
          farms,
          members,
          actors: actorRepository,
          jobs: actorJobRepository,
          cargo: cargoRepository,
          cargoService: new CargoService(dependencies.itemDefinitions, dependencies.cargoCapacities, dependencies.clock),
          cargoCapacities: dependencies.cargoCapacities,
          inventory,
          wallets,
          currencies: dependencies.currencyDefinitions,
          itemDefinitions: dependencies.itemDefinitions,
          shops: dependencies.shopEntries,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          economyService: new EconomyService(dependencies.ids, dependencies.clock),
          economyIds: dependencies.ids,
          settlement: autoFundingSettlement,
          clock: dependencies.clock
        });
  const listPlots = new ListPlots(dependencies.plotDefinitions, farms, members, tiles);
  const treeProjector = new TreeStateProjector(dependencies.treeDefinitions, dependencies.clock);
  const treeIdempotency = new D1IdempotencyRepository(dependencies.db);
  const plantTree = new PlantTree({
    farms,
    members,
    tiles,
    trees,
    crops,
    inventory,
    idempotency: treeIdempotency,
    definitions: dependencies.treeDefinitions,
    progression: progressions,
    progressionDefinition: dependencies.progressionDefinition,
    terrain: dependencies.terrain,
    inventoryService,
    ids: dependencies.ids,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const harvestTree = new HarvestTree(
    farms,
    members,
    trees,
    inventory,
    treeIdempotency,
    treeHarvestSettlement,
    dependencies.treeDefinitions,
    inventoryService,
    progressions,
    dependencies.progressionDefinition,
    dependencies.fingerprints,
    dependencies.clock
  );
  const harvestTreeArea = new HarvestTreeAreaGroup(
    farms,
    members,
    trees,
    dependencies.treeDefinitions,
    harvestTree,
    new D1TreeHarvestBatchReceiptRepository(dependencies.db),
    dependencies.fingerprints,
    dependencies.clock
  );
  const plantTreeArea = new PlantTreeAreaGroup(
    farms,
    members,
    plantTree,
    new D1PlantBatchReceiptRepository(dependencies.db, "PLANT_TREE_AREA_GROUP"),
    dependencies.fingerprints,
    dependencies.clock
  );
  const removeTree = new RemoveTree(
    farms,
    members,
    trees,
    treeIdempotency,
    dependencies.fingerprints,
    dependencies.clock
  );
  const manageTree = new ManageTree({
    farms,
    members,
    tiles,
    trees,
    crops,
    constructions,
    terrain: dependencies.terrain,
    definitions: dependencies.treeDefinitions,
    idempotency: treeIdempotency,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const listTreeDefinitions = new ListTreeDefinitions(
    dependencies.treeDefinitions,
    dependencies.itemDefinitions
  );
  const listFarmTrees = new ListFarmTrees(farms, members, trees, treeProjector);
  /**
   * Construction: one use case for every buildable thing, and one list for the world to draw.
   *
   * The idempotency receipts live in their own repository because planting's rows are keyed by the
   * crop repository (`D1CropRepository` implements `IdempotencyRepository`); construction does not
   * write crops, so it reads and writes the general table directly.
   */
  const constructionIdempotency = new D1IdempotencyRepository(dependencies.db);
  const placeConstruction = new PlaceConstruction({
    farms,
    members,
    tiles,
    terrain: dependencies.terrain,
    constructions,
    definitions: dependencies.constructionDefinitions,
    progression: progressions,
    progressionDefinition: dependencies.progressionDefinition,
    wallets,
    currencies: dependencies.currencyDefinitions,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    idempotency: constructionIdempotency,
    ids: dependencies.ids,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  // Moving, turning and taking down share every dependency placing has, except the level and price
  // checks - an edit is not a purchase.
  const relocateConstruction = new RelocateConstruction({
    farms,
    members,
    tiles,
    terrain: dependencies.terrain,
    constructions,
    definitions: dependencies.constructionDefinitions,
    wallets,
    currencies: dependencies.currencyDefinitions,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    idempotency: constructionIdempotency,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const removeConstruction = new RemoveConstruction({
    farms,
    members,
    tiles,
    terrain: dependencies.terrain,
    constructions,
    definitions: dependencies.constructionDefinitions,
    wallets,
    currencies: dependencies.currencyDefinitions,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    idempotency: constructionIdempotency,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock,
    aquaculturePonds: aquaculturePondRepository
  });
  // The island's starter arrangement, seeded once per farm and never re-applied.
  const seedStarterWorld = new SeedStarterWorld({
    farms,
    constructions,
    definitions: dependencies.constructionDefinitions,
    world: dependencies.starterWorld,
    ids: dependencies.ids,
    clock: dependencies.clock
  });
  const storeConstruction = new StoreConstruction({
    farms,
    members,
    tiles,
    terrain: dependencies.terrain,
    constructions,
    definitions: dependencies.constructionDefinitions,
    wallets,
    currencies: dependencies.currencyDefinitions,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    idempotency: constructionIdempotency,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const restoreConstruction = new RestoreConstruction({
    farms,
    members,
    tiles,
    terrain: dependencies.terrain,
    constructions,
    definitions: dependencies.constructionDefinitions,
    wallets,
    currencies: dependencies.currencyDefinitions,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    idempotency: constructionIdempotency,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const listFarmConstructions = new ListFarmConstructions(farms, members, constructions, seedStarterWorld);
  const chopForestryConstruction = new ChopForestryConstruction({
    farms,
    members,
    constructions,
    definitions: dependencies.forestryConstructionDefinitions ?? NO_FORESTRY_CONSTRUCTION_DEFINITIONS,
    state: forestryConstructionStates,
    inventory,
    inventoryService,
    idempotency: constructionIdempotency,
    settlement: forestryConstructionStates,
    progression: progressions,
    progressionDefinition: dependencies.progressionDefinition,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const forestryDefinitions = dependencies.forestryConstructionDefinitions ?? NO_FORESTRY_CONSTRUCTION_DEFINITIONS;
  const decorateConstruction = async (construction: ConstructionInstance): Promise<ConstructionDTO> => {
    const state = await forestryConstructionStates.findByConstruction(construction.farmId, construction.id);
    const forestry = state === null ? undefined : toForestryConstructionDTO(state, forestryDefinitions, dependencies.clock.now()) ?? undefined;
    return toConstructionDTO(construction, forestry);
  };
  const expandFarm = new ExpandFarm({
    farms,
    members,
    tiles,
    plots: dependencies.plotDefinitions,
    progressions,
    progressionDefinition: dependencies.progressionDefinition,
    currencies: dependencies.currencyDefinitions,
    wallets,
    idempotency: crops,
    settlement: farmExpansionSettlement,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });
  const quoteLandCells = new QuoteLandCells({
    farms,
    members,
    tiles,
    plots: dependencies.plotDefinitions,
    progressions,
    progressionDefinition: dependencies.progressionDefinition,
    currencies: dependencies.currencyDefinitions,
    landSale: dependencies.landSale,
    clock: dependencies.clock
  });
  const buyLandCells = new BuyLandCells({
    farms,
    members,
    tiles,
    plots: dependencies.plotDefinitions,
    progressions,
    progressionDefinition: dependencies.progressionDefinition,
    currencies: dependencies.currencyDefinitions,
    landSale: dependencies.landSale,
    wallets,
    idempotency: crops,
    settlement: farmExpansionSettlement,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });

  /**
   * Fishing, when the host wired it.
   *
   * The action store and the settlement boundary are D1 adapters built from the same binding as the
   * rest; the catalogue, id source and entropy come from the caller, because the values belong to
   * game data and the randomness belongs to the platform.
   */
  const fishing = dependencies.fishing;
  const fishingActions = new D1FishingActionRepository(dependencies.db);
  const fishingSettlement = new D1FishingSettlementRepository(dependencies.db);
  const fishingCatalogue =
    fishing === undefined
      ? null
      : {
          list: new ListFishingCatalogue(fishing.catalogue),
          active: new GetActiveFishing(fishingActions, dependencies.clock),
          start: new StartFishing(
            new D1HomeIslandZoneResolver(farms),
            fishingActions,
            new D1IdempotencyRepository(dependencies.db),
            fishing.catalogue,
            fishing.ids,
            dependencies.fingerprints,
            dependencies.clock,
            fishingSpotStates,
            actorRepository
          ),
          settle: new SettleFishing(
            fishingActions,
            fishingSettlement,
            fishing.catalogue,
            inventory,
            new InventoryService(dependencies.itemDefinitions, dependencies.clock),
            progressions,
            dependencies.progressionDefinition,
            new D1IdempotencyRepository(dependencies.db),
            fishing.random,
            dependencies.fingerprints,
            dependencies.clock,
            // The warehouse may be unwired on a host that has no capacity concept; the pre-roll
            // space check is skipped then and the database guard (also absent) is the only authority.
            dependencies.warehouse === undefined ? undefined : warehouseRepository,
            dependencies.warehouse?.tiers,
            fishingSpotStates
          ),
          cancel: new CancelFishing(
            fishingActions,
            fishingSettlement,
            new D1IdempotencyRepository(dependencies.db),
            dependencies.fingerprints,
            dependencies.clock
          )
        };

  /**
   * Resource nodes, when the host wired them: the same shape as fishing, one level more generic.
   * Mining uses it today with `verb: "MINE"`, and forestry reuses the same use cases with `CHOP`.
   */
  const resourceActions = new D1ResourceActionRepository(dependencies.db);
  const resourceSettlement = new D1ResourceSettlementRepository(dependencies.db);
  const resourceNodeRoutes =
    resources === undefined
      ? null
      : {
          list: new ListResourceNodes(
            resources.catalogue,
            resourceStates,
            new D1HomeIslandZoneResolver(farms),
            dependencies.clock
          ),
          active: new GetActiveResourceAction(resourceActions, dependencies.clock),
          start: new StartResourceAction(
            new D1HomeIslandZoneResolver(farms),
            resources.catalogue,
            resourceStates,
            resourceActions,
            progressions,
            dependencies.progressionDefinition,
            new D1IdempotencyRepository(dependencies.db),
            resources.ids,
            dependencies.fingerprints,
            dependencies.clock,
            actorRepository
          ),
          settle: new SettleResourceAction(
            resourceActions,
            resourceSettlement,
            resources.catalogue,
            resourceStates,
            inventory,
            new InventoryService(dependencies.itemDefinitions, dependencies.clock),
            progressions,
            dependencies.progressionDefinition,
            new D1IdempotencyRepository(dependencies.db),
            resources.random,
            dependencies.fingerprints,
            dependencies.clock,
            dependencies.warehouse === undefined ? undefined : warehouseRepository,
            dependencies.warehouse?.tiers
          ),
          cancel: new CancelResourceAction(
            resourceActions,
            resourceSettlement,
            new D1IdempotencyRepository(dependencies.db),
            dependencies.fingerprints,
            dependencies.clock
          )
        };

  /**
   * Auto: control, the assignment policy, and the plan.
   *
   * D1 decides and explains; it does not act. Nothing here plants, harvests, travels, unloads or
   * buys, and the resolver it calls is pure. The routes answer `RESOURCE_NOT_FOUND` on a host that
   * has not wired the actor spine or the warehouse rather than guessing at a capacity, exactly like
   * the cargo routes beside them.
   */
  const workerAuto =
    workerExtras === null
      ? null
      : {
          // START also stamps the offline epoch's start, so the manual period before it is never
          // retroactively simulated by reconciliation.
          control: new SetActorControl({ ...workerExtras, travel: autoTravel }),
          policy: new SetAssignmentPolicy(workerExtras)
        };
  const resolveAutoPlan =
    workerExtras === null || dependencies.warehouse === undefined
      ? null
      : new ResolveAutoPlan({
          ...workerExtras,
          crops,
          trees,
          constructions,
          resourceStates,
          cargo: cargoRepository,
          inventory,
          warehouse: warehouseRepository,
          tiers: dependencies.warehouse.tiers,
          wallets,
          shops: dependencies.shopEntries
        });

  /**
   * The Auto executor: one bounded transition per call, driven by the client's own animation loop.
   *
   * It reuses the plan read above, the travel row, and the *existing* settlements - load, purchase,
   * unload, plant-from-cargo and harvest-into-cargo. It adds no economy, no reward and no rule of its
   * own, and it is wired only on a host that has the whole spine: without any one of these pieces the
   * step route answers `RESOURCE_NOT_FOUND` rather than half-working.
   */
  const autoIds = dependencies.workers?.ids ?? null;
  const mineResource =
    resources === undefined || dependencies.workAreas === undefined || autoIds === null || dependencies.cargoCapacities === undefined
      ? null
      : new MineResourceIntoCargoAuto({
          farms,
          members,
          actors: actorRepository,
          ids: autoIds,
          jobs: actorJobRepository,
          workAreas: workAreaRepository,
          catalogue: resources.catalogue,
          ground: dependencies.workAreas.ground,
          cargo: cargoRepository,
          itemDefinitions: dependencies.itemDefinitions,
          cargoCapacities: dependencies.cargoCapacities,
          idempotency: new D1IdempotencyRepository(dependencies.db),
          fingerprints: dependencies.fingerprints,
          clock: dependencies.clock,
          settlement: autoMiningSettlement
        });
  const unavailableMine = {
    executeAuto: () => Promise.reject(new ApplicationError("RESOURCE_NOT_FOUND", "Continuous Mining is not configured on this host"))
  };
  const advanceAuto =
    resolveAutoPlan === null ||
    autoIds === null ||
    loadCargo === null ||
    purchaseSupply === null ||
    unloadCargo === null ||
    fundAndPurchaseSupply === null ||
    dependencies.cargoCapacities === undefined
      ? null
      : new AdvanceAuto({
          farms,
          members,
          actors: actorRepository,
          ids: autoIds,
          cargoCapacities: dependencies.cargoCapacities,
          clock: dependencies.clock,
          plan: resolveAutoPlan,
          jobs: actorJobRepository,
          workAreas: workAreaRepository,
          tiles,
          crops,
          trees,
          constructions,
          cargo: cargoRepository,
          travel: autoTravel,
          shops: dependencies.shopEntries,
          targets: jobTargetCatalogue,
          anchorTiles: gameDataAutoAnchors,
          walk: gameDataWalk,
          actions: {
            load: loadCargo,
            purchase: purchaseSupply,
            funding: fundAndPurchaseSupply,
            unload: unloadCargo,
            plant: plantCrop,
            harvest: harvestCrop,
            mine: mineResource ?? unavailableMine
          }
        });

  /**
   * Lazy offline reconciliation.
   *
   * It owns no economic rule of its own: it drives the *same* `AdvanceAuto` the online loop uses, at
   * the instants it simulates, so every transition it settles goes through the B0.1/B1/B2 atomic
   * settlements. Wired only on a host that has the whole spine, like the step route itself.
   */
  const reconcileActorAuto =
    advanceAuto === null
      ? null
      : new ReconcileActorAuto({
          farms,
          members,
          actors: actorRepository,
          travel: autoTravel,
          advance: advanceAuto,
          clock: dependencies.clock
        });

  return async function handle(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    try {
      // A mutation a browser says came from somewhere else is refused before any identity is
      // resolved: this is what keeps a cookie-borne session from being driven by another site.
      if (rejectsCrossOriginRequest(request)) return failure("NOT_AUTHENTICATED", requestId);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, data: { status: "ok" } });
      }

      /**
       * Who the caller is - and, the first time, the credential that makes them them.
       *
       * The only route that may create an identity, and it is a safe GET: the page asks once at
       * boot, the server answers with the guest cookie when the deployment allows guest play, and
       * every other route only ever resolves an identity that already exists.
       */
      if (request.method === "GET" && url.pathname === "/session") {
        const session = dependencies.session;
        if (session === undefined) return failure("RESOURCE_NOT_FOUND", requestId);
        const established = await session.establish(request);
        if (established === null) return failure("NOT_AUTHENTICATED", requestId);
        const body: ApiSuccess<GetSessionResponse> = {
          ok: true,
          data: { player: { playerId: established.playerId, kind: established.kind } }
        };
        return jsonResponse(
          body,
          200,
          established.setCookie === undefined ? {} : { "set-cookie": established.setCookie }
        );
      }

      const actor: ActorContext | null = await dependencies.authenticator.authenticate(request);

      if (request.method === "GET" && url.pathname === "/neighbor") {
        const snapshot = await neighbor.snapshot(actor);
        return jsonResponse({ ok: true, data: { neighbor: toNeighborDTO(snapshot, dependencies.clock.now()) } });
      }
      if (request.method === "POST" && url.pathname === "/neighbor/travel") {
        const parsed = NeighborTravelRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const snapshot = await neighbor.travel(actor, parsed.data);
        return jsonResponse({ ok: true, data: { neighbor: toNeighborDTO(snapshot, dependencies.clock.now()) } });
      }
      if (request.method === "POST" && url.pathname === "/neighbor/talk") {
        const parsed = NeighborTalkRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await neighbor.talk(actor, parsed.data);
        return jsonResponse({ ok: true, data: { neighbor: toNeighborDTO(result.snapshot, dependencies.clock.now()), dialogueKey: result.dialogueKey } });
      }

      if (request.method === "POST" && url.pathname === "/farms") {
        const parsed = CreateFarmRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) {
          return failure("INVALID_INPUT", requestId);
        }
        const result = await createFarm.execute(actor, parsed.data);
        const body: ApiSuccess<{ farm: FarmDTO; membership: FarmMemberDTO }> = {
          ok: true,
          data: { farm: toFarmDTO(result.farm), membership: toMemberDTO(result.ownerMembership) }
        };
        // 201 the first time, 200 when the player already had their farm: a retry from a phone on a
        // flaky connection gets their farm back rather than a second, empty one.
        return jsonResponse(body, result.created ? 201 : 200);
      }

      if (request.method === "GET" && url.pathname === "/inventory") {
        const items = await getInventory.execute(actor);
        const body: ApiSuccess<{ items: InventoryEntryDTO[] }> = { ok: true, data: { items: [...items] } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/shop") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const entries: ShopEntryDTO[] = dependencies.shopEntries
          .list()
          .map((entry) =>
            toShopEntryDTO(entry, dependencies.itemDefinitions, dependencies.currencyDefinitions)
          );
        const body: ApiSuccess<{ entries: ShopEntryDTO[] }> = { ok: true, data: { entries } };
        return jsonResponse(body);
      }

      // The Island Warehouse. Status is a bounded read; the upgrade is the ledgered sink.
      if (warehouseStatus !== null && warehouseUpgrade !== null) {
        if (request.method === "GET" && url.pathname === "/warehouse") {
          const status = await warehouseStatus.execute(actor);
          const body: ApiSuccess<{ warehouse: WarehouseStatusDTO }> = {
            ok: true,
            data: { warehouse: toWarehouseDTO(status) }
          };
          return jsonResponse(body);
        }
        if (request.method === "POST" && url.pathname === "/warehouse/upgrade") {
          const parsed = UpgradeWarehouseRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const status = await warehouseUpgrade.execute(actor, parsed.data);
          const body: ApiSuccess<{ warehouse: WarehouseStatusDTO }> = {
            ok: true,
            data: { warehouse: toWarehouseDTO(status) }
          };
          return jsonResponse(body);
        }
      }

      const productionSettleRoute = /^\/farms\/([^/]+)\/production\/([^/]+)\/settle$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        productionSettleRoute?.[1] !== undefined &&
        productionSettleRoute[2] !== undefined
      ) {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const decodedFarm = decodePathSegment(productionSettleRoute[1]);
        const decodedAssignment = decodePathSegment(productionSettleRoute[2]);
        if (
          decodedFarm === null ||
          decodedAssignment === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !ProductionAssignmentIdSchema.safeParse(decodedAssignment).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = SettleProductionAssignmentRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await productionSettlement.execute({
          playerId: actor.playerId,
          farmId: parseFarmId(decodedFarm),
          assignmentId: decodedAssignment,
          requestId: parsed.data.requestId
        });
        const response: SettleProductionAssignmentResponse = {
          assignmentId: result.assignmentId,
          producedQuantity: result.producedQuantity,
          settledThrough: result.settledThrough,
          blockedReason: result.blockedReason as SettleProductionAssignmentResponse["blockedReason"],
          sourceDepleted: result.sourceDepleted,
          sourceRemaining: result.sourceRemaining
        };
        const body: ApiSuccess<{ settlement: SettleProductionAssignmentResponse }> = {
          ok: true,
          data: { settlement: response }
        };
        return jsonResponse(body);
      }

      const productionReconcileRoute = /^\/farms\/([^/]+)\/production\/reconcile$/.exec(url.pathname);
      if (request.method === "POST" && productionReconcileRoute?.[1] !== undefined) {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const decodedFarm = decodePathSegment(productionReconcileRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) return failure("INVALID_INPUT", requestId);
        const parsed = ReconcileFarmProductionRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await productionReconcile.execute(actor.playerId, parseFarmId(decodedFarm), actor);
        const response: ReconcileFarmProductionResponse = {
          settlements: result.settlements.map((settlement) => ({
            assignmentId: settlement.assignmentId,
            producedQuantity: settlement.producedQuantity,
            settledThrough: settlement.settledThrough,
            blockedReason: settlement.blockedReason as ReconcileFarmProductionResponse["settlements"][number]["blockedReason"],
            sourceDepleted: settlement.sourceDepleted,
            sourceRemaining: settlement.sourceRemaining
          })),
          producedItems: [...result.producedItems],
          blocked: [...result.blocked]
        };
        return jsonResponse({ ok: true, data: response });
      }

      const orchardVisualRoute = /^\/farms\/([^/]+)\/orchard\/visual$/.exec(url.pathname);
      if (request.method === "GET" && orchardVisualRoute?.[1] !== undefined) {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const decodedFarm = decodePathSegment(orchardVisualRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) return failure("INVALID_INPUT", requestId);
        const visual = new GetOrchardVisualSnapshot(farms, members, new D1ActorJobRepository(dependencies.db), new D1WorkAreaRepository(dependencies.db), trees, dependencies.treeDefinitions, dependencies.clock);
        const assignments = await visual.execute(actor, parseFarmId(decodedFarm));
        return jsonResponse({ ok: true, data: { assignments: [...assignments] } });
      }

      if (request.method === "GET" && url.pathname === "/wallet") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const balances: WalletDTO[] = (await wallets.listByPlayer(actor.playerId)).map((wallet) =>
          toWalletDTO(wallet, dependencies.currencyDefinitions)
        );
        const body: ApiSuccess<{ wallets: WalletDTO[] }> = { ok: true, data: { wallets: balances } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/progression") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const view: PlayerProgressionDTO = await getProgression.execute(actor);
        const body: ApiSuccess<{ progression: PlayerProgressionDTO }> = {
          ok: true,
          data: { progression: view }
        };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/crop-definitions") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const definitions: CropDefinitionDTO[] = [...listCropDefinitions.execute(actor)];
        const body: ApiSuccess<{ definitions: CropDefinitionDTO[] }> = {
          ok: true,
          data: { definitions }
        };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/tree-definitions") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const definitions: TreeDefinitionDTO[] = [...listTreeDefinitions.execute(actor)];
        const body: ApiSuccess<{ definitions: TreeDefinitionDTO[] }> = {
          ok: true,
          data: { definitions }
        };
        return jsonResponse(body);
      }

      /**
       * The build catalogue: what a player could place, and what the catalogue says it costs.
       *
       * Read-only, and deliberately *not* a purchase route. Placing something is a command the server
       * does not accept yet; this only lets the client show the ladder the deployment ships rather than
       * a list compiled into the bundle.
       */
      if (request.method === "GET" && url.pathname === "/build-catalog") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const entries: BuildCatalogEntryDTO[] = [...listBuildCatalog()];
        const body: ApiSuccess<{ entries: BuildCatalogEntryDTO[] }> = { ok: true, data: { entries } };
        return jsonResponse(body);
      }

      /**
       * The ordinary world objects a farm may hold.
       *
       * Read-only reference data, like the crop catalogue: it is what lets the client describe and
       * offer the right actions for a starter tree it never bought. It names no player state, so any
       * authenticated reader may have it.
       */
      if (request.method === "GET" && url.pathname === "/world-objects") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const objects: WorldObjectDefinitionDTO[] = [...listWorldObjectDefinitions()];
        const body: ApiSuccess<{ objects: WorldObjectDefinitionDTO[] }> = { ok: true, data: { objects } };
        return jsonResponse(body);
      }

      /**
       * Fishing.
       *
       * The catalogue is a pure projection of game data - the client draws the water and names the
       * species from it without the server reading a row. Starting names a spot and settles nothing;
       * settling names the server's own action and lets it choose the catch, the reward and the time.
       * A host that has not wired fishing answers `RESOURCE_NOT_FOUND`, like `/session`.
       */
      if (fishingCatalogue !== null && request.method === "GET" && url.pathname === "/fishing") {
        const catalogue = fishingCatalogue.list.execute(actor);
        const body: ApiSuccess<{ spots: FishingSpotDTO[]; fish: FishDefinitionDTO[] }> = {
          ok: true,
          data: {
            spots: catalogue.spots.map(toFishingSpotDTO),
            fish: catalogue.fish.map(toFishDefinitionDTO)
          }
        };
        return jsonResponse(body);
      }

      if (fishingCatalogue !== null && request.method === "GET" && url.pathname === "/fishing/active") {
        const action = await fishingCatalogue.active.execute(actor);
        const body: ApiSuccess<{ action: FishingActionDTO | null }> = {
          ok: true,
          data: { action: action === null ? null : toFishingActionDTO(action) }
        };
        return jsonResponse(body);
      }

      if (fishingCatalogue !== null && request.method === "POST" && url.pathname === "/fishing/start") {
        const parsed = StartFishingRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const action = await fishingCatalogue.start.execute(actor, parsed.data);
        const body: ApiSuccess<StartFishingResponse> = { ok: true, data: { action: toFishingActionDTO(action) } };
        return jsonResponse(body, 201);
      }

      const fishingSettleRoute = /^\/fishing\/([^/]+)\/settle$/.exec(url.pathname);
      if (fishingCatalogue !== null && request.method === "POST" && fishingSettleRoute?.[1] !== undefined) {
        const decodedActionId = decodePathSegment(fishingSettleRoute[1]);
        if (decodedActionId === null) return failure("INVALID_INPUT", requestId);
        const parsed = SettleFishingRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await fishingCatalogue.settle.execute(actor, {
          actionId: decodedActionId,
          expectedActionVersion: parsed.data.expectedActionVersion,
          requestId: parsed.data.requestId
        });
        const body: ApiSuccess<SettleFishingResponse> = { ok: true, data: result };
        return jsonResponse(body);
      }

      const fishingCancelRoute = /^\/fishing\/([^/]+)\/cancel$/.exec(url.pathname);
      if (fishingCatalogue !== null && request.method === "POST" && fishingCancelRoute?.[1] !== undefined) {
        const decodedActionId = decodePathSegment(fishingCancelRoute[1]);
        if (decodedActionId === null) return failure("INVALID_INPUT", requestId);
        const parsed = CancelFishingRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await fishingCatalogue.cancel.execute(actor, {
          actionId: decodedActionId,
          expectedActionVersion: parsed.data.expectedActionVersion,
          requestId: parsed.data.requestId
        });
        const body: ApiSuccess<{ cancelled: true }> = { ok: true, data: result };
        return jsonResponse(body);
      }

      /**
       * Resource nodes.
       *
       * The catalogue folds the actor's own zone's availability into the static placements, so the
       * client can draw a depleted node and count it down without polling. Starting names a node;
       * settling names the server's own action and lets it choose the drop, the experience, the
       * depletion and the regeneration clock. A host that has not wired gathering answers
       * `RESOURCE_NOT_FOUND`.
       */
      if (resourceNodeRoutes !== null && request.method === "GET" && url.pathname === "/resource-nodes") {
        const catalogue = await resourceNodeRoutes.list.execute(actor);
        const body: ApiSuccess<{ nodes: ResourceNodeDTO[] }> = {
          ok: true,
          data: { nodes: catalogue.nodes.map(toResourceNodeDTO) }
        };
        return jsonResponse(body);
      }

      if (
        resourceNodeRoutes !== null &&
        request.method === "GET" &&
        url.pathname === "/resource-actions/active"
      ) {
        const action = await resourceNodeRoutes.active.execute(actor);
        const body: ApiSuccess<{ action: ResourceActionDTO | null }> = {
          ok: true,
          data: { action: action === null ? null : toResourceActionDTO(action) }
        };
        return jsonResponse(body);
      }

      if (
        resourceNodeRoutes !== null &&
        request.method === "POST" &&
        url.pathname === "/resource-actions/start"
      ) {
        const parsed = StartResourceActionRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const action = await resourceNodeRoutes.start.execute(actor, parsed.data);
        const body: ApiSuccess<StartResourceActionResponse> = {
          ok: true,
          data: { action: toResourceActionDTO(action) }
        };
        return jsonResponse(body, 201);
      }

      const resourceSettleRoute = /^\/resource-actions\/([^/]+)\/settle$/.exec(url.pathname);
      if (resourceNodeRoutes !== null && request.method === "POST" && resourceSettleRoute?.[1] !== undefined) {
        const decodedActionId = decodePathSegment(resourceSettleRoute[1]);
        if (decodedActionId === null) return failure("INVALID_INPUT", requestId);
        const parsed = SettleResourceActionRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await resourceNodeRoutes.settle.execute(actor, {
          actionId: decodedActionId,
          expectedActionVersion: parsed.data.expectedActionVersion,
          requestId: parsed.data.requestId
        });
        const body: ApiSuccess<SettleResourceActionResponse> = { ok: true, data: result };
        return jsonResponse(body);
      }

      const resourceCancelRoute = /^\/resource-actions\/([^/]+)\/cancel$/.exec(url.pathname);
      if (resourceNodeRoutes !== null && request.method === "POST" && resourceCancelRoute?.[1] !== undefined) {
        const decodedActionId = decodePathSegment(resourceCancelRoute[1]);
        if (decodedActionId === null) return failure("INVALID_INPUT", requestId);
        const parsed = CancelResourceActionRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await resourceNodeRoutes.cancel.execute(actor, {
          actionId: decodedActionId,
          expectedActionVersion: parsed.data.expectedActionVersion,
          requestId: parsed.data.requestId
        });
        const body: ApiSuccess<{ cancelled: true }> = { ok: true, data: result };
        return jsonResponse(body);
      }

      if (request.method === "POST" && (url.pathname === "/shop/buy" || url.pathname === "/shop/sell")) {
        const schema = url.pathname === "/shop/buy" ? BuyItemRequestSchema : SellItemRequestSchema;
        const parsed = schema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        if (url.pathname === "/shop/buy") {
          const settlement: BuyItemResultDTO = await buyItem.execute(actor, parsed.data);
          return jsonResponse({ ok: true, data: { settlement } });
        }
        const settlement: SellItemResultDTO = await sellItem.execute(actor, parsed.data);
        return jsonResponse({ ok: true, data: { settlement } });
      }

      const harvestRoute = /^\/farms\/([^/]+)\/crops\/([^/]+)\/harvest$/.exec(url.pathname);
      if (request.method === "POST" && harvestRoute?.[1] !== undefined && harvestRoute[2] !== undefined) {
        const decodedFarmId = decodePathSegment(harvestRoute[1]);
        const decodedCropId = decodePathSegment(harvestRoute[2]);
        if (
          decodedFarmId === null ||
          decodedCropId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !CropInstanceIdSchema.safeParse(decodedCropId).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = HarvestCropRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await harvestCrop.execute(actor, parseFarmId(decodedFarmId), {
          ...parsed.data,
          cropInstanceId: decodedCropId
        });
        const body: ApiSuccess<{ harvest: HarvestResultDTO; progression: XpAwardDTO }> = {
          ok: true,
          data: result
        };
        return jsonResponse(body);
      }

      const cropHarvestAreaRoute = /^\/farms\/([^/]+)\/crops\/harvest-area$/.exec(url.pathname);
      if (request.method === "POST" && cropHarvestAreaRoute?.[1] !== undefined) {
        const decodedFarmId = decodePathSegment(cropHarvestAreaRoute[1]);
        if (decodedFarmId === null || !FarmIdSchema.safeParse(decodedFarmId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = HarvestCropAreaRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await harvestCropArea.execute(actor, parseFarmId(decodedFarmId), parsed.data);
        const response: HarvestCropAreaGroupResponse = {
          results: [...result.results],
          harvestedCount: result.harvestedCount,
          skippedCount: result.skippedCount,
          products: [...result.products]
        };
        return jsonResponse({ ok: true, data: response });
      }

      const uprootRoute = /^\/farms\/([^/]+)\/crops\/([^/]+)\/uproot$/.exec(url.pathname);
      if (request.method === "POST" && uprootRoute?.[1] !== undefined && uprootRoute[2] !== undefined) {
        const decodedFarmId = decodePathSegment(uprootRoute[1]);
        const decodedCropId = decodePathSegment(uprootRoute[2]);
        if (
          decodedFarmId === null ||
          decodedCropId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !CropInstanceIdSchema.safeParse(decodedCropId).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = UprootCropRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const removed = await uprootCrop.execute(actor, parseFarmId(decodedFarmId), {
          ...parsed.data,
          cropInstanceId: decodedCropId
        });
        const body: ApiSuccess<UprootCropResponse> = { ok: true, data: { removed } };
        return jsonResponse(body);
      }

      const cropRoute = /^\/farms\/([^/]+)\/crops$/.exec(url.pathname);
      if (cropRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(cropRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedId);
        if (request.method === "POST") {
          const parsed = PlantCropRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const crop = await plantCrop.execute(actor, farmId, parsed.data);
          const body: ApiSuccess<{ crop: CropStateDTO }> = { ok: true, data: { crop } };
          return jsonResponse(body, 201);
        }
        if (request.method === "GET") {
          const cropStates = await getFarmCrops.execute(actor, farmId);
          const body: ApiSuccess<{ crops: CropStateDTO[] }> = { ok: true, data: { crops: [...cropStates] } };
          return jsonResponse(body);
        }
      }

      const cropPlantAreaRoute = /^\/farms\/([^/]+)\/crops\/plant-area$/.exec(url.pathname);
      if (request.method === "POST" && cropPlantAreaRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(cropPlantAreaRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) return failure("INVALID_INPUT", requestId);
        const parsed = PlantCropAreaRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await plantCropArea.execute(actor, parseFarmId(decodedId), parsed.data);
        return jsonResponse({ ok: true, data: result }, 201);
      }

      const treeManagementRoute = /^\/farms\/([^/]+)\/trees\/([^/]+)\/(move|rotate|store|restore)$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        treeManagementRoute?.[1] !== undefined &&
        treeManagementRoute[2] !== undefined &&
        treeManagementRoute[3] !== undefined
      ) {
        const decodedFarmId = decodePathSegment(treeManagementRoute[1]);
        const decodedTreeId = decodePathSegment(treeManagementRoute[2]);
        if (
          decodedFarmId === null || decodedTreeId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !TreeInstanceIdSchema.safeParse(decodedTreeId).success
        ) return failure("INVALID_INPUT", requestId);
        const farmId = parseFarmId(decodedFarmId);
        const operation = treeManagementRoute[3];
        if (operation === "move") {
          const parsed = MoveTreeRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const tree = await manageTree.move(actor, farmId, { ...parsed.data, treeInstanceId: decodedTreeId });
          return jsonResponse({ ok: true, data: { tree } });
        }
        if (operation === "rotate") {
          const parsed = RotateTreeRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const tree = await manageTree.rotate(actor, farmId, { ...parsed.data, treeInstanceId: decodedTreeId });
          return jsonResponse({ ok: true, data: { tree } });
        }
        if (operation === "store") {
          const parsed = StoreTreeRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const tree = await manageTree.store(actor, farmId, { ...parsed.data, treeInstanceId: decodedTreeId });
          return jsonResponse({ ok: true, data: { tree } });
        }
        const parsed = RestoreTreeRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const tree = await manageTree.restore(actor, farmId, { ...parsed.data, treeInstanceId: decodedTreeId });
        return jsonResponse({ ok: true, data: { tree } });
      }

      const treeHarvestRoute = /^\/farms\/([^/]+)\/trees\/([^/]+)\/harvest$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        treeHarvestRoute?.[1] !== undefined &&
        treeHarvestRoute[2] !== undefined
      ) {
        const decodedFarmId = decodePathSegment(treeHarvestRoute[1]);
        const decodedTreeId = decodePathSegment(treeHarvestRoute[2]);
        if (
          decodedFarmId === null ||
          decodedTreeId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !TreeInstanceIdSchema.safeParse(decodedTreeId).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = HarvestTreeRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await harvestTree.execute(actor, parseFarmId(decodedFarmId), {
          ...parsed.data,
          treeInstanceId: decodedTreeId
        });
        const body: ApiSuccess<{ harvest: TreeHarvestResultDTO; progression: XpAwardDTO }> = {
          ok: true,
          data: result
        };
        return jsonResponse(body);
      }

      const treeHarvestAreaRoute = /^\/farms\/([^/]+)\/trees\/harvest-area$/.exec(url.pathname);
      if (request.method === "POST" && treeHarvestAreaRoute?.[1] !== undefined) {
        const decodedFarmId = decodePathSegment(treeHarvestAreaRoute[1]);
        if (decodedFarmId === null || !FarmIdSchema.safeParse(decodedFarmId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = HarvestTreeAreaRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await harvestTreeArea.execute(actor, parseFarmId(decodedFarmId), parsed.data);
        const response: HarvestTreeAreaGroupResponse = {
          results: [...result.results],
          harvestedCount: result.harvestedCount,
          skippedCount: result.skippedCount,
          products: [...result.products]
        };
        return jsonResponse({ ok: true, data: response });
      }

      const treeRemoveRoute = /^\/farms\/([^/]+)\/trees\/([^/]+)\/remove$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        treeRemoveRoute?.[1] !== undefined &&
        treeRemoveRoute[2] !== undefined
      ) {
        const decodedFarmId = decodePathSegment(treeRemoveRoute[1]);
        const decodedTreeId = decodePathSegment(treeRemoveRoute[2]);
        if (
          decodedFarmId === null ||
          decodedTreeId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !TreeInstanceIdSchema.safeParse(decodedTreeId).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = RemoveTreeRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const removed = await removeTree.execute(actor, parseFarmId(decodedFarmId), {
          ...parsed.data,
          treeInstanceId: decodedTreeId
        });
        const body: ApiSuccess<RemoveTreeResponse> = { ok: true, data: { removed } };
        return jsonResponse(body);
      }

      const treesRoute = /^\/farms\/([^/]+)\/trees$/.exec(url.pathname);
      if (treesRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(treesRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedId);
        if (request.method === "POST") {
          const parsed = PlantTreeRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const tree = await plantTree.execute(actor, farmId, parsed.data);
          const body: ApiSuccess<{ tree: TreeStateDTO }> = { ok: true, data: { tree } };
          return jsonResponse(body, 201);
        }
        if (request.method === "GET") {
          const treeStates = await listFarmTrees.execute(actor, farmId);
          const body: ApiSuccess<{ trees: TreeStateDTO[] }> = {
            ok: true,
            data: { trees: [...treeStates] }
          };
          return jsonResponse(body);
        }
      }

      const treePlantAreaRoute = /^\/farms\/([^/]+)\/trees\/plant-area$/.exec(url.pathname);
      if (request.method === "POST" && treePlantAreaRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(treePlantAreaRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) return failure("INVALID_INPUT", requestId);
        const parsed = PlantTreeAreaRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await plantTreeArea.execute(actor, parseFarmId(decodedId), parsed.data);
        return jsonResponse({ ok: true, data: result }, 201);
      }

      /**
       * Construction: build something, or read what has been built.
       *
       * The body carries which catalogue entry and where; everything else - price, level, footprint,
       * ground, collisions, funds - is derived here from the catalogue and the farm's own rows.
       */
      const constructionsRoute = /^\/farms\/([^/]+)\/constructions$/.exec(url.pathname);
      if (constructionsRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(constructionsRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedId);
        if (request.method === "POST") {
          const parsed = PlaceConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const construction = await placeConstruction.execute(actor, farmId, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: await decorateConstruction(construction) }
          };
          return jsonResponse(body, 201);
        }
        if (request.method === "GET") {
          const built = await listFarmConstructions.execute(actor, farmId);
          const body: ApiSuccess<{ constructions: ConstructionDTO[] }> = {
            ok: true,
            data: { constructions: await Promise.all(built.map(decorateConstruction)) }
          };
          return jsonResponse(body);
        }
      }

      /**
       * Aquaculture is a manual, discrete lifecycle attached to the existing water-cage construction.
       * Reads are bounded to this farm's ponds; time is projected from the server clock and no polling
       * or production-rate settlement is performed here.
       */
      const aquacultureListRoute = /^\/farms\/([^/]+)\/aquaculture\/ponds$/.exec(url.pathname);
      if (aquacultureListRoute?.[1] !== undefined) {
        const decodedFarm = decodePathSegment(aquacultureListRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) return failure("INVALID_INPUT", requestId);
        if (request.method !== "GET") return failure("INVALID_INPUT", requestId);
        const ponds = await listAquaculturePonds.execute(actor, parseFarmId(decodedFarm));
        const body: ApiSuccess<{ ponds: AquaculturePondDTO[] }> = {
          ok: true,
          data: { ponds: ponds.map(toAquaculturePondDTO) }
        };
        return jsonResponse(body);
      }

      const aquacultureActionRoute = /^\/farms\/([^/]+)\/aquaculture\/ponds\/([^/]+)\/(stock|harvest|withdraw)$/.exec(url.pathname);
      if (aquacultureActionRoute?.[1] !== undefined && aquacultureActionRoute[2] !== undefined && aquacultureActionRoute[3] !== undefined) {
        const decodedFarm = decodePathSegment(aquacultureActionRoute[1]);
        const decodedPond = decodePathSegment(aquacultureActionRoute[2]);
        if (
          decodedFarm === null ||
          decodedPond === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !AquacultureConstructionIdSchema.safeParse(decodedPond).success
        ) return failure("INVALID_INPUT", requestId);
        if (request.method !== "POST") return failure("INVALID_INPUT", requestId);
        const parsed = AquaculturePondCommandSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const farmId = parseFarmId(decodedFarm);
        const pond = aquacultureActionRoute[3] === "stock"
          ? await stockAquaculturePond.execute(actor, farmId, decodedPond, parsed.data)
          : aquacultureActionRoute[3] === "harvest"
            ? await harvestAquaculturePond.execute(actor, farmId, decodedPond, parsed.data)
            : await withdrawAquaculturePond.execute(actor, farmId, decodedPond, parsed.data);
        const body: ApiSuccess<{ pond: AquaculturePondDTO }> = { ok: true, data: { pond: toAquaculturePondDTO(pond) } };
        return jsonResponse(body);
      }

      const forestryConstructionActionRoute = /^\/farms\/([^/]+)\/forestry\/constructions\/([^/]+)\/chop$/.exec(url.pathname);
      if (forestryConstructionActionRoute?.[1] !== undefined && forestryConstructionActionRoute[2] !== undefined) {
        const decodedFarm = decodePathSegment(forestryConstructionActionRoute[1]);
        const decodedConstruction = decodePathSegment(forestryConstructionActionRoute[2]);
        if (decodedFarm === null || decodedConstruction === null || !FarmIdSchema.safeParse(decodedFarm).success || !ConstructionIdSchema.safeParse(decodedConstruction).success) {
          return failure("INVALID_INPUT", requestId);
        }
        if (request.method !== "POST") return failure("INVALID_INPUT", requestId);
        const parsed = ForestryConstructionChopRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await chopForestryConstruction.execute(actor, parseFarmId(decodedFarm), decodedConstruction, parsed.data);
        const body: ApiSuccess<ForestryConstructionChopResponse> = { ok: true, data: result };
        return jsonResponse(body);
      }

      /**
       * Editing one built thing: move it, turn it, take it down.
       *
       * The object is named by its own id and the command carries the version the client is looking
       * at. Everything else - the footprint, the ground, the refund - is the server's to decide, so a
       * request cannot name a price, a refund or an owner.
       */
      const constructionEditRoute =
        /^\/farms\/([^/]+)\/constructions\/([^/]+)\/(move|rotate|remove|store|restore)$/.exec(url.pathname);
      if (constructionEditRoute?.[1] !== undefined && constructionEditRoute[2] !== undefined && constructionEditRoute[3] !== undefined) {
        const decodedFarm = decodePathSegment(constructionEditRoute[1]);
        const decodedObject = decodePathSegment(constructionEditRoute[2]);
        // The id in the path is attacker-controlled like everything else: it is checked against the
        // one shape the server mints *here*, so a malformed url is a 400 rather than a domain error
        // that would surface as an internal one.
        if (
          decodedFarm === null ||
          decodedObject === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !ConstructionIdSchema.safeParse(decodedObject).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedFarm);
        const operation = constructionEditRoute[3];
        if (request.method !== "POST") return failure("INVALID_INPUT", requestId);
        if (operation === "move") {
          const parsed = MoveConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const moved = await relocateConstruction.move(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: await decorateConstruction(moved) }
          };
          return jsonResponse(body);
        }
        if (operation === "rotate") {
          const parsed = RotateConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const turned = await relocateConstruction.rotate(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: await decorateConstruction(turned) }
          };
          return jsonResponse(body);
        }
        if (operation === "store") {
          const parsed = StoreConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const stored = await storeConstruction.execute(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: await decorateConstruction(stored) }
          };
          return jsonResponse(body);
        }
        if (operation === "restore") {
          const parsed = RestoreConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const restored = await restoreConstruction.execute(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: await decorateConstruction(restored) }
          };
          return jsonResponse(body);
        }
        const parsed = RemoveConstructionRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const removed = await removeConstruction.execute(actor, farmId, decodedObject, parsed.data);
        const body: ApiSuccess<RemoveConstructionResponse> = { ok: true, data: removed };
        return jsonResponse(body);
      }

      const plotsRoute = /^\/farms\/([^/]+)\/plots$/.exec(url.pathname);
      if (plotsRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(plotsRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) return failure("INVALID_INPUT", requestId);
        const farmId = parseFarmId(decodedId);
        if (request.method === "GET") {
          const plots: PlotDTO[] = (await listPlots.execute(actor, farmId)).map((view) =>
            toPlotDTO(view, dependencies.currencyDefinitions)
          );
          return jsonResponse({ ok: true, data: { plots } });
        }
        if (request.method === "POST") {
          const parsed = ExpandFarmRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const expansion: ExpandFarmResultDTO = await expandFarm.execute(actor, farmId, parsed.data);
          return jsonResponse({ ok: true, data: { expansion } });
        }
      }

      const landQuoteRoute = /^\/farms\/([^/]+)\/land\/quote$/.exec(url.pathname);
      if (request.method === "POST" && landQuoteRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(landQuoteRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = QuoteLandCellsRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await quoteLandCells.execute(actor, parseFarmId(decodedId), parsed.data);
        const quote: LandQuoteDTO = { cells: [...result.cells], totalPrice: result.totalPrice, currencyId: result.currencyId };
        return jsonResponse({ ok: true, data: { quote } });
      }

      const landCellsRoute = /^\/farms\/([^/]+)\/land\/cells$/.exec(url.pathname);
      if (request.method === "POST" && landCellsRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(landCellsRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = BuyLandCellsRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await buyLandCells.execute(actor, parseFarmId(decodedId), parsed.data);
        const purchase: BuyLandCellsResultDTO = { ...result, cells: [...result.cells] };
        return jsonResponse({ ok: true, data: { purchase } });
      }

      /**
       * Work areas: player-named groups of cells a future Job may be asked to work.
       *
       * The farm comes from the route, the role from the authenticated actor's membership, and the
       * zone from the farm itself. The body carries a name, a kind and cells - never an owner, a
       * role, a zone or a server version the client would be trusted to be right about, and never a
       * price: naming an area is free.
       */
      const workAreaListRoute = /^\/farms\/([^/]+)\/work-areas$/.exec(url.pathname);
      if (workAreaListRoute?.[1] !== undefined) {
        const decodedFarm = decodePathSegment(workAreaListRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedFarm);
        if (request.method === "GET") {
          if (listWorkAreas === null) return failure("RESOURCE_NOT_FOUND", requestId);
          const areas = await listWorkAreas.execute(actor, farmId);
          const body: ApiSuccess<{ workAreas: WorkAreaSummaryDTO[] }> = {
            ok: true,
            data: { workAreas: [...areas] }
          };
          return jsonResponse(body);
        }
        if (request.method === "POST") {
          if (createWorkArea === null) return failure("RESOURCE_NOT_FOUND", requestId);
          const parsed = CreateWorkAreaRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const area = await createWorkArea.execute(actor, farmId, parsed.data);
          const body: ApiSuccess<{ workArea: WorkAreaDTO }> = { ok: true, data: { workArea: toWorkAreaDTO(area) } };
          return jsonResponse(body, 201);
        }
      }

      const workAreaItemRoute = /^\/farms\/([^/]+)\/work-areas\/([^/]+)$/.exec(url.pathname);
      if (
        request.method === "GET" &&
        workAreaItemRoute?.[1] !== undefined &&
        workAreaItemRoute[2] !== undefined
      ) {
        if (getWorkArea === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(workAreaItemRoute[1]);
        const decodedArea = decodePathSegment(workAreaItemRoute[2]);
        if (
          decodedFarm === null ||
          decodedArea === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !WorkAreaIdSchema.safeParse(decodedArea).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const area = await getWorkArea.execute(actor, parseFarmId(decodedFarm), parseWorkAreaId(decodedArea));
        const body: ApiSuccess<{ workArea: WorkAreaDTO }> = { ok: true, data: { workArea: toWorkAreaDTO(area) } };
        return jsonResponse(body);
      }

      const workAreaActionRoute = /^\/farms\/([^/]+)\/work-areas\/([^/]+)\/(rename|cells|delete)$/.exec(
        url.pathname
      );
      if (
        request.method === "POST" &&
        workAreaActionRoute?.[1] !== undefined &&
        workAreaActionRoute[2] !== undefined &&
        workAreaActionRoute[3] !== undefined
      ) {
        if (renameWorkArea === null || replaceWorkAreaCells === null || deleteWorkArea === null) {
          return failure("RESOURCE_NOT_FOUND", requestId);
        }
        const action = workAreaActionRoute[3];
        const decodedFarm = decodePathSegment(workAreaActionRoute[1]);
        const decodedArea = decodePathSegment(workAreaActionRoute[2]);
        if (
          decodedFarm === null ||
          decodedArea === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !WorkAreaIdSchema.safeParse(decodedArea).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedFarm);
        const workAreaId = parseWorkAreaId(decodedArea);
        if (action === "rename") {
          const parsed = RenameWorkAreaRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const area = await renameWorkArea.execute(actor, farmId, workAreaId, parsed.data);
          const body: ApiSuccess<{ workArea: WorkAreaDTO }> = { ok: true, data: { workArea: toWorkAreaDTO(area) } };
          return jsonResponse(body);
        }
        if (action === "cells") {
          const parsed = ReplaceWorkAreaCellsRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const area = await replaceWorkAreaCells.execute(actor, farmId, workAreaId, parsed.data);
          const body: ApiSuccess<{ workArea: WorkAreaDTO }> = { ok: true, data: { workArea: toWorkAreaDTO(area) } };
          return jsonResponse(body);
        }
        const parsed = DeleteWorkAreaRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const removed = await deleteWorkArea.execute(actor, farmId, workAreaId, parsed.data);
        const body: ApiSuccess<{ workAreaId: string }> = { ok: true, data: { workAreaId: removed.workAreaId } };
        return jsonResponse(body);
      }

      /**
       * Workers: the farm owner's Main Character and its configured jobs.
       *
       * This is configuration, never execution. Creating a job plants nothing, harvests nothing,
       * moves nobody and writes no inventory, experience, gold or warehouse row - and no route here
       * accepts an owner, a control mode, a cost or a reward from the client.
       */
      const workersRoute = /^\/farms\/([^/]+)\/workers$/.exec(url.pathname);
      if (request.method === "GET" && workersRoute?.[1] !== undefined) {
        if (resolveWorkers === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(workersRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const panel = await resolveWorkers.execute(actor, parseFarmId(decodedFarm));
        const body: ApiSuccess<{ actor: ActorDTO; jobs: JobDTO[] }> = {
          ok: true,
          data: { actor: panel.actor, jobs: panel.jobs.map(toJobDTO) }
        };
        return jsonResponse(body);
      }

      /**
       * Auto control: START_AUTO / STOP_AUTO on the farm owner's Main Character.
       *
       * The client sends the *intent* and the actor version it read; the server derives the actor, the
       * mode, and the write. Switching control plants nothing, spends nothing, moves nothing and
       * changes no assignment - it is one column on the actor row.
       */
      const actorControlRoute = /^\/farms\/([^/]+)\/workers\/control$/.exec(url.pathname);
      if (request.method === "POST" && actorControlRoute?.[1] !== undefined) {
        if (workerAuto === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(actorControlRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = SetActorControlRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const control = await workerAuto.control.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ actor: ActorControlDTO }> = { ok: true, data: { actor: control } };
        return jsonResponse(body);
      }

      /**
       * The negative counterpart of loading: instead of asking Auto, ask it *not* to buy.
       *
       * This is the same assignment row, one boolean, and nothing moves.
       */
      const assignmentPolicyRoute = /^\/farms\/([^/]+)\/assignments\/([^/]+)\/policy$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        assignmentPolicyRoute?.[1] !== undefined &&
        assignmentPolicyRoute[2] !== undefined
      ) {
        if (workerAuto === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(assignmentPolicyRoute[1]);
        const decodedJob = decodePathSegment(assignmentPolicyRoute[2]);
        if (
          decodedFarm === null ||
          decodedJob === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !JobIdSchema.safeParse(decodedJob).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = SetAssignmentPolicyRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const job = await workerAuto.policy.execute(actor, parseFarmId(decodedFarm), parseJobId(decodedJob), {
          requestId: parsed.data.requestId,
          autoPurchaseSupplies: parsed.data.autoPurchaseSupplies,
          expectedVersion: parsed.data.expectedVersion,
          ...(parsed.data.funding === undefined
            ? {}
            : { funding: { enabled: parsed.data.funding.enabled, items: [...parsed.data.funding.items] } })
        });
        const body: ApiSuccess<{ job: JobDTO }> = { ok: true, data: { job: toJobDTO(job) } };
        return jsonResponse(body);
      }

      /**
       * The plan: what Auto would do next, and why, for every assignment on the actor.
       *
       * A read. It answers with a plan even while the player is driving - which is the whole point of
       * showing it - and it performs none of the steps it names.
       */
      const autoPlanRoute = /^\/farms\/([^/]+)\/auto-plan$/.exec(url.pathname);
      if (request.method === "GET" && autoPlanRoute?.[1] !== undefined) {
        if (resolveAutoPlan === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(autoPlanRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const plan = await resolveAutoPlan.execute(actor, parseFarmId(decodedFarm));
        const body: ApiSuccess<{ plan: AutoPlanDTO }> = { ok: true, data: { plan: toAutoPlanDTO(plan) } };
        return jsonResponse(body);
      }

      /**
       * Advance Auto by one bounded step.
       *
       * The client sends a request id and nothing else: not a target, not a cell, not a quantity, not
       * a claim to have arrived. The server re-resolves from the world, records a walk with the time it
       * lands, or performs exactly one authoritative settlement - and answers with what happened so
       * the client can animate it and come back.
       */
      const autoStepRoute = /^\/farms\/([^/]+)\/auto\/step$/.exec(url.pathname);
      if (request.method === "POST" && autoStepRoute?.[1] !== undefined) {
        if (advanceAuto === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(autoStepRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = AutoStepRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const farmId = parseFarmId(decodedFarm);
        const step = await advanceAuto.execute(actor, farmId, parsed.data);
        // A settled step moved the hands: answer with the container in the same response rather than
        // making every beat cost the client a second `/cargo` request.
        const container = step.phase === "WORKED" && getActorCargo !== null
          ? toCargoDTO(await getActorCargo.execute(actor, farmId))
          : null;
        const body: ApiSuccess<{ step: AutoStepDTO; container: CargoDTO | null }> = {
          ok: true,
          data: { step: toAutoStepDTO(step), container }
        };
        return jsonResponse(body);
      }

      /**
       * The bounded reconciliation entrypoint.
       *
       * The client calls this once when it enters or resumes the game - never on the growth poll.
       * The body is a request id and nothing else; the server decides how much elapsed Auto time it
       * may settle, and answers with exactly how far the timeline is now settled. A second call, a
       * second tab or a retry is safe: the settlements' own guards make one timeline win.
       */
      const autoReconcileRoute = /^\/farms\/([^/]+)\/auto\/reconcile$/.exec(url.pathname);
      if (request.method === "POST" && autoReconcileRoute?.[1] !== undefined) {
        if (reconcileActorAuto === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(autoReconcileRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = AutoStepRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const reconciled = await reconcileActorAuto.execute(actor, parseFarmId(decodedFarm));
        const reconciliation: AutoReconcileDTO = {
          startedAt: reconciled.startedAt,
          targetAt: reconciled.targetAt,
          reconciledThrough: reconciled.reconciledThrough,
          elapsedConsumedSeconds: reconciled.elapsedConsumedSeconds,
          transitionsProcessed: reconciled.transitionsProcessed,
          economicSettlements: reconciled.economicSettlements,
          steps: reconciled.steps,
          stopReason: reconciled.stopReason,
          budgetExhausted: reconciled.budgetExhausted,
          budget: { transitions: reconciled.budget.transitions, steps: reconciled.budget.steps }
        };
        const body: ApiSuccess<{ reconciliation: AutoReconcileDTO }> = { ok: true, data: { reconciliation } };
        return jsonResponse(body);
      }

      const jobsRoute = /^\/farms\/([^/]+)\/jobs$/.exec(url.pathname);
      if (request.method === "POST" && jobsRoute?.[1] !== undefined) {
        if (createJob === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(jobsRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = CreateJobRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const job = await createJob.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ job: JobDTO }> = { ok: true, data: { job: toJobDTO(job) } };
        return jsonResponse(body, 201);
      }

      const jobOrderRoute = /^\/farms\/([^/]+)\/jobs\/order$/.exec(url.pathname);
      if (request.method === "POST" && jobOrderRoute?.[1] !== undefined) {
        if (reorderJobs === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(jobOrderRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = ReorderJobsRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const jobs = await reorderJobs.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ jobs: JobDTO[] }> = { ok: true, data: { jobs: jobs.map(toJobDTO) } };
        return jsonResponse(body);
      }

      const jobActionRoute = /^\/farms\/([^/]+)\/jobs\/([^/]+)\/(target|enabled|delete)$/.exec(url.pathname);
      if (
        request.method === "POST" &&
        jobActionRoute?.[1] !== undefined &&
        jobActionRoute[2] !== undefined &&
        jobActionRoute[3] !== undefined
      ) {
        if (updateJobTarget === null || setJobEnabled === null || deleteJob === null) {
          return failure("RESOURCE_NOT_FOUND", requestId);
        }
        const action = jobActionRoute[3];
        const decodedFarm = decodePathSegment(jobActionRoute[1]);
        const decodedJob = decodePathSegment(jobActionRoute[2]);
        if (
          decodedFarm === null ||
          decodedJob === null ||
          !FarmIdSchema.safeParse(decodedFarm).success ||
          !JobIdSchema.safeParse(decodedJob).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedFarm);
        const jobId = parseJobId(decodedJob);
        if (action === "target") {
          const parsed = UpdateJobTargetRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const job = await updateJobTarget.execute(actor, farmId, jobId, parsed.data);
          const body: ApiSuccess<{ job: JobDTO }> = { ok: true, data: { job: toJobDTO(job) } };
          return jsonResponse(body);
        }
        if (action === "enabled") {
          const parsed = SetJobEnabledRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const job = await setJobEnabled.execute(actor, farmId, jobId, parsed.data);
          const body: ApiSuccess<{ job: JobDTO }> = { ok: true, data: { job: toJobDTO(job) } };
          return jsonResponse(body);
        }
        const parsed = DeleteJobRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const removed = await deleteJob.execute(actor, farmId, jobId, parsed.data);
        const body: ApiSuccess<{ jobId: string }> = { ok: true, data: { jobId: removed.jobId } };
        return jsonResponse(body);
      }

      /**
       * Actor cargo: what the farm owner's Main Character is carrying, and the one authoritative way
       * it reaches the warehouse.
       *
       * The destination is derived from the farm's owner; the client sends a cargo version and a
       * request id and nothing else. A transfer is all-or-nothing: if the warehouse cannot take the
       * whole load, the cargo stays on the actor and nothing is moved.
       */
      const cargoRoute = /^\/farms\/([^/]+)\/cargo$/.exec(url.pathname);
      if (request.method === "GET" && cargoRoute?.[1] !== undefined) {
        if (getActorCargo === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(cargoRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const cargo = await getActorCargo.execute(actor, parseFarmId(decodedFarm));
        const body: ApiSuccess<{ cargo: CargoDTO }> = { ok: true, data: { cargo: toCargoDTO(cargo) } };
        return jsonResponse(body);
      }

      const cargoUnloadRoute = /^\/farms\/([^/]+)\/cargo\/unload$/.exec(url.pathname);
      if (request.method === "POST" && cargoUnloadRoute?.[1] !== undefined) {
        if (unloadCargo === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(cargoUnloadRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = UnloadCargoRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const cargo = await unloadCargo.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ cargo: CargoDTO }> = { ok: true, data: { cargo: toCargoDTO(cargo) } };
        return jsonResponse(body);
      }

      /**
       * The two physical supply movements: warehouse -> cargo, and shop -> cargo.
       *
       * Neither is a way to create an item: the first is a conservation transfer out of stock the
       * player already owns, and the second is an ordinary purchase at the catalogue's own price that
       * happens to be taken in hand. There is still no cargo grant route.
       */
      const cargoLoadRoute = /^\/farms\/([^/]+)\/cargo\/load$/.exec(url.pathname);
      if (request.method === "POST" && cargoLoadRoute?.[1] !== undefined) {
        if (loadCargo === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(cargoLoadRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = LoadCargoRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const cargo = await loadCargo.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ cargo: CargoDTO }> = { ok: true, data: { cargo: toCargoDTO(cargo) } };
        return jsonResponse(body);
      }

      const cargoPurchaseRoute = /^\/farms\/([^/]+)\/cargo\/purchase$/.exec(url.pathname);
      if (request.method === "POST" && cargoPurchaseRoute?.[1] !== undefined) {
        if (purchaseSupply === null) return failure("RESOURCE_NOT_FOUND", requestId);
        const decodedFarm = decodePathSegment(cargoPurchaseRoute[1]);
        if (decodedFarm === null || !FarmIdSchema.safeParse(decodedFarm).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = SupplyPurchaseRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const purchase = await purchaseSupply.execute(actor, parseFarmId(decodedFarm), parsed.data);
        const body: ApiSuccess<{ purchase: SupplyPurchaseResultDTO }> = {
          ok: true,
          data: { purchase: { ...purchase, cargo: toCargoDTO(purchase.cargo) } }
        };
        return jsonResponse(body, 201);
      }

      const match = /^\/farms\/([^/]+)$/.exec(url.pathname);
      const tilesRoute = /^\/farms\/([^/]+)\/tiles$/.exec(url.pathname);
      if (request.method === "GET" && tilesRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(tilesRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmTiles = await listFarmTiles.execute(actor, parseFarmId(decodedId));
        const body: ApiSuccess<{ tiles: FarmTileDTO[] }> = { ok: true, data: { tiles: [...farmTiles] } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && match?.[1] !== undefined) {
        const decodedId = decodePathSegment(match[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const result = await getFarm.execute(actor, parseFarmId(decodedId));
        const body: ApiSuccess<{ farm: FarmDTO; membership: FarmMemberDTO }> = {
          ok: true,
          data: { farm: toFarmDTO(result.farm), membership: toMemberDTO(result.membership) }
        };
        return jsonResponse(body);
      }

      return failure("RESOURCE_NOT_FOUND", requestId);
    } catch (error: unknown) {
      if (error instanceof ApplicationError) {
        return failure(error.code, requestId);
      }
      // The inventory capacity guard raises a database error, not an application one, so every
      // grant path (harvest, tree, fishing, gathering, shop buy, starter package) gets the same
      // stable code here rather than a generic 500.
      if (error instanceof Error && error.message.includes("warehouse_full")) {
        return failure("WAREHOUSE_FULL", requestId);
      }
      // An unexpected error is a bug, and the response deliberately says nothing about it. Without
      // this line it would leave no trace anywhere at all. The error itself is logged, never the
      // request: no body, no header, no token.
      console.error("unexpected handler error", error);
      return failure("INTERNAL_ERROR", requestId);
    }
  };
}
