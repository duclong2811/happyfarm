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
  buildFarmWorld,
  landFrame,
  plotRing,
  plotSquare,
  previewLockedPlots,
} from "../../apps/web/src/render/world";
import { FENCE, TREE_BANDS, VISUAL_BOUNDS } from "../../apps/web/src/render/world-config";

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
    // The static world is a function of the config, in tile pitches, and the island is one tile wider
    // on each side than the reserved field is with the locked ring previewed.
    expect(world.islandHalfWidthWorld).toBeCloseTo(
      ((VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) / 2) * 1.08,
      6
    );
    expect(world.islandHalfDepthWorld).toBeCloseTo(
      ((VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1) / 2) * 1.08,
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
    expect(grown.apronWidth).toBe(small.apronWidth);
    expect(grown.centerWorldX).toBe(small.centerWorldX);
    expect(grown.centerWorldZ).toBe(small.centerWorldZ);
    expect(grown.pond).toEqual(small.pond);
    expect(grown.barn).toEqual(small.barn);
    expect(grown.path).toEqual(small.path);
    expect(grown.scenery).toEqual(small.scenery);
    expect(grown.meadows).toEqual(small.meadows);
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
});
