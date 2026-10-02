import { NEUTRAL_INPUT, type InputVector } from "./input";

/**
 * What the player *wants* the character to do, before anyone knows how they asked.
 *
 * The controller never sees a `KeyboardEvent`, a key name, or a key code. A desktop keyboard
 * produces this intent today; a virtual joystick will produce the same two numbers tomorrow, and the
 * controller - and every test below it - will not change. That is the whole reason the intent exists:
 * V13.5 adds a thumbstick, not a second movement system.
 *
 * `forward` is away from the camera and `right` is to the camera's right, both in -1..1. They are
 * *not* world axes: the camera's yaw is what turns them into one, below.
 */
export interface CharacterMoveIntent {
  readonly forward: number;
  readonly right: number;
}

export const NO_CHARACTER_INTENT: CharacterMoveIntent = { forward: 0, right: 0 };

/**
 * The desktop keyboard's adapter.
 *
 * The movement keys are tracked once, by the same listener the estate view uses - W is forward, S
 * back, A left, D right, and opposites cancel - so this is a *reading* of that state rather than a
 * second keyboard listener that could disagree with it. Which is also why a test can hold the intent
 * to "W is forward" without a DOM.
 */
export function characterIntentFromInput(vector: InputVector): CharacterMoveIntent {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.z)) return NO_CHARACTER_INTENT;
  return { forward: vector.z, right: vector.x };
}

/** The same intent, from a future joystick: two bounded numbers, in the same ranges. */
export function clampCharacterIntent(intent: CharacterMoveIntent): CharacterMoveIntent {
  const bound = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, -1), 1) : 0);
  return { forward: bound(intent.forward), right: bound(intent.right) };
}

/**
 * The world direction the intent means, given where the camera is looking.
 *
 * The camera's own yaw defines the frame, not world north: with the camera turned a quarter turn,
 * W is a different world direction, which is what makes third-person movement feel like the player
 * is steering the character rather than the map. The eye sits at `target + (sin yaw, cos yaw)`, so
 * the way the camera faces, flattened onto the ground, is `(-sin yaw, -cos yaw)`, and its right is
 * `(cos yaw, -sin yaw)` - the same frame the estate camera pans in, so the two views agree about
 * what "right" means.
 *
 * The diagonal is normalized here, once: W+D is the same speed as W, because the intent is a
 * direction and not two independent axes. The controller normalizes again at the point of use, so a
 * direction is all the intent has to be - which is also why a future joystick's half-deflection will
 * walk at walk speed until a later pass gives magnitude a meaning.
 */
export function cameraRelativeMovement(intent: CharacterMoveIntent, cameraYaw: number): InputVector {
  if (!Number.isFinite(cameraYaw)) return NEUTRAL_INPUT;
  const { forward, right } = clampCharacterIntent(intent);
  const length = Math.hypot(forward, right);
  if (length <= 0) return NEUTRAL_INPUT;
  // A direction of at most unit length: a rim-pushed joystick never outruns the keyboard.
  const scale = length > 1 ? 1 / length : 1;
  const alongForward = forward * scale;
  const alongRight = right * scale;
  return {
    x: -Math.sin(cameraYaw) * alongForward + Math.cos(cameraYaw) * alongRight,
    z: -Math.cos(cameraYaw) * alongForward - Math.sin(cameraYaw) * alongRight
  };
}

/** How much faster a run is than a walk. No stamina: this is a pace, not a resource. */
export const RUN_SPEED_MULTIPLIER = 1.6;
