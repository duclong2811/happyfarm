import {
  cropInstanceIdFromUuid,
  DomainError,
  economyTransactionIdFromUuid,
  constructionIdFromUuid,
  farmIdFromUuid,
  fishingActionIdFromUuid,
  resourceActionIdFromUuid,
  parseCropDefinitionId,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  parsePlotId,
  parseShopEntryId,
  parseTreeDefinitionId,
  treeInstanceIdFromUuid,
  workAreaIdFromUuid,
  actorIdFromUuid,
  jobIdFromUuid,
  type AutoAnchorTiles,
  type CropDefinition,
  type CropDefinitionId,
  type CropInstanceId,
  type ConstructionDefinition,
  type ConstructionId,
  type FarmId,
  type PlayerId,
  type FishingActionId,
  type ResourceActionId,
  type CurrencyDefinition,
  type CurrencyDefinitionId,
  type EconomyTransactionId,
  type ItemDefinition,
  type ItemDefinitionId,
  type ProgressionDefinition,
  type PlotDefinition,
  type ShopEntry,
  type ShopEntryId,
  type TreeDefinition,
  type TreeDefinitionId,
  type TreeInstanceId,
  type WorkAreaGroundCapability,
  type WorkAreaId,
  type ActorId,
  type JobId
} from "@happy-farm/domain";
import type {
  ActorContext,
  AuthenticationPort,
  Clock,
  ConstructionDefinitionRepository,
  ConstructionIdGenerator,
  CropDefinitionRepository,
  CropIdGenerator,
  CurrencyDefinitionRepository,
  EconomyTransactionIdGenerator,
  FishDefinition,
  FishingCataloguePort,
  FishingIdGenerator,
  FishingRandomPort,
  FishingSpotDefinition,
  FishingTableDefinition,
  ResourceCataloguePort,
  ResourceDefinitionView,
  ResourceDropTableView,
  ResourceIdGenerator,
  ResourceNodePlacement,
  RandomPort,
  IdGenerator,
  ItemDefinitionRepository,
  PlotDefinitionRepository,
  PayloadFingerprint,
  ShopEntryRepository,
  StarterPackageDefinition,
  TreeDefinitionRepository,
  TreeIdGenerator,
  WarehouseTierRepository,
  MineCatalogue,
  ShipCatalogue,
  ShipPrice,
  TileTerrainLookup,
  LandSaleLookup,
  WorkAreaGroundLookup,
  WorkAreaIdGenerator,
  ActorIdGenerator,
  JobIdGenerator
  ,CargoCapacityLookup
  ,ForestryConstructionDefinition
  ,ForestryConstructionDefinitionRepository
  ,IslandGroundBuilder
  ,FarmIslandRepository
  ,StarterWorldDefinition
  ,CharacterCatalogue
} from "@happy-farm/application";
import {
  cropRegistry,
  aquacultureDefinition,
  currencyRegistry,
  AUTO_WALK_SPEED_WORLD_PER_SECOND,
  FARM_MARKET_ANCHOR_TILE,
  FARM_TILE_PITCH_WORLD,
  HOME_WAREHOUSE_ANCHOR_TILE,
  FISHING_ACTION_SECONDS,
  fishRegistry,
  fishingSpotRegistry,
  islandFishingSpots,
  fishingTableRegistry,
  gameplayFor,
  itemRegistry,
  placementEntries,
  playerProgression,
  plotRegistry,
  resourceDefinitionRegistry,
  resourceDropTableRegistry,
  activeResourceNodes,
  type ResourceNodeData,
  shopRegistry,
  starterPackage,
  starterCargoCapacity,
  treeRegistry,
  warehouseTiers,
  STARTER_WORLD_PLACEMENTS,
  STARTER_WORLD_VERSION,
  buildIslandGround,
  DEFAULT_PLAYER_CHARACTER_ID,
  isSelectablePlayerCharacter,
  classifyIslandTile,
  classifyTile,
  islandGroundCapabilities,
  type IslandGroundCells,
  groundCapabilities,
  ISLAND_ELEMENTS,
  ISLAND_OUTLINES,
  ISLAND_SEED_MAX,
  worldObjectDefinition,
  WORLD_OBJECT_DEFINITIONS,
  COMPOSED_ISLAND_MINE_POSITIONS,
  MINE_ACCUMULATION_HOURS,
  MINE_GOLD_CURRENCY_ID,
  MINE_LEVELS,
  MINE_ORE_ITEM_ID,
  MINE_ORE_PER_XP,
  MINE_WOOD_ITEM_ID,
  islandMineTiles,
  inMineFootprint,
  mineSlotLevels,
  type CropDefinitionData,
  type TreeDefinitionData
} from "@happy-farm/game-data";
import { forestryConstructionDefinition } from "@happy-farm/game-data";
import { ambushBounty, chartedArchipelagos, findSeaSlot, findSeaArchipelago, pirateShip, planAmbush, SHIP_BATTLE_NUMBERS, SHIP_REPAIR_GOLD_PER_HULL, SHIP_REPAIR_WOOD_PER_HULL, SHIP_CLASSES, DOCK_TIERS, FISHING_GROUNDS, fishingGround, rollTripCatch, SHIP_GOLD_CURRENCY_ID, SHIP_ORE_ITEM_ID, SHIP_WOOD_ITEM_ID, voyageSeconds, ISLAND_GENERATOR_VERSION, nextFreeSeaSlot, openArchipelagos, SEA_REGIONS } from "@happy-farm/game-data";
import type { WorldChartPort } from "@happy-farm/application";

export const gameDataAquacultureDefinition = { ...aquacultureDefinition };

export class GameDataForestryConstructionDefinitions implements ForestryConstructionDefinitionRepository {
  findByEntryId(entryId: string): ForestryConstructionDefinition | null {
    const definition = forestryConstructionDefinition(entryId);
    return definition === null ? null : { entryId, ...definition };
  }
}

/**
 * The island's starter arrangement, as the application layer reads it.
 *
 * Content stays in game data; this is the adapter, exactly as the catalogue and the shop registries
 * are. The layout is data - a key, a definition, a tile and a quarter turn - so seeding needs no
 * geometry, no renderer and no second opinion about where the mill stands.
 */
export const gameDataStarterWorld = {
  version: STARTER_WORLD_VERSION,
  placements: STARTER_WORLD_PLACEMENTS.map((placement) => ({
    key: placement.key,
    definitionId: placement.definitionId,
    version: placement.version,
    tile: { x: placement.tile.x, y: placement.tile.y },
    rotation: placement.rotation
  }))
};

/**
 * Where Auto walks to load, unload and buy, and how fast it walks there.
 *
 * Game data, not a handler constant: the anchors are derived from the starter layout's own barn and
 * market stall (see `packages/game-data/src/auto`), and the pace is the same number the client's
 * character controller walks at. The server needs both because travel time is a *rule* here, not a
 * picture: it is what makes "the client says it arrived" meaningless.
 */
export const gameDataAutoAnchors: AutoAnchorTiles = {
  warehouse: HOME_WAREHOUSE_ANCHOR_TILE,
  market: FARM_MARKET_ANCHOR_TILE
};

export const gameDataWalk = {
  speedWorldPerSecond: AUTO_WALK_SPEED_WORLD_PER_SECOND,
  pitchWorld: FARM_TILE_PITCH_WORLD
};

/**
 * The island's geography, as the placement rules read it.
 *
 * The *same* `classifyTile` the client's cell map is built from, handed to the application as a port.
 * This is the authority V13.2 said was missing: the server can now refuse a placement on a beach, in
 * water, on the steep flank of the volcano or on ground the island keeps for itself, and it refuses
 * it for that reason rather than because the farm happens not to own the tile.
 */
export const gameDataTileTerrain: TileTerrainLookup = {
  classify(tile) {
    const classification = classifyTile(tile);
    return {
      terrain: classification.terrain,
      shallowWater: classification.shallowWater,
      protectedGround: classification.protectedGround
    };
  }
};

/** The three placement ports, answered from one farm's stored island. */
export function storedIslandGeography(island: IslandGroundCells & { readonly element?: string }): {
  readonly terrain: TileTerrainLookup;
  readonly landSale: LandSaleLookup;
  readonly ground: WorkAreaGroundLookup;
} {
  // Every mine slot's yard, opened or not, is the mine's: nothing is planted, built or worked there.
  // Computed once per lookup from the stored cells and sites, the same answer the browser draws.
  const mines = islandMineTiles(island, mineSlotLevels(island.element ?? null).length);
  return {
    terrain: {
      classify(tile) {
        if (inMineFootprint(mines, tile)) return { terrain: "BLOCKED", shallowWater: false, protectedGround: false };
        const classification = classifyIslandTile(island, tile);
        return {
          terrain: classification.terrain,
          shallowWater: classification.shallowWater,
          protectedGround: classification.protectedGround
        };
      }
    },
    landSale: {
      isDevelopable(tile) {
        if (inMineFootprint(mines, tile)) return false;
        const classification = classifyIslandTile(island, tile);
        return classification.terrain === "LAND" && !classification.protectedGround;
      }
    },
    ground: {
      capabilitiesAt(tile) {
        return inMineFootprint(mines, tile) ? [] : islandGroundCapabilities(island, tile);
      }
    }
  };
}

/**
 * The starter arrangement of a chosen Home Island: one choppable tree on every stored tree site.
 *
 * Deterministic from the stored sites alone - the key is the tile, the species alternates by a hash
 * of it - so a retry, a second tab or a later read produces exactly the same rows, and the seeder's
 * unique `(farm, key)` index absorbs any overlap. It carries the current starter version, which is
 * what keeps a later version of the *old* island's arrangement from ever reaching this farm.
 */
export function islandStarterWorld(island: IslandGroundCells): StarterWorldDefinition {
  return {
    version: STARTER_WORLD_VERSION,
    placements: island.sites
      .filter((site) => site.kind === "TREE")
      .map((site) => ({
        key: `island.tree.${String(site.x)}_${String(site.y)}`,
        definitionId: ((site.x * 7 + site.y * 13) & 3) === 0 ? "world.tree_broad" : "world.tree_pine",
        version: 1,
        tile: { x: site.x, y: site.y },
        rotation: 0
      }))
  };
}

/**
 * Makes a host's geography ports farm-aware.
 *
 * A farm with a stored island is judged by that island; every other farm falls through to the host's
 * own lookup (the hand-composed island in production, whatever a test supplies). The island is read
 * once per resolution - one row - and nothing is cached across requests, so no isolate can serve a
 * stale coast.
 */
export function farmIslandGeography(
  base: { readonly terrain: TileTerrainLookup; readonly landSale: LandSaleLookup; readonly ground?: WorkAreaGroundLookup },
  islands: FarmIslandRepository
): { readonly terrain: TileTerrainLookup; readonly landSale: LandSaleLookup; readonly ground?: WorkAreaGroundLookup } {
  const stored = async (farmId: FarmId) => {
    const island = await islands.findByFarm(farmId);
    return island === null ? null : storedIslandGeography(island);
  };
  const terrain: TileTerrainLookup = {
    classify: (tile) => base.terrain.classify(tile),
    forFarm: async (farmId) => (await stored(farmId))?.terrain ?? (base.terrain.forFarm === undefined ? base.terrain : base.terrain.forFarm(farmId))
  };
  const landSale: LandSaleLookup = {
    isDevelopable: (tile) => base.landSale.isDevelopable(tile),
    forFarm: async (farmId) => (await stored(farmId))?.landSale ?? (base.landSale.forFarm === undefined ? base.landSale : base.landSale.forFarm(farmId))
  };
  const ground = base.ground;
  return {
    terrain,
    landSale,
    ...(ground === undefined
      ? {}
      : {
          ground: {
            capabilitiesAt: (tile) => ground.capabilitiesAt(tile),
            forFarm: async (farmId) => (await stored(farmId))?.ground ?? (ground.forFarm === undefined ? ground : ground.forFarm(farmId))
          } satisfies WorkAreaGroundLookup
        })
  };
}

/** The characters a player may choose, from game data. */
export const gameDataCharacterCatalogue: CharacterCatalogue = {
  defaultCharacterId: DEFAULT_PLAYER_CHARACTER_ID,
  isSelectable: (characterId) => isSelectablePlayerCharacter(characterId)
};

/**
 * Builds a chosen Home Island from game data.
 *
 * The request's three values are re-checked against game data's own lists here, independently of
 * the contract, because this is the only place a template becomes stored ground.
 */
export const gameDataIslandGroundBuilder: IslandGroundBuilder = {
  build(choice) {
    const element = ISLAND_ELEMENTS.find((candidate) => candidate === choice.element);
    const outline = ISLAND_OUTLINES.find((candidate) => candidate === choice.outline);
    if (element === undefined || outline === undefined) {
      throw new DomainError("INVALID_ISLAND", "Unknown island element or outline");
    }
    if (!Number.isInteger(choice.seed) || choice.seed < 1 || choice.seed > ISLAND_SEED_MAX) {
      throw new DomainError("INVALID_ISLAND", "Island seed is out of range");
    }
    return buildIslandGround({ element, outline, seed: choice.seed });
  }
};

/**
 * Where the island lets a farm own land, for the single-cell land sale.
 *
 * The same `classifyTile` the placement rule reads: a cell is developable when it is dry land the
 * island has not kept for itself. "Inside the reservation the catalogue sells" is decided by the plot
 * geometry in `@happy-farm/domain`, so a cell outside every plot cohort is refused there.
 */
export const gameDataLandSale: LandSaleLookup = {
  isDevelopable(tile) {
    const classification = classifyTile(tile);
    return classification.terrain === "LAND" && !classification.protectedGround;
  }
};

/**
 * What the ground can be *worked* for, as the work-area rules read it.
 *
 * The same `groundCapabilities` the cell map is classified with, handed to the application as a port
 * for the same reason `gameDataTileTerrain` is: the application owns the rule and game data owns the
 * island. It reports what the ground supports, never who may name it - a capability is not a
 * permission, and a work area is not ownership.
 */
export const gameDataWorkAreaGround: WorkAreaGroundLookup = {
  capabilitiesAt(tile): readonly WorkAreaGroundCapability[] {
    return groundCapabilities(tile);
  }
};

/**
 * What an actor of a kind can carry, from game data.
 *
 * A port rather than an import for the same reason the terrain lookup is one: the application owns the
 * rule and game data owns the numbers. `null` means the kind has no capacity defined yet, which is a
 * refusal rather than a zero.
 */
export const gameDataCargoCapacities: CargoCapacityLookup = {
  forActorKind(kind) {
    return starterCargoCapacity(kind);
  }
};

/** Every ordinary world object the client may draw and edit, as the wire carries it. */
export function listWorldObjectDefinitions(): readonly {
  readonly id: string;
  readonly displayNameKey: string;
  readonly modelId: string | null;
  readonly landmarkKind: string | null;
  readonly sizeWorld: number;
  readonly collisionRadiusWorld: number;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  readonly allowedTerrain: ("LAND" | "SHORE" | "SHALLOW_WATER" | "WATER")[];
  readonly movable: boolean;
  readonly rotatable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  readonly removalRefundRate: number;
  readonly service: "FARM_MARKET" | null;
}[] {
  return WORLD_OBJECT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    displayNameKey: definition.displayNameKey,
    modelId: definition.presentation.form === "MODEL" ? definition.presentation.modelId : null,
    landmarkKind: definition.presentation.form === "LANDMARK" ? definition.presentation.kind : null,
    sizeWorld: definition.presentation.form === "MODEL" ? definition.presentation.sizeWorld : 1,
    collisionRadiusWorld: definition.collisionRadiusWorld,
    footprint: {
      widthCells: definition.footprint.widthCells,
      depthCells: definition.footprint.depthCells
    },
    allowedTerrain: [...definition.allowedTerrain],
    movable: definition.movable,
    rotatable: definition.rotatable,
    storable: definition.storable,
    removable: definition.removable,
    removalRefundRate: definition.removalRefundRate
    ,
    service: definition.service ?? null
  }));
}

/**
 * The levelling curve, read from game data and handed to the application layer as plain numbers.
 *
 * `packages/application` must not import game data, so this is the one place the two meet, exactly
 * as the repositories above translate registries into domain definitions.
 */
export const gameDataProgressionDefinition: ProgressionDefinition = {
  maxLevel: playerProgression.maxLevel,
  xpStep: playerProgression.xpStep
};

/**
 * The one-time starter package, read from game data and handed to the application as plain values.
 *
 * It is exported from here so the same `GrantStarterPackage` use case can be called by the
 * development host today and by the deployed onboarding step later, without either of them knowing
 * an item ID, a currency ID, or a quantity.
 */
export const gameDataStarterPackage: StarterPackageDefinition = {
  grantKey: starterPackage.grantKey,
  seedItemDefinitionId: starterPackage.seedItemDefinitionId,
  seedQuantity: starterPackage.seedQuantity,
  currencyDefinitionId: starterPackage.currencyDefinitionId,
  goldAmount: starterPackage.goldAmount
};

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator
  implements IdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator, FishingIdGenerator, ResourceIdGenerator, WorkAreaIdGenerator, ActorIdGenerator, JobIdGenerator
{
  newFarmId(): FarmId {
    return farmIdFromUuid(crypto.randomUUID());
  }

  newCropInstanceId(): CropInstanceId {
    return cropInstanceIdFromUuid(crypto.randomUUID());
  }

  newTreeInstanceId(): TreeInstanceId {
    return treeInstanceIdFromUuid(crypto.randomUUID());
  }

  newEconomyTransactionId(): EconomyTransactionId {
    return economyTransactionIdFromUuid(crypto.randomUUID());
  }

  newConstructionId(): ConstructionId {
    return constructionIdFromUuid(crypto.randomUUID());
  }

  newFishingActionId(): FishingActionId {
    return fishingActionIdFromUuid(crypto.randomUUID());
  }

  newResourceActionId(): ResourceActionId {
    return resourceActionIdFromUuid(crypto.randomUUID());
  }

  newWorkAreaId(): WorkAreaId {
    return workAreaIdFromUuid(crypto.randomUUID());
  }

  newActorId(): ActorId {
    return actorIdFromUuid(crypto.randomUUID());
  }

  newJobId(): JobId {
    return jobIdFromUuid(crypto.randomUUID());
  }
}

/**
 * The production catch roll.
 *
 * Platform entropy rather than `Math.random`, and rejection-sampled so the value is uniform over
 * `[0, 1)`: taking a fraction of a full 32-bit word would leave the top of the range slightly more
 * likely, which is exactly the kind of bias a reward table must not have.
 */
export class CryptoFishingRandom implements FishingRandomPort {
  roll(): number {
    const word = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(word);
      value = word[0] ?? 0;
    } while (value === 0xffffffff);
    return value / 0x1_0000_0000;
  }
}

/**
 * The shared gather roll, for the same reason fishing's is not `Math.random`: a reward table's outcome
 * belongs to the server's entropy, and a test has to be able to script it.
 */
export class CryptoResourceRandom implements RandomPort {
  roll(): number {
    const word = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(word);
      value = word[0] ?? 0;
    } while (value === 0xffffffff);
    return value / 0x1_0000_0000;
  }
}

/**
 * The resource catalogue as the application layer reads it: definitions, placements and drop tables.
 *
 * Pure game data. A node's *state* is the only mutable part, and it is read from D1 by the repository;
 * this class never touches the database.
 */
export class GameDataResourceCatalogue implements ResourceCataloguePort {
  /**
   * The placements this world serves: the active ones. A host can hand a different list - the tests
   * that still exercise the retired hold-to-mine engine (kept so old actions settle) re-activate the
   * old ore ridge this way - without game data shipping it to players.
   */
  constructor(private readonly nodes: readonly ResourceNodeData[] = activeResourceNodes) {}

  listDefinitions(): readonly ResourceDefinitionView[] {
    return [...resourceDefinitionRegistry.values()].map((definition) => ({
      id: definition.id,
      displayNameKey: definition.displayNameKey,
      verb: definition.verb,
      actionSeconds: definition.actionSeconds,
      regenerationSeconds: definition.regenerationSeconds,
      productionUnitsPerHour: definition.productionUnitsPerHour,
      settlementMode: definition.settlementMode,
      dropTableId: definition.dropTableId,
      xp: definition.xp,
      modelId: definition.modelId,
      depletedModelId: definition.depletedModelId ?? null,
      requiredLevel: definition.requiredLevel ?? 1
    }));
  }

  listNodes(): readonly ResourceNodePlacement[] {
    return this.nodes.map((node) => ({
      id: node.id,
      definitionId: node.definitionId,
      zoneKind: node.zoneKind,
      position: { x: node.position.x, y: node.position.y },
      interactionRadiusTiles: node.interactionRadiusTiles
    }));
  }

  findDefinition(id: string): ResourceDefinitionView | null {
    const definition = resourceDefinitionRegistry.get(id);
    if (definition === undefined) return null;
    return {
      id: definition.id,
      displayNameKey: definition.displayNameKey,
      verb: definition.verb,
      actionSeconds: definition.actionSeconds,
      regenerationSeconds: definition.regenerationSeconds,
      productionUnitsPerHour: definition.productionUnitsPerHour,
      settlementMode: definition.settlementMode,
      dropTableId: definition.dropTableId,
      xp: definition.xp,
      modelId: definition.modelId,
      depletedModelId: definition.depletedModelId ?? null,
      requiredLevel: definition.requiredLevel ?? 1
    };
  }

  findNode(id: string): ResourceNodePlacement | null {
    const node = this.nodes.find((candidate) => candidate.id === id);
    return node === undefined
      ? null
      : {
          id: node.id,
          definitionId: node.definitionId,
          zoneKind: node.zoneKind,
          position: { x: node.position.x, y: node.position.y },
          interactionRadiusTiles: node.interactionRadiusTiles
        };
  }

  findDropTable(id: string): ResourceDropTableView | null {
    const table = resourceDropTableRegistry.get(id);
    return table === undefined
      ? null
      : {
          id: table.id,
          entries: table.entries.map((entry) => ({
            itemDefinitionId: entry.itemDefinitionId,
            minQuantity: entry.minQuantity,
            maxQuantity: entry.maxQuantity,
            weight: entry.weight
          }))
        };
  }
}

/**
 * The fishing catalogue as the application layer reads it.
 *
 * Pure game data: no database, no player state. A spot, a table and a species are all module
 * constants for the life of a deployment, which is what lets the client draw the water and the server
 * settle a catch without either of them reading a row.
 */
/**
 * The fishing catalogue, aware of each player's own island: a farm on a chosen Home Island fishes the
 * deep water its stored ground marks (`islandFishingSpots`), and only that; every other farm fishes the
 * static list. The spots come from the actor's own farm, never from the request, so a client cannot
 * fish water it does not have or invent a spot to dodge depletion.
 */
export function islandFishingCatalogue(
  base: FishingCataloguePort,
  farms: { findByOwner(playerId: PlayerId): Promise<{ readonly id: FarmId } | null> },
  islands: FarmIslandRepository
): FishingCataloguePort {
  return {
    actionSeconds: base.actionSeconds,
    listSpots: () => base.listSpots(),
    findSpot: (spotId) => base.findSpot(spotId),
    findTable: (tableId) => base.findTable(tableId),
    findFish: (fishId) => base.findFish(fishId),
    async spotsForPlayer(playerId) {
      const farm = await farms.findByOwner(playerId);
      const island = farm === null ? null : await islands.findByFarm(farm.id);
      if (island === null) return null;
      return islandFishingSpots(island.sites).map((spot) => ({
        id: spot.id,
        displayNameKey: spot.displayNameKey,
        zoneKind: spot.zoneKind,
        position: { x: spot.position.x, y: spot.position.y },
        interactionRadiusTiles: spot.interactionRadiusTiles,
        tableId: spot.tableId,
        enabled: spot.enabled,
        maxStock: spot.maxStock ?? 8,
        regenerationSeconds: spot.regenerationSeconds ?? 90,
        productionUnitsPerHour: spot.productionUnitsPerHour ?? 1
      }));
    }
  };
}

export class GameDataFishingCatalogue implements FishingCataloguePort {
  readonly actionSeconds = FISHING_ACTION_SECONDS;

  listSpots(): readonly FishingSpotDefinition[] {
    return [...fishingSpotRegistry.values()].map((spot) => ({
      id: spot.id,
      displayNameKey: spot.displayNameKey,
      zoneKind: spot.zoneKind,
      position: { x: spot.position.x, y: spot.position.y },
      interactionRadiusTiles: spot.interactionRadiusTiles,
      tableId: spot.tableId,
      enabled: spot.enabled,
      maxStock: spot.maxStock ?? 5,
      regenerationSeconds: spot.regenerationSeconds ?? 120,
      productionUnitsPerHour: spot.productionUnitsPerHour ?? 1
    }));
  }

  findSpot(spotId: string): FishingSpotDefinition | null {
    const spot = fishingSpotRegistry.get(spotId);
    return spot === undefined
      ? null
      : {
          id: spot.id,
          displayNameKey: spot.displayNameKey,
          zoneKind: spot.zoneKind,
          position: { x: spot.position.x, y: spot.position.y },
          interactionRadiusTiles: spot.interactionRadiusTiles,
          tableId: spot.tableId,
          enabled: spot.enabled,
          maxStock: spot.maxStock ?? 5,
          regenerationSeconds: spot.regenerationSeconds ?? 120,
          productionUnitsPerHour: spot.productionUnitsPerHour ?? 1
        };
  }

  findTable(tableId: string): FishingTableDefinition | null {
    const table = fishingTableRegistry.get(tableId);
    return table === undefined
      ? null
      : { id: table.id, entries: table.entries.map((entry) => ({ fishId: entry.fishId, weight: entry.weight })) };
  }

  findFish(fishId: string): FishDefinition | null {
    const definition = fishRegistry.get(fishId);
    if (definition === undefined) return null;
    const item = itemRegistry.get(definition.itemDefinitionId);
    // Game data refuses a fish whose item is missing, so a miss here means the deployment is
    // internally inconsistent; returning null makes the caller refuse rather than invent a name.
    if (item === undefined) return null;
    return {
      id: definition.id,
      displayNameKey: definition.displayNameKey,
      itemDefinitionId: parseItemDefinitionId(definition.itemDefinitionId),
      itemDisplayNameKey: item.displayNameKey,
      modelId: definition.modelId,
      sellPrice: definition.sellPrice,
      xp: definition.xp,
      requiredLevel: definition.requiredLevel ?? 1
    };
  }
}

/**
 * The build catalogue, read as placement rules.
 *
 * The client sees this data as a shop, the server sees it as the definition of what may be built: the
 * price it charges, the level it requires, the ground the thing needs, and whether it is buildable at
 * all. There is exactly one source - game data - and this class is the adapter, not a second opinion.
 */
export class GameDataConstructionDefinitions implements ConstructionDefinitionRepository {
  findById(entryId: string): ConstructionDefinition | null {
    // An ordinary world object - a starter tree, the mill - is described by its own definition rather
    // than by a shop entry, and is edited by exactly the same policy shape. One resolver, two
    // families, so a starter object and a bought one cannot drift into behaving differently.
    const worldObject = worldObjectDefinition(entryId);
    if (worldObject !== null) {
      return {
        entryId: worldObject.id,
        category: "WORLD_OBJECT",
        requiredLevel: 1,
        // A world object is not for sale: it costs nothing to place, and nothing was paid for it.
        price: 0,
        currencyDefinitionId: "currency_gold",
        footprint: {
          widthCells: worldObject.footprint.widthCells,
          depthCells: worldObject.footprint.depthCells
        },
        allowedTerrain: [...worldObject.allowedTerrain],
        rotatable: worldObject.rotatable,
        movable: worldObject.movable,
        storable: worldObject.storable,
        removable: worldObject.removable,
        removalRefundRate: worldObject.removalRefundRate,
        status: "ACTIVE",
        // Deciding it by source would defeat the feature: this is the same rule the catalogue uses.
        requiresOwnership: true
      };
    }
    const entry = placementEntries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) return null;
    const gameplay = gameplayFor(entry.id);
    if (gameplay === null) return null;
    return {
      entryId: entry.id,
      category: entry.category,
      requiredLevel: entry.requiredLevel,
      price: entry.price,
      currencyDefinitionId: entry.currencyDefinitionId,
      footprint: { widthCells: entry.footprint.widthCells, depthCells: entry.footprint.depthCells },
      // The asset's own ground requirement, copied as values: the domain never reads game data, and
      // the catalogue never reaches the rules.
      allowedTerrain: [...entry.allowedTerrain],
      rotatable: entry.rotatable,
      movable: entry.movable,
      storable: entry.storable,
      removable: entry.removable,
      removalRefundRate: entry.removalRefundRate,
      status: gameplay.status,
      requiresOwnership: entry.unlockCondition === "OWNED_LAND"
    };
  }
}

export class GameDataCurrencyDefinitions implements CurrencyDefinitionRepository {
  findById(id: CurrencyDefinitionId): CurrencyDefinition | null {
    const definition = currencyRegistry.get(id);
    return definition === undefined ? null : { ...definition, id };
  }
}

export class GameDataShopEntries implements ShopEntryRepository {
  list(): readonly ShopEntry[] {
    return [...shopRegistry.values()].map(toShopEntry);
  }

  findById(id: ShopEntryId): ShopEntry | null {
    const entry = shopRegistry.get(id);
    return entry === undefined ? null : toShopEntry(entry);
  }
}

/**
 * The mine rules, straight from game data: the level ladder, the slot ladders and where slots stand.
 * A farm on the hand-composed island uses its fixed mine positions; a chosen island finds its slots
 * from its own stored cells and ore sites.
 */
/** The world's sea chart (docs/design/WORLD_MAP.md), from game data. */
export const gameDataWorldChart: WorldChartPort = {
  regions: SEA_REGIONS,
  wildGeneratorVersion: ISLAND_GENERATOR_VERSION,
  findSlot: (slotId) => findSeaSlot(slotId),
  findArchipelago: (archipelagoId) => findSeaArchipelago(archipelagoId),
  chartedArchipelagos: (homeSlotId, visitedSlotIds) => chartedArchipelagos(homeSlotId, visitedSlotIds),
  nextFreeSlot: (region, isClaimed) => nextFreeSeaSlot(region, isClaimed),
  openArchipelagos: (region, isClaimed) => openArchipelagos(region, isClaimed)
};

/** Game data's gold, wood and ore, as the ledger and the inventory take them. */
function shipPrice(cost: { readonly gold: number; readonly wood: number; readonly ore: number }): ShipPrice {
  return {
    currencyDefinitionId: SHIP_GOLD_CURRENCY_ID,
    gold: cost.gold,
    materials: { [SHIP_WOOD_ITEM_ID]: cost.wood, [SHIP_ORE_ITEM_ID]: cost.ore }
  };
}

export const gameDataShipCatalogue: ShipCatalogue = {
  classes: () =>
    SHIP_CLASSES.map((entry) => ({
      id: entry.id,
      role: entry.role,
      rank: entry.rank,
      tier: entry.tier,
      requiredPlayerLevel: entry.requiredPlayerLevel,
      speedTilesPerMinute: entry.speedTilesPerMinute,
      hull: entry.hull,
      cannons: entry.cannons,
      hold: entry.hold,
      buildCost: shipPrice(entry.buildCost)
    })),
  grounds: () => FISHING_GROUNDS.map((entry) => ({ id: entry.id, seconds: entry.seconds, minRank: entry.minRank })),
  rollCatch: (groundId, hold, roll) => {
    const ground = fishingGround(groundId);
    if (ground === null) throw new Error("Unknown fishing ground");
    return rollTripCatch(ground, hold, roll);
  },
  docks: () =>
    DOCK_TIERS.map((entry) => ({
      tier: entry.tier,
      berths: entry.berths,
      requiredPlayerLevel: entry.requiredPlayerLevel,
      upgradeCost: entry.upgradeCost === null ? null : shipPrice(entry.upgradeCost)
    })),
  voyageSeconds: (distanceTiles, speedTilesPerMinute) => voyageSeconds(distanceTiles, speedTilesPerMinute),
  battle: (classId) => SHIP_BATTLE_NUMBERS[classId] ?? null,
  pirate: (id) => pirateShip(id),
  planAmbush: (input) => planAmbush(input),
  repairCost: (missingHull) => ({
    currencyDefinitionId: SHIP_GOLD_CURRENCY_ID,
    gold: Math.ceil(Math.max(0, missingHull) * SHIP_REPAIR_GOLD_PER_HULL),
    materials: { [SHIP_WOOD_ITEM_ID]: Math.ceil(Math.max(0, missingHull) * SHIP_REPAIR_WOOD_PER_HULL) }
  }),
  bounty: (pirates) => {
    const total = ambushBounty(pirates);
    return {
      currencyDefinitionId: SHIP_GOLD_CURRENCY_ID,
      gold: total.gold,
      materials: { [SHIP_WOOD_ITEM_ID]: total.wood, [SHIP_ORE_ITEM_ID]: total.ore },
      xp: total.xp
    };
  }
};

export const gameDataMineCatalogue: MineCatalogue = {
  levels: () =>
    MINE_LEVELS.map((entry) => ({
      level: entry.level,
      orePerHour: entry.orePerHour,
      requiredPlayerLevel: entry.requiredPlayerLevel,
      upgradeCost:
        entry.upgradeCost === null
          ? null
          : {
              currencyDefinitionId: MINE_GOLD_CURRENCY_ID,
              gold: entry.upgradeCost.gold,
              materials: { [MINE_WOOD_ITEM_ID]: entry.upgradeCost.wood, [MINE_ORE_ITEM_ID]: entry.upgradeCost.ore }
            }
    })),
  accumulationHours: MINE_ACCUMULATION_HOURS,
  orePerXp: MINE_ORE_PER_XP,
  oreItemDefinitionId: MINE_ORE_ITEM_ID,
  slotLevels: (element) => mineSlotLevels(element),
  slotTiles: (island, count) =>
    island === null ? COMPOSED_ISLAND_MINE_POSITIONS.slice(0, count) : islandMineTiles(island, count)
};

/** The warehouse tier table, straight from game data. Capacity lives here; the row stores it. */
export class GameDataWarehouseTiers implements WarehouseTierRepository {
  list() {
    return warehouseTiers.map((tier) => ({
      tier: tier.tier,
      displayNameKey: tier.displayNameKey,
      capacity: tier.capacity,
      requiredLevel: tier.requiredLevel,
      upgrade:
        tier.upgrade === null
          ? null
          : {
              currencyDefinitionId: tier.upgrade.currencyDefinitionId,
              gold: tier.upgrade.gold,
              materials: { ...tier.upgrade.materials }
            }
    }));
  }
}

export class GameDataPlotDefinitions implements PlotDefinitionRepository {
  list(): readonly PlotDefinition[] {
    return [...plotRegistry.values()].map(toPlotDefinition);
  }

  findByIndex(index: number): PlotDefinition | null {
    const definition = plotRegistry.get(`plot_${String(index)}`);
    return definition === undefined ? null : toPlotDefinition(definition);
  }
}

function toPlotDefinition(definition: { readonly id: string; readonly plotIndex: number; readonly displayNameKey: string; readonly currencyDefinitionId: string; readonly price: number; readonly requiredLevel: number }): PlotDefinition {
  return {
    id: parsePlotId(definition.id),
    plotIndex: definition.plotIndex,
    displayNameKey: definition.displayNameKey,
    currencyDefinitionId: parseCurrencyDefinitionId(definition.currencyDefinitionId),
    price: definition.price,
    requiredLevel: definition.requiredLevel
  };
}

function toShopEntry(entry: {
  readonly id: string;
  readonly itemDefinitionId: string;
  readonly currencyDefinitionId: string;
  readonly shopDisplayNameKey?: string | undefined;
  // `| undefined` as well as optional: game data is compiled with `exactOptionalPropertyTypes`, so
  // the parsed entry's absent price is typed as an explicit `undefined`.
  readonly buyPrice?: number | undefined;
  readonly sellPrice?: number | undefined;
  readonly maxQuantityPerRequest: number;
}): ShopEntry {
  return {
    id: parseShopEntryId(entry.id),
    itemDefinitionId: parseItemDefinitionId(entry.itemDefinitionId),
    ...(entry.shopDisplayNameKey === undefined ? {} : { shopDisplayNameKey: entry.shopDisplayNameKey }),
    currencyDefinitionId: parseCurrencyDefinitionId(entry.currencyDefinitionId),
    // A missing price is the explicit "this direction is closed" the domain and the client read.
    // Collapsing it to 0 would read as a free purchase or a zero-value sale instead.
    buyPrice: entry.buyPrice ?? null,
    sellPrice: entry.sellPrice ?? null,
    maxQuantityPerRequest: entry.maxQuantityPerRequest
  };
}

export class Sha256Fingerprint implements PayloadFingerprint {
  async hash(canonicalPayload: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

export class GameDataCropDefinitions implements CropDefinitionRepository {
  list(): readonly CropDefinition[] {
    return [...cropRegistry.values()].map(toCropDefinition);
  }

  findById(id: CropDefinitionId): CropDefinition | null {
    const definition = cropRegistry.get(id);
    return definition === undefined ? null : toCropDefinition(definition);
  }
}

export class GameDataTreeDefinitions implements TreeDefinitionRepository {
  list(): readonly TreeDefinition[] {
    return [...treeRegistry.values()].map(toTreeDefinition);
  }

  findById(id: TreeDefinitionId): TreeDefinition | null {
    const definition = treeRegistry.get(id);
    return definition === undefined ? null : toTreeDefinition(definition);
  }
}

/**
 * Translates one game-data tree into the domain shape.
 *
 * The same optional-key treatment as a crop: the domain is compiled with
 * `exactOptionalPropertyTypes`, so an absent level requirement is added only when game data sets
 * one, and the domain's `requiredLevelForTree` decides what an absent requirement means.
 */
function toTreeDefinition(definition: TreeDefinitionData): TreeDefinition {
  const base = {
    id: parseTreeDefinitionId(definition.id),
    displayNameKey: definition.displayNameKey,
    saplingItemDefinitionId: parseItemDefinitionId(definition.saplingItemDefinitionId),
    firstReadySeconds: definition.firstReadySeconds,
    regrowSeconds: definition.regrowSeconds,
    ...(definition.regenerates === undefined ? {} : { regenerates: definition.regenerates }),
    growthStages: definition.growthStages,
    harvest: {
      itemDefinitionId: parseItemDefinitionId(definition.harvest.itemDefinitionId),
      baseQuantity: definition.harvest.baseQuantity,
      xp: definition.harvest.xp
    }
  };
  return definition.requiredLevel === undefined
    ? base
    : { ...base, requiredLevel: definition.requiredLevel };
}

/**
 * Translates one game-data crop into the domain shape.
 *
 * Game data always carries `requiredLevel` as an optional key, while the domain type is compiled
 * with `exactOptionalPropertyTypes`, so the field is added only when game data sets it. Collapsing
 * "absent" and "1" here would erase the distinction game data is allowed to make, and the domain's
 * `requiredLevelFor` is the function that decides what an absent requirement means.
 */
function toCropDefinition(definition: CropDefinitionData): CropDefinition {
  const base = {
    id: parseCropDefinitionId(definition.id),
    displayNameKey: definition.displayNameKey,
    growthDurationSeconds: definition.growthDurationSeconds,
    growthStages: definition.growthStages,
    seedItemDefinitionId: parseItemDefinitionId(definition.seedItemDefinitionId),
    harvest: {
      itemDefinitionId: parseItemDefinitionId(definition.harvest.itemDefinitionId),
      baseQuantity: definition.harvest.baseQuantity,
      xp: definition.harvest.xp
    }
  };
  return definition.requiredLevel === undefined
    ? base
    : { ...base, requiredLevel: definition.requiredLevel };
}

export class GameDataItemDefinitions implements ItemDefinitionRepository {
  findById(id: ItemDefinitionId): ItemDefinition | null {
    const definition = itemRegistry.get(id);
    return definition === undefined
      ? null
      : {
          id: parseItemDefinitionId(definition.id),
          displayNameKey: definition.displayNameKey,
          category: definition.category,
          stackable: definition.stackable,
          maxStack: definition.maxStack
        };
  }
}

export class UnconfiguredAuthenticator implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(null);
  }
}
