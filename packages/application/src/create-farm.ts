import {
  assertActivePlayer,
  createInitialFarmTiles,
  createOwnedFarm,
  DomainError,
  type FarmIsland,
  type IslandChoice
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  FarmMemberRepository,
  FarmRepository,
  IdGenerator,
  IslandGroundBuilder,
  PlayerRepository,
  SeaRegionName,
  WorldSlotClaim
} from "./ports";
import { nextWorldSlot, WORLD_SLOT_ATTEMPTS, type WorldPlacement } from "./world";

export interface CreateFarmCommand {
  readonly name: string;
  /**
   * The Home Island the player picked, when island choice is offered.
   *
   * Only ever honoured when the farm is *created*: a player who already has a farm gets that farm
   * back unchanged, because an island is chosen once and never swapped.
   */
  readonly island?: IslandChoice | undefined;
  /**
   * The world-map region the chosen island goes to. The server picks the slot (the next free one
   * there); without a region, the emptiest region. Ignored for a farm on the composed island.
   */
  readonly region?: SeaRegionName | undefined;
}

/** Whether this host offers island choice, and the game data that builds a chosen island. */
export interface IslandChoicePolicy {
  readonly enabled: boolean;
  readonly builder: IslandGroundBuilder;
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
    private readonly clock: Clock,
    private readonly islands?: IslandChoicePolicy,
    /** Present when the world map is on: a chosen island then takes a slot on it. */
    private readonly world?: WorldPlacement
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
      const island = this.chosenIsland(command.island, aggregate.farm.id, now);
      const world = island === null ? undefined : this.world;
      for (let attempt = 0; ; attempt += 1) {
        // A chosen island takes the next free place on the world map, in the same transaction as the
        // farm: the slot's primary key means two islands can never share it.
        const slot: WorldSlotClaim | null = world === undefined ? null : await nextWorldSlot(world, aggregate.farm.id, command.region, now);
        try {
          // Starter land and the chosen island are persisted in the same transaction as the farm and
          // OWNER membership, so a partially created farm is never observable.
          await this.farms.createWithOwner(
            aggregate.farm,
            aggregate.ownerMembership,
            createInitialFarmTiles(aggregate.farm.id, now),
            island,
            slot
          );
          return { ...aggregate, created: true };
        } catch (error: unknown) {
          // Another island took this slot between our read and our write. Nothing was written (the
          // batch rolled back), so try the next free place - unless this player's farm now exists,
          // which the outer handler answers.
          const lostSlot = world !== undefined && slot !== null && attempt < WORLD_SLOT_ATTEMPTS - 1 &&
            (await world.slots.claimedSlotIds()).has(slot.slotId) &&
            (await this.farms.findByOwner(actor.playerId)) === null;
          if (!lostSlot) throw error;
        }
      }
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

  /**
   * The island a new farm is created with, or null for the hand-composed island.
   *
   * The ground is built here, on the server, from the three values the player chose; nothing about
   * the ground itself is accepted from a request.
   */
  private chosenIsland(choice: IslandChoice | undefined, farmId: FarmIsland["farmId"], now: string): FarmIsland | null {
    if (choice === undefined) return null;
    if (this.islands === undefined || !this.islands.enabled) {
      throw new ApplicationError("ISLAND_CHOICE_UNAVAILABLE", "Choosing a Home Island is not available yet");
    }
    return { ...this.islands.builder.build(choice), farmId, createdAt: now };
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
