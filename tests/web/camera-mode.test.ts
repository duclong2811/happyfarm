import { describe, expect, it } from "vitest";
import {
  CAMERA_TRANSITION_SECONDS,
  DEFAULT_CAMERA_MODE,
  cameraModeToggleRequested,
  createCameraTransition,
  easeInOutCubic,
  interpolateCameraPose,
  otherCameraMode,
  type CameraPose
} from "../../apps/web/src/render/camera-mode";

/**
 * One island, two viewpoints.
 *
 * The mode itself is the host page's state, but the rules around it are pure: which mode a toggle
 * leads to, whether a keystroke is a mode shortcut at all, and how the camera travels between the two
 * viewpoints. These are the promises the Swift-like switch rests on - especially "the estate camera
 * is preserved", which is only true if a transition *reads* the estate rig and never writes it.
 */

const ESTATE: CameraPose = {
  eyeX: 40,
  eyeY: 36,
  eyeZ: 40,
  targetX: 0,
  targetY: 1,
  targetZ: 0,
  fov: 45
};

const CHARACTER: CameraPose = {
  eyeX: 3,
  eyeY: 2.4,
  eyeZ: 4,
  targetX: 2,
  targetY: 1.04,
  targetZ: 3,
  fov: 52
};

/** A stand-in for a focused text field: what the keyboard guard is asked about. */
function field(tagName: string, isContentEditable = false): unknown {
  return { tagName, isContentEditable };
}

/** Poses are floating-point; "the camera arrived" is closeness, not bit equality. */
function expectPoseClose(actual: CameraPose, expected: CameraPose): void {
  expect(actual.eyeX).toBeCloseTo(expected.eyeX, 9);
  expect(actual.eyeY).toBeCloseTo(expected.eyeY, 9);
  expect(actual.eyeZ).toBeCloseTo(expected.eyeZ, 9);
  expect(actual.targetX).toBeCloseTo(expected.targetX, 9);
  expect(actual.targetY).toBeCloseTo(expected.targetY, 9);
  expect(actual.targetZ).toBeCloseTo(expected.targetZ, 9);
  expect(actual.fov).toBeCloseTo(expected.fov, 9);
}

describe("the camera mode", () => {
  it("starts in the estate view, and toggles between the two", () => {
    expect(DEFAULT_CAMERA_MODE).toBe("ESTATE");
    expect(otherCameraMode("ESTATE")).toBe("CHARACTER");
    expect(otherCameraMode("CHARACTER")).toBe("ESTATE");
    // Toggling twice is the mode you started in.
    expect(otherCameraMode(otherCameraMode("CHARACTER"))).toBe("CHARACTER");
  });

  it("takes F as the shortcut, and ignores it while somebody is typing", () => {
    const body = field("DIV");
    expect(cameraModeToggleRequested({ key: "f", target: body })).toBe(true);
    expect(cameraModeToggleRequested({ key: "F", target: body })).toBe(true);
    // Not a mode shortcut: every other key, including the ones the camera uses for other things.
    for (const key of ["e", "q", "w", "Escape", "Enter", " "]) {
      expect(cameraModeToggleRequested({ key, target: body }), key).toBe(false);
    }
    // A farm name, a search box, a language select: the field owns the keyboard, not the game.
    for (const target of [field("INPUT"), field("TEXTAREA"), field("SELECT"), field("BUTTON"), field("DIV", true)]) {
      expect(cameraModeToggleRequested({ key: "f", target })).toBe(false);
    }
  });
});

describe("the camera flight between the viewpoints", () => {
  it("eases, and reaches both ends exactly", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    // Monotonic: the camera never backs up on its way.
    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
      const value = easeInOutCubic(step / 10);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    // Clamped rather than extrapolated, so a bad progress value cannot fly the camera past its mark.
    expect(easeInOutCubic(-3)).toBe(0);
    expect(easeInOutCubic(4)).toBe(1);
  });

  it("blends position, target and lens together", () => {
    const start = interpolateCameraPose(ESTATE, CHARACTER, 0);
    const end = interpolateCameraPose(ESTATE, CHARACTER, 1);
    expectPoseClose(start, ESTATE);
    expectPoseClose(end, CHARACTER);
    const middle = interpolateCameraPose(ESTATE, CHARACTER, 0.5);
    // Halfway between the two viewpoints at the half-way point of the ease.
    expect(middle.eyeX).toBeCloseTo((ESTATE.eyeX + CHARACTER.eyeX) / 2, 6);
    expect(middle.fov).toBeCloseTo((ESTATE.fov + CHARACTER.fov) / 2, 6);
  });

  it("flies for the configured time and then stops", () => {
    const transition = createCameraTransition(ESTATE, CHARACTER, 0.6);
    expect(transition.isActive()).toBe(true);
    transition.advance(0.3);
    expect(transition.isActive()).toBe(true);
    expect(transition.pose().eyeX).toBeLessThan(ESTATE.eyeX);
    expect(transition.pose().eyeX).toBeGreaterThan(CHARACTER.eyeX);
    transition.advance(0.3);
    expect(transition.isActive()).toBe(false);
    expectPoseClose(transition.pose(), CHARACTER);
    // And a restored tab's enormous delta simply ends it rather than overshooting.
    const resumed = createCameraTransition(ESTATE, CHARACTER, CAMERA_TRANSITION_SECONDS);
    resumed.advance(30);
    expect(resumed.isActive()).toBe(false);
    expectPoseClose(resumed.pose(), CHARACTER);
  });

  it("re-aims at a moving destination without restarting the flight", () => {
    // The player can walk while the camera is still on its way: the destination is re-read each frame,
    // so the camera lands behind where the character *is*, not where they were when F was pressed.
    const transition = createCameraTransition(ESTATE, CHARACTER, 1);
    transition.advance(0.5);
    const moved: CameraPose = { ...CHARACTER, eyeX: CHARACTER.eyeX + 5, targetX: CHARACTER.targetX + 5 };
    transition.retarget(moved);
    expectPoseClose(transition.to(), moved);
    transition.advance(0.5);
    expect(transition.isActive()).toBe(false);
    expectPoseClose(transition.pose(), moved);
  });

  it("never writes back to the pose it is flying from", () => {
    // "The estate camera is preserved exactly" is this, in one line: a flight is a read of the estate
    // pose and a read of the character pose, and neither object is the rig the player was using.
    const estate = { ...ESTATE };
    const transition = createCameraTransition(estate, CHARACTER, 1);
    transition.retarget({ ...CHARACTER, eyeY: 9 });
    transition.advance(0.25);
    transition.pose();
    transition.advance(0.25);
    expectPoseClose(estate, ESTATE);
    expectPoseClose(transition.from, ESTATE);
  });
});
