import { describe, expect, it } from "vitest";
import { reconcileNeighborNpc } from "@happy-farm/domain";

const START = "2026-01-01T00:00:00.000Z";

describe("neighbour NPC progression", () => {
  it("reconciles plant growth and construction from server time only", () => {
    const growing = reconcileNeighborNpc({
      phase: "GROWING", plantedAt: START, readyAt: "2026-01-01T00:01:00.000Z", stockQuantity: 0,
      constructionLevel: 0, nextMilestoneAt: null, version: 1, lastReconciledAt: START
    }, "2026-01-01T00:01:00.000Z");
    expect(growing.phase).toBe("STOCKED");
    expect(growing.stockQuantity).toBe(3);
    expect(growing.nextMilestoneAt).toBe("2026-01-01T00:01:30.000Z");

    const built = reconcileNeighborNpc(growing, "2026-01-01T00:02:00.000Z");
    expect(built.phase).toBe("BUILT");
    expect(built.constructionLevel).toBe(1);
  });

  it("bounds dormant catch-up and never creates player rewards", () => {
    const next = reconcileNeighborNpc({
      phase: "GROWING", plantedAt: START, readyAt: "2026-01-01T00:02:00.000Z", stockQuantity: 0,
      constructionLevel: 0, nextMilestoneAt: null, version: 4, lastReconciledAt: START
    }, "2026-01-03T00:00:00.000Z", 60);
    expect(next.phase).toBe("GROWING");
    expect(next.stockQuantity).toBe(0);
    expect(next.version).toBe(5);
  });

  it("catches up the stocked-to-built milestone when the server clock is already past it", () => {
    const next = reconcileNeighborNpc({
      phase: "GROWING", plantedAt: START, readyAt: "2026-01-01T00:01:00.000Z", stockQuantity: 0,
      constructionLevel: 0, nextMilestoneAt: null, version: 1, lastReconciledAt: START
    }, "2026-01-01T00:10:00.000Z");
    expect(next.phase).toBe("BUILT");
    expect(next.stockQuantity).toBe(3);
    expect(next.constructionLevel).toBe(1);
    expect(next.nextMilestoneAt).toBeNull();
  });

  it("does not ask for a write when a read finds nothing to change", () => {
    const growing = {
      phase: "GROWING" as const, plantedAt: START, readyAt: "2026-01-01T00:01:00.000Z", stockQuantity: 0,
      constructionLevel: 0, nextMilestoneAt: null, version: 7, lastReconciledAt: START
    };
    const early = reconcileNeighborNpc(growing, "2026-01-01T00:00:30.000Z");
    expect(early.changed).toBe(false);
    expect(early.version).toBe(7);
    expect(early.lastReconciledAt).toBe(START);

    const built = reconcileNeighborNpc(growing, "2026-01-01T00:10:00.000Z");
    expect(built.changed).toBe(true);
    // BUILT is terminal: later reads, even long after the catch-up cap, never write again.
    expect(reconcileNeighborNpc(built, "2026-01-01T00:20:00.000Z").changed).toBe(false);
    expect(reconcileNeighborNpc(built, "2026-03-01T00:00:00.000Z").changed).toBe(false);
  });
});
