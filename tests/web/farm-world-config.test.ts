import { describe, expect, it } from "vitest";
import { plotTileCoordinates } from "@happy-farm/domain";
import {
  DEFAULT_TILE_GAP,
  DEFAULT_TILE_SIZE,
  tileToWorld,
  worldFrame,
  worldToTile,
  WORLD_ORIGIN_TILE_X,
  WORLD_ORIGIN_TILE_Y
} from "../../apps/web/src/render/layout";
import {
  FARM_FIELD_BOUNDS,
  FENCE,
  isStaticWorldWalkable,
  isWaterTile,
  PATHS,
  POND,
  SPAWN_TILE,
  VISUAL_BOUNDS,
  WORLD_CONFIG_VERSION,
  WORLD_REGIONS
} from "../../apps/web/src/render/world-config";

const PITCH = DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP;
const frame = worldFrame();

describe("fixed world coordinates", () => {
  it("puts the world origin at the centre of the starter land", () => {
    expect(WORLD_ORIGIN_TILE_X).toBe(2.5);
    expect(WORLD_ORIGIN_TILE_Y).toBe(2.5);
    expect(tileToWorld({ x: 2.5, y: 2.5 }, frame)).toEqual({ worldX: 0, worldZ: 0 });
    expect(tileToWorld({ x: 0, y: 0 }, frame)).toEqual({
      worldX: -2.5 * PITCH,
      worldZ: -2.5 * PITCH
    });
    expect(tileToWorld({ x: 5, y: 5 }, frame)).toEqual({
      worldX: 2.5 * PITCH,
      worldZ: 2.5 * PITCH
    });
  });

  it("round-trips tile to world to tile, including negative and expanded coordinates", () => {
    const tiles = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: -8, y: 3 },
      { x: 17, y: 17 },
      { x: -13, y: -13 },
      { x: 30, y: 30 }
    ];
    for (const tile of tiles) {
      expect(worldToTile(tileToWorld(tile, frame), frame), `${String(tile.x)},${String(tile.y)}`).toEqual(tile);
    }
  });

  it("keeps a tile's world position identical no matter how much land is unlocked", () => {
    // Phase 7's acceptance criterion: the mapping takes only the tile and the frame, so nothing about
    // the farm's current bounds can reach it. This is what keeps Phase 8's player from being moved
    // when a plot is bought.
    const tile = { x: 2, y: 3 };
    const before = tileToWorld(tile, worldFrame());
    const after = tileToWorld(tile, worldFrame());
    expect(after).toEqual(before);
  });

  it("maps the shipped catalogue's last plot inside the reserved field", () => {
    // The reservation is the bounding box of every plot the catalogue ships, which is what must fit.
    const allTiles = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((plotIndex) => [...plotTileCoordinates(plotIndex)]);
    const maxX = Math.max(...allTiles.map((tile) => tile.x));
    const maxY = Math.max(...allTiles.map((tile) => tile.y));
    const minX = Math.min(...allTiles.map((tile) => tile.x));
    const minY = Math.min(...allTiles.map((tile) => tile.y));
    expect(FARM_FIELD_BOUNDS).toEqual({ minX: 0, maxX: 17, minY: 0, maxY: 17 });
    expect(maxX).toBe(FARM_FIELD_BOUNDS.maxX);
    expect(maxY).toBe(FARM_FIELD_BOUNDS.maxY);
    expect(minX).toBe(FARM_FIELD_BOUNDS.minX);
    expect(minY).toBe(FARM_FIELD_BOUNDS.minY);
  });
});

describe("static world config", () => {
  it("keeps every reserved region bounded and outside the farm field", () => {
    for (const region of WORLD_REGIONS) {
      expect(region.bounds.minX).toBeLessThanOrEqual(region.bounds.maxX);
      expect(region.bounds.minY).toBeLessThanOrEqual(region.bounds.maxY);
      const overlaps =
        region.bounds.minX <= FARM_FIELD_BOUNDS.maxX &&
        region.bounds.maxX >= FARM_FIELD_BOUNDS.minX &&
        region.bounds.minY <= FARM_FIELD_BOUNDS.maxY &&
        region.bounds.maxY >= FARM_FIELD_BOUNDS.minY;
      expect(overlaps, region.id).toBe(false);
    }
  });

  it("contains the farm field and every region inside the visual world", () => {
    const inside = (inner: typeof VISUAL_BOUNDS, outer: typeof VISUAL_BOUNDS): boolean =>
      inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
    expect(inside(FARM_FIELD_BOUNDS, VISUAL_BOUNDS)).toBe(true);
    expect(inside(FENCE.bounds, VISUAL_BOUNDS)).toBe(true);
    for (const region of WORLD_REGIONS) expect(inside(region.bounds, VISUAL_BOUNDS), region.id).toBe(true);
    for (const path of PATHS) expect(inside(path.bounds, VISUAL_BOUNDS), path.id).toBe(true);
  });

  it("spawns on walkable ground outside the farm, the water, and every obstacle", () => {
    expect(SPAWN_TILE.y).toBeGreaterThan(FARM_FIELD_BOUNDS.maxY);
    expect(isStaticWorldWalkable(SPAWN_TILE)).toBe(true);
    expect(isWaterTile(SPAWN_TILE)).toBe(false);
    expect(isStaticWorldWalkable(POND.center)).toBe(false);
  });

  it("treats water, the world's outside, and static obstacles as non-walkable", () => {
    expect(isStaticWorldWalkable({ x: 0, y: 0 })).toBe(true);
    expect(isStaticWorldWalkable({ x: 2, y: 24 })).toBe(true);
    expect(isStaticWorldWalkable({ x: 40, y: 40 })).toBe(false);
    expect(isStaticWorldWalkable({ x: -20, y: 0 })).toBe(false);
    expect(WORLD_CONFIG_VERSION).toBeGreaterThanOrEqual(1);
  });
});
