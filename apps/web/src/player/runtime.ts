import type { SceneTile } from "../render/view-model";
import type { WorldObstacle } from "../render/world-config";
import { createPlayerCollisionWorld, type TerrainFollow } from "./collision";
import { createPlayerState, PLAYER_SPEED, stepPlayer, type CollisionWorld, type PlayerState } from "./controller";
import { RUN_SPEED_MULTIPLIER } from "./character-input";
import { DESTINATION_PROGRESS_WORLD, DESTINATION_STALL_MS, intentFor, movementVector } from "./intent";
import { NEUTRAL_INPUT, type InputVector } from "./input";

/**
 * The character's lifetime: when it exists, when it moves, and when the loop sleeps.
 *
 * The browser owns frames and the scene owns drawing, so neither is imported here. What is left is
 * the part worth testing: exactly one frame is outstanding at a time, a farm refresh rebuilds the
 * collision world without touching the character, and the loop stops as soon as no movement key is
 * held. `apps/web/src/main.ts` supplies the platform - `requestAnimationFrame`, the keyboard, and the
 * renderer - and nothing else decides when a frame runs.
 *
 * The character is client-local: no position leaves this module.
 */

export interface PlayerRuntimeDeps {
  readonly onTick?: (timestampMs: number, pose: PlayerState) => boolean;
  /** Where a character appears, in world metres: the fixed spawn from the world config. */
  readonly spawn: { readonly worldX: number; readonly worldZ: number };
  /** Height of the character's feet above the ground plane. Cosmetic only. */
  readonly feetY: number;
  /** The movement intent right now, un-normalised, exactly as the input module reports it. */
  readonly readInput: () => InputVector;
  /**
   * Whether the player is asking to run.
   *
   * Optional, and a separate question from the direction: a joystick and a keyboard both produce a
   * direction, and only one of them has a shift key. The host answers it, so the runtime never
   * learns what a keyboard is.
   */
  readonly readRun?: () => boolean;
  /** Called with the new pose whenever it changes, and with null once the character is gone. */
  readonly onPose: (pose: PlayerState | null) => void;
  /** Schedules one frame and calls back with its timestamp. */
  readonly requestFrame: (tick: (timestampMs: number) => void) => void;
  /** Cancels the frame `requestFrame` scheduled, if it has not run yet. */
  readonly cancelFrame: () => void;
}

export interface PlayerRuntime {
  /** True between `start` and `stop`. */
  readonly running: boolean;
  /** The current pose, or null while there is no character. */
  readonly pose: PlayerState | null;
  /** The walk the player queued with "Go", or null. Client-local, never sent anywhere. */
  readonly destination: { readonly worldX: number; readonly worldZ: number } | null;
  /** Creates the character at the spawn and publishes its first pose. */
  start(): void;
  /** Removes the character, cancels any outstanding frame, and publishes null. */
  stop(): void;
  /** Puts a running character back at the spawn. Does nothing while stopped. */
  respawn(): void;
  /** Teleports the local avatar to an already validated presentation spawn. */
  teleport(position: { readonly worldX: number; readonly worldZ: number }): void;
  /**
   * Replaces the collision world from the farm's current rows.
   *
   * Position is never touched: land appearing or disappearing under the character changes where it
   * may go next, not where it is. A character who ends up overlapping something walks out, which is
   * the controller's rule, not a teleport.
   */
  setTiles(tiles: readonly SceneTile[]): void;
  /**
   * Replaces the objects the character walks around: the island's own trees, rocks, props and
   * buildings.
   *
   * Separate from `setTiles` because they move for different reasons - a row can be stored or moved
   * without any tile changing - and both go into the one collision world the controller asks about.
   */
  setObstacles(obstacles: readonly WorldObstacle[]): void;
  /**
   * Replaces the island's own surface: what the character stands on, and what they cannot climb.
   *
   * Separate from the tiles and the obstacles because it is a fact about the *terrain* - it changes
   * when the world does, not when a row is moved - and because a caller that has no terrain (a unit
   * test, a flat test world) may leave it out and keep the flat-plane behaviour.
   */
  setTerrain(terrain: TerrainFollow | null): void;
  /** Asks for a frame, for when movement keys go down. Extra calls while one is pending do nothing. */
  wake(): void;
  /**
   * Queues a walk to a world position, replacing any previous one.
   *
   * The character walks straight at the target through the ordinary controller, so the collision
   * world is still the final word: an unreachable target ends the walk where the character stops
   * rather than looping against an obstacle. A movement key or a new destination cancels it.
   */
  setDestination(destination: { readonly worldX: number; readonly worldZ: number }): void;
  /** Forgets the queued walk. */
  clearDestination(): void;
  /** Advances one frame. Only the platform's frame source calls this. */
  tick(timestampMs: number): void;
}

export function createPlayerRuntime(deps: PlayerRuntimeDeps): PlayerRuntime {
  // An empty farm until the first refresh arrives: the static world still blocks, and a frame that
  // lands before then simply cannot walk into a crop that has not been reported yet.
  let collision: CollisionWorld = createPlayerCollisionWorld([]);
  let tiles: readonly SceneTile[] = [];
  let obstacles: readonly WorldObstacle[] = [];
  let terrain: TerrainFollow | null = null;
  let pose: PlayerState | null = null;
  let destination: { readonly worldX: number; readonly worldZ: number } | null = null;
  // Progress bookkeeping for a queued walk: the closest the character has been, and how long it has
  // been going nowhere. Both are reset by every new destination.
  let destinationClosest = Number.POSITIVE_INFINITY;
  let destinationStalledMs = 0;
  let framePending = false;
  let lastFrameMs: number | null = null;

  function clearDestination(): void {
    destination = null;
    destinationClosest = Number.POSITIVE_INFINITY;
    destinationStalledMs = 0;
  }

  /**
   * Where the character's feet are, given the ground they stand on.
   *
   * The island has hills and the character has to stand on them: the height comes from the same
   * function the ground mesh, the props and the camera use, so a character on a slope is on the
   * slope rather than floating above the flat plane the alpha shipped. `feetY` stays what it always
   * was - how far the model's origin sits above that surface - so the picture does not move by a
   * hair.
   */
  function groundY(x: number, z: number): number {
    return terrain === null ? deps.feetY : terrain.heightAt(x, z) + deps.feetY;
  }

  function publish(next: PlayerState | null): void {
    pose = next;
    deps.onPose(next);
  }

  function schedule(): void {
    if (framePending || pose === null) return;
    framePending = true;
    deps.requestFrame(tick);
  }

  function tick(timestampMs: number): void {
    framePending = false;
    if (pose === null) return;
    const previous = lastFrameMs;
    lastFrameMs = timestampMs;
    // The first frame of a burst has no predecessor, and a restored tab has a huge one; the
    // controller clamps both, so neither can teleport the character.
    const deltaSeconds = previous === null ? 0 : (timestampMs - previous) / 1000;
    const manual = deps.readInput();
    // The player's own hand overrules the walk they queued.
    if (manual.x !== 0 || manual.z !== 0) clearDestination();
    const vector = movementVector(intentFor(manual, destination), pose);
    const before = pose;
    const speed =
      (deps.readRun?.() ?? false) && (manual.x !== 0 || manual.z !== 0)
        ? PLAYER_SPEED * RUN_SPEED_MULTIPLIER
        : PLAYER_SPEED;
    pose = stepPlayer(pose, vector ?? NEUTRAL_INPUT, deltaSeconds, collision, speed);
    // The ground under the character's new position: one height lookup per frame, and only when they
    // actually moved - standing still on a hill does not re-read it sixty times a second.
    if (pose.x !== before.x || pose.z !== before.z) {
      pose = { ...pose, y: groundY(pose.x, pose.z) };
    }
    deps.onPose(pose);
    const visualActive = deps.onTick?.(timestampMs, pose) ?? false;

    if (destination !== null) {
      // A walk ends on arrival, on a step that could not move at all, or after long enough with no
      // progress that it is plainly not going to get there. The last rule is what keeps a
      // destination behind an obstacle from spinning the loop for ever, including when sliding
      // along the obstacle keeps producing tiny movements that never get closer.
      const moved = pose.x !== before.x || pose.z !== before.z;
      const distance = Math.hypot(destination.worldX - pose.x, destination.worldZ - pose.z);
      if (distance <= destinationClosest - DESTINATION_PROGRESS_WORLD) {
        destinationClosest = distance;
        destinationStalledMs = 0;
      } else {
        destinationStalledMs += deltaSeconds * 1000;
      }
      if (vector === null || (!moved && deltaSeconds > 0) || destinationStalledMs >= DESTINATION_STALL_MS) {
        clearDestination();
        // A walk that gave up could have ended on a frame that did move - sliding along a crop for
        // the whole stall window, say. The renderer draws the pose it was last handed, so the
        // character has to be left standing rather than mid-stride for ever.
        if (pose.movementState !== "IDLE") {
          pose = stepPlayer(pose, NEUTRAL_INPUT, 0, collision);
          deps.onPose(pose);
        }
      }
    }

    // A held key - or a walk still under way - keeps the loop awake; with neither, the renderer goes
    // back to drawing on demand.
    if (manual.x !== 0 || manual.z !== 0 || destination !== null || visualActive) {
      schedule();
    } else {
      lastFrameMs = null;
    }
  }

  return {
    get running(): boolean {
      return pose !== null;
    },
    get pose(): PlayerState | null {
      return pose;
    },
    get destination(): { readonly worldX: number; readonly worldZ: number } | null {
      return destination;
    },
    start(): void {
      lastFrameMs = null;
      publish(createPlayerState(deps.spawn, groundY(deps.spawn.worldX, deps.spawn.worldZ)));
    },
    stop(): void {
      if (framePending) {
        deps.cancelFrame();
        framePending = false;
      }
      lastFrameMs = null;
      clearDestination();
      publish(null);
    },
    respawn(): void {
      if (pose === null) return;
      lastFrameMs = null;
      clearDestination();
      publish(createPlayerState(deps.spawn, groundY(deps.spawn.worldX, deps.spawn.worldZ)));
    },
    teleport(next: { readonly worldX: number; readonly worldZ: number }): void {
      if (pose === null || !Number.isFinite(next.worldX) || !Number.isFinite(next.worldZ)) return;
      lastFrameMs = null; clearDestination();
      publish(createPlayerState({ worldX: next.worldX, worldZ: next.worldZ }, groundY(next.worldX, next.worldZ)));
    },
    setTiles(next: readonly SceneTile[]): void {
      tiles = next;
      collision = createPlayerCollisionWorld(tiles, obstacles);
    },
    setObstacles(next: readonly WorldObstacle[]): void {
      obstacles = next;
      collision = createPlayerCollisionWorld(tiles, obstacles);
    },
    setTerrain(next: TerrainFollow | null): void {
      terrain = next;
      collision = createPlayerCollisionWorld(tiles, obstacles, terrain);
      // A character already standing somewhere is put on the new ground rather than left hovering
      // where the flat plane used to be.
      if (pose !== null) {
        const grounded = { ...pose, y: groundY(pose.x, pose.z) };
        pose = grounded;
        deps.onPose(grounded);
      }
    },
    wake(): void {
      schedule();
    },
    setDestination(next: { readonly worldX: number; readonly worldZ: number }): void {
      if (pose === null) return;
      if (!Number.isFinite(next.worldX) || !Number.isFinite(next.worldZ)) return;
      destinationClosest = Number.POSITIVE_INFINITY;
      destinationStalledMs = 0;
      destination = { worldX: next.worldX, worldZ: next.worldZ };
      schedule();
    },
    clearDestination,
    tick
  };
}
