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
  TREE_BANDS,
  VISUAL_BOUNDS
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
    expect(world.path).not.toBeNull();
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
    expect(grown.path).toEqual(small.path);
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
      const overField =
        tile.x >= FENCE.bounds.minX - 1.2 &&
        tile.x <= FENCE.bounds.maxX + 1.2 &&
        tile.y >= FENCE.bounds.minY - 1.2 &&
        tile.y <= FENCE.bounds.maxY + 1.2;
      expect(overField, `${entry.kind} at ${String(tile.x)},${String(tile.y)}`).toBe(false);
    }
  });

  it("plants the reserved regions instead of leaving them empty", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    for (const band of TREE_BANDS) {
      const inside = world.scenery.filter((entry) => {
        const tile = worldToTile({ worldX: entry.worldX, worldZ: entry.worldZ }, worldFrame());
        return (
          tile.x >= band.bounds.minX - 1 &&
          tile.x <= band.bounds.maxX + 1 &&
          tile.y >= band.bounds.minY - 1 &&
          tile.y <= band.bounds.maxY + 1
        );
      });
      expect(inside.length, band.id).toBeGreaterThan(0);
    }
  });

  it("furnishes the land the farm has not bought instead of leaving a slab on it", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.lockedScenery.length).toBeGreaterThan(0);
    expect(world.lockedBoundary.length).toBeGreaterThan(0);
    expect(world.lockedScenery).toEqual(worldFor(starterTiles(), CATALOGUE).lockedScenery);

    for (const prop of world.lockedScenery) {
      const tile = worldToTile({ worldX: prop.worldX, worldZ: prop.worldZ }, worldFrame());
      const insideAPlot = world.lockedPlots.some(
        (plot) => tile.x >= plot.minX && tile.x <= plot.maxX && tile.y >= plot.minY && tile.y <= plot.maxY
      );
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
