import {
  assertActivePlayer,
  createInitialFarmTiles,
  createOwnedFarm,
  DomainError
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  FarmMemberRepository,
  FarmRepository,
  IdGenerator,
  PlayerRepository
} from "./ports";

export interface CreateFarmCommand {
  readonly name: string;
}

export interface CreateFarmResult {
  readonly farm: ReturnType<typeof createOwnedFarm>["farm"];
  readonly ownerMembership: ReturnType<typeof createOwnedFarm>["ownerMembership"];
  /**
   * Whether this call created the farm, or found the one the player already had.
   *
   * The caller reports `201` for a creation and `200` for a repeat. It is deliberately not a
   * gameplay fact: the client treats both as "here is your farm".
   */
  readonly created: boolean;
}

/**
 * A player's farm, created once.
 *
 * **One player owns one farm.** A first visit creates it; every later request - a reload, a retry
 * after a dropped response, a second device - resolves to the same farm instead of building another.
 * That matters more on a phone than anywhere else: a mobile connection that loses a response would
 * otherwise leave a tester with an empty second farm while their gold and their fields sit on the
 * first one, and with no way to tell the difference.
 *
 * The rule is enforced twice, on purpose. The *use case* answers "do they already have one?" before
 * creating anything, and the *database* has a unique index on the owner (`0014`), so two requests that
 * race each other cannot both win: the loser's insert fails and it re-reads the winner's farm. The
 * client is unchanged - it has always stored whatever id came back.
 */
export class CreateFarm {
  constructor(
    private readonly players: PlayerRepository,
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: CreateFarmCommand): Promise<CreateFarmResult> {
    if (actor === null) {
      throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    }
    const player = await this.players.findById(actor.playerId);
    try {
      assertActivePlayer(player);
      const existing = await this.farms.findByOwner(actor.playerId);
      if (existing !== null) return await this.existingResult(existing, actor);

      const now = this.clock.now();
      const aggregate = createOwnedFarm(this.ids.newFarmId(), actor.playerId, command.name, now);
      // Starter land is persisted in the same transaction as the farm and OWNER membership,
      // so a partially created farm is never observable.
      await this.farms.createWithOwner(
        aggregate.farm,
        aggregate.ownerMembership,
        createInitialFarmTiles(aggregate.farm.id, now)
      );
      return { ...aggregate, created: true };
    } catch (error: unknown) {
      // The unique index rejected the insert, which means another request for this same player won
      // the race. Their farm is the answer, not an error: this is exactly the retry we want to absorb.
      const raced = await this.farms.findByOwner(actor.playerId).catch(() => null);
      if (raced !== null) return await this.existingResult(raced, actor);
      if (error instanceof DomainError) {
        throw new ApplicationError("INVALID_INPUT", error.message);
      }
      throw error;
    }
  }

  /** The farm a player already has, with the OWNER membership that was written with it. */
  private async existingResult(
    farm: ReturnType<typeof createOwnedFarm>["farm"],
    actor: ActorContext
  ): Promise<CreateFarmResult> {
    const membership = await this.members.findByFarmAndPlayer(farm.id, actor.playerId);
    if (membership === null) {
      // A farm whose owner has no OWNER row is corrupt, and guessing one here would hide that.
      throw new ApplicationError("INTERNAL_ERROR", "Farm is missing its owner membership");
    }
    return { farm, ownerMembership: membership, created: false };
  }
}
