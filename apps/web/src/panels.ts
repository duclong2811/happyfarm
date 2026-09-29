/**
 * Whether the farm HUD's side panels are open.
 *
 * The farm keeps one layout and one set of controls; only how much room the panels take changes with
 * the viewport. This is the policy half of that, kept free of the DOM so the defaults can be tested:
 * a wide viewport opens both panels, a narrow one folds them into tabs, and a width change that
 * crosses the breakpoint re-applies those defaults instead of leaving a panel parked off-screen.
 *
 * Open/closed is UI state only. It is never stored, never sent, and never consulted by a game rule.
 */

/** The width at or below which the side panels fold into tabs. Mirrors the CSS media query. */
export const PANEL_BREAKPOINT_PX = 900;

export interface PanelState {
  /** True while the market panel is expanded. */
  readonly market: boolean;
  /** True while the inventory panel is expanded. */
  readonly inventory: boolean;
}

export const OPEN_PANELS: PanelState = { market: true, inventory: true };
export const FOLDED_PANELS: PanelState = { market: false, inventory: false };

/** The default layout for a viewport: phones and tablets start folded, desktops start open. */
export function panelStateForWidth(widthPx: number): PanelState {
  // A width nobody can read is treated as the smallest one: folding the panels is always safe,
  // whereas opening them on a phone would cover the farm.
  const narrow = !Number.isFinite(widthPx) || widthPx <= PANEL_BREAKPOINT_PX;
  return narrow ? FOLDED_PANELS : OPEN_PANELS;
}

/**
 * Whether a resize crossed the breakpoint.
 *
 * Only a crossing re-applies the defaults: a phone that grows by the width of its own address bar
 * must not re-open a panel the player just folded.
 */
export function crossesPanelBreakpoint(previousWidthPx: number, nextWidthPx: number): boolean {
  return panelStateForWidth(previousWidthPx).market !== panelStateForWidth(nextWidthPx).market;
}

/** Flips one panel, leaving the other alone. */
export function toggledPanel(state: PanelState, panel: keyof PanelState): PanelState {
  return { ...state, [panel]: !state[panel] };
}
