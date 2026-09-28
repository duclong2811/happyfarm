export type DomainErrorCode =
  | "INVALID_ID"
  | "INVALID_PLAYER"
  | "INVALID_FARM"
  | "INVALID_ROLE"
  | "INVALID_TILE"
  | "INVALID_CROP"
  | "INVALID_INVENTORY_MUTATION"
  | "INVENTORY_LIMIT_EXCEEDED"
  | "INVALID_ECONOMY_MUTATION"
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
