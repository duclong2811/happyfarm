import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import type { ActorContext, StarterSeedGrantRepository } from "./ports";

/**
 * The starter grant's authoritative definition, handed in by the composition root.
 *
 * `packages/application` does not import game data, so the item and the quantity arrive as plain
 * values from `@happy-farm/game-data` via `workers/api/src/runtime.ts`. Nothing else may supply
 * them: there is no route, and no command, that carries an item ID or a quantity for a grant.
 */
export interface StarterSeedDefinition {
  readonly itemDefinitionId: string;
  readonly quantity: number;
}

export interface StarterSeedGrantResult {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  /** False when the player already had the receipt, which is the normal answer on every later call. */
  readonly granted: boolean;
}

/**
 * Gives a player their one-time starting seeds.
 *
 * This is the onboarding step, not a command: it takes no item, no quantity, and no request ID from
 * a caller, and it is safe to call on every bootstrap because the grant repository keys the receipt
 * by player. That is what makes "signing in again", "creating a second farm", and "replaying the
 * bootstrap" all answer with the same 36 seeds and no more.
 *
 * The inventory mutation is prepared through `InventoryService` like every other credit, so the item
 * still has to be a real, bounded one.
 */
export class GrantStarterSeed {
  constructor(
    private readonly grants: StarterSeedGrantRepository,
    private readonly inventoryService: InventoryService,
    private readonly definition: StarterSeedDefinition
  ) {}

  async execute(actor: ActorContext | null): Promise<StarterSeedGrantResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const addition = this.inventoryService.prepareAddition(
      actor.playerId,
      this.definition.itemDefinitionId,
      this.definition.quantity
    );
    const granted = await this.grants.grantStarterSeedAtomically({
      playerId: actor.playerId,
      itemDefinitionId: addition.itemDefinitionId,
      quantity: addition.quantity,
      timestamp: addition.timestamp
    });
    return {
      itemDefinitionId: addition.itemDefinitionId,
      quantity: addition.quantity,
      granted
    };
  }
}
