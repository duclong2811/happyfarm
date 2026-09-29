/**
 * Where the camera looks, without three.
 *
 * The view is a farming camera, not a character camera: the target is the character's position plus
 * whatever offset the player dragged in. Dragging therefore inspects the map without fighting the
 * follow - the offset survives movement, so walking with the camera pushed to one side keeps it
 * pushed to that side - and the target can never leave the farm.
 *
 * Nothing here knows about the character's state or the scene graph: the rig only reads a position
 * and only writes its own offset and zoom, which is what makes "a camera drag is not player
 * movement" true by construction. Keeping it free of three.js is what lets the camera be tested
 * without a canvas.
 */

/** How far the target may drift from the world's centre, as a fraction of the world's half-size. */
export const PAN_LIMIT_FACTOR = 0.55;
export const ZOOM_MIN = 0.62;
export const ZOOM_MAX = 2.4;
const ZOOM_PER_WHEEL_UNIT = 0.0012;

/** What the camera needs to know about the world to aim itself. */
export interface CameraView {
  /** The character's position, or null while there is no character. */
  readonly playerWorldX: number | null;
  readonly playerWorldZ: number | null;
  /** World centre of the static map. */
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  /** Half-size of the world: it sets the clamp radius. */
  readonly worldExtent: number;
}

export interface CameraTarget {
  readonly worldX: number;
  readonly worldZ: number;
}

export interface CameraRig {
  /** Wheel zoom, clamped to `ZOOM_MIN`..`ZOOM_MAX`. */
  readonly zoom: number;
  /** How far the player has dragged the camera away from its base, in world metres. */
  readonly panOffsetX: number;
  readonly panOffsetZ: number;
  /** Where the camera should look right now. */
  target(view: CameraView): CameraTarget;
  /** Adds a drag of `deltaX`/`deltaY` pixels to the offset. */
  panByPixels(deltaX: number, deltaY: number, worldPerPixel: number): void;
  /** Applies one wheel event. */
  zoomByWheel(deltaY: number): void;
  /** Applies a pinch: a factor above 1 zooms in, below 1 zooms out. */
  zoomByScale(scale: number): void;
  /** Sets the zoom directly, for re-framing when the world itself changes. */
  setZoom(zoom: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createCameraRig(): CameraRig {
  let zoom = 1;
  let panOffsetX = 0;
  let panOffsetZ = 0;

  return {
    get zoom(): number {
      return zoom;
    },
    get panOffsetX(): number {
      return panOffsetX;
    },
    get panOffsetZ(): number {
      return panOffsetZ;
    },
    target(view: CameraView): CameraTarget {
      // A character is the base the camera follows; with none, the world's centre is what there is
      // to frame. The manual offset is added either way, and drags toward the offset, not toward a
      // stored position, so nothing about the player has to be rewritten to pan the view.
      const baseX = view.playerWorldX ?? view.centerWorldX;
      const baseZ = view.playerWorldZ ?? view.centerWorldZ;
      const limit = view.worldExtent * PAN_LIMIT_FACTOR;
      return {
        worldX: clamp(baseX + panOffsetX, view.centerWorldX - limit, view.centerWorldX + limit),
        worldZ: clamp(baseZ + panOffsetZ, view.centerWorldZ - limit, view.centerWorldZ + limit)
      };
    },
    panByPixels(deltaX: number, deltaY: number, worldPerPixel: number): void {
      // Dragging right pulls the world right, which means the target moves left: the map follows the
      // pointer, exactly as the pre-character camera did.
      panOffsetX -= deltaX * worldPerPixel;
      panOffsetZ -= deltaY * worldPerPixel;
    },
    zoomByWheel(deltaY: number): void {
      zoom = clamp(zoom * Math.exp(deltaY * ZOOM_PER_WHEEL_UNIT), ZOOM_MIN, ZOOM_MAX);
    },
    zoomByScale(scale: number): void {
      // A pinch that reports a nonsense factor (a zero-length finger span, a cancelled pointer)
      // leaves the zoom alone rather than sending it to a clamp rail.
      if (!Number.isFinite(scale) || scale <= 0) return;
      zoom = clamp(zoom * scale, ZOOM_MIN, ZOOM_MAX);
    },
    setZoom(next: number): void {
      zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
    }
  };
}
