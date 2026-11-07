import { ApplicationError } from "./errors";

/** The only identity an Auto economic transition uses. */
export function autoTransitionId(input: {
  readonly actorId: string;
  /**
   * The assignment the transition belongs to, or null for an actor-level step.
   *
   * A delivery (UNLOAD) is the *actor's* step rather than one assignment's - a full pair of hands is
   * a fact about the character - so it names the actor rather than inventing an assignment to blame.
   */
  readonly assignmentId: string | null;
  readonly kind: "PLANT" | "LOAD_INPUT" | "PURCHASE_INPUT" | "HARVEST" | "UNLOAD" | "MINE";
  readonly x?: number;
  readonly y?: number;
  readonly eventTime: string;
}): string {
  if (input.kind === "PLANT" && (!Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y))) {
    throw new ApplicationError("INVALID_INPUT", "Auto transition coordinates must be integers");
  }
  // The durable idempotency key is capped at 100 characters by the schema. Actor and assignment
  // identifiers are UUID-shaped, so their final 16 characters retain the stable namespace while
  // keeping the semantic key within that bound.
  const target = input.kind === "PLANT" ? `-${String(input.x)}-${String(input.y)}` : "";
  const scope = input.assignmentId === null ? "actor" : input.assignmentId.slice(-16);
  return `auto-${input.actorId.slice(-16)}-${scope}-${input.kind}${target}-${input.eventTime.replaceAll(/[^0-9]/gu, "")}`;
}

/** Validates time supplied by a trusted server-side simulation caller. */
export function assertTrustedAutoEventTime(input: {
  readonly eventTime: string;
  readonly serverNow: string;
  readonly simulationAt: string | null;
}): void {
  const eventMs = Date.parse(input.eventTime);
  const nowMs = Date.parse(input.serverNow);
  const simulationMs = input.simulationAt === null ? null : Date.parse(input.simulationAt);
  if (!Number.isFinite(eventMs) || !Number.isFinite(nowMs) || (simulationMs !== null && !Number.isFinite(simulationMs))) {
    throw new ApplicationError("INVALID_INPUT", "Auto event time is invalid");
  }
  if (eventMs > nowMs) throw new ApplicationError("INVALID_INPUT", "Auto event time is in the future");
  if (simulationMs !== null && eventMs < simulationMs) {
    throw new ApplicationError("CONFLICT_STALE_STATE", "Auto event time is before the simulation watermark");
  }
}
