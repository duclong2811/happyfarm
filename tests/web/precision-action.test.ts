import { describe, expect, it } from "vitest";
import {
  groundTapOpensContext,
  precisionActionForPanel,
  precisionFocusFor,
  type PrecisionActionKind
} from "../../apps/web/src/render/precision-action";

/**
 * Where the estate camera goes when a precision action takes over, and when a tap on the ground is
 * worth a surface at all.
 *
 * The product rule this pins is the V13.6.3 one: character view is for movement, estate view is for
 * precise work, and asking for precise work from character view *helps* the player - it changes the
 * view to the thing they were working on rather than refusing.
 */

const CELL = { x: 12, y: 4 };
const ANCHOR = { x: -3, y: 9 };

function focus(kind: PrecisionActionKind, selected: typeof CELL | null, anchor: typeof CELL | null = null) {
  return precisionFocusFor(kind, { selected, anchor });
}

describe("where a precision action aims the estate camera", () => {
  it("aims at the selected cell for planting and building", () => {
    expect(focus("PLANT", CELL)).toEqual({ kind: "CELL", cell: CELL });
    expect(focus("BUILD", CELL)).toEqual({ kind: "CELL", cell: CELL });
  });

  it("aims at the object for moving, turning and restoring it", () => {
    // The object's own anchor wins over the current selection: moving a barn is about the barn.
    for (const kind of ["MOVE_OBJECT", "ROTATE_OBJECT", "RESTORE_OBJECT"] as const) {
      expect(focus(kind, CELL, ANCHOR), kind).toEqual({ kind: "CELL", cell: ANCHOR });
    }
  });

  it("falls back to the selection, then to the player", () => {
    expect(focus("MOVE_OBJECT", CELL)).toEqual({ kind: "CELL", cell: CELL });
    expect(focus("PLANT", null)).toEqual({ kind: "PLAYER" });
    expect(focus("MOVE_OBJECT", null)).toEqual({ kind: "PLAYER" });
  });

  it("names the action each precision panel stands for", () => {
    expect(precisionActionForPanel("plant")).toBe("PLANT");
    expect(precisionActionForPanel("build")).toBe("BUILD");
  });
});

describe("when a tap on the ground opens the context surface", () => {
  it("always opens it in estate view, where selecting *is* the interaction", () => {
    expect(groundTapOpensContext({ mode: "ESTATE", hasContextAction: true })).toBe(true);
    expect(groundTapOpensContext({ mode: "ESTATE", hasContextAction: false })).toBe(true);
  });

  it("opens it in character view only when the cell actually offers something", () => {
    // The player's own soil to plant, a crop or a tree to inspect: those are worth a strip.
    expect(groundTapOpensContext({ mode: "CHARACTER", hasContextAction: true })).toBe(true);
    // Wild land, water, somebody else's ground: the tap was just the world, and the joystick keeps the
    // screen rather than a surface appearing under the player's thumb.
    expect(groundTapOpensContext({ mode: "CHARACTER", hasContextAction: false })).toBe(false);
  });
});
