import { parseCurrencyDefinitionId, type CurrencyDefinition, type PlayerId, type Wallet } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  StarterGrantRepository,
  WalletRepository
} from "./ports";

/**
 * The starter package's authoritative definition, handed in by the composition root.
 *
 * `packages/application` does not import game data, so the seed, the quantity, the currency, and the
 * gold amount arrive as plain values from `@happy-farm/game-data` via `workers/api/src/runtime.ts`.
 * Nothing else may supply them: there is no route, and no command, that carries an item ID, a
 * currency ID, or a quantity for a grant.
 */
export interface StarterPackageDefinition {
  readonly grantKey: string;
  readonly seedItemDefinitionId: string;
  readonly seedQuantity: number;
  readonly currencyDefinitionId: string;
  readonly goldAmount: number;
}

export interface StarterPackageGrantResult {
  readonly grantKey: string;
  readonly seedItemDefinitionId: string;
  readonly seedQuantity: number;
  readonly currencyDefinitionId: string;
  readonly goldAmount: number;
  /** False when the player already had the receipt, which is the normal answer on every later call. */
  readonly granted: boolean;
}

/**
 * Gives a player their one-time starter package: seeds to plant and the gold to buy more.
 *
 * This is the onboarding step, not a command: it takes no item, no currency, no quantity, and no
 * request ID from a caller, and it is safe to call on every onboarding pass because the grant
 * repository keys the receipt by `(player, grant key)`. That is what makes "signing in again",
 * "creating a second farm", "refreshing the page", and "replaying a request" all answer with the
 * same package and no more.
 *
 * Both halves are *prepared* through the centralized boundaries -- `InventoryService` for the seed
 * credit and `EconomyService` for the currency credit -- so an impossible seed stack or an
 * unrepresentable balance is refused here, before any statement runs. The grant repository is what
 * applies both, together with the receipt, in one atomic statement.
 */
export class GrantStarterPackage {
  constructor(
    private readonly grants: StarterGrantRepository,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
    private readonly currencies: CurrencyDefinitionRepository,
    private readonly wallets: WalletRepository,
    private readonly clock: Clock,
    private readonly definition: StarterPackageDefinition
  ) {}

  async execute(actor: ActorContext | null): Promise<StarterPackageGrantResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const now = this.clock.now();
    // The seed credit, prepared by the only boundary that may prepare an inventory mutation.
    const addition = this.inventoryService.prepareAddition(
      actor.playerId,
      this.definition.seedItemDefinitionId,
      this.definition.seedQuantity
    );
    const currency = this.requireCurrency(this.definition.currencyDefinitionId);
    // The currency credit, prepared by the only boundary that may prepare one. A player who has
    // never traded has no wallet yet, which is the ordinary case here: the receipt's own statement
    // creates the wallet and then credits it.
    const wallet =
      (await this.wallets.find(actor.playerId, currency.id)) ?? this.emptyWallet(actor.playerId, currency, now);
    const mutation = this.economyService.prepareMutation(actor, wallet, currency, {
      delta: this.definition.goldAmount,
      reason: "STARTER_GRANT",
      referenceId: actor.playerId,
      requestId: starterRequestId(this.definition.grantKey, actor.playerId)
    });

    const granted = await this.grants.grantStarterPackageAtomically({
      playerId: actor.playerId,
      grantKey: this.definition.grantKey,
      itemDefinitionId: addition.itemDefinitionId,
      itemQuantity: addition.quantity,
      currencyDefinitionId: currency.id,
      goldAmount: mutation.delta,
      transactionId: mutation.transactionId,
      requestId: mutation.requestId,
      timestamp: now
    });

    return {
      grantKey: this.definition.grantKey,
      seedItemDefinitionId: addition.itemDefinitionId,
      seedQuantity: addition.quantity,
      currencyDefinitionId: currency.id,
      goldAmount: mutation.delta,
      granted
    };
  }

  private requireCurrency(currencyDefinitionId: string): CurrencyDefinition {
    let parsedId;
    try {
      parsedId = parseCurrencyDefinitionId(currencyDefinitionId);
    } catch {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    const definition = this.currencies.findById(parsedId);
    if (definition === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    return definition;
  }

  private emptyWallet(playerId: PlayerId, currency: CurrencyDefinition, now: string): Wallet {
    return {
      playerId,
      currencyDefinitionId: currency.id,
      balance: 0,
      version: 1,
      updatedAt: now
    };
  }
}

/**
 * The ledger request ID a package settles under.
 *
 * Derived from the receipt key and the player, because the grant is not a command and carries no
 * request ID of its own. It is stable for a player and a package version, which is what makes a
 * repeated onboarding pass recognisable in the ledger as the same grant rather than a new one.
 */
function starterRequestId(grantKey: string, playerId: PlayerId): string {
  return `starter:${grantKey}:${playerId}`;
}
