/**
 * Keyboard movement input.
 *
 * This module turns keys into one movement vector and nothing else: no speed, no collision, no
 * rendering. Any future source (a virtual joystick, a gamepad) produces the same vector, so the
 * controller never learns where the intent came from.
 *
 * It is deliberately stateful and listener-driven: keys are tracked on `keydown`/`keyup`, never
 * sampled with a per-frame listener, and every path that could strand a key (blur, tab hidden)
 * clears the state so the character cannot keep walking after the player looks away.
 */

export interface InputVector {
  /** -1 (west/left) … 1 (east/right). */
  readonly x: number;
  /** -1 (north/up) … 1 (south/down), matching world +Z. */
  readonly z: number;
}

export const NEUTRAL_INPUT: InputVector = { x: 0, z: 0 };

/** Keys that mean "move", and the direction each contributes. */
const MOVEMENT_KEYS: Readonly<Record<string, InputVector>> = {
  w: { x: 0, z: 1 },
  arrowup: { x: 0, z: 1 },
  s: { x: 0, z: -1 },
  arrowdown: { x: 0, z: -1 },
  a: { x: -1, z: 0 },
  arrowleft: { x: -1, z: 0 },
  d: { x: 1, z: 0 },
  arrowright: { x: 1, z: 0 }
};

const MOVEMENT_KEY_NAMES: ReadonlySet<string> = new Set(Object.keys(MOVEMENT_KEYS));

/** Editor-like targets that own the keyboard: while one has focus, movement must not react. */
const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === "string" && EDITABLE_TAGS.has(element.tagName.toUpperCase());
}

function keyName(event: KeyboardEvent): string {
  return event.key.toLowerCase();
}

export interface MovementInput {
  /** The current intent. Always derived from held keys; never mutated in place. */
  vector(): InputVector;
  /** True while any movement key is held. */
  isActive(): boolean;
  /** Registers every listener this input owns. */
  attach(): void;
  /** Releases every listener and clears the held keys. */
  detach(): void;
}

export interface MovementInputOptions {
  /** Element that owns the keyboard; defaults to `window`. */
  readonly target?: Window;
  /** Objects that own the keyboard too (so a keydown on them is never a movement). */
  readonly ignoreTargets?: readonly EventTarget[];
  /** Called when input starts or stops being active, so a renderer can wake or sleep. */
  readonly onActivityChange?: (active: boolean) => void;
}

/**
 * Tracks which movement keys are held.
 *
 * Opposites cancel by construction: the vector is the sum of the held directions, so W+S is exactly
 * zero. Diagonals are left un-normalized here because the controller normalizes once, at the point
 * where speed is applied.
 */
export function createMovementInput(options: MovementInputOptions = {}): MovementInput {
  const target = options.target ?? window;
  const held = new Set<string>();
  let active = false;

  function vector(): InputVector {
    let x = 0;
    let z = 0;
    for (const key of held) {
      const direction = MOVEMENT_KEYS[key];
      if (direction === undefined) continue;
      x += direction.x;
      z += direction.z;
    }
    return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
  }

  function updateActivity(): void {
    const next = held.size > 0;
    if (next === active) return;
    active = next;
    options.onActivityChange?.(active);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const key = keyName(event);
    if (!MOVEMENT_KEY_NAMES.has(key)) return;
    if (maybeIgnored(event)) return;
    // Arrow keys would scroll the page, so they are only claimed while they mean movement.
    event.preventDefault();
    // Key repeat fires keydown again and again; the set makes it idempotent.
    held.add(key);
    updateActivity();
  }

  function maybeIgnored(event: KeyboardEvent): boolean {
    if (isEditableTarget(event.target)) return true;
    return (options.ignoreTargets ?? []).some((ignored) => ignored === event.target);
  }

  function onKeyUp(event: KeyboardEvent): void {
    const key = keyName(event);
    if (!MOVEMENT_KEY_NAMES.has(key)) return;
    held.delete(key);
    updateActivity();
  }

  function clear(): void {
    held.clear();
    updateActivity();
  }

  function onVisibilityChange(): void {
    if (target.document.visibilityState === "hidden") clear();
  }

  return {
    vector,
    isActive: () => active,
    attach(): void {
      target.addEventListener("keydown", onKeyDown);
      target.addEventListener("keyup", onKeyUp);
      target.addEventListener("blur", clear);
      target.document.addEventListener("visibilitychange", onVisibilityChange);
    },
    detach(): void {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", clear);
      target.document.removeEventListener("visibilitychange", onVisibilityChange);
      clear();
    }
  };
}
