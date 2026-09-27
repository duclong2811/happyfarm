import { DomainError } from "./errors";

declare const playerIdBrand: unique symbol;
declare const farmIdBrand: unique symbol;

export type PlayerId = string & { readonly [playerIdBrand]: true };
export type FarmId = string & { readonly [farmIdBrand]: true };

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PLAYER_ID_PATTERN = new RegExp(`^player_${UUID_PATTERN}$`, "i");
const FARM_ID_PATTERN = new RegExp(`^farm_${UUID_PATTERN}$`, "i");

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
