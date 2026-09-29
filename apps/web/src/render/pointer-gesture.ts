/**
 * What a press on the canvas means: a tap, a pan, or a pinch.
 *
 * Every surface - mouse, pen, finger - arrives here as a pointer, so the farm has one gesture
 * language instead of a mouse one and a touch one that drift apart. The module is pure: it is handed
 * pointer samples and answers with an intent, which is what lets arbitration be tested without a
 * browser.
 *
 * Precedence is deterministic and one-way:
 *
 * ```text
 * down                       -> tap candidate
 * one pointer moves > slop   -> pan (the tap candidate is gone)
 * a second pointer arrives   -> pinch (both earlier candidates are gone)
 * a pinch ends               -> the press stays spent until every pointer is up
 * pointercancel              -> forgotten, never a tap
 * ```
 *
 * A pinch therefore cannot end in a tile selection, and a drag cannot end in one either. Only a
 * press that never travelled further than the slop and was never joined by another pointer is a tap.
 */

/** How far a press may travel, in pixels, and still count as a tap. */
export const TAP_SLOP_PX = 6;

export interface GesturePointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export type GestureIntent =
  /** Nothing to do this event: a press below the slop, or a pointer that is not steering. */
  | { readonly kind: "none" }
  /** Move the camera by this many pixels. */
  | { readonly kind: "pan"; readonly deltaX: number; readonly deltaY: number }
  /** Scale the zoom by this factor: > 1 zooms in, < 1 zooms out. */
  | { readonly kind: "pinch"; readonly scale: number };

export interface PointerGesture {
  /** Pointers currently down. */
  readonly pointerCount: number;
  /** True while the press could still end as a tap. */
  readonly tapPending: boolean;
  down(pointer: GesturePointer): void;
  move(pointer: GesturePointer): GestureIntent;
  /** Releases a pointer. Returns true only when the whole press was a tap the caller may apply. */
  up(pointer: GesturePointer): boolean;
  /** Denies a pointer the right to become a tap, for one that left the canvas mid-press. */
  cancel(id: number): void;
  /** Forgets every pointer. */
  reset(): void;
}

interface TrackedPointer {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

type Mode = "idle" | "tap" | "pan" | "pinch" | "spent";

export function createPointerGesture(slopPixels: number = TAP_SLOP_PX): PointerGesture {
  const pointers = new Map<number, TrackedPointer>();
  let mode: Mode = "idle";
  let pinchDistance = 0;

  function distanceBetweenPointers(): number {
    const [first, second] = [...pointers.values()];
    if (first === undefined || second === undefined) return 0;
    return Math.hypot(second.lastX - first.lastX, second.lastY - first.lastY);
  }

  return {
    get pointerCount(): number {
      return pointers.size;
    },
    get tapPending(): boolean {
      return mode === "tap";
    },
    down(pointer: GesturePointer): void {
      pointers.set(pointer.id, {
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y
      });
      if (pointers.size === 1) {
        mode = "tap";
        return;
      }
      // A second pointer turns whatever was happening into a pinch. Two fingers are never a tap, and
      // the pan candidate is dropped with it: the pinch owns the gesture from here.
      mode = "pinch";
      pinchDistance = distanceBetweenPointers();
    },
    move(pointer: GesturePointer): GestureIntent {
      const tracked = pointers.get(pointer.id);
      if (tracked === undefined) return { kind: "none" };
      const previousX = tracked.lastX;
      const previousY = tracked.lastY;
      tracked.lastX = pointer.x;
      tracked.lastY = pointer.y;

      if (mode === "pinch") {
        if (pointers.size < 2) return { kind: "none" };
        const distance = distanceBetweenPointers();
        if (pinchDistance <= 0 || distance <= 0) {
          pinchDistance = distance;
          return { kind: "none" };
        }
        const scale = distance / pinchDistance;
        pinchDistance = distance;
        return { kind: "pinch", scale };
      }
      if (pointers.size !== 1 || mode === "spent") return { kind: "none" };

      if (mode === "tap" && Math.abs(pointer.x - tracked.startX) + Math.abs(pointer.y - tracked.startY) > slopPixels) {
        mode = "pan";
      }
      if (mode !== "pan") return { kind: "none" };

      // Deltas are measured between consecutive move events, so the moves that happened while the
      // press was still a tap candidate contributed nothing and the camera does not jump by the
      // slop the moment a drag begins.
      return { kind: "pan", deltaX: pointer.x - previousX, deltaY: pointer.y - previousY };
    },
    up(pointer: GesturePointer): boolean {
      const wasTap = mode === "tap" && pointers.has(pointer.id);
      pointers.delete(pointer.id);
      if (pointers.size === 0) {
        mode = "idle";
        pinchDistance = 0;
      } else if (mode === "pinch") {
        // Lifting one finger of a pinch does not hand the gesture back to the other one.
        mode = "spent";
      }
      return wasTap;
    },
    cancel(id: number): void {
      if (pointers.delete(id) && pointers.size === 0) {
        mode = "idle";
        pinchDistance = 0;
      }
    },
    reset(): void {
      pointers.clear();
      mode = "idle";
      pinchDistance = 0;
    }
  };
}
