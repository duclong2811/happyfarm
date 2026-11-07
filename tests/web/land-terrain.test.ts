import { describe, expect, it } from "vitest";
import type { CropStateDTO, FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE, plotTileCoordinates } from "@happy-farm/domain";
import { tileColorFor } from "../../apps/web/src/render/materials";
import { buildFarmSceneInput, tileDrawsSoil } from "../../apps/web/src/render/view-model";

/**
 * Green land: ownership is not terrain.
 *
 * The V14.5.1 correction, as tests. Buying land grants development rights and nothing else - the
 * island stays grass, the starter square is not a giant yellow field, and soil appears only on a cell
 * that is actually cultivated. The colony of a plot purchase is one `farm_tiles` cohort whose only
 * visible effect is that the cells become buildable and plantable.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_own",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function crop(x: number, y: number): CropStateDTO {
  return {
    cropInstanceId: "crop_1",
    definitionId: "crop_carrot",
    tileX: x,
    tileY: y,
    plantedAt: "2026-01-01T00:00:00.000Z",
    growthStage: 0,
    growthProgress: 0.25,
    mature: false,
    version: 1
  };
}

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

function starterTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

const PLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => plot(index, index === 1));

describe("ownership is not terrain", () => {
  it("draws an owned, uncultivated tile as grass", () => {
    // The same tone as a plainly grassy tile: an owned empty cell and grass are indistinguishable.
    for (const [x, y] of [[0, 0], [5, 5], [11, 11]] as const) {
      expect(tileColorFor("SOIL", false, x, y)).toBe(tileColorFor("GRASS", false, x, y));
    }
  });

  it("draws a cultivated tile as local soil", () => {
    for (const [x, y] of [[0, 0], [5, 5], [11, 11]] as const) {
      expect(tileColorFor("SOIL", true, x, y)).not.toBe(tileColorFor("SOIL", false, x, y));
    }
  });

  it("never draws the starter square as a field", () => {
    const scene = buildFarmSceneInput({
      tiles: starterTiles().map((entry) => tile(entry.x, entry.y)),
      crops: [],
      trees: [],
      plots: PLOTS,
      selected: null
    });
    expect(scene.tiles).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(scene.tiles.filter(tileDrawsSoil)).toEqual([]);
  });

  it("keeps a newly purchased cell as grass until it is planted", () => {
    const purchased = [...starterTiles(), ...plotTileCoordinates(1)];
    const before = buildFarmSceneInput({
      tiles: purchased.map((entry) => tile(entry.x, entry.y)),
      crops: [],
      trees: [],
      plots: PLOTS,
      selected: null
    });
    expect(before.tiles.filter(tileDrawsSoil)).toEqual([]);

    const planted = plotTileCoordinates(1)[0];
    if (planted === undefined) throw new Error("plot 1 must have cells");
    const after = buildFarmSceneInput({
      tiles: purchased.map((entry) => tile(entry.x, entry.y)),
      crops: [crop(planted.x, planted.y)],
      trees: [],
      plots: PLOTS,
      selected: null
    });
    const soil = after.tiles.filter(tileDrawsSoil);
    expect(soil).toHaveLength(1);
    expect(soil[0]?.tileX).toBe(planted.x);
    expect(soil[0]?.tileY).toBe(planted.y);
  });

  it("stops the world from carrying ownership-derived ground rectangles", () => {
    const scene = buildFarmSceneInput({
      tiles: starterTiles().map((entry) => tile(entry.x, entry.y)),
      crops: [],
      trees: [],
      plots: PLOTS,
      selected: null
    });
    expect(Object.keys(scene.world)).not.toContain("apron");
    expect(Object.keys(scene.world)).not.toContain("bed");
    // The field's own bounds still exist - they frame the camera and place the plot squares - but
    // they are bounds, not a surface.
    expect(scene.world.inner).not.toBeNull();
  });
});
