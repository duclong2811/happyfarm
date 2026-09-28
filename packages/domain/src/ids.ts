import { DomainError } from "./errors";

declare const playerIdBrand: unique symbol;
declare const farmIdBrand: unique symbol;
declare const cropInstanceIdBrand: unique symbol;
declare const cropDefinitionIdBrand: unique symbol;
declare const itemDefinitionIdBrand: unique symbol;
declare const currencyDefinitionIdBrand: unique symbol;
declare const shopEntryIdBrand: unique symbol;
declare const economyTransactionIdBrand: unique symbol;

export type PlayerId = string & { readonly [playerIdBrand]: true };
export type FarmId = string & { readonly [farmIdBrand]: true };
export type CropInstanceId = string & { readonly [cropInstanceIdBrand]: true };
export type CropDefinitionId = string & { readonly [cropDefinitionIdBrand]: true };
export type ItemDefinitionId = string & { readonly [itemDefinitionIdBrand]: true };
export type CurrencyDefinitionId = string & { readonly [currencyDefinitionIdBrand]: true };
export type ShopEntryId = string & { readonly [shopEntryIdBrand]: true };
export type EconomyTransactionId = string & { readonly [economyTransactionIdBrand]: true };

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PLAYER_ID_PATTERN = new RegExp(`^player_${UUID_PATTERN}$`, "i");
const FARM_ID_PATTERN = new RegExp(`^farm_${UUID_PATTERN}$`, "i");
const CROP_INSTANCE_ID_PATTERN = new RegExp(`^cropinst_${UUID_PATTERN}$`, "i");
const CROP_DEFINITION_ID_PATTERN = /^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ITEM_DEFINITION_ID_PATTERN = /^item_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CURRENCY_DEFINITION_ID_PATTERN = /^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SHOP_ENTRY_ID_PATTERN = /^shop_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ECONOMY_TRANSACTION_ID_PATTERN = new RegExp(`^econ_${UUID_PATTERN}$`, "i");

export function parsePlayerId(value: string): PlayerId {
  if (!PLAYER_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid player ID");
  }
  return value as PlayerId;
}

export function parseFarmId(value: string): FarmId {
  if (!FARM_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid farm ID");
  }
  return value as FarmId;
}

export function playerIdFromUuid(uuid: string): PlayerId {
  return parsePlayerId(`player_${uuid}`);
}

export function farmIdFromUuid(uuid: string): FarmId {
  return parseFarmId(`farm_${uuid}`);
}

export function parseCropInstanceId(value: string): CropInstanceId {
  if (!CROP_INSTANCE_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid crop instance ID");
  }
  return value as CropInstanceId;
}

export function cropInstanceIdFromUuid(uuid: string): CropInstanceId {
  return parseCropInstanceId(`cropinst_${uuid}`);
}

export function parseCropDefinitionId(value: string): CropDefinitionId {
  if (!CROP_DEFINITION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid crop definition ID");
  }
  return value as CropDefinitionId;
}

export function parseItemDefinitionId(value: string): ItemDefinitionId {
  if (!ITEM_DEFINITION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid item definition ID");
  }
  return value as ItemDefinitionId;
}

export function parseCurrencyDefinitionId(value: string): CurrencyDefinitionId {
  if (!CURRENCY_DEFINITION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid currency definition ID");
  }
  return value as CurrencyDefinitionId;
}

export function parseShopEntryId(value: string): ShopEntryId {
  if (!SHOP_ENTRY_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid shop entry ID");
  }
  return value as ShopEntryId;
}

export function parseEconomyTransactionId(value: string): EconomyTransactionId {
  if (!ECONOMY_TRANSACTION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid economy transaction ID");
  }
  return value as EconomyTransactionId;
}

export function economyTransactionIdFromUuid(uuid: string): EconomyTransactionId {
  return parseEconomyTransactionId(`econ_${uuid}`);
}
