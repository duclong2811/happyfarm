import { CAMERA_FOV_DEGREES, orbitEye, rotationForDrag } from "./camera";

/**
 * The third-person camera: the estate rig's maths, aimed at a character instead of at the island.
 *
 * It orbits a point just above the player's shoulders on the same yaw/pitch/distance vocabulary the
 * estate camera uses, so the two views agree about what turning right means and a switch between them
 * is a move in one continuous space. What is different is the scale and the rules: the target follows
 * the player every frame, the distance is a couple of metres rather than the whole island, the pitch
 * may dip slightly below the shoulder to look up, and the eye is kept out of both the ground and the
 * buildings between it and the player.
 *
 * Pure arithmetic over a handful of numbers - the eye is a function of the state, the target and two
 * world questions - so every rule here is a unit test rather than something to discover by dragging.
 */

/**
 * How far the camera may sit behind the character.
 *
 * The near end is close enough to read the character's back without being inside their head; the far
 * end is just past arm's length for a 1.6 m character - enough to see the yard they are standing in,
 * not enough to become an estate camera. Tuned against the world's own numbers: a tile is 1.08 m, a
 * tree is 3-4 m, the player is 1.6 m.
 */
export const MIN_CHARACTER_DISTANCE = 2.2;
export const MAX_CHARACTER_DISTANCE = 9;
export const DEFAULT_CHARACTER_DISTANCE = 4.6;

/**
 * Where the camera may sit vertically, in radians above the shoulder.
 *
 * A little below the shoulder, so a player can look up at the mill; never past vertical, so the
 * camera cannot flip over the character; and never steep enough to become a top-down view, which is
 * what the estate camera is for.
 */
export const MIN_CHARACTER_PITCH = -0.2;
export const MAX_CHARACTER_PITCH = 1.2;
export const DEFAULT_CHARACTER_PITCH = 0.2;

/**
 * How high above the feet the camera looks, as a fraction of the character's height.
 *
 * Upper torso rather than the feet: a camera aimed at the ground under the character looks down the
 * back of their head, and one aimed at their centre frames the shoulders. See `characterTarget`.
 */
export const CHARACTER_TARGET_HEIGHT_FRACTION = 0.65;

/**
 * A moderately wider lens than the estate camera's 45 degrees.
 *
 * At shoulder height a 45-degree frame reads as a telescope; 52 degrees puts the character and the
 * ground they are about to walk on in one shot without the fisheye a wider lens brings.
 */
export const CHARACTER_FOV_DEGREES = 52;

/** The camera's own clearance above whatever ground is beneath it, as it orbits. */
export const CHARACTER_GROUND_CLEARANCE = 0.55;

export interface CharacterCameraState {
  /** Radians about Y: where the camera is, in the estate camera's own convention. */
  readonly yaw: number;
  /** Radians above the shoulder, clamped to the character range. */
  readonly pitch: number;
  /** Distance from the shoulder to the eye, in world metres. */
  readonly distance: number;
}

export interface CharacterCameraOptions {
  readonly yaw: number;
  readonly pitch?: number;
  readonly distance?: number;
  readonly fov?: number;
}

export interface CharacterCameraRig {
  readonly state: CharacterCameraState;
  /** Where the camera has been asked to go: it glides toward this rather than snapping. */
  readonly requestedDistance: number;
  readonly fov: number;
  /** Whether anything is still moving, so the renderer knows to keep drawing. */
  isSettling(): boolean;
  rotate(deltaYaw: number, deltaPitch: number): void;
  /** The rotation a pointer drag means, in this camera's convention. */
  rotateByDrag(deltaX: number, deltaY: number): void;
  /** One wheel event: a positive `deltaY` (scrolling away) pulls the camera back. */
  zoomByWheel(deltaY: number): void;
  /** A pinch: a factor above 1 pulls the camera back, below 1 brings it in. */
  zoomByScale(scale: number): void;
  /** Where the eye sits right now, given where the player is and what is in the way. */
  eye(
    target: { readonly x: number; readonly y: number; readonly z: number },
    heightAt: (worldX: number, worldZ: number) => number,
    blockedAt?: (worldX: number, worldZ: number) => boolean
  ): { readonly x: number; readonly y: number; readonly z: number };
  /** One frame: glides the requested distance into place. */
  update(deltaMs: number): void;
  /**
   * Puts the camera at a bearing and a distance without a glide.
   *
   * How the mode switch *starts*: the character camera takes the estate camera's own bearing, so the
   * flight is a descent rather than a spin, and the flight itself is what carries the rest.
   */
  reset(options: { readonly yaw: number; readonly pitch?: number; readonly distance?: number }): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampCharacterPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DEFAULT_CHARACTER_PITCH;
  return clamp(pitch, MIN_CHARACTER_PITCH, MAX_CHARACTER_PITCH);
}

export function clampCharacterDistance(distance: number): number {
  if (!Number.isFinite(distance)) return DEFAULT_CHARACTER_DISTANCE;
  return clamp(distance, MIN_CHARACTER_DISTANCE, MAX_CHARACTER_DISTANCE);
}

/**
 * What the camera looks at: the character's upper torso, not their feet.
 *
 * The pose's `worldY` is the feet, so the height fraction is applied to the character's own height
 * rather than hard-coded - a taller model moves the aim up with it.
 */
export function characterTarget(
  player: { readonly worldX: number; readonly worldY: number; readonly worldZ: number },
  characterHeightWorld: number
): { readonly x: number; readonly y: number; readonly z: number } {
  const height = Number.isFinite(characterHeightWorld) && characterHeightWorld > 0 ? characterHeightWorld : 1.6;
  return {
    x: player.worldX,
    y: player.worldY + height * CHARACTER_TARGET_HEIGHT_FRACTION,
    z: player.worldZ
  };
}

/**
 * Where the eye sits for a third-person state, given the world.
 *
 * Two clamps, in the order that matters: the ground between the shoulder and the eye shortens the
 * distance (a camera inside a hill is a black frame), and buildings between them shorten it too (a
 * camera inside a barn shows nothing at all). The last line is the floor the brief actually
 * requires - the eye is never under the terrain, whatever the samples did - and it holds even when
 * the character is standing in a hollow.
 */
export function characterEye(
  state: CharacterCameraState,
  target: { readonly x: number; readonly y: number; readonly z: number },
  distance: number,
  heightAt: (worldX: number, worldZ: number) => number,
  blockedAt: (worldX: number, worldZ: number) => boolean,
  steps = 10
): { readonly x: number; readonly y: number; readonly z: number } {
  const direction = {
    x: Math.sin(state.yaw) * Math.cos(state.pitch),
    y: Math.sin(state.pitch),
    z: Math.cos(state.yaw) * Math.cos(state.pitch)
  };
  const step = distance / steps;
  let allowed = distance;
  // The ground first: the first sample that would put the eye under the terrain stops the camera just
  // short of it. Walked outward from the shoulder, so a hill between the player and the camera brings
  // the camera in rather than burying it.
  for (let index = 1; index <= steps; index += 1) {
    const at = step * index;
    const y = target.y + direction.y * at;
    if (y < heightAt(target.x + direction.x * at, target.z + direction.z * at) + CHARACTER_GROUND_CLEARANCE) {
      allowed = step * (index - 1);
      break;
    }
  }
  // Then the solids, on the same walk: the first sample that is inside a building stops the camera
  // just short of it. Sampling the whole ray rather than only the far end is the difference between
  // "the camera may not *be* inside a barn" and "the camera may not see through one" - and at
  // shoulder scale the second is what the player notices, because the barn is right in front of them.
  for (let index = 1; index <= steps; index += 1) {
    const at = step * index;
    if (at >= allowed) break;
    if (blockedAt(target.x + direction.x * at, target.z + direction.z * at)) {
      allowed = step * (index - 1);
      break;
    }
  }
  const position = orbitEye(state, target, Math.max(MIN_CHARACTER_DISTANCE * 0.5, allowed));
  // The last guarantee, whatever the samples did between them: the eye is never under the ground.
  const ground = heightAt(position.x, position.z);
  return { x: position.x, y: Math.max(position.y, ground + CHARACTER_GROUND_CLEARANCE), z: position.z };
}

export function createCharacterCameraRig(options: CharacterCameraOptions): CharacterCameraRig {
  let yaw = Number.isFinite(options.yaw) ? options.yaw : 0;
  let pitch = clampCharacterPitch(options.pitch ?? DEFAULT_CHARACTER_PITCH);
  let requestedDistance = clampCharacterDistance(options.distance ?? DEFAULT_CHARACTER_DISTANCE);
  let distance = requestedDistance;
  const fov = Number.isFinite(options.fov ?? NaN) ? (options.fov as number) : CHARACTER_FOV_DEGREES;

  return {
    get state(): CharacterCameraState {
      return { yaw, pitch, distance };
    },
    get requestedDistance(): number {
      return requestedDistance;
    },
    get fov(): number {
      return fov;
    },
    isSettling(): boolean {
      return Math.abs(requestedDistance - distance) > 0.01;
    },
    rotate(deltaYaw: number, deltaPitch: number): void {
      if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) return;
      yaw += deltaYaw;
      pitch = clampCharacterPitch(pitch + deltaPitch);
    },
    rotateByDrag(deltaX: number, deltaY: number): void {
      const turn = rotationForDrag(deltaX, deltaY);
      // The drag maths is the estate camera's, and so is the meaning of the result: dragging right
      // turns the view right, dragging down lifts the camera.
      yaw += turn.yaw;
      pitch = clampCharacterPitch(pitch + turn.pitch * 0.6);
    },
    zoomByWheel(deltaY: number): void {
      if (!Number.isFinite(deltaY)) return;
      // A gentler rate than the estate camera's: the same wheel notch is a few centimetres here and a
      // few metres there, and what feels right at estate scale overshoots at shoulder scale.
      requestedDistance = clampCharacterDistance(requestedDistance * Math.exp(deltaY * 0.0009));
    },
    zoomByScale(scale: number): void {
      if (!Number.isFinite(scale) || scale <= 0) return;
      requestedDistance = clampCharacterDistance(requestedDistance * scale);
    },
    eye(target, heightAt, blockedAt = () => false) {
      return characterEye({ yaw, pitch, distance }, target, distance, heightAt, blockedAt);
    },
    update(deltaMs: number): void {
      const seconds = clamp(deltaMs, 0, 250) / 1000;
      const step = 1 - Math.exp(-9 * seconds);
      distance += (requestedDistance - distance) * step;
      if (Math.abs(requestedDistance - distance) < 0.01) distance = requestedDistance;
    },
    reset(next: { readonly yaw: number; readonly pitch?: number; readonly distance?: number }): void {
      if (!Number.isFinite(next.yaw)) return;
      yaw = next.yaw;
      pitch = clampCharacterPitch(next.pitch ?? DEFAULT_CHARACTER_PITCH);
      requestedDistance = clampCharacterDistance(next.distance ?? DEFAULT_CHARACTER_DISTANCE);
      distance = requestedDistance;
    }
  };
}

/** The estate camera's own field of view, re-exported so a caller picks from one place. */
export const ESTATE_FOV_DEGREES = CAMERA_FOV_DEGREES;
