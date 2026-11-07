import {
  MAX_AUTO_FUNDING_ITEMS,
  assertCargoDeltaFits,
  cargoUsed,
  isSupplyCategory,
  parseItemDefinitionId,
  planFundingSale,
  type EconomyMutation,
  type FarmId,
  type FundingCandidate,
  type ItemDefinitionId
} from "@happy-farm/domain";
import { autoTransitionId } from "./auto-plant";
import type { AutoFundingSaleLeg, AutoFundingSettlement, AutoSupplySettlementContext, CargoService } from "./cargo";
import type { EconomyService } from "./economy";
import { ApplicationError } from "./errors";
import { requireOwnedFarm } from "./jobs";
import type {
  ActorContext,
  ActorJobRepository,
  ActorRepository,
  CargoRepository,
  Clock,
  CurrencyDefinitionRepository,
  CargoPurchase,
  EconomyTransactionIdGenerator,
  FarmMemberRepository,
  FarmRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  ItemDefinitionRepository,
  PayloadFingerprint,
  ShopEntryRepository,
  WalletRepository
} from "./ports";

/** The operation the semantic receipt of a funded purchase carries. */
const AUTO_FUND_AND_PURCHASE_OPERATION = "AUTO_FUND_AND_PURCHASE_INPUT";

export interface FundAndPurchaseCommand {
  readonly requestId: string;
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly assignmentId: string;
  readonly actorId: string;
  readonly eventTime: string;
  readonly expectedAutoVersion: number;
  readonly expectedSimulationAt: string | null;
}

export interface FundingPurchaseDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly actors: ActorRepository;
  readonly jobs: ActorJobRepository;
  readonly cargo: CargoRepository;
  readonly cargoService: CargoService;
  readonly cargoCapacities: { forActorKind(kind: string): number | null };
  readonly inventory: InventoryRepository;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly itemDefinitions: ItemDefinitionRepository;
  readonly shops: ShopEntryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly economyService: EconomyService;
  readonly economyIds: EconomyTransactionIdGenerator;
  readonly settlement: AutoFundingSettlement;
  readonly clock: Clock;
}

/**
 * Buy the assignment's supply with Gold the actor does not have yet.
 *
 * The planner already decided that a whitelist sale can cover the shortfall; this use case re-reads
 * everything authoritatively - the catalogue's sell prices, the Warehouse's quantities, the wallet,
 * the cargo container - and recomputes the plan, so a price or quantity that moved between plan and
 * settlement refuses the whole thing instead of selling the wrong goods. Nothing is written until the
 * complete plan (sale, purchase, cargo, timeline, receipt) is one batch.
 */
export class FundAndPurchaseSupply {
  constructor(private readonly dependencies: FundingPurchaseDependencies) {}

  /**
   * The name `AdvanceAuto` calls.
   *
   * There is no manual equivalent of this action - a player selling their own goods to buy a seed by
   * hand is the ordinary market - so this is the only entry point, and it is server-only.
   */
  async executeAuto(actor: ActorContext | null, farmId: FarmId, command: FundAndPurchaseCommand): Promise<{ readonly purchases: number }> {
    return this.execute(actor, farmId, command);
  }

  async execute(actor: ActorContext | null, farmId: FarmId, command: FundAndPurchaseCommand): Promise<{ readonly purchases: number }> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await this.dependencies.actors.findMainCharacter(farm.ownerPlayerId);
    if (main === null) throw new ApplicationError("CONFLICT_STALE_STATE", "The actor does not exist yet");
    if (main.id !== command.actorId) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "The actor changed since it was read");
    }
    if (main.controlMode !== "AUTO_CONTROLLED") {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Auto is not running");
    }

    let itemDefinitionId: ItemDefinitionId;
    try {
      itemDefinitionId = parseItemDefinitionId(command.itemDefinitionId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Supply item id is invalid");
    }
    const definition = this.dependencies.itemDefinitions.findById(itemDefinitionId);
    if (definition === null || !isSupplyCategory(definition.category)) {
      throw new ApplicationError("SUPPLY_NOT_ALLOWED", "That item cannot be bought as a work supply");
    }
    const entry = this.dependencies.shops
      .list()
      .find((candidate) => candidate.itemDefinitionId === itemDefinitionId && candidate.buyPrice !== null);
    if (entry === undefined || entry.buyPrice === null) {
      throw new ApplicationError("SHOP_ENTRY_NOT_FOUND", "That supply is not for sale here");
    }
    const currency = this.dependencies.currencies.findById(entry.currencyDefinitionId);
    if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
      throw new ApplicationError("INVALID_QUANTITY", "Supply quantity is invalid");
    }
    const quantity = command.quantity;
    const cost = entry.buyPrice * quantity;
    if (!Number.isSafeInteger(cost)) throw new ApplicationError("INVALID_QUANTITY", "Supply cost overflowed");

    const job = await this.dependencies.jobs.findById(command.assignmentId as never);
    if (job === null || job.farmId !== farmId || !job.autoFundingEnabled) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Emergency funding is not enabled for this assignment");
    }
    const fundingItems = await this.dependencies.jobs.listFundingItems(job.id);
    if (fundingItems.length === 0 || fundingItems.length > MAX_AUTO_FUNDING_ITEMS) {
      throw new ApplicationError("INSUFFICIENT_FUNDS", "No funding resources are selected");
    }

    // Re-read everything the plan depended on. A price or a quantity that moved makes this a stale
    // plan, and a stale plan must not liquidate anything.
    const candidates: FundingCandidate[] = [];
    for (const item of fundingItems) {
      const sellEntry = this.dependencies.shops
        .list()
        .find((candidate) => candidate.itemDefinitionId === item.itemDefinitionId && candidate.sellPrice !== null);
      if (sellEntry === undefined || sellEntry.sellPrice === null) {
        throw new ApplicationError("INSUFFICIENT_FUNDS", "A selected resource is not sellable here");
      }
      const held = await this.dependencies.inventory.find(farm.ownerPlayerId, sellEntry.itemDefinitionId);
      candidates.push({
        itemDefinitionId: sellEntry.itemDefinitionId,
        unitPrice: sellEntry.sellPrice,
        available: held?.quantity ?? 0
      });
    }

    const timestamp = this.dependencies.clock.now();
    const wallet =
      (await this.dependencies.wallets.find(farm.ownerPlayerId, currency.id)) ?? {
        playerId: farm.ownerPlayerId,
        currencyDefinitionId: currency.id,
        balance: 0,
        version: 1,
        updatedAt: timestamp
      };
    const shortfall = Math.max(0, cost - wallet.balance);
    if (shortfall === 0) {
      // Gold became sufficient: the ordinary B1 purchase is the right action, not this one.
      throw new ApplicationError("CONFLICT_STALE_STATE", "Gold is sufficient; a plain purchase is due");
    }
    const plan = planFundingSale(shortfall, candidates);
    if (plan === null || plan.sales.length === 0) {
      throw new ApplicationError("INSUFFICIENT_FUNDS", "The selected resources cannot cover the shortfall");
    }

    const cargoRows = await this.dependencies.cargo.listByActor(main.id);
    const carried = cargoRows.find((row) => row.itemDefinitionId === itemDefinitionId) ?? null;
    try {
      assertCargoDeltaFits(main.cargoCapacity, cargoUsed(cargoRows), [quantity]);
    } catch {
      throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
    }

    const transitionId = autoTransitionId({
      actorId: command.actorId,
      assignmentId: command.assignmentId,
      kind: "PURCHASE_INPUT",
      eventTime: command.eventTime
    });
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([main.id, itemDefinitionId, quantity, transitionId])
    );
    const context: AutoSupplySettlementContext = {
      actorId: command.actorId,
      assignmentId: command.assignmentId,
      eventTime: command.eventTime,
      expectedAutoVersion: command.expectedAutoVersion,
      expectedSimulationAt: command.expectedSimulationAt
    };

    const saleLegs: AutoFundingSaleLeg[] = [];
    let runningBalance = wallet.balance;
    let runningVersion = wallet.version;
    for (const sale of plan.sales) {
      const sellEntry = this.dependencies.shops
        .list()
        .find((candidate) => candidate.itemDefinitionId === sale.itemDefinitionId && candidate.sellPrice !== null);
      if (sellEntry === undefined || sellEntry.sellPrice === null || sellEntry.sellPrice !== sale.unitPrice) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "A funding price changed since it was read");
      }
      const held = await this.dependencies.inventory.find(farm.ownerPlayerId, sale.itemDefinitionId as ItemDefinitionId);
      if (held === null || held.quantity < sale.quantity) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "A funding resource changed since it was read");
      }
      const proceeds = sale.quantity * sale.unitPrice;
      saleLegs.push({
        shopEntryId: sellEntry.id,
        itemDefinitionId: held.itemDefinitionId,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        transactionId: this.dependencies.economyIds.newEconomyTransactionId(),
        requestId: `${transitionId}-sell-${String(saleLegs.length + 1)}`,
        expectedInventoryQuantity: held.quantity,
        expectedInventoryVersion: held.version,
        inventoryAfterQuantity: held.quantity - sale.quantity,
        expectedWalletVersion: runningVersion,
        balanceBefore: runningBalance,
        balanceAfter: runningBalance + proceeds
      });
      runningBalance += proceeds;
      runningVersion += 1;
    }
    if (runningBalance < cost) {
      throw new ApplicationError("INSUFFICIENT_FUNDS", "The selected resources cannot cover the shortfall");
    }

    const economy: EconomyMutation = this.dependencies.economyService.prepareMutation(actor, { ...wallet, balance: runningBalance, version: runningVersion }, currency, {
      delta: -cost,
      reason: "SHOP_BUY",
      referenceId: entry.id,
      requestId: transitionId
    });
    const purchase: CargoPurchase = {
      actorId: main.id,
      expectedCargoVersion: main.cargoVersion,
      itemDefinitionId,
      quantity,
      expectedQuantity: carried?.quantity ?? 0,
      expectedVersion: carried?.version ?? 0,
      timestamp
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: AUTO_FUND_AND_PURCHASE_OPERATION,
      requestId: transitionId,
      payloadFingerprint: fingerprint,
      status: "COMPLETED",
      resourceId: main.id,
      responseJson: JSON.stringify({ itemDefinitionId, quantity, cost, proceeds: plan.totalProceeds }),
      createdAt: timestamp
    };
    await this.dependencies.settlement.settleFundedPurchase({
      saleLegs,
      economy,
      purchase,
      idempotency: record,
      context
    });
    return { purchases: quantity };
  }
}

