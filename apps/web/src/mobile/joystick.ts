import {
  NO_CHARACTER_INTENT,
  type CharacterMoveIntent
} from "../player/character-input";

/**
 * The virtual joystick: one finger, one direction, the same intent the keyboard produces.
 *
 * The point of the module is that it produces `CharacterMoveIntent` and nothing else. It does not
 * know about speed, collision, terrain, the camera or the character; it answers "which way is this
 * finger pushing", the composition layer decides whose answer counts, and the *same* controller that
 * desktop WASD feeds does the rest. That is the whole mobile-input architecture in one sentence, and
 * it is why V13.5 cannot become a second gameplay implementation by accident.
 *
 * Split in two, as the rest of this codebase's input is:
 *
 * * a **pure tracker** - pointer samples in, intent and thumb offset out - so every rule (the dead
 *   zone, the clamp, what a cancel does) is a unit test;
 * * a **DOM binder** that turns pointer events into those samples and writes one `transform` to the
 *   thumb. No per-move DOM building, no allocation worth measuring.
 */

/**
 * The joystick's geometry, in CSS pixels, in one place.
 *
 * The base is at the top of the range the brief suggests for a thumb-sized control, and the travel is
 * a little over two thirds of the radius so the thumb visibly rests *inside* its base at full
 * deflection - a thumb pinned to the rim reads as broken even when the intent is right.
 */
export interface JoystickGeometry {
  readonly baseRadiusPx: number;
  readonly thumbRadiusPx: number;
  /** Fraction of the base radius inside which a touch means "no direction yet". */
  readonly deadZoneFraction: number;
  /** Fraction of the base radius the thumb may travel. */
  readonly maxDisplacementFraction: number;
}

export const JOYSTICK_GEOMETRY: JoystickGeometry = {
  baseRadiusPx: 64,
  thumbRadiusPx: 26,
  deadZoneFraction: 0.18,
  maxDisplacementFraction: 0.68
};

/** The furthest the thumb may travel from the centre, in CSS pixels. */
export function joystickMaxDisplacement(geometry: JoystickGeometry): number {
  return geometry.baseRadiusPx * geometry.maxDisplacementFraction;
}

/** The distance inside which a touch is treated as "centred". */
export function joystickDeadZone(geometry: JoystickGeometry): number {
  return geometry.baseRadiusPx * geometry.deadZoneFraction;
}

/**
 * What a thumb position means.
 *
 * Screen-up is forward and screen-right is right, which is the same mapping the keyboard has (W is
 * forward). The magnitude is analog: a small displacement is a small intent, and a full one is a full
 * intent - the controller decides what "full" is worth. The returned vector is never longer than one
 * unit, so an intent cannot ask the character to move faster than the game's own speed.
 */
export function joystickIntentFor(
  offsetXPx: number,
  offsetYPx: number,
  geometry: JoystickGeometry = JOYSTICK_GEOMETRY
): CharacterMoveIntent {
  if (!Number.isFinite(offsetXPx) || !Number.isFinite(offsetYPx)) return NO_CHARACTER_INTENT;
  const distance = Math.hypot(offsetXPx, offsetYPx);
  const deadZone = joystickDeadZone(geometry);
  if (distance <= deadZone) return NO_CHARACTER_INTENT;
  const travel = Math.max(joystickMaxDisplacement(geometry) - deadZone, 0.0001);
  const magnitude = Math.min((distance - deadZone) / travel, 1);
  // Screen y grows downwards; the intent's forward grows away from the camera.
  return {
    forward: (-offsetYPx / distance) * magnitude,
    right: (offsetXPx / distance) * magnitude
  };
}

/**
 * Where the thumb is drawn, given where the finger is.
 *
 * Separate from the intent because they are different clamps: the *thumb* stops at the rim so the
 * control looks right, while the finger may keep travelling past it and the intent stays at full.
 */
export function joystickThumbOffset(
  offsetXPx: number,
  offsetYPx: number,
  geometry: JoystickGeometry = JOYSTICK_GEOMETRY
): { readonly x: number; readonly y: number } {
  if (!Number.isFinite(offsetXPx) || !Number.isFinite(offsetYPx)) return { x: 0, y: 0 };
  const distance = Math.hypot(offsetXPx, offsetYPx);
  const limit = joystickMaxDisplacement(geometry);
  if (distance <= limit || distance === 0) return { x: offsetXPx, y: offsetYPx };
  const scale = limit / distance;
  return { x: offsetXPx * scale, y: offsetYPx * scale };
}

export interface JoystickTracking {
  /** The control's own state: which pointer owns it, and where that finger is. */
  readonly pointerId: number | null;
  /**
   * Where the base's centre is, in client coordinates.
   *
   * Set by the binder from the element's own box, because this is a *fixed* joystick: the deflection
   * is measured from the base's middle, not from wherever the finger happened to land. Touching the
   * rim therefore means "push", immediately, which is how a physical stick behaves.
   */
  setCentre(x: number, y: number): void;
  down(pointerId: number, x: number, y: number): void;
  move(pointerId: number, x: number, y: number): void;
  up(pointerId: number): void;
  cancel(pointerId: number): void;
  /** Forgets everything, whatever is holding it: a blur, a hidden tab, a mode switch. */
  reset(): void;
  intent(): CharacterMoveIntent;
  /** The thumb offset for this frame's transform, already clamped to the rim. */
  thumb(): { readonly x: number; readonly y: number };
  /** Whether a finger is currently holding the stick. */
  active(): boolean;
}

/**
 * The pure half: pointer samples in, direction out.
 *
 * Ownership is by pointer id, so a second finger touching the joystick while the first is steering is
 * ignored rather than hijacking it, and a move from any other pointer is ignored entirely. That is
 * what lets the joystick and the camera be used at the same time (§13): the joystick only ever sees
 * its own pointer, and the camera only ever sees pointers that did not start here.
 */
export function createJoystickTracking(
  geometry: JoystickGeometry = JOYSTICK_GEOMETRY
): JoystickTracking {
  let owner: number | null = null;
  let centreX = 0;
  let centreY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let offsetX = 0;
  let offsetY = 0;

  return {
    get pointerId(): number | null {
      return owner;
    },
    setCentre(x: number, y: number): void {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      centreX = x;
      centreY = y;
      offsetX = pointerX - centreX;
      offsetY = pointerY - centreY;
    },
    down(pointerId: number, x: number, y: number): void {
      if (owner !== null) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      owner = pointerId;
      pointerX = x;
      pointerY = y;
      offsetX = x - centreX;
      offsetY = y - centreY;
    },
    move(pointerId: number, x: number, y: number): void {
      if (owner === null || pointerId !== owner) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      pointerX = x;
      pointerY = y;
      offsetX = x - centreX;
      offsetY = y - centreY;
    },
    up(pointerId: number): void {
      if (pointerId !== owner) return;
      this.reset();
    },
    cancel(pointerId: number): void {
      if (pointerId !== owner) return;
      this.reset();
    },
    reset(): void {
      owner = null;
      offsetX = 0;
      offsetY = 0;
    },
    intent(): CharacterMoveIntent {
      return owner === null ? NO_CHARACTER_INTENT : joystickIntentFor(offsetX, offsetY, geometry);
    },
    thumb(): { readonly x: number; readonly y: number } {
      return owner === null ? { x: 0, y: 0 } : joystickThumbOffset(offsetX, offsetY, geometry);
    },
    active(): boolean {
      return owner !== null;
    }
  };
}

/** The slice of an element the binder needs. Narrow, so a test can pass a plain object. */
export interface JoystickElement {
  addEventListener(type: string, handler: (event: PointerEvent) => void): void;
  removeEventListener(type: string, handler: (event: PointerEvent) => void): void;
  hasPointerCapture?(pointerId: number): boolean;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  getBoundingClientRect?(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** The slice of the thumb the binder needs: somewhere to write the transform. */
export interface JoystickThumb {
  readonly style: { transform: string };
}

/** The slice of a window the binder needs, matching the keyboard input's own shape. */
export interface JoystickTarget {
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
  readonly document?: {
    readonly visibilityState: string;
    addEventListener(type: string, handler: () => void): void;
    removeEventListener(type: string, handler: () => void): void;
  };
}

export interface JoystickControlOptions {
  /** The base element that receives the touch. It owns the pointer for the whole gesture. */
  readonly surface: JoystickElement;
  /** The element drawn at the thumb offset, or null for a control with no visual thumb. */
  readonly thumb?: JoystickThumb | null;
  readonly geometry?: JoystickGeometry;
  readonly target: JoystickTarget;
  /**
   * Called whenever the stick's state changes - a touch landing, moving, or leaving.
   *
   * The joystick knows nothing about the game's frame loop, and should not; this is how the host is
   * told that there is something new to draw. It must stay cheap: it fires per pointer event, not per
   * frame, and the host's own wake is a no-op while a frame is already pending.
   */
  readonly onIntent?: () => void;
}

export interface JoystickControl {
  intent(): CharacterMoveIntent;
  /** Whether a finger is on the stick - the debug overlay and the tests want to know. */
  active(): boolean;
  /** Forgets the finger and recentres the thumb, whatever is holding it: a mode switch, a modal. */
  clear(): void;
  attach(): void;
  detach(): void;
}

/** Where the centre of the base is, in client coordinates. Recomputed once per press. */
function centreOf(surface: JoystickElement): { readonly x: number; readonly y: number } {
  const rect = surface.getBoundingClientRect?.();
  if (rect === undefined) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The DOM half: pointer events in, one `transform` out.
 *
 * The centre is read from the element's own box rather than from where the finger landed, because
 * V13.5 ships a *fixed* joystick (the brief's choice): a control that moves to the finger is harder
 * to discover, harder to QA, and competes with the camera for the same touch.
 *
 * Ownership is enforced twice: the tracker ignores every pointer but its own, and the element
 * captures the pointer so a finger that slides off the joystick keeps steering it instead of
 * starting a camera drag.
 */
export function createJoystickControl(options: JoystickControlOptions): JoystickControl {
  const geometry = options.geometry ?? JOYSTICK_GEOMETRY;
  const tracking = createJoystickTracking(geometry);

  function paint(): void {
    const thumb = options.thumb;
    if (thumb === undefined || thumb === null) return;
    const offset = tracking.thumb();
    thumb.style.transform = `translate3d(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px, 0)`;
  }

  function onPointerDown(event: PointerEvent): void {
    // The first finger wins; a second one landing on the stick is ignored, not adopted.
    if (tracking.active()) return;
    const centre = centreOf(options.surface);
    // The base can move between presses - a rotation, a resize, a safe-area change - so its centre is
    // re-read here rather than remembered.
    tracking.setCentre(centre.x, centre.y);
    tracking.down(event.pointerId, event.clientX, event.clientY);
    // Capture so the gesture survives the finger leaving the base, and so the canvas never sees it.
    try {
      options.surface.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser no longer considers active cannot be captured; the stick still works,
      // it just stops at the edge of its own element.
    }
    paint();
    options.onIntent?.();
  }

  function onPointerMove(event: PointerEvent): void {
    if (tracking.pointerId !== event.pointerId) return;
    tracking.move(event.pointerId, event.clientX, event.clientY);
    paint();
    options.onIntent?.();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (tracking.pointerId !== event.pointerId) return;
    tracking.cancel(event.pointerId);
    paint();
    options.onIntent?.();
  }

  function clear(): void {
    if (!tracking.active()) return;
    tracking.reset();
    paint();
    options.onIntent?.();
  }

  function onVisibilityChange(): void {
    if (options.target.document?.visibilityState === "hidden") clear();
  }

  return {
    intent: () => tracking.intent(),
    active: () => tracking.active(),
    clear,
    attach(): void {
      options.surface.addEventListener("pointerdown", onPointerDown);
      options.surface.addEventListener("pointermove", onPointerMove);
      options.surface.addEventListener("pointerup", onPointerEnd);
      options.surface.addEventListener("pointercancel", onPointerEnd);
      options.surface.addEventListener("lostpointercapture", onPointerEnd);
      // A finger that is lifted outside the window, or a tab that is hidden, must never leave the
      // character walking.
      options.target.addEventListener("blur", clear);
      options.target.document?.addEventListener("visibilitychange", onVisibilityChange);
    },
    detach(): void {
      options.surface.removeEventListener("pointerdown", onPointerDown);
      options.surface.removeEventListener("pointermove", onPointerMove);
      options.surface.removeEventListener("pointerup", onPointerEnd);
      options.surface.removeEventListener("pointercancel", onPointerEnd);
      options.surface.removeEventListener("lostpointercapture", onPointerEnd);
      options.target.removeEventListener("blur", clear);
      options.target.document?.removeEventListener("visibilitychange", onVisibilityChange);
      clear();
    }
  };
}

export interface HoldControlOptions {
  readonly element: JoystickElement;
  readonly target: JoystickTarget;
  /** Called with the new held state, and once with false on every kind of loss. */
  readonly onChange: (held: boolean) => void;
}

export interface HoldControl {
  held(): boolean;
  /** Releases the button even if no pointer event arrives: a mode switch, a modal, a hidden tab. */
  clear(): void;
  attach(): void;
  detach(): void;
}

/**
 * A press-and-hold button: the Run control.
 *
 * Deliberately dumb, and deliberately paranoid about the way a held virtual button goes wrong: it
 * reports `false` on release, cancel, lost capture, a blurred window and a hidden tab. A run button
 * that stays held after a finger is lifted is the one bug that would be worse than not having one.
 */
export function createHoldControl(options: HoldControlOptions): HoldControl {
  let held = false;

  function set(next: boolean): void {
    if (next === held) return;
    held = next;
    options.onChange(held);
  }

  function onDown(event: PointerEvent): void {
    event.preventDefault();
    try {
      options.element.setPointerCapture?.(event.pointerId);
    } catch {
      // As above: an uncapturable pointer still works, it just ends at the element's edge.
    }
    set(true);
  }

  function release(): void {
    set(false);
  }

  function onVisibilityChange(): void {
    if (options.target.document?.visibilityState === "hidden") release();
  }

  return {
    held: () => held,
    clear: release,
    attach(): void {
      options.element.addEventListener("pointerdown", onDown);
      options.element.addEventListener("pointerup", release);
      options.element.addEventListener("pointercancel", release);
      options.element.addEventListener("lostpointercapture", release);
      options.target.addEventListener("blur", release);
      options.target.document?.addEventListener("visibilitychange", onVisibilityChange);
    },
    detach(): void {
      options.element.removeEventListener("pointerdown", onDown);
      options.element.removeEventListener("pointerup", release);
      options.element.removeEventListener("pointercancel", release);
      options.element.removeEventListener("lostpointercapture", release);
      options.target.removeEventListener("blur", release);
      options.target.document?.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    }
  };
}
