import { describe, expect, it } from "vitest";
import { createPointerGesture, TAP_SLOP_PX } from "../../apps/web/src/render/pointer-gesture";

const FIRST = 1;
const SECOND = 2;

describe("canvas pointer gestures", () => {
  it("treats a press that does not move as a tap", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 400, y: 300 });
    expect(gesture.move({ id: FIRST, x: 400, y: 300 })).toEqual({ kind: "none" });
    expect(gesture.tapPending).toBe(true);
    expect(gesture.up({ id: FIRST, x: 400, y: 300 })).toBe(true);
    expect(gesture.pointerCount).toBe(0);
  });

  it("allows a tap to wobble inside the slop", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 400, y: 300 });
    expect(gesture.move({ id: FIRST, x: 402, y: 302 })).toEqual({ kind: "none" });
    expect(gesture.up({ id: FIRST, x: 402, y: 302 })).toBe(true);
  });

  it("turns a press into a pan once it passes the slop, and drops the wobble", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 400, y: 300 });
    expect(gesture.move({ id: FIRST, x: 403, y: 301 })).toEqual({ kind: "none" });
    expect(gesture.move({ id: FIRST, x: 420, y: 300 })).toEqual({ kind: "pan", deltaX: 17, deltaY: -1 });
    expect(gesture.move({ id: FIRST, x: 430, y: 310 })).toEqual({ kind: "pan", deltaX: 10, deltaY: 10 });
    expect(gesture.tapPending).toBe(false);
  });

  it("treats the slop as a distance, not an axis", () => {
    const gesture = createPointerGesture(TAP_SLOP_PX);
    gesture.down({ id: FIRST, x: 0, y: 0 });
    expect(gesture.move({ id: FIRST, x: 4, y: 3 }).kind).toBe("pan");
  });

  it("never lets a pan release select anything", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.move({ id: FIRST, x: 200, y: 100 });
    expect(gesture.up({ id: FIRST, x: 200, y: 100 })).toBe(false);
  });

  it("starts a pinch when a second pointer arrives and reports its scale", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.down({ id: SECOND, x: 200, y: 100 });
    expect(gesture.pointerCount).toBe(2);
    expect(gesture.tapPending).toBe(false);
    // Fingers 100px apart, then 50px apart: the zoom factor halves together with the span.
    expect(gesture.move({ id: SECOND, x: 150, y: 100 })).toEqual({ kind: "pinch", scale: 0.5 });
    // Spreading from 50px to 200px is a factor of four on the same span.
    expect(gesture.move({ id: SECOND, x: 300, y: 100 })).toEqual({ kind: "pinch", scale: 4 });
  });

  it("cancels the tap candidate as soon as a second finger joins", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 400, y: 300 });
    gesture.move({ id: FIRST, x: 402, y: 300 });
    gesture.down({ id: SECOND, x: 420, y: 300 });
    // Both releases are refused: the press became a pinch, and a pinch never selects.
    expect(gesture.up({ id: SECOND, x: 420, y: 300 })).toBe(false);
    expect(gesture.up({ id: FIRST, x: 402, y: 300 })).toBe(false);
  });

  it("reports no further pan or tap on the finger left over from a pinch", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.down({ id: SECOND, x: 200, y: 100 });
    gesture.move({ id: FIRST, x: 90, y: 100 });
    expect(gesture.up({ id: SECOND, x: 200, y: 100 })).toBe(false);
    expect(gesture.move({ id: FIRST, x: 300, y: 300 })).toEqual({ kind: "none" });
    expect(gesture.up({ id: FIRST, x: 300, y: 300 })).toBe(false);
    // With every finger lifted the next press is a fresh tap candidate.
    gesture.down({ id: FIRST, x: 10, y: 10 });
    expect(gesture.up({ id: FIRST, x: 10, y: 10 })).toBe(true);
  });

  it("ignores movement from a pointer it never saw go down", () => {
    const gesture = createPointerGesture();
    expect(gesture.move({ id: 99, x: 500, y: 500 })).toEqual({ kind: "none" });
  });

  it("forgets a cancelled pointer, and its press can never become a tap", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.cancel(FIRST);
    expect(gesture.pointerCount).toBe(0);
    expect(gesture.up({ id: FIRST, x: 100, y: 100 })).toBe(false);
  });

  it("drops a whole pinch when a finger is cancelled", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.down({ id: SECOND, x: 200, y: 100 });
    gesture.cancel(SECOND);
    expect(gesture.pointerCount).toBe(1);
    // The remaining finger belongs to a pinch that no longer exists, so it does not pan.
    expect(gesture.move({ id: FIRST, x: 300, y: 300 })).toEqual({ kind: "none" });
    expect(gesture.up({ id: FIRST, x: 300, y: 300 })).toBe(false);
  });

  it("clears everything on reset", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.reset();
    expect(gesture.pointerCount).toBe(0);
    expect(gesture.move({ id: FIRST, x: 300, y: 300 })).toEqual({ kind: "none" });
    expect(gesture.up({ id: FIRST, x: 300, y: 300 })).toBe(false);
  });

  it("ignores a pinch whose fingers share a position", () => {
    const gesture = createPointerGesture();
    gesture.down({ id: FIRST, x: 100, y: 100 });
    gesture.down({ id: SECOND, x: 100, y: 100 });
    expect(gesture.move({ id: SECOND, x: 120, y: 100 })).toEqual({ kind: "none" });
    expect(gesture.move({ id: SECOND, x: 160, y: 100 })).toEqual({ kind: "pinch", scale: 3 });
  });
});
