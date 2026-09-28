import { DomainError } from "./errors";
import type { ItemDefinitionId, PlayerId } from "./ids";

export const MAX_INVENTORY_QUANTITY = 2_147_483_647;

export interface ItemDefinition {
  readonly id: ItemDefinitionId;
  readonly displayNameKey: string;
  readonly category: "CROP";
  readonly stackable: true;
  readonly maxStack: number;
}

export interface InventoryItem {
  readonly playerId: PlayerId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface InventoryAddition {
  readonly kind: "ADD";
  readonly playerId: PlayerId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly maxQuantity: number;
  readonly timestamp: string;
}

export interface InventoryRemoval {
  readonly kind: "REMOVE";
  readonly playerId: PlayerId;
  readonly itemDefinitionId: ItemDefinitionId;
  readonly quantity: number;
  readonly timestamp: string;
}

export type InventoryMutation = InventoryAddition | InventoryRemoval;

export function createInventoryAddition(
  playerId: PlayerId,
  definition: ItemDefinition,
  quantity: number,
  timestamp: string
): InventoryAddition {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new DomainError("INVALID_INVENTORY_MUTATION", "Inventory addition must be a positive safe integer");
  }
  if (!Number.isSafeInteger(definition.maxStack) || definition.maxStack <= 0 || definition.maxStack > MAX_INVENTORY_QUANTITY) {
    throw new DomainError("INVALID_INVENTORY_MUTATION", "Item inventory limit is invalid");
  }
  if (quantity > definition.maxStack) {
    throw new DomainError("INVENTORY_LIMIT_EXCEEDED", "Inventory addition exceeds the item limit");
  }
  return {
    kind: "ADD",
    playerId,
    itemDefinitionId: definition.id,
    quantity,
    maxQuantity: definition.maxStack,
    timestamp
  };
}

export function createInventoryRemoval(
  playerId: PlayerId,
  definition: ItemDefinition,
  quantity: number,
  timestamp: string
): InventoryRemoval {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > definition.maxStack) {
    throw new DomainError("INVALID_INVENTORY_MUTATION", "Inventory removal must be a bounded positive integer");
  }
  return {
    kind: "REMOVE",
    playerId,
    itemDefinitionId: definition.id,
    quantity,
    timestamp
  };
}
