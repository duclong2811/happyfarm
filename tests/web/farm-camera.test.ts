import { describe, expect, it } from "vitest";
import {
  CAMERA_GROUND_CLEARANCE,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  MIN_PITCH,
  SEA_SURFACE_Y,
  clampPitch,
  createOrbitCamera,
  orbitEye,
  panOffsetFor,
  pointerRoleForButton,
  rotationForDrag,
  worldPerPixelAt,
  wrapYaw,
  zoomDistanceRangeFor
} from "../../apps/web/src/render/camera";

/** A world the size of the shipped island, framed where its camera opens. */
const WORLD = { centerWorldX: 14.58, centerWorldZ: 14.58, islandExtent: 58.9 } as const;

function rig(overrides: Partial<Parameters<typeof createOrbitCamera>[0]> = {}) {
  return createOrbitCamera({
    yaw: Math.PI / 4,
    pitch: (47 * Math.PI) / 180,
    distance: 52,
    targetX: 0,
    targetZ: 0,
    panLimit: 140,
    minDistance: MIN_DISTANCE,
    maxDistance: MAX_DISTANCE,
    ...overrides
  });
}

/** Flat ground, and nothing standing on it. */
const FLAT = () => 0;
const CLEAR = () => false;

describe("the orbit camera rig", () => {
  it("wraps yaw into one turn and survives nonsense", () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 9);
    expect(wrapYaw(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 9);
    expect(wrapYaw(Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(Math.abs(wrapYaw(1e6))).toBeLessThanOrEqual(Math.PI);
    expect(wrapYaw(Number.NaN)).toBe(0);
    expect(wrapYaw(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("keeps pitch between looking along the ground and looking nearly straight down", () => {
    expect(clampPitch(0)).toBe(MIN_PITCH);
    expect(clampPitch(Math.PI)).toBe(MAX_PITCH);
    expect(clampPitch((45 * Math.PI) / 180)).toBeCloseTo(0.7854, 3);
    expect(clampPitch(Number.NaN)).toBe(MIN_PITCH);
    expect(MIN_PITCH).toBeGreaterThan(0);
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2);
  });

  it("turns a pointer drag into a yaw and a pitch, never the other way round", () => {
    const right = rotationForDrag(100, 0);
    expect(right.yaw).toBeLessThan(0);
    expect(right.pitch).toBe(0);
    const down = rotationForDrag(0, 100);
    expect(down.yaw).toBeCloseTo(0, 12);
    expect(down.pitch).toBeGreaterThan(0);
    // Nonsense deltas are ignored rather than poisoning the state.
    expect(rotationForDrag(Number.NaN, 20)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("cannot be pitched over the top however long the drag is", () => {
    const camera = rig();
    for (let step = 0; step < 200; step += 1) {
      camera.rotate(0, 0.3);
    }
    expect(camera.state.pitch).toBeCloseTo(MAX_PITCH, 9);
    for (let step = 0; step < 400; step += 1) {
      camera.rotate(0, -0.3);
    }
    expect(camera.state.pitch).toBeCloseTo(MIN_PITCH, 9);
    // A full spin leaves the yaw inside one turn rather than growing without bound.
    for (let step = 0; step < 50; step += 1) camera.rotate(1, 0);
    expect(Math.abs(camera.state.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it("zooms smoothly toward what the wheel asked for and clamps at both ends", () => {
    const camera = rig();
    camera.zoomByWheel(-600);
    // The request moved immediately; the distance only glides toward it, one frame at a time.
    expect(camera.requestedDistance).toBeLessThan(52);
    expect(camera.isSettling()).toBe(true);
    camera.update(16);
    expect(camera.state.distance).toBeGreaterThan(camera.requestedDistance);
    for (let frame = 0; frame < 240; frame += 1) camera.update(16);
    expect(camera.isSettling()).toBe(false);
    expect(camera.state.distance).toBeCloseTo(camera.requestedDistance, 6);

    for (let step = 0; step < 80; step += 1) camera.zoomByWheel(-500);
    for (let frame = 0; frame < 240; frame += 1) camera.update(16);
    expect(camera.state.distance).toBeCloseTo(MIN_DISTANCE, 4);
    for (let step = 0; step < 120; step += 1) camera.zoomByWheel(500);
    for (let frame = 0; frame < 400; frame += 1) camera.update(16);
    expect(camera.state.distance).toBeCloseTo(MAX_DISTANCE, 4);
  });

  it("derives its zoom range from the island rather than from a constant", () => {
    const shipped = zoomDistanceRangeFor(WORLD.islandExtent);
    expect(shipped.min).toBe(MIN_DISTANCE);
    expect(shipped.max).toBe(MAX_DISTANCE);
    // A small island never zooms out further than it has to...
    expect(zoomDistanceRangeFor(4).max).toBeLessThan(MAX_DISTANCE);
    // ...and nonsense falls back to the floor rather than to infinity.
    expect(zoomDistanceRangeFor(Number.NaN).max).toBeGreaterThanOrEqual(MIN_DISTANCE * 2);

    const camera = rig();
    const small = zoomDistanceRangeFor(9);
    camera.setDistanceRange(small.min, small.max);
    expect(camera.distanceRange).toEqual(small);
    // Shrinking the range can never strand the camera outside it.
    expect(camera.state.distance).toBeLessThanOrEqual(small.max);
  });

  it("ignores a zoom range that could not be one", () => {
    const camera = rig();
    camera.setDistanceRange(0, -1);
    camera.setDistanceRange(Number.NaN, 3);
    camera.setDistanceRange(50, 10);
    expect(camera.distanceRange).toEqual({ min: MIN_DISTANCE, max: MAX_DISTANCE });
  });

  it("pans in the camera's own frame, not in world north", () => {
    const perPixel = 0.1;
    const facingNorth = panOffsetFor(0, 100, 0, perPixel);
    // Screen-right with the camera at yaw 0 pulls the target west, exactly as it always did.
    expect(facingNorth.x).toBeCloseTo(-10, 9);
    expect(facingNorth.z).toBeCloseTo(0, 9);

    // Turn the camera a quarter turn and the same drag moves the target along the other axis: this
    // is the difference between "screen-relative" and a fixed world direction.
    const facingEast = panOffsetFor(Math.PI / 2, 100, 0, perPixel);
    expect(facingEast.x).toBeCloseTo(0, 9);
    expect(facingEast.z).toBeCloseTo(10, 9);
    expect(Math.hypot(facingEast.x, facingEast.z)).toBeCloseTo(
      Math.hypot(facingNorth.x, facingNorth.z),
      9
    );
    // Screen-up always moves the target away from the camera, whichever way it faces.
    const up = panOffsetFor(Math.PI / 2, 0, 100, perPixel);
    expect(up.x).toBeCloseTo(-10, 9);
    expect(up.z).toBeCloseTo(0, 9);
  });

  it("moves metres per pixel with the distance, so a drag moves what it looks like it moves", () => {
    const near = worldPerPixelAt(20, 900);
    const far = worldPerPixelAt(60, 900);
    expect(far).toBeCloseTo(near * 3, 9);
    expect(worldPerPixelAt(20, 0)).toBeCloseTo(worldPerPixelAt(20, 900), 9);
  });

  it("pans the target across the ground and holds it near where the world framed it", () => {
    const camera = rig();
    camera.moveTargetTo(WORLD.centerWorldX, WORLD.centerWorldZ);
    camera.panByScreen(200, 0, 900);
    expect(camera.state.targetX).toBeLessThan(WORLD.centerWorldX);

    for (const [deltaX, deltaY] of [
      [1e6, 0],
      [-1e6, 0],
      [0, 1e6],
      [0, -1e6]
    ] as const) {
      camera.panByScreen(deltaX, deltaY, 1);
    }
    expect(camera.state.targetX).toBeGreaterThanOrEqual(WORLD.centerWorldX - 140);
    expect(camera.state.targetX).toBeLessThanOrEqual(WORLD.centerWorldX + 140);
    expect(camera.state.targetZ).toBeGreaterThanOrEqual(WORLD.centerWorldZ - 140);
    expect(camera.state.targetZ).toBeLessThanOrEqual(WORLD.centerWorldZ + 140);
  });

  it("keeps where the player is looking through a world refresh", () => {
    // A refresh hands the rig the same world again: a new extent, a rebuilt static layer. Asking for
    // the state must never be the same as resetting it.
    const camera = rig();
    camera.moveTargetTo(WORLD.centerWorldX, WORLD.centerWorldZ);
    camera.rotate(0.9, 0.2);
    camera.zoomByWheel(-300);
    camera.update(16);
    camera.panByScreen(-60, 40, 800);
    const before = { ...camera.state };
    for (let refresh = 0; refresh < 5; refresh += 1) {
      camera.setDistanceRange(MIN_DISTANCE, MAX_DISTANCE);
      camera.eye(FLAT, CLEAR);
      expect(camera.state.yaw).toBeCloseTo(before.yaw, 12);
      expect(camera.state.pitch).toBeCloseTo(before.pitch, 12);
      expect(camera.state.targetX).toBeCloseTo(before.targetX, 12);
      expect(camera.state.targetZ).toBeCloseTo(before.targetZ, 12);
    }
    expect(camera.state.distance).toBeLessThanOrEqual(before.distance + 1e-9);
  });

  it("recenters on a glide rather than a cut, and stops fighting once it arrives", () => {
    const camera = rig();
    camera.moveTargetTo(WORLD.centerWorldX, WORLD.centerWorldZ);
    camera.panByScreen(600, 0, 900);
    const panned = camera.state.targetX;
    camera.recenterTo(3, 7);
    expect(camera.isSettling()).toBe(true);
    camera.update(16);
    // One frame moved it, and it is still on its way: a glide, not a teleport.
    expect(camera.state.targetX).not.toBe(panned);
    for (let frame = 0; frame < 240; frame += 1) camera.update(16);
    expect(camera.state.targetX).toBeCloseTo(3, 6);
    expect(camera.state.targetZ).toBeCloseTo(7, 6);
    expect(camera.isSettling()).toBe(false);
  });

  it("never puts its eye under the ground or under the sea", () => {
    const camera = rig({ pitch: (65 * Math.PI) / 180 });
    // A hillside rising faster than the camera climbs: the eye has to be pushed up over it.
    const hillside = (worldX: number, worldZ: number): number => worldZ * 2;
    const eye = camera.eye(hillside, CLEAR);
    expect(eye.y).toBeGreaterThanOrEqual(hillside(eye.x, eye.z) + CAMERA_GROUND_CLEARANCE - 1e-9);

    // And over open water the sea is the floor.
    const overSea = rig({ pitch: MIN_PITCH, distance: MAX_DISTANCE });
    overSea.moveTargetTo(WORLD.centerWorldX, WORLD.centerWorldZ);
    const seaEye = overSea.eye(() => Number.NEGATIVE_INFINITY, CLEAR);
    expect(seaEye.y).toBeGreaterThan(SEA_SURFACE_Y);
  });

  it("keeps the eye out of a building without hiding the island behind one", () => {
    const pitch = (47 * Math.PI) / 180;
    // A barn standing in the ray, at the point a 20-metre camera would occupy.
    const barn = (worldX: number, worldZ: number): boolean => Math.hypot(worldX, worldZ - 13.6) < 2;
    const inside = rig({ yaw: 0, pitch, distance: 20, targetX: 0, targetZ: 0 }).eye(FLAT, barn);
    const clear = rig({ yaw: 0, pitch, distance: 20, targetX: 0, targetZ: 0 }).eye(FLAT, CLEAR);
    expect(inside.z).toBeLessThan(clear.z);
    expect(barn(inside.x, inside.z)).toBe(false);
    // The same barn does not shorten a camera that sits well past it: an estate view looks across the
    // island's buildings rather than being stopped by the first one.
    const beyond = rig({ yaw: 0, pitch, distance: 60, targetX: 0, targetZ: 0 }).eye(FLAT, barn);
    expect(beyond.z).toBeCloseTo(Math.cos(pitch) * 60, 6);
    expect(beyond.z).toBeGreaterThan(20);
    expect(barn(beyond.x, beyond.z)).toBe(false);
  });

  it("places its eye on the orbit the state describes", () => {
    const eye = orbitEye({ yaw: 0, pitch: 0 }, { x: 1, y: 2, z: 3 }, 10);
    expect(eye.x).toBeCloseTo(1, 9);
    expect(eye.y).toBeCloseTo(2, 9);
    expect(eye.z).toBeCloseTo(13, 9);
    const up = orbitEye({ yaw: 0, pitch: Math.PI / 2 }, { x: 0, y: 0, z: 0 }, 10);
    expect(up.y).toBeCloseTo(10, 9);
  });
});

describe("camera pointer arbitration", () => {
  it("gives each button one job, and the left one is never the camera", () => {
    const cameraActionFor = (button: number): "rotate" | "pan" | "none" => {
      const role = pointerRoleForButton(button);
      if (role === "ROTATE") return "rotate";
      if (role === "PAN") return "pan";
      return "none";
    };
    // Left click belongs to the world: it selects a cell and never turns the view.
    expect(pointerRoleForButton(0)).toBe("SELECT");
    expect(cameraActionFor(0)).toBe("none");
    // Middle pans, right rotates, and neither of them can select.
    expect(pointerRoleForButton(1)).toBe("PAN");
    expect(pointerRoleForButton(2)).toBe("ROTATE");
    expect(cameraActionFor(1)).toBe("pan");
    expect(cameraActionFor(2)).toBe("rotate");
    expect(pointerRoleForButton(4)).toBe("IGNORE");
  });

  it("cannot both select and rotate from the same press", () => {
    // The scene acts on exactly one role per press, and the roles are disjoint: a press that turns
    // the camera is not the press that selects a cell, whatever the drag does afterwards.
    const roles = [0, 1, 2, 3].map((button) => pointerRoleForButton(button));
    expect(roles.filter((role) => role === "SELECT")).toHaveLength(1);
    expect(roles.filter((role) => role === "ROTATE")).toHaveLength(1);
    expect(roles.filter((role) => role === "PAN")).toHaveLength(1);
    const leftDragRole = pointerRoleForButton(0);
    expect(leftDragRole === "ROTATE").toBe(false);
    expect(leftDragRole === "PAN").toBe(false);
  });
});
