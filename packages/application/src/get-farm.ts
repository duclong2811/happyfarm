import type { FarmId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, FarmMemberRepository, FarmRepository } from "./ports";

export class GetFarm {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId) {
    if (actor === null) {
      throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    }
    const farm = await this.farms.findById(farmId);
    if (farm === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    }
    return { farm, membership };
  }
}
