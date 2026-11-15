import type { Farm, FarmId, FarmIsland } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, FarmIslandRepository, FarmMemberRepository, FarmRepository } from "./ports";

/** What a client needs to know about a farm's island without downloading its ground. */
export interface FarmIslandSummary {
  readonly element: string;
  readonly outline: string;
  readonly seed: number;
  readonly revision: number;
}

export function farmIslandSummary(island: FarmIsland | null): FarmIslandSummary | null {
  return island === null
    ? null
    : { element: island.element, outline: island.outline, seed: island.seed, revision: island.revision };
}

/**
 * The caller's own farm, if they have one, and whether a new farm may choose its island.
 *
 * This is what lets the client show the island picker to a *new* player only: an existing player on
 * a new browser is handed their farm instead of being asked to choose an island they already have.
 * Ownership comes from the verified actor, never from the request.
 */
export class GetMyFarm {
  constructor(
    private readonly farms: FarmRepository,
    private readonly islands: FarmIslandRepository,
    private readonly islandChoiceEnabled: boolean
  ) {}

  async execute(actor: ActorContext | null): Promise<{
    readonly farm: Farm | null;
    readonly island: FarmIslandSummary | null;
    readonly islandChoiceEnabled: boolean;
  }> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findByOwner(actor.playerId);
    const island = farm === null ? null : await this.islands.findByFarm(farm.id);
    return { farm, island: farmIslandSummary(island), islandChoiceEnabled: this.islandChoiceEnabled };
  }
}

/**
 * A farm's stored island ground, for drawing it.
 *
 * Any member may read it - a visitor walks the same island the owner does. A farm on the
 * hand-composed island has no stored ground and answers `RESOURCE_NOT_FOUND`.
 */
export class GetFarmIsland {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly islands: FarmIslandRepository
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<FarmIsland> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findById(farmId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership === null) throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    const island = await this.islands.findByFarm(farmId);
    if (island === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm has no chosen island");
    return island;
  }
}
