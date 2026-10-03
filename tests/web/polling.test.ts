import { describe, expect, it } from "vitest";
import {
  GROWTH_REFRESH_INTERVAL_MS,
  shouldRefreshGrowth,
  type GrowthPollGate
} from "../../apps/web/src/polling";

/**
 * When the page reads the farm on its own.
 *
 * The V14.3.2 D1 audit found that a tab left open was the whole quota story: a 2-second timer
 * re-read every farm tile (twice) and every built object. The rule these tests pin is that the
 * timer reads only growth, and only while the tab is actually being looked at.
 */

function gate(overrides: Partial<GrowthPollGate> = {}): GrowthPollGate {
  return { farmLoaded: true, visible: true, inFlight: false, ...overrides };
}

describe("the growth poll gate", () => {
  it("allows a tick only when a visible, loaded tab is idle", () => {
    expect(shouldRefreshGrowth(gate())).toBe(true);
  });

  it("reads nothing while the tab is hidden", () => {
    // A phone in a pocket or a background tab must cost zero rows.
    expect(shouldRefreshGrowth(gate({ visible: false }))).toBe(false);
  });

  it("reads nothing before a farm is loaded", () => {
    expect(shouldRefreshGrowth(gate({ farmLoaded: false }))).toBe(false);
  });

  it("drops a tick rather than stacking it on a slow one", () => {
    expect(shouldRefreshGrowth(gate({ inFlight: true }))).toBe(false);
  });

  it("keeps a cadence that is small next to the fastest crop", () => {
    // The shortest crop grows in 300s; a few seconds of latency is invisible and bounded.
    expect(GROWTH_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(2_000);
    expect(GROWTH_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(15_000);
  });
});
