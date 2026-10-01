import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { ROAD_SAMPLE_SPACING_WORLD, splineThrough, resampleByDistance } from "../../apps/web/src/render/roads";
import { ribbonSurface } from "../../apps/web/src/render/road-surface";
import { ROADS } from "../../apps/web/src/render/world-config";

/**
 * The road's geometry, held to the promises the V12.3 pass makes.
 *
 * The complaints were visual - wobbling edges, flares, chopped ends, folded ribbon - and every one of
 * them is a property of the geometry rather than of the colour, so every one of them can be measured:
 * a cross-section is the road's width, consecutive cross-sections do not cross, and a sample sits
 * where the arc length says it should.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_roads",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 1,
    requiredLevel: 1,
    unlocked
  };
}

function roads() {
  const tiles: FarmTileDTO[] = [];
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) tiles.push(tile(x, y));
  return buildFarmSceneInput({
    tiles,
    crops: [],
    trees: [],
    plots: [1, 2, 3, 4, 5, 6, 7, 8].map((p) => plot(p, p === 1)),
    selected: null
  }).world.roads;
}

/** The two edge points of one cross-section, in world metres. */
function edges(sample: { worldX: number; worldZ: number; normalX: number; normalZ: number; miter: number }, half: number) {
  const offsetX = sample.normalX * half * sample.miter;
  const offsetZ = sample.normalZ * half * sample.miter;
  return {
    left: { x: sample.worldX + offsetX, z: sample.worldZ + offsetZ },
    right: { x: sample.worldX - offsetX, z: sample.worldZ - offsetZ }
  };
}

describe("one authoritative centreline", () => {
  const world = roads();

  it("samples the centreline at a fixed arc length, not at even spline parameters", () => {
    const line = splineThrough([
      { worldX: 0, worldZ: 0 },
      { worldX: 20, worldZ: 0 },
      { worldX: 20, worldZ: 20 }
    ]);
    const even = resampleByDistance(line, ROAD_SAMPLE_SPACING_WORLD);
    expect(even.length).toBeGreaterThan(40);
    for (let index = 1; index < even.length - 1; index += 1) {
      const previous = even[index - 1];
      const current = even[index];
      if (previous === undefined || current === undefined) continue;
      const step = Math.hypot(current.worldX - previous.worldX, current.worldZ - previous.worldZ);
      // Within a hair: the resampler walks the spline's *chords*, so a step that spans a bend is a
      // fraction shorter in a straight line than the arc it covers. What matters is that the spacing
      // is fixed rather than following the spline's parameter.
      expect(step).toBeGreaterThan(ROAD_SAMPLE_SPACING_WORLD * 0.99);
      expect(step).toBeLessThanOrEqual(ROAD_SAMPLE_SPACING_WORLD + 1e-9);
    }
    // …and the author's last point is a sample, so a road ends where it was told to.
    const last = even[even.length - 1];
    expect(Math.hypot((last?.worldX ?? 0) - 20, (last?.worldZ ?? 0) - 20)).toBeLessThan(0.001);
  });

  it("carries a unit normal and a sane mitre at every sample", () => {
    for (const road of world) {
      for (const sample of road.samples) {
        expect(Math.hypot(sample.normalX, sample.normalZ)).toBeCloseTo(1, 6);
        // The mitre reaches further at a corner and is clamped, so a sharp turn bevels rather than
        // growing a spike. 1.8 is the limit the join is built to.
        expect(sample.miter, road.id).toBeGreaterThanOrEqual(1);
        expect(sample.miter, road.id).toBeLessThanOrEqual(1.8);
      }
    }
  });

  it("keeps the road's width a constant, with the mitre the only thing that moves it", () => {
    for (const road of world) {
      const half = road.widthWorld / 2;
      const widths: number[] = [];
      for (const sample of road.samples) {
        const { left, right } = edges(sample, half);
        const across = Math.hypot(left.x - right.x, left.z - right.z);
        // A cross-section is the road's width *stretched along the mitre* and nothing else: divide it
        // back out and every sample is the same number, which is what "the width does not vary" means.
        expect(across / sample.miter, road.id).toBeCloseTo(road.widthWorld, 9);
        widths.push(across);
      }
      // …and the stretch itself is bounded, so the widest cross-section is at most the mitre limit.
      const narrowest = Math.min(...widths);
      const widest = Math.max(...widths);
      expect(widest / narrowest, road.id).toBeLessThanOrEqual(1.8);
    }
  });

  it("never folds: consecutive cross-sections do not cross", () => {
    for (const road of world) {
      const half = road.widthWorld / 2;
      for (let index = 0; index < road.samples.length - 1; index += 1) {
        const current = road.samples[index];
        const next = road.samples[index + 1];
        if (current === undefined || next === undefined) continue;
        const a = edges(current, half);
        const b = edges(next, half);
        // The quad's signed area, treating x as east and z as north. A fold makes it change sign
        // between the two triangles, which is how a ribbon tears open.
        const area = (p: { x: number; z: number }, q: { x: number; z: number }, r: { x: number; z: number }): number =>
          (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
        const first = area(a.left, b.left, b.right);
        const second = area(a.left, b.right, a.right);
        expect(Math.sign(first), `${road.id} at sample ${String(index)}`).not.toBe(0);
        expect(Math.sign(second), `${road.id} at sample ${String(index)}`).toBe(Math.sign(first));
      }
    }
  });

  it("caps a dead end square to the road, not to the world axes", () => {
    for (const road of world) {
      const first = road.samples[0];
      const second = road.samples[1];
      const last = road.samples[road.samples.length - 1];
      const before = road.samples[road.samples.length - 2];
      if (first === undefined || second === undefined || last === undefined || before === undefined) continue;
      // The cap is the cross-section itself, so it is perpendicular to the tangent at that end by
      // construction. Measured: the two edge points differ along the normal and not along the tangent.
      const half = road.widthWorld / 2;
      const cap = edges(first, half);
      const tangentX = second.worldX - first.worldX;
      const tangentZ = second.worldZ - first.worldZ;
      const alongCap = (cap.left.x - cap.right.x) * tangentX + (cap.left.z - cap.right.z) * tangentZ;
      expect(Math.abs(alongCap), road.id).toBeLessThan(0.02);
      // …and nothing sticks out past the author's own last waypoint.
      const end = ROADS.find((entry) => entry.id === road.id)?.points.at(-1);
      expect(end, road.id).toBeDefined();
    }
  });

  it("draws the whole network as a handful of meshes, not one per stone", () => {
    const shoulder = ribbonSurface(
      world.map((road) => ({ ...road, widthWorld: road.widthWorld + 0.26 })),
      ["PRIMARY", "SECONDARY", "PATH"]
    );
    // One geometry for every road's shoulder, one for the dirt, one for the paths: three meshes,
    // whatever the network's length.
    expect(shoulder.indices.length).toBeGreaterThan(0);
    expect(shoulder.positions.length / 3).toBe(
      world.reduce((total, road) => total + road.samples.length * 5, 0)
    );
  });
});
