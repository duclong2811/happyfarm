import { describe, expect, it } from "vitest";
import type { CropStateDTO, FarmTileDTO } from "@happy-farm/contracts";
import { DEFAULT_TILE_GAP, DEFAULT_TILE_SIZE } from "../../apps/web/src/render/layout";
import {
  buildFarmSceneInput,
  type FarmSceneInput,
  type FarmViewState,
  type SceneTile
} from "../../apps/web/src/render/view-model";

const PITCH = DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP;

/**
 * The view model reads a handful of fields, and the wire shape is already covered by the contract
 * and API tests. Building full-but-partial rows here keeps each case about one rendering rule
 * instead of about satisfying zod.
 */
function tile(x: number, y: number, terrainType: FarmTileDTO["terrainType"] = "SOIL"): FarmTileDTO {
  return {
    farmId: "farm_test",
    x,
    y,
    terrainType,
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function crop(x: number, y: number, overrides: Partial<CropStateDTO> = {}): CropStateDTO {
  return {
    cropInstanceId: `crop_${String(x)}_${String(y)}`,
    definitionId: "crop_carrot",
    tileX: x,
    tileY: y,
    plantedAt: "2026-01-01T00:00:00.000Z",
    growthStage: 0,
    growthProgress: 0,
    mature: false,
    version: 1,
    ...overrides
  };
}

function state(overrides: Partial<FarmViewState> = {}): FarmViewState {
  return { tiles: [], crops: [], trees: [], plots: [], selected: null, ...overrides };
}

/** Keeps assertions strict: a missing tile fails loudly instead of comparing against `undefined`. */
function tileAt(input: FarmSceneInput, index: number): SceneTile {
  const sceneTile = input.tiles[index];
  if (sceneTile === undefined) throw new Error(`expected a scene tile at index ${String(index)}`);
  return sceneTile;
}

describe("buildFarmSceneInput", () => {
  it("renders nothing when the server returned no unlocked land", () => {
    const input = buildFarmSceneInput(state());
    expect(input.tiles).toEqual([]);
    expect(input.layout.placements).toEqual([]);
  });

  it("does not draw a crop the server did not also return a tile for", () => {
    const input = buildFarmSceneInput(state({ crops: [crop(3, 3, { growthProgress: 0.9 })] }));
    expect(input.tiles).toEqual([]);
    expect(input.layout.placements).toEqual([]);
  });

  it("attaches a crop to its unlocked tile and marks that tile unplantable", () => {
    const input = buildFarmSceneInput(
      state({ tiles: [tile(1, 0)], crops: [crop(1, 0, { growthProgress: 0.5 })] })
    );
    expect(input.tiles).toHaveLength(1);
    const sceneTile = tileAt(input, 0);
    expect(sceneTile.crop).toEqual({
      cropInstanceId: "crop_1_0",
      definitionId: "crop_carrot",
      mature: false,
      heightFraction: 0.5
    });
    expect(sceneTile.plantable).toBe(false);
  });

  it("treats only bare soil as plantable", () => {
    const input = buildFarmSceneInput(
      state({
        tiles: [
          tile(0, 0, "SOIL"),
          tile(1, 0, "GRASS"),
          tile(2, 0, "WATER"),
          tile(3, 0, "BLOCKED")
        ]
      })
    );
    expect(input.tiles.map((sceneTile) => sceneTile.plantable)).toEqual([true, false, false, false]);
  });

  it("marks only the selected coordinate as selected", () => {
    const input = buildFarmSceneInput(
      state({ tiles: [tile(0, 0), tile(1, 0), tile(2, 0)], selected: { x: 1, y: 0 } })
    );
    expect(input.tiles.map((sceneTile) => sceneTile.selected)).toEqual([false, true, false]);
  });

  it("leaves every tile unselected when the selection is not unlocked land", () => {
    const input = buildFarmSceneInput(state({ tiles: [tile(0, 0)], selected: { x: 9, y: 9 } }));
    expect(input.tiles.map((sceneTile) => sceneTile.selected)).toEqual([false]);
  });

  it("expresses growth as a height fraction taken straight from the server", () => {
    const input = buildFarmSceneInput(
      state({
        tiles: [tile(0, 0), tile(1, 0), tile(2, 0)],
        crops: [
          crop(0, 0, { growthProgress: 0 }),
          crop(1, 0, { growthProgress: 0.25 }),
          crop(2, 0, { mature: true, growthProgress: 1 })
        ]
      })
    );
    expect(input.tiles.map((sceneTile) => sceneTile.crop?.heightFraction)).toEqual([0, 0.25, 1]);
  });

  it("never infers maturity from growth progress", () => {
    const input = buildFarmSceneInput(
      state({ tiles: [tile(0, 0)], crops: [crop(0, 0, { growthProgress: 1, mature: false })] })
    );
    expect(tileAt(input, 0).crop?.mature).toBe(false);
  });

  it("trusts the server's mature flag over the numeric progress", () => {
    const input = buildFarmSceneInput(
      state({ tiles: [tile(0, 0)], crops: [crop(0, 0, { mature: true, growthProgress: 0.05 })] })
    );
    const sceneTile = tileAt(input, 0);
    expect(sceneTile.crop?.mature).toBe(true);
    expect(sceneTile.crop?.heightFraction).toBe(1);
  });

  it("clamps an impossible fraction instead of scaling a crop off the farm", () => {
    const input = buildFarmSceneInput(
      state({
        tiles: [tile(0, 0), tile(1, 0), tile(2, 0), tile(3, 0)],
        crops: [
          crop(0, 0, { growthProgress: 5 }),
          crop(1, 0, { growthProgress: -2 }),
          crop(2, 0, { growthProgress: Number.NaN }),
          crop(3, 0, { growthProgress: Number.POSITIVE_INFINITY })
        ]
      })
    );
    // A fraction the server cannot have sent falls back to the least-ripe reading, never to ripe.
    expect(input.tiles.map((sceneTile) => sceneTile.crop?.heightFraction)).toEqual([1, 0, 0, 0]);
  });

  it("collapses a duplicated tile coordinate so land cannot flicker between rows", () => {
    const input = buildFarmSceneInput(
      state({ tiles: [tile(2, 2, "SOIL"), tile(2, 2, "WATER")] })
    );
    expect(input.tiles).toHaveLength(1);
    expect(tileAt(input, 0).terrainType).toBe("SOIL");
  });

  it("collapses a duplicated crop coordinate, first row wins", () => {
    const input = buildFarmSceneInput(
      state({
        tiles: [tile(0, 0)],
        crops: [
          crop(0, 0, { cropInstanceId: "crop_first", growthProgress: 0.2 }),
          crop(0, 0, { cropInstanceId: "crop_second", growthProgress: 0.9 })
        ]
      })
    );
    expect(tileAt(input, 0).crop?.cropInstanceId).toBe("crop_first");
    expect(tileAt(input, 0).crop?.heightFraction).toBe(0.2);
  });

  it("lays out exactly the tiles it renders and keeps world coordinates unchanged", () => {
    const tiles = [tile(0, 0), tile(1, 0), tile(0, 1), tile(2, 3)];
    const input = buildFarmSceneInput(state({ tiles }));

    expect(input.tiles).toHaveLength(tiles.length);
    expect(input.layout.placements).toHaveLength(input.tiles.length);
    expect(input.layout.placements.map((placement) => [placement.tileX, placement.tileY])).toEqual(
      input.tiles.map((sceneTile) => [sceneTile.tileX, sceneTile.tileY])
    );
    expect(input.layout.columns).toBe(3);
    expect(input.layout.rows).toBe(4);
    expect(tileAt(input, 0)).toMatchObject({ worldX: -PITCH, worldZ: -1.5 * PITCH });
    expect(tileAt(input, 1)).toMatchObject({ worldX: 0, worldZ: -1.5 * PITCH });
  });
});
