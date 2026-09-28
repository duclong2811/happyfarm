/**
 * Cosmetic display labels for the development UI.
 *
 * Definition IDs are the stable identifiers. Display names are presentation-only and are never
 * sent to the server; unknown IDs fall back to the raw identifier so a new definition still renders.
 */
const CROP_LABELS: Record<string, string> = {
  crop_carrot: "Carrot",
  crop_wheat: "Wheat",
  crop_corn: "Corn"
};

const ITEM_LABELS: Record<string, string> = {
  item_carrot: "Carrot",
  item_wheat: "Wheat",
  item_corn: "Corn"
};

const CURRENCY_LABELS: Record<string, string> = {
  currency_gold: "Gold"
};

export function cropLabel(definitionId: string): string {
  return CROP_LABELS[definitionId] ?? definitionId;
}

export function itemLabel(definitionId: string): string {
  return ITEM_LABELS[definitionId] ?? definitionId;
}

export function currencyLabel(currencyId: string): string {
  return CURRENCY_LABELS[currencyId] ?? currencyId;
}

const ERROR_LABELS: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough gold for that purchase.",
  INSUFFICIENT_ITEMS: "You do not have that many items.",
  CROP_NOT_MATURE: "That crop is still growing.",
  CROP_ALREADY_HARVESTED: "That crop was already harvested.",
  CROP_LEVEL_REQUIRED: "That crop needs a higher level than this player has.",
  TILE_OCCUPIED: "That tile is already planted.",
  TILE_NOT_PLANTABLE: "That tile cannot be planted.",
  CONFLICT_STALE_STATE: "The server state moved on; refresh and retry.",
  IDEMPOTENCY_CONFLICT: "That request id was already used for a different action.",
  REQUEST_ALREADY_PROCESSED: "That request was already processed.",
  INVENTORY_LIMIT_EXCEEDED: "Inventory limit reached.",
  NOT_AUTHENTICATED: "Not authenticated: check the development token.",
  NOT_AUTHORIZED: "Not allowed for this farm.",
  RESOURCE_NOT_FOUND: "Not found on the server.",
  INTERNAL_ERROR: "Server error.",
  INVALID_INPUT: "The request was rejected as invalid."
};

export function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code;
}
