import { describe, expect, it } from "vitest";
import {
  CHARACTER_FOV_DEGREES,
  CHARACTER_GROUND_CLEARANCE,
  CHARACTER_TARGET_HEIGHT_FRACTION,
  DEFAULT_CHARACTER_DISTANCE,
  MAX_CHARACTER_DISTANCE,
  MAX_CHARACTER_PITCH,
  MIN_CHARACTER_DISTANCE,
  MIN_CHARACTER_PITCH,
  characterEye,
  characterTarget,
  clampCharacterDistance,
  clampCharacterPitch,
  createCharacterCameraRig
} from "../../apps/web/src/render/character-camera";
import { orbitEye } from "../../apps/web/src/render/camera";

/**
 * The camera behind the character.
 *
 * Deliberately the estate camera's maths aimed at a person: the same yaw/pitch/distance vocabulary,
 * a target just above the shoulders, and two world questions - how high the ground is under the eye,
 * and what building is between. Every rule the player would notice (aim, orbit, clamps, the camera
 * never inside a hill, the camera coming in when a barn is in the way) is here rather than in a
 * browser session.
 */

const FLAT = () => 0;
const CLEAR = () => false;
const PLAYER = { worldX: 10, worldY: 0.02, worldZ: -4 };
const HEIGHT = 1.6;

function rig(overrides: Partial<Parameters<typeof createCharacterCameraRig>[0]> = {}) {
  return createCharacterCameraRig({ yaw: 0, ...overrides });
}

describe("what the camera looks at", () => {
  it("aims at the shoulders, not the feet", () => {
    const target = characterTarget(PLAYER, HEIGHT);
    expect(target.x).toBe(PLAYER.worldX);
    expect(target.z).toBe(PLAYER.worldZ);
    expect(target.y).toBeCloseTo(PLAYER.worldY + HEIGHT * CHARACTER_TARGET_HEIGHT_FRACTION, 9);
    // Above the middle of the character: a camera aimed at the ground under them looks down the back
    // of their head.
    expect(target.y).toBeGreaterThan(PLAYER.worldY + HEIGHT * 0.5);
  });

  it("follows the character everywhere", () => {
    const elsewhere = { worldX: -30, worldY: 3, worldZ: 44 };
    const target = characterTarget(elsewhere, HEIGHT);
    expect(target.x).toBe(elsewhere.worldX);
    expect(target.z).toBe(elsewhere.worldZ);
    // A model with no height still gets a sensible aim rather than one at the ankles.
    expect(characterTarget(PLAYER, 0).y).toBeCloseTo(PLAYER.worldY + HEIGHT * CHARACTER_TARGET_HEIGHT_FRACTION, 9);
  });
});

describe("orbiting the character", () => {
  it("turns the eye around the character on the estate camera's own convention", () => {
    const camera = rig({ yaw: 0, pitch: 0, distance: 5 });
    const target = characterTarget(PLAYER, HEIGHT);
    const eye = camera.eye(target, FLAT, CLEAR);
    // yaw 0 puts the camera south of the character, looking north - the estate rig's convention.
    expect(eye.x).toBeCloseTo(target.x, 6);
    expect(eye.z).toBeCloseTo(target.z + 5, 6);
    camera.rotate(Math.PI / 2, 0);
    const turned = camera.eye(target, FLAT, CLEAR);
    expect(turned.x).toBeCloseTo(target.x + 5, 6);
    expect(turned.z).toBeCloseTo(target.z, 6);
  });

  it("clamps the pitch so the camera cannot flip or go underfoot", () => {
    expect(clampCharacterPitch(-99)).toBe(MIN_CHARACTER_PITCH);
    expect(clampCharacterPitch(99)).toBe(MAX_CHARACTER_PITCH);
    expect(clampCharacterPitch(Number.NaN)).toBeCloseTo(0.2, 9);
    const camera = rig();
    camera.rotate(0, -10);
    expect(camera.state.pitch).toBe(MIN_CHARACTER_PITCH);
    camera.rotate(0, 10);
    expect(camera.state.pitch).toBe(MAX_CHARACTER_PITCH);
    // The range itself: a little below the shoulder to look up, never past vertical.
    expect(MIN_CHARACTER_PITCH).toBeLessThan(0);
    expect(MAX_CHARACTER_PITCH).toBeLessThan(Math.PI / 2);
  });

  it("clamps the zoom, and never lets it come through the character", () => {
    expect(clampCharacterDistance(-5)).toBe(MIN_CHARACTER_DISTANCE);
    expect(clampCharacterDistance(500)).toBe(MAX_CHARACTER_DISTANCE);
    const camera = rig();
    camera.zoomByScale(100);
    expect(camera.requestedDistance).toBe(MAX_CHARACTER_DISTANCE);
    camera.zoomByScale(0.0001);
    expect(camera.requestedDistance).toBe(MIN_CHARACTER_DISTANCE);
    // The near end is outside the character's own body, so the camera never ends up inside them.
    expect(MIN_CHARACTER_DISTANCE).toBeGreaterThan(1);
  });

  it("glides toward the requested distance rather than snapping", () => {
    const camera = rig({ distance: DEFAULT_CHARACTER_DISTANCE });
    camera.zoomByScale(2);
    expect(camera.state.distance).toBeCloseTo(DEFAULT_CHARACTER_DISTANCE, 6);
    expect(camera.isSettling()).toBe(true);
    camera.update(100);
    expect(camera.state.distance).toBeGreaterThan(DEFAULT_CHARACTER_DISTANCE);
    expect(camera.state.distance).toBeLessThan(camera.requestedDistance);
    for (let frame = 0; frame < 120; frame += 1) camera.update(16);
    expect(camera.state.distance).toBeCloseTo(camera.requestedDistance, 3);
    expect(camera.isSettling()).toBe(false);
  });
});

describe("what the camera must not sit inside", () => {
  it("stays above the ground when the character is in a hollow", () => {
    // A dip right where the camera would sit: without the clamp the eye would be underground.
    const hollow = (worldX: number, worldZ: number) =>
      worldZ > PLAYER.worldZ + 1 ? -6 : 0;
    const camera = rig({ yaw: 0, pitch: 0, distance: 5 });
    const target = characterTarget(PLAYER, HEIGHT);
    const eye = camera.eye(target, hollow, CLEAR);
    expect(eye.y).toBeGreaterThanOrEqual(hollow(eye.x, eye.z) + CHARACTER_GROUND_CLEARANCE - 0.001);
  });

  it("stays above a hill that rises across the camera's path", () => {
    // The ground climbs behind the character: the first sample that would be under it stops the
    // camera short, so the camera comes in rather than burying itself.
    const hill = (worldX: number, worldZ: number) => (worldZ > PLAYER.worldZ + 2 ? 8 : 0);
    const camera = rig({ yaw: 0, pitch: 0.1, distance: 6 });
    const target = characterTarget(PLAYER, HEIGHT);
    const eye = camera.eye(target, hill, CLEAR);
    expect(eye.z).toBeLessThan(PLAYER.worldZ + 6);
    expect(eye.y).toBeGreaterThanOrEqual(hill(eye.x, eye.z) + CHARACTER_GROUND_CLEARANCE - 0.001);
  });

  it("comes in when a building is in the way, and goes back out when it is gone", () => {
    const camera = rig({ yaw: 0, pitch: 0.15, distance: 6 });
    const target = characterTarget(PLAYER, HEIGHT);
    const clear = camera.eye(target, FLAT, CLEAR);
    // A barn between the character and the camera: the eye is pulled in to the near side of it.
    const barn = (worldX: number, worldZ: number) =>
      Math.hypot(worldX - PLAYER.worldX, worldZ - (PLAYER.worldZ + 2.5)) < 1.2;
    const obstructed = camera.eye(target, FLAT, barn);
    expect(Math.hypot(obstructed.x - target.x, obstructed.z - target.z)).toBeLessThan(
      Math.hypot(clear.x - target.x, clear.z - target.z)
    );
    // Nothing between them any more: the camera returns to the distance it was asked for, because the
    // obstruction shortens the *eye*, never the rig's own setting.
    expect(camera.requestedDistance).toBeCloseTo(6, 9);
    const restored = camera.eye(target, FLAT, CLEAR);
    expect(restored.z).toBeCloseTo(clear.z, 6);
  });

  it("keeps the eye on the orbit the rig describes", () => {
    const camera = rig({ yaw: 0.8, pitch: 0.3, distance: 4 });
    const target = characterTarget(PLAYER, HEIGHT);
    const eye = camera.eye(target, FLAT, CLEAR);
    const expected = orbitEye(camera.state, target, camera.state.distance);
    expect(eye.x).toBeCloseTo(expected.x, 6);
    expect(eye.z).toBeCloseTo(expected.z, 6);
    expect(CHARACTER_FOV_DEGREES).toBeGreaterThan(45);
    expect(CHARACTER_FOV_DEGREES).toBeLessThan(70);
  });
});

describe("starting the character view", () => {
  it("takes the estate camera's bearing, so the switch is a descent rather than a spin", () => {
    const camera = rig({ yaw: 0.4 });
    camera.reset({ yaw: Math.PI / 3 });
    expect(camera.state.yaw).toBeCloseTo(Math.PI / 3, 9);
    // And a reset puts it back at shoulder scale, not wherever a previous session left it.
    expect(camera.state.distance).toBeCloseTo(DEFAULT_CHARACTER_DISTANCE, 9);
    camera.reset({ yaw: 0, pitch: 99, distance: 99 });
    expect(camera.state.pitch).toBe(MAX_CHARACTER_PITCH);
    expect(camera.state.distance).toBe(MAX_CHARACTER_DISTANCE);
  });

  it("is created once and re-aimed, so switching modes cannot leak cameras", () => {
    // The scene owns one rig and one rig only; the stress test in the brief is 20 switches, and this
    // is the property that makes it free. `reset` returns nothing and allocates nothing.
    const camera = rig();
    for (let index = 0; index < 20; index += 1) {
      camera.reset({ yaw: index });
      expect(camera.state.yaw).toBeCloseTo(index, 9);
    }
    expect(camera.state.distance).toBeCloseTo(DEFAULT_CHARACTER_DISTANCE, 9);
  });
});

describe("the eye helper", () => {
  it("is a pure function of the state, the target and the world", () => {
    const state = { yaw: 0.5, pitch: 0.2, distance: 4 };
    const target = characterTarget(PLAYER, HEIGHT);
    const first = characterEye(state, target, state.distance, FLAT, CLEAR);
    const second = characterEye(state, target, state.distance, FLAT, CLEAR);
    expect(first).toEqual(second);
    // A shorter requested distance is a shorter eye, all else equal.
    const near = characterEye(state, target, 2.5, FLAT, CLEAR);
    const far = characterEye(state, target, 8, FLAT, CLEAR);
    expect(Math.hypot(near.x - target.x, near.z - target.z)).toBeLessThan(
      Math.hypot(far.x - target.x, far.z - target.z)
    );
  });
});
