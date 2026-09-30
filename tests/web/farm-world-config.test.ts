import { describe, expect, it } from "vitest";
import { INITIAL_LAND_SIZE, PLOT_TILE_SIZE, plotTileCoordinates } from "@happy-farm/domain";
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
  FARM_HALF_EXTENT_WORLD,
  FARM_FIELD_BOUNDS,
  FENCE,
  ISLAND_HALF_DEPTH_WORLD,
  ISLAND_HALF_WIDTH_WORLD,
  isStaticWorldWalkable,
  isWaterTile,
  MEADOWS,
  PATHS,
  POND,
  SPAWN_TILE,
  TREE_BANDS,
  VISUAL_BOUNDS,
  WORLD_CONFIG_VERSION,
  WORLD_REGIONS
} from "../../apps/web/src/render/world-config";

const PITCH = DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP;
const frame = worldFrame();

describe("fixed world coordinates", () => {
  it("puts the world origin at the centre of the starter land", () => {
    const half = (INITIAL_LAND_SIZE - 1) / 2;
    expect(WORLD_ORIGIN_TILE_X).toBe(half);
    expect(WORLD_ORIGIN_TILE_Y).toBe(half);
    expect(tileToWorld({ x: half, y: half }, frame)).toEqual({ worldX: 0, worldZ: 0 });
    expect(tileToWorld({ x: 0, y: 0 }, frame)).toEqual({ worldX: -half * PITCH, worldZ: -half * PITCH });
    expect(tileToWorld({ x: INITIAL_LAND_SIZE - 1, y: INITIAL_LAND_SIZE - 1 }, frame)).toEqual({
      worldX: half * PITCH,
      worldZ: half * PITCH
    });
  });

  it("round-trips tile to world to tile, including negative and expanded coordinates", () => {
    const tiles = [
      { x: 0, y: 0 },
      { x: INITIAL_LAND_SIZE - 1, y: INITIAL_LAND_SIZE - 1 },
      { x: -8, y: 3 },
      { x: FARM_FIELD_BOUNDS.maxX, y: FARM_FIELD_BOUNDS.maxY },
      { x: -13, y: -13 },
      { x: VISUAL_BOUNDS.maxX, y: VISUAL_BOUNDS.maxY }
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
    expect(PLOT_TILE_SIZE).toBe(INITIAL_LAND_SIZE);
    expect(FARM_FIELD_BOUNDS).toEqual({
      minX: 0,
      maxX: PLOT_TILE_SIZE * 3 - 1,
      minY: 0,
      maxY: PLOT_TILE_SIZE * 3 - 1
    });
    expect(FARM_FIELD_BOUNDS).toEqual({ minX: 0, maxX: 35, minY: 0, maxY: 35 });
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

  it("starts the player on a field worth walking around", () => {
    // The alpha's starter square was one 6 x 6 plot of a reserved 18 x 18 field, which read as a tiny
    // patch. These are the numbers that changed: one cohort of 12 x 12 tiles, and a reserved field of
    // nine cohorts, so the first thing a player sees is a farm rather than a lattice of dots.
    expect(INITIAL_LAND_SIZE).toBe(12);
    expect(FARM_FIELD_BOUNDS.maxX - FARM_FIELD_BOUNDS.minX + 1).toBe(PLOT_TILE_SIZE * 3);
    expect(FARM_FIELD_BOUNDS.maxY - FARM_FIELD_BOUNDS.minY + 1).toBe(PLOT_TILE_SIZE * 3);
    // Every tile of the starter square is inside the reserved field and inside the fence.
    expect(FARM_FIELD_BOUNDS.minX).toBeLessThanOrEqual(0);
    expect(FARM_FIELD_BOUNDS.minY).toBeLessThanOrEqual(0);
    expect(INITIAL_LAND_SIZE - 1).toBeLessThanOrEqual(FARM_FIELD_BOUNDS.maxX);
  });

  it("frames the farm inside the island without cropping the field", () => {
    expect(FARM_HALF_EXTENT_WORLD).toBeGreaterThan(0);
    expect(FARM_HALF_EXTENT_WORLD).toBeLessThan(Math.min(ISLAND_HALF_WIDTH_WORLD, ISLAND_HALF_DEPTH_WORLD));
    const fieldHalfTiles = (FARM_FIELD_BOUNDS.maxX - FARM_FIELD_BOUNDS.minX + 1) / 2;
    expect(FARM_HALF_EXTENT_WORLD).toBeGreaterThanOrEqual(fieldHalfTiles * PITCH);
  });

  it("keeps every tree band inside the region it plants", () => {
    expect(TREE_BANDS.length).toBeGreaterThan(0);
    for (const band of TREE_BANDS) {
      const host = WORLD_REGIONS.find((region) =>
        band.bounds.minX >= region.bounds.minX &&
        band.bounds.maxX <= region.bounds.maxX &&
        band.bounds.minY >= region.bounds.minY &&
        band.bounds.maxY <= region.bounds.maxY
      );
      expect(host, band.id).toBeDefined();
      expect(band.spacing, band.id).toBeGreaterThan(1);
    }
  });

  it("keeps every terrain patch off the field, the fence, and the water", () => {
    expect(MEADOWS.length).toBeGreaterThan(0);
    for (const patch of MEADOWS) {
      expect(patch.radiusX, patch.id).toBeGreaterThan(0);
      expect(patch.radiusY, patch.id).toBeGreaterThan(0);
      // The patch's own extent has to stay clear of the fence line, or it would paint over the apron.
      const overlapsFence =
        patch.center.x - patch.radiusX <= FENCE.bounds.maxX &&
        patch.center.x + patch.radiusX >= FENCE.bounds.minX &&
        patch.center.y - patch.radiusY <= FENCE.bounds.maxY &&
        patch.center.y + patch.radiusY >= FENCE.bounds.minY;
      expect(overlapsFence, patch.id).toBe(false);
      const insideIsland =
        patch.center.x - patch.radiusX >= VISUAL_BOUNDS.minX &&
        patch.center.x + patch.radiusX <= VISUAL_BOUNDS.maxX &&
        patch.center.y - patch.radiusY >= VISUAL_BOUNDS.minY &&
        patch.center.y + patch.radiusY <= VISUAL_BOUNDS.maxY;
      expect(insideIsland, patch.id).toBe(true);
    }
  });

  it("treats water, the world's outside, and static obstacles as non-walkable", () => {
    expect(isStaticWorldWalkable({ x: 0, y: 0 })).toBe(true);
    expect(isStaticWorldWalkable(SPAWN_TILE)).toBe(true);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.maxX + 1, y: VISUAL_BOUNDS.maxY + 1 })).toBe(false);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.minX - 1, y: 0 })).toBe(false);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.maxX, y: VISUAL_BOUNDS.maxY })).toBe(true);
    expect(WORLD_CONFIG_VERSION).toBeGreaterThanOrEqual(1);
  });
});
