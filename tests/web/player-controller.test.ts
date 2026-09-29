import { describe, expect, it } from "vitest";
import {
  createPlayerState,
  MAX_FRAME_DELTA_SECONDS,
  normalizeInput,
  PLAYER_SPEED,
  playerTile,
  shortestAngleDelta,
  stepPlayer,
  TURN_SPEED_RADIANS_PER_SECOND,
  turnToward,
  type CollisionWorld,
  type PlayerState
} from "../../apps/web/src/player/controller";
import type { InputVector } from "../../apps/web/src/player/input";
import { worldFrame, worldToTile } from "../../apps/web/src/render/layout";

/** Nothing blocks anything: the world the movement maths is checked against. */
const OPEN_WORLD: CollisionWorld = { depth: () => 0 };

function spawn(): PlayerState {
  return createPlayerState({ worldX: 0, worldZ: 0 }, 0);
}

/** Runs `frames` steps covering `seconds`, so the same distance can be walked at two frame sizes. */
function walk(input: InputVector, seconds: number, frames: number, world: CollisionWorld = OPEN_WORLD): PlayerState {
  let state = spawn();
  for (let frame = 0; frame < frames; frame += 1) {
    state = stepPlayer(state, input, seconds / frames, world);
  }
  return state;
}

const NORTH: InputVector = { x: 0, z: 1 };
const EAST: InputVector = { x: 1, z: 0 };

describe("player movement", () => {
  it("covers the same ground whatever the frame size", () => {
    const fine = walk(NORTH, 1, 60);
    const coarse = walk(NORTH, 1, 20);
    expect(fine.z).toBeCloseTo(PLAYER_SPEED, 6);
    expect(coarse.z).toBeCloseTo(fine.z, 6);
    expect(fine.movementState).toBe("WALKING");
  });

  it("clamps a frame that was stalled or restored from the background", () => {
    const stalled = stepPlayer(spawn(), NORTH, 5, OPEN_WORLD);
    const capped = stepPlayer(spawn(), NORTH, MAX_FRAME_DELTA_SECONDS, OPEN_WORLD);
    expect(stalled.z).toBeCloseTo(capped.z, 9);
    expect(stalled.z).toBeLessThan(PLAYER_SPEED * 0.1);
    expect(stepPlayer(spawn(), NORTH, Number.NaN, OPEN_WORLD).z).toBe(0);
  });

  it("does not walk faster on a diagonal", () => {
    const diagonal = walk({ x: 1, z: 1 }, 1, 60);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(diagonal.x).toBeCloseTo(diagonal.z, 6);
  });

  it("stays still when the keys cancel out", () => {
    expect(normalizeInput({ x: 0, z: 0 })).toBeNull();
    expect(normalizeInput({ x: Number.NaN, z: 1 })).toBeNull();
    const state = stepPlayer(spawn(), { x: 0, z: 1 }, 0.05, OPEN_WORLD);
    const cancelled = stepPlayer(state, { x: 0, z: 0 }, 0.05, OPEN_WORLD);
    expect(cancelled.z).toBeCloseTo(state.z, 9);
    expect(cancelled.movementState).toBe("IDLE");
  });

  it("faces the way it walks", () => {
    const north = walk(NORTH, 1, 60);
    expect(north.facingYaw).toBeCloseTo(0, 6);
    const east = walk(EAST, 1, 60);
    expect(east.facingYaw).toBeCloseTo(Math.PI / 2, 6);
    const west = walk({ x: -1, z: 0 }, 1, 60);
    expect(west.facingYaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("turns the short way round, and no faster than it can turn", () => {
    expect(shortestAngleDelta(3, -3)).toBeCloseTo(Math.PI * 2 - 6, 9);
    expect(shortestAngleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 9);
    // A right angle is more than one frame's turn, so it moves part of the way instead.
    expect(turnToward(0, Math.PI / 2, TURN_SPEED_RADIANS_PER_SECOND * 0.01)).toBeCloseTo(0.12, 9);
    // A small correction lands exactly on target rather than overshooting.
    expect(turnToward(0, 0.01, 1)).toBe(0.01);
    // The short way from just past +pi is forward, not back.
    expect(turnToward(-3.1, 3.1, 10)).toBe(3.1);
  });

  it("counts time under load, and only under load", () => {
    const walking = walk(NORTH, 0.5, 30);
    expect(walking.elapsedWalk).toBeCloseTo(0.5, 6);
    const stopped = stepPlayer(walking, { x: 0, z: 0 }, 0.05, OPEN_WORLD);
    expect(stopped.elapsedWalk).toBeCloseTo(walking.elapsedWalk, 9);
    expect(stopped.movementState).toBe("IDLE");
  });

  it("reports the tile a world position falls on", () => {
    const frame = worldFrame();
    const state = { ...spawn(), x: 0, z: 0 };
    expect(playerTile(state, (world) => worldToTile(world, frame))).toEqual({ x: 3, y: 3 });
    // 2.5, 24 is the configured spawn tile, and the fixed frame must keep reporting it.
    const away = walk(NORTH, 1, 60);
    expect(playerTile(away, (world) => worldToTile(world, frame)).x).toBe(3);
    expect(playerTile(away, (world) => worldToTile(world, frame)).y).toBe(5);
  });
});

describe("player collision response", () => {
  it("stops at a wall instead of walking through it", () => {
    const wall: CollisionWorld = { depth: (_x, z) => (z > 1 ? 1 : 0) };
    const state = walk(NORTH, 4, 240, wall);
    expect(state.z).toBeLessThanOrEqual(1);
    expect(state.z).toBeGreaterThan(0.9);
  });

  it("slides along a wall rather than sticking to it", () => {
    const wall: CollisionWorld = { depth: (_x, z) => (z > 0.5 ? 1 : 0) };
    let state: PlayerState = { ...spawn(), z: 0.45 };
    for (let frame = 0; frame < 60; frame += 1) {
      state = stepPlayer(state, { x: 1, z: 1 }, 1 / 60, wall);
    }
    expect(state.z).toBeLessThanOrEqual(0.5);
    expect(state.x).toBeGreaterThan(1);
  });

  it("lets a character who is already overlapping escape, but never sink deeper", () => {
    // Depth grows with x, so +x is deeper into the obstacle and -x is the way out.
    const world: CollisionWorld = { depth: (x) => x };
    const stuck: PlayerState = { ...spawn(), x: 0.5 };
    const deeper = stepPlayer(stuck, EAST, 0.05, world);
    const escaping = stepPlayer(stuck, { x: -1, z: 0 }, 0.05, world);
    expect(deeper.x).toBeCloseTo(stuck.x, 9);
    expect(escaping.x).toBeLessThan(stuck.x);
  });

  it("cannot be pushed past an obstacle even at full speed", () => {
    // Every real blocker - a tile, the pond, the shore - is wider than the longest possible step,
    // which is one clamped frame. A candidate that lands behind one is refused as firmly as a
    // candidate that lands on it.
    const wall: CollisionWorld = { depth: (_x, z) => (z > 3 ? 1 : 0) };
    let state = spawn();
    for (let frame = 0; frame < 600; frame += 1) {
      state = stepPlayer(state, NORTH, 0.05, wall);
    }
    expect(state.z).toBeLessThanOrEqual(3);
    expect(state.z).toBeGreaterThan(2.9);
  });
});
