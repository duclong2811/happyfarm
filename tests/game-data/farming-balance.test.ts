import { describe, expect, it } from "vitest";
import {
  crops,
  farmingBalance,
  itemRegistry,
  shops,
  trees,
  type CropEconomics,
  type TreeEconomics
} from "@happy-farm/game-data";

/**
 * The farming economy, checked as arithmetic rather than as a list of expected numbers.
 *
 * Every figure here is computed from the crop/tree definitions and their shop entries, so a price or
 * a yield edit is caught by the shape it must keep rather than by a number someone forgot to update.
 * The two invariants that make the set a set of *choices*:
 *
 *   - net profit strictly rises with growth time, so no shorter crop dominates a longer one;
 *   - XP per minute is flat, so no crop is an XP exploit and none is an XP trap.
 *
 * `docs/design/FARMING_BALANCE.md` prints the same table.
 */

const CROPS: readonly CropEconomics[] = farmingBalance.crops;
const TREES: readonly TreeEconomics[] = farmingBalance.trees;

/** How much better than "a little" a metric has to be before it counts as a difference. */
const EPSILON = 1e-9;

function dominates(a: CropEconomics, b: CropEconomics): boolean {
  // "Better" means: shorter or equal growth, and no worse on net, gold/minute, XP/minute, or ROI.
  const atLeastAsGood =
    a.growthSeconds <= b.growthSeconds &&
    a.netProfit >= b.netProfit - EPSILON &&
    a.goldPerMinute >= b.goldPerMinute - EPSILON &&
    a.xpPerMinute >= b.xpPerMinute - EPSILON &&
    a.roi >= b.roi - EPSILON;
  const strictlyBetter =
    a.growthSeconds < b.growthSeconds ||
    a.netProfit > b.netProfit + EPSILON ||
    a.goldPerMinute > b.goldPerMinute + EPSILON ||
    a.xpPerMinute > b.xpPerMinute + EPSILON ||
    a.roi > b.roi + EPSILON;
  return atLeastAsGood && strictlyBetter;
}

describe("the field-crop economy", () => {
  it("prices every crop positively and repays its seed from one harvest", () => {
    for (const crop of CROPS) {
      expect(Number.isInteger(crop.seedCost), crop.id).toBe(true);
      expect(crop.seedCost, crop.id).toBeGreaterThan(0);
      expect(crop.yieldPerHarvest, crop.id).toBeGreaterThan(0);
      expect(crop.sellPrice, crop.id).toBeGreaterThan(0);
      expect(crop.xp, crop.id).toBeGreaterThan(0);
      expect(crop.growthSeconds, crop.id).toBeGreaterThan(0);
      expect(crop.netProfit, crop.id).toBeGreaterThan(0);
      expect(crop.grossRevenue, crop.id).toBeGreaterThan(crop.seedCost);
      expect(Number.isSafeInteger(crop.grossRevenue), crop.id).toBe(true);
    }
  });

  it("pays the same experience per minute for every crop", () => {
    // XP measured against growing time, not against clicks: a player cannot farm experience by
    // spamming the shortest crop, and a slow crop is never punished for being slow.
    for (const crop of CROPS) {
      expect(crop.xpPerMinute, crop.id).toBeCloseTo(0.8, 8);
      expect(crop.xp, crop.id).toBe(Math.round(crop.growthMinutes * 0.8));
    }
  });

  it("makes a longer crop worth strictly more at harvest", () => {
    // Monotonic net profit is what stops a shorter crop from dominating a longer one: a crop that
    // finishes sooner must give up something, and what it gives up is the size of its harvest.
    const byTime = [...CROPS].sort((left, right) => left.growthSeconds - right.growthSeconds);
    for (let index = 1; index < byTime.length; index += 1) {
      const previous = byTime[index - 1];
      const current = byTime[index];
      expect(current?.netProfit ?? 0, `${String(previous?.id)} -> ${String(current?.id)}`).toBeGreaterThan(
        previous?.netProfit ?? 0
      );
    }
  });

  it("has no crop that dominates another on every axis", () => {
    for (const a of CROPS) {
      for (const b of CROPS) {
        if (a.id === b.id) continue;
        expect(dominates(a, b), `${a.id} dominates ${b.id}`).toBe(false);
      }
    }
  });

  it("spreads the best metric across different crops", () => {
    const bestBy = (pick: (crop: CropEconomics) => number) =>
      [...CROPS].sort((left, right) => pick(right) - pick(left))[0]?.id;
    // Fastest, most gold per minute, most profit per harvest, and best capital efficiency are four
    // different crops, which is the point of the set.
    const fastest = [...CROPS].sort((left, right) => left.growthSeconds - right.growthSeconds)[0]?.id;
    expect(fastest).toBe("crop_carrot");
    expect(bestBy((crop) => crop.goldPerMinute)).toBe("crop_potato");
    expect(bestBy((crop) => crop.netProfit)).toBe("crop_pumpkin");
    // Capital efficiency is tied between the two mid crops, so the assertion is membership, not
    // order: what matters is that the best ROI is not the crop that already wins gold or profit.
    const bestRoi = Math.max(...CROPS.map((crop) => crop.roi));
    expect(CROPS.filter((crop) => crop.roi >= bestRoi - EPSILON).map((crop) => crop.id)).toContain("crop_wheat");
  });

  it("unlocks exactly one crop at level 1 and climbs with the levels", () => {
    const levels = CROPS.map((crop) => crop.requiredLevel).sort((left, right) => left - right);
    expect(levels[0]).toBe(1);
    expect(levels[1]).toBeGreaterThan(1);
    expect(new Set(CROPS.map((crop) => crop.id)).size).toBe(CROPS.length);
  });
});

describe("the orchard economy", () => {
  it("pays for a sapling within two harvests and keeps every number positive", () => {
    for (const tree of TREES) {
      expect(tree.saplingCost, tree.id).toBeGreaterThan(0);
      expect(tree.yieldPerCycle, tree.id).toBeGreaterThan(0);
      expect(tree.sellPrice, tree.id).toBeGreaterThan(0);
      expect(tree.revenuePerCycle, tree.id).toBeGreaterThan(0);
      expect(tree.xpPerCycle, tree.id).toBeGreaterThan(0);
      expect(tree.firstReadySeconds, tree.id).toBeGreaterThan(0);
      expect(tree.cycleSeconds, tree.id).toBeGreaterThan(0);
      expect(tree.paybackCycles, tree.id).toBeLessThanOrEqual(2 + EPSILON);
    }
  });

  it("is a longer bet than a crop, not a better one", () => {
    const bestCropGold = Math.max(...CROPS.map((crop) => crop.goldPerMinute));
    for (const tree of TREES) {
      // A tree pays without replanting, so it may come close to the best crop, but it must not beat
      // it: the active player's reward is the crop with the best gold per minute.
      expect(tree.goldPerMinute, tree.id).toBeLessThanOrEqual(bestCropGold + EPSILON);
      // And the orchard is never the experience path.
      expect(tree.xpPerMinute, tree.id).toBeLessThan(0.8 - EPSILON);
      // It costs real time before the first fruit.
      expect(tree.firstReadySeconds, tree.id).toBeGreaterThanOrEqual(tree.cycleSeconds);
    }
  });

  it("makes each later species a bigger, slower investment", () => {
    const byLevel = [...TREES].sort((left, right) => left.requiredLevel - right.requiredLevel);
    for (let index = 1; index < byLevel.length; index += 1) {
      const previous = byLevel[index - 1];
      const current = byLevel[index];
      expect(current?.saplingCost ?? 0).toBeGreaterThan(previous?.saplingCost ?? 0);
      expect(current?.firstReadySeconds ?? 0).toBeGreaterThan(previous?.firstReadySeconds ?? 0);
      expect(current?.cycleSeconds ?? 0).toBeGreaterThan(previous?.cycleSeconds ?? 0);
      expect(current?.revenuePerCycle ?? 0).toBeGreaterThan(previous?.revenuePerCycle ?? 0);
    }
  });
});

describe("the catalogue and the market stay consistent", () => {
  it("prices every shipped seed, sapling, and produce item exactly one way", () => {
    for (const crop of crops) {
      const seedEntry = shops.find((entry) => entry.itemDefinitionId === crop.seedItemDefinitionId);
      const produceEntry = shops.find((entry) => entry.itemDefinitionId === crop.harvest.itemDefinitionId);
      expect(seedEntry?.buyPrice, crop.id).toBeDefined();
      expect(seedEntry?.sellPrice, crop.id).toBeUndefined();
      expect(produceEntry?.sellPrice, crop.id).toBeDefined();
      expect(produceEntry?.buyPrice, crop.id).toBeUndefined();
    }
    for (const tree of trees) {
      const saplingEntry = shops.find((entry) => entry.itemDefinitionId === tree.saplingItemDefinitionId);
      const fruitEntry = shops.find((entry) => entry.itemDefinitionId === tree.harvest.itemDefinitionId);
      expect(saplingEntry?.buyPrice, tree.id).toBeDefined();
      expect(saplingEntry?.sellPrice, tree.id).toBeUndefined();
      expect(fruitEntry?.sellPrice, tree.id).toBeDefined();
      expect(fruitEntry?.buyPrice, tree.id).toBeUndefined();
    }
  });

  it("leaves no item that can be bought and sold in the same breath", () => {
    // A single entry with both a buy and a sell price is the shape an arbitrage loop would take.
    for (const entry of shops) {
      expect(
        entry.buyPrice !== undefined && entry.sellPrice !== undefined,
        entry.id
      ).toBe(false);
    }
    // And no seed or sapling is ever sellable, nor any produce buyable.
    for (const entry of shops) {
      const category = itemRegistry.get(entry.itemDefinitionId)?.category;
      if (entry.buyPrice !== undefined) expect(category, entry.id).toBe("SEED");
      if (entry.sellPrice !== undefined) expect(category, entry.id).toBe("CROP");
    }
  });

  it("keeps every crop's seed and produce distinct from every other crop's", () => {
    const seeds = crops.map((crop) => crop.seedItemDefinitionId);
    const produce = crops.map((crop) => crop.harvest.itemDefinitionId);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(produce).size).toBe(produce.length);
  });

  it("leaves no item orphaned: every seed is planted and every produce item is harvested", () => {
    // The other direction of the cross-reference: an item defined without anything that produces or
    // consumes it is a row that can never appear in a player's inventory, and a stable id nothing
    // references. This fails the moment a definition is renamed on one side only.
    const plantable = new Set([
      ...crops.map((crop) => crop.seedItemDefinitionId),
      ...trees.map((tree) => tree.saplingItemDefinitionId)
    ]);
    const harvested = new Set([
      ...crops.map((crop) => crop.harvest.itemDefinitionId),
      ...trees.map((tree) => tree.harvest.itemDefinitionId)
    ]);
    for (const item of itemRegistry.values()) {
      if (item.category === "SEED") expect(plantable.has(item.id), item.id).toBe(true);
      if (item.category === "CROP") expect(harvested.has(item.id), item.id).toBe(true);
    }
    // And no seed or sapling is shared: each planting input names exactly one thing to grow.
    expect(plantable.size).toBe(crops.length + trees.length);
    expect(harvested.size).toBe(crops.length + trees.length);
  });
});
