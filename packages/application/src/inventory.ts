import {
  createInventoryAddition,
  createInventoryRemoval,
  DomainError,
  parseItemDefinitionId,
  type InventoryAddition,
  type InventoryItem,
  type InventoryRemoval,
  type PlayerId
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock, InventoryRepository, ItemDefinitionRepository } from "./ports";

export interface InventoryEntry {
  readonly itemDefinitionId: string;
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
  constructor(private readonly inventory: InventoryRepository) {}

  async execute(actor: ActorContext | null): Promise<readonly InventoryEntry[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return (await this.inventory.listByPlayer(actor.playerId)).map(toEntry);
  }
}

function toEntry(item: InventoryItem): InventoryEntry {
  return { itemDefinitionId: item.itemDefinitionId, quantity: item.quantity };
}
