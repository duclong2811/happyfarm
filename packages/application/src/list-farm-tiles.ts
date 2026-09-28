import type { FarmId, FarmTile } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, FarmMemberRepository, FarmRepository, FarmTileRepository } from "./ports";

/**
 * Reads the tiles (and therefore the unlocked land) of a farm the actor belongs to.
 *
 * Clients need tile coordinates and versions to issue optimistic planting commands:
 * `PlantCrop` requires an `expectedTileVersion` for an existing tile. This query exposes
 * only authoritative server state and is authorized by farm membership.
 */
export class ListFarmTiles {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly tiles: FarmTileRepository
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly FarmTile[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    if ((await this.members.findByFarmAndPlayer(farmId, actor.playerId)) === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    }
    return this.tiles.listByFarm(farmId);
  }
}