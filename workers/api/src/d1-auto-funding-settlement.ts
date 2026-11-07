import type { AutoFundingSettlement, Clock, IdempotencyRecord } from "@happy-farm/application";
import { assertTrustedAutoEventTime } from "@happy-farm/application";
import { executeD1AtomicBatch } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository, D1EconomySettlementRepository } from "./d1-repositories";

/**
 * Production composition boundary for one emergency-funded supply purchase.
 *
 * Two components, one `db.batch()`: the economic half (each whitelist sale's inventory subtraction and
 * `SHOP_SELL` ledger row, then the `SHOP_BUY` row and the cargo grant under this actor's claim) and the
 * Auto timeline half (state advance, `simulation_at`, and the `AUTO_FUND_AND_PURCHASE_INPUT` receipt
 * whose guard observes every post-state). The player can never lose a selected resource without
 * receiving the supply the sale paid for.
 */
export class D1AutoFundingSettlementService implements AutoFundingSettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly economy: D1EconomySettlementRepository,
    private readonly travel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  async settleFundedPurchase(input: Parameters<AutoFundingSettlement["settleFundedPurchase"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({
      eventTime: input.context.eventTime,
      serverNow: now,
      simulationAt: input.context.expectedSimulationAt
    });
    const cargoAfterQuantity = input.purchase.expectedQuantity + input.purchase.quantity;
    const cargoAfterVersion = input.purchase.expectedVersion + 1;
    const saleStateChecks: string[] = [];
    const saleStateArgs: unknown[] = [];
    for (const leg of input.saleLegs) {
      saleStateChecks.push("EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)");
      saleStateArgs.push(input.economy.playerId, leg.itemDefinitionId, leg.inventoryAfterQuantity, leg.expectedInventoryVersion + 1);
      saleStateChecks.push("EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?)");
      saleStateArgs.push(leg.transactionId, input.economy.playerId);
    }
    const receipt: IdempotencyRecord = input.idempotency;
    await executeD1AtomicBatch(this.db, [
      this.economy.prepareAutoFundingPurchase(input.saleLegs, input.economy, input.purchase, receipt.requestId),
      this.travel.prepareAutoFundingGuardAndAdvance({
        actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoFundingGuardAndAdvance"]>[0]["actorId"],
        actorPlayerId: receipt.actorPlayerId,
        expectedVersion: input.context.expectedAutoVersion,
        expectedSimulationAt: input.context.expectedSimulationAt,
        eventTime: input.context.eventTime,
        updatedAt: now,
        transitionId: receipt.requestId,
        payloadFingerprint: receipt.payloadFingerprint,
        responseJson: receipt.responseJson,
        playerId: input.economy.playerId,
        currencyDefinitionId: input.economy.currencyDefinitionId,
        walletAfterBalance: input.economy.balanceAfter,
        walletAfterVersion: input.economy.expectedWalletVersion + 1,
        transactionId: input.economy.transactionId,
        itemDefinitionId: input.purchase.itemDefinitionId,
        cargoAfterQuantity,
        cargoAfterVersion,
        saleStateChecks,
        saleStateArgs
      })
    ]);
  }
}
