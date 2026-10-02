import { describe, expect, it } from "vitest";
import {
  FOLLOW_RESUME_DELAY_MS,
  INITIAL_ESTATE_FOLLOW,
  estateFollowAfterFocus,
  estateFollowAfterManualInput,
  estateFollowForMovement,
  estateFollowRecenter,
  estateFollowsPlayer,
  type EstateFollowState
} from "../../apps/web/src/render/estate-follow";

/**
 * The rule that decides whether the estate camera is on the player or where the player left it.
 *
 * The interesting cases are the transitions, not the two states: a pan has to survive the walk that
 * follows it, a walk after a pause has to pull the camera back, and asking to be followed has to work
 * immediately and unconditionally. All three are pure arithmetic over one timestamp.
 */

const HAND_PLACED: EstateFollowState = estateFollowAfterManualInput(INITIAL_ESTATE_FOLLOW, 10_000);

describe("the estate camera's follow rule", () => {
  it("starts attached to the player", () => {
    expect(INITIAL_ESTATE_FOLLOW.behaviour).toBe("FOLLOW");
    expect(INITIAL_ESTATE_FOLLOW.lastManualInputMs).toBeNull();
    expect(estateFollowsPlayer(INITIAL_ESTATE_FOLLOW)).toBe(true);
  });

  it("hands the camera to the player the moment they move it by hand", () => {
    const free = estateFollowAfterManualInput(INITIAL_ESTATE_FOLLOW, 4_200);
    expect(free).toEqual({ behaviour: "FREE", lastManualInputMs: 4_200 });
    expect(estateFollowsPlayer(free)).toBe(false);
  });

  it("keeps a freshly hand-placed camera free through the walk that follows the pan", () => {
    // Pan, then immediately walk: the gesture is "let me look over there", then "now walk" - the view
    // must not snap back to the character the first time a movement key is pressed.
    for (const elapsed of [0, 250, FOLLOW_RESUME_DELAY_MS - 1]) {
      const state = estateFollowForMovement(HAND_PLACED, 10_000 + elapsed, true);
      expect(state.behaviour, String(elapsed)).toBe("FREE");
      expect(state, String(elapsed)).toBe(HAND_PLACED);
    }
  });

  it("pulls the camera back to the player once they have stopped touching it", () => {
    const back = estateFollowForMovement(HAND_PLACED, 10_000 + FOLLOW_RESUME_DELAY_MS, true);
    expect(back).toEqual({ behaviour: "FOLLOW", lastManualInputMs: null });
    // The delay is inclusive: at exactly the delay the camera has been left alone long enough.
    expect(estateFollowForMovement(HAND_PLACED, 10_000 + FOLLOW_RESUME_DELAY_MS - 1, true).behaviour).toBe("FREE");
  });

  it("does not react to standing still, however long the camera has been free", () => {
    const state = estateFollowForMovement(HAND_PLACED, 10_000 + 60_000, false);
    expect(state).toBe(HAND_PLACED);
  });

  it("treats the game's own aim as a deliberate placement too", () => {
    // Entering placement, or picking an object up, is the camera being put somewhere on purpose: a
    // step must not drag it off the cell the player is working on.
    const aimed = estateFollowAfterFocus(INITIAL_ESTATE_FOLLOW, 7_000);
    expect(aimed).toEqual({ behaviour: "FREE", lastManualInputMs: 7_000 });
    expect(estateFollowForMovement(aimed, 7_500, true).behaviour).toBe("FREE");
  });

  it("recentres immediately, however recently the camera was touched", () => {
    const recentred = estateFollowRecenter(HAND_PLACED);
    expect(recentred).toEqual({ behaviour: "FOLLOW", lastManualInputMs: null });
    expect(estateFollowsPlayer(recentred)).toBe(true);
  });

  it("returns its own argument when nothing changed, so a caller can skip the work", () => {
    // The renderer compares references to decide whether to touch the HUD; a rule that allocated a new
    // object every frame would make a following camera rewrite the page sixty times a second.
    expect(estateFollowForMovement(HAND_PLACED, 10_100, true)).toBe(HAND_PLACED);
    expect(estateFollowForMovement(INITIAL_ESTATE_FOLLOW, 10_100, true)).toBe(INITIAL_ESTATE_FOLLOW);
    expect(estateFollowForMovement(INITIAL_ESTATE_FOLLOW, 10_100, false)).toBe(INITIAL_ESTATE_FOLLOW);
    expect(estateFollowRecenter(INITIAL_ESTATE_FOLLOW)).toBe(INITIAL_ESTATE_FOLLOW);
  });

  it("ignores a clock it cannot believe rather than trusting it", () => {
    // A missing or malformed timestamp must never be read as "the player let go long ago": the safe
    // reading is that nothing is known about when the camera was last touched.
    const free = estateFollowAfterManualInput(INITIAL_ESTATE_FOLLOW, Number.NaN);
    expect(free).toEqual({ behaviour: "FREE", lastManualInputMs: null });
    const moving = estateFollowForMovement(free, Number.NaN, true);
    expect(moving.behaviour).toBe("FOLLOW");
  });
});
