import { z } from "zod";

export const MAX_ITEM_STACK = 2_147_483_647;

export const ItemDefinitionSchema = z
  .object({
    id: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^item\.[a-z0-9_]+\.name$/),
    category: z.literal("CROP"),
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
  { id: "item_corn", displayNameKey: "item.corn.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK }
]);

export const items = [...itemRegistry.values()];
