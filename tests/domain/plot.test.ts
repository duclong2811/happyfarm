import { describe, expect, it } from "vitest";
import {
  assertPlotDefinition,
  createEconomyMutation,
  DomainError,
  isPlotUnlocked,
  MAX_ADDRESSABLE_PLOT_INDEX,
  MAX_WALLET_BALANCE,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseEconomyReferenceId,
  parsePlotId,
  parseShopEntryId,
  PLOT_TILE_COUNT,
  PLOT_TILE_SIZE,
  plotIdForIndex,
  plotOrigin,
  plotRing,
  plotTileCoordinates,
  plotTiles,
  referenceTypeForReason,
  unlockedPlotIndex,
  type CurrencyDefinition,
  type PlotDefinition,
  type Wallet
} from "@happy-farm/domain";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

const gold = parseCurrencyDefinitionId("currency_gold");

function currency(): CurrencyDefinition {
  return { id: gold, displayNameKey: "currency.gold.name", maxBalance: MAX_WALLET_BALANCE };
}

function wallet(balance: number, version = 1): Wallet {
  return { playerId: PLAYER_ONE_ID, currencyDefinitionId: gold, balance, version, updatedAt: NOW };
}

function plot(plotIndex: number, price = 100, requiredLevel = 1): PlotDefinition {
  return {
    id: plotIdForIndex(plotIndex),
    plotIndex,
    displayNameKey: `plot.${String(plotIndex)}.name`,
    currencyDefinitionId: gold,
    price,
    requiredLevel
  };
}

function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

/** Every tile of plots 1..depth, as a coordinate set, plus the starter square's tiles. */
function tileSet(depth: number, includeStarter = true): Set<string> {
  const coordinates = new Set<string>();
  if (includeStarter) {
    for (let y = 0; y < PLOT_TILE_SIZE; y += 1) {
      for (let x = 0; x < PLOT_TILE_SIZE; x += 1) coordinates.add(coordinateKey(x, y));
    }
  }
  for (let plotIndex = 1; plotIndex <= depth; plotIndex += 1) {
    for (const coordinate of plotTileCoordinates(plotIndex)) {
      coordinates.add(coordinateKey(coordinate.x, coordinate.y));
    }
  }
  return coordinates;
}

/** Plots per ring: ring r holds 2r + 1 plots, so ring r ends at index r(r + 2). */
function lastIndexOfRing(ring: number): number {
  return ring * (ring + 2);
}

describe("plot geometry", () => {
  it("walks a clockwise spiral of six-tile squares outward from the starter land", () => {
    const expected: readonly (readonly [number, number, number])[] = [
      [1, 6, 0], [2, 6, 6], [3, 0, 6],
      [4, 12, 0], [5, 12, 6], [6, 12, 12], [7, 0, 12], [8, 6, 12],
      [9, 18, 0], [10, 18, 6], [11, 18, 12], [12, 18, 18], [13, 0, 18], [14, 6, 18], [15, 12, 18]
    ];
    for (const [plotIndex, x, y] of expected) {
      expect(plotOrigin(plotIndex)).toEqual({ x, y });
    }
  });

  it("assigns each index to the ring that holds it", () => {
    const rings: Record<number, number> = {};
    for (let plotIndex = 1; plotIndex <= lastIndexOfRing(3); plotIndex += 1) {
      const ring = plotRing(plotIndex);
      rings[plotIndex] = ring;
    }
    expect(rings).toEqual({
      1: 1, 2: 1, 3: 1,
      4: 2, 5: 2, 6: 2, 7: 2, 8: 2,
      9: 3, 10: 3, 11: 3, 12: 3, 13: 3, 14: 3, 15: 3
    });
  });

  it("fills each ring exactly: every plot completes the square and leaves no gap or overlap", () => {
    for (const ring of [1, 2, 3]) {
      const depth = lastIndexOfRing(ring);
      const side = PLOT_TILE_SIZE * (ring + 1);
      const expected = new Set<string>();
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
          if (x < PLOT_TILE_SIZE && y < PLOT_TILE_SIZE) continue;
          expected.add(coordinateKey(x, y));
        }
      }
      const actual = tileSet(depth, false);
      expect(actual.size).toBe(depth * PLOT_TILE_COUNT);
      expect([...actual].sort()).toEqual([...expected].sort());
    }
  });

  it("keeps every plot a complete square of fresh SOIL inside the coordinate bounds", () => {
    for (let plotIndex = 1; plotIndex <= lastIndexOfRing(3); plotIndex += 1) {
      const tiles = plotTiles(FARM_ONE_ID, plotIndex, NOW);
      expect(tiles).toHaveLength(PLOT_TILE_COUNT);
      const coordinates = new Set(tiles.map((tile) => coordinateKey(tile.x, tile.y)));
      expect(coordinates.size).toBe(PLOT_TILE_COUNT);
      const xs = tiles.map((tile) => tile.x);
      const ys = tiles.map((tile) => tile.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(PLOT_TILE_SIZE - 1);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(PLOT_TILE_SIZE - 1);
      for (const tile of tiles) {
        expect(tile.terrainType).toBe("SOIL");
        expect(tile.state).toBe("IDLE");
        expect(tile.version).toBe(1);
        expect(tile.updatedAt).toBe(NOW);
        expect(tile.farmId).toBe(FARM_ONE_ID);
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("refuses an index that is not a positive integer inside the addressable geometry", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_ADDRESSABLE_PLOT_INDEX + 1]) {
      expect(() => plotRing(invalid)).toThrow(DomainError);
      expect(() => plotOrigin(invalid)).toThrow(DomainError);
    }
    expect(plotRing(MAX_ADDRESSABLE_PLOT_INDEX)).toBeGreaterThan(1);
  });
});

describe("unlocked land", () => {
  it("counts the contiguous run of complete plots and ignores starter land", () => {
    for (let depth = 0; depth <= lastIndexOfRing(3); depth += 1) {
      const tiles = [...tileSet(depth)].map((key) => {
        const [x, y] = key.split(",");
        return { x: Number(x), y: Number(y) };
      });
      expect(unlockedPlotIndex(tiles)).toBe(depth);
    }
  });

  it("treats a plot missing even one tile as not unlocked", () => {
    const tiles = tileSet(3);
    const missing = plotTileCoordinates(3)[PLOT_TILE_COUNT - 1] ?? { x: 0, y: 0 };
    tiles.delete(coordinateKey(missing.x, missing.y));
    expect(
      unlockedPlotIndex([...tiles].map((key) => {
        const [x, y] = key.split(",");
        return { x: Number(x), y: Number(y) };
      }))
    ).toBe(2);
  });

  it("reports no expansion on a farm with only starter land", () => {
    expect(unlockedPlotIndex([])).toBe(0);
  });
});

describe("plot definitions", () => {
  it("accepts a definition whose id, index, price, and level agree", () => {
    expect(() => { assertPlotDefinition(plot(1, 1, 1)); }).not.toThrow();
    expect(() => { assertPlotDefinition(plot(8, Number.MAX_SAFE_INTEGER, 50)); }).not.toThrow();
  });

  it("refuses a definition whose id, index, price, or level requirement is not usable", () => {
    const broken = [
      { ...plot(2), id: plotIdForIndex(3) },
      { ...plot(1), price: 0 },
      { ...plot(1), price: -5 },
      { ...plot(1), price: 1.5 },
      { ...plot(1), price: Number.MAX_SAFE_INTEGER + 1 },
      { ...plot(1), requiredLevel: 0 },
      { ...plot(1), requiredLevel: 2.5 },
      { ...plot(1), plotIndex: 0 }
    ];
    for (const definition of broken) {
      expect(() => { assertPlotDefinition(definition); }).toThrow(DomainError);
    }
  });

  it("holds the price and the land to one definition, so a purchase cannot mix two plots", () => {
    const first = plot(1, 250);
    const economy = createEconomyMutation(wallet(1000, 4), currency(), {
      transactionId: parseEconomyTransactionId("econ_11111111-1111-4111-8111-111111111111"),
      delta: -first.price,
      reason: "FARM_EXPANSION",
      referenceId: first.id,
      requestId: "expand_plot_001",
      createdAt: NOW
    });
    expect(economy).toMatchObject({
      delta: -250,
      reason: "FARM_EXPANSION",
      referenceType: "PLOT",
      referenceId: "plot_1",
      balanceBefore: 1000,
      balanceAfter: 750,
      expectedWalletVersion: 4,
      playerId: PLAYER_ONE_ID,
      currencyDefinitionId: "currency_gold",
      requestId: "expand_plot_001"
    });
    const tiles = plotTiles(FARM_ONE_ID, first.plotIndex, NOW);
    expect(tiles).toHaveLength(PLOT_TILE_COUNT);
    expect(new Set(tiles.map((tile) => coordinateKey(tile.x, tile.y)))).toEqual(
      new Set(plotTileCoordinates(first.plotIndex).map((coordinate) => coordinateKey(coordinate.x, coordinate.y)))
    );
  });
});

describe("plot identifiers and level gate", () => {
  it("names a plot only as plot_<index> with no leading zero", () => {
    expect(plotIdForIndex(1)).toBe("plot_1");
    expect(plotIdForIndex(15)).toBe("plot_15");
    for (const invalid of ["plot_0", "plot_01", "plot_1x", "plot_", "plot", "shop_1"]) {
      expect(() => parsePlotId(invalid)).toThrow(DomainError);
    }
  });

  it("locks a plot for a malformed level or an impossible requirement", () => {
    const gated = plot(4, 100, 3);
    expect(isPlotUnlocked(gated, 3)).toBe(true);
    expect(isPlotUnlocked(gated, 2)).toBe(false);
    for (const level of [Number.NaN, 1.5, Number.POSITIVE_INFINITY, -3]) {
      expect(isPlotUnlocked(gated, level)).toBe(false);
    }
    expect(isPlotUnlocked({ ...gated, requiredLevel: 0 }, 50)).toBe(false);
  });

  it("pairs every reason with exactly one reference kind", () => {
    expect(referenceTypeForReason("SHOP_BUY")).toBe("SHOP_ENTRY");
    expect(referenceTypeForReason("SHOP_SELL")).toBe("SHOP_ENTRY");
    expect(referenceTypeForReason("FARM_EXPANSION")).toBe("PLOT");
  });

  it("reads back only the reference shapes a mutation can write", () => {
    expect(parseEconomyReferenceId("shop_carrot")).toBe("shop_carrot");
    expect(parseEconomyReferenceId("plot_7")).toBe("plot_7");
    for (const invalid of ["", "shop_", "plot_0", "carrot", "plot_1_extra_bad"]) {
      expect(() => parseEconomyReferenceId(invalid)).toThrow(DomainError);
    }
  });

  it("refuses a mutation whose reference kind contradicts its reason", () => {
    const mutation = {
      transactionId: parseEconomyTransactionId("econ_44444444-4444-4444-8444-444444444444"),
      delta: -100,
      requestId: "expand_plot_004",
      createdAt: NOW
    };
    let code = "";
    try {
      createEconomyMutation(wallet(500), currency(), {
        ...mutation,
        reason: "SHOP_BUY",
        referenceId: parsePlotId("plot_1")
      });
    } catch (error: unknown) {
      code = error instanceof DomainError ? error.code : "";
    }
    expect(code).toBe("INVALID_ECONOMY_MUTATION");
    expect(() =>
      createEconomyMutation(wallet(500), currency(), {
        ...mutation,
        reason: "FARM_EXPANSION",
        referenceId: parseShopEntryId("shop_carrot")
      })
    ).toThrow(DomainError);
    expect(
      createEconomyMutation(wallet(500), currency(), {
        ...mutation,
        reason: "FARM_EXPANSION",
        referenceId: parsePlotId("plot_1")
      }).referenceType
    ).toBe("PLOT");
  });
});
