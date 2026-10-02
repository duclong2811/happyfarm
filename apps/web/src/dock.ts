/**
 * How much room the selection surface is allowed to take.
 *
 * The real-device report for this pass was blunt: on a phone the selection and action panel covered a
 * large part of the world, and the game read as a desktop panel squeezed onto a handset. The fix is
 * not a smaller desktop panel - it is a different presentation, chosen by capability:
 *
 * * **Desktop** keeps the full dock it has always had: the selection, its detail line, the planting
 *   control and every action, in one row at the bottom of a wide screen.
 * * **Compact** gets a *strip*: what is selected and the one action that matters, with an expand
 *   affordance when there is more to say. The full dock is still one tap away, and nothing about it
 *   is hidden - it is simply not furniture.
 * * **Character view** never gets the editor at all. It is for walking and looking, so a selection
 *   there shows only the strip, which is how "plant" can still be *asked for* from character view
 *   without the farming UI taking the screen over.
 *
 * The state is one boolean - is the strip expanded - and every decision about it is here, so the
 * answer is a test rather than a class name spelled out in three event handlers. Presentation only:
 * nothing in this module gates an action's availability, and nothing reaches the server.
 */

import type { CameraMode } from "./render/camera-mode";

/**
 * The four shapes the selection surface can take.
 *
 * The names describe the *presentation*, not the viewport, because two different viewports can want
 * the same one and one viewport can want two:
 *
 * * `HIDDEN` - nothing is selected, so the world keeps the space.
 * * `STRIP` - one line: what is selected, its primary action, and a chevron. The compact default.
 * * `SHEET` - the compact layout with the full dock opened on top of the world, because the player
 *   asked for the detail.
 * * `FULL` - the desktop dock, which is already the whole surface and never needs a chevron.
 */
export type DockPresentation = "HIDDEN" | "STRIP" | "SHEET" | "FULL";

export interface DockState {
  /** Whether the compact strip has been opened into the full dock. */
  readonly expanded: boolean;
}

/** A selection opens as a strip, not as a panel. */
export const COLLAPSED_DOCK: DockState = { expanded: false };

export interface DockPresentationInput {
  /** Whether anything is selected at all. With no selection the world keeps the space. */
  readonly hasSelection: boolean;
  /** Whether the viewport is small enough that the desktop dock would dominate it. */
  readonly compact: boolean;
  readonly cameraMode: CameraMode;
  readonly state: DockState;
}

export function dockPresentationFor(input: DockPresentationInput): DockPresentation {
  if (!input.hasSelection) return "HIDDEN";
  // Character view is movement and interaction. A selection there is worth a strip - so a player can
  // see what they are standing next to and ask to plant it - and never the precision editor.
  if (input.cameraMode === "CHARACTER") return "STRIP";
  if (!input.compact) return "FULL";
  return input.state.expanded ? "SHEET" : "STRIP";
}

export function toggleDockExpansion(state: DockState): DockState {
  return { expanded: !state.expanded };
}

export function collapseDock(): DockState {
  return COLLAPSED_DOCK;
}

/**
 * Whether the expand affordance is offered at all.
 *
 * Only the compact layouts have somewhere to expand *to*: the desktop dock is already whole, and a
 * hidden one has nothing to open.
 */
export function dockShowsExpand(presentation: DockPresentation): boolean {
  return presentation === "STRIP" || presentation === "SHEET";
}

/** Whether the compact rules apply: one row, no detail line, secondary actions behind the chevron. */
export function dockIsCompact(presentation: DockPresentation): boolean {
  return presentation === "STRIP" || presentation === "SHEET";
}

/** Whether the full surface is showing (a desktop dock, or an opened compact one). */
export function dockIsExpanded(presentation: DockPresentation): boolean {
  return presentation === "SHEET" || presentation === "FULL";
}
