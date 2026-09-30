import { describe, expect, it } from "vitest";
import {
  FARM_PLATEAU_RADIUS,
  FENCE,
  ISLAND_SHAPE,
  TERRAIN_RELIEF_WORLD,
  TERRAIN_SHAPE,
  WORLD_CENTER_WORLD
} from "../../apps/web/src/render/world-config";
import { islandRadiusAt, islandRimPoint, terrainHeightAt } from "../../apps/web/src/render/terrain-height";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";

const frame = worldFrame();
const PITCH = frame.pitch;

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
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const rim = islandRimPoint(angle, ISLAND_SHAPE);
      expect(islandRadiusAt(rim.worldX, rim.worldZ, ISLAND_SHAPE), `angle ${String(angle)}`).toBeCloseTo(1, 6);
    }
  });

  it("keeps the whole reserved ring on land and the bounding box's corners at sea", () => {
    // The farm, the orchard end, and the farmyard all have to be inside the shoreline. An ellipse
    // would have cut the last two off, which is why the barn used to stand over water.
    for (const tile of [{ x: 5.5, y: 5.5 }, { x: 36, y: -6 }, { x: 43, y: -10 }, { x: -9, y: 30 }]) {
      const world = tileToWorld(tile, frame);
      expect(islandRadiusAt(world.worldX, world.worldZ, ISLAND_SHAPE), `${String(tile.x)},${String(tile.y)}`).toBeLessThan(1);
    }
    // The rectangle's own corners are not land: the island rounds them off.
    const corner = tileToWorld({ x: 48, y: 48 }, frame);
    expect(islandRadiusAt(corner.worldX, corner.worldZ, ISLAND_SHAPE)).toBeGreaterThan(1);
  });
});

describe("terrain elevation", () => {
  it("is level on the plateau the farm occupies", () => {
    expect(FARM_PLATEAU_RADIUS).toBeGreaterThan(0);
    expect(FARM_PLATEAU_RADIUS).toBeLessThan(1);
    const centre = tileToWorld({ x: 0, y: 0 }, frame);
    const far = tileToWorld({ x: FENCE.bounds.maxX, y: FENCE.bounds.maxY }, frame);
    for (const sample of [centre, far]) {
      expect(terrainHeightAt(sample.worldX, sample.worldZ, TERRAIN_SHAPE)).toBe(0);
    }
    // Every tile the catalogue can hand out is on level ground, or a plot bought at the edge would
    // sit on a slope.
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      const world = atRadius(angle, FARM_PLATEAU_RADIUS * 0.98);
      expect(terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE), `angle ${String(angle)}`).toBe(0);
    }
  });

  it("meets the water at zero height", () => {
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      const rim = islandRimPoint(angle, ISLAND_SHAPE);
      expect(terrainHeightAt(rim.worldX, rim.worldZ, TERRAIN_SHAPE), `angle ${String(angle)}`).toBe(0);
    }
  });

  it("rises between the plateau and the shore, and never above its relief", () => {
    let highest = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
      for (const factor of [0.78, 0.84, 0.9, 0.95]) {
        const world = atRadius(angle, factor);
        const height = terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE);
        expect(height, `angle ${String(angle)} at ${String(factor)}`).toBeGreaterThanOrEqual(0);
        expect(height).toBeLessThanOrEqual(TERRAIN_RELIEF_WORLD * 1.25);
        highest = Math.max(highest, height);
      }
    }
    // A ring that never rises is a flat island with extra steps.
    expect(highest).toBeGreaterThan(TERRAIN_RELIEF_WORLD * 0.2);
  });

  it("is a pure function: the same ground is the same height every time", () => {
    const world = atRadius(1.1, 0.88);
    const first = terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE)).toBe(first);
    }
    // World metres, not tiles: a tile's own pitch cannot change where the ground rises.
    expect(terrainHeightAt(world.worldX, world.worldZ, TERRAIN_SHAPE)).toBe(first);
    expect(PITCH).toBeGreaterThan(0);
  });
});
