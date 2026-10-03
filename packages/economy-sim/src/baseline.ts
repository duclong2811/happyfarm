import {
  FISHING_ACTION_SECONDS,
  crops,
  farmingBalance,
  fishingBalance,
  forestryBalance,
  miningBalance,
  plots,
  playerProgression,
  shops,
  trees
} from "@happy-farm/game-data";

/**
 * The implemented economy, read from the canonical game data rather than restated.
 *
 * This package must never be imported by the Worker or the browser - it is a design tool - so the
 * only coupling it takes is a *read* of `@happy-farm/game-data`, which is pure data. That is what keeps
 * the model honest: if a crop's price changes, the next simulation says so rather than describing a
 * game that no longer exists.
 */

export interface CropBaseline {
  readonly id: string;
  /** The produce one harvest yields, so the simulator can put it in a store and trade it. */
  readonly harvestItemDefinitionId: string;
  readonly growthSeconds: number;
  readonly seedCost: number;
  readonly yieldPerHarvest: number;
  readonly sellPrice: number;
  readonly sellPriceLabel: string;
  readonly netProfit: number;
  readonly goldPerMinute: number;
  readonly xp: number;
  readonly xpPerMinute: number;
  readonly requiredLevel: number;
}

export interface TreeBaseline {
  readonly id: string;
  readonly saplingCost: number;
  readonly firstReadySeconds: number;
  readonly cycleSeconds: number;
  readonly revenuePerCycle: number;
  readonly goldPerMinute: number;
  readonly xpPerCycle: number;
  readonly requiredLevel: number;
}

export interface FishBaseline {
  readonly id: string;
  readonly itemDefinitionId: string;
  readonly sellPrice: number;
  readonly xp: number;
  readonly probability: number;
}

export interface FishingTableBaseline {
  readonly id: string;
  readonly actionSeconds: number;
  readonly expectedGoldPerAction: number;
  readonly expectedXpPerAction: number;
  readonly goldPerMinute: number;
  readonly xpPerMinute: number;
  readonly fish: readonly FishBaseline[];
}

export interface ResourceBaseline {
  readonly id: string;
  readonly verb: string;
  readonly itemDefinitionId: string;
  readonly quantityPerGather: number;
  readonly unitSellPrice: number;
  readonly goldPerGather: number;
  readonly xpPerGather: number;
  readonly actionSeconds: number;
  readonly regenerationSeconds: number;
  readonly nodeCount: number;
  readonly sustainedGoldPerMinute: number;
  readonly sustainedXpPerMinute: number;
}

export interface PlotBaseline {
  readonly id: string;
  readonly plotIndex: number;
  readonly price: number;
  readonly requiredLevel: number;
}

export interface EconomyBaseline {
  readonly crops: readonly CropBaseline[];
  readonly trees: readonly TreeBaseline[];
  readonly fishingTables: readonly FishingTableBaseline[];
  readonly mining: readonly ResourceBaseline[];
  readonly forestry: readonly ResourceBaseline[];
  readonly plots: readonly PlotBaseline[];
  readonly progression: { readonly maxLevel: number; readonly xpStep: number };
  /** Sellable catalogue entries: what the market pays, by item. */
  readonly sellPrices: Readonly<Record<string, number>>;
  /** Buyable catalogue entries: what the market charges, by item. */
  readonly buyPrices: Readonly<Record<string, number>>;
}

/** The prices the game actually charges and pays, as a lookup. */
export function marketPrices(): { sell: Record<string, number>; buy: Record<string, number> } {
  const sell: Record<string, number> = {};
  const buy: Record<string, number> = {};
  for (const entry of shops) {
    if (entry.sellPrice !== undefined) sell[entry.itemDefinitionId] = entry.sellPrice;
    if (entry.buyPrice !== undefined) buy[entry.itemDefinitionId] = entry.buyPrice;
  }
  return { sell, buy };
}

export function baselineSnapshot(): EconomyBaseline {
  const prices = marketPrices();
  return {
    crops: farmingBalance.crops.map((crop) => ({
      id: crop.id,
      // Read from the definition itself rather than derived from the id, so a rename cannot desync.
      harvestItemDefinitionId:
        crops.find((definition) => definition.id === crop.id)?.harvest.itemDefinitionId ?? crop.id,
      growthSeconds: crop.growthSeconds,
      seedCost: crop.seedCost,
      yieldPerHarvest: crop.yieldPerHarvest,
      sellPrice: crop.sellPrice,
      sellPriceLabel: crop.id,
      netProfit: crop.netProfit,
      goldPerMinute: crop.goldPerMinute,
      xp: crop.xp,
      xpPerMinute: crop.xpPerMinute,
      requiredLevel: crop.requiredLevel
    })),
    trees: farmingBalance.trees.map((tree) => ({
      id: tree.id,
      saplingCost: tree.saplingCost,
      firstReadySeconds: tree.firstReadySeconds,
      cycleSeconds: tree.cycleSeconds,
      revenuePerCycle: tree.revenuePerCycle,
      goldPerMinute: tree.goldPerMinute,
      xpPerCycle: tree.xpPerCycle,
      requiredLevel: tree.requiredLevel
    })),
    fishingTables: fishingBalance.tables.map((table) => ({
      id: table.id,
      actionSeconds: FISHING_ACTION_SECONDS,
      expectedGoldPerAction: table.expectedGoldPerAction,
      expectedXpPerAction: table.expectedXpPerAction,
      goldPerMinute: table.goldPerMinute,
      xpPerMinute: table.xpPerMinute,
      fish: table.entries.map((entry) => ({
        id: entry.id,
        itemDefinitionId: entry.itemDefinitionId,
        sellPrice: entry.sellPrice,
        xp: entry.xp,
        probability: entry.probability
      }))
    })),
    mining: miningBalance.resources.map(toResourceBaseline),
    forestry: forestryBalance.resources.map(toResourceBaseline),
    plots: plots.map((plot) => ({
      id: plot.id,
      plotIndex: plot.plotIndex,
      price: plot.price,
      requiredLevel: plot.requiredLevel
    })),
    progression: { maxLevel: playerProgression.maxLevel, xpStep: playerProgression.xpStep },
    sellPrices: prices.sell,
    buyPrices: prices.buy
  };
}

function toResourceBaseline(resource: {
  readonly id: string;
  readonly verb: string;
  readonly dropItemDefinitionId: string;
  readonly quantityPerGather: number;
  readonly unitSellPrice: number;
  readonly goldPerGather: number;
  readonly xp: number;
  readonly actionSeconds: number;
  readonly regenerationSeconds: number;
  readonly nodeCount: number;
  readonly sustainedGoldPerMinute: number;
  readonly sustainedXpPerMinute: number;
}): ResourceBaseline {
  return {
    id: resource.id,
    verb: resource.verb,
    itemDefinitionId: resource.dropItemDefinitionId,
    quantityPerGather: resource.quantityPerGather,
    unitSellPrice: resource.unitSellPrice,
    goldPerGather: resource.goldPerGather,
    xpPerGather: resource.xp,
    actionSeconds: resource.actionSeconds,
    regenerationSeconds: resource.regenerationSeconds,
    nodeCount: resource.nodeCount,
    sustainedGoldPerMinute: resource.sustainedGoldPerMinute,
    sustainedXpPerMinute: resource.sustainedXpPerMinute
  };
}

/** The catalogues, as counts. Used by the baseline doc and the snapshot test. */
export const baselineCounts = {
  crops: crops.length,
  trees: trees.length,
  fishingTables: fishingBalance.tables.length,
  miningNodes: miningBalance.resources.reduce((sum, resource) => sum + resource.nodeCount, 0),
  forestryNodes: forestryBalance.resources.reduce((sum, resource) => sum + resource.nodeCount, 0),
  plots: plots.length,
  shopEntries: shops.length
} as const;
