import {
  CreateFarm,
  CropStateProjector,
  GetFarmCrops,
  GetFarm,
  GetInventory,
  GetProgression,
  HarvestCrop,
  InventoryService,
  ListPlots,
  ListCropDefinitions,
  ListFarmTiles,
  ListFarmTrees,
  ListTreeDefinitions,
  PlantCrop,
  PlantTree,
  PlaceConstruction,
  ListFarmConstructions,
  RelocateConstruction,
  RemoveConstruction,
  RestoreConstruction,
  SeedStarterWorld,
  StoreConstruction,
  HarvestTree,
  RemoveTree,
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
} from "@happy-farm/application";
import {
  CreateFarmRequestSchema,
  FarmIdSchema,
  CropInstanceIdSchema,
  TreeInstanceIdSchema,
  HarvestCropRequestSchema,
  BuyItemRequestSchema,
  ExpandFarmRequestSchema,
  HarvestTreeRequestSchema,
  PlantTreeRequestSchema,
  RemoveTreeRequestSchema,
  SellItemRequestSchema,
  PlantCropRequestSchema,
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
  type UprootCropResponse,
  type TreeHarvestResultDTO,
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
  ,type TreeDefinitionDTO,
  type TreeStateDTO,
  type BuildCatalogEntryDTO
  ,type ConstructionDTO
  ,type RemoveConstructionResponse
  ,type WorldObjectDefinitionDTO
  ,type GetSessionResponse
} from "@happy-farm/contracts";
import { listBuildCatalog } from "./build-catalog";
import { listWorldObjectDefinitions } from "./runtime";
import { rejectsCrossOriginRequest } from "./origin-guard";
import type { SessionPort } from "./session";
import {
  parseCurrencyDefinitionId,
  parseFarmId,
  type ConstructionInstance,
  type ProgressionDefinition,
  type ShopEntry,
  type Wallet
} from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";
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
  D1WalletRepository,
  D1InventoryRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1PlayerRepository,
  D1ProgressionRepository
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
  /** The levelling curve. Passed in rather than imported, so application code stays game-data free. */
  readonly progressionDefinition: ProgressionDefinition;
  /** The island's starter arrangement: what every farm is given once, and never re-applied. */
  readonly starterWorld: StarterWorldDefinition;
  /** The island's geography, as the placement rules read it. */
  readonly terrain: TileTerrainLookup;
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
  readonly clock: Clock;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** One persisted construction, as the client reads it. Pure projection: nothing is derived here. */
function toConstructionDTO(construction: ConstructionInstance): ConstructionDTO {
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
    version: construction.version
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
      return 400;
    case "NOT_AUTHENTICATED":
      return 401;
    case "NOT_AUTHORIZED":
    case "FARM_PERMISSION_DENIED":
    case "CROP_LEVEL_REQUIRED":
    case "PLOT_LEVEL_REQUIRED":
    case "TREE_LEVEL_REQUIRED":
    case "CONSTRUCTION_LEVEL_REQUIRED":
    case "CONSTRUCTION_NOT_ALLOWED":
    case "CONSTRUCTION_NOT_OWNED":
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
    case "FISHING_SPOT_NOT_FOUND":
    case "FISHING_ACTION_NOT_FOUND":
    case "RESOURCE_NODE_NOT_FOUND":
    case "RESOURCE_ACTION_NOT_FOUND":
      return 404;
    case "CONFLICT_STALE_STATE":
    case "REQUEST_ALREADY_PROCESSED":
    case "TILE_OCCUPIED":
    case "TILE_NOT_PLANTABLE":
    case "IDEMPOTENCY_CONFLICT":
    case "CROP_NOT_MATURE":
    case "CROP_ALREADY_HARVESTED":
    case "INVENTORY_LIMIT_EXCEEDED":
    case "INSUFFICIENT_ITEMS":
    case "INSUFFICIENT_FUNDS":
    case "WALLET_LIMIT_EXCEEDED":
    case "ECONOMY_CONFLICT":
    case "PROGRESSION_CONFLICT":
    case "PLOT_LIMIT_REACHED":
    case "TREE_NOT_READY":
    case "CONSTRUCTION_OCCUPIED":
    case "CONSTRUCTION_CONFLICT":
    case "FISHING_SPOT_DISABLED":
    case "FISHING_ALREADY_ACTIVE":
    case "FISHING_NOT_READY":
    case "FISHING_ACTION_NOT_ACTIVE":
    case "FISHING_CONFLICT":
    case "RESOURCE_NODE_DEPLETED":
    case "RESOURCE_ALREADY_ACTIVE":
    case "RESOURCE_NOT_READY":
    case "RESOURCE_ACTION_NOT_ACTIVE":
    case "RESOURCE_CONFLICT":
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

function failure(code: ErrorCode, requestId: string): Response {
  const body: ApiFailure = { ok: false, error: { code, requestId } };
  return jsonResponse(body, errorStatus(code));
}

export function createHandler(dependencies: HandlerDependencies) {
  const players = new D1PlayerRepository(dependencies.db);
  const farms = new D1FarmRepository(dependencies.db);
  const members = new D1FarmMemberRepository(dependencies.db);
  const tiles = new D1FarmTileRepository(dependencies.db);
  const crops = new D1CropRepository(dependencies.db);
  const inventory = new D1InventoryRepository(dependencies.db);
  const harvestSettlement = new D1HarvestSettlementRepository(dependencies.db);
  const wallets = new D1WalletRepository(dependencies.db);
  const economySettlement = new D1EconomySettlementRepository(dependencies.db);
  const farmExpansionSettlement = new D1FarmExpansionRepository(dependencies.db);
  const trees = new D1TreeRepository(dependencies.db);
  const constructions = new D1ConstructionRepository(dependencies.db);
  const treeHarvestSettlement = new D1TreeHarvestSettlementRepository(dependencies.db);
  const progressions = new D1ProgressionRepository(dependencies.db);
  const unlockedLand = {
    async isUnlocked(farmId: Parameters<typeof tiles.find>[0], coordinate: { x: number; y: number }) {
      return (await tiles.find(farmId, coordinate.x, coordinate.y)) !== null;
    }
  };
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
    unlockedLand,
    inventoryService,
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
    unlockedLand,
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
  const removeTree = new RemoveTree(
    farms,
    members,
    trees,
    treeIdempotency,
    dependencies.fingerprints,
    dependencies.clock
  );
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
    clock: dependencies.clock
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
            dependencies.clock
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
            dependencies.clock
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
  const resources = dependencies.resources;
  const resourceStates = new D1ResourceNodeStateRepository(dependencies.db);
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
            dependencies.clock
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
            dependencies.clock
          ),
          cancel: new CancelResourceAction(
            resourceActions,
            resourceSettlement,
            new D1IdempotencyRepository(dependencies.db),
            dependencies.fingerprints,
            dependencies.clock
          )
        };

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
            data: { construction: toConstructionDTO(construction) }
          };
          return jsonResponse(body, 201);
        }
        if (request.method === "GET") {
          const built = await listFarmConstructions.execute(actor, farmId);
          const body: ApiSuccess<{ constructions: ConstructionDTO[] }> = {
            ok: true,
            data: { constructions: built.map(toConstructionDTO) }
          };
          return jsonResponse(body);
        }
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
            data: { construction: toConstructionDTO(moved) }
          };
          return jsonResponse(body);
        }
        if (operation === "rotate") {
          const parsed = RotateConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const turned = await relocateConstruction.rotate(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: toConstructionDTO(turned) }
          };
          return jsonResponse(body);
        }
        if (operation === "store") {
          const parsed = StoreConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const stored = await storeConstruction.execute(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: toConstructionDTO(stored) }
          };
          return jsonResponse(body);
        }
        if (operation === "restore") {
          const parsed = RestoreConstructionRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const restored = await restoreConstruction.execute(actor, farmId, decodedObject, parsed.data);
          const body: ApiSuccess<{ construction: ConstructionDTO }> = {
            ok: true,
            data: { construction: toConstructionDTO(restored) }
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
      // An unexpected error is a bug, and the response deliberately says nothing about it. Without
      // this line it would leave no trace anywhere at all. The error itself is logged, never the
      // request: no body, no header, no token.
      console.error("unexpected handler error", error);
      return failure("INTERNAL_ERROR", requestId);
    }
  };
}
