import {
  cropInstanceIdFromUuid,
  economyTransactionIdFromUuid,
  constructionIdFromUuid,
  farmIdFromUuid,
  parseCropDefinitionId,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  parsePlotId,
  parseShopEntryId,
  parseTreeDefinitionId,
  treeInstanceIdFromUuid,
  type CropDefinition,
  type CropDefinitionId,
  type CropInstanceId,
  type ConstructionDefinition,
  type ConstructionId,
  type FarmId,
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
  type TreeInstanceId
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
  IdGenerator,
  ItemDefinitionRepository,
  PlotDefinitionRepository,
  PayloadFingerprint,
  ShopEntryRepository,
  StarterPackageDefinition,
  TreeDefinitionRepository,
  TreeIdGenerator,
  TileTerrainLookup
} from "@happy-farm/application";
import {
  cropRegistry,
  currencyRegistry,
  gameplayFor,
  itemRegistry,
  placementEntries,
  playerProgression,
  plotRegistry,
  shopRegistry,
  starterPackage,
  treeRegistry,
  STARTER_WORLD_PLACEMENTS,
  STARTER_WORLD_VERSION,
  classifyTile,
  worldObjectDefinition,
  WORLD_OBJECT_DEFINITIONS,
  type CropDefinitionData,
  type TreeDefinitionData
} from "@happy-farm/game-data";

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
    tile: { x: placement.tile.x, y: placement.tile.y },
    rotation: placement.rotation
  }))
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

/** Every ordinary world object the client may draw and edit, as the wire carries it. */
export function listWorldObjectDefinitions(): readonly {
  readonly id: string;
  readonly displayNameKey: string;
  readonly modelId: string | null;
  readonly landmarkKind: string | null;
  readonly sizeWorld: number;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  readonly allowedTerrain: ("LAND" | "SHORE" | "SHALLOW_WATER" | "WATER")[];
  readonly movable: boolean;
  readonly rotatable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  readonly removalRefundRate: number;
}[] {
  return WORLD_OBJECT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    displayNameKey: definition.displayNameKey,
    modelId: definition.presentation.form === "MODEL" ? definition.presentation.modelId : null,
    landmarkKind: definition.presentation.form === "LANDMARK" ? definition.presentation.kind : null,
    sizeWorld: definition.presentation.form === "MODEL" ? definition.presentation.sizeWorld : 1,
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
  implements IdGenerator, CropIdGenerator, TreeIdGenerator, EconomyTransactionIdGenerator, ConstructionIdGenerator
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
  // `| undefined` as well as optional: game data is compiled with `exactOptionalPropertyTypes`, so
  // the parsed entry's absent price is typed as an explicit `undefined`.
  readonly buyPrice?: number | undefined;
  readonly sellPrice?: number | undefined;
  readonly maxQuantityPerRequest: number;
}): ShopEntry {
  return {
    id: parseShopEntryId(entry.id),
    itemDefinitionId: parseItemDefinitionId(entry.itemDefinitionId),
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
