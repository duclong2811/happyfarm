import type { TileCoordinate } from "../render/layout";
import type { InputVector } from "./input";

/**
 * The player's simulated state and the one function that advances it.
 *
 * Pure by design: no three, no DOM, no network, no clock. Time arrives as a delta, collision arrives
 * as a function, and the result is a plain value, so the whole controller can be tested without a
 * canvas and the renderer only has to copy the outcome onto a transform.
 *
 * The position is client-local and has no authority: nothing the server does depends on it, and it
 * cannot change what the server lets the player do.
 */

export type MovementState = "IDLE" | "WALKING";

export interface PlayerState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Shortest-angle yaw the character is turning towards; see `turnToward`. */
  readonly facingYaw: number;
  readonly movementState: MovementState;
  /** Seconds spent walking, for the renderer's limb swing. Never a gameplay quantity. */
  readonly elapsedWalk: number;
}

/** What the controller needs to know about the world: a signed penetration depth at a point. */
export interface CollisionWorld {
  /** 0 when the point is free, > 0 when the player circle overlaps something at that point. */
  depth(x: number, z: number): number;
}

export const PLAYER_RADIUS = 0.28;
export const PLAYER_SPEED = 2.6;
export const MAX_FRAME_DELTA_SECONDS = 0.05;
export const MAX_SUBSTEPS = 8;
export const TURN_SPEED_RADIANS_PER_SECOND = 12;

export function createPlayerState(spawn: { readonly worldX: number; readonly worldZ: number }, feetY: number): PlayerState {
  return { x: spawn.worldX, y: feetY, z: spawn.worldZ, facingYaw: 0, movementState: "IDLE", elapsedWalk: 0 };
}

/** The input direction as a unit vector, or null when there is none (including opposite keys). */
export function normalizeInput(input: InputVector): { readonly x: number; readonly z: number } | null {
  const length = Math.hypot(input.x, input.z);
  if (!Number.isFinite(length) || length <= 0) return null;
  return { x: input.x / length, z: input.z / length };
}

/** The signed shortest way from one angle to another, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  const full = Math.PI * 2;
  let delta = (to - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return delta;
}

/** Rotates `current` towards `target` by at most `maxDelta`, the short way round. */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const delta = shortestAngleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/**
 * Advances the player by one frame.
 *
 * Frame-rate independence comes from doing everything in seconds: the same input over the same total
 * time produces the same displacement whatever the frame size. Abnormal deltas (a restored tab, a
 * stalled frame) are clamped and then split into bounded substeps, so a long gap cannot teleport the
 * player through a fence.
 *
 * A player who is already overlapping an obstacle - a crop planted where they happen to stand - may
 * move out but not deeper in. That is decided here, deliberately, rather than left to whichever
 * candidate happens to be free.
 */
export function stepPlayer(
  state: PlayerState,
  input: InputVector,
  deltaSeconds: number,
  world: CollisionWorld
): PlayerState {
  const dt = Number.isFinite(deltaSeconds) ? Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA_SECONDS) : 0;
  const direction = normalizeInput(input);
  if (direction === null || dt === 0) {
    return state.movementState === "IDLE" ? state : { ...state, movementState: "IDLE" };
  }

  const targetYaw = Math.atan2(direction.x, direction.z);
  const facingYaw = turnToward(state.facingYaw, targetYaw, TURN_SPEED_RADIANS_PER_SECOND * dt);
  const distance = PLAYER_SPEED * dt;
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(distance / (PLAYER_RADIUS * 0.5))));
  const stepX = (direction.x * distance) / steps;
  const stepZ = (direction.z * distance) / steps;

  let x = state.x;
  let z = state.z;
  for (let step = 0; step < steps; step += 1) {
    const next = resolveStep(world, x, z, stepX, stepZ);
    x = next.x;
    z = next.z;
  }

  const moved = x !== state.x || z !== state.z;
  return {
    x,
    y: state.y,
    z,
    facingYaw,
    movementState: moved ? "WALKING" : "IDLE",
    elapsedWalk: moved ? state.elapsedWalk + dt : state.elapsedWalk
  };
}

/**
 * One substep, with sliding.
 *
 * The full move is tried first; when it is blocked, each axis is tried alone so the player slides
 * along a fence instead of sticking to it. A player who already overlaps something may take a step
 * that reduces the overlap (moving out) but never one that increases it.
 */
function resolveStep(
  world: CollisionWorld,
  x: number,
  z: number,
  stepX: number,
  stepZ: number
): { readonly x: number; readonly z: number } {
  const currentDepth = world.depth(x, z);
  const allow = (candidateX: number, candidateZ: number): boolean => {
    const depth = world.depth(candidateX, candidateZ);
    return currentDepth > 0 ? depth < currentDepth : depth <= 0;
  };

  if (allow(x + stepX, z + stepZ)) return { x: x + stepX, z: z + stepZ };
  if (stepX !== 0 && allow(x + stepX, z)) return { x: x + stepX, z };
  if (stepZ !== 0 && allow(x, z + stepZ)) return { x, z: z + stepZ };
  return { x, z };
}

/** The tile the player stands on, for debugging and for future proximity hints. */
export function playerTile(state: PlayerState, toTile: (world: { worldX: number; worldZ: number }) => TileCoordinate): TileCoordinate {
  return toTile({ worldX: state.x, worldZ: state.z });
}
