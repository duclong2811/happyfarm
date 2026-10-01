import { describe, expect, it } from "vitest";
import {
  FENCE,
  ISLAND_SHAPE,
  TERRAIN_SHAPE,
  VOLCANO_SHAPE,
  WORLD_CENTER_WORLD
} from "../../apps/web/src/render/world-config";
import {
  flatMask,
  islandRadiusAt,
  islandRimPoint,
  terrainHeightAt,
  uplandOffset,
  volcanoRadiusFraction
} from "../../apps/web/src/render/terrain-height";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";

const frame = worldFrame();

/** A point `radiusFactor` of the way from the island's centre to its shore, at `angle`. */
function atRadius(angle: number, radiusFactor: number): { readonly worldX: number; readonly worldZ: number } {
  const rim = islandRimPoint(angle, ISLAND_SHAPE);
  return {
    worldX: WORLD_CENTER_WORLD.worldX + (rim.worldX - WORLD_CENTER_WORLD.worldX) * radiusFactor,
    worldZ: WORLD_CENTER_WORLD.worldZ + (rim.worldZ - WORLD_CENTER_WORLD.worldZ) * radiusFactor
  };
}

describe("island outline", () => {
  it("measures zero at the centre and one on the shoreline", () => {
    expect(islandRadiusAt(WORLD_CENTER_WORLD.worldX, WORLD_CENTER_WORLD.worldZ, ISLAND_SHAPE)).toBeCloseTo(0, 9);
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      const rim = islandRimPoint(angle, ISLAND_SHAPE);
      expect(islandRadiusAt(rim.worldX, rim.worldZ, ISLAND_SHAPE), `angle ${String(angle)}`).toBeCloseTo(1, 6);
    }
  });

  it("is asymmetric, so the silhouette is not a shape the eye can name", () => {
    // Four diagonal bearings: an ellipse, a rounded rectangle, or any other symmetric outline would
    // measure the same on all four. The coastline must not.
    const bearings = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    const distances = bearings.map((angle) => {
      const rim = islandRimPoint(angle, ISLAND_SHAPE);
      return Math.hypot(rim.worldX - WORLD_CENTER_WORLD.worldX, rim.worldZ - WORLD_CENTER_WORLD.worldZ);
    });
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(2);
  });

  it("keeps the whole reserved field on land", () => {
    // The field the catalogue can hand out has to be inside the shoreline at every corner, or a plot
    // bought at the edge would be a plot in the sea.
    for (const tile of [
      { x: FENCE.bounds.minX, y: FENCE.bounds.minY },
      { x: FENCE.bounds.maxX, y: FENCE.bounds.minY },
      { x: FENCE.bounds.minX, y: FENCE.bounds.maxY },
      { x: FENCE.bounds.maxX, y: FENCE.bounds.maxY }
    ]) {
      const world = tileToWorld(tile, frame);
      expect(islandRadiusAt(world.worldX, world.worldZ, ISLAND_SHAPE), `${String(tile.x)},${String(tile.y)}`).toBeLessThan(0.85);
    }
  });
});

describe("terrain elevation", () => {
  it("is level on every area the farm works", () => {
    for (const area of TERRAIN_SHAPE.flatAreas) {
      // Every corner of every flat rectangle, pulled a little way inside it.
      for (const signX of [-1, 1]) {
        for (const signZ of [-1, 1]) {
          const worldX = area.centerWorldX + signX * area.halfWidthWorld * 0.9;
          const worldZ = area.centerWorldZ + signZ * area.halfDepthWorld * 0.9;
          expect(terrainHeightAt(worldX, worldZ, TERRAIN_SHAPE), `${String(worldX)},${String(worldZ)}`).toBe(0);
        }
      }
    }
  });

  it("is level across the whole reserved field the catalogue can sell", () => {
    // The gameplay grid's whole point is that every tile is the same height as every other, so this
    // walks the field's own corners and centre rather than the flattened rectangles' corners.
    for (let x = 0; x <= 35; x += 5) {
      for (let y = 0; y <= 35; y += 5) {
        const world = tileToWorld({ x, y }, frame);
        expect(terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE), `${String(x)},${String(y)}`).toBe(0);
      }
    }
  });

  it("meets the water at zero height", () => {
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      const rim = islandRimPoint(angle, ISLAND_SHAPE);
      expect(terrainHeightAt(rim.worldX, rim.worldZ, TERRAIN_SHAPE), `angle ${String(angle)}`).toBe(0);
    }
  });

  it("rolls gently between the field and the shore, and saves its height for the volcano", () => {
    let highest = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
      for (const factor of [0.6, 0.7, 0.8, 0.88]) {
        const world = atRadius(angle, factor);
        const height = terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE);
        expect(height, `angle ${String(angle)} at ${String(factor)}`).toBeGreaterThanOrEqual(0);
        // The island's ordinary ground is a couple of metres of swell. The volcano is the one place
        // V12.1 allows to be tall, and it is excluded from this sample by asking whether the point is
        // on the mountain at all.
        if (volcanoRadiusFraction(world.worldX, world.worldZ, VOLCANO_SHAPE) < 1) continue;
        expect(height).toBeLessThanOrEqual(TERRAIN_SHAPE.reliefWorld * 1.4);
        highest = Math.max(highest, height);
      }
    }
    expect(highest).toBeGreaterThan(TERRAIN_SHAPE.reliefWorld * 0.25);
    expect(TERRAIN_SHAPE.reliefWorld).toBeLessThanOrEqual(3);
  });

  it("is higher on the upland than on the coast", () => {
    // The same distance out from the island's centre, once toward the north-west and once toward the
    // south-east: the estate has a high side and a low side, not one uniform ring of hills.
    const upland = atRadius((5 * Math.PI) / 4, 0.78);
    const lowland = atRadius(Math.PI / 4, 0.78);
    expect(uplandOffset(upland.worldX, upland.worldZ, TERRAIN_SHAPE)).toBeGreaterThan(
      uplandOffset(lowland.worldX, lowland.worldZ, TERRAIN_SHAPE)
    );
  });

  it("is a pure function: the same ground is the same height every time", () => {
    const world = atRadius(1.1, 0.8);
    const first = terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE)).toBe(first);
    }
  });
});

describe("flat mask", () => {
  it("is zero inside an area and one far outside every area", () => {
    const area = {
      centerWorldX: 0,
      centerWorldZ: 0,
      halfWidthWorld: 10,
      halfDepthWorld: 10,
      featherWorld: 4
    };
    expect(flatMask(0, 0, [area])).toBe(0);
    expect(flatMask(9, 9, [area])).toBe(0);
    expect(flatMask(40, 0, [area])).toBe(1);
    // Half way through the feather the ground is part way up, not a step.
    const middle = flatMask(12, 0, [area]);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });
});
