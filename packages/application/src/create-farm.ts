import { assertActivePlayer, createOwnedFarm, DomainError } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock, FarmRepository, IdGenerator, PlayerRepository } from "./ports";

export interface CreateFarmCommand {
  readonly name: string;
}

export class CreateFarm {
  constructor(
    private readonly players: PlayerRepository,
    private readonly farms: FarmRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: CreateFarmCommand) {
    if (actor === null) {
      throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    }
    const player = await this.players.findById(actor.playerId);
    try {
      assertActivePlayer(player);
      const aggregate = createOwnedFarm(this.ids.newFarmId(), actor.playerId, command.name, this.clock.now());
      await this.farms.createWithOwner(aggregate.farm, aggregate.ownerMembership);
      return aggregate;
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new ApplicationError("INVALID_INPUT", error.message);
      }
      throw error;
    }
  }
}
