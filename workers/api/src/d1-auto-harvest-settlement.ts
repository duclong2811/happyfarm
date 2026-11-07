import type { AutoHarvestSettlement, Clock, IdempotencyRecord } from "@happy-farm/application";
import { assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";
import { executeD1AtomicBatch } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository, D1HarvestSettlementRepository } from "./d1-repositories";

/**
 * Production composition boundary for one Auto harvest.
 *
 * Two components, one `db.batch()`: the harvest settlement (the settlement row whose triggers remove
 * the crop and credit the carried stack, the progression seed, the award guard and the award) and the
 * Auto timeline (the state advance, `simulation_at`, and the semantic `AUTO_HARVEST` receipt whose
 * guard observes the harvest's exact post-state). Either both commit or neither does.
 */
export class D1AutoHarvestSettlementService implements AutoHarvestSettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly harvest: D1HarvestSettlementRepository,
    private readonly travel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  async settle(input: Parameters<AutoHarvestSettlement["settle"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({
      eventTime: input.context.eventTime,
      serverNow: now,
      simulationAt: input.context.expectedSimulationAt
    });
    const transitionId = autoTransitionId({ ...input.context, kind: "HARVEST" });
    // The settlement row and its own guarded receipt stay `HARVEST_CROP`, exactly as every harvest
    // writes them; the Auto transition gets its own semantic receipt in the same batch. The crop's
    // settlement table is unique per crop, so a second harvest of one crop can never settle.
    const settlementReceipt: IdempotencyRecord = { ...input.idempotency, operation: "HARVEST_CROP" };
    const cargoAfterQuantity = (input.expectedCargo?.quantity ?? 0) + input.grant.quantity;
    const cargoAfterVersion = (input.expectedCargo?.version ?? 0) + 1;
    await executeD1AtomicBatch(this.db, [
      this.harvest.prepareHarvestIntoCargoAutoSettlement(input.crop, input.grant, input.award, settlementReceipt, {
        transitionId,
        expectedContainerVersion: input.containerVersion
      }),
      this.travel.prepareAutoHarvestGuardAndAdvance({
        actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoHarvestGuardAndAdvance"]>[0]["actorId"],
        actorPlayerId: input.idempotency.actorPlayerId,
        expectedVersion: input.context.expectedAutoVersion,
        expectedSimulationAt: input.context.expectedSimulationAt,
        eventTime: input.context.eventTime,
        updatedAt: now,
        transitionId,
        payloadFingerprint: input.idempotency.payloadFingerprint,
        responseJson: input.idempotency.responseJson,
        cropInstanceId: input.crop.id,
        playerId: input.award.playerId,
        cellX: input.crop.tileX,
        cellY: input.crop.tileY,
        itemDefinitionId: input.grant.itemDefinitionId,
        cargoAfterQuantity,
        cargoAfterVersion,
        progressionAfterXp: input.award.xpAfter,
        progressionAfterVersion: input.award.expectedProgressionVersion + 1
      })
    ]);
  }
}
