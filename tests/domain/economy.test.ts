import { describe, expect, it } from "vitest";
import {
  createEconomyMutation,
  calculateShopTotal,
  MAX_WALLET_BALANCE,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseItemDefinitionId,
  parseShopEntryId
} from "@happy-farm/domain";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

const currency = {
  id: parseCurrencyDefinitionId("currency_gold"),
  displayNameKey: "currency.gold.name",
  maxBalance: MAX_WALLET_BALANCE
};
const wallet = {
  playerId: PLAYER_ONE_ID,
  currencyDefinitionId: currency.id,
  balance: 10,
  version: 3,
  updatedAt: NOW
};
const base = {
  transactionId: parseEconomyTransactionId("econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  reason: "SHOP_BUY" as const,
  referenceId: parseShopEntryId("shop_carrot"),
  requestId: "economy_request_001",
  createdAt: NOW
};

describe("economy mutation rules", () => {
  it("uses exact integer arithmetic and records before/after balances", () => {
    expect(createEconomyMutation(wallet, currency, { ...base, delta: -4 })).toMatchObject({
      delta: -4,
      balanceBefore: 10,
      balanceAfter: 6,
      expectedWalletVersion: 3
    });
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid delta %s",
    (delta) => {
      expect(() => createEconomyMutation(wallet, currency, { ...base, delta })).toThrow();
    }
  );

  it("rejects negative and overflowing wallet results", () => {
    expect(() => createEconomyMutation(wallet, currency, { ...base, delta: -11 })).toThrow("negative");
    expect(() =>
      createEconomyMutation(
        { ...wallet, balance: MAX_WALLET_BALANCE },
        currency,
        { ...base, delta: 1 }
      )
    ).toThrow("maximum");
  });

  it("calculates bounded authoritative shop totals", () => {
    const entry = {
      id: parseShopEntryId("shop_carrot"),
      itemDefinitionId: parseItemDefinitionId("item_carrot"),
      currencyDefinitionId: currency.id,
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 100
    };
    expect(calculateShopTotal(entry, 3, "BUY")).toBe(12);
    expect(calculateShopTotal(entry, 3, "SELL")).toBe(6);
    expect(() => calculateShopTotal(entry, 101, "BUY")).toThrow();
  });

  it("accepts the exact safe multiplication boundary and rejects an unsafe total", () => {
    const safeEntry = {
      id: parseShopEntryId("shop_boundary"),
      itemDefinitionId: parseItemDefinitionId("item_carrot"),
      currencyDefinitionId: currency.id,
      buyPrice: Math.floor(Number.MAX_SAFE_INTEGER / 2),
      sellPrice: 1,
      maxQuantityPerRequest: 2
    };
    expect(calculateShopTotal(safeEntry, 2, "BUY")).toBe(9_007_199_254_740_990);
    expect(() => calculateShopTotal({ ...safeEntry, buyPrice: Number.MAX_SAFE_INTEGER }, 2, "BUY")).toThrow();
  });

  it("refuses a direction the entry does not trade instead of pricing it at nothing", () => {
    // The shop sells seeds and buys produce, so a null price is a closed direction, never a zero
    // price. Turning it into free gold or a free item is the failure mode this rule exists for.
    const sellOnly = {
      id: parseShopEntryId("shop_carrot"),
      itemDefinitionId: parseItemDefinitionId("item_carrot"),
      currencyDefinitionId: currency.id,
      buyPrice: null,
      sellPrice: 2,
      maxQuantityPerRequest: 100
    };
    expect(calculateShopTotal(sellOnly, 3, "SELL")).toBe(6);
    expect(() => calculateShopTotal(sellOnly, 1, "BUY")).toThrow();

    const buyOnly = { ...sellOnly, id: parseShopEntryId("shop_carrot_seed"), buyPrice: 2, sellPrice: null };
    expect(calculateShopTotal(buyOnly, 3, "BUY")).toBe(6);
    expect(() => calculateShopTotal(buyOnly, 1, "SELL")).toThrow();
  });
});
