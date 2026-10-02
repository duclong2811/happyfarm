import { describe, expect, it } from "vitest";
import {
  PLAYER_MAX_SLOPE,
  PLAYER_MAX_STEP_WORLD,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  createPlayerState,
  stepPlayer,
  type CollisionWorld,
  type PlayerState
} from "../../apps/web/src/player/controller";
import {
  NO_CHARACTER_INTENT,
  RUN_SPEED_MULTIPLIER,
  cameraRelativeMovement,
  characterIntentFromInput,
  composeCharacterInput,
  intentIsNeutral
} from "../../apps/web/src/player/character-input";
import type { InputVector } from "../../apps/web/src/player/input";
import { createPlayerCollisionWorld, slopeBlocks, type TerrainFollow } from "../../apps/web/src/player/collision";
import { createPlayerRuntime } from "../../apps/web/src/player/runtime";
import type { WorldObstacle } from "../../apps/web/src/render/world-config";

/**
 * Walking the island in character view.
 *
 * The keys produce an *intent* rather than a world direction, the camera's own yaw is what turns that
 * intent into a direction, and the controller does the rest - so these tests are about the two rules
 * the player actually feels: W means "away from the camera", and W+D is not faster than W. The last
 * two suites pin the ground the character stands on and the things they cannot walk through.
 */

const FLAT: CollisionWorld = { depth: () => 0 };

function state(x = 0, z = 0): PlayerState {
  return createPlayerState({ worldX: x, worldZ: z }, 0);
}

/** A wall of circles along z = 1, so a walk north is blocked and a walk east is not. */
function wallWorld(radius = 0.6): CollisionWorld {
  return {
    depth(x: number, z: number): number {
      const distance = Math.hypot(x - 0, z - 1);
      return PLAYER_RADIUS + radius - distance;
    }
  };
}

describe("the movement intent", () => {
  it("lets exactly one adapter steer, so two inputs at once cannot double the speed", () => {
    // The composition rule (V13.5): a deflected touch stick wins, otherwise the keyboard does. Not a
    // sum - a sum would veer when a hybrid player pushes both, and would make the pace depend on how
    // many devices are plugged in.
    const keyboardOnly = composeCharacterInput({ forward: 1, right: 0 }, NO_CHARACTER_INTENT);
    expect(keyboardOnly.source).toBe("KEYBOARD");
    expect(keyboardOnly.intent).toEqual({ forward: 1, right: 0 });

    const touchOnly = composeCharacterInput(NO_CHARACTER_INTENT, { forward: 0, right: -1 });
    expect(touchOnly.source).toBe("TOUCH");
    expect(touchOnly.intent).toEqual({ forward: 0, right: -1 });

    const both = composeCharacterInput({ forward: 1, right: 0 }, { forward: 0, right: 1 });
    expect(both.source).toBe("TOUCH");
    // One unit in total, not two: the keyboard's contribution is not added in.
    expect(Math.hypot(both.intent.forward, both.intent.right)).toBeCloseTo(1, 9);

    const neither = composeCharacterInput(NO_CHARACTER_INTENT, NO_CHARACTER_INTENT);
    expect(neither.source).toBe("NONE");
    expect(neither.intent).toEqual({ forward: 0, right: 0 });
    expect(intentIsNeutral(neither.intent)).toBe(true);
    // Sloppy numbers from a future adapter are treated as "not asking to move"...
    expect(intentIsNeutral({ forward: Number.NaN, right: 0 })).toBe(true);
    // ...and a stick pushed past its rim is clamped rather than being trusted.
    const overpushed = composeCharacterInput(NO_CHARACTER_INTENT, { forward: 4, right: -3 }).intent;
    expect(Math.hypot(overpushed.forward, overpushed.right)).toBeCloseTo(1, 9);
  });

  it("gives the controller the same input whichever adapter asked for it", () => {
    // The invariant the brief insists on: there is no second movement implementation. A keyboard push
    // and a joystick push that mean the same thing produce the same intent, the same world vector and
    // therefore the same step - one code path, two input sources.
    const wantForwardRight = { forward: 0.707, right: 0.707 };
    const fromKeyboard = composeCharacterInput(characterIntentFromInput({ x: 0.707, z: 0.707 }), NO_CHARACTER_INTENT);
    const fromJoystick = composeCharacterInput(NO_CHARACTER_INTENT, wantForwardRight);
    expect(fromKeyboard.intent.forward).toBeCloseTo(fromJoystick.intent.forward, 6);
    expect(fromKeyboard.intent.right).toBeCloseTo(fromJoystick.intent.right, 6);
    for (const yaw of [0, Math.PI / 3, -2.1]) {
      const viaKeyboard = cameraRelativeMovement(fromKeyboard.intent, yaw);
      const viaJoystick = cameraRelativeMovement(fromJoystick.intent, yaw);
      expect(viaKeyboard.x).toBeCloseTo(viaJoystick.x, 9);
      expect(viaKeyboard.z).toBeCloseTo(viaJoystick.z, 9);
      // And the same vector through the same controller lands in the same place.
      const steppedFromKeyboard = stepPlayer(state(0, 0), viaKeyboard, 0.05, FLAT);
      const steppedFromJoystick = stepPlayer(state(0, 0), viaJoystick, 0.05, FLAT);
      expect(steppedFromKeyboard.x).toBeCloseTo(steppedFromJoystick.x, 9);
      expect(steppedFromKeyboard.z).toBeCloseTo(steppedFromJoystick.z, 9);
    }
  });

  it("reads the movement keys as forward and right", () => {
    expect(characterIntentFromInput({ x: 0, z: 1 })).toEqual({ forward: 1, right: 0 });
    expect(characterIntentFromInput({ x: 0, z: -1 })).toEqual({ forward: -1, right: 0 });
    expect(characterIntentFromInput({ x: -1, z: 0 })).toEqual({ forward: 0, right: -1 });
    expect(characterIntentFromInput({ x: 1, z: 0 })).toEqual({ forward: 0, right: 1 });
    // W+S is exactly zero, because the keyboard module sums the held directions.
    expect(characterIntentFromInput({ x: 0, z: 0 })).toEqual(NO_CHARACTER_INTENT);
    // A source that reports nonsense does not move the character.
    expect(characterIntentFromInput({ x: Number.NaN, z: 1 })).toEqual(NO_CHARACTER_INTENT);
  });

  it("never walks faster than one unit of intent", () => {
    const rim = cameraRelativeMovement({ forward: 4, right: -3 }, 0);
    expect(Math.hypot(rim.x, rim.z)).toBeCloseTo(1, 9);
    // A half-pushed stick is a direction here: the controller normalizes at the point of use, so
    // magnitude becomes a meaning in a later pass rather than a surprise today.
    const half = cameraRelativeMovement({ forward: 0.5, right: 0 }, 0);
    expect(Math.hypot(half.x, half.z)).toBeCloseTo(0.5, 9);
  });
});

describe("movement relative to the camera", () => {
  it("walks away from the camera whatever way the camera faces", () => {
    // The eye sits at `target + (sin yaw, cos yaw)`, so at yaw 0 the camera is south of the player and
    // forward is north (-z).
    const north = cameraRelativeMovement({ forward: 1, right: 0 }, 0);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.z).toBeCloseTo(-1, 9);
    // Turned a quarter turn, the same key walks west.
    const west = cameraRelativeMovement({ forward: 1, right: 0 }, Math.PI / 2);
    expect(west.x).toBeCloseTo(-1, 9);
    expect(west.z).toBeCloseTo(0, 9);
    // Turned right around, W walks back towards where they came from.
    const south = cameraRelativeMovement({ forward: 1, right: 0 }, Math.PI);
    expect(south.x).toBeCloseTo(0, 9);
    expect(south.z).toBeCloseTo(1, 9);
  });

  it("keeps right at right angles to forward", () => {
    for (const yaw of [0, 0.4, Math.PI / 2, 2.2, Math.PI, -1.1]) {
      const forward = cameraRelativeMovement({ forward: 1, right: 0 }, yaw);
      const right = cameraRelativeMovement({ forward: 0, right: 1 }, yaw);
      // Perpendicular: the dot product is zero and both are unit length, which is what makes strafing
      // feel square rather than skewed.
      expect(forward.x * right.x + forward.z * right.z, `yaw ${String(yaw)}`).toBeCloseTo(0, 9);
      expect(Math.hypot(forward.x, forward.z), `yaw ${String(yaw)}`).toBeCloseTo(1, 9);
    }
  });

  it("does not move faster on the diagonal", () => {
    const diagonal = cameraRelativeMovement({ forward: 1, right: 1 }, 0.7);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1, 9);
    const forwardOnly = cameraRelativeMovement({ forward: 1, right: 0 }, 0.7);
    expect(Math.hypot(forwardOnly.x, forwardOnly.z)).toBeCloseTo(1, 9);
  });

  it("stands still for no intent", () => {
    const still = cameraRelativeMovement(NO_CHARACTER_INTENT, 1.3);
    expect(still).toEqual({ x: 0, z: 0 });
    // And a camera that has no bearing yet cannot move anybody.
    expect(cameraRelativeMovement({ forward: 1, right: 1 }, Number.NaN)).toEqual({ x: 0, z: 0 });
  });
});

describe("walking the world", () => {
  it("faces the way it is walking", () => {
    // A character turns towards their heading rather than snapping to it, so the walk is several
    // frames long: east is a quarter turn from the north they start facing.
    let walked = state();
    for (let frame = 0; frame < 10; frame += 1) walked = stepPlayer(walked, { x: 1, z: 0 }, 0.05, FLAT);
    expect(walked.x).toBeGreaterThan(0);
    // The avatar's own convention: yaw is `atan2(x, z)`, so walking east faces east.
    expect(walked.facingYaw).toBeCloseTo(Math.PI / 2, 6);
    expect(walked.movementState).toBe("WALKING");
  });

  it("travels the same distance whatever the frame rate", () => {
    const input: InputVector = { x: 0, z: -1 };
    const at30 = walkFor(1 / 30, 30, input);
    const at120 = walkFor(1 / 120, 120, input);
    expect(at30.z).toBeCloseTo(-PLAYER_SPEED, 5);
    expect(at120.z).toBeCloseTo(-PLAYER_SPEED, 5);
  });

  it("keeps a run honest about its pace", () => {
    const walk = stepPlayer(state(), { x: 0, z: -1 }, 0.05, FLAT);
    const run = stepPlayer(state(), { x: 0, z: -1 }, 0.05, FLAT, PLAYER_SPEED * RUN_SPEED_MULTIPLIER);
    expect(Math.abs(run.z)).toBeCloseTo(Math.abs(walk.z) * RUN_SPEED_MULTIPLIER, 6);
    expect(RUN_SPEED_MULTIPLIER).toBeGreaterThan(1.4);
    expect(RUN_SPEED_MULTIPLIER).toBeLessThan(1.9);
  });

  it("slides along a wall instead of sticking to it", () => {
    const world = wallWorld();
    // Head-on: the character stops at the circle rather than walking through it.
    let headOn = state(0, 0);
    for (let frame = 0; frame < 30; frame += 1) headOn = stepPlayer(headOn, { x: 0, z: 1 }, 0.05, world);
    expect(headOn.z).toBeLessThan(0.4);
    expect(headOn.x).toBeCloseTo(0, 6);
    // The same wall walked into at an angle: the northward part is refused and the eastward part
    // still happens, so the character goes *along* the wall rather than sticking to it.
    let slid = state(0, 0);
    for (let frame = 0; frame < 30; frame += 1) slid = stepPlayer(slid, { x: 0.707, z: 0.707 }, 0.05, world);
    expect(slid.x).toBeGreaterThan(1);
  });
});

describe("the ground the character walks on", () => {
  it("refuses a cliff and allows a hill", () => {
    // A two-metre face at z = -1, and ordinary ground everywhere else.
    const cliff: TerrainFollow = {
      heightAt: (_x, z) => (z < -1 ? 2 : 0),
      maxSlope: PLAYER_MAX_SLOPE,
      maxStepWorld: PLAYER_MAX_STEP_WORLD
    };
    // A short step over the face is refused: the rise is far steeper than the rule allows. The same
    // step on flat ground is not, and neither is a small rise - a kerb or a lip in the ground.
    expect(slopeBlocks(cliff, 0, 0, 0, -1.1)).toBe(true);
    expect(slopeBlocks(cliff, 0, 0, 0, -0.5)).toBe(false);
    expect(slopeBlocks({ ...cliff, heightAt: (_x, z) => (z < -0.5 ? 0.2 : 0) }, 0, 0, 0, -3)).toBe(false);
    // Walking *down* the face is never refused: refusing it would strand anyone who walked out onto
    // a ridge.
    expect(slopeBlocks(cliff, 0, -1.1, 0, 0)).toBe(false);

    // And the controller honours the world's veto, refusing the step rather than walking through it.
    const vetoed: CollisionWorld = { depth: () => 0, blocked: () => true };
    const refused = stepPlayer(state(), { x: 0, z: -1 }, 0.05, vetoed);
    expect(Math.abs(refused.z)).toBeLessThan(0.001);
  });

  it("stands on the terrain rather than the flat plane", () => {
    // The runtime is the thing that owns this: it puts the character's feet on whatever surface is
    // under them, so a walk up a hill climbs and a walk down it descends.
    const harness = createHarness();
    harness.runtime.start();
    harness.runtime.setTerrain({
      heightAt: (x) => x * 0.5,
      maxSlope: PLAYER_MAX_SLOPE,
      maxStepWorld: PLAYER_MAX_STEP_WORLD
    });
    expect(harness.last()?.y).toBeCloseTo(0.02, 6);
    harness.setInput({ x: 1, z: 0 });
    harness.tick(1000);
    harness.tick(1050);
    const walked = harness.last();
    expect(walked?.x ?? 0).toBeGreaterThan(0);
    // Half the height of the metres walked, plus the feet offset: on the hill, not hovering over it.
    expect(walked?.y ?? 0).toBeCloseTo((walked?.x ?? 0) * 0.5 + 0.02, 6);
  });

  it("is blocked by the island's own objects, not by its flowers", () => {
    const obstacle: WorldObstacle = { id: "construct_tree", centerWorldX: 0, centerWorldZ: -2, radiusWorld: 0.5 };
    const world = createPlayerCollisionWorld([], [obstacle]);
    expect(world.depth(0, -2)).toBeGreaterThan(0);
    // The far side of the island is still open ground.
    expect(world.depth(6, 6)).toBeLessThanOrEqual(0);
  });

  it("walks around an object that is standing, and through the ground it left", () => {
    // The brief's integration test for the whole V13.3/V13.3.1 line: a tree the player moved, stored
    // or removed is a *row*, and the collision circles come from the rows - so the character is
    // stopped by what stands there now, not by what stood there when the page loaded.
    const harness = createHarness();
    harness.runtime.start();
    harness.runtime.setObstacles([
      { id: "construct_tree", centerWorldX: 0, centerWorldZ: -1.5, radiusWorld: 0.5 }
    ]);
    harness.setInput({ x: 0, z: -1 });
    harness.advance(60);
    const stopped = harness.last();
    expect(stopped?.z ?? 0).toBeGreaterThan(-1.5);

    // The object is stored: the same walk now crosses the ground it used to hold.
    harness.runtime.setObstacles([]);
    harness.advance(60);
    const through = harness.last();
    expect(through?.z ?? 0).toBeLessThan(-1.5);
  });
});

function walkFor(deltaSeconds: number, frames: number, input: InputVector): PlayerState {
  let walked = state();
  for (let frame = 0; frame < frames; frame += 1) walked = stepPlayer(walked, input, deltaSeconds, FLAT);
  return walked;
}

/** The runtime with a frame source the test drives by hand, standing in for `requestAnimationFrame`. */
function createHarness() {
  const poses: (PlayerState | null)[] = [];
  const pending: ((timestampMs: number) => void)[] = [];
  let input: InputVector = { x: 0, z: 0 };
  let clock = 1000;
  const runtime = createPlayerRuntime({
    spawn: { worldX: 0, worldZ: 0 },
    feetY: 0.02,
    readInput: () => input,
    onPose: (pose) => poses.push(pose),
    requestFrame: (tick) => pending.push(tick),
    cancelFrame: () => {
      pending.length = 0;
    }
  });
  return {
    runtime,
    setInput(next: InputVector): void {
      input = next;
      // A held key is what wakes the loop: the runtime sleeps when nothing is moving.
      runtime.wake();
    },
    tick(timestampMs: number): void {
      const tick = pending.shift();
      tick?.(timestampMs);
    },
    /** Runs `frames` frames of 16 ms each, the way a browser would. */
    advance(frames: number): void {
      for (let frame = 0; frame < frames; frame += 1) {
        clock += 16;
        const tick = pending.shift();
        tick?.(clock);
      }
    },
    last(): PlayerState | null {
      return poses[poses.length - 1] ?? null;
    }
  };
}

