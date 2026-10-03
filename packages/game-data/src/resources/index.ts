import { z } from "zod";
import { itemRegistry } from "../items";

/**
 * Resource nodes: the generic lifecycle mining introduces and forestry will reuse.
 *
 * Two layers, deliberately separate:
 *
 *   DEFINITION  "what an iron deposit is" - verb, timings, drop table, model, level. Static, in game
 *               data, shared by every instance of that type.
 *   INSTANCE    "this iron deposit, at this position, in this zone" - static placement, also game
 *               data, because Home Island's deposits are authored.
 *   STATE       "this deposit is depleted until X" - the only mutable part, and it lives in D1.
 *
 * A node is *not* a decorative rock: the island's editable scenery stays scenery, and a resource node
 * is a gameplay entity with its own id, its own state row and its own verb. Forestry reuses this shape
 * with `verb: "CHOP"` and a tree model; nothing here assumes a rock or an ore.
 */

export const RESOURCE_VERBS = ["MINE", "CHOP"] as const;
export const ResourceVerbSchema = z.enum(RESOURCE_VERBS);
export type ResourceVerb = z.infer<typeof ResourceVerbSchema>;

export const ResourceDropTableSchema = z
  .object({
    id: z.string().regex(/^resourcetable_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^resourcetable\.[a-z0-9_]+\.name$/),
    entries: z
      .array(
        z
          .object({
            itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
            minQuantity: z.number().int().positive().max(1_000_000),
            maxQuantity: z.number().int().positive().max(1_000_000),
            /** Relative likelihood when a table holds more than one entry. */
            weight: z.number().int().positive().max(1_000_000)
          })
          .strict()
          .refine((entry) => entry.maxQuantity >= entry.minQuantity, {
            message: "A drop's maximum quantity cannot be below its minimum"
          })
      )
      .min(1)
  })
  .strict();

export type ResourceDropTableData = z.infer<typeof ResourceDropTableSchema>;

export const ResourceDefinitionSchema = z
  .object({
    id: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^resource\.[a-z0-9_]+\.name$/),
    /** The word the interaction prompt uses. `MINE` today; `CHOP` is what forestry will declare. */
    verb: ResourceVerbSchema,
    /** How long one gather action takes on the server's clock. */
    actionSeconds: z.number().int().positive().max(600),
    /** How long the node stays depleted after a successful gather. */
    regenerationSeconds: z.number().int().positive().max(31_536_000),
    dropTableId: z.string().regex(/^resourcetable_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /** Experience granted when the gather settles. */
    xp: z.number().int().positive().max(1_000_000),
    /** The generated model drawn in the world. */
    modelId: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /**
     * What a *depleted* node draws instead, when the type has a better answer than shrinking.
     *
     * A tree becomes a stump; a rock has nothing better than a smaller rock, so mining definitions
     * leave this absent and the renderer shrinks them. Optional on purpose: the field is the extension
     * point, not a requirement.
     */
    depletedModelId: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/).optional(),
    requiredLevel: z.number().int().positive().max(10_000).optional()
  })
  .strict();

export type ResourceDefinitionData = z.infer<typeof ResourceDefinitionSchema>;

export const ResourceNodeSchema = z
  .object({
    id: z.string().regex(/^node_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    definitionId: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /**
     * The zone kind the node stands in. A literal rather than the full vocabulary: Home Island is the
     * only zone with resource nodes, and the field is what makes a shared or wild zone another value
     * rather than a rewrite.
     */
    zoneKind: z.literal("HOME_ISLAND"),
    /** Fractional tile coordinates, the same currency the starter world and fishing spots use. */
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    interactionRadiusTiles: z.number().positive().max(12)
  })
  .strict();

export type ResourceNodeData = z.infer<typeof ResourceNodeSchema>;

function registry<T extends { id: string }>(definitions: readonly T[], label: string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const definition of definitions) {
    if (map.has(definition.id)) throw new Error(`Duplicate ${label} definition: ${definition.id}`);
    map.set(definition.id, definition);
  }
  return map;
}

export const resourceDropTableRegistry = registry(
  z.array(ResourceDropTableSchema).parse([
    { id: "resourcetable_stone", displayNameKey: "resourcetable.stone.name", entries: [{ itemDefinitionId: "item_stone", minQuantity: 2, maxQuantity: 2, weight: 1 }] },
    { id: "resourcetable_copper", displayNameKey: "resourcetable.copper.name", entries: [{ itemDefinitionId: "item_copper_ore", minQuantity: 2, maxQuantity: 2, weight: 1 }] },
    { id: "resourcetable_iron", displayNameKey: "resourcetable.iron.name", entries: [{ itemDefinitionId: "item_iron_ore", minQuantity: 2, maxQuantity: 2, weight: 1 }] },
    { id: "resourcetable_coal", displayNameKey: "resourcetable.coal.name", entries: [{ itemDefinitionId: "item_coal", minQuantity: 3, maxQuantity: 3, weight: 1 }] }
    // Forestry. One material per tree for the alpha: a predictable yield is easier to balance and to
    // test, and mixed or probabilistic drops wait for the economy phase.
    ,{ id: "resourcetable_wood", displayNameKey: "resourcetable.wood.name", entries: [{ itemDefinitionId: "item_wood", minQuantity: 2, maxQuantity: 2, weight: 1 }] }
    ,{ id: "resourcetable_resin", displayNameKey: "resourcetable.resin.name", entries: [{ itemDefinitionId: "item_resin", minQuantity: 2, maxQuantity: 2, weight: 1 }] }
    ,{ id: "resourcetable_hardwood", displayNameKey: "resourcetable.hardwood.name", entries: [{ itemDefinitionId: "item_hardwood", minQuantity: 2, maxQuantity: 2, weight: 1 }] }
  ]),
  "resource drop table"
);

export const resourceDefinitionRegistry = registry(
  z.array(ResourceDefinitionSchema).parse([
    // Stone is what a new player finds first: quick to break, quick to come back, and worth little
    // enough that selling it is a convenience rather than an income.
    { id: "resource_stone", displayNameKey: "resource.stone.name", verb: "MINE", actionSeconds: 6, regenerationSeconds: 120, dropTableId: "resourcetable_stone", xp: 3, modelId: "resource_stone" },
    { id: "resource_copper", displayNameKey: "resource.copper.name", verb: "MINE", actionSeconds: 8, regenerationSeconds: 300, dropTableId: "resourcetable_copper", xp: 6, modelId: "resource_copper", requiredLevel: 2 },
    { id: "resource_coal", displayNameKey: "resource.coal.name", verb: "MINE", actionSeconds: 10, regenerationSeconds: 420, dropTableId: "resourcetable_coal", xp: 9, modelId: "resource_coal", requiredLevel: 4 },
    { id: "resource_iron", displayNameKey: "resource.iron.name", verb: "MINE", actionSeconds: 13, regenerationSeconds: 600, dropTableId: "resourcetable_iron", xp: 14, modelId: "resource_iron", requiredLevel: 6 }
    // Forestry: the same lifecycle as mining with a different verb, longer waits and a stump instead
    // of a smaller rock. Wildwood is the early, quick, bulk material; pine is the intermediate one
    // with its own identity; hardwood is the slow, valuable one.
    ,{ id: "resource_wildwood", displayNameKey: "resource.wildwood.name", verb: "CHOP", actionSeconds: 5, regenerationSeconds: 120, dropTableId: "resourcetable_wood", xp: 2, modelId: "resource_wildwood", depletedModelId: "resource_wildwood_stump" }
    ,{ id: "resource_pine", displayNameKey: "resource.pine.name", verb: "CHOP", actionSeconds: 7, regenerationSeconds: 240, dropTableId: "resourcetable_resin", xp: 6, modelId: "resource_pine", depletedModelId: "resource_pine_stump", requiredLevel: 3 }
    ,{ id: "resource_hardwood", displayNameKey: "resource.hardwood.name", verb: "CHOP", actionSeconds: 11, regenerationSeconds: 480, dropTableId: "resourcetable_hardwood", xp: 12, modelId: "resource_hardwood", depletedModelId: "resource_hardwood_stump", requiredLevel: 5 }
  ]),
  "resource"
);

/**
 * Home Island's deposits: nine nodes on the volcano's flank and foothill.
 *
 * Fixed positions, checked against the real terrain for walkable ground, spread around the mountain so
 * a player exploring it finds a few clusters rather than one quarry. They are far from the starter
 * parcel on purpose: mining is somewhere the player walks to.
 */
export const resourceNodeRegistry = registry(
  z.array(ResourceNodeSchema).parse([
    { id: "node_stone_ridge", definitionId: "resource_stone", zoneKind: "HOME_ISLAND", position: { x: 12, y: -12 }, interactionRadiusTiles: 3 },
    { id: "node_stone_west", definitionId: "resource_stone", zoneKind: "HOME_ISLAND", position: { x: -3, y: -23 }, interactionRadiusTiles: 3 },
    { id: "node_stone_south", definitionId: "resource_stone", zoneKind: "HOME_ISLAND", position: { x: 20, y: -30 }, interactionRadiusTiles: 3 },
    { id: "node_copper_east", definitionId: "resource_copper", zoneKind: "HOME_ISLAND", position: { x: 24, y: -23 }, interactionRadiusTiles: 3 },
    { id: "node_copper_north", definitionId: "resource_copper", zoneKind: "HOME_ISLAND", position: { x: 4, y: -16 }, interactionRadiusTiles: 3 },
    { id: "node_coal_west", definitionId: "resource_coal", zoneKind: "HOME_ISLAND", position: { x: -2, y: -24 }, interactionRadiusTiles: 3 },
    { id: "node_coal_deep", definitionId: "resource_coal", zoneKind: "HOME_ISLAND", position: { x: -3, y: -27 }, interactionRadiusTiles: 3 },
    { id: "node_iron_west", definitionId: "resource_iron", zoneKind: "HOME_ISLAND", position: { x: -2, y: -28 }, interactionRadiusTiles: 3 },
    { id: "node_iron_north", definitionId: "resource_iron", zoneKind: "HOME_ISLAND", position: { x: 12, y: -10 }, interactionRadiusTiles: 3 }
    // Wild forestry trees, in the island's two woods. Positions are fixed, checked against the real
    // terrain for walkable ground, and kept clear of the mining deposits so a player never finds two
    // different kinds of node inside one interaction range.
    ,{ id: "node_wildwood_north_1", definitionId: "resource_wildwood", zoneKind: "HOME_ISLAND", position: { x: -1, y: -19 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_wildwood_north_2", definitionId: "resource_wildwood", zoneKind: "HOME_ISLAND", position: { x: 3, y: -20 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_wildwood_north_3", definitionId: "resource_wildwood", zoneKind: "HOME_ISLAND", position: { x: 7, y: -24 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_wildwood_north_4", definitionId: "resource_wildwood", zoneKind: "HOME_ISLAND", position: { x: 10, y: -21 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_wildwood_north_5", definitionId: "resource_wildwood", zoneKind: "HOME_ISLAND", position: { x: 14, y: -23 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_pine_north_1", definitionId: "resource_pine", zoneKind: "HOME_ISLAND", position: { x: 16, y: -25 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_pine_north_2", definitionId: "resource_pine", zoneKind: "HOME_ISLAND", position: { x: 17, y: -20 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_pine_north_3", definitionId: "resource_pine", zoneKind: "HOME_ISLAND", position: { x: 20, y: -21 }, interactionRadiusTiles: 3.2 }
    ,{ id: "node_hardwood_east_1", definitionId: "resource_hardwood", zoneKind: "HOME_ISLAND", position: { x: 44, y: -16 }, interactionRadiusTiles: 3.4 }
    ,{ id: "node_hardwood_east_2", definitionId: "resource_hardwood", zoneKind: "HOME_ISLAND", position: { x: 48, y: -20 }, interactionRadiusTiles: 3.4 }
    ,{ id: "node_hardwood_east_3", definitionId: "resource_hardwood", zoneKind: "HOME_ISLAND", position: { x: 52, y: -16 }, interactionRadiusTiles: 3.4 }
    ,{ id: "node_pine_east_4", definitionId: "resource_pine", zoneKind: "HOME_ISLAND", position: { x: 56, y: -20 }, interactionRadiusTiles: 3.2 }
  ]),
  "resource node"
);

export const resourceDropTables = [...resourceDropTableRegistry.values()];
export const resourceDefinitions = [...resourceDefinitionRegistry.values()];
export const resourceNodes = [...resourceNodeRegistry.values()];

export function resourceDefinitionForNode(node: ResourceNodeData): ResourceDefinitionData {
  const definition = resourceDefinitionRegistry.get(node.definitionId);
  if (definition === undefined) throw new Error(`Resource node ${node.id} names an unknown definition: ${node.definitionId}`);
  return definition;
}

export function resourceDropTableForDefinition(definition: ResourceDefinitionData): ResourceDropTableData {
  const table = resourceDropTableRegistry.get(definition.dropTableId);
  if (table === undefined) throw new Error(`Resource ${definition.id} names an unknown drop table: ${definition.dropTableId}`);
  return table;
}

/**
 * Refuses a resource catalogue that could not settle a gather or could never be found.
 *
 * Every reference is checked at load, and the material a table drops has to be a real `MATERIAL` item,
 * so a node cannot promise a reward the inventory has never heard of.
 */
export function validateResourceDefinitions(
  definitions: ReadonlyMap<string, ResourceDefinitionData>,
  tables: ReadonlyMap<string, ResourceDropTableData>,
  nodes: ReadonlyMap<string, ResourceNodeData>,
  items: ReadonlyMap<string, { readonly category?: string }>
): void {
  for (const definition of definitions.values()) {
    if (!tables.has(definition.dropTableId)) {
      throw new Error(`Resource ${definition.id} names an unknown drop table: ${definition.dropTableId}`);
    }
    // Widened to `string` so the guard is a real runtime check rather than a comparison the compiler
    // can fold away: the schema already enum-checks it, and this is the second line of defence.
    const verb: string = definition.verb;
    if (verb !== "MINE" && verb !== "CHOP") {
      throw new Error(`Resource ${definition.id} has an unknown verb: ${verb}`);
    }
  }
  for (const table of tables.values()) {
    if (table.entries.length === 0) throw new Error(`Drop table ${table.id} has no entries`);
    for (const entry of table.entries) {
      const item = items.get(entry.itemDefinitionId);
      if (item === undefined || item.category !== "MATERIAL") {
        throw new Error(`Unknown material item in drop table ${table.id}: ${entry.itemDefinitionId}`);
      }
      if (entry.minQuantity <= 0 || entry.maxQuantity < entry.minQuantity) {
        throw new Error(`Invalid quantity in drop table ${table.id}: ${entry.itemDefinitionId}`);
      }
    }
  }
  if (nodes.size === 0) throw new Error("The island has no resource nodes");
  for (const node of nodes.values()) {
    if (!definitions.has(node.definitionId)) {
      throw new Error(`Resource node ${node.id} names an unknown definition: ${node.definitionId}`);
    }
  }
}

validateResourceDefinitions(resourceDefinitionRegistry, resourceDropTableRegistry, resourceNodeRegistry, itemRegistry);
