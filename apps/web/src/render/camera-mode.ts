import { isTypingTarget } from "../player/input";

/**
 * The two ways to look at one island.
 *
 * Estate View is the designer's: a high orbit over the whole farm, cell selection, the Build Shop,
 * moving and storing objects. Character View is the resident's: a third-person camera behind the
 * character, walking the same ground at human scale. They are two *control and camera* states over
 * one world - one terrain, one object state, one player, one renderer - and nothing here may become a
 * second world. Switching modes is a change of viewpoint, not a change of game.
 *
 * The mode itself is owned by the host page (it renders the switch and knows when a panel needs the
 * estate view); this module owns the parts that are pure: which mode a toggle leads to, whether a
 * keystroke is a mode shortcut at all, and the animation that carries the camera between the two
 * viewpoints.
 */

export type CameraMode = "ESTATE" | "CHARACTER";

/** A session opens in the view the game has always had. */
export const DEFAULT_CAMERA_MODE: CameraMode = "ESTATE";

export function otherCameraMode(mode: CameraMode): CameraMode {
  return mode === "ESTATE" ? "CHARACTER" : "ESTATE";
}

/**
 * Whether a keystroke asks for the mode to change.
 *
 * `F` toggles, and it is deliberately ignored while a text field, a select or a contenteditable has
 * focus: a player typing a farm name is not asking to change the camera. The same guard the movement
 * keys use, so "the keyboard belongs to the field" is one rule rather than two.
 */
export function cameraModeToggleRequested(event: {
  readonly key: string;
  readonly target: unknown;
}): boolean {
  if (event.key !== "f" && event.key !== "F") return false;
  return !isTypingTarget(event.target);
}

/**
 * One camera, as a value: where the eye is, where it looks, and how wide it is.
 *
 * The estate rig and the character rig each produce one of these, and a transition is a blend
 * between two of them. Keeping the whole camera in one plain shape is what lets the blend be a pure
 * function - and what lets a test assert the end state without a renderer.
 */
export interface CameraPose {
  readonly eyeX: number;
  readonly eyeY: number;
  readonly eyeZ: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  /** Vertical field of view, in degrees. */
  readonly fov: number;
}

/** How long the camera takes to travel between the two viewpoints. */
export const CAMERA_TRANSITION_SECONDS = 0.65;

/** Smooth at both ends: the camera leaves and arrives without a jolt. */
export function easeInOutCubic(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The camera part-way between two viewpoints. Pure: the same endpoints and `t` give the same pose. */
export function interpolateCameraPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeInOutCubic(t);
  return {
    eyeX: lerp(from.eyeX, to.eyeX, eased),
    eyeY: lerp(from.eyeY, to.eyeY, eased),
    eyeZ: lerp(from.eyeZ, to.eyeZ, eased),
    targetX: lerp(from.targetX, to.targetX, eased),
    targetY: lerp(from.targetY, to.targetY, eased),
    targetZ: lerp(from.targetZ, to.targetZ, eased),
    fov: lerp(from.fov, to.fov, eased)
  };
}

export interface CameraTransition {
  /** Where the camera was when the switch began. */
  readonly from: CameraPose;
  /** Where it is going right now. Re-read every frame, because the world may be moving. */
  to(): CameraPose;
  /**
   * Changes where the camera is going without restarting the flight.
   *
   * A third-person camera chases a *player*, and a player can walk while the camera is still on its
   * way. Re-aiming the same eased blend keeps the arrival exact - the alternative, freezing the
   * destination when the switch begins, lands the camera where the character used to be.
   */
  retarget(next: CameraPose): void;
  /** Advances the clock and returns the raw progress in 0..1. */
  advance(deltaSeconds: number): number;
  /** Whether the camera is still travelling. */
  isActive(): boolean;
  /** The blended pose right now. */
  pose(): CameraPose;
}

/**
 * A short, eased flight from one viewpoint to the other.
 *
 * Deliberately not a cut: the island is the same island, and taking the camera away and putting it
 * back - or worse, cutting - would read as a scene change. It is also deliberately short, and manual
 * camera input is suppressed for its duration (see the scene), so nothing fights the interpolation.
 */
export function createCameraTransition(
  from: CameraPose,
  to: CameraPose,
  durationSeconds = CAMERA_TRANSITION_SECONDS
): CameraTransition {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : CAMERA_TRANSITION_SECONDS;
  let elapsed = 0;
  let target = to;
  return {
    from,
    to(): CameraPose {
      return target;
    },
    retarget(next: CameraPose): void {
      target = next;
    },
    advance(deltaSeconds: number): number {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return Math.min(elapsed / duration, 1);
      // A restored tab hands in an enormous delta; the transition is short, so it simply ends.
      elapsed += Math.min(deltaSeconds, duration);
      return Math.min(elapsed / duration, 1);
    },
    isActive(): boolean {
      return elapsed < duration;
    },
    pose(): CameraPose {
      return interpolateCameraPose(from, target, Math.min(elapsed / duration, 1));
    }
  };
}
