import type { AutoSupplySettlement, Clock } from "@happy-farm/application";
import { assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";
import { executeD1AtomicBatch } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository, D1CargoRepository, D1EconomySettlementRepository } from "./d1-repositories";

/** Production composition boundary for Auto Warehouse LOAD and Shop PURCHASE. */
export class D1AutoSupplySettlementService implements AutoSupplySettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly cargo: D1CargoRepository,
    private readonly economy: D1EconomySettlementRepository,
    private readonly travel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  async settleLoad(input: Parameters<AutoSupplySettlement["settleLoad"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({ eventTime: input.context.eventTime, serverNow: now, simulationAt: input.context.expectedSimulationAt });
    const transitionId = autoTransitionId({ ...input.context, kind: "LOAD_INPUT" });
    const cargoBefore = input.expectedCargo?.quantity ?? 0;
    const cargoVersion = (input.expectedCargo?.version ?? 0) + 1;
    await executeD1AtomicBatch(this.db, [
      this.cargo.prepareAutoLoad(input.load, transitionId),
      this.travel.prepareAutoLoadGuardAndAdvance({
        actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoLoadGuardAndAdvance"]>[0]["actorId"],
        actorPlayerId: input.idempotency.actorPlayerId,
        expectedVersion: input.context.expectedAutoVersion,
        expectedSimulationAt: input.context.expectedSimulationAt,
        eventTime: input.context.eventTime,
        updatedAt: now,
        transitionId,
        payloadFingerprint: input.idempotency.payloadFingerprint,
        responseJson: input.idempotency.responseJson,
        playerId: input.load.playerId,
        itemDefinitionId: input.load.itemDefinitionId,
        inventoryAfterQuantity: input.load.expectedInventoryQuantity - input.load.quantity,
        inventoryAfterVersion: input.load.expectedInventoryVersion + 1,
        cargoAfterQuantity: cargoBefore + input.load.quantity,
        cargoAfterVersion: cargoVersion
      })
    ]);
  }

  async settlePurchase(input: Parameters<AutoSupplySettlement["settlePurchase"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({ eventTime: input.context.eventTime, serverNow: now, simulationAt: input.context.expectedSimulationAt });
    const transitionId = autoTransitionId({ ...input.context, kind: "PURCHASE_INPUT" });
    await executeD1AtomicBatch(this.db, [
      this.economy.prepareAutoSupplyPurchase(input.economy, input.purchase, transitionId),
      this.travel.prepareAutoPurchaseGuardAndAdvance({
        actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoPurchaseGuardAndAdvance"]>[0]["actorId"],
        actorPlayerId: input.idempotency.actorPlayerId,
        expectedVersion: input.context.expectedAutoVersion,
        expectedSimulationAt: input.context.expectedSimulationAt,
        eventTime: input.context.eventTime,
        updatedAt: now,
        transitionId,
        payloadFingerprint: input.idempotency.payloadFingerprint,
        responseJson: input.idempotency.responseJson,
        currencyDefinitionId: input.economy.currencyDefinitionId,
        walletAfterBalance: input.economy.balanceAfter,
        walletAfterVersion: input.economy.expectedWalletVersion + 1,
        transactionId: input.economy.transactionId,
        itemDefinitionId: input.purchase.itemDefinitionId,
        cargoAfterQuantity: input.purchase.expectedQuantity + input.purchase.quantity,
        cargoAfterVersion: input.purchase.expectedVersion + 1
      })
    ]);
  }
}
