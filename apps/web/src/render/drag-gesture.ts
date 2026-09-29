/**
 * The one gesture the canvas recognises: a press that either stays a click or becomes a drag.
 *
 * Both the old camera and the farm actions hang off the same pointer stream, so the decision is a
 * value rather than a set of flags sprinkled through the event handlers: a press is a click until it
 * travels further than the slop, and once it has, the release is not a click. The keyboard and the
 * DOM live elsewhere; this only decides what the pixels mean.
 */

/** How far a press may travel, in pixels, and still count as a click. */
export const CLICK_SLOP_PX = 6;

export interface DragMove {
  /** True once the press has travelled past the slop and is panning. */
  readonly dragging: boolean;
  /** Movement since the last reported move, in pixels. Zero until the gesture is a drag. */
  readonly deltaX: number;
  readonly deltaY: number;
}

export interface DragGesture {
  /** Starts a press at a point. */
  down(x: number, y: number): void;
  /** Reports a move, and how far to pan by if this press has become a drag. */
  move(x: number, y: number): DragMove;
  /** Ends the press. Returns true when it was a drag, so the caller must not treat it as a click. */
  up(): boolean;
  /** Forgets the gesture, for a pointer that left the canvas mid-press. */
  reset(): void;
}

const STILL: DragMove = { dragging: false, deltaX: 0, deltaY: 0 };

export function createDragGesture(slopPixels: number = CLICK_SLOP_PX): DragGesture {
  let pressed = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  return {
    down(x: number, y: number): void {
      pressed = true;
      dragging = false;
      startX = x;
      startY = y;
      lastX = x;
      lastY = y;
    },
    move(x: number, y: number): DragMove {
      if (!pressed) return STILL;
      if (!dragging && Math.abs(x - startX) + Math.abs(y - startY) > slopPixels) dragging = true;
      // The distance travelled before the slop is crossed is deliberately dropped: a click that
      // wobbles a few pixels must not also nudge the camera.
      const deltaX = dragging ? x - lastX : 0;
      const deltaY = dragging ? y - lastY : 0;
      lastX = x;
      lastY = y;
      return { dragging, deltaX, deltaY };
    },
    up(): boolean {
      const wasDragging = dragging;
      pressed = false;
      dragging = false;
      return wasDragging;
    },
    reset(): void {
      pressed = false;
      dragging = false;
    }
  };
}
