/**
 * The free 3D camera, without three.
 *
 * The island is a place, and a place has to be looked at from wherever the person looking wants to
 * look at it from. The old camera was one fixed direction with a zoom: it could show the field, or it
 * could show the island from a single angle, and nothing else. This one orbits a target point on a
 * yaw, a pitch and a distance, so the whole estate can be inspected from any bearing - and because it
 * is pure arithmetic over five numbers, every rule it has (how far it may pitch, how close it may
 * come, how a drag on screen becomes a movement on the ground, what happens when the ground rises to
 * meet it) is a unit test rather than something to discover by dragging.
 *
 * Two design rules, both from the brief:
 *
 * * **Left click is never the camera.** Selecting a cell and sending the character to it is the
 *   game's primary interaction; the camera is rotated with the right button and panned with the
 *   middle one, so a player pointing at the world is never also moving the view.
 * * **The camera never fights the player.** It does not lock to the character: it stays where the
 *   player put it and moves only when asked - by a drag, by the wheel, by a pan, or by the recenter
 *   control, which glides rather than cutting.
 */

/** Yaw wraps freely; pitch stops well short of the horizon and of straight down. */
export const MIN_PITCH = (25 * Math.PI) / 180;
export const MAX_PITCH = (72 * Math.PI) / 180;

/**
 * Where the camera starts looking from, before the player has touched anything.
 *
 * The bearing is the old fixed view: the eye sat south-east of what it framed, so the harbour road,
 * the settlement, and the field were all in shot at once. Keeping it as the default means a player
 * who never drags sees the island the way the previous pass composed it, and one who does drag gets
 * their own bearing back the moment they press recenter.
 */
export const DEFAULT_CAMERA_YAW = Math.PI / 4;
/** Just under the maximum pitch: high enough to read the plan, low enough to keep the horizon. */
export const DEFAULT_CAMERA_PITCH = (47 * Math.PI) / 180;
/** The opening distance: the farm, the settlement, and the way to the harbour, in one frame. */
export const DEFAULT_CAMERA_DISTANCE = 52;

/**
 * What a mouse button means to the camera.
 *
 * The arbitration lives here, apart from the canvas, so "left click belongs to the world" is a rule
 * with a name rather than a `case 0` buried in an event handler. Middle drag pans, right drag rotates
 * (the convention every 3D editor uses), and anything else is left alone.
 */
export type CameraPointerRole = "SELECT" | "PAN" | "ROTATE" | "IGNORE";

export function pointerRoleForButton(button: number): CameraPointerRole {
  switch (button) {
    case 0:
      return "SELECT";
    case 1:
      return "PAN";
    case 2:
      return "ROTATE";
    default:
      return "IGNORE";
  }
}

/**
 * How far the camera may sit from what it is looking at, in world metres.
 *
 * The near end is the farming view: close enough that a crop and the character are legible. The far
 * end is the estate: the island is about 118 metres across, so a little over 120 metres frames all of
 * it. A world may raise its own ceiling through `zoomDistanceRangeFor`, because a larger island needs
 * a wider view and that is a property of the island rather than a constant.
 */
export const MIN_DISTANCE = 7;
export const MAX_DISTANCE = 125;
/** The camera's vertical field of view, in degrees. The pan maths and the renderer share this one. */
export const CAMERA_FOV_DEGREES = 45;
/** The viewport height the pixel-to-metre conversion assumes when the caller has no better number. */
export const REFERENCE_VIEWPORT_HEIGHT = 900;
/** How fast the wheel changes the *requested* distance, per wheel unit. */
const ZOOM_PER_WHEEL_UNIT = 0.0016;
/** How fast the camera catches up with what it was asked for, per second. */
const ZOOM_DAMPING_PER_SECOND = 9;
const TARGET_DAMPING_PER_SECOND = 7;
/** How much of a pixel drag turns into rotation, in radians. */
const ROTATION_PER_PIXEL = 0.006;
/** The camera's own height above the ground it must never sink below. */
export const CAMERA_GROUND_CLEARANCE = 1.6;
/** The sea's surface: the camera must stay above this wherever the ground is beneath it. */
export const SEA_SURFACE_Y = -0.62;

export interface OrbitCameraState {
  /** Radians about Y. Unrestricted: it wraps. */
  readonly yaw: number;
  /** Radians above the horizon, clamped to `MIN_PITCH`..`MAX_PITCH`. */
  readonly pitch: number;
  /** Distance from the target to the eye, in world metres. */
  readonly distance: number;
  readonly targetX: number;
  readonly targetZ: number;
}

export interface OrbitCameraOptions {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly targetX: number;
  readonly targetZ: number;
  /** How far the target may be moved from where the world put it, in world metres. */
  readonly panLimit: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export interface OrbitCameraRig {
  readonly state: OrbitCameraState;
  /** Where the camera has been asked to go: it glides toward this rather than snapping. */
  readonly requestedDistance: number;
  readonly distanceRange: { readonly min: number; readonly max: number };
  /** Whether anything is still moving, so the renderer knows to keep drawing. */
  isSettling(): boolean;
  rotate(deltaYaw: number, deltaPitch: number): void;
  /** One wheel event: a positive `deltaY` (scrolling away) pulls the camera back. */
  zoomByWheel(deltaY: number): void;
  /** A pinch: a factor above 1 pulls the camera back, below 1 brings it in. */
  zoomByScale(scale: number): void;
  panByScreen(deltaX: number, deltaY: number, viewportHeight: number): void;
  /** Puts the target somewhere without a glide: how the camera first frames a world it has not seen. */
  moveTargetTo(worldX: number, worldZ: number): void;
  /** Starts a glide toward a point, used by the recenter control. */
  recenterTo(worldX: number, worldZ: number): void;
  /**
   * Sets how close and how far the camera may be.
   *
   * A property of the world rather than of the rig: a bigger island needs a wider view, and the
   * caller is the one that knows how big the island is. The current distance and the requested
   * distance are both clamped, so shrinking the range can never leave the camera stranded outside it.
   */
  setDistanceRange(min: number, max: number): void;
  /** Where the camera sits right now, given the ground under it and what is in the way. */
  eye(
    heightAt: (worldX: number, worldZ: number) => number,
    blockedAt?: (worldX: number, worldZ: number) => boolean
  ): { readonly x: number; readonly y: number; readonly z: number };
  /** One frame: glides the requested distance and the recenter target into place. */
  update(deltaMs: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keeps a yaw inside one turn, so a long drag cannot grow the number without bound. */
export function wrapYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const turn = Math.PI * 2;
  return yaw - Math.floor((yaw + Math.PI) / turn) * turn;
}

export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return MIN_PITCH;
  return clamp(pitch, MIN_PITCH, MAX_PITCH);
}

/** The rotation a pointer drag means. Kept separate so the input layer owns no maths. */
export function rotationForDrag(deltaX: number, deltaY: number): { readonly yaw: number; readonly pitch: number } {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return { yaw: 0, pitch: 0 };
  // Dragging right turns the view right; dragging up lifts the camera toward the horizon.
  return { yaw: -deltaX * ROTATION_PER_PIXEL, pitch: deltaY * ROTATION_PER_PIXEL };
}

/**
 * The ground-plane movement a screen drag means, given how the camera is turned.
 *
 * Screen-up is "away from the camera", so a pan is rotated by the camera's own yaw: the same drag
 * moves the view north when the camera faces north and east when it faces east. This is the whole of
 * "do not use fixed world north", and it is a pure function so the rule can be tested.
 */
export function panOffsetFor(
  yaw: number,
  deltaX: number,
  deltaY: number,
  worldPerPixel: number
): { readonly x: number; readonly z: number } {
  // The eye sits at target + (sin yaw, cos yaw), so screen-right is (cos yaw, -sin yaw) and
  // screen-forward, projected onto the ground, is (-sin yaw, -cos yaw).
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  // Dragging right pulls the world right, which moves the target left; dragging up moves it away.
  const alongRight = -deltaX * worldPerPixel;
  const alongForward = deltaY * worldPerPixel;
  return {
    x: rightX * alongRight + forwardX * alongForward,
    z: rightZ * alongRight + forwardZ * alongForward
  };
}

/** Metres per pixel on the ground at a given distance, so a drag moves what it looks like it moves. */
export function worldPerPixelAt(distance: number, viewportHeight: number): number {
  const height = viewportHeight > 0 ? viewportHeight : REFERENCE_VIEWPORT_HEIGHT;
  return (2 * distance * Math.tan((CAMERA_FOV_DEGREES / 2) * (Math.PI / 180))) / height;
}

/**
 * The distance the camera may actually sit at, given what is in the way.
 *
 * Two rules, in order, and the difference between them is the difference between "the camera cannot
 * see" and "the camera cannot be":
 *
 * * **The ground.** Walked outward from the target, the first point that would be under the terrain
 *   or under the sea stops the camera short of it. A camera inside a hill is a black frame.
 * * **Solids.** The eye may look *across* a building - an estate view has to clear a barn on the far
 *   side of the island to show the harbour beyond it - but it may not end up *inside* one. So the
 *   distance is walked back in until the eye itself is clear.
 *
 * Cheap, deterministic, and enough: the brief asks for a terrain clamp and a shortened distance
 * rather than a physics system.
 */
export function unobstructedDistance(
  target: { readonly worldX: number; readonly worldY: number; readonly worldZ: number },
  direction: { readonly x: number; readonly y: number; readonly z: number },
  requested: number,
  heightAt: (worldX: number, worldZ: number) => number,
  blockedAt: (worldX: number, worldZ: number) => boolean,
  steps = 12
): number {
  const step = requested / steps;
  let allowed = requested;
  for (let index = 1; index <= steps; index += 1) {
    const distance = step * index;
    const x = target.worldX + direction.x * distance;
    const y = target.worldY + direction.y * distance;
    const z = target.worldZ + direction.z * distance;
    const ground = Math.max(heightAt(x, z), SEA_SURFACE_Y);
    if (y < ground + CAMERA_GROUND_CLEARANCE) {
      allowed = step * (index - 1);
      break;
    }
  }
  while (allowed > MIN_DISTANCE * 0.5) {
    const x = target.worldX + direction.x * allowed;
    const z = target.worldZ + direction.z * allowed;
    if (!blockedAt(x, z)) break;
    allowed -= step;
  }
  return Math.max(MIN_DISTANCE * 0.5, allowed);
}

/**
 * The distance range for a world, from the size of the island.
 *
 * The ceiling is the island's own half-extent plus a margin, so the estate view frames the whole
 * island on any island rather than only on the one that happened to ship.
 */
export function zoomDistanceRangeFor(islandExtent: number): { readonly min: number; readonly max: number } {
  const extent = Number.isFinite(islandExtent) && islandExtent > 0 ? islandExtent : MIN_DISTANCE;
  return { min: MIN_DISTANCE, max: clamp(extent * 2.25, MIN_DISTANCE * 2, MAX_DISTANCE) };
}

/** Where the camera sits: the eye position for a yaw, a pitch, a target and a distance. */
export function orbitEye(
  state: { readonly yaw: number; readonly pitch: number },
  target: { readonly x: number; readonly y: number; readonly z: number },
  distance: number
): { readonly x: number; readonly y: number; readonly z: number } {
  const horizontal = Math.cos(state.pitch);
  return {
    x: target.x + Math.sin(state.yaw) * horizontal * distance,
    y: target.y + Math.sin(state.pitch) * distance,
    z: target.z + Math.cos(state.yaw) * horizontal * distance
  };
}

export function createOrbitCamera(options: OrbitCameraOptions): OrbitCameraRig {
  let homeX = options.targetX;
  let homeZ = options.targetZ;
  let minDistance = options.minDistance;
  let maxDistance = options.maxDistance;
  let yaw = wrapYaw(options.yaw);
  let pitch = clampPitch(options.pitch);
  let requestedDistance = clamp(options.distance, minDistance, maxDistance);
  let distance = requestedDistance;
  let targetX = homeX;
  let targetZ = homeZ;
  let recenterX: number | null = null;
  let recenterZ: number | null = null;

  return {
    get state(): OrbitCameraState {
      return { yaw, pitch, distance, targetX, targetZ };
    },
    get requestedDistance(): number {
      return requestedDistance;
    },
    get distanceRange(): { readonly min: number; readonly max: number } {
      return { min: minDistance, max: maxDistance };
    },
    isSettling(): boolean {
      return Math.abs(requestedDistance - distance) > 0.01 || recenterX !== null || recenterZ !== null;
    },
    rotate(deltaYaw: number, deltaPitch: number): void {
      if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) return;
      yaw = wrapYaw(yaw + deltaYaw);
      pitch = clampPitch(pitch + deltaPitch);
    },
    zoomByWheel(deltaY: number): void {
      if (!Number.isFinite(deltaY)) return;
      requestedDistance = clamp(requestedDistance * Math.exp(deltaY * ZOOM_PER_WHEEL_UNIT), minDistance, maxDistance);
    },
    zoomByScale(scale: number): void {
      if (!Number.isFinite(scale) || scale <= 0) return;
      requestedDistance = clamp(requestedDistance * scale, minDistance, maxDistance);
    },
    panByScreen(deltaX: number, deltaY: number, viewportHeight: number): void {
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
      const offset = panOffsetFor(yaw, deltaX, deltaY, worldPerPixelAt(distance, viewportHeight));
      const limit = options.panLimit;
      targetX = clamp(targetX + offset.x, homeX - limit, homeX + limit);
      targetZ = clamp(targetZ + offset.z, homeZ - limit, homeZ + limit);
      // A pan is the player taking the camera somewhere: the recenter glide stops.
      recenterX = null;
      recenterZ = null;
    },
    moveTargetTo(worldX: number, worldZ: number): void {
      if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
      targetX = worldX;
      targetZ = worldZ;
      // Wherever the world first put the camera *is* home: both the pan clamp and the recenter clamp
      // are measured from here, so a world that frames its own middle gets a camera that stays around
      // that middle rather than around the coordinate origin.
      homeX = worldX;
      homeZ = worldZ;
      recenterX = null;
      recenterZ = null;
    },
    recenterTo(worldX: number, worldZ: number): void {
      if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
      recenterX = clamp(worldX, homeX - options.panLimit, homeX + options.panLimit);
      recenterZ = clamp(worldZ, homeZ - options.panLimit, homeZ + options.panLimit);
    },
    setDistanceRange(min: number, max: number): void {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return;
      minDistance = min;
      maxDistance = max;
      requestedDistance = clamp(requestedDistance, minDistance, maxDistance);
      distance = clamp(distance, minDistance, maxDistance);
    },
    eye(heightAt, blockedAt = () => false) {
      const targetY = Math.max(heightAt(targetX, targetZ), SEA_SURFACE_Y) + 1.2;
      const direction = {
        x: Math.sin(yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: Math.cos(yaw) * Math.cos(pitch)
      };
      const allowed = unobstructedDistance(
        { worldX: targetX, worldY: targetY, worldZ: targetZ },
        direction,
        distance,
        heightAt,
        blockedAt
      );
      const position = orbitEye({ yaw, pitch }, { x: targetX, y: targetY, z: targetZ }, Math.min(distance, allowed));
      // The last guarantee, whatever the terrain does between the samples: the eye is never under the
      // ground and never under the sea. The roll-back above is the *preferred* shortening; this is the
      // floor the brief actually requires, and it holds even on a cliff.
      const ground = Math.max(heightAt(position.x, position.z), SEA_SURFACE_Y);
      return { x: position.x, y: Math.max(position.y, ground + CAMERA_GROUND_CLEARANCE), z: position.z };
    },
    update(deltaMs: number): void {
      const seconds = clamp(deltaMs, 0, 250) / 1000;
      const zoomStep = 1 - Math.exp(-ZOOM_DAMPING_PER_SECOND * seconds);
      distance += (requestedDistance - distance) * zoomStep;
      if (Math.abs(requestedDistance - distance) < 0.01) distance = requestedDistance;
      if (recenterX !== null && recenterZ !== null) {
        const step = 1 - Math.exp(-TARGET_DAMPING_PER_SECOND * seconds);
        targetX += (recenterX - targetX) * step;
        targetZ += (recenterZ - targetZ) * step;
        if (Math.hypot(recenterX - targetX, recenterZ - targetZ) < 0.05) {
          targetX = recenterX;
          targetZ = recenterZ;
          recenterX = null;
          recenterZ = null;
        }
      }
    }
  };
}
