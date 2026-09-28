import { DomainError } from "./errors";
import type {
  CurrencyDefinitionId,
  EconomyTransactionId,
  ItemDefinitionId,
  PlayerId,
  ShopEntryId
} from "./ids";

export const MAX_WALLET_BALANCE = Number.MAX_SAFE_INTEGER;
export const MAX_SHOP_QUANTITY = 1_000_000;

export interface CurrencyDefinition {
  readonly id: CurrencyDefinitionId;
  readonly displayNameKey: string;
  readonly maxBalance: number;
}

export interface ShopEntry {
  readonly id: ShopEntryId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly buyPrice: number;
  readonly sellPrice: number;
  readonly maxQuantityPerRequest: number;
}

export interface Wallet {
  readonly playerId: PlayerId;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly balance: number;
  readonly version: number;
  readonly updatedAt: string;
}

export type EconomyReason = "SHOP_BUY" | "SHOP_SELL";
export type EconomyReferenceType = "SHOP_ENTRY";

export interface EconomyMutation {
  readonly transactionId: EconomyTransactionId;
  readonly playerId: PlayerId;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly delta: number;
  readonly reason: EconomyReason;
  readonly referenceType: EconomyReferenceType;
  readonly referenceId: ShopEntryId;
  readonly requestId: string;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly expectedWalletVersion: number;
  readonly createdAt: string;
}

export type EconomyLedgerEntry = EconomyMutation;

export function calculateShopTotal(entry: ShopEntry, quantity: number, operation: "BUY" | "SELL"): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > entry.maxQuantityPerRequest) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Shop quantity is invalid");
  }
  const unitPrice = operation === "BUY" ? entry.buyPrice : entry.sellPrice;
  const total = unitPrice * quantity;
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0 || !Number.isSafeInteger(total)) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Shop total is outside the safe integer range");
  }
  return total;
}

export function createEconomyMutation(
  wallet: Wallet,
  definition: CurrencyDefinition,
  input: Omit<EconomyMutation, "playerId" | "currencyDefinitionId" | "balanceBefore" | "balanceAfter" | "expectedWalletVersion" | "referenceType">
): EconomyMutation {
  if (wallet.currencyDefinitionId !== definition.id || definition.maxBalance !== MAX_WALLET_BALANCE) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet currency definition is invalid");
  }
  if (!Number.isSafeInteger(wallet.balance) || wallet.balance < 0 || wallet.balance > definition.maxBalance) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet balance is invalid");
  }
  if (!Number.isSafeInteger(wallet.version) || wallet.version < 1) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet version is invalid");
  }
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Currency delta must be a non-zero safe integer");
  }
  const balanceAfter = wallet.balance + input.delta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter > definition.maxBalance) {
    throw new DomainError("WALLET_LIMIT_EXCEEDED", "Wallet maximum would be exceeded");
  }
  if (balanceAfter < 0) {
    throw new DomainError("INSUFFICIENT_FUNDS", "Wallet cannot become negative");
  }
  return {
    ...input,
    referenceType: "SHOP_ENTRY",
    playerId: wallet.playerId,
    currencyDefinitionId: wallet.currencyDefinitionId,
    balanceBefore: wallet.balance,
    balanceAfter,
    expectedWalletVersion: wallet.version
  };
}
