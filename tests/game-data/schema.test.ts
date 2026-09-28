import { describe, expect, it } from "vitest";
import {
  createCropRegistry,
  createCurrencyRegistry,
  createItemRegistry,
  createShopRegistry,
  crops,
  currencies,
  currencyRegistry,
  itemRegistry,
  playerProgression,
  playerProgressionRegistry,
  shops,
  validateCropItemReferences,
  validateDefinitions
} from "@happy-farm/game-data";

describe("game-data validation", () => {
  it("accepts stable semantic IDs and rejects malformed definitions", () => {
    expect(validateDefinitions([{ id: "crop_carrot", displayName: "Carrot" }])).toHaveLength(1);
    expect(() => validateDefinitions([{ id: "Carrot", displayName: "Carrot" }])).toThrow();
  });

  it("validates crop timing, stages, IDs, rewards, and duplicates", () => {
    const valid = {
      id: "crop_radish",
      displayNameKey: "crop.radish.name",
      growthDurationSeconds: 120,
      growthStages: 3,
      harvest: { itemDefinitionId: "item_radish", baseQuantity: 2, xp: 3 }
    };
    expect(createCropRegistry([valid]).size).toBe(1);
    expect(() => createCropRegistry([{ ...valid, growthDurationSeconds: 0 }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, growthStages: 1 }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, id: "Radish" }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, harvest: { ...valid.harvest, baseQuantity: 0 } }])).toThrow();
    expect(() => createCropRegistry([{ ...valid, harvest: { ...valid.harvest, xp: 0 } }])).toThrow();
    expect(() =>
      createCropRegistry([{ ...valid, harvest: { itemDefinitionId: "item_radish", baseQuantity: 2 } }])
    ).toThrow();
    expect(() => createCropRegistry([valid, valid])).toThrow("Duplicate crop definition");
  });

  it("validates item definitions and crop harvest references", () => {
    const items = createItemRegistry([
      { id: "item_radish", displayNameKey: "item.radish.name", category: "CROP", stackable: true, maxStack: 100 }
    ]);
    const crops = createCropRegistry([
      {
        id: "crop_radish",
        displayNameKey: "crop.radish.name",
        growthDurationSeconds: 60,
        growthStages: 2,
        harvest: { itemDefinitionId: "item_missing", baseQuantity: 1, xp: 1 }
      }
    ]);
    expect(() => {
      validateCropItemReferences(crops, items);
    }).toThrow("Unknown harvest item definition");
    expect(() =>
      createItemRegistry([
        { id: "item_bad", displayNameKey: "bad", category: "CROP", stackable: true, maxStack: 0 }
      ])
    ).toThrow();
  });

  it("validates currency and server-owned shop pricing definitions", () => {
    expect(
      createCurrencyRegistry([
        { id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER }
      ]).size
    ).toBe(1);
    expect(() =>
      createCurrencyRegistry([
        { id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER + 1 }
      ])
    ).toThrow();
    expect(() =>
      createShopRegistry([
        { id: "shop_bad", itemDefinitionId: "item_missing", currencyDefinitionId: "currency_gold", buyPrice: 4, sellPrice: 2, maxQuantityPerRequest: 10 }
      ])
    ).toThrow("Unknown shop item definition");
    expect(() =>
      createShopRegistry([
        { id: "shop_bad", itemDefinitionId: "item_carrot", currencyDefinitionId: "currency_gold", buyPrice: 2, sellPrice: 4, maxQuantityPerRequest: 10 }
      ])
    ).toThrow("Sell price cannot exceed buy price");
    expect(() =>
      createShopRegistry([
        { id: "shop_bad", itemDefinitionId: "item_carrot", currencyDefinitionId: "currency_gold", buyPrice: Number.MAX_SAFE_INTEGER, sellPrice: 1, maxQuantityPerRequest: 2 }
      ])
    ).toThrow("Maximum shop total must be a safe integer");
  });

  it("accepts a valid gameplay currency and rejects invalid currency IDs", () => {
    const registry = createCurrencyRegistry([
      { id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER }
    ]);
    expect(registry.get("currency_gold")?.id).toBe("currency_gold");
    expect(() =>
      createCurrencyRegistry([{ id: "gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER }])
    ).toThrow();
    expect(() =>
      createCurrencyRegistry([{ id: "Currency_Gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER }])
    ).toThrow();
  });

  it("accepts a valid development shop entry and rejects unknown cross-references", () => {
    const valid = {
      id: "shop_dev_carrot",
      itemDefinitionId: "item_carrot",
      currencyDefinitionId: "currency_gold",
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 100
    };
    expect(createShopRegistry([valid]).get("shop_dev_carrot")?.buyPrice).toBe(4);
    expect(() => createShopRegistry([{ ...valid, itemDefinitionId: "item_missing" }])).toThrow(
      "Unknown shop item definition"
    );
    expect(() => createShopRegistry([{ ...valid, currencyDefinitionId: "currency_missing" }])).toThrow(
      "Unknown shop currency definition"
    );
  });

  it("rejects negative, zero, and fractional shop prices", () => {
    const base = {
      id: "shop_dev_carrot",
      itemDefinitionId: "item_carrot",
      currencyDefinitionId: "currency_gold",
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 100
    };
    expect(() => createShopRegistry([{ ...base, buyPrice: -1 }])).toThrow();
    expect(() => createShopRegistry([{ ...base, buyPrice: 0 }])).toThrow();
    expect(() => createShopRegistry([{ ...base, sellPrice: 0 }])).toThrow();
    expect(() => createShopRegistry([{ ...base, sellPrice: 2.5 }])).toThrow();
  });

  it("rejects duplicate currency and shop entry IDs", () => {
    const currency = { id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: Number.MAX_SAFE_INTEGER };
    expect(() => createCurrencyRegistry([currency, currency])).toThrow("Duplicate currency definition");
    const shop = {
      id: "shop_dev_carrot",
      itemDefinitionId: "item_carrot",
      currencyDefinitionId: "currency_gold",
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 100
    };
    expect(() => createShopRegistry([shop, shop])).toThrow("Duplicate shop entry");
  });

  it("ships a small, internally consistent development fixture set", () => {
    expect(currencies.map((currency) => currency.id)).toContain("currency_gold");
    expect(shops.length).toBeGreaterThanOrEqual(2);
    expect(shops.length).toBeLessThanOrEqual(4);
    for (const entry of shops) {
      expect(itemRegistry.has(entry.itemDefinitionId)).toBe(true);
      expect(currencyRegistry.has(entry.currencyDefinitionId)).toBe(true);
      expect(entry.sellPrice).toBeLessThanOrEqual(entry.buyPrice);
    }
  });

  it("ships a level curve and rewards a player can actually progress through", () => {
    expect(playerProgressionRegistry.get("progression_player_default")).toBe(playerProgression);
    expect(playerProgression.maxLevel).toBeGreaterThan(1);
    expect(playerProgression.xpStep).toBeGreaterThan(0);
    for (const crop of crops) {
      expect(Number.isSafeInteger(crop.harvest.xp)).toBe(true);
      expect(crop.harvest.xp).toBeGreaterThan(0);
    }
    // The slowest crop has to be worth at least as much as the fastest, or the curve rewards
    // waiting less than it rewards re-planting carrots.
    const carrot = crops.find((crop) => crop.id === "crop_carrot");
    const corn = crops.find((crop) => crop.id === "crop_corn");
    expect(carrot).toBeDefined();
    expect(corn).toBeDefined();
    if (carrot !== undefined && corn !== undefined) {
      expect(corn.harvest.xp).toBeGreaterThan(carrot.harvest.xp);
    }
  });
});
