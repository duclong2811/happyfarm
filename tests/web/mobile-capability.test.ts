import { describe, expect, it } from "vitest";
import {
  COMPACT_LAYOUT_MAX_SHORT_SIDE_PX,
  COMPACT_LAYOUT_MAX_WIDTH_PX,
  deviceCapability,
  showTouchControls,
  type DeviceSignals
} from "../../apps/web/src/mobile/capability";

/**
 * Which device the game thinks it is on, and the two answers it keeps apart.
 *
 * The trap this suite exists to prevent: conflating "has a touchscreen" with "is a phone". A
 * touchscreen laptop must keep its desktop controls, a narrow desktop window must keep its keyboard,
 * and a large tablet must still get a joystick - because its owner is holding a finger, not a mouse.
 */

function signals(overrides: Partial<DeviceSignals> = {}): DeviceSignals {
  return {
    coarsePointer: false,
    hoverNone: false,
    maxTouchPoints: 0,
    viewportWidth: 1440,
    viewportHeight: 900,
    ...overrides
  };
}

/** A phone: a finger, no hover, and a small viewport. */
function phone(width: number, height: number): DeviceSignals {
  return signals({ coarsePointer: true, hoverNone: true, maxTouchPoints: 5, viewportWidth: width, viewportHeight: height });
}

describe("what the device is", () => {
  it("is a desktop when the pointer is fine and nothing is touched", () => {
    const capability = deviceCapability(signals());
    expect(capability).toEqual({ touch: false, coarse: false, compact: false, landscape: true });
    expect(showTouchControls(capability, "CHARACTER")).toBe(false);
  });

  it("is a phone in either orientation: coarse, touched, and compact both ways", () => {
    const portrait = deviceCapability(phone(390, 844));
    expect(portrait).toMatchObject({ touch: true, coarse: true, compact: true, landscape: false });

    // A phone held sideways is wider than a phone held upright and still a phone. At 844 it is inside
    // the width breakpoint; at 932 (a Pro Max) it is *outside* it, and the short side is what keeps it
    // compact - which is the whole reason `compact` looks at both dimensions.
    const landscape = deviceCapability(phone(844, 390));
    expect(landscape).toMatchObject({ touch: true, coarse: true, compact: true, landscape: true });
    const wideLandscape = deviceCapability(phone(932, 430));
    expect(wideLandscape).toMatchObject({ compact: true, landscape: true });
    expect(932).toBeGreaterThan(COMPACT_LAYOUT_MAX_WIDTH_PX);
    expect(390).toBeLessThanOrEqual(COMPACT_LAYOUT_MAX_SHORT_SIDE_PX);

    for (const size of [[430, 932], [932, 430], [360, 640], [640, 360]] as const) {
      expect(deviceCapability(phone(size[0], size[1])).compact, `${String(size[0])}x${String(size[1])}`).toBe(true);
    }
  });

  it("keeps a touchscreen laptop on its desktop controls", () => {
    // A Surface with a mouse attached: it *has* a touchscreen, and its primary pointer is fine and
    // hovers. It must not be handed a joystick, and it must not be trapped in a phone layout.
    const hybrid = deviceCapability(
      signals({ maxTouchPoints: 10, coarsePointer: false, hoverNone: false, viewportWidth: 1280, viewportHeight: 800 })
    );
    expect(hybrid.touch).toBe(true);
    expect(hybrid.coarse).toBe(false);
    expect(hybrid.compact).toBe(false);
    expect(showTouchControls(hybrid, "CHARACTER")).toBe(false);

    // The same machine with the keyboard folded away reports a coarse, non-hovering pointer.
    const asTablet = deviceCapability(
      signals({ maxTouchPoints: 10, coarsePointer: true, hoverNone: true, viewportWidth: 1280, viewportHeight: 800 })
    );
    expect(showTouchControls(asTablet, "CHARACTER")).toBe(true);
    // ...and even then it is not a compact layout, because it is a big screen.
    expect(asTablet.compact).toBe(false);
  });

  it("gives a big tablet a joystick but not a phone layout", () => {
    const tablet = deviceCapability(phone(1024, 768));
    expect(tablet).toMatchObject({ touch: true, coarse: true, compact: false, landscape: true });
    expect(showTouchControls(tablet, "CHARACTER")).toBe(true);
  });

  it("gives a narrow desktop window the compact layout but no joystick", () => {
    // A desktop window dragged narrow: the layout has to adapt, the input does not.
    const narrow = deviceCapability(signals({ viewportWidth: 820, viewportHeight: 700 }));
    expect(narrow.compact).toBe(true);
    expect(narrow.coarse).toBe(false);
    expect(showTouchControls(narrow, "CHARACTER")).toBe(false);
  });

  it("treats a touch with no touch points as no touch at all", () => {
    // Some browsers report a coarse pointer on a device whose touchscreen is disabled.
    const disabled = deviceCapability(signals({ coarsePointer: true, hoverNone: true, maxTouchPoints: 0 }));
    expect(disabled.touch).toBe(false);
    expect(showTouchControls(disabled, "CHARACTER")).toBe(false);
  });
});

describe("when the touch controls belong on screen", () => {
  it("is character view, on a finger - and never anything else", () => {
    const phoneCapability = deviceCapability(phone(390, 844));
    expect(showTouchControls(phoneCapability, "CHARACTER")).toBe(true);
    // Estate view is for selecting and building; a movement stick would sit on top of the very
    // controls that view is made of.
    expect(showTouchControls(phoneCapability, "ESTATE")).toBe(false);
    // And no finger, no stick - however small the window.
    const smallDesktop = deviceCapability(signals({ viewportWidth: 700, viewportHeight: 500 }));
    expect(showTouchControls(smallDesktop, "CHARACTER")).toBe(false);
  });
});
