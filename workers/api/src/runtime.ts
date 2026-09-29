import {
  cropInstanceIdFromUuid,
  economyTransactionIdFromUuid,
  farmIdFromUuid,
  parseCropDefinitionId,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  parsePlotId,
  parseShopEntryId,
  type CropDefinition,
  type CropDefinitionId,
  type CropInstanceId,
  type FarmId,
  type CurrencyDefinition,
  type CurrencyDefinitionId,
  type EconomyTransactionId,
  type ItemDefinition,
  type ItemDefinitionId,
  type ProgressionDefinition,
  type PlotDefinition,
  type ShopEntry,
  type ShopEntryId
} from "@happy-farm/domain";
import type {
  ActorContext,
  AuthenticationPort,
  Clock,
  CropDefinitionRepository,
  CropIdGenerator,
  CurrencyDefinitionRepository,
  EconomyTransactionIdGenerator,
  IdGenerator,
  ItemDefinitionRepository,
  PlotDefinitionRepository,
  PayloadFingerprint,
  ShopEntryRepository
} from "@happy-farm/application";
import {
  cropRegistry,
  currencyRegistry,
  itemRegistry,
  playerProgression,
  plotRegistry,
  shopRegistry,
  type CropDefinitionData
} from "@happy-farm/game-data";

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

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator, CropIdGenerator, EconomyTransactionIdGenerator {
  newFarmId(): FarmId {
    return farmIdFromUuid(crypto.randomUUID());
  }

  newCropInstanceId(): CropInstanceId {
    return cropInstanceIdFromUuid(crypto.randomUUID());
  }

  newEconomyTransactionId(): EconomyTransactionId {
    return economyTransactionIdFromUuid(crypto.randomUUID());
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
  readonly buyPrice: number;
  readonly sellPrice: number;
  readonly maxQuantityPerRequest: number;
}): ShopEntry {
  return {
    id: parseShopEntryId(entry.id),
    itemDefinitionId: parseItemDefinitionId(entry.itemDefinitionId),
    currencyDefinitionId: parseCurrencyDefinitionId(entry.currencyDefinitionId),
    buyPrice: entry.buyPrice,
    sellPrice: entry.sellPrice,
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
