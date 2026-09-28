import {
  createEconomyMutation,
  DomainError,
  type CurrencyDefinition,
  parseCurrencyDefinitionId,
  type EconomyMutation,
  type EconomyReason,
  type ShopEntryId,
  type Wallet
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  EconomyMutationRepository,
  EconomyTransactionIdGenerator,
  WalletRepository
} from "./ports";

export interface PrepareEconomyMutation {
  readonly delta: number;
  readonly reason: EconomyReason;
  readonly shopEntryId: ShopEntryId;
  readonly requestId: string;
}

export interface ApplyEconomyMutation extends PrepareEconomyMutation {
  readonly currencyDefinitionId: string;
}

export class EconomyService {
  constructor(
    private readonly ids: EconomyTransactionIdGenerator,
    private readonly clock: Clock,
    private readonly definitions?: CurrencyDefinitionRepository,
    private readonly wallets?: WalletRepository,
    private readonly mutations?: EconomyMutationRepository
  ) {}

  async mutate(actor: ActorContext | null, input: ApplyEconomyMutation): Promise<EconomyMutation> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (this.definitions === undefined || this.wallets === undefined || this.mutations === undefined) {
      throw new ApplicationError("INTERNAL_ERROR", "Economy persistence is not configured");
    }
    let currencyId;
    try {
      currencyId = parseCurrencyDefinitionId(input.currencyDefinitionId);
    } catch {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    const definition = this.definitions.findById(currencyId);
    if (definition === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }

    // A guarded database version predicate is authoritative. Retrying revalidates
    // the mutation against the newest balance after a concurrent writer wins.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const wallet =
        (await this.wallets.find(actor.playerId, currencyId)) ?? {
          playerId: actor.playerId,
          currencyDefinitionId: currencyId,
          balance: 0,
          version: 1,
          updatedAt: this.clock.now()
        };
      const mutation = this.prepareMutation(actor, wallet, definition, input);
      try {
        await this.mutations.applyAtomically(mutation);
        return mutation;
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Wallet changed concurrently");
  }

  prepareMutation(
    actor: ActorContext | null,
    wallet: Wallet,
    currency: CurrencyDefinition,
    input: PrepareEconomyMutation
  ): EconomyMutation {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (wallet.playerId !== actor.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Wallet access is not allowed");
    }
    try {
      return createEconomyMutation(wallet, currency, {
        transactionId: this.ids.newEconomyTransactionId(),
        delta: input.delta,
        reason: input.reason,
        referenceId: input.shopEntryId,
        requestId: input.requestId,
        createdAt: this.clock.now()
      });
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      switch (error.code) {
        case "INSUFFICIENT_FUNDS":
          throw new ApplicationError("INSUFFICIENT_FUNDS", error.message);
        case "WALLET_LIMIT_EXCEEDED":
          throw new ApplicationError("WALLET_LIMIT_EXCEEDED", error.message);
        default:
          throw new ApplicationError("INVALID_INPUT", error.message);
      }
    }
  }
}
