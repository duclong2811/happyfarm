import { describe, expect, it } from "vitest";
import {
  createCameraRig,
  PAN_LIMIT_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN
} from "../../apps/web/src/render/camera";

/** A world the size of the shipped island, centred where its camera frames it. */
const WORLD = {
  centerWorldX: 6.48,
  centerWorldZ: 6.48,
  worldExtent: 23.76
} as const;

const LIMIT = WORLD.worldExtent * PAN_LIMIT_FACTOR;

function view(playerWorldX: number | null, playerWorldZ: number | null) {
  return { playerWorldX, playerWorldZ, ...WORLD };
}

describe("farming camera", () => {
  it("follows the character while the player has not dragged anything", () => {
    const rig = createCameraRig();
    expect(rig.panOffsetX).toBe(0);
    expect(rig.panOffsetZ).toBe(0);
    expect(rig.target(view(6.48, 10))).toEqual({ worldX: 6.48, worldZ: 10 });
  });

  it("frames the world's centre when there is no character", () => {
    const rig = createCameraRig();
    expect(rig.target(view(null, null))).toEqual({ worldX: WORLD.centerWorldX, worldZ: WORLD.centerWorldZ });
  });

  it("pans when the player drags, and keeps the camera following the character from there", () => {
    const rig = createCameraRig();
    const before = rig.target(view(6.48, 10));
    // Dragging right and down pulls the world with the pointer, so the target moves the other way.
    rig.panByPixels(100, 50, 0.1);
    expect(rig.panOffsetX).toBeCloseTo(-10, 9);
    expect(rig.panOffsetZ).toBeCloseTo(-5, 9);
    const after = rig.target(view(6.48, 10));
    expect(after.worldX).toBeCloseTo(before.worldX - 10, 9);
    expect(after.worldZ).toBeCloseTo(before.worldZ - 5, 9);

    // Walking now moves the camera by exactly the character's own delta: the manual offset is
    // preserved rather than recomputed or reset.
    const walked = rig.target(view(6.48, 12));
    expect(walked.worldX).toBeCloseTo(after.worldX, 9);
    expect(walked.worldZ).toBeCloseTo(after.worldZ + 2, 9);
    expect(rig.panOffsetZ).toBeCloseTo(-5, 9);
  });

  it("never lets the target leave the farm, however far the player drags", () => {
    const rig = createCameraRig();
    for (const [deltaX, deltaY] of [[1e4, 0], [-1e4, 0], [0, 1e4], [0, -1e4]] as const) {
      rig.panByPixels(deltaX, deltaY, 1);
    }
    const target = rig.target(view(6.48, 10));
    expect(target.worldX).toBeGreaterThanOrEqual(WORLD.centerWorldX - LIMIT);
    expect(target.worldX).toBeLessThanOrEqual(WORLD.centerWorldX + LIMIT);
    expect(target.worldZ).toBeGreaterThanOrEqual(WORLD.centerWorldZ - LIMIT);
    expect(target.worldZ).toBeLessThanOrEqual(WORLD.centerWorldZ + LIMIT);
  });

  it("keeps the character on screen at the spawn by clamping rather than by moving the camera home", () => {
    // The spawn sits south of the framed land, so the target is clamped north of it. The character
    // is then below the centre of the view - visible, and with the farm still in frame - which is
    // the framing the game opens with.
    const rig = createCameraRig();
    const target = rig.target(view(0, 23.22));
    expect(target.worldZ).toBeCloseTo(WORLD.centerWorldZ + LIMIT, 9);
    expect(target.worldZ).toBeLessThan(23.22);
  });

  it("zooms within its range without touching the pan offset or the target", () => {
    const rig = createCameraRig();
    rig.panByPixels(40, -30, 0.1);
    const target = rig.target(view(6.48, 10));
    const offset = { x: rig.panOffsetX, z: rig.panOffsetZ };
    for (const deltaY of [-500, -200, 100, 900]) rig.zoomByWheel(deltaY);
    expect(rig.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(rig.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    expect(rig.panOffsetX).toBe(offset.x);
    expect(rig.panOffsetZ).toBe(offset.z);
    expect(rig.target(view(6.48, 10))).toEqual(target);
  });

  it("does not rebuild the pan when the farm refreshes", () => {
    // A refresh hands the rig a new view - the same character, new land - and asks where to look.
    // Asking must not be the same as resetting.
    const rig = createCameraRig();
    rig.panByPixels(-120, 60, 0.05);
    const offset = { x: rig.panOffsetX, z: rig.panOffsetZ };
    const first = rig.target(view(4, 8));
    for (let refresh = 0; refresh < 5; refresh += 1) {
      expect(rig.target(view(4, 8))).toEqual(first);
    }
    expect(rig.panOffsetX).toBe(offset.x);
    expect(rig.panOffsetZ).toBe(offset.z);
  });

  it("reads the character but never writes to it", () => {
    // The rig cannot move the player: it is handed positions, and its own state is the offset and
    // the zoom. A frozen view proves it writes nothing back.
    const rig = createCameraRig();
    const frozen = Object.freeze(view(1, 2));
    rig.panByPixels(10, 10, 0.1);
    expect(() => rig.target(frozen)).not.toThrow();
    expect(rig.target(frozen)).toEqual({ worldX: 1 - 1, worldZ: 2 - 1 });
  });
});
