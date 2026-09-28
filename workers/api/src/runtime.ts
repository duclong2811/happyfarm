import {
  cropInstanceIdFromUuid,
  economyTransactionIdFromUuid,
  farmIdFromUuid,
  parseCropDefinitionId,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
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
  PayloadFingerprint,
  ShopEntryRepository
} from "@happy-farm/application";
import { cropRegistry, currencyRegistry, itemRegistry, shopRegistry } from "@happy-farm/game-data";

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
  findById(id: CropDefinitionId): CropDefinition | null {
    const definition = cropRegistry.get(id);
    if (definition === undefined) return null;
    return definition.requiredFarmLevel === undefined
      ? {
          id: parseCropDefinitionId(definition.id),
          displayNameKey: definition.displayNameKey,
          growthDurationSeconds: definition.growthDurationSeconds,
          growthStages: definition.growthStages,
          harvest: {
            itemDefinitionId: parseItemDefinitionId(definition.harvest.itemDefinitionId),
            baseQuantity: definition.harvest.baseQuantity
          }
        }
      : {
          id: parseCropDefinitionId(definition.id),
          displayNameKey: definition.displayNameKey,
          growthDurationSeconds: definition.growthDurationSeconds,
          growthStages: definition.growthStages,
          requiredFarmLevel: definition.requiredFarmLevel,
          harvest: {
            itemDefinitionId: parseItemDefinitionId(definition.harvest.itemDefinitionId),
            baseQuantity: definition.harvest.baseQuantity
          }
        };
  }
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
