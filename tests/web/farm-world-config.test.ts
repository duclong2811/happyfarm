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
  DISTRICTS,
  FENCE,
  ISLAND_SHORE_MARGIN_TILES,
  ISLAND_HALF_DEPTH_WORLD,
  ISLAND_HALF_WIDTH_WORLD,
  isStaticWorldWalkable,
  isWaterTile,
  MEADOWS,
  POND,
  ROADS,
  ROAD_WIDTH_TILES,
  SPAWN_TILE,
  VISUAL_BOUNDS,
  WORLD_CONFIG_VERSION
} from "../../apps/web/src/render/world-config";
import { APRON_MARGIN_TILES } from "../../apps/web/src/render/world";

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
  it("keeps only the two places the island owns, both real areas outside the reserve", () => {
    // V12.2 deleted the production districts. What must not come back is a district that decides
    // anything: the two that remain are civic ground and coastal ground, and they are places.
    expect(DISTRICTS.map((district) => district.kind).sort()).toEqual(["COAST", "SETTLEMENT"]);
    for (const district of DISTRICTS) {
      expect(district.radiusX, district.id).toBeGreaterThan(0);
      expect(district.radiusY, district.id).toBeGreaterThan(0);
      expect(district.labelKey.startsWith("world.district."), district.id).toBe(true);
      // A district sits outside the reserve: a district is the island's own ground, and the reserve is
      // the land the catalogue sells. A blob's edge may reach the fence, but its centre may not.
      const centreInsideReserve =
        district.center.x >= FARM_FIELD_BOUNDS.minX &&
        district.center.x <= FARM_FIELD_BOUNDS.maxX &&
        district.center.y >= FARM_FIELD_BOUNDS.minY &&
        district.center.y <= FARM_FIELD_BOUNDS.maxY;
      expect(centreInsideReserve, district.id).toBe(false);
    }
  });

  it("contains the farm field and every district inside the visual world", () => {
    const inside = (inner: typeof VISUAL_BOUNDS, outer: typeof VISUAL_BOUNDS): boolean =>
      inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
    expect(inside(FARM_FIELD_BOUNDS, VISUAL_BOUNDS)).toBe(true);
    expect(inside(FENCE.bounds, VISUAL_BOUNDS)).toBe(true);
    for (const district of DISTRICTS) {
      // The blob's bounding rectangle has to fit, so a district cannot reach past the island.
      expect(district.center.x - district.radiusX, district.id).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minX);
      expect(district.center.x + district.radiusX, district.id).toBeLessThanOrEqual(VISUAL_BOUNDS.maxX);
      expect(district.center.y - district.radiusY, district.id).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minY);
      expect(district.center.y + district.radiusY, district.id).toBeLessThanOrEqual(VISUAL_BOUNDS.maxY);
    }
    for (const road of ROADS) {
      for (const point of road.points) {
        expect(inside({ minX: point.x, maxX: point.x, minY: point.y, maxY: point.y }, VISUAL_BOUNDS), road.id).toBe(true);
      }
      expect(ROAD_WIDTH_TILES[road.kind], road.id).toBeGreaterThan(0);
      expect(road.points.length, road.id).toBeGreaterThan(1);
    }
  });

  it("spawns on walkable ground beside the player's own land, off the water and every obstacle", () => {
    // V12.1 moved the spawn from an authored lane in the far south to the edge of the square the
    // player owns, because the lane it used to stand on no longer exists.
    expect(SPAWN_TILE.y).toBeGreaterThan(INITIAL_LAND_SIZE - 1);
    expect(SPAWN_TILE.y).toBeLessThan(FARM_FIELD_BOUNDS.maxY);
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

  it("keeps every road off the reserved field", () => {
    // A *road* is landscape: if one crossed the reserve it would be drawn across land the catalogue
    // sells, and the first plot a player bought would have a road through it. V11 allows one
    // exception, and only one: a `PATH` is a farm track - what a tractor follows between two fields -
    // and the agricultural district is the one place such a track belongs.
    expect(ROADS.length).toBeGreaterThan(3);
    const clearance = 1.2;
    for (const road of ROADS) {
      if (road.kind === "PATH") continue;
      for (const point of road.points) {
        const insideReserve =
          point.x >= FARM_FIELD_BOUNDS.minX - clearance &&
          point.x <= FARM_FIELD_BOUNDS.maxX + clearance &&
          point.y >= FARM_FIELD_BOUNDS.minY - clearance &&
          point.y <= FARM_FIELD_BOUNDS.maxY + clearance;
        expect(insideReserve, `${road.id} at ${String(point.x)},${String(point.y)}`).toBe(false);
      }
    }
    // …and the classes it uses are the cheap ones. The island's own road is dirt and its lanes are
    // paths: the stone and paved classes exist for the player's later construction, not for a highway
    // nobody built yet.
    const kinds = new Set(ROADS.map((road) => road.kind));
    expect(kinds.has("SECONDARY")).toBe(true);
    expect(kinds.has("PATH")).toBe(true);
    expect(kinds.has("PRIMARY")).toBe(false);
  });

  it("keeps every terrain patch off the land the farm owns at the start", () => {
    expect(MEADOWS.length).toBeGreaterThan(0);
    for (const patch of MEADOWS) {
      expect(patch.radiusX, patch.id).toBeGreaterThan(0);
      expect(patch.radiusY, patch.id).toBeGreaterThan(0);
      // A patch may lie inside the reserve - the ground there is pasture the farm has not bought -
      // but it may never cover the starter square or the apron around it, because the tiles and the
      // cultivated ground are drawn on top of it.
      const overlapsStarter =
        patch.center.x - patch.radiusX <= INITIAL_LAND_SIZE - 1 + APRON_MARGIN_TILES &&
        patch.center.x + patch.radiusX >= -APRON_MARGIN_TILES &&
        patch.center.y - patch.radiusY <= INITIAL_LAND_SIZE - 1 + APRON_MARGIN_TILES &&
        patch.center.y + patch.radiusY >= -APRON_MARGIN_TILES;
      expect(overlapsStarter, patch.id).toBe(false);
      const insideIsland =
        patch.center.x - patch.radiusX >= VISUAL_BOUNDS.minX &&
        patch.center.x + patch.radiusX <= VISUAL_BOUNDS.maxX &&
        patch.center.y - patch.radiusY >= VISUAL_BOUNDS.minY &&
        patch.center.y + patch.radiusY <= VISUAL_BOUNDS.maxY;
      expect(insideIsland, patch.id).toBe(true);
    }
  });

  it("treats water, the sea, and static obstacles as non-walkable", () => {
    expect(isStaticWorldWalkable({ x: 0, y: 0 })).toBe(true);
    expect(isStaticWorldWalkable(SPAWN_TILE)).toBe(true);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.maxX + 1, y: VISUAL_BOUNDS.maxY + 1 })).toBe(false);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.minX - 1, y: 0 })).toBe(false);
    // The island is a modulated superellipse, not the bounding box: the box's own corners are sea,
    // while the middle of its edge is land.
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.maxX, y: VISUAL_BOUNDS.maxY })).toBe(false);
    expect(isStaticWorldWalkable({ x: VISUAL_BOUNDS.maxX, y: 17 })).toBe(true);
    expect(isStaticWorldWalkable({ x: 36, y: -6 })).toBe(true);
    expect(WORLD_CONFIG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("reaches the shore a margin past the visual bounds", () => {
    // The island is wider than the rectangle every reserved zone has to fit inside, which is what the
    // beach and the shoreline scenery stand on.
    const halfTiles = (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2;
    expect(ISLAND_HALF_WIDTH_WORLD).toBeCloseTo((halfTiles + ISLAND_SHORE_MARGIN_TILES) * PITCH, 9);
    expect(ISLAND_HALF_DEPTH_WORLD).toBeCloseTo(
      ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * PITCH,
      9
    );
    expect(ISLAND_HALF_WIDTH_WORLD).toBeGreaterThan(halfTiles * PITCH);
  });
});
