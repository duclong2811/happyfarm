import { describe, expect, it } from "vitest";
import { CLICK_SLOP_PX, createDragGesture } from "../../apps/web/src/render/drag-gesture";

describe("canvas drag gesture", () => {
  it("treats a press that does not move as a click", () => {
    const gesture = createDragGesture();
    gesture.down(400, 300);
    expect(gesture.move(400, 300)).toEqual({ dragging: false, deltaX: 0, deltaY: 0 });
    expect(gesture.up()).toBe(false);
  });

  it("allows a click to wobble inside the slop without panning", () => {
    const gesture = createDragGesture();
    gesture.down(400, 300);
    const move = gesture.move(402, 302);
    expect(move.dragging).toBe(false);
    expect(move.deltaX).toBe(0);
    expect(move.deltaY).toBe(0);
    expect(gesture.up()).toBe(false);
  });

  it("becomes a drag past the slop, and drops the travel spent getting there", () => {
    const gesture = createDragGesture();
    gesture.down(400, 300);
    expect(gesture.move(403, 301).dragging).toBe(false);
    const crossing = gesture.move(420, 300);
    expect(crossing.dragging).toBe(true);
    // The travel since the previous move is reported; the 4px wobble before the slop is dropped, so
    // a click that wobbles and then drags does not nudge the camera twice.
    expect(crossing.deltaX).toBe(17);
    expect(crossing.deltaY).toBe(-1);
    const next = gesture.move(430, 310);
    expect(next).toEqual({ dragging: true, deltaX: 10, deltaY: 10 });
  });

  it("reports the release as a drag, so the caller suppresses the click", () => {
    const gesture = createDragGesture();
    gesture.down(100, 100);
    gesture.move(200, 100);
    expect(gesture.up()).toBe(true);
    // A second release without a new press is not a drag.
    expect(gesture.up()).toBe(false);
  });

  it("treats the slop as a distance, not an axis", () => {
    const gesture = createDragGesture(CLICK_SLOP_PX);
    gesture.down(0, 0);
    // 4 + 3 is 7, more than the 6px slop, even though neither axis crossed it alone.
    expect(gesture.move(4, 3).dragging).toBe(true);
  });

  it("forgets a press that was cancelled", () => {
    const gesture = createDragGesture();
    gesture.down(100, 100);
    gesture.reset();
    expect(gesture.move(300, 300)).toEqual({ dragging: false, deltaX: 0, deltaY: 0 });
    expect(gesture.up()).toBe(false);
  });

  it("ignores movement while no press is active", () => {
    const gesture = createDragGesture();
    expect(gesture.move(500, 500)).toEqual({ dragging: false, deltaX: 0, deltaY: 0 });
  });
});
