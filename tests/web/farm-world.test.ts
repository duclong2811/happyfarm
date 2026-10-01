import { describe, expect, it } from "vitest";
import {
  INITIAL_LAND_SIZE,
  PLOT_TILE_SIZE,
  plotRing as domainPlotRing,
  plotTileCoordinates
} from "@happy-farm/domain";
import type { PlotDTO } from "@happy-farm/contracts";
import { layoutFarmTiles, type TileCoordinate } from "../../apps/web/src/render/layout";
import { worldFrame, worldToTile } from "../../apps/web/src/render/layout";
import {
  APRON_MARGIN_TILES,
  buildFarmWorld,
  landFrame,
  plotRing,
  plotSquare,
  previewLockedPlots,
} from "../../apps/web/src/render/world";
import {
  FENCE,
  ISLAND_SHORE_MARGIN_TILES,
  LANDMARKS,
  POND,
  ROADS,
  VISUAL_BOUNDS,
  WOODLANDS
} from "../../apps/web/src/render/world-config";

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 100 * plotIndex,
    requiredLevel: 1,
    unlocked
  };
}

function starterTiles(): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

function worldFor(tiles: readonly TileCoordinate[], plots: readonly PlotDTO[]) {
  const frame = landFrame(tiles, plots);
  const layout = layoutFarmTiles(tiles, frame === null ? {} : { frame });
  return buildFarmWorld({ layout, tiles, plots });
}

const CATALOGUE = [plot(1, false), plot(2, false), plot(3, false), plot(4, false), plot(5, false)];

describe("plot square mirror", () => {
  it("matches the domain's deterministic plot geometry", () => {
    for (let plotIndex = 1; plotIndex <= 20; plotIndex += 1) {
      const coordinates = plotTileCoordinates(plotIndex);
      const xs = coordinates.map((coordinate) => coordinate.x);
      const ys = coordinates.map((coordinate) => coordinate.y);
      expect(plotSquare(plotIndex)).toEqual({
        plotIndex,
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      });
    }
  });

  it("matches the domain's ring numbering", () => {
    for (let plotIndex = 1; plotIndex <= 20; plotIndex += 1) {
      expect(plotRing(plotIndex)).toBe(domainPlotRing(plotIndex));
    }
  });
});

describe("previewLockedPlots", () => {
  it("previews only the next ring of locked land", () => {
    expect(previewLockedPlots(CATALOGUE).map((entry) => entry.plotIndex)).toEqual([1, 2, 3]);
  });

  it("moves outward once the first ring is owned", () => {
    const plots = [plot(1, true), plot(2, true), plot(3, true), plot(4, false), plot(5, false)];
    expect(previewLockedPlots(plots).map((entry) => entry.plotIndex)).toEqual([4, 5]);
  });

  it("previews nothing once every listed plot is owned", () => {
    expect(previewLockedPlots([plot(1, true), plot(2, true)])).toEqual([]);
  });
});

describe("landFrame", () => {
  it("frames the starter field together with the next locked ring", () => {
    expect(landFrame(starterTiles(), CATALOGUE)).toEqual({
      minX: 0,
      maxX: PLOT_TILE_SIZE * 2 - 1,
      minY: 0,
      maxY: PLOT_TILE_SIZE * 2 - 1
    });
  });

  it("frames only the unlocked land when there is nothing left to buy", () => {
    expect(landFrame(starterTiles(), [plot(1, true)])).toEqual({
      minX: 0,
      maxX: INITIAL_LAND_SIZE - 1,
      minY: 0,
      maxY: INITIAL_LAND_SIZE - 1
    });
  });
});

describe("buildFarmWorld", () => {
  it("returns an empty world before any land exists", () => {
    const world = worldFor([], []);
    expect(world.outer).toBeNull();
    expect(world.lockedPlots).toEqual([]);
    expect(world.scenery).toEqual([]);
    expect(world.pond).toBeNull();
    expect(world.barn).toBeNull();
  });

  it("sizes the island from the fixed world config, not from how much land is owned", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.inner).toEqual({
      minX: 0,
      maxX: INITIAL_LAND_SIZE - 1,
      minY: 0,
      maxY: INITIAL_LAND_SIZE - 1
    });
    expect(world.outer).toEqual({
      minX: 0,
      maxX: PLOT_TILE_SIZE * 2 - 1,
      minY: 0,
      maxY: PLOT_TILE_SIZE * 2 - 1
    });
    expect(world.lockedPlots.map((entry) => entry.plotIndex)).toEqual([1, 2, 3]);
    // The static world is a function of the config, in tile pitches. The island is the visual bounds
    // plus its shore margin: the rectangle the reserves fit inside, plus the beach around it.
    expect(world.islandHalfWidthWorld).toBeCloseTo(
      ((VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * 1.08,
      6
    );
    expect(world.islandHalfDepthWorld).toBeCloseTo(
      ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2 + ISLAND_SHORE_MARGIN_TILES) * 1.08,
      6
    );
    expect(world.roads.length).toBe(ROADS.length);
    expect(world.pond).not.toBeNull();
    expect(world.barn).not.toBeNull();
    expect(world.meadows.length).toBeGreaterThan(0);
    // The default view frames the farm, and the island - which the camera can still zoom out to - is
    // visibly larger than it. That ratio is what stops the field from looking like a patch on nothing.
    expect(world.farmHalfExtentWorld).toBeGreaterThan(0);
    expect(world.farmHalfExtentWorld).toBeLessThan(world.islandHalfWidthWorld);
  });

  it("keeps the whole static world fixed when the farm grows", () => {
    // Phase 7's acceptance test: buying land must not move the world underneath the player.
    const small = worldFor(starterTiles(), CATALOGUE);
    const grownTiles = [...starterTiles(), ...plotTileCoordinates(1), ...plotTileCoordinates(2)];
    const grown = worldFor(grownTiles, [plot(1, true), plot(2, true), ...CATALOGUE.slice(2)]);

    expect(grown.inner).not.toEqual(small.inner);
    expect(grown.islandHalfWidthWorld).toBe(small.islandHalfWidthWorld);
    expect(grown.islandHalfDepthWorld).toBe(small.islandHalfDepthWorld);
    expect(grown.centerWorldX).toBe(small.centerWorldX);
    expect(grown.centerWorldZ).toBe(small.centerWorldZ);
    expect(grown.pond).toEqual(small.pond);
    expect(grown.barn).toEqual(small.barn);
    expect(grown.roads).toEqual(small.roads);
    expect(grown.scenery).toEqual(small.scenery);
    expect(grown.meadows).toEqual(small.meadows);
    expect(grown.landmarks).toEqual(small.landmarks);
    expect(grown.terrain).toEqual(small.terrain);
    // The apron and the bed are the exception, and deliberately so: they follow the land the farm
    // owns, which is why the alpha's field sat in the middle of a paved yard.
    expect(grown.apron).not.toEqual(small.apron);
    expect(grown.bed).not.toEqual(small.bed);
  });

  it("keeps the cultivated apron around the field the farm owns, not the whole reserve", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.apron).not.toBeNull();
    expect(world.bed).not.toBeNull();
    const apron = world.apron;
    if (apron === null) throw new Error("the starter farm must have an apron");
    const bed = world.bed;
    if (bed === null) throw new Error("the starter farm must have a bed");
    // Twelve tiles of field, plus the margin on both sides.
    expect(apron.widthWorld).toBeCloseTo((INITIAL_LAND_SIZE + APRON_MARGIN_TILES * 2) * 1.08, 6);
    expect(apron.depthWorld).toBeCloseTo(apron.widthWorld, 6);
    // The bed is the tile area itself, so a gap between two slabs shows soil rather than the apron.
    expect(bed.widthWorld).toBeCloseTo(INITIAL_LAND_SIZE * 1.08, 6);
    expect(apron.widthWorld).toBeGreaterThan(bed.widthWorld);
    // And the whole thing is far smaller than the fence it stands inside.
    expect(apron.widthWorld).toBeLessThan(FENCE.bounds.maxX - FENCE.bounds.minX);
  });

  it("lays locked plot squares outside the unlocked field", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.lockedPlots).toHaveLength(3);
    for (const locked of world.lockedPlots) {
      const overlapsField =
        locked.minX <= INITIAL_LAND_SIZE - 1 &&
        locked.maxX >= 0 &&
        locked.minY <= INITIAL_LAND_SIZE - 1 &&
        locked.maxY >= 0;
      expect(overlapsField).toBe(false);
    }
  });

  it("is deterministic and keeps scenery out of the playable field", () => {
    const first = worldFor(starterTiles(), CATALOGUE);
    const second = worldFor(starterTiles(), CATALOGUE);
    expect(first.scenery).toEqual(second.scenery);
    // Denser than the alpha's twelve-odd props: an edge tree line, the orchard rows, and the ranch
    // windbreak are all in here.
    expect(first.scenery.length).toBeGreaterThan(80);

    for (const entry of first.scenery) {
      const tile = worldToTile({ worldX: entry.worldX, worldZ: entry.worldZ }, worldFrame());
      const insideIsland =
        tile.x >= VISUAL_BOUNDS.minX &&
        tile.x <= VISUAL_BOUNDS.maxX &&
        tile.y >= VISUAL_BOUNDS.minY &&
        tile.y <= VISUAL_BOUNDS.maxY;
      expect(insideIsland, `${entry.kind} at ${String(tile.x)},${String(tile.y)}`).toBe(true);
      // The land the farm works is the one place nothing grows. The rest of the reserve is land the
      // catalogue has not sold yet, and unbought land is countryside rather than a cleared board.
      const overOwnedLand =
        tile.x >= -1 - APRON_MARGIN_TILES &&
        tile.x <= INITIAL_LAND_SIZE - 1 + APRON_MARGIN_TILES &&
        tile.y >= -1 - APRON_MARGIN_TILES &&
        tile.y <= INITIAL_LAND_SIZE - 1 + APRON_MARGIN_TILES;
      expect(overOwnedLand, `${entry.kind} at ${String(tile.x)},${String(tile.y)}`).toBe(false);
    }
  });

  it("grows the island's cover in clusters, and leaves most of the land open", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    // The woods are landscape now, not districts, and they are still the island's one large mass:
    // count the trees that stand inside one.
    const frame = worldFrame();
    const inWood = (patch: (typeof WOODLANDS)[number]): number =>
      world.scenery.filter((entry) => {
        const tile = worldToTile({ worldX: entry.worldX, worldZ: entry.worldZ }, frame);
        const dx = tile.x - patch.center.x;
        const dz = tile.y - patch.center.y;
        const cos = Math.cos(-patch.rotationY);
        const sin = Math.sin(-patch.rotationY);
        const localX = (dx * cos - dz * sin) / patch.radiusX;
        const localZ = (dx * sin + dz * cos) / patch.radiusY;
        return Math.hypot(localX, localZ) <= 1;
      }).length;
    const wooded = WOODLANDS.reduce((total, patch) => total + inWood(patch), 0);
    expect(wooded).toBeGreaterThan(20);
    // Undeveloped, not overgrown: the island is mostly open ground with groves standing in it.
    expect(world.scenery.length).toBeLessThan(600);
  });

  it("keeps the roads off the farmland and inside the island", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.roads.length).toBe(ROADS.length);
    for (const road of world.roads) {
      expect(road.samples.length, road.id).toBeGreaterThan(2);
      expect(road.widthWorld, road.id).toBeGreaterThan(0);
      // The farm track is a `PATH` and is the one route allowed to cross the reserve: it is the way
      // between two fields, not a road through the land the catalogue sells.
      if (road.kind === "PATH") continue;
      for (const sample of road.samples) {
        const tile = worldToTile({ worldX: sample.worldX, worldZ: sample.worldZ }, worldFrame());
        const overField =
          tile.x >= FENCE.bounds.minX - 1.2 &&
          tile.x <= FENCE.bounds.maxX + 1.2 &&
          tile.y >= FENCE.bounds.minY - 1.2 &&
          tile.y <= FENCE.bounds.maxY + 1.2;
        expect(overField, `${road.id} at ${String(tile.x)},${String(tile.y)}`).toBe(false);
      }
    }
  });

  it("furnishes the land the farm has not bought instead of leaving a slab on it", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.lockedScenery.length).toBeGreaterThan(0);
    expect(world.lockedScenery).toEqual(worldFor(starterTiles(), CATALOGUE).lockedScenery);

    for (const prop of world.lockedScenery) {
      const tile = worldToTile({ worldX: prop.worldX, worldZ: prop.worldZ }, worldFrame());
      // Every plot the catalogue has not sold, not only the ring it is offering right now: the whole
      // unclaimed reserve has to read as rough land rather than as an empty lawn.
      const insideAPlot = world.lockedPlots.some(
        (plot) => tile.x >= plot.minX && tile.x <= plot.maxX && tile.y >= plot.minY && tile.y <= plot.maxY
      ) || [1, 2, 3, 4, 5].some((plotIndex) => {
        const square = plotSquare(plotIndex);
        return tile.x >= square.minX && tile.x <= square.maxX && tile.y >= square.minY && tile.y <= square.maxY;
      });
      expect(insideAPlot, `${prop.kind} at ${String(tile.x)},${String(tile.y)}`).toBe(true);
      // Wild growth stands on the ground the same way open-country scenery does, so a prop on a rise
      // is not left floating at the plateau's height.
      expect(prop.worldY).toBeGreaterThanOrEqual(0);
    }
  });

  it("places landmarks clear of the field, the paths, the pond, and each other", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.landmarks.map((landmark) => landmark.id)).toEqual(LANDMARKS.map((landmark) => landmark.id));

    for (const landmark of world.landmarks) {
      const tile = landmark.tile;
      const insideField =
        tile.x >= FENCE.bounds.minX && tile.x <= FENCE.bounds.maxX && tile.y >= FENCE.bounds.minY && tile.y <= FENCE.bounds.maxY;
      expect(insideField, landmark.id).toBe(false);
      const pondDx = (tile.x - POND.center.x) / (POND.radiusX + 2);
      const pondDy = (tile.y - POND.center.y) / (POND.radiusY + 2);
      expect(pondDx * pondDx + pondDy * pondDy, landmark.id).toBeGreaterThan(1);
    }

    for (let left = 0; left < world.landmarks.length; left += 1) {
      for (let right = left + 1; right < world.landmarks.length; right += 1) {
        const a = world.landmarks[left];
        const b = world.landmarks[right];
        if (a === undefined || b === undefined) continue;
        const gap = Math.hypot(a.worldX - b.worldX, a.worldZ - b.worldZ);
        expect(gap, `${a.id}/${b.id}`).toBeGreaterThan(a.blockingRadiusWorld + b.blockingRadiusWorld);
      }
    }
  });
});
