import { describe, expect, it } from "vitest";
import { EconomyService, type Clock, type EconomyTransactionIdGenerator } from "@happy-farm/application";
import {
  MAX_WALLET_BALANCE,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseShopEntryId
} from "@happy-farm/domain";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const ids: EconomyTransactionIdGenerator = {
  newEconomyTransactionId: () => parseEconomyTransactionId("econ_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
};
const clock: Clock = { now: () => NOW };
const currency = {
  id: parseCurrencyDefinitionId("currency_gold"),
  displayNameKey: "currency.gold.name",
  maxBalance: MAX_WALLET_BALANCE
};
const wallet = {
  playerId: PLAYER_ONE_ID,
  currencyDefinitionId: currency.id,
  balance: 10,
  version: 1,
  updatedAt: NOW
};

describe("EconomyService boundary", () => {
  it("derives actor identity and maps wallet rule failures to stable errors", () => {
    const service = new EconomyService(ids, clock);
    const input = {
      delta: -4,
      reason: "SHOP_BUY" as const,
      shopEntryId: parseShopEntryId("shop_carrot"),
      requestId: "economy_request_001"
    };
    expect(service.prepareMutation({ playerId: PLAYER_ONE_ID }, wallet, currency, input)).toMatchObject({
      playerId: PLAYER_ONE_ID,
      balanceAfter: 6
    });
    expect(() => service.prepareMutation(null, wallet, currency, input)).toThrow();
    expect(() => service.prepareMutation({ playerId: PLAYER_TWO_ID }, wallet, currency, input)).toThrow();
    expect(() => service.prepareMutation({ playerId: PLAYER_ONE_ID }, wallet, currency, { ...input, delta: -11 })).toThrow();
  });
});
