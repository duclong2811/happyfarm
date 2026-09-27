export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "RESOURCE_NOT_FOUND"
  | "CROP_DEFINITION_NOT_FOUND"
  | "CROP_NOT_FOUND"
  | "CROP_NOT_MATURE"
  | "CROP_ALREADY_HARVESTED"
  | "ITEM_DEFINITION_NOT_FOUND"
  | "INVENTORY_LIMIT_EXCEEDED"
  | "TILE_NOT_PLANTABLE"
  | "TILE_OCCUPIED"
  | "CONFLICT_STALE_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
