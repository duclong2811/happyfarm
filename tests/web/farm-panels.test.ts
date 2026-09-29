import { describe, expect, it } from "vitest";
import {
  closePanel,
  crossesPanelBreakpoint,
  MODULES,
  NO_PANEL,
  openPanel,
  PANEL_BREAKPOINT_PX,
  defaultPanelState,
  togglePanel
} from "../../apps/web/src/panels";

describe("farm module architecture", () => {
  it("starts with no panel open, on every viewport", () => {
    for (const width of [390, 768, 1024, 1440, 1920]) {
      expect(defaultPanelState(), String(width)).toEqual(NO_PANEL);
    }
    expect(defaultPanelState()).toEqual(NO_PANEL);
  });

  it("opens one module at a time, replacing whatever was open", () => {
    const inventory = openPanel(NO_PANEL, "inventory");
    expect(inventory).toEqual({ active: "inventory" });
    const market = openPanel(inventory, "market");
    expect(market).toEqual({ active: "market" });
    // Never two: the state cannot represent "inventory and market both open".
    expect(Object.keys(market)).toEqual(["active"]);
  });

  it("closes the active module and tolerates closing when nothing is open", () => {
    expect(closePanel({ active: "market" })).toEqual(NO_PANEL);
    expect(closePanel(NO_PANEL)).toEqual(NO_PANEL);
  });

  it("toggles a module from its own launcher without touching the other", () => {
    expect(togglePanel(NO_PANEL, "inventory")).toEqual({ active: "inventory" });
    expect(togglePanel({ active: "inventory" }, "inventory")).toEqual(NO_PANEL);
    expect(togglePanel({ active: "inventory" }, "market")).toEqual({ active: "market" });
  });

  it("closes the open panel when a resize crosses the breakpoint", () => {
    // The presentation changes at the breakpoint, so the panel closes instead of half-adapting.
    expect(crossesPanelBreakpoint(1440, 390)).toBe(true);
    expect(crossesPanelBreakpoint(390, 1440)).toBe(true);
    expect(crossesPanelBreakpoint(1450, 1280)).toBe(false);
    expect(crossesPanelBreakpoint(390, 360)).toBe(false);
    // The breakpoint itself is still narrow, so stepping just past it is a crossing.
    expect(crossesPanelBreakpoint(PANEL_BREAKPOINT_PX, PANEL_BREAKPOINT_PX + 1)).toBe(true);
  });

  it("describes every module with unique ids, so a new module is one registry entry", () => {
    const ids = MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    const elementIds = MODULES.flatMap((module) => [module.panelId, module.bodyId, module.launcherId, module.closeId]);
    expect(new Set(elementIds).size).toBe(elementIds.length);
    for (const module of MODULES) {
      expect(module.glyph.length).toBeGreaterThan(0);
      expect(module.labelKey).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});
