import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLLAPSED_DOCK,
  collapseDock,
  dockIsCompact,
  dockIsExpanded,
  dockPresentationFor,
  dockShowsExpand,
  toggleDockExpansion
} from "../../apps/web/src/dock";
import {
  COMPACT_LAYOUT_MAX_SHORT_SIDE_PX,
  COMPACT_LAYOUT_MAX_WIDTH_PX
} from "../../apps/web/src/mobile/capability";

/**
 * The mobile HUD after the first real-device test.
 *
 * Two halves. The first is the decision: how much of the selection surface is on screen, and the rules
 * that keep character view free of the farming editor. The second is a *source* contract on the markup
 * and the stylesheet - the parts of a responsive layout that cannot be asserted without a browser, the
 * same technique the scene boot-order test uses for an ordering that needs a canvas to observe.
 */

const INDEX_HTML = fileURLToPath(new URL("../../apps/web/index.html", import.meta.url));
const STYLES = fileURLToPath(new URL("../../apps/web/src/styles.css", import.meta.url));

describe("how much of the selection surface is on screen", () => {
  it("hides it entirely when nothing is selected", () => {
    expect(
      dockPresentationFor({ hasSelection: false, compact: true, cameraMode: "ESTATE", state: COLLAPSED_DOCK })
    ).toBe("HIDDEN");
    expect(
      dockPresentationFor({ hasSelection: false, compact: false, cameraMode: "ESTATE", state: COLLAPSED_DOCK })
    ).toBe("HIDDEN");
  });

  it("starts a phone selection as a strip, and opens it only when asked", () => {
    const closed = dockPresentationFor({
      hasSelection: true,
      compact: true,
      cameraMode: "ESTATE",
      state: COLLAPSED_DOCK
    });
    expect(closed).toBe("STRIP");
    const open = dockPresentationFor({
      hasSelection: true,
      compact: true,
      cameraMode: "ESTATE",
      state: toggleDockExpansion(COLLAPSED_DOCK)
    });
    expect(open).toBe("SHEET");
    expect(collapseDock()).toEqual(COLLAPSED_DOCK);
  });

  it("gives a desktop the whole dock, with nothing to expand", () => {
    const desktop = dockPresentationFor({
      hasSelection: true,
      compact: false,
      cameraMode: "ESTATE",
      state: COLLAPSED_DOCK
    });
    expect(desktop).toBe("FULL");
    expect(dockShowsExpand(desktop)).toBe(false);
    expect(dockIsCompact(desktop)).toBe(false);
    expect(dockIsExpanded(desktop)).toBe(true);
  });

  it("never lets character view open the precision editor", () => {
    // Even with the sheet state wide open: character view is movement and interaction, so a selection
    // there is a one-line strip and nothing else.
    const presentation = dockPresentationFor({
      hasSelection: true,
      compact: true,
      cameraMode: "CHARACTER",
      state: { expanded: true }
    });
    expect(presentation).toBe("STRIP");
    expect(dockIsCompact(presentation)).toBe(true);
    expect(dockIsExpanded(presentation)).toBe(false);
    expect(dockShowsExpand(presentation)).toBe(true);
  });

  it("agrees with the capability module about what compact means", () => {
    // The dock's `compact` input is `DeviceCapability.compact`, so the two must not drift: a phone in
    // landscape is compact by its short side even though it is wider than the breakpoint.
    const phoneLandscape = { width: 844, height: 390 };
    const compact =
      Math.min(phoneLandscape.width, phoneLandscape.height) <= COMPACT_LAYOUT_MAX_SHORT_SIDE_PX ||
      phoneLandscape.width <= COMPACT_LAYOUT_MAX_WIDTH_PX;
    expect(compact).toBe(true);
    expect(
      dockPresentationFor({ hasSelection: true, compact, cameraMode: "ESTATE", state: COLLAPSED_DOCK })
    ).toBe("STRIP");
  });
});

describe("responsive HUD contract", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  // Source contract only: normalise the line endings so a CRLF working copy (Windows checkout) does
  // not fail assertions that are about rule structure, not about the EOL byte.
  const css = readFileSync(STYLES, "utf8").replace(/\r\n/g, "\n");

  it("keeps the overflow control and the recenter control in the markup", () => {
    expect(html).toContain('id="hud-menu-toggle"');
    expect(html).toContain('id="hud-menu"');
    expect(html).toContain('id="language"');
    expect(html).toContain('id="refresh"');
    expect(html).toContain('id="camera-recenter"');
    expect(html).toContain('id="dock-expand"');
  });

  it("respects every safe-area inset, including the horizontal ones", () => {
    // Android gesture bars, a notch and a landscape phone all eat into a different edge, so all four
    // are in the sheet - not only the top and bottom the first pass needed.
    for (const inset of [
      "env(safe-area-inset-top)",
      "env(safe-area-inset-bottom)",
      "env(safe-area-inset-left)",
      "env(safe-area-inset-right)"
    ]) {
      expect(css, inset).toContain(inset);
    }
  });

  it("keeps finger targets at the one touch size the mobile pass defined", () => {
    expect(css).toContain("--touch-target: 44px");
    expect(css).toContain("min-height: var(--touch-target)");
  });

  it("collapses the selection surface on a compact screen without shrinking the desktop one", () => {
    expect(css).toContain(".action-dock.is-compact");
    expect(css).toContain(".dock-expand");
    // The compact rules use the same two breakpoints the capability module computes with.
    expect(css).toContain("@media (max-width: 900px), (max-height: 500px)");
    expect(css).toContain("--joystick-size");
  });

  it("keeps the farming furniture out of character view, but not the contextual strip", () => {
    // The module rail steps aside for the joystick. The strip does not: it is how a player asks to
    // plant something without the editor covering the island, so character mode may *position* it
    // around the movement controls and must never hide it.
    const rules = css.match(/body\.is-character-mode[^{]*\{[^}]*\}/g) ?? [];
    const dockRules = rules.filter((rule) => rule.includes(".action-dock"));
    const railRules = rules.filter((rule) => rule.includes(".module-rail"));
    expect(railRules.some((rule) => rule.includes("display: none"))).toBe(true);
    expect(dockRules.length).toBeGreaterThan(0);
    for (const rule of dockRules) {
      expect(rule, rule).not.toContain("display: none");
    }
  });

  it("moves transient messages off the controls they would otherwise land on", () => {
    // The bottom of a phone screen belongs to the joystick, the Run button and the strip, so the
    // status line moves under the top bar on a compact layout.
    expect(css).toContain("body.is-character-mode .status-wrap");
    expect(css).toContain(".status-wrap,\n  body.is-character-mode .status-wrap");
  });
});
