export type DomainErrorCode =
  | "INVALID_ID"
  | "INVALID_PLAYER"
  | "INVALID_FARM"
  | "INVALID_ROLE"
  | "INVALID_TILE"
  | "INVALID_CROP"
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
