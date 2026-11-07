import type {
  AutoPlantSettlement,
  AutoPlantSettlementContext,
  CargoRemoval,
  Clock,
  IdempotencyRecord,
  TilePlan
} from "@happy-farm/application";
import { assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";
import type { ActorCargoItem, CropInstance } from "@happy-farm/domain";
import { executeD1AtomicAutoPlant, type D1AtomicBatchComponent } from "./d1-atomic-batch";
import type { D1DatabaseLike } from "./d1-types";
import type { D1AutoTravelRepository, D1CropRepository } from "./d1-repositories";

export interface D1AutoPlantSettlementInput {
  readonly crop: CropInstance;
  readonly tile: TilePlan;
  readonly seedRemoval: CargoRemoval;
  readonly expectedCargo: ActorCargoItem;
  readonly idempotency: IdempotencyRecord;
  readonly context: AutoPlantSettlementContext;
}

export interface PreparedD1AutoPlantSettlement {
  readonly transitionId: string;
  readonly plant: D1AtomicBatchComponent<void>;
  readonly auto: D1AtomicBatchComponent<void>;
}

/** Production composition seam shared by AdvanceAuto and real-repository integration tests. */
export class D1AutoPlantSettlementService implements AutoPlantSettlement {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly crops: D1CropRepository,
    private readonly autoTravel: D1AutoTravelRepository,
    private readonly clock: Clock
  ) {}

  prepare(input: D1AutoPlantSettlementInput): PreparedD1AutoPlantSettlement {
    const now = this.clock.now();
    assertTrustedAutoEventTime({
      eventTime: input.context.eventTime,
      serverNow: now,
      simulationAt: input.context.expectedSimulationAt
    });
    const transitionId = autoTransitionId({ ...input.context, kind: "PLANT" });
    const semanticReceipt = { ...input.idempotency, operation: "AUTO_PLANT", requestId: transitionId };
    const seedAfterQuantity = input.expectedCargo.quantity - input.seedRemoval.quantity;
    return {
      transitionId,
      plant: this.crops.preparePlantFromCargoSettlement(
        input.crop,
        input.tile,
        input.seedRemoval,
        input.expectedCargo,
        semanticReceipt,
        { deferReceipt: true }
      ),
      auto: this.autoTravel.prepareAutoPlantGuardAndAdvance({
        actorId: input.context.actorId as Parameters<D1AutoTravelRepository["prepareAutoPlantGuardAndAdvance"]>[0]["actorId"],
        actorPlayerId: input.idempotency.actorPlayerId,
        expectedVersion: input.context.expectedAutoVersion,
        nextVersion: input.context.expectedAutoVersion + 1,
        expectedSimulationAt: input.context.expectedSimulationAt,
        eventTime: input.context.eventTime,
        updatedAt: now,
        transitionId,
        payloadFingerprint: input.idempotency.payloadFingerprint,
        responseJson: input.idempotency.responseJson,
        cropId: input.crop.id,
        cropFarmId: input.crop.farmId,
        cropVersion: input.crop.version,
        itemDefinitionId: input.seedRemoval.itemDefinitionId,
        expectedCargoVersion: input.expectedCargo.version,
        seedAfterQuantity
      })
    };
  }

  async settle(input: D1AutoPlantSettlementInput): Promise<void> {
    const prepared = this.prepare(input);
    await executeD1AtomicAutoPlant(this.db, prepared.plant, prepared.auto);
  }
}
