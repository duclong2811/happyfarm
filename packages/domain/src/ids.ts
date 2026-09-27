import { DomainError } from "./errors";

declare const playerIdBrand: unique symbol;
declare const farmIdBrand: unique symbol;
declare const cropInstanceIdBrand: unique symbol;
declare const cropDefinitionIdBrand: unique symbol;

export type PlayerId = string & { readonly [playerIdBrand]: true };
export type FarmId = string & { readonly [farmIdBrand]: true };
export type CropInstanceId = string & { readonly [cropInstanceIdBrand]: true };
export type CropDefinitionId = string & { readonly [cropDefinitionIdBrand]: true };

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PLAYER_ID_PATTERN = new RegExp(`^player_${UUID_PATTERN}$`, "i");
const FARM_ID_PATTERN = new RegExp(`^farm_${UUID_PATTERN}$`, "i");
const CROP_INSTANCE_ID_PATTERN = new RegExp(`^cropinst_${UUID_PATTERN}$`, "i");
const CROP_DEFINITION_ID_PATTERN = /^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/;

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
