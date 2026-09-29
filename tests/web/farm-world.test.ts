import { describe, expect, it } from "vitest";
import { plotRing as domainPlotRing, plotTileCoordinates } from "@happy-farm/domain";
import type { PlotDTO } from "@happy-farm/contracts";
import { layoutFarmTiles, type TileCoordinate } from "../../apps/web/src/render/layout";
import {
  buildFarmWorld,
  landFrame,
  plotRing,
  plotSquare,
  previewLockedPlots,
  WORLD_MARGIN_TILES
} from "../../apps/web/src/render/world";

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
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) tiles.push({ x, y });
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
      maxX: 11,
      minY: 0,
      maxY: 11
    });
  });

  it("frames only the unlocked land when there is nothing left to buy", () => {
    expect(landFrame(starterTiles(), [plot(1, true)])).toEqual({
      minX: 0,
      maxX: 5,
      minY: 0,
      maxY: 5
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

  it("sizes the island around the land plus the locked ring and a grass margin", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.inner).toEqual({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    expect(world.outer).toEqual({ minX: 0, maxX: 11, minY: 0, maxY: 11 });
    expect(world.lockedPlots.map((entry) => entry.plotIndex)).toEqual([1, 2, 3]);
    // Outer land is 12 tiles plus a 5-tile margin on each side, in tile pitches.
    expect(world.islandHalfWidthWorld).toBeCloseTo((6 + WORLD_MARGIN_TILES) * 1.08, 6);
    expect(world.islandHalfDepthWorld).toBeCloseTo((6 + WORLD_MARGIN_TILES) * 1.08, 6);
    expect(world.apronWidth).toBeGreaterThan(12);
    expect(world.path).not.toBeNull();
    expect(world.pond).not.toBeNull();
    expect(world.barn).not.toBeNull();
  });

  it("lays locked plot squares outside the unlocked field", () => {
    const world = worldFor(starterTiles(), CATALOGUE);
    expect(world.lockedPlots).toHaveLength(3);
    for (const locked of world.lockedPlots) {
      const overlapsField = locked.minX <= 5 && locked.maxX >= 0 && locked.minY <= 5 && locked.maxY >= 0;
      expect(overlapsField).toBe(false);
    }
  });

  it("is deterministic and keeps scenery out of the playable field", () => {
    const first = worldFor(starterTiles(), CATALOGUE);
    const second = worldFor(starterTiles(), CATALOGUE);
    expect(first.scenery).toEqual(second.scenery);
    expect(first.scenery.length).toBeGreaterThan(10);

    const halfWidth = first.islandHalfWidthWorld;
    const halfDepth = first.islandHalfDepthWorld;
    const fieldHalf = 6 * 1.08;
    for (const entry of first.scenery) {
      expect(Math.abs(entry.worldX)).toBeLessThan(halfWidth);
      expect(Math.abs(entry.worldZ)).toBeLessThan(halfDepth);
      const overField = Math.abs(entry.worldX) < fieldHalf && Math.abs(entry.worldZ) < fieldHalf;
      expect(overField).toBe(false);
    }
  });
});
