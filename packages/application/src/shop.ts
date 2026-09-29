import {
  calculateShopTotal,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parseItemDefinitionId,
  parseShopEntryId,
  type EconomyMutation,
  type InventoryItem,
  type InventoryMutation,
  type ShopEntry
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  EconomySettlementRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  ShopEntryRepository,
  WalletRepository
} from "./ports";

type ShopOperation = "BUY" | "SELL";

export interface ShopCommand {
  readonly requestId: string;
  readonly shopEntryId: string;
  readonly quantity: number;
}

export interface BuyItemResult {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly currencyId: string;
  readonly amountSpent: number;
  readonly newBalance: number;
}

export interface SellItemResult {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly currencyId: string;
  readonly amountReceived: number;
  readonly newBalance: number;
}

type ShopResult = BuyItemResult | SellItemResult;

interface ShopDependencies {
  readonly shops: ShopEntryRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly wallets: WalletRepository;
  readonly inventory: InventoryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly settlement: EconomySettlementRepository;
  readonly economyService: EconomyService;
  readonly inventoryService: InventoryService;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

abstract class SettleShopItem<T extends ShopResult> {
  protected abstract readonly operation: ShopOperation;

  constructor(protected readonly dependencies: ShopDependencies) {}

  async execute(actor: ActorContext | null, command: ShopCommand): Promise<T> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let shopEntryId;
    try {
      shopEntryId = parseShopEntryId(command.shopEntryId);
    } catch {
      throw new ApplicationError("SHOP_ENTRY_NOT_FOUND", "Shop entry was not found");
    }
    const entry = this.dependencies.shops.findById(shopEntryId);
    if (entry === null) throw new ApplicationError("SHOP_ENTRY_NOT_FOUND", "Shop entry was not found");

    // The direction a market row trades in is server data, not a client choice. Gold buys seeds and
    // the shop buys produce; asking for the other direction is refused before any price is read, so
    // a null price can never turn into a free purchase or a zero-value sale.
    const priceForDirection = this.operation === "BUY" ? entry.buyPrice : entry.sellPrice;
    if (priceForDirection === null) {
      throw new ApplicationError(
        "SHOP_ENTRY_NOT_ALLOWED",
        "This shop entry does not trade in that direction"
      );
    }

    let total: number;
    try {
      total = calculateShopTotal(entry, command.quantity, this.operation);
    } catch {
      throw new ApplicationError("INVALID_QUANTITY", "Transaction quantity is invalid");
    }
    if (this.dependencies.currencies.findById(entry.currencyDefinitionId) === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([entry.id, command.quantity])
    );
    const operation = this.operation === "BUY" ? "BUY_ITEM" : "SELL_ITEM";
    const existing = await this.dependencies.idempotency.find(actor.playerId, operation, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const expectedInventory = await this.dependencies.inventory.find(actor.playerId, entry.itemDefinitionId);
      const wallet =
        (await this.dependencies.wallets.find(actor.playerId, entry.currencyDefinitionId)) ?? {
          playerId: actor.playerId,
          currencyDefinitionId: entry.currencyDefinitionId,
          balance: 0,
          version: 1,
          updatedAt: this.dependencies.clock.now()
        };
      const prepared = this.prepare(actor, entry, command, total, wallet, expectedInventory);
      const result = this.result(entry, command.quantity, total, prepared.economy.balanceAfter);
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: prepared.economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: this.dependencies.clock.now()
      };
      try {
        await this.dependencies.settlement.settleShopAtomically(
          prepared.economy,
          prepared.inventory,
          expectedInventory,
          record
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, operation, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
  }

  private prepare(
    actor: ActorContext,
    entry: ShopEntry,
    command: ShopCommand,
    total: number,
    wallet: Parameters<EconomyService["prepareMutation"]>[1],
    current: InventoryItem | null
  ): { readonly economy: EconomyMutation; readonly inventory: InventoryMutation } {
    if (this.operation === "BUY") {
      const addition = this.dependencies.inventoryService.prepareAddition(
        actor.playerId,
        entry.itemDefinitionId,
        command.quantity
      );
      if (current !== null && current.quantity > addition.maxQuantity - command.quantity) {
        throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", "Inventory limit would be exceeded");
      }
      return {
        economy: this.dependencies.economyService.prepareMutation(actor, wallet, this.requireCurrency(entry), {
          delta: -total,
          reason: "SHOP_BUY",
          referenceId: entry.id,
          requestId: command.requestId
        }),
        inventory: addition
      };
    }
    if (current === null || current.quantity < command.quantity) {
      throw new ApplicationError("INSUFFICIENT_ITEMS", "Inventory quantity is insufficient");
    }
    return {
      economy: this.dependencies.economyService.prepareMutation(actor, wallet, this.requireCurrency(entry), {
        delta: total,
        reason: "SHOP_SELL",
        referenceId: entry.id,
        requestId: command.requestId
      }),
      inventory: this.dependencies.inventoryService.prepareRemoval(actor.playerId, entry.itemDefinitionId, command.quantity)
    };
  }

  private requireCurrency(entry: ShopEntry) {
    const currency = this.dependencies.currencies.findById(entry.currencyDefinitionId);
    if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    return currency;
  }

  private result(entry: ShopEntry, quantity: number, total: number, newBalance: number): T {
    return (this.operation === "BUY"
      ? { itemDefinitionId: entry.itemDefinitionId, quantity, currencyId: entry.currencyDefinitionId, amountSpent: total, newBalance }
      : { itemDefinitionId: entry.itemDefinitionId, quantity, currencyId: entry.currencyDefinitionId, amountReceived: total, newBalance }) as unknown as T;
  }

  private replay(record: IdempotencyRecord, fingerprint: string): T {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      parseEconomyTransactionId(record.resourceId);
      parseItemDefinitionId(String(value.itemDefinitionId));
      parseCurrencyDefinitionId(String(value.currencyId));
      if (!Number.isSafeInteger(value.quantity) || (value.quantity as number) <= 0 ||
          !Number.isSafeInteger(value.newBalance) || (value.newBalance as number) < 0 ||
          (this.operation === "BUY"
            ? !Number.isSafeInteger(value.amountSpent) || (value.amountSpent as number) <= 0
            : !Number.isSafeInteger(value.amountReceived) || (value.amountReceived as number) <= 0)) {
        throw new Error("invalid stored result");
      }
      return value as T;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export class BuyItem extends SettleShopItem<BuyItemResult> {
  protected readonly operation = "BUY" as const;
}

export class SellItem extends SettleShopItem<SellItemResult> {
  protected readonly operation = "SELL" as const;
}
