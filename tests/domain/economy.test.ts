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
});
