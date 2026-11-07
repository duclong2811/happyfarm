import {
  DomainError,
  nextWarehouseTier,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  warehouseAvailable,
  warehouseIdFromUuid,
  type InventoryItem,
  type WarehouseState,
  type WarehouseTierDefinition
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  WalletRepository,
  WarehouseRepository,
  WarehouseTierRepository,
  WarehouseUpgrade
} from "./ports";

const UPGRADE_OPERATION = "WAREHOUSE_UPGRADE";

export interface WarehouseUpgradeView {
  readonly currencyId: string;
  readonly gold: number;
  readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

export interface WarehouseStatusView {
  readonly tier: number;
  /** The tier's display name key, straight from the catalogue the status was read against. */
  readonly tierDisplayNameKey: string;
  readonly capacity: number;
  readonly used: number;
  readonly available: number;
  /** True for a grandfathered player holding more than the current capacity. */
  readonly overCapacity: boolean;
  readonly nextTier: number | null;
  /** The capacity the next tier would hold, or null at the top of the ladder. */
  readonly nextCapacity: number | null;
  readonly nextUpgrade: WarehouseUpgradeView | null;
}

/** The warehouse's stable id: derived from the owner, so a replay cites the same row. */
export function warehouseIdForPlayer(playerId: string): string {
  return warehouseIdFromUuid(playerId.slice("player_".length));
}

function statusView(warehouse: WarehouseState, tiers: readonly WarehouseTierDefinition[]): WarehouseStatusView {
  const current = tiers.find((entry) => entry.tier === warehouse.tier) ?? null;
  const next = nextWarehouseTier(tiers, warehouse.tier);
  // The cost of the next step is stored on the tier being left, not the tier being reached.
  const upgrade = current?.upgrade ?? null;
  return {
    tier: warehouse.tier,
    // The catalogue is the only place a tier's name lives; a tier the catalogue no longer ships
    // falls back to its index so the panel can still say what it is holding.
    tierDisplayNameKey: current?.displayNameKey ?? `warehouse.tier.${String(warehouse.tier)}.name`,
    capacity: warehouse.capacity,
    used: warehouse.used,
    available: warehouseAvailable(warehouse),
    overCapacity: warehouse.used > warehouse.capacity,
    nextTier: next?.tier ?? null,
    nextCapacity: next?.capacity ?? null,
    nextUpgrade:
      upgrade === null
        ? null
        : {
            currencyId: upgrade.currencyDefinitionId,
            gold: upgrade.gold,
            materials: Object.entries(upgrade.materials).map(([itemDefinitionId, quantity]) => ({
              itemDefinitionId,
              quantity
            }))
          }
  };
}

/**
 * The warehouse's current state, with used capacity read from the inventory.
 *
 * One bounded read of the capacity row and one aggregate over the player's own inventory rows - no
 * polling, no per-item round trip. A player with no row is shown the starter tier and the capacity the
 * database guard would apply.
 */
export class GetWarehouseStatus {
  constructor(
    private readonly warehouse: WarehouseRepository,
    private readonly tiers: WarehouseTierRepository
  ) {}

  async execute(actor: ActorContext | null): Promise<WarehouseStatusView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const tiers = this.tiers.list();
    const starter = tiers[0];
    const stored = await this.warehouse.find(actor.playerId);
    const used = await this.warehouse.usedCapacity(actor.playerId);
    const state: WarehouseState = stored ?? { tier: 0, capacity: starter?.capacity ?? 0, used, version: 0 };
    return statusView({ ...state, used }, tiers);
  }
}

export interface UpgradeWarehouseCommand {
  readonly requestId: string;
}

/**
 * Buys the next warehouse tier: one step only, never a tier the client names.
 *
 * The gold debit goes through the centralized economy service and its ledger; the materials are
 * consumed through the centralized inventory service. The repository writes all of it - the ledger
 * row, the removed materials, the new tier and the receipt - in one transaction, so an upgrade can
 * never take gold without raising the cap, or raise the cap without being paid for.
 */
export class UpgradeWarehouse {
  constructor(
    private readonly warehouse: WarehouseRepository,
    private readonly tiers: WarehouseTierRepository,
    private readonly wallets: WalletRepository,
    private readonly currencies: CurrencyDefinitionRepository,
    private readonly inventory: InventoryRepository,
    private readonly economyService: EconomyService,
    private readonly inventoryService: InventoryService,
    private readonly idempotency: IdempotencyRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: UpgradeWarehouseCommand): Promise<WarehouseStatusView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const tiers = this.tiers.list();
    const stored = await this.warehouse.find(actor.playerId);
    const current: WarehouseState = stored ?? { tier: 0, capacity: tiers[0]?.capacity ?? 0, used: 0, version: 0 };
    const currentDefinition = tiers.find((entry) => entry.tier === current.tier) ?? null;
    const next = nextWarehouseTier(tiers, current.tier);
    const cost = currentDefinition?.upgrade ?? null;
    if (next === null || cost === null) {
      throw new ApplicationError("WAREHOUSE_MAX_TIER", "The warehouse is already at its highest tier");
    }
    const warehouseId = warehouseIdForPlayer(actor.playerId);
    // The fingerprint is the request, not the target tier: a replay arrives after the tier has
    // already advanced, so including the tier would make its own receipt unreadable.
    const fingerprint = await this.fingerprints.hash(JSON.stringify([warehouseId, UPGRADE_OPERATION]));
    const existing = await this.idempotency.find(actor.playerId, UPGRADE_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const currencyId = parseCurrencyDefinitionId(cost.currencyDefinitionId);
    const currency = this.currencies.findById(currencyId);
    if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");

    const materials = Object.entries(cost.materials);
    const expectedInventory: InventoryItem[] = [];
    for (const [itemDefinitionId, quantity] of materials) {
      const row = await this.inventory.find(actor.playerId, parseItemDefinitionId(itemDefinitionId));
      if (row === null || row.quantity < quantity) {
        throw new ApplicationError("INSUFFICIENT_ITEMS", "The upgrade requires materials the island does not have");
      }
      expectedInventory.push(row);
    }
    // The upgrade only removes materials, so the usage after it is deterministic; the response the
    // receipt stores must agree with what a replay later returns.
    const usedBefore = await this.warehouse.usedCapacity(actor.playerId);
    const usedAfter = usedBefore - materials.reduce((sum, [, quantity]) => sum + quantity, 0);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const wallet = (await this.wallets.find(actor.playerId, currency.id)) ?? {
        playerId: actor.playerId,
        currencyDefinitionId: currency.id,
        balance: 0,
        version: 1,
        updatedAt: this.clock.now()
      };
      let economy;
      try {
        economy = this.economyService.prepareMutation(actor, wallet, currency, {
          delta: -cost.gold,
          reason: "WAREHOUSE_UPGRADE",
          // The reference is parsed by the domain into the WAREHOUSE kind; a wrong pairing is refused.
          referenceId: warehouseIdFromUuid(actor.playerId.slice("player_".length)),
          requestId: command.requestId
        });
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const removals = materials.map(([itemDefinitionId, quantity]) =>
        this.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)
      );
      const upgrade: WarehouseUpgrade = {
        playerId: actor.playerId,
        warehouseId,
        expectedFromTier: current.tier,
        expectedVersion: current.version,
        toTier: next.tier,
        capacity: next.capacity,
        economy,
        removals,
        expectedInventory,
        createdAt: economy.createdAt
      };
      const applied: WarehouseState = { tier: next.tier, capacity: next.capacity, used: usedAfter, version: current.version + 1 };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: UPGRADE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(statusView(applied, tiers)),
        status: "COMPLETED",
        createdAt: economy.createdAt
      };
      try {
        await this.warehouse.upgradeAtomically(upgrade, record);
        return statusView(applied, tiers);
      } catch (error: unknown) {
        const raced = await this.idempotency.find(actor.playerId, UPGRADE_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
        // The step is chosen once, from the tier the caller read. If the island has moved on - another
        // upgrade raised it - this request's decision is stale. Retrying the same step would either
        // charge for a tier that is already paid for or, worse, be approved by the sibling's write;
        // the honest answer is that the world changed, and the player can look again.
        const latest = await this.warehouse.find(actor.playerId);
        if (latest !== null && latest.tier !== current.tier) {
          throw new ApplicationError("CONFLICT_STALE_STATE", "The warehouse changed while upgrading");
        }
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Warehouse upgrade changed concurrently");
  }

  private replay(record: IdempotencyRecord, fingerprint: string): WarehouseStatusView {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      return JSON.parse(record.responseJson) as WarehouseStatusView;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}
