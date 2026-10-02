import { describe, expect, it } from "vitest";
import {
  MAX_SMOOTHING_FRAME_MS,
  MAX_DISTANCE,
  MIN_DISTANCE,
  createOrbitCamera,
  smoothingFactor,
  type OrbitCameraRig
} from "../../apps/web/src/render/camera";

/**
 * The estate camera actually following the player.
 *
 * `estate-follow.test.ts` holds the decision; these hold the motion. The brief's requirements for it
 * are all measurable on the rig: it tracks the player, it does not depend on the frame rate, it keeps
 * the angle and the zoom the player chose, a pan stops it, and a recentre brings it back smoothly.
 * The rig is pure numbers, so all of this runs without a canvas.
 */

function rig(): OrbitCameraRig {
  return createOrbitCamera({
    yaw: 0.5,
    pitch: 0.8,
    distance: 40,
    targetX: 0,
    targetZ: 0,
    panLimit: 140,
    minDistance: MIN_DISTANCE,
    maxDistance: MAX_DISTANCE
  });
}

/** One second of frames at 60 fps. */
function run(camera: OrbitCameraRig, frames = 60, deltaMs = 1_000 / 60): void {
  for (let index = 0; index < frames; index += 1) camera.update(deltaMs);
}

describe("smoothing factor", () => {
  it("is the exponential form, so halves of a frame are the same as the whole one", () => {
    expect(smoothingFactor(16, 6)).toBeCloseTo(1 - Math.exp(-6 * 0.016), 9);
    const whole = smoothingFactor(32, 6);
    const halves = 1 - (1 - smoothingFactor(16, 6)) * (1 - smoothingFactor(16, 6));
    expect(halves).toBeCloseTo(whole, 9);
  });

  it("believes no more than a quarter second of any one frame", () => {
    // A restored tab hands in an enormous delta; a glide that trusted it would jump the whole way.
    expect(smoothingFactor(60_000, 6)).toBe(smoothingFactor(MAX_SMOOTHING_FRAME_MS, 6));
    expect(smoothingFactor(MAX_SMOOTHING_FRAME_MS, 6)).toBeLessThan(1);
  });

  it("ignores a nonsense delta or rate", () => {
    expect(smoothingFactor(Number.NaN, 6)).toBe(0);
    expect(smoothingFactor(-4, 6)).toBe(0);
    expect(smoothingFactor(16, 0)).toBe(0);
    expect(smoothingFactor(16, Number.NaN)).toBe(0);
  });
});

describe("the estate camera following the player", () => {
  it("tracks the player's ground position and settles on it", () => {
    const camera = rig();
    camera.followTo(30, -12);
    run(camera);
    expect(camera.state.targetX).toBeCloseTo(30, 2);
    expect(camera.state.targetZ).toBeCloseTo(-12, 2);
    // Arrived means arrived: the camera stops asking for frames rather than chasing a fixed point.
    expect(camera.isSettling()).toBe(false);
  });

  it("is delta-time independent: many small steps and few large ones agree", () => {
    const fine = rig();
    const coarse = rig();
    fine.followTo(50, 25);
    coarse.followTo(50, 25);
    run(fine, 60, 16);
    run(coarse, 6, 160);
    expect(coarse.state.targetX).toBeCloseTo(fine.state.targetX, 4);
    expect(coarse.state.targetZ).toBeCloseTo(fine.state.targetZ, 4);
  });

  it("keeps the camera's bearing, pitch and zoom while it follows", () => {
    const camera = rig();
    const bearing = camera.state.yaw;
    const pitch = camera.state.pitch;
    camera.zoomByScale(0.5);
    const wanted = camera.requestedDistance;
    camera.followTo(40, 40);
    run(camera);
    // Following moves the *target*, and nothing else: the estate view keeps the player's own angle.
    expect(camera.state.yaw).toBe(bearing);
    expect(camera.state.pitch).toBe(pitch);
    expect(camera.requestedDistance).toBeCloseTo(wanted, 9);
    expect(camera.state.distance).toBeCloseTo(wanted, 2);
  });

  it("does not fight a hand-placed camera: a pan cancels the glide and it stays put", () => {
    const camera = rig();
    camera.followTo(40, 0);
    camera.update(16);
    camera.panByScreen(-40, 0, 900);
    const placedX = camera.state.targetX;
    const placedZ = camera.state.targetZ;
    // Frames pass with no new follow - which is what "the player took the camera" means.
    run(camera, 120);
    expect(camera.state.targetX).toBeCloseTo(placedX, 6);
    expect(camera.state.targetZ).toBeCloseTo(placedZ, 6);
    expect(camera.isSettling()).toBe(false);
  });

  it("recentres on a glide and arrives exactly", () => {
    const camera = rig();
    camera.panByScreen(-120, 0, 900);
    const away = camera.state.targetX;
    camera.recenterTo(0, 0);
    camera.update(16);
    // It moved toward the player in one frame, and it did not teleport there.
    expect(Math.abs(camera.state.targetX)).toBeLessThan(Math.abs(away));
    expect(camera.state.targetX).not.toBe(0);
    run(camera, 180);
    expect(camera.state.targetX).toBeCloseTo(0, 3);
    expect(camera.state.targetZ).toBeCloseTo(0, 3);
    expect(camera.isSettling()).toBe(false);
  });

  it("is not kept awake by a follow aimed at where the camera already is", () => {
    // A following camera whose player is standing still must be free, or the renderer would run a
    // frame loop for the whole session - the performance rule this pass has to keep.
    const camera = rig();
    camera.followTo(0, 0);
    expect(camera.isSettling()).toBe(false);
    run(camera, 3);
    expect(camera.isSettling()).toBe(false);
  });

  it("keeps the follow target inside the island's own pan limit", () => {
    const camera = rig();
    camera.followTo(10_000, -10_000);
    run(camera, 600);
    expect(camera.state.targetX).toBeLessThanOrEqual(140);
    expect(camera.state.targetZ).toBeGreaterThanOrEqual(-140);
  });

  it("ignores a follow target that is not a place", () => {
    const camera = rig();
    const before = camera.state;
    camera.followTo(Number.NaN, 4);
    camera.followTo(4, Number.POSITIVE_INFINITY);
    camera.update(16);
    expect(camera.state.targetX).toBe(before.targetX);
    expect(camera.state.targetZ).toBe(before.targetZ);
    expect(camera.isSettling()).toBe(false);
  });
});
