import { describe, expect, it } from "vitest";
import type { CropStateDTO, FarmTileDTO, PlotDTO, TreeStateDTO } from "@happy-farm/contracts";
import { farmPresentationSignature, type FarmViewState } from "../../apps/web/src/render/view-model";

/**
 * The poll's skip key.
 *
 * The host page polls the farm and, before this key existed, reprojected the entire world on every
 * poll whether or not anything had changed. The key is what makes "nothing changed" cheap, so its
 * two failure modes matter: it must change for anything a player can see, and it must *not* change
 * for the sub-percent growth the server's clock produces between two polls.
 */

function tile(x: number, y: number, overrides: Partial<FarmTileDTO> = {}): FarmTileDTO {
  return {
    farmId: "farm_sig",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 500,
    requiredLevel: 1,
    unlocked
  };
}

function crop(overrides: Partial<CropStateDTO> = {}): CropStateDTO {
  return {
    cropInstanceId: "crop_one",
    definitionId: "crop_carrot",
    tileX: 1,
    tileY: 1,
    plantedAt: "2026-01-01T00:00:00.000Z",
    growthStage: 1,
    growthProgress: 0.4,
    mature: false,
    version: 1,
    ...overrides
  };
}

function tree(overrides: Partial<TreeStateDTO> = {}): TreeStateDTO {
  return {
    treeInstanceId: "treeinst_one",
    definitionId: "tree_apple",
    tileX: 2,
    tileY: 2,
    plantedAt: "2026-01-01T00:00:00.000Z",
    lastHarvestedAt: null,
    readyAt: "2026-01-02T00:00:00.000Z",
    secondsUntilReady: 60,
    ready: false,
    phase: "GROWING",
    growthStage: 1,
    growthProgress: 0.25,
    version: 1,
    ...overrides
  };
}

function state(overrides: Partial<FarmViewState> = {}): FarmViewState {
  return {
    tiles: [tile(0, 0), tile(1, 1)],
    crops: [crop()],
    trees: [],
    plots: [plot(1, true), plot(2, false)],
    selected: null,
    ...overrides
  };
}

describe("farm presentation signature", () => {
  it("is stable across two identical polls", () => {
    expect(farmPresentationSignature(state())).toBe(farmPresentationSignature(state()));
  });

  it("ignores sub-percent growth, because the panels do not print it either", () => {
    const before = state({ crops: [crop({ growthProgress: 0.4001 })] });
    const after = state({ crops: [crop({ growthProgress: 0.4004 })] });
    expect(farmPresentationSignature(before)).toBe(farmPresentationSignature(after));
  });

  it("changes when a crop's printed progress changes", () => {
    const before = state({ crops: [crop({ growthProgress: 0.4 })] });
    const after = state({ crops: [crop({ growthProgress: 0.42 })] });
    expect(farmPresentationSignature(before)).not.toBe(farmPresentationSignature(after));
  });

  it("changes for every real farm event", () => {
    const base = farmPresentationSignature(state());
    expect(farmPresentationSignature(state({ crops: [] }))).not.toBe(base);
    expect(farmPresentationSignature(state({ crops: [crop({ mature: true })] }))).not.toBe(base);
    expect(farmPresentationSignature(state({ crops: [crop({ version: 2 })] }))).not.toBe(base);
    expect(farmPresentationSignature(state({ tiles: [tile(0, 0), tile(1, 1), tile(2, 2)] }))).not.toBe(base);
    expect(farmPresentationSignature(state({ plots: [plot(1, true), plot(2, true)] }))).not.toBe(base);
    expect(
      farmPresentationSignature(state({ selected: { x: 1, y: 1 } }))
    ).not.toBe(base);
    expect(farmPresentationSignature(state({ trees: [tree()] }))).not.toBe(base);
    expect(
      farmPresentationSignature(state({ trees: [tree({ growthProgress: 0.7 })] }))
    ).not.toBe(base);
    expect(
      farmPresentationSignature(state({ trees: [tree({ ready: true, phase: "READY" })] }))
    ).not.toBe(base);
  });

  it("tells two different tiles apart even at the same coordinates of different lists", () => {
    const a = farmPresentationSignature(state({ tiles: [tile(0, 0, { terrainType: "SOIL" })] }));
    const b = farmPresentationSignature(state({ tiles: [tile(0, 0, { terrainType: "GRASS" })] }));
    expect(a).not.toBe(b);
  });
});
