import {
  createInventoryAddition,
  createInventoryRemoval,
  DomainError,
  parseItemDefinitionId,
  type InventoryAddition,
  type InventoryRemoval,
  type ItemCategory,
  type PlayerId
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock, InventoryRepository, ItemDefinitionRepository } from "./ports";

export interface InventoryEntry {
  readonly itemDefinitionId: string;
  /** The game-data key the client translates, so a new item needs no client release. */
  readonly displayNameKey: string;
  readonly category: ItemCategory;
  readonly quantity: number;
}

export class InventoryService {
  constructor(
    private readonly definitions: ItemDefinitionRepository,
    private readonly clock: Clock
  ) {}

  prepareAddition(playerId: PlayerId, itemDefinitionId: string, quantity: number): InventoryAddition {
    const definition = this.requireDefinition(itemDefinitionId);
    try {
      return createInventoryAddition(playerId, definition, quantity, this.clock.now());
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "INVENTORY_LIMIT_EXCEEDED") {
        throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", error.message);
      }
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
  }

  prepareRemoval(playerId: PlayerId, itemDefinitionId: string, quantity: number): InventoryRemoval {
    const definition = this.requireDefinition(itemDefinitionId);
    try {
      return createInventoryRemoval(playerId, definition, quantity, this.clock.now());
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
  }

  private requireDefinition(itemDefinitionId: string) {
    let parsedId;
    try {
      parsedId = parseItemDefinitionId(itemDefinitionId);
    } catch {
      throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
    }
    const definition = this.definitions.findById(parsedId);
    if (definition === null) {
      throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
    }
    return definition;
  }
}

export class GetInventory {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly definitions: ItemDefinitionRepository
  ) {}

  async execute(actor: ActorContext | null): Promise<readonly InventoryEntry[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const rows = await this.inventory.listByPlayer(actor.playerId);
    return rows.map((item) => {
      // Every stored item got there through `InventoryService` or a settlement trigger fed by game
      // data, so a miss means the deployment's item catalogue shrank under stored state. Refusing the
      // read is the honest answer; a silent skip would hide a player's item.
      const definition = this.definitions.findById(item.itemDefinitionId);
      if (definition === null) {
        throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Item definition was not found");
      }
      return {
        itemDefinitionId: item.itemDefinitionId,
        displayNameKey: definition.displayNameKey,
        category: definition.category,
        quantity: item.quantity
      };
    });
  }
}
