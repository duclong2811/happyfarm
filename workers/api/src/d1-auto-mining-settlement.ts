import type { AutoMiningSettlement, Clock } from "@happy-farm/application";
import { assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";
import { executeD1AtomicBatch } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository } from "./d1-repositories";

/** One atomic continuous Mining beat: cargo grant + authoritative Auto timeline + replay receipt. */
export class D1AutoMiningSettlementService implements AutoMiningSettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly travel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  async settle(input: Parameters<AutoMiningSettlement["settle"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({
      eventTime: input.context.eventTime,
      serverNow: now,
      simulationAt: input.context.expectedSimulationAt
    });
    const transitionId = autoTransitionId({ ...input.context, kind: "MINE" });
    const cargoAfterQuantity = (input.expectedCargo?.quantity ?? 0) + input.grant.quantity;
    const cargoAfterVersion = (input.expectedCargo?.version ?? 0) + 1;
    const prepared = this.travel.prepareAutoMineGuardAndAdvance({
      actorId: input.actorId as Parameters<D1AutoTravelRepository["prepareAutoMineGuardAndAdvance"]>[0]["actorId"],
      actorPlayerId: input.playerId,
      expectedVersion: input.context.expectedAutoVersion,
      expectedSimulationAt: input.context.expectedSimulationAt,
      eventTime: input.context.eventTime,
      updatedAt: now,
      transitionId,
      payloadFingerprint: input.idempotency.payloadFingerprint,
      responseJson: input.idempotency.responseJson,
      nodeId: input.nodeId,
      nodeX: input.nodeX,
      nodeY: input.nodeY,
      itemDefinitionId: input.itemDefinitionId,
      expectedCargoVersion: input.containerVersion,
      grantQuantity: input.grant.quantity,
      cargoAfterQuantity,
      cargoAfterVersion
    });
    await executeD1AtomicBatch(this.db, [prepared]);
  }
}
