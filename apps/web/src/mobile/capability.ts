/**
 * What kind of device is holding the game.
 *
 * Two questions, deliberately answered separately, because conflating them is how a touchscreen
 * laptop ends up trapped in a phone interface:
 *
 * * **`coarse`** is about *input*: the primary pointer is a finger, so it cannot hover and it needs
 *   big targets. A laptop with a touchscreen and a mouse reports a fine, hovering pointer, and must
 *   keep its desktop controls.
 * * **`compact`** is about *layout*: the viewport is small enough that the desktop arrangement does
 *   not fit. A narrow desktop window is compact without being coarse; a large tablet is coarse
 *   without being compact.
 *
 * The phone UI is shown when the input is coarse; the compact layout is applied by CSS to the same
 * breakpoints this module computes with. Nothing here is ever allowed to change gameplay: the
 * controller, the world and the server do not know a screen size exists.
 *
 * Pure, so the decisions above are testable without a browser.
 */

/**
 * The width at or below which the sidebar layout no longer fits.
 *
 * The stylesheet has used 900 px as its own breakpoint since the responsive pass, so this is the same
 * number rather than a second opinion about where the layout changes.
 */
export const COMPACT_LAYOUT_MAX_WIDTH_PX = 900;

/**
 * The short side at or below which a viewport is compact whatever its width.
 *
 * A phone in landscape is 844 x 390: wider than the sidebar breakpoint, and far too short for the
 * desktop arrangement. Measuring the short side as well is what stops "landscape" from meaning
 * "desktop".
 */
export const COMPACT_LAYOUT_MAX_SHORT_SIDE_PX = 500;

/** The raw signals a browser can answer. Kept as plain values so a test can pose any device. */
export interface DeviceSignals {
  /** `matchMedia("(pointer: coarse)")`. */
  readonly coarsePointer: boolean;
  /** `matchMedia("(hover: none)")`. */
  readonly hoverNone: boolean;
  /** `navigator.maxTouchPoints`. */
  readonly maxTouchPoints: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface DeviceCapability {
  /** A touch-capable input exists at all - true on a touchscreen laptop, too. */
  readonly touch: boolean;
  /** The primary pointer is a finger that cannot hover: the mobile controls' audience. */
  readonly coarse: boolean;
  /** The viewport is too small for the desktop layout. */
  readonly compact: boolean;
  readonly landscape: boolean;
}

/** What the device can do and how much room it has. Layout never decides input, and vice versa. */
export function deviceCapability(signals: DeviceSignals): DeviceCapability {
  const width = Number.isFinite(signals.viewportWidth) ? Math.max(signals.viewportWidth, 0) : 0;
  const height = Number.isFinite(signals.viewportHeight) ? Math.max(signals.viewportHeight, 0) : 0;
  const touchPoints = Number.isFinite(signals.maxTouchPoints) ? signals.maxTouchPoints : 0;
  const shortSide = Math.min(width, height);
  return {
    touch: touchPoints > 0,
    // Both halves, not either: a laptop whose touchscreen has been disabled reports a coarse pointer
    // in some browsers but still hovers, and a hovering pointer means the desktop controls work.
    coarse: signals.coarsePointer && signals.hoverNone,
    compact: width <= COMPACT_LAYOUT_MAX_WIDTH_PX || shortSide <= COMPACT_LAYOUT_MAX_SHORT_SIDE_PX,
    landscape: width >= height
  };
}

/**
 * Whether the on-screen movement controls should be shown.
 *
 * Character view only, and only for a finger. This is an *input* decision and never a layout one: a
 * narrow desktop window keeps its keyboard, and a large tablet gets a joystick because that is what
 * its owner is holding. The keyboard always works as well - the touch controls are an addition, not a
 * replacement.
 */
export function showTouchControls(
  capability: DeviceCapability,
  cameraMode: "ESTATE" | "CHARACTER"
): boolean {
  return cameraMode === "CHARACTER" && capability.coarse && capability.touch;
}
