import { z } from "zod";

export const MAX_ITEM_STACK = 2_147_483_647;

/**
 * The item kinds this build knows how to sell and store.
 *
 * `SEED` is the planting input and `CROP` is the harvested produce. The distinction is what lets the
 * shop offer seeds for sale and produce for sale only, instead of letting a single price list drift
 * into an arbitrage loop; nothing else in the domain branches on it.
 */
export const ITEM_CATEGORIES = ["CROP", "SEED"] as const;

export const ItemDefinitionSchema = z
  .object({
    id: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^item\.[a-z0-9_]+\.name$/),
    category: z.enum(ITEM_CATEGORIES),
    stackable: z.literal(true),
    maxStack: z.number().int().positive().max(MAX_ITEM_STACK)
  })
  .strict();

export type ItemDefinitionData = z.infer<typeof ItemDefinitionSchema>;

export function createItemRegistry(input: unknown): ReadonlyMap<string, ItemDefinitionData> {
  const definitions = z.array(ItemDefinitionSchema).parse(input);
  const registry = new Map<string, ItemDefinitionData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate item definition: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  return registry;
}

export const itemRegistry = createItemRegistry([
  { id: "item_carrot", displayNameKey: "item.carrot.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_wheat", displayNameKey: "item.wheat.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_corn", displayNameKey: "item.corn.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_wheat_seed", displayNameKey: "item.wheat_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_corn_seed", displayNameKey: "item.corn_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  // A sapling is the planting input for a tree, so it reuses the `SEED` category the shop sells and
  // planting consumes. The fruit is produce, so it reuses `CROP` and is only ever sold.
  { id: "item_apple_sapling", displayNameKey: "item.apple_sapling.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_apple", displayNameKey: "item.apple.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK }
]);

export const items = [...itemRegistry.values()];
