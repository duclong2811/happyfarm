import type { SceneTile } from "../render/view-model";
import { createPlayerCollisionWorld } from "./collision";
import { createPlayerState, stepPlayer, type CollisionWorld, type PlayerState } from "./controller";
import type { InputVector } from "./input";

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
  /** Where a character appears, in world metres: the fixed spawn from the world config. */
  readonly spawn: { readonly worldX: number; readonly worldZ: number };
  /** Height of the character's feet above the ground plane. Cosmetic only. */
  readonly feetY: number;
  /** The movement intent right now, un-normalised, exactly as the input module reports it. */
  readonly readInput: () => InputVector;
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
  /** Creates the character at the spawn and publishes its first pose. */
  start(): void;
  /** Removes the character, cancels any outstanding frame, and publishes null. */
  stop(): void;
  /** Puts a running character back at the spawn. Does nothing while stopped. */
  respawn(): void;
  /**
   * Replaces the collision world from the farm's current rows.
   *
   * Position is never touched: land appearing or disappearing under the character changes where it
   * may go next, not where it is. A character who ends up overlapping something walks out, which is
   * the controller's rule, not a teleport.
   */
  setTiles(tiles: readonly SceneTile[]): void;
  /** Asks for a frame, for when movement keys go down. Extra calls while one is pending do nothing. */
  wake(): void;
  /** Advances one frame. Only the platform's frame source calls this. */
  tick(timestampMs: number): void;
}

export function createPlayerRuntime(deps: PlayerRuntimeDeps): PlayerRuntime {
  // An empty farm until the first refresh arrives: the static world still blocks, and a frame that
  // lands before then simply cannot walk into a crop that has not been reported yet.
  let collision: CollisionWorld = createPlayerCollisionWorld([]);
  let pose: PlayerState | null = null;
  let framePending = false;
  let lastFrameMs: number | null = null;

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
    const input = deps.readInput();
    pose = stepPlayer(pose, input, deltaSeconds, collision);
    deps.onPose(pose);
    // A held key keeps the loop awake; releasing it lets the renderer go back to drawing on demand.
    if (input.x !== 0 || input.z !== 0) {
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
    start(): void {
      lastFrameMs = null;
      publish(createPlayerState(deps.spawn, deps.feetY));
    },
    stop(): void {
      if (framePending) {
        deps.cancelFrame();
        framePending = false;
      }
      lastFrameMs = null;
      publish(null);
    },
    respawn(): void {
      if (pose === null) return;
      lastFrameMs = null;
      publish(createPlayerState(deps.spawn, deps.feetY));
    },
    setTiles(tiles: readonly SceneTile[]): void {
      collision = createPlayerCollisionWorld(tiles);
    },
    wake(): void {
      schedule();
    },
    tick
  };
}
