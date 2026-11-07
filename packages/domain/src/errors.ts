export type DomainErrorCode =
  | "INVALID_ID"
  | "INVALID_PLAYER"
  | "INVALID_FARM"
  | "INVALID_ROLE"
  | "INVALID_TILE"
  | "INVALID_CROP"
  | "INVALID_FISHING"
  | "INVALID_INSTANT"
  | "INVALID_RESOURCE"
  | "INVALID_TREE"
  | "INVALID_INVENTORY_MUTATION"
  | "INVENTORY_LIMIT_EXCEEDED"
  | "WAREHOUSE_FULL"
  | "INVALID_WAREHOUSE"
  | "INVALID_WORK_AREA"
  | "WORK_AREA_TOO_MANY_CELLS"
  | "INVALID_ACTOR"
  | "INVALID_JOB"
  | "JOB_REORDER_MISMATCH"
  | "INVALID_CARGO"
  | "CARGO_FULL"
  /** An emergency-funding policy or plan is not well formed. */
  | "INVALID_FUNDING"
  /** A place an actor can be, or a walk between two of them, is not well formed. */
  | "INVALID_ANCHOR"
  | "INVALID_ECONOMY_MUTATION"
  | "INVALID_PLOT"
  | "INVALID_ROTATION"
  | "INVALID_FOOTPRINT"
  | "INSUFFICIENT_FUNDS"
  | "WALLET_LIMIT_EXCEEDED"
  | "INVALID_PROGRESSION"
  | "PROGRESSION_LIMIT_EXCEEDED"
  | "CONFLICT_STALE_STATE";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}
