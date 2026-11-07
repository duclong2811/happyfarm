import { describe, expect, it } from "vitest";
import {
  LAND_ORIGINS,
  PLOT_TILE_COUNT,
  PLOT_TILE_SIZE,
  SINGLE_CELL_PREMIUM_PERCENT,
  isUsableLand,
  landOriginFor,
  plotBounds,
  plotIndexContaining,
  singleCellPrice
} from "@happy-farm/domain";

/**
 * The land-origin boundary (V14.5.2).
 *
 * Today every usable cell is natural Home Island land; a future reclamation pass adds a second
 * origin, and every placement rule keeps asking `isUsableLand`. These cases pin the vocabulary and
 * the one classifier so the future pass has a single place to extend.
 */
describe("usable land origins", () => {
  it("ships exactly natural and reclaimed, and refuses nothing else", () => {
    expect([...LAND_ORIGINS]).toEqual(["NATURAL", "RECLAIMED"]);
    expect(isUsableLand("NATURAL")).toBe(true);
    expect(isUsableLand("RECLAIMED")).toBe(true);
    expect(isUsableLand(null)).toBe(false);
  });

  it("classifies dry, unprotected island ground as natural land", () => {
    expect(landOriginFor({ terrain: "LAND", protectedGround: false })).toBe("NATURAL");
    // Everything that is not dry, unprotected island ground is not usable land today.
    expect(landOriginFor({ terrain: "LAND", protectedGround: true })).toBeNull();
    expect(landOriginFor({ terrain: "SHORE", protectedGround: false })).toBeNull();
    expect(landOriginFor({ terrain: "WATER", protectedGround: false })).toBeNull();
    expect(landOriginFor({ terrain: "VOLCANO", protectedGround: false })).toBeNull();
    expect(landOriginFor({ terrain: "BLOCKED", protectedGround: false })).toBeNull();
  });
});

/**
 * The single-cell land price, as arithmetic.
 *
 * One rule, one place: a cell costs what its enclosing plot charges per cell, plus a convenience
 * premium, floored to whole gold. Bulk land stays the better deal, which is the point of the premium.
 */

describe("single-cell land pricing", () => {
  it("is the enclosing plot's per-cell price plus the premium", () => {
    for (const price of [100, 250, 500, 1_000, 2_000, 3_500, 5_500, 8_000]) {
      const expected = Math.max(1, Math.floor((price / PLOT_TILE_COUNT) * (1 + SINGLE_CELL_PREMIUM_PERCENT / 100)));
      expect(singleCellPrice(price), String(price)).toBe(expected);
    }
  });

  it("keeps bulk land the cheaper way to buy the same ground", () => {
    for (const price of [250, 1_000, 8_000]) {
      const perCell = singleCellPrice(price);
      expect(perCell * PLOT_TILE_COUNT, String(price)).toBeGreaterThan(price);
      expect(perCell).toBeGreaterThanOrEqual(Math.ceil(price / PLOT_TILE_COUNT));
    }
  });

  it("never prices a cell below one gold and refuses a nonsense plot price", () => {
    expect(singleCellPrice(1)).toBe(1);
    expect(() => singleCellPrice(0)).toThrow();
    expect(() => singleCellPrice(-5)).toThrow();
    expect(() => singleCellPrice(1.5)).toThrow();
    expect(() => singleCellPrice(Number.NaN)).toThrow();
  });
});

describe("the plot a cell belongs to", () => {
  it("answers null for the starter square, which is never for sale", () => {
    expect(plotIndexContaining({ x: 0, y: 0 })).toBeNull();
    expect(plotIndexContaining({ x: PLOT_TILE_SIZE - 1, y: PLOT_TILE_SIZE - 1 })).toBeNull();
  });

  it("finds the first ring's three plots by their own squares", () => {
    expect(plotIndexContaining({ x: PLOT_TILE_SIZE, y: 0 })).toBe(1);
    expect(plotIndexContaining({ x: PLOT_TILE_SIZE, y: PLOT_TILE_SIZE })).toBe(2);
    expect(plotIndexContaining({ x: 0, y: PLOT_TILE_SIZE })).toBe(3);
  });

  it("walks outward ring by ring", () => {
    // Ring 2 starts at plot 4, in the new right column.
    expect(plotIndexContaining({ x: PLOT_TILE_SIZE * 2, y: 0 })).toBe(4);
    // Negative coordinates are not part of the expansion geometry.
    expect(plotIndexContaining({ x: -1, y: 0 })).toBeNull();
    expect(plotIndexContaining({ x: 0, y: -1 })).toBeNull();
  });

  it("agrees with the plot bounds it is built from", () => {
    const bounds = plotBounds(4);
    expect(bounds).toEqual({ minX: 24, maxX: 35, minY: 0, maxY: 11 });
    expect(plotIndexContaining({ x: bounds.minX, y: bounds.minY })).toBe(4);
    expect(plotIndexContaining({ x: bounds.maxX, y: bounds.maxY })).toBe(4);
  });
});
