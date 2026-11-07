import { describe, expect, it } from "vitest";
import {
  GROWTH_REFRESH_IDLE_MS,
  GROWTH_REFRESH_INTERVAL_MS,
  GROWTH_REFRESH_MIN_MS,
  GROWTH_REFRESH_STAGE_MS,
  nextGrowthRefreshDelayMs,
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

describe("nextGrowthRefreshDelayMs", () => {
  const crop = (mature: boolean, growthProgress: number, growthDurationSeconds: number | null = 300) => ({
    mature,
    growthProgress,
    growthDurationSeconds
  });
  const tree = (ready: boolean, secondsUntilReady: number, stored = false) => ({ ready, secondsUntilReady, stored });

  it("only takes a slow safety read when nothing is growing", () => {
    expect(nextGrowthRefreshDelayMs({ crops: [], trees: [] })).toBe(GROWTH_REFRESH_IDLE_MS);
    expect(nextGrowthRefreshDelayMs({ crops: [crop(true, 1)], trees: [tree(true, 0), tree(false, 60, true)] })).toBe(
      GROWTH_REFRESH_IDLE_MS
    );
  });

  it("asks just after the soonest maturity", () => {
    // 300s carrot at 95%: 15s left.
    const delay = nextGrowthRefreshDelayMs({ crops: [crop(false, 0.95), crop(false, 0.1)], trees: [] });
    expect(delay).toBeGreaterThan(15_000);
    expect(delay).toBeLessThan(17_000);
    expect(nextGrowthRefreshDelayMs({ crops: [], trees: [tree(false, 8)] })).toBeGreaterThan(8_000);
  });

  it("re-reads a long grow at the visual-stage cadence, and never faster than the old poll", () => {
    expect(nextGrowthRefreshDelayMs({ crops: [crop(false, 0)], trees: [] })).toBe(GROWTH_REFRESH_STAGE_MS);
    expect(nextGrowthRefreshDelayMs({ crops: [crop(false, 0.9999)], trees: [] })).toBe(GROWTH_REFRESH_MIN_MS);
    expect(nextGrowthRefreshDelayMs({ crops: [crop(false, 0.5, null)], trees: [] })).toBe(GROWTH_REFRESH_STAGE_MS);
  });

  it("costs far fewer reads per hour than the fixed five-second poll", () => {
    const fixedPerHour = 3_600_000 / GROWTH_REFRESH_INTERVAL_MS;
    expect(3_600_000 / GROWTH_REFRESH_STAGE_MS).toBeLessThanOrEqual(fixedPerHour / 6);
    expect(3_600_000 / GROWTH_REFRESH_IDLE_MS).toBeLessThanOrEqual(12);
  });
});
