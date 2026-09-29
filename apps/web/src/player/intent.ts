import type { InputVector } from "./input";

/**
 * Why the character is walking, kept apart from how it walks.
 *
 * Today there are two reasons: a held key, and a destination the player picked with "Go". A
 * destination becomes a direct vector here, and that is deliberately the only place the conversion
 * lives: pathfinding, when it arrives, replaces `destination -> vector` with
 * `destination -> waypoints`, and neither the input module nor the UI has to change.
 *
 * The controller still only ever receives a direction and a delta, so it stays the pure, testable
 * movement rule it was; and none of this is authoritative - the server never hears about a
 * destination, exactly as it never hears about a key press.
 */

/** How close counts as arrived. A tile is 1.08 wide, so this is comfortably inside one. */
export const ARRIVAL_RADIUS_WORLD = 0.35;
/** How long a walk may make no progress at all before it gives up. */
export const DESTINATION_STALL_MS = 600;
/** How much closer counts as progress, in world metres. */
export const DESTINATION_PROGRESS_WORLD = 0.02;

export type MovementIntent =
  | { readonly kind: "none" }
  | { readonly kind: "directional"; readonly input: InputVector }
  | { readonly kind: "destination"; readonly worldX: number; readonly worldZ: number };

export const NO_MOVEMENT: MovementIntent = { kind: "none" };

/** A destination, or nothing when there is no target. */
export function destinationIntent(
  destination: { readonly worldX: number; readonly worldZ: number } | null
): MovementIntent {
  return destination === null
    ? NO_MOVEMENT
    : { kind: "destination", worldX: destination.worldX, worldZ: destination.worldZ };
}

/** A held key wins over a destination: the player's own hand always overrules the walk they queued. */
export function intentFor(input: InputVector, destination: { readonly worldX: number; readonly worldZ: number } | null): MovementIntent {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.z)) return NO_MOVEMENT;
  if (input.x !== 0 || input.z !== 0) return { kind: "directional", input };
  return destinationIntent(destination);
}

/** Whether a destination has been reached: laid out as its own question so callers cannot forget it. */
export function hasArrived(
  destination: { readonly worldX: number; readonly worldZ: number },
  position: { readonly x: number; readonly z: number }
): boolean {
  const distance = Math.hypot(destination.worldX - position.x, destination.worldZ - position.z);
  return !Number.isFinite(distance) || distance <= ARRIVAL_RADIUS_WORLD;
}

/**
 * The direction to walk this frame, or null when the character should stand still.
 *
 * A destination vector is a unit vector, so walking to a target is the same speed as holding a key,
 * and reaching one is a distance question rather than a timer.
 */
export function movementVector(
  intent: MovementIntent,
  position: { readonly x: number; readonly z: number }
): InputVector | null {
  switch (intent.kind) {
    case "none":
      return null;
    case "directional":
      return intent.input.x === 0 && intent.input.z === 0 ? null : intent.input;
    case "destination": {
      const dx = intent.worldX - position.x;
      const dz = intent.worldZ - position.z;
      const distance = Math.hypot(dx, dz);
      if (!Number.isFinite(distance) || distance <= ARRIVAL_RADIUS_WORLD) return null;
      return { x: dx / distance, z: dz / distance };
    }
  }
}
