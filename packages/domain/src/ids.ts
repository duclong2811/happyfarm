import { DomainError } from "./errors";

declare const playerIdBrand: unique symbol;
declare const farmIdBrand: unique symbol;
declare const cropInstanceIdBrand: unique symbol;
declare const cropDefinitionIdBrand: unique symbol;
declare const itemDefinitionIdBrand: unique symbol;
declare const currencyDefinitionIdBrand: unique symbol;
declare const shopEntryIdBrand: unique symbol;
declare const plotIdBrand: unique symbol;
declare const treeInstanceIdBrand: unique symbol;
declare const treeDefinitionIdBrand: unique symbol;
declare const economyTransactionIdBrand: unique symbol;

export type PlayerId = string & { readonly [playerIdBrand]: true };
export type FarmId = string & { readonly [farmIdBrand]: true };
export type CropInstanceId = string & { readonly [cropInstanceIdBrand]: true };
export type CropDefinitionId = string & { readonly [cropDefinitionIdBrand]: true };
export type ItemDefinitionId = string & { readonly [itemDefinitionIdBrand]: true };
export type CurrencyDefinitionId = string & { readonly [currencyDefinitionIdBrand]: true };
export type ShopEntryId = string & { readonly [shopEntryIdBrand]: true };
export type PlotId = string & { readonly [plotIdBrand]: true };
export type TreeInstanceId = string & { readonly [treeInstanceIdBrand]: true };
export type TreeDefinitionId = string & { readonly [treeDefinitionIdBrand]: true };
export type EconomyTransactionId = string & { readonly [economyTransactionIdBrand]: true };

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PLAYER_ID_PATTERN = new RegExp(`^player_${UUID_PATTERN}$`, "i");
const FARM_ID_PATTERN = new RegExp(`^farm_${UUID_PATTERN}$`, "i");
const CROP_INSTANCE_ID_PATTERN = new RegExp(`^cropinst_${UUID_PATTERN}$`, "i");
const CROP_DEFINITION_ID_PATTERN = /^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ITEM_DEFINITION_ID_PATTERN = /^item_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CURRENCY_DEFINITION_ID_PATTERN = /^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SHOP_ENTRY_ID_PATTERN = /^shop_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const PLOT_ID_PATTERN = /^plot_[1-9][0-9]*$/;
const TREE_INSTANCE_ID_PATTERN = new RegExp(`^treeinst_${UUID_PATTERN}$`, "i");
const TREE_DEFINITION_ID_PATTERN = /^tree_[a-z0-9]+(?:_[a-z0-9]+)*$/;
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

/**
 * A plot is identified by its index, and by nothing else.
 *
 * The pattern accepts exactly `plot_<n>` for a positive integer `n` with no leading zero, so the
 * identifier and the index cannot disagree: `plotIdForIndex` is the only producer and
 * `parsePlotId` is the only reader. Land geometry, prices, and the level that unlocks a plot are
 * separate concerns owned by game data and the plot domain.
 */
export function parsePlotId(value: string): PlotId {
  if (!PLOT_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid plot ID");
  }
  return value as PlotId;
}

/** The identifier of the plot a given index occupies. The only way to name a plot. */
export function plotIdForIndex(index: number): PlotId {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new DomainError("INVALID_ID", "Invalid plot index");
  }
  return parsePlotId(`plot_${String(index)}`);
}

/**
 * A tree is identified by the instance the planting settlement allocated it.
 *
 * The pattern accepts exactly `treeinst_<uuid>`, mirroring `cropinst_<uuid>`, so an instance id and
 * an identity cannot disagree. The persistent id is what binds a tree to its receipts.
 */
export function parseTreeInstanceId(value: string): TreeInstanceId {
  if (!TREE_INSTANCE_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid tree instance ID");
  }
  return value as TreeInstanceId;
}

export function treeInstanceIdFromUuid(uuid: string): TreeInstanceId {
  return parseTreeInstanceId(`treeinst_${uuid}`);
}

export function parseTreeDefinitionId(value: string): TreeDefinitionId {
  if (!TREE_DEFINITION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid tree definition ID");
  }
  return value as TreeDefinitionId;
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
