/**
 * Whether the estate camera is following the player or has been taken over by hand.
 *
 * The estate view is a designer's camera: it orbits the whole farm and stays where the player put it.
 * That was the right rule when the farm *was* the game, and it stopped being right the moment a
 * character could walk across the island - the character walks off screen while the camera watches
 * the field they left. V13.6.3 adds following, and this module is the whole of the rule that decides
 * which of the two behaviours the camera is in.
 *
 * The rule is deliberately a state machine with a clock rather than a set of booleans scattered
 * through the renderer, because the interesting cases are all *transitions*:
 *
 * * Tapping, dragging or orbiting the estate camera is the player saying "I am looking at something".
 *   That is FREE: the camera stays exactly where it was left, and the player's own walking does not
 *   drag it away from what they were inspecting.
 * * But a player who pans, then walks, then wonders why the camera is not following should not have to
 *   find a button. Once they have let go of the camera for a moment, movement pulls it back to
 *   FOLLOW - which is the "preserve FREE briefly" rule in the brief, expressed as one timestamp
 *   rather than a timer per input.
 * * Recentring is the player asking to be followed again, so it restores FOLLOW immediately.
 *
 * Zooming is deliberately *not* a manual camera move: pulling the lens back does not mean "stop
 * looking at my farmer", and a player who zooms out while walking should keep being followed.
 *
 * Pure: no renderer, no clock of its own (the caller passes the time), and every rule is a unit test.
 */

export type EstateFollowBehaviour = "FOLLOW" | "FREE";

export interface EstateFollowState {
  readonly behaviour: EstateFollowBehaviour;
  /**
   * When the player last moved the camera by hand, in milliseconds on the caller's clock, or null
   * when they never have. Only meaningful while FREE, and cleared the moment FOLLOW resumes.
   */
  readonly lastManualInputMs: number | null;
}

/**
 * How long a hand-placed camera is left alone before walking pulls it back to the player.
 *
 * Long enough that a pan and a step are one gesture ("let me look over there" then "now walk"), short
 * enough that a player who pans and then walks is not stranded. Two seconds is roughly the time it
 * takes to sweep the camera across the farm and see what is there.
 */
export const FOLLOW_RESUME_DELAY_MS = 2000;

/**
 * The camera starts attached to the player.
 *
 * A first session has no camera position to protect, and the character is where the game is.
 */
export const INITIAL_ESTATE_FOLLOW: EstateFollowState = { behaviour: "FOLLOW", lastManualInputMs: null };

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** The player has taken the camera by hand: it stays where they leave it. */
export function estateFollowAfterManualInput(
  state: EstateFollowState,
  nowMs: number
): EstateFollowState {
  return { behaviour: "FREE", lastManualInputMs: finiteOrNull(nowMs) ?? state.lastManualInputMs };
}

/**
 * The *game* aimed the camera at a cell - entering placement, picking an object up.
 *
 * That is not the player panning, but it is the same intent: the camera has been deliberately placed
 * somewhere, and the player walking away must not drag it off the thing they are working on.
 */
export function estateFollowAfterFocus(state: EstateFollowState, nowMs: number): EstateFollowState {
  return estateFollowAfterManualInput(state, nowMs);
}

/** Recentring: back to following the player, immediately and without a delay. */
export function estateFollowRecenter(state: EstateFollowState): EstateFollowState {
  return state.behaviour === "FOLLOW" && state.lastManualInputMs === null
    ? state
    : { behaviour: "FOLLOW", lastManualInputMs: null };
}

/**
 * Movement may re-attach a free camera, once the player has stopped touching it.
 *
 * Returns the *same object* when nothing changes, so a caller can compare references and skip work.
 * That is also how the renderer avoids a HUD write per frame.
 */
export function estateFollowForMovement(
  state: EstateFollowState,
  nowMs: number,
  playerMoving: boolean
): EstateFollowState {
  if (!playerMoving || state.behaviour === "FOLLOW") return state;
  const last = state.lastManualInputMs;
  if (last === null || !Number.isFinite(nowMs)) {
    return { behaviour: "FOLLOW", lastManualInputMs: null };
  }
  if (nowMs - last < FOLLOW_RESUME_DELAY_MS) return state;
  return { behaviour: "FOLLOW", lastManualInputMs: null };
}

export function estateFollowsPlayer(state: EstateFollowState): boolean {
  return state.behaviour === "FOLLOW";
}
