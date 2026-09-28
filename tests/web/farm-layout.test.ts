import { describe, expect, it } from "vitest";
import {
  DEFAULT_TILE_GAP,
  DEFAULT_TILE_SIZE,
  layoutFarmTiles,
  type TileCoordinate
} from "../../apps/web/src/render/layout";

/** Mirrors INITIAL_LAND_SIZE, so the first real farm is laid out as a 6 x 6 square. */
const STARTING_LAND_SIZE = 6;
const PITCH = DEFAULT_TILE_SIZE + DEFAULT_TILE_GAP;

function squareLand(size: number): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

describe("layoutFarmTiles", () => {
  it("produces no placement and no extent when no land is unlocked", () => {
    const layout = layoutFarmTiles([]);
    expect(layout.placements).toEqual([]);
    expect(layout.columns).toBe(0);
    expect(layout.rows).toBe(0);
    expect(layout.tileAreaWidth).toBe(0);
    expect(layout.tileAreaDepth).toBe(0);
  });

  it("centres the starter land on the world origin", () => {
    const layout = layoutFarmTiles(squareLand(STARTING_LAND_SIZE));
    expect(layout.columns).toBe(STARTING_LAND_SIZE);
    expect(layout.rows).toBe(STARTING_LAND_SIZE);
    expect(layout.placements).toHaveLength(STARTING_LAND_SIZE * STARTING_LAND_SIZE);

    const edge = ((STARTING_LAND_SIZE - 1) / 2) * PITCH;
    expect(layout.placements[0]).toEqual({ tileX: 0, tileY: 0, worldX: -edge, worldZ: -edge });
    expect(layout.placements.at(-1)).toEqual({ tileX: 5, tileY: 5, worldX: edge, worldZ: edge });

    const centreX = layout.placements.reduce((total, placement) => total + placement.worldX, 0);
    const centreZ = layout.placements.reduce((total, placement) => total + placement.worldZ, 0);
    expect(centreX).toBeCloseTo(0, 10);
    expect(centreZ).toBeCloseTo(0, 10);
  });

  it("reports the tile area extent without the trailing gap", () => {
    const layout = layoutFarmTiles(squareLand(STARTING_LAND_SIZE));
    expect(layout.tileAreaWidth).toBeCloseTo(STARTING_LAND_SIZE * PITCH - DEFAULT_TILE_GAP, 10);
    expect(layout.tileAreaDepth).toBeCloseTo(STARTING_LAND_SIZE * PITCH - DEFAULT_TILE_GAP, 10);
  });

  it("orders placements by row then column regardless of input order", () => {
    const ordered = layoutFarmTiles([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
    const reversed = layoutFarmTiles([{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
    expect(reversed.placements).toEqual(ordered.placements);
    expect(ordered.placements.map((placement) => [placement.tileX, placement.tileY])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1]
    ]);
  });

  it("collapses a duplicated coordinate into one placement", () => {
    const layout = layoutFarmTiles([{ x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 3 }]);
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(4);
    // The grid box is still centred on the origin, so one surviving tile sits in its corner rather
    // than at the origin: centring follows the land's extent, not the coordinate count.
    expect(layout.placements).toEqual([
      { tileX: 2, tileY: 3, worldX: (2 - (3 - 1) / 2) * PITCH, worldZ: (3 - (4 - 1) / 2) * PITCH }
    ]);
  });

  it("keeps world Z aligned with the server's tile Y", () => {
    const layout = layoutFarmTiles([{ x: 0, y: 0 }, { x: 0, y: 3 }]);
    const [first, second] = layout.placements;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect((second?.worldZ ?? 0) - (first?.worldZ ?? 0)).toBeGreaterThan(0);
  });

  it("honours an explicit tile size and gap", () => {
    const layout = layoutFarmTiles([{ x: 0, y: 0 }, { x: 1, y: 0 }], { tileSize: 2, tileGap: 0 });
    expect(layout.tileSize).toBe(2);
    expect(layout.tileGap).toBe(0);
    expect(layout.tileAreaWidth).toBe(4);
    expect(layout.placements.map((placement) => placement.worldX)).toEqual([-1, 1]);
  });

  it("rejects coordinates that are not non-negative integers", () => {
    for (const tile of [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1.5, y: 0 }, { x: Number.NaN, y: 0 }]) {
      expect(() => layoutFarmTiles([tile])).toThrow(RangeError);
    }
  });

  it("rejects option values outside their usable range", () => {
    expect(() => layoutFarmTiles([], { tileSize: 0 })).toThrow(RangeError);
    expect(() => layoutFarmTiles([], { tileSize: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => layoutFarmTiles([], { tileGap: -1 })).toThrow(RangeError);
  });
});
