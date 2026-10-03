import { DomainError } from "./errors";

/**
 * The two time questions every timed action asks, in one place.
 *
 * Crop maturity, tree cycles, fishing waits and resource regeneration are all "server instant plus a
 * duration" and "how long until that instant" - so the arithmetic lives here rather than being
 * restated per feature, and every caller inherits the same refusal of unusable input.
 */

/** The instant `seconds` after `startedAt`, as an ISO string. */
export function instantAfter(startedAt: string, seconds: number): string {
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    throw new DomainError("INVALID_INSTANT", "Start time is invalid");
  }
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new DomainError("INVALID_INSTANT", "Duration is invalid");
  }
  return new Date(startedMs + seconds * 1000).toISOString();
}

/** Whole seconds from `serverTime` until `instant`, never negative and never NaN. */
export function secondsUntil(instant: string, serverTime: string): number {
  const targetMs = Date.parse(instant);
  const serverMs = Date.parse(serverTime);
  if (!Number.isFinite(targetMs) || !Number.isFinite(serverMs)) {
    throw new DomainError("INVALID_INSTANT", "Timing is invalid");
  }
  return Math.max(0, Math.ceil((targetMs - serverMs) / 1000));
}

/** Whether the server's clock has reached `instant`. */
export function isAtOrAfter(instant: string, serverTime: string): boolean {
  return secondsUntil(instant, serverTime) === 0;
}
