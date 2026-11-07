/**
 * Forestry capability for trees that are persisted as farm constructions.
 *
 * Ambient scenery deliberately does not appear here: it has no server identity, ownership or
 * lifecycle and therefore cannot be a reward source. `tree_wildwood` is the separate player-planted
 * producer and intentionally yields more than these ordinary trees.
 */
export const FORESTRY_CONSTRUCTION_DEFINITIONS = {
  "world.tree_broad": { dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 720, stumpSizeWorld: 1.15, xp: 2 },
  "world.tree_pine": { dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 900, stumpSizeWorld: 1.3, xp: 3 },
  place_tree_broad: { dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 720, stumpSizeWorld: 1.15, xp: 2 },
  place_tree_pine: { dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 900, stumpSizeWorld: 1.3, xp: 3 }
} as const;

export type ForestryConstructionEntryId = keyof typeof FORESTRY_CONSTRUCTION_DEFINITIONS;

export function forestryConstructionDefinition(entryId: string) {
  const entry = Object.entries(FORESTRY_CONSTRUCTION_DEFINITIONS).find(([id]) => id === entryId);
  return entry === undefined ? null : entry[1];
}

export function isForestryConstructionEntry(entryId: string): entryId is ForestryConstructionEntryId {
  return Object.keys(FORESTRY_CONSTRUCTION_DEFINITIONS).includes(entryId);
}

export const PLAYER_WILDWOOD_DROP_QUANTITY = 12;

