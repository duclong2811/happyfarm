/**
 * Which farm module is open, and the registry that decides what a module is.
 *
 * The HUD has one big thing open at a time or nothing at all. That is the whole architecture: a
 * module is a launcher button plus a panel, the state is a single id, and opening a module replaces
 * whatever was open. Adding Quest, Build, Animals or Friends later means adding a registry entry -
 * not another sidebar, and not another boolean to keep consistent.
 *
 * This is UI state only. It is never stored, never sent, and never consulted by a game rule: the
 * inventory and the market are rendered from authoritative state every time they are opened.
 */

import type { MessageKey } from "./i18n";

export type ModuleId = "inventory" | "market";

export interface ModuleDefinition {
  readonly id: ModuleId;
  /** Glyph shown on the launcher. Emoji for now, replaced wholesale when real icons arrive. */
  readonly glyph: string;
  /** Localized names: the launcher's tooltip and the panel's title. */
  readonly labelKey: MessageKey;
  readonly panelId: string;
  readonly bodyId: string;
  readonly launcherId: string;
  readonly closeId: string;
}

/**
 * The module registry.
 *
 * Order is presentation order in the rail. A future module adds one entry here and one panel in the
 * document; nothing else in the HUD has to learn about it.
 */
export const MODULES: readonly ModuleDefinition[] = [
  {
    id: "inventory",
    glyph: "🎒",
    labelKey: "panel.inventory",
    panelId: "inventory-panel",
    bodyId: "inventory-body",
    launcherId: "inventory-launcher",
    closeId: "inventory-close"
  },
  {
    id: "market",
    glyph: "🛒",
    labelKey: "panel.market",
    panelId: "market-panel",
    bodyId: "market-body",
    launcherId: "market-launcher",
    closeId: "market-close"
  }
];

export interface PanelState {
  /** The open module, or null when the world has the screen to itself. */
  readonly active: ModuleId | null;
}

export const NO_PANEL: PanelState = { active: null };

/** Opening a module replaces whatever was open. */
export function openPanel(state: PanelState, id: ModuleId): PanelState {
  return { active: id };
}

export function closePanel(state: PanelState): PanelState {
  // Closing ignores which panel was open, but the signature keeps the transition uniform with
  // `openPanel`, so a caller can write `panels = closePanel(panels)` for any state.
  return state.active === null ? state : NO_PANEL;
}

/** The launcher button toggles its own module and leaves the others alone. */
export function togglePanel(state: PanelState, id: ModuleId): PanelState {
  return state.active === id ? NO_PANEL : openPanel(state, id);
}

/**
 * The default is the world, on every viewport: no panel is furniture.
 *
 * There is deliberately no viewport argument. A panel that opened itself on a wide screen would be
 * the permanent sidebar this architecture exists to remove, so the answer is the same at 390 px and
 * at 1920 px, and the responsive rules only decide *how* an open panel looks.
 */
export function defaultPanelState(): PanelState {
  return NO_PANEL;
}

/**
 * Whether a resize crossed the layout breakpoint.
 *
 * A crossing closes the open panel, because the presentation of that panel changed underneath it -
 * a drawer on a phone and a floating panel on a desktop are not the same object, and leaving one
 * half-open is the pathological state this avoids. The default is already "nothing open", so there
 * is no other state to restore.
 */
export const PANEL_BREAKPOINT_PX = 900;

export function crossesPanelBreakpoint(previousWidthPx: number, nextWidthPx: number): boolean {
  return isNarrow(previousWidthPx) !== isNarrow(nextWidthPx);
}

function isNarrow(widthPx: number): boolean {
  return !Number.isFinite(widthPx) || widthPx <= PANEL_BREAKPOINT_PX;
}
