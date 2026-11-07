import {
  MAX_CARGO_LOAD_QUANTITY,
  DomainError,
  CARGO_ITEM_CATEGORIES,
  assertCargoDeltaFits,
  assertStorageDeltaFits,
  calculateShopTotal,
  cargoAvailable,
  cargoUsed,
  isCarryableCategory,
  isSupplyCategory,
  parseItemDefinitionId,
  parseShopEntryId,
  type WarehouseTierDefinition,
  type EconomyMutation,
  type FarmId,
  type ItemDefinition,
  type ItemDefinitionId
} from "@happy-farm/domain";
import { autoTransitionId } from "./auto-plant";
import { ApplicationError } from "./errors";
import { mainCharacterFor, requireOwnedFarm, type MainCharacterDependencies } from "./jobs";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  ActorRepository,
  CargoCapacityLookup,
  CargoGrant,
  CargoLoad,
  CargoRepository,
  CargoUnload,
  CargoPurchase,
  Clock,
  CurrencyDefinitionRepository,
  EconomySettlementRepository,
  FarmMemberRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  ItemDefinitionRepository,
  PayloadFingerprint,
  ShopEntryRepository,
  WalletRepository,
  WarehouseRepository
} from "./ports";
import type { EconomyService } from "./economy";

/**
 * Actor cargo: what one actor is physically carrying, and the one authoritative way it reaches the
 * warehouse.
 *
 * ```text
 * resource -> ACTOR CARGO -> travel (later) -> HOME WAREHOUSE
 * ```
 *
 * This is a **separate container** from the warehouse, not a re-reading of it, and this slice does
 * not move any existing stock: every `inventory_items` row that exists today stays warehouse stock.
 * Manual production still settles straight to the warehouse for now - a deliberate, temporary
 * compatibility bridge recorded in `docs/qa/V16_2_2C_ACTOR_CARGO_FOUNDATION.md` - and the slices that
 * execute production are the ones that will land rewards in cargo first.
 */

export const UNLOAD_CARGO_OPERATION = "UNLOAD_CARGO";

export interface CargoStackView {
  readonly itemDefinitionId: string;
  /** The item's name key, resolved server-side so the panel needs no catalogue of its own. */
  readonly displayNameKey: string;
  readonly quantity: number;
  /** The cargo row's version, which the purchase settlement guards on. Not part of the wire DTO. */
  readonly version: number;
}

export interface CargoView {
  readonly capacity: number;
  readonly used: number;
  readonly available: number;
  /** The container's own version: what an unload must present, and what a stale read is told about. */
  readonly version: number;
  readonly items: readonly CargoStackView[];
}

/** The categories cargo may hold. Every shipped item is one of them; the list is explicit on purpose. */
export const CARGO_CATEGORIES = CARGO_ITEM_CATEGORIES;

function requireItem(
  definitions: ItemDefinitionRepository,
  itemDefinitionId: string
): { readonly id: ItemDefinitionId; readonly definition: ItemDefinition } {
  let parsed: ItemDefinitionId;
  try {
    parsed = parseItemDefinitionId(itemDefinitionId);
  } catch {
    throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
  }
  const definition = definitions.findById(parsed);
  if (definition === null) {
    throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
  }
  return { id: parsed, definition };
}

/**
 * The authoritative grant primitive for future production paths.
 *
 * Nothing in this slice wires a reward to it - manual harvest, fishing, mining and forestry still
 * settle to the warehouse - but the rule a later slice needs is here and tested: an item that exists,
 * a category cargo may hold, a positive bounded quantity, and a capacity pre-check whose real
 * authority is the database trigger inside the write.
 */
export class CargoService {
  constructor(
    private readonly definitions: ItemDefinitionRepository,
    private readonly capacities: CargoCapacityLookup,
    private readonly clock: Clock
  ) {}

  /** What this kind of actor can carry, or a refusal when the kind has no capacity defined. */
  capacityFor(kind: string): number {
    const capacity = this.capacities.forActorKind(kind);
    if (capacity === null || !Number.isSafeInteger(capacity) || capacity < 1) {
      throw new ApplicationError("INVALID_CARGO", "This kind of actor cannot carry cargo");
    }
    return capacity;
  }

  /**
   * Validates a reward the game is about to hand an actor, and returns the grant to write.
   *
   * `used` is what the caller read; the check is the same arithmetic the domain and the database use,
   * so a caller that is overtaken by a concurrent grant is refused by the trigger rather than by this.
   */
  prepareGrant(
    actorId: CargoGrant["actorId"],
    capacity: number,
    used: number,
    itemDefinitionId: string,
    quantity: number
  ): CargoGrant {
    const { id, definition } = requireItem(this.definitions, itemDefinitionId);
    if (!isCarryableCategory(definition.category)) {
      // A receipt, a token or a progression marker is not something a person carries.
      throw new ApplicationError("INVALID_CARGO", "That is not something an actor can carry");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ApplicationError("INVALID_CARGO", "A cargo grant must be a positive whole number");
    }
    try {
      assertCargoDeltaFits(capacity, used, [quantity]);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "CARGO_FULL") {
        throw new ApplicationError("CARGO_FULL", error.message);
      }
      if (error instanceof DomainError) throw new ApplicationError("INVALID_CARGO", error.message);
      throw error;
    }
    return { actorId, itemDefinitionId: id, quantity, timestamp: this.clock.now() };
  }
}

export interface CargoDependencies extends MainCharacterDependencies {
  readonly members: FarmMemberRepository;
  readonly cargo: CargoRepository;
  readonly itemDefinitions: ItemDefinitionRepository;
}

export async function cargoView(
  dependencies: CargoDependencies,
  actorId: CargoGrant["actorId"],
  capacity: number,
  version: number
): Promise<CargoView> {
  const items = await dependencies.cargo.listByActor(actorId);
  const used = cargoUsed(items);
  return {
    capacity,
    used,
    available: cargoAvailable(capacity, used),
    version,
    items: items.map((item) => {
      const { definition } = requireItem(dependencies.itemDefinitions, item.itemDefinitionId);
      return {
        itemDefinitionId: item.itemDefinitionId,
        displayNameKey: definition.displayNameKey,
        quantity: item.quantity,
        version: item.version
      };
    })
  };
}

/**
 * The actor's cargo, creating the actor on first ask exactly as the worker panel does.
 *
 * One bounded read of the actor's own rows; no warehouse read, no job read, and nothing on a timer.
 */
export class GetActorCargo {
  constructor(private readonly dependencies: CargoDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<CargoView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId);
    return cargoView(this.dependencies, main.id, main.cargoCapacity, main.cargoVersion);
  }
}

export interface UnloadCargoCommand {
  readonly requestId: string;
  /** The cargo version the caller read: a stale unload is refused rather than applied. */
  readonly expectedVersion: number;
}

export interface UnloadCargoDependencies extends CargoDependencies {
  readonly actors: ActorRepository;
  readonly inventory: InventoryService;
  readonly warehouse: WarehouseRepository;
  /** The tier ladder, so a player with no warehouse row is checked against the starter capacity. */
  readonly tiers: { list(): readonly WarehouseTierDefinition[] };
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  /** Present only when this host can compose the unload with the Auto timeline. */
  readonly autoSettlement?: AutoUnloadSettlement;
}

/**
 * The operation an Auto delivery's semantic receipt carries.
 *
 * Distinct from `UNLOAD_CARGO`, so an Auto transition is addressable by its own identity and a
 * retried step finds its own receipt rather than the manual route's.
 */
const AUTO_UNLOAD_OPERATION = "AUTO_UNLOAD";

/** The Auto timeline facts one Auto delivery must advance with its transfer. */
export interface AutoUnloadSettlementContext {
  readonly actorId: string;
  readonly eventTime: string;
  readonly expectedAutoVersion: number;
  readonly expectedSimulationAt: string | null;
}

/**
 * The one write boundary for an Auto delivery.
 *
 * The same all-or-nothing transfer the manual route performs - composed, in one transaction, with the
 * actor's Auto timeline advance and the semantic receipt. `expectedStacks` is the cargo the caller
 * read, so the settlement can state the exact post-state its receipt must observe.
 */
export interface AutoUnloadSettlement {
  settle(input: {
    readonly unload: CargoUnload;
    readonly idempotency: IdempotencyRecord;
    readonly context: AutoUnloadSettlementContext;
  }): Promise<void>;
}

/**
 * One whitelisted resource the funding settlement sells, with everything the SQL needs to prove it.
 *
 * The application computes the chain (each sale moves the wallet one version and the balance by its
 * own proceeds) so the database's ledger triggers only have to validate it.
 */
export interface AutoFundingSaleLeg {
  readonly shopEntryId: string;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly transactionId: string;
  readonly requestId: string;
  readonly expectedInventoryQuantity: number;
  readonly expectedInventoryVersion: number;
  readonly inventoryAfterQuantity: number;
  readonly expectedWalletVersion: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

/**
 * The one write boundary for an emergency-funded supply purchase.
 *
 * Selling the whitelist and buying the input are one transaction or none: the player can never lose
 * selected resources without receiving the supply the sale was for, and the ledger carries both
 * halves (a `SHOP_SELL` row per resource and the `SHOP_BUY` row) so the movement is explainable.
 */
export interface AutoFundingSettlement {
  settleFundedPurchase(input: {
    readonly saleLegs: readonly AutoFundingSaleLeg[];
    readonly economy: EconomyMutation;
    readonly purchase: CargoPurchase;
    readonly idempotency: IdempotencyRecord;
    readonly context: AutoSupplySettlementContext;
  }): Promise<void>;
}

/**
 * Unloads everything the actor carries into the farm owner's Home Warehouse, or nothing at all.
 *
 * All-or-nothing by construction rather than by care: the cargo rows are deleted and the warehouse
 * rows are written in **one transaction**, and the destination's own capacity guard - the database
 * trigger V16.2 introduced - runs inside it. If the whole transfer does not fit, the trigger refuses
 * and the transaction rolls back, so the cargo is still on the actor and the warehouse is untouched.
 * There is no partial unload, no overflow, no auto-sell and no gold conversion.
 *
 * The receipt is written in the same transaction, so a replayed request finds it and moves nothing a
 * second time, and the same request id with a different payload is a conflict rather than a second
 * unload.
 */
export class UnloadCargo {
  constructor(private readonly dependencies: UnloadCargoDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: UnloadCargoCommand): Promise<CargoView> {
    return this.unload(actor, farmId, command);
  }

  /**
   * Delivers the actor's cargo as one Auto transition.
   *
   * Exactly `execute` plus the Auto timeline context: the same all-or-nothing transfer, the same
   * capacity authority and the same refusal to leave anything behind. What changes is that the
   * transfer, the Auto state advance, `simulation_at` and the semantic receipt commit together, so a
   * delivery can never land while the timeline stays where it was.
   */
  async executeAuto(
    actor: ActorContext | null,
    farmId: FarmId,
    command: UnloadCargoCommand & AutoUnloadSettlementContext
  ): Promise<CargoView> {
    const { actorId, eventTime, expectedAutoVersion, expectedSimulationAt, ...unloadCommand } = command;
    return this.unload(actor, farmId, unloadCommand, { actorId, eventTime, expectedAutoVersion, expectedSimulationAt });
  }

  private async unload(
    actor: ActorContext | null,
    farmId: FarmId,
    command: UnloadCargoCommand,
    autoContext?: AutoUnloadSettlementContext
  ): Promise<CargoView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const farm = await this.dependencies.farms.findById(farmId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const main = await mainCharacterFor(this.dependencies, farmId);

    // The fingerprint is the intent, not the outcome: the same request id with a different expected
    // version is a different request, and a replay of this one must find the receipt it wrote.
    const operation = autoContext === undefined ? UNLOAD_CARGO_OPERATION : AUTO_UNLOAD_OPERATION;
    const settlementRequestId =
      autoContext === undefined ? command.requestId : autoTransitionId({ ...autoContext, assignmentId: null, kind: "UNLOAD" });
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([main.id, operation, command.expectedVersion])
    );
    const existing = await this.dependencies.idempotency.find(
      actor.playerId,
      operation,
      settlementRequestId
    );
    if (existing !== null) {
      if (existing.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
      }
      try {
        return JSON.parse(existing.responseJson) as CargoView;
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
      }
    }

    const items = await this.dependencies.cargo.listByActor(main.id);
    const stacks = items.map((item) => ({ itemDefinitionId: item.itemDefinitionId, quantity: item.quantity }));
    // The version is checked *before* the empty shortcut, so a caller whose read has been overtaken is
    // told the container moved rather than being handed a cheerful "nothing to carry" for a state they
    // never saw. A replay never reaches here - it returns the receipt it wrote.
    if (command.expectedVersion !== main.cargoVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
    }
    if (stacks.length === 0) {
      // Nothing to carry. Re-read the container first: a concurrent unload can empty it between this
      // call's own reads, and answering "200, nothing to do" for a version the caller no longer holds
      // would be a comfortable lie. An unchanged version makes it an honest no-op with no receipt.
      const latest = await mainCharacterFor(this.dependencies, farmId);
      if (latest.cargoVersion !== command.expectedVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
      }
      return cargoView(this.dependencies, main.id, main.cargoCapacity, main.cargoVersion);
    }
    const total = cargoUsed(items);

    // The destination's pre-check, so a full warehouse is refused with a clean error before any write.
    // It is *not* the authority: the trigger inside the transaction is, because a racing grant can
    // fill the warehouse between this read and the write.
    const warehouse = await this.dependencies.warehouse.find(farm.ownerPlayerId);
    // A player with no row is held to the starter tier, which is exactly what the capacity trigger
    // applies to them - the pre-check and the guard must agree about where the ceiling is.
    const capacity = warehouse?.capacity ?? this.dependencies.tiers.list()[0]?.capacity ?? 0;
    const used = warehouse?.used ?? 0;
    try {
      assertStorageDeltaFits(capacity, used, [total]);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "WAREHOUSE_FULL") {
        throw new ApplicationError("WAREHOUSE_FULL", "The warehouse does not have space for everything carried");
      }
      throw error;
    }

    const additions = stacks.map((stack) =>
      this.dependencies.inventory.prepareAddition(farm.ownerPlayerId, stack.itemDefinitionId, stack.quantity)
    );
    const timestamp = this.dependencies.clock.now();
    const unload: CargoUnload = {
      actorId: main.id,
      expectedCargoVersion: command.expectedVersion,
      stacks,
      additions,
      timestamp
    };
    const settled: CargoView = {
      capacity: main.cargoCapacity,
      used: 0,
      available: main.cargoCapacity,
      version: command.expectedVersion + 1,
      items: []
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation,
      requestId: settlementRequestId,
      payloadFingerprint: fingerprint,
      // The receipt cites the actor whose container moved, which is the thing it describes.
      resourceId: main.id,
      responseJson: JSON.stringify(settled),
      status: "COMPLETED",
      createdAt: timestamp
    };
    if (autoContext !== undefined && this.dependencies.autoSettlement !== undefined) {
      await this.dependencies.autoSettlement.settle({
        unload,
        idempotency: record,
        context: autoContext
      });
      return settled;
    }
    const applied = await this.dependencies.cargo.unloadAllAtomically(unload, record);
    if (!applied) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
    }
    return settled;
  }
}

export interface LoadCargoCommand {
  readonly requestId: string;
  readonly itemDefinitionId: string;
  readonly quantity: number;
  /** The cargo version the caller read: a stale load is refused rather than applied. */
  readonly expectedVersion: number;
}

export interface LoadCargoDependencies extends CargoDependencies {
  readonly inventory: InventoryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly autoSettlement?: AutoSupplySettlement;
}

export interface AutoSupplySettlementContext {
  readonly actorId: string;
  readonly assignmentId: string;
  readonly eventTime: string;
  readonly expectedAutoVersion: number;
  readonly expectedSimulationAt: string | null;
}

export interface AutoSupplySettlement {
  settleLoad(input: {
    readonly load: CargoLoad;
    readonly expectedCargo: { readonly quantity: number; readonly version: number } | null;
    readonly idempotency: IdempotencyRecord;
    readonly context: AutoSupplySettlementContext;
  }): Promise<void>;
  settlePurchase(input: {
    readonly economy: EconomyMutation;
    readonly purchase: CargoPurchase;
    readonly idempotency: IdempotencyRecord;
    readonly context: AutoSupplySettlementContext;
  }): Promise<void>;
}

/**
 * Moves one stack out of the Home Warehouse and into the actor's cargo.
 *
 * The mirror of the unload, with the same properties and the same guard shape: one transaction, a
 * cargo-version guard that writes this request's marker, a subtraction scoped to the warehouse row the
 * caller actually read, and a receipt in the same batch. If anything does not fit or the warehouse has
 * moved on, nothing changes - no partial load, no clamp, and the warehouse can never go negative.
 */
export class LoadCargo {
  constructor(private readonly dependencies: LoadCargoDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: LoadCargoCommand): Promise<CargoView> {
    return this.load(actor, farmId, command);
  }

  async executeAuto(
    actor: ActorContext | null,
    farmId: FarmId,
    command: LoadCargoCommand & AutoSupplySettlementContext
  ): Promise<CargoView> {
    const { actorId, assignmentId, eventTime, expectedAutoVersion, expectedSimulationAt, ...loadCommand } = command;
    return this.load(actor, farmId, loadCommand, { actorId, assignmentId, eventTime, expectedAutoVersion, expectedSimulationAt });
  }

  private async load(actor: ActorContext | null, farmId: FarmId, command: LoadCargoCommand, autoContext?: AutoSupplySettlementContext): Promise<CargoView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const farm = await this.dependencies.farms.findById(farmId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const main = await mainCharacterFor(this.dependencies, farmId);

    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([main.id, "LOAD_CARGO", command.itemDefinitionId, command.quantity, command.expectedVersion])
    );
    const operation = autoContext === undefined ? "LOAD_CARGO" : "AUTO_LOAD_INPUT";
    const requestId = autoContext === undefined ? command.requestId : autoTransitionId({ ...autoContext, kind: "LOAD_INPUT" });
    const existing = await this.dependencies.idempotency.find(actor.playerId, operation, requestId);
    if (existing !== null) {
      if (existing.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
      }
      try {
        return JSON.parse(existing.responseJson) as CargoView;
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
      }
    }

    if (command.expectedVersion !== main.cargoVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
    }
    const { id: itemDefinitionId, definition } = requireItem(this.dependencies.itemDefinitions, command.itemDefinitionId);
    if (!isCarryableCategory(definition.category)) {
      throw new ApplicationError("INVALID_CARGO", "That is not something an actor can carry");
    }
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0 || command.quantity > MAX_CARGO_LOAD_QUANTITY) {
      throw new ApplicationError("INVALID_CARGO", "A load must be a positive whole number within the bound");
    }
    const stored = await this.dependencies.inventory.find(farm.ownerPlayerId, itemDefinitionId);
    if (stored === null || stored.quantity < command.quantity) {
      throw new ApplicationError("INSUFFICIENT_ITEMS", "The Warehouse does not hold that many");
    }
    const before = await cargoView(this.dependencies, main.id, main.cargoCapacity, main.cargoVersion);
    try {
      assertCargoDeltaFits(main.cargoCapacity, before.used, [command.quantity]);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "CARGO_FULL") {
        throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
      }
      if (error instanceof DomainError) throw new ApplicationError("INVALID_CARGO", error.message);
      throw error;
    }
    // The settled view, computed from what the actor carried and stored in the receipt, so a replay
    // returns the same picture without touching either container again.
    const afterItems = before.items.some((item) => item.itemDefinitionId === itemDefinitionId)
      ? before.items.map((item) =>
          item.itemDefinitionId === itemDefinitionId
            ? { ...item, quantity: item.quantity + command.quantity }
            : item
        )
      : [
          ...before.items,
          {
            itemDefinitionId: itemDefinitionId as string,
            displayNameKey: definition.displayNameKey,
            quantity: command.quantity,
            version: 1
          }
        ].sort((left, right) => (left.itemDefinitionId < right.itemDefinitionId ? -1 : 1));
    const settled: CargoView = {
      capacity: main.cargoCapacity,
      used: before.used + command.quantity,
      available: cargoAvailable(main.cargoCapacity, before.used + command.quantity),
      version: command.expectedVersion + 1,
      items: afterItems
    };

    const timestamp = this.dependencies.clock.now();
    const load = {
      actorId: main.id,
      playerId: farm.ownerPlayerId,
      expectedCargoVersion: command.expectedVersion,
      itemDefinitionId,
      quantity: command.quantity,
      expectedInventoryQuantity: stored.quantity,
      expectedInventoryVersion: stored.version,
      timestamp
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation,
      requestId,
      payloadFingerprint: fingerprint,
      resourceId: main.id,
      responseJson: JSON.stringify(settled),
      status: "COMPLETED",
      createdAt: timestamp
    };
    if (autoContext !== undefined) {
      if (this.dependencies.autoSettlement === undefined) throw new ApplicationError("INTERNAL_ERROR", "Atomic Auto supply is not configured");
      await this.dependencies.autoSettlement.settleLoad({
        load,
        expectedCargo: before.items.find((item) => item.itemDefinitionId === itemDefinitionId) ?? null,
        idempotency: record,
        context: autoContext
      });
      return settled;
    }
    const applied = await this.dependencies.cargo.loadAllAtomically(load, record);
    if (!applied) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
    }
    return settled;
  }
}

export interface SupplyPurchaseCommand {
  readonly requestId: string;
  readonly shopEntryId: string;
  readonly quantity: number;
  /** The cargo version the caller read: a stale purchase is refused rather than applied. */
  readonly expectedVersion: number;
}

export interface SupplyPurchaseResult {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly currencyId: string;
  readonly amountSpent: number;
  readonly newBalance: number;
  readonly cargo: CargoView;
}

export interface SupplyPurchaseDependencies extends CargoDependencies {
  readonly shops: ShopEntryRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly wallets: WalletRepository;
  readonly economyService: EconomyService;
  readonly settlement: EconomySettlementRepository;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly autoSettlement?: AutoSupplySettlement;
}

/**
 * Buys a supply and takes it in hand, instead of storing it.
 *
 * The economy half is the ordinary shop purchase: the server's own catalogue price, the centralized
 * economy service (wallet + ledger, `SHOP_BUY`, `SHOP_ENTRY`), the same receipt, the same item
 * validation. The one difference is the destination - the actor's cargo - which is why this is a
 * narrow command (one entry, one positive bounded quantity, one owned actor) rather than a generic
 * "buy anything into anywhere".
 *
 * All-or-nothing: if cargo cannot take the whole quantity, the purchase is refused before gold moves,
 * so a player is never charged for goods that did not fit. It buys **only** supply categories, so a
 * crop or a machine part can never ride this path into a container.
 */
export class PurchaseSupplyIntoCargo {
  constructor(private readonly dependencies: SupplyPurchaseDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: SupplyPurchaseCommand
  ): Promise<SupplyPurchaseResult> {
    return this.purchase(actor, farmId, command);
  }

  async executeAuto(
    actor: ActorContext | null,
    farmId: FarmId,
    command: SupplyPurchaseCommand & AutoSupplySettlementContext
  ): Promise<SupplyPurchaseResult> {
    const { actorId, assignmentId, eventTime, expectedAutoVersion, expectedSimulationAt, ...purchaseCommand } = command;
    return this.purchase(actor, farmId, purchaseCommand, { actorId, assignmentId, eventTime, expectedAutoVersion, expectedSimulationAt });
  }

  private async purchase(
    actor: ActorContext | null,
    farmId: FarmId,
    command: SupplyPurchaseCommand,
    autoContext?: AutoSupplySettlementContext
  ): Promise<SupplyPurchaseResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId);

    let shopEntryId;
    try {
      shopEntryId = parseShopEntryId(command.shopEntryId);
    } catch {
      throw new ApplicationError("SHOP_ENTRY_NOT_FOUND", "Shop entry was not found");
    }
    const entry = this.dependencies.shops.findById(shopEntryId);
    if (entry === null) throw new ApplicationError("SHOP_ENTRY_NOT_FOUND", "Shop entry was not found");
    // Buying is the only direction this path trades in; a sell row has no buy price and is refused
    // before a price is read, so a null can never become a free purchase.
    if (entry.buyPrice === null) {
      throw new ApplicationError("SHOP_ENTRY_NOT_ALLOWED", "This shop entry does not trade in that direction");
    }
    const { id: itemDefinitionId, definition } = requireItem(this.dependencies.itemDefinitions, entry.itemDefinitionId);
    if (!isSupplyCategory(definition.category)) {
      throw new ApplicationError("SUPPLY_NOT_ALLOWED", "That item is not a supply this can buy for an actor");
    }
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0 || command.quantity > MAX_CARGO_LOAD_QUANTITY) {
      throw new ApplicationError("INVALID_CARGO", "A supply purchase must be a positive whole number within the bound");
    }
    let total: number;
    try {
      total = calculateShopTotal(entry, command.quantity, "BUY");
    } catch {
      throw new ApplicationError("INVALID_QUANTITY", "Transaction quantity is invalid");
    }
    if (this.dependencies.currencies.findById(entry.currencyDefinitionId) === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([entry.id, command.quantity, main.id, command.expectedVersion])
    );
    const operation = autoContext === undefined ? "SUPPLY_PURCHASE" : "AUTO_PURCHASE_INPUT";
    const requestId = autoContext === undefined ? command.requestId : autoTransitionId({ ...autoContext, kind: "PURCHASE_INPUT" });
    const existing = await this.dependencies.idempotency.find(actor.playerId, operation, requestId);
    if (existing !== null) {
      if (existing.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
      }
      try {
        return JSON.parse(existing.responseJson) as SupplyPurchaseResult;
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
      }
    }
    // The version check comes *after* the receipt: a replay arrives holding the version it read, and
    // the successful purchase has already moved that version on - returning the receipt it wrote is
    // the whole point of it, so the stale-version refusal is for a genuinely new request.
    if (command.expectedVersion !== main.cargoVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
    }

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const before = await cargoView(this.dependencies, main.id, main.cargoCapacity, main.cargoVersion);
      try {
        assertCargoDeltaFits(main.cargoCapacity, before.used, [command.quantity]);
      } catch (error: unknown) {
        if (error instanceof DomainError && error.code === "CARGO_FULL") {
          throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
        }
        if (error instanceof DomainError) throw new ApplicationError("INVALID_CARGO", error.message);
        throw error;
      }
      const carried = before.items.find((item) => item.itemDefinitionId === itemDefinitionId);
      const wallet = (await this.dependencies.wallets.find(actor.playerId, entry.currencyDefinitionId)) ?? {
        playerId: actor.playerId,
        currencyDefinitionId: entry.currencyDefinitionId,
        balance: 0,
        version: 1,
        updatedAt: this.dependencies.clock.now()
      };
      const currency = this.dependencies.currencies.findById(entry.currencyDefinitionId);
      if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
      let economy;
      try {
        economy = this.dependencies.economyService.prepareMutation(actor, wallet, currency, {
          delta: -total,
          reason: "SHOP_BUY",
          referenceId: entry.id,
          requestId
        });
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const afterItems = carried === undefined
        ? [...before.items, { itemDefinitionId: itemDefinitionId as string, displayNameKey: definition.displayNameKey, quantity: command.quantity, version: 1 }]
        : before.items.map((item) =>
            item.itemDefinitionId === itemDefinitionId ? { ...item, quantity: item.quantity + command.quantity } : item
          );
      const afterCargo: CargoView = {
        capacity: main.cargoCapacity,
        used: before.used + command.quantity,
        available: cargoAvailable(main.cargoCapacity, before.used + command.quantity),
        version: command.expectedVersion + 1,
        items: [...afterItems].sort((left, right) => (left.itemDefinitionId < right.itemDefinitionId ? -1 : 1))
      };
      const result: SupplyPurchaseResult = {
        itemDefinitionId: entry.itemDefinitionId,
        quantity: command.quantity,
        currencyId: entry.currencyDefinitionId,
        amountSpent: total,
        newBalance: economy.balanceAfter,
        cargo: afterCargo
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation,
        requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: this.dependencies.clock.now()
      };
      const purchase: CargoPurchase = {
        actorId: main.id,
        expectedCargoVersion: command.expectedVersion,
        itemDefinitionId,
        quantity: command.quantity,
        expectedQuantity: carried?.quantity ?? 0,
        expectedVersion: carried?.version ?? 0,
        timestamp: this.dependencies.clock.now()
      };
      try {
        if (autoContext !== undefined) {
          if (this.dependencies.autoSettlement === undefined) throw new ApplicationError("INTERNAL_ERROR", "Atomic Auto supply is not configured");
          await this.dependencies.autoSettlement.settlePurchase({ economy, purchase, idempotency: record, context: autoContext });
        } else {
          await this.dependencies.settlement.settleSupplyIntoCargoAtomically(economy, purchase, record);
        }
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, operation, requestId);
        if (raced !== null) {
          if (raced.payloadFingerprint !== fingerprint) {
            throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
          }
          try {
            return JSON.parse(raced.responseJson) as SupplyPurchaseResult;
          } catch {
            throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
          }
        }
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
  }
}
