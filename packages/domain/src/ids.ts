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
declare const constructionIdBrand: unique symbol;
declare const fishingActionIdBrand: unique symbol;
declare const resourceActionIdBrand: unique symbol;
declare const warehouseIdBrand: unique symbol;
declare const workAreaIdBrand: unique symbol;
declare const actorIdBrand: unique symbol;
declare const jobIdBrand: unique symbol;

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
export type ConstructionId = string & { readonly [constructionIdBrand]: true };
export type FishingActionId = string & { readonly [fishingActionIdBrand]: true };
export type ResourceActionId = string & { readonly [resourceActionIdBrand]: true };
export type WarehouseId = string & { readonly [warehouseIdBrand]: true };
export type WorkAreaId = string & { readonly [workAreaIdBrand]: true };
export type ActorId = string & { readonly [actorIdBrand]: true };
export type JobId = string & { readonly [jobIdBrand]: true };

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
const FISHING_ACTION_ID_PATTERN = new RegExp(`^fishact_${UUID_PATTERN}$`, "i");
const RESOURCE_ACTION_ID_PATTERN = new RegExp(`^resact_${UUID_PATTERN}$`, "i");
const WAREHOUSE_ID_PATTERN = new RegExp(`^warehouse_${UUID_PATTERN}$`, "i");
const WORK_AREA_ID_PATTERN = new RegExp(`^workarea_${UUID_PATTERN}$`, "i");
const ACTOR_ID_PATTERN = new RegExp(`^actor_${UUID_PATTERN}$`, "i");
const JOB_ID_PATTERN = new RegExp(`^job_${UUID_PATTERN}$`, "i");

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

export function parseFishingActionId(value: string): FishingActionId {
  if (!FISHING_ACTION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid fishing action ID");
  }
  return value as FishingActionId;
}

export function fishingActionIdFromUuid(uuid: string): FishingActionId {
  return parseFishingActionId(`fishact_${uuid}`);
}

export function parseResourceActionId(value: string): ResourceActionId {
  if (!RESOURCE_ACTION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid resource action ID");
  }
  return value as ResourceActionId;
}

export function resourceActionIdFromUuid(uuid: string): ResourceActionId {
  return parseResourceActionId(`resact_${uuid}`);
}

const CONSTRUCTION_ID_PATTERN = new RegExp(`^construct_${UUID_PATTERN}$`, "i");

/**
 * A player construction's identifier.
 *
 * Branded exactly like every other id in the game so a farm id can never be passed where a
 * construction id is expected, and prefixed so a row in the database says what it is.
 */
export function parseConstructionId(value: string): ConstructionId {
  if (!CONSTRUCTION_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid construction ID");
  }
  return value as ConstructionId;
}

export function constructionIdFromUuid(uuid: string): ConstructionId {
  return parseConstructionId(`construct_${uuid}`);
}

/**
 * The stable id of a Home Island warehouse.
 *
 * Derived from the owner's id rather than generated, so a player has exactly one Home Island
 * warehouse and a replayed upgrade cites the same reference. A future expansion island would be a
 * different derived id in its own zone.
 */
export function parseWarehouseId(value: string): WarehouseId {
  if (!WAREHOUSE_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid warehouse ID");
  }
  return value as WarehouseId;
}

export function warehouseIdFromUuid(uuid: string): WarehouseId {
  return parseWarehouseId(`warehouse_${uuid}`);
}

/**
 * The stable id of a player-named work area.
 *
 * A work area's identity is its id and nothing else: the display name is player text, may repeat, and
 * may be renamed, so it can never be a key. Branded like every other id so a work-area id cannot be
 * passed where a farm id is expected (or the reverse).
 */
export function parseWorkAreaId(value: string): WorkAreaId {
  if (!WORK_AREA_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid work area ID");
  }
  return value as WorkAreaId;
}

export function workAreaIdFromUuid(uuid: string): WorkAreaId {
  return parseWorkAreaId(`workarea_${uuid}`);
}

/**
 * The id of an entity that can perform Jobs.
 *
 * An actor is **not** a player: a player is the account authority, and an actor is the thing that
 * works. Today one player has exactly one actor - their Main Character - and a later slice adds NPCs,
 * carts and ships beside it, each with its own id. Keeping them separate now is what makes that a new
 * row rather than a re-identification of everybody's history.
 */
export function parseActorId(value: string): ActorId {
  if (!ACTOR_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid actor ID");
  }
  return value as ActorId;
}

export function actorIdFromUuid(uuid: string): ActorId {
  return parseActorId(`actor_${uuid}`);
}

/** The id of one configured assignment: an actor, an area, a profession and a target. */
export function parseJobId(value: string): JobId {
  if (!JOB_ID_PATTERN.test(value)) {
    throw new DomainError("INVALID_ID", "Invalid job ID");
  }
  return value as JobId;
}

export function jobIdFromUuid(uuid: string): JobId {
  return parseJobId(`job_${uuid}`);
}
