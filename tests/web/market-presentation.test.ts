import { describe, expect, it } from "vitest";
import type {
  CropDefinitionDTO,
  InventoryEntryDTO,
  ShopEntryDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import {
  clampMarketQuantity,
  defaultMarketDirection,
  marketCanSubmit,
  marketCardFor,
  marketCards,
  marketMaxAffordable,
  marketQuantityBounds,
  marketQuantityStep,
  marketTotal,
  ownedQuantity,
  plantingLevelFor,
  type MarketInput
} from "../../apps/web/src/market/market";

/**
 * The Farm Market's shelf and its transaction arithmetic.
 *
 * Everything here is presentation: which items are on which tab, what a card says, and what the
 * quantity control will let a player ask for. What it deliberately does *not* test is the price or the
 * settlement - those are the catalogue's and the server's, and the market merely displays them.
 */

const ENTRIES: readonly ShopEntryDTO[] = [
  {
    shopEntryId: "shop_carrot_seed",
    itemDefinitionId: "item_carrot_seed",
    itemDisplayNameKey: "item.carrot_seed.name",
    category: "SEED",
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    buyPrice: 2,
    sellPrice: null,
    maxQuantityPerRequest: 1000
  },
  {
    shopEntryId: "shop_corn_seed",
    itemDefinitionId: "item_corn_seed",
    itemDisplayNameKey: "item.corn_seed.name",
    category: "SEED",
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    buyPrice: 6,
    sellPrice: null,
    maxQuantityPerRequest: 1000
  },
  {
    shopEntryId: "shop_apple_sapling",
    itemDefinitionId: "item_apple_sapling",
    itemDisplayNameKey: "item.apple_sapling.name",
    category: "SEED",
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    buyPrice: 20,
    sellPrice: null,
    maxQuantityPerRequest: 1000
  },
  {
    shopEntryId: "shop_carrot",
    itemDefinitionId: "item_carrot",
    itemDisplayNameKey: "item.carrot.name",
    category: "CROP",
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    buyPrice: null,
    sellPrice: 2,
    maxQuantityPerRequest: 1000
  },
  {
    shopEntryId: "shop_corn",
    itemDefinitionId: "item_corn",
    itemDisplayNameKey: "item.corn.name",
    category: "CROP",
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    buyPrice: null,
    sellPrice: 6,
    maxQuantityPerRequest: 1000
  }
];

const CROPS: readonly CropDefinitionDTO[] = [
  {
    cropDefinitionId: "crop_carrot",
    displayNameKey: "crop.carrot.name",
    growthDurationSeconds: 300,
    seedItemDefinitionId: "item_carrot_seed",
    seedItemDisplayNameKey: "item.carrot_seed.name",
    harvestItemDefinitionId: "item_carrot",
    baseQuantity: 2,
    harvestXp: 1,
    requiredLevel: 1
  },
  {
    cropDefinitionId: "crop_corn",
    displayNameKey: "crop.corn.name",
    growthDurationSeconds: 900,
    seedItemDefinitionId: "item_corn_seed",
    seedItemDisplayNameKey: "item.corn_seed.name",
    harvestItemDefinitionId: "item_corn",
    baseQuantity: 3,
    harvestXp: 2,
    requiredLevel: 3
  }
];

const TREES: readonly TreeDefinitionDTO[] = [
  {
    treeDefinitionId: "tree_apple",
    displayNameKey: "tree.apple.name",
    saplingItemDefinitionId: "item_apple_sapling",
    saplingItemDisplayNameKey: "item.apple_sapling.name",
    firstReadySeconds: 3600,
    regrowSeconds: 600,
    growthStages: 3,
    harvestItemDefinitionId: "item_apple",
    baseQuantity: 3,
    harvestXp: 4,
    requiredLevel: 1
  }
];

function row(itemDefinitionId: string, quantity: number): InventoryEntryDTO {
  return { itemDefinitionId, displayNameKey: `item.${itemDefinitionId}.name`, category: "CROP", quantity };
}

function input(overrides: Partial<MarketInput> = {}): MarketInput {
  return {
    entries: ENTRIES,
    direction: "buy",
    inventory: [row("item_carrot", 35), row("item_carrot_seed", 39)],
    cropDefinitions: CROPS,
    treeDefinitions: TREES,
    playerLevel: 1,
    ...overrides
  };
}

describe("the market shelf", () => {
  it("shows what the catalogue sells, and only that, on the buy tab", () => {
    const cards = marketCards(input({ direction: "buy" }));
    expect(new Set(cards.map((card) => card.itemDefinitionId))).toEqual(
      new Set(["item_carrot_seed", "item_corn_seed", "item_apple_sapling"])
    );
    // Produces are not for sale: the catalogue gives them a sell price and no buy price.
    expect(cards.every((card) => card.unitPrice > 0)).toBe(true);
  });

  it("shows only what the player owns on the sell tab", () => {
    const cards = marketCards(input({ direction: "sell" }));
    expect(cards.map((card) => card.itemDefinitionId)).toEqual(["item_carrot"]);
    expect(cards[0]?.owned).toBe(35);
    expect(cards[0]?.unitPrice).toBe(2);
    // Corn is sellable in the catalogue and the player has none: the shelf does not list it.
    expect(marketCardFor(cards, "shop_corn")).toBeNull();
  });

  it("has an empty sell shelf when nothing harvestable is owned", () => {
    const cards = marketCards(input({ direction: "sell", inventory: [row("item_carrot_seed", 12)] }));
    expect(cards).toEqual([]);
  });

  it("sums duplicate inventory rows for the owned count", () => {
    expect(ownedQuantity([row("item_carrot", 30), row("item_carrot", 5)], "item_carrot")).toBe(35);
    expect(ownedQuantity([row("item_carrot", 0)], "item_carrot")).toBe(0);
    expect(ownedQuantity([], "item_carrot")).toBe(0);
  });

  it("puts seeds the player cannot plant yet after the ones they can", () => {
    const cards = marketCards(input({ direction: "buy", playerLevel: 1 }));
    // Corn's crop needs level 3; carrot's needs 1; a sapling's tree needs 1.
    expect(cards.map((card) => card.itemDefinitionId)).toEqual([
      "item_carrot_seed",
      "item_apple_sapling",
      "item_corn_seed"
    ]);
    expect(cards[2]?.plantingLevel).toBe(3);
  });

  it("knows the level an item becomes plantable, and nothing for produce", () => {
    expect(plantingLevelFor("item_corn_seed", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBe(3);
    expect(plantingLevelFor("item_apple_sapling", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBe(1);
    expect(plantingLevelFor("item_carrot", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBeNull();
    expect(plantingLevelFor("item_unknown", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBeNull();
  });

  it("reorders the same shelf when the level arrives, with nothing bought", () => {
    // The level-up case: the catalogue, the inventory and the gold are all unchanged; only the level
    // moved. The shelf is rebuilt from it, so corn is no longer sorted as a seed the player cannot
    // plant yet. The note the card shows follows the same comparison, from the same level.
    const before = marketCards(input({ direction: "buy", playerLevel: 1 }));
    const after = marketCards(input({ direction: "buy", playerLevel: 3 }));
    expect(before.map((card) => card.itemDefinitionId)).toEqual([
      "item_carrot_seed",
      "item_apple_sapling",
      "item_corn_seed"
    ]);
    expect(after.map((card) => card.itemDefinitionId)).toEqual([
      "item_carrot_seed",
      "item_corn_seed",
      "item_apple_sapling"
    ]);
    // The requirement itself is a catalogue fact and does not move; only whether it is met does.
    expect(marketCardFor(after, "shop_corn_seed")?.plantingLevel).toBe(3);
  });

  it("opens on sell when there is something to sell, and on buy when there is not", () => {
    expect(defaultMarketDirection(input({ direction: "sell" }))).toBe("sell");
    expect(defaultMarketDirection(input({ direction: "sell", inventory: [row("item_carrot_seed", 5)] }))).toBe("buy");
  });
});

describe("the transaction arithmetic", () => {
  const carrotSeed = marketCardFor(marketCards(input({ direction: "buy" })), "shop_carrot_seed");
  const carrot = marketCardFor(marketCards(input({ direction: "sell" })), "shop_carrot");
  if (carrotSeed === null || carrot === null) throw new Error("fixture produced no card");

  it("bounds a buy by what the wallet covers and the entry's own ceiling", () => {
    // 100 gold at 2 each is 50 seeds, well inside the 1000 per request.
    expect(marketQuantityBounds(carrotSeed, "buy", 100)).toEqual({ min: 1, max: 50 });
    // 3 gold buys one; 1 gold buys none, and the panel says so rather than sending a doomed request.
    expect(marketQuantityBounds(carrotSeed, "buy", 3).max).toBe(1);
    expect(marketQuantityBounds(carrotSeed, "buy", 1).max).toBe(0);
    expect(marketQuantityBounds(carrotSeed, "buy", 0).max).toBe(0);
    expect(marketMaxAffordable(100, 2, 10)).toBe(10);
    expect(marketMaxAffordable(100, 0, 10)).toBe(0);
    expect(marketMaxAffordable(Number.NaN, 2, 10)).toBe(0);
  });

  it("bounds a sell by what the player holds", () => {
    expect(marketQuantityBounds(carrot, "sell", 0)).toEqual({ min: 1, max: 35 });
  });

  it("clamps a quantity to its bounds, including nonsense", () => {
    const bounds = { min: 1, max: 10 };
    expect(clampMarketQuantity(5, bounds)).toBe(5);
    expect(clampMarketQuantity(0, bounds)).toBe(1);
    expect(clampMarketQuantity(-4, bounds)).toBe(1);
    expect(clampMarketQuantity(99, bounds)).toBe(10);
    expect(clampMarketQuantity(4.7, bounds)).toBe(4);
    expect(clampMarketQuantity(Number.NaN, bounds)).toBe(1);
    // "You cannot afford one" is a bound, not a crash: the minimum is still 1, the maximum is 0.
    expect(clampMarketQuantity(5, { min: 1, max: 0 })).toBe(1);
    expect(marketCanSubmit(1, { min: 1, max: 0 })).toBe(false);
  });

  it("steps one at a time and stops at both ends", () => {
    const bounds = { min: 1, max: 3 };
    expect(marketQuantityStep(1, -1, bounds)).toBe(1);
    expect(marketQuantityStep(2, 1, bounds)).toBe(3);
    expect(marketQuantityStep(3, 1, bounds)).toBe(3);
    // MAX is just the upper bound, which is what the button sets.
    expect(clampMarketQuantity(999, bounds)).toBe(3);
  });

  it("totals unit price times quantity, and refuses to invent a number", () => {
    expect(marketTotal(2, 5)).toBe(10);
    expect(marketTotal(6, 1)).toBe(6);
    expect(marketTotal(2, Number.NaN)).toBe(0);
    expect(marketTotal(1.5, 2)).toBe(0);
    expect(marketTotal(Number.MAX_SAFE_INTEGER, 3)).toBe(0);
  });

  it("allows a trade only inside its bounds", () => {
    expect(marketCanSubmit(1, { min: 1, max: 35 })).toBe(true);
    expect(marketCanSubmit(35, { min: 1, max: 35 })).toBe(true);
    expect(marketCanSubmit(36, { min: 1, max: 35 })).toBe(false);
    expect(marketCanSubmit(0, { min: 1, max: 35 })).toBe(false);
    expect(marketCanSubmit(2.5, { min: 1, max: 35 })).toBe(false);
  });
});
