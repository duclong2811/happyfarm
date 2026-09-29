import { describe, expect, it } from "vitest";
import {
  crossesPanelBreakpoint,
  FOLDED_PANELS,
  OPEN_PANELS,
  PANEL_BREAKPOINT_PX,
  panelStateForWidth,
  toggledPanel
} from "../../apps/web/src/panels";

describe("farm HUD panel policy", () => {
  it("opens both panels on a desktop viewport", () => {
    for (const width of [1280, 1440, 1920]) {
      expect(panelStateForWidth(width), String(width)).toEqual(OPEN_PANELS);
    }
  });

  it("folds both panels on a phone or a tablet held upright", () => {
    for (const width of [360, 390, 430, 768, PANEL_BREAKPOINT_PX]) {
      expect(panelStateForWidth(width), String(width)).toEqual(FOLDED_PANELS);
    }
  });

  it("keeps a tablet in landscape open, because it has the width for the columns", () => {
    expect(panelStateForWidth(1024)).toEqual(OPEN_PANELS);
  });

  it("only re-applies defaults when a resize crosses the breakpoint", () => {
    // Shrinking from a laptop to a phone crosses it; a window that grows or shrinks a little does
    // not, so a panel the player just folded stays folded.
    expect(crossesPanelBreakpoint(1440, 390)).toBe(true);
    expect(crossesPanelBreakpoint(390, 1440)).toBe(true);
    expect(crossesPanelBreakpoint(1450, 1280)).toBe(false);
    expect(crossesPanelBreakpoint(390, 360)).toBe(false);
  });

  it("treats a nonsense width as a narrow one rather than as a crash", () => {
    expect(panelStateForWidth(Number.NaN)).toEqual(FOLDED_PANELS);
  });

  it("flips one panel without disturbing the other", () => {
    const foldedMarket = toggledPanel(OPEN_PANELS, "market");
    expect(foldedMarket).toEqual({ market: false, inventory: true });
    expect(toggledPanel(foldedMarket, "market")).toEqual(OPEN_PANELS);
    const foldedBag = toggledPanel(OPEN_PANELS, "inventory");
    expect(foldedBag).toEqual({ market: true, inventory: false });
    // A new object every time: the panel state is replaced, never mutated in place.
    expect(toggledPanel(OPEN_PANELS, "market")).not.toBe(OPEN_PANELS);
  });
});
