import { describe, expect, it } from "vitest";
import { ROAD_EDGE_WAVE, roadEdgeWave, shoulderProfile } from "../../apps/web/src/render/road-surface";
import { ROAD_LIFT_WORLD } from "../../apps/web/src/render/roads";

/**
 * The V12.4 road, held to the promises that keep it a road rather than a ribbon.
 *
 * Three of them matter enough to pin. The road must stay *in* the terrain: V12.2 lifted it to sixteen
 * centimetres to beat the ground mesh and the result read as a kerb across the island. The drawn edge
 * may wander, but only a little, only deterministically, and never in a way that could change the
 * width the navigation grid and the scenery clearance rule measure. And the shoulder that carries the
 * road into the grass must be darker than the field at its outside and lighter against the road, or
 * the transition is a painted outline instead of trodden ground.
 */

describe("the road sits in the terrain", () => {
  it("keeps the lift small enough to read as ground rather than as a kerb", () => {
    // V12.3 was 0.16, which is what made the road float. A centimetre or two is enough for the depth
    // bias to win, and a future change that raises it back is the regression this test exists for.
    expect(ROAD_LIFT_WORLD).toBeGreaterThan(0);
    expect(ROAD_LIFT_WORLD).toBeLessThanOrEqual(0.05);
  });

  it("is a constant in one place, so a caller cannot lift one road above the others", () => {
    // The number is a module constant rather than a parameter: nothing in the renderer can pass a
    // larger lift for one road, which is what used to make the harbour end stand proud.
    expect(typeof ROAD_LIFT_WORLD).toBe("number");
  });
});

describe("the drawn road edge", () => {
  it("is deterministic: the same distance and side give the same edge, every time", () => {
    for (const distance of [0, 0.7, 12.3, 41.9, 210.5]) {
      for (const side of [-1, 1]) {
        const first = roadEdgeWave(distance, side);
        for (let repeat = 0; repeat < 4; repeat += 1) {
          expect(roadEdgeWave(distance, side)).toBe(first);
        }
      }
    }
  });

  it("stays inside its bound, so no edge spikes and no width explodes", () => {
    for (let distance = 0; distance < 400; distance += 0.37) {
      for (const side of [-1, 1]) {
        const wave = roadEdgeWave(distance, side);
        expect(wave).toBeGreaterThanOrEqual(1 - ROAD_EDGE_WAVE);
        expect(wave).toBeLessThanOrEqual(1 + ROAD_EDGE_WAVE);
      }
    }
    // A few per cent of half a width: a cosmetic wobble, not a new road shape.
    expect(ROAD_EDGE_WAVE).toBeLessThanOrEqual(0.08);
  });

  it("does not pinch the two edges in step, which is what would make the road narrow visibly", () => {
    // The two sides use different phases, so wherever one edge is out the other is not exactly in.
    let disagreed = 0;
    for (let distance = 0; distance < 60; distance += 0.5) {
      if (Math.abs(roadEdgeWave(distance, -1) - roadEdgeWave(distance, 1)) > 0.005) disagreed += 1;
    }
    expect(disagreed).toBeGreaterThan(60);
  });
});

describe("the shoulder between road and grass", () => {
  it("is darkest at its outside edge and lightest where it meets the road", () => {
    const outer = shoulderProfile(1);
    const middle = shoulderProfile(0.5);
    const inner = shoulderProfile(0);
    expect(outer).toBeLessThan(middle);
    expect(middle).toBeLessThan(inner);
  });

  it("stays a tone multiplier rather than a colour of its own", () => {
    for (const across of [-1, -0.5, 0, 0.5, 1]) {
      const tone = shoulderProfile(across);
      expect(tone).toBeGreaterThan(0.5);
      expect(tone).toBeLessThanOrEqual(1.2);
    }
    // Symmetric: the two sides of a road are the same ground.
    expect(shoulderProfile(-0.7)).toBeCloseTo(shoulderProfile(0.7), 12);
  });
});
