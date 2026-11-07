import type { AutoUnloadSettlement, Clock } from "@happy-farm/application";
import { ApplicationError, assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";
import { executeD1AtomicBatch } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository, D1CargoRepository } from "./d1-repositories";

/**
 * Production composition boundary for one Auto delivery.
 *
 * Two components, one `db.batch()`: the all-or-nothing cargo-to-warehouse transfer (container marker,
 * the cargo deletions, the warehouse additions under its own capacity trigger) and the Auto timeline
 * (the state advance, `simulation_at`, and the semantic `AUTO_UNLOAD` receipt whose guard observes the
 * transfer's exact post-state). A full warehouse still refuses inside the transaction, and because the
 * receipt is in the same batch the cargo stays on the actor.
 */
export class D1AutoUnloadSettlementService implements AutoUnloadSettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly cargo: D1CargoRepository,
    private readonly travel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  async settle(input: Parameters<AutoUnloadSettlement["settle"]>[0]): Promise<void> {
    const now = this.clock.now();
    assertTrustedAutoEventTime({
      eventTime: input.context.eventTime,
      serverNow: now,
      simulationAt: input.context.expectedSimulationAt
    });
    const transitionId = autoTransitionId({
      actorId: input.context.actorId,
      assignmentId: null,
      kind: "UNLOAD",
      eventTime: input.context.eventTime
    });
    try {
      await executeD1AtomicBatch(this.db, [
        this.cargo.prepareUnloadSettlement(input.unload, input.idempotency, { deferReceipt: true }),
        this.travel.prepareAutoUnloadGuardAndAdvance({
          actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoUnloadGuardAndAdvance"]>[0]["actorId"],
          actorPlayerId: input.idempotency.actorPlayerId,
          expectedVersion: input.context.expectedAutoVersion,
          expectedSimulationAt: input.context.expectedSimulationAt,
          eventTime: input.context.eventTime,
          updatedAt: now,
          transitionId,
          payloadFingerprint: input.idempotency.payloadFingerprint,
          responseJson: input.idempotency.responseJson,
          additions: input.unload.additions.map((addition) => ({
            itemDefinitionId: addition.itemDefinitionId,
            quantity: addition.quantity
          }))
        })
      ]);
    } catch (error: unknown) {
      // The same stable errors the manual boundary gives, because the same triggers refuse the write.
      if (error instanceof Error && error.message.includes("warehouse_full")) {
        throw new ApplicationError("WAREHOUSE_FULL", "The warehouse does not have space for everything carried");
      }
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
      }
      throw error;
    }
  }
}
