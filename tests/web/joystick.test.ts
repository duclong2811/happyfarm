import { describe, expect, it } from "vitest";
import {
  JOYSTICK_GEOMETRY,
  createHoldControl,
  createJoystickControl,
  createJoystickTracking,
  joystickDeadZone,
  joystickIntentFor,
  joystickMaxDisplacement,
  joystickThumbOffset,
  type JoystickTarget
} from "../../apps/web/src/mobile/joystick";

/**
 * The virtual joystick, and the promise that it is only an input adapter.
 *
 * Everything the player would feel is here: the dead zone that stops a resting thumb from drifting the
 * character, the analog magnitude, the clamp that stops a diagonal being faster than a straight push,
 * and - the one that matters most - that letting go always means stopping, whatever kind of ending it
 * was (a lift, a cancel, a blurred window, a hidden tab).
 */

const BASE = 100;
const CENTRE = { x: 200, y: 400 };

function tracker(): ReturnType<typeof createJoystickTracking> {
  const tracking = createJoystickTracking();
  tracking.setCentre(CENTRE.x, CENTRE.y);
  return tracking;
}

/** The fake element the binder writes to and the test fires at. */
function fakeElement() {
  const listeners = new Map<string, Set<(event: PointerEvent) => void>>();
  const element = {
    addEventListener(type: string, handler: (event: PointerEvent) => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: (event: PointerEvent) => void): void {
      listeners.get(type)?.delete(handler);
    },
    setPointerCapture(): void {},
    getBoundingClientRect: () => ({ left: CENTRE.x - BASE / 2, top: CENTRE.y - BASE / 2, width: BASE, height: BASE }),
    listenerCount(): number {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
    fire(type: string, event: { pointerId: number; clientX: number; clientY: number }): void {
      // A real pointer event can be cancelled; the Run button cancels it so a long press cannot
      // become a text selection or a context menu.
      const full = { ...event, preventDefault: () => undefined };
      for (const handler of listeners.get(type) ?? []) handler(full as unknown as PointerEvent);
    }
  };
  return element;
}

function fakeTarget(visibility = "visible") {
  const listeners = new Map<string, Set<() => void>>();
  const documentListeners = new Map<string, Set<() => void>>();
  const target: JoystickTarget = {
    addEventListener(type: string, handler: () => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: () => void): void {
      listeners.get(type)?.delete(handler);
    },
    document: {
      get visibilityState(): string {
        return visibility;
      },
      addEventListener(type: string, handler: () => void): void {
        const set = documentListeners.get(type) ?? new Set();
        set.add(handler);
        documentListeners.set(type, set);
      },
      removeEventListener(type: string, handler: () => void): void {
        documentListeners.get(type)?.delete(handler);
      }
    }
  };
  return {
    target,
    fire(type: string): void {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    hide(): void {
      visibility = "hidden";
      for (const handler of documentListeners.get("visibilitychange") ?? []) handler();
    },
    listenerCount(): number {
      return (
        [...listeners.values()].reduce((total, set) => total + set.size, 0) +
        [...documentListeners.values()].reduce((total, set) => total + set.size, 0)
      );
    }
  };
}

describe("what a thumb position means", () => {
  it("is nothing at all inside the dead zone", () => {
    expect(joystickIntentFor(0, 0)).toEqual({ forward: 0, right: 0 });
    const inside = joystickDeadZone(JOYSTICK_GEOMETRY) - 1;
    expect(joystickIntentFor(0, -inside)).toEqual({ forward: 0, right: 0 });
    expect(joystickIntentFor(inside, 0)).toEqual({ forward: 0, right: 0 });
    // A resting thumb is exactly this: a pixel or two of wobble must not walk the character.
    expect(joystickDeadZone(JOYSTICK_GEOMETRY)).toBeGreaterThan(5);
  });

  it("reads screen-up as forward, and screen-right as right", () => {
    expect(joystickIntentFor(0, -BASE).forward).toBeGreaterThan(0.9);
    expect(joystickIntentFor(0, BASE).forward).toBeLessThan(-0.9);
    expect(joystickIntentFor(BASE, 0).right).toBeGreaterThan(0.9);
    expect(joystickIntentFor(-BASE, 0).right).toBeLessThan(-0.9);
    // A straight push has no sideways component, and vice versa.
    expect(joystickIntentFor(0, -BASE).right).toBeCloseTo(0, 9);
  });

  it("never asks for more than one unit of movement, on any diagonal", () => {
    for (const [x, y] of [
      [BASE, BASE],
      [-BASE, -BASE],
      [BASE, -BASE],
      [BASE * 3, -BASE * 2]
    ] as const) {
      const intent = joystickIntentFor(x, y);
      expect(Math.hypot(intent.forward, intent.right)).toBeLessThanOrEqual(1.0001);
    }
    // A full diagonal is still a full unit, not 1.41: the clamp is the point.
    const diagonal = joystickIntentFor(BASE, -BASE);
    expect(Math.hypot(diagonal.forward, diagonal.right)).toBeCloseTo(1, 3);
  });

  it("is analog between the dead zone and the rim", () => {
    const dead = joystickDeadZone(JOYSTICK_GEOMETRY);
    const travel = joystickMaxDisplacement(JOYSTICK_GEOMETRY);
    const half = joystickIntentFor(0, -(dead + (travel - dead) / 2)).forward;
    const full = joystickIntentFor(0, -travel).forward;
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(full);
    expect(full).toBeCloseTo(1, 3);
    // Pushing past the rim is the same as pushing to it: the intent cannot grow further.
    expect(joystickIntentFor(0, -travel * 4).forward).toBeCloseTo(full, 6);
  });

  it("keeps the drawn thumb inside its base even when the finger leaves it", () => {
    const limit = joystickMaxDisplacement(JOYSTICK_GEOMETRY);
    const thumb = joystickThumbOffset(BASE * 2, BASE * 2);
    expect(Math.hypot(thumb.x, thumb.y)).toBeCloseTo(limit, 6);
    // Inside the rim it simply follows the finger.
    const near = joystickThumbOffset(10, -12);
    expect(near).toEqual({ x: 10, y: -12 });
  });
});

describe("holding the stick", () => {
  it("measures from the base's centre, not from where the finger landed", () => {
    const tracking = tracker();
    // Touching the rim means full deflection immediately - a fixed stick, not a floating one.
    tracking.down(1, CENTRE.x, CENTRE.y - joystickMaxDisplacement(JOYSTICK_GEOMETRY));
    expect(tracking.intent().forward).toBeCloseTo(1, 3);
    // And moving the centre (a rotation, a resize) re-measures the same finger against it.
    tracking.setCentre(CENTRE.x, CENTRE.y - 10);
    expect(tracking.intent().forward).toBeLessThan(1);
  });

  it("stops the moment the finger is lifted, cancelled, or captured away", () => {
    for (const ending of ["up", "cancel", "reset"] as const) {
      const tracking = tracker();
      tracking.down(7, CENTRE.x, CENTRE.y - 60);
      expect(tracking.active()).toBe(true);
      expect(tracking.intent().forward).toBeGreaterThan(0);
      if (ending === "reset") tracking.reset();
      else tracking[ending](7);
      expect(tracking.active()).toBe(false);
      expect(tracking.intent()).toEqual({ forward: 0, right: 0 });
      expect(tracking.thumb()).toEqual({ x: 0, y: 0 });
    }
  });

  it("owns one pointer, and ignores every other", () => {
    // The multi-touch rule: a second finger on the stick is a camera finger that missed, and a move
    // from a pointer that is not steering must not move the character.
    const tracking = tracker();
    tracking.down(1, CENTRE.x, CENTRE.y - 40);
    const held = tracking.intent();
    tracking.down(2, CENTRE.x, CENTRE.y + 40);
    expect(tracking.pointerId).toBe(1);
    expect(tracking.intent()).toEqual(held);
    tracking.move(2, CENTRE.x, CENTRE.y + 60);
    expect(tracking.intent()).toEqual(held);
    tracking.up(2);
    expect(tracking.active()).toBe(true);
    tracking.move(1, CENTRE.x + 40, CENTRE.y);
    expect(tracking.intent().right).toBeGreaterThan(0);
  });
});

describe("the joystick as a control", () => {
  it("follows a finger, writes one transform, and clears on every kind of ending", () => {
    const element = fakeElement();
    const thumb = { style: { transform: "" } };
    const fake = fakeTarget();
    let wakes = 0;
    const control = createJoystickControl({
      surface: element,
      thumb,
      target: fake.target,
      onIntent: () => {
        wakes += 1;
      }
    });
    control.attach();

    element.fire("pointerdown", { pointerId: 1, clientX: CENTRE.x, clientY: CENTRE.y - 60 });
    expect(control.intent().forward).toBeGreaterThan(0);
    expect(thumb.style.transform).toContain("translate3d");
    expect(wakes).toBeGreaterThan(0);

    // A blurred window is the classic way a virtual stick gets stuck: the finger is still down as far
    // as the page knows, and no pointerup ever arrives.
    fake.fire("blur");
    expect(control.intent()).toEqual({ forward: 0, right: 0 });

    element.fire("pointerdown", { pointerId: 2, clientX: CENTRE.x + 70, clientY: CENTRE.y });
    expect(control.intent().right).toBeGreaterThan(0);
    fake.hide();
    expect(control.intent()).toEqual({ forward: 0, right: 0 });

    element.fire("pointerdown", { pointerId: 3, clientX: CENTRE.x, clientY: CENTRE.y - 70 });
    element.fire("pointercancel", { pointerId: 3, clientX: CENTRE.x, clientY: CENTRE.y - 70 });
    expect(control.active()).toBe(false);

    control.detach();
    expect(element.listenerCount()).toBe(0);
    expect(fake.listenerCount()).toBe(0);
  });

  it("binds each listener once, so a mode switch cannot multiply the input", () => {
    // The brief's long-session check: switching modes must not accumulate handlers.
    const element = fakeElement();
    const fake = fakeTarget();
    const control = createJoystickControl({
      surface: element,
      target: fake.target
    });
    control.attach();
    const first = element.listenerCount();
    control.clear();
    control.clear();
    expect(element.listenerCount()).toBe(first);
  });
});

describe("the run button", () => {
  it("is held while pressed, and released by every way a press can end", () => {
    for (const ending of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      const element = fakeElement();
      const fake = fakeTarget();
      const states: boolean[] = [];
      const control = createHoldControl({
        element: element,
        target: fake.target,
        onChange: (held) => states.push(held)
      });
      control.attach();
      element.fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
      expect(control.held()).toBe(true);
      element.fire(ending, { pointerId: 1, clientX: 0, clientY: 0 });
      expect(control.held()).toBe(false);
      expect(states).toEqual([true, false]);
      control.detach();
      expect(element.listenerCount()).toBe(0);
    }
  });

  it("cannot stay held across a blurred window or a hidden tab", () => {
    const element = fakeElement();
    const fake = fakeTarget();
    const control = createHoldControl({
      element: element,
      target: fake.target,
      onChange: () => undefined
    });
    control.attach();
    element.fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    fake.fire("blur");
    expect(control.held()).toBe(false);
    element.fire("pointerdown", { pointerId: 2, clientX: 0, clientY: 0 });
    fake.hide();
    expect(control.held()).toBe(false);
    // A direct clear (a mode switch) does the same.
    element.fire("pointerdown", { pointerId: 3, clientX: 0, clientY: 0 });
    control.clear();
    expect(control.held()).toBe(false);
    control.detach();
  });
});
