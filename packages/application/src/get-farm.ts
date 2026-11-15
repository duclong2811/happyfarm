import type { FarmId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import { farmIslandSummary } from "./farm-island";
import type { ActorContext, FarmIslandRepository, FarmMemberRepository, FarmRepository } from "./ports";

export class GetFarm {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly islands?: FarmIslandRepository
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
    const island = this.islands === undefined ? null : await this.islands.findByFarm(farmId);
    return { farm, membership, island: farmIslandSummary(island) };
  }
}
