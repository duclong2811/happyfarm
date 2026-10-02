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

/**
 * The same intent, from any source, bounded to one unit of movement.
 *
 * The **vector** is clamped, not each component: a source that reports (4, -3) must not become
 * (1, -1), whose length is 1.41 - a diagonal faster than a straight push, which is exactly what the
 * joystick's own rules forbid. Direction is preserved and the magnitude is capped, so "how far the
 * stick is pushed" survives and "how hard the player can push" does not.
 */
export function clampCharacterIntent(intent: CharacterMoveIntent): CharacterMoveIntent {
  const bound = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, -1), 1) : 0);
  const forward = bound(intent.forward);
  const right = bound(intent.right);
  const length = Math.hypot(forward, right);
  if (length <= 1) return { forward, right };
  return { forward: forward / length, right: right / length };
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

/** Which adapter produced the movement the character is making. */
export type CharacterInputSource = "NONE" | "KEYBOARD" | "TOUCH";

export interface ComposedCharacterInput {
  readonly intent: CharacterMoveIntent;
  readonly source: CharacterInputSource;
}

/** Whether an intent is asking for movement at all. */
export function intentIsNeutral(intent: CharacterMoveIntent): boolean {
  return !Number.isFinite(intent.forward) || !Number.isFinite(intent.right)
    ? true
    : Math.hypot(intent.forward, intent.right) <= 0.0001;
}

/**
 * The one rule that decides whose movement counts when both adapters are live.
 *
 * **A deflected touch stick wins; otherwise the keyboard does.** The alternatives were to sum the two
 * (which changes the *direction* when a hybrid player pushes a stick and holds a key - the character
 * veers - and makes "how fast am I going" a function of how many devices are plugged in) and to clamp
 * a sum to unit length (which keeps the speed honest but still veers). Choosing a source keeps the
 * character walking exactly where the player is pointing, and the brief's requirement - that two
 * inputs at once must never double the speed - is satisfied by construction: exactly one of them is
 * ever used.
 *
 * A finger on the stick is the more deliberate act of the two, so it wins. The moment it is released
 * the keyboard takes over again with no transition, because both feed the same controller.
 */
export function composeCharacterInput(
  keyboard: CharacterMoveIntent,
  touch: CharacterMoveIntent
): ComposedCharacterInput {
  if (!intentIsNeutral(touch)) return { intent: clampCharacterIntent(touch), source: "TOUCH" };
  if (!intentIsNeutral(keyboard)) return { intent: clampCharacterIntent(keyboard), source: "KEYBOARD" };
  return { intent: NO_CHARACTER_INTENT, source: "NONE" };
}
