import { describe, expect, it } from "vitest";
import {
  baselineCounts,
  baselineSnapshot,
  baseValue,
  marketPrices,
  MODEL_ITEM_VALUES
} from "@happy-farm/economy-sim";
import { crops, fishingBalance, forestryBalance, miningBalance, plots, shops, trees } from "@happy-farm/game-data";

/**
 * The baseline is the *implemented* economy, read from the canonical game data.
 *
 * If the game changes a price or a yield, this snapshot changes with it - which is the whole point of
 * building the model from the data instead of retyping it into a spreadsheet.
 */

describe("the economy baseline", () => {
  it("reports the shipped catalogue's own sizes", () => {
    const baseline = baselineSnapshot();
    expect(baseline.crops).toHaveLength(crops.length);
    expect(baseline.trees).toHaveLength(trees.length);
    expect(baseline.fishingTables).toHaveLength(fishingBalance.tables.length);
    expect(baseline.mining).toHaveLength(miningBalance.resources.length);
    expect(baseline.forestry).toHaveLength(forestryBalance.resources.length);
    expect(baseline.plots).toHaveLength(plots.length);
    expect(baselineCounts.shopEntries).toBe(shops.length);
  });

  it("carries the crops' real economics rather than a rounded copy", () => {
    const baseline = baselineSnapshot();
    for (const crop of baseline.crops) {
      const source = crops.find((definition) => definition.id === crop.id);
      expect(source, crop.id).toBeDefined();
      expect(crop.growthSeconds, crop.id).toBe(source?.growthDurationSeconds);
      expect(crop.harvestItemDefinitionId, crop.id).toBe(source?.harvest.itemDefinitionId);
      expect(crop.yieldPerHarvest, crop.id).toBe(source?.harvest.baseQuantity);
      expect(crop.xp, crop.id).toBe(source?.harvest.xp);
    }
  });

  it("carries the resource nodes' sustained rates, and names the material each yields", () => {
    const baseline = baselineSnapshot();
    for (const resource of [...baseline.mining, ...baseline.forestry]) {
      expect(resource.nodeCount, resource.id).toBeGreaterThan(0);
      expect(resource.unitSellPrice, resource.id).toBeGreaterThan(0);
      expect(resource.sustainedGoldPerMinute, resource.id).toBeGreaterThan(0);
      expect(resource.itemDefinitionId).toMatch(/^item_/);
    }
  });

  it("resolves a price for everything the market trades, shipped or modelled", () => {
    const baseline = baselineSnapshot();
    const prices = marketPrices();
    expect(prices.sell.item_stone).toBe(1);
    expect(prices.sell.item_wood).toBe(1);
    // A shipped item takes its catalogue price...
    expect(baseValue("item_coal", baseline)).toBe(prices.sell.item_coal);
    // ...and a modelled future good takes its own documented value.
    expect(baseValue("item_steel", baseline)).toBe(MODEL_ITEM_VALUES.item_steel);
    // An item nobody priced is worth 1 rather than NaN.
    expect(baseValue("item_unheard_of", baseline)).toBe(1);
  });
});
