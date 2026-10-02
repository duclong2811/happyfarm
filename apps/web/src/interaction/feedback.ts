/**
 * The shape of "something just happened" in character view.
 *
 * A harvest used to be an API call with a status line. The difference between that and *gameplay* is a
 * short, readable beat: the character moves, something rises from the crop, and the number that lands
 * is the number the server actually paid. All three are timing rules, so they live here as arithmetic
 * rather than as numbers sprinkled through the renderer and the HUD.
 *
 * Nothing here decides anything about the world: the gesture begins the moment an interaction is
 * accepted locally, and the reward pop only exists once the server has answered.
 */

/** How long the character's harvest gesture takes, in milliseconds. */
export const HARVEST_GESTURE_DURATION_MS = 320;

/**
 * How far the character bends, in radians.
 *
 * A bow toward what they are picking - about thirteen degrees, which reads at third-person distance
 * without looking like a fall. The asset has no harvest clip (`PLAYER_CHARACTER_ASSET.animations` is
 * idle/walk/run), so this is a procedural gesture applied to the avatar's outer group: the walk, the
 * run and the mixer are untouched.
 */
export const HARVEST_GESTURE_PEAK_RADIANS = 0.22;

/**
 * The bend at a moment in the gesture: out and back, exactly zero at both ends.
 *
 * A half sine, so the movement starts gently, peaks in the middle and returns without a snap. Outside
 * the gesture it is exactly zero, which is what lets the caller stop applying it without a special case.
 */
export function harvestGestureBend(
  elapsedMs: number,
  durationMs: number = HARVEST_GESTURE_DURATION_MS,
  peakRadians: number = HARVEST_GESTURE_PEAK_RADIANS
): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0;
  return Math.sin((elapsedMs / durationMs) * Math.PI) * peakRadians;
}

/** How long the reward pop stays on screen, in milliseconds. */
export const REWARD_POP_DURATION_MS = 1100;

/**
 * The identity of one reward pop, so the HUD can tell "a new thing was harvested" from "the same thing
 * was re-rendered" without keeping a queue. Two harvests of the same item differ by their sequence.
 */
export function rewardPopKey(sequence: number, itemDefinitionId: string): string {
  return `${String(sequence)}:${itemDefinitionId}`;
}
