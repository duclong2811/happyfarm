export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT_STALE_STATE"
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
