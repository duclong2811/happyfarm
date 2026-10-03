import { z } from "zod";

export const MAX_ITEM_STACK = 2_147_483_647;

/**
 * The item kinds this build knows how to sell and store.
 *
 * `SEED` is the planting input, `CROP` is the harvested produce, and `FISH` is a catch. The
 * distinction is what lets the shop sell seeds and saplings while buying produce and fish, instead of
 * letting a single price list drift into an arbitrage loop; nothing else in the domain branches on it.
 */
export const ITEM_CATEGORIES = ["CROP", "SEED", "FISH", "MATERIAL"] as const;

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
  { id: "item_potato", displayNameKey: "item.potato.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_tomato", displayNameKey: "item.tomato.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_strawberry", displayNameKey: "item.strawberry.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_cabbage", displayNameKey: "item.cabbage.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_pumpkin", displayNameKey: "item.pumpkin.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_wheat_seed", displayNameKey: "item.wheat_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_corn_seed", displayNameKey: "item.corn_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_potato_seed", displayNameKey: "item.potato_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_tomato_seed", displayNameKey: "item.tomato_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_strawberry_seed", displayNameKey: "item.strawberry_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_cabbage_seed", displayNameKey: "item.cabbage_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_pumpkin_seed", displayNameKey: "item.pumpkin_seed.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  // A sapling is the planting input for a tree, so it reuses the `SEED` category the shop sells and
  // planting consumes. The fruit is produce, so it reuses `CROP` and is only ever sold.
  { id: "item_apple_sapling", displayNameKey: "item.apple_sapling.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_apple", displayNameKey: "item.apple.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_orange_sapling", displayNameKey: "item.orange_sapling.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_orange", displayNameKey: "item.orange.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_peach_sapling", displayNameKey: "item.peach_sapling.name", category: "SEED", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_peach", displayNameKey: "item.peach.name", category: "CROP", stackable: true, maxStack: MAX_ITEM_STACK },
  // A caught fish is produce of the water: it is stored and sold like any crop, and it is never
  // planted or fed to anything. The category exists so the market's sell rule can name it.
  { id: "item_fish_tilapia", displayNameKey: "item.fish_tilapia.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_carp", displayNameKey: "item.fish_carp.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_catfish", displayNameKey: "item.fish_catfish.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_sardine", displayNameKey: "item.fish_sardine.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_mackerel", displayNameKey: "item.fish_mackerel.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_snapper", displayNameKey: "item.fish_snapper.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_fish_tuna", displayNameKey: "item.fish_tuna.name", category: "FISH", stackable: true, maxStack: MAX_ITEM_STACK },
  // Raw materials: what the island's deposits give up, and what crafting and building will later
  // consume. They are stackable like everything else and have no use yet beyond being sold.
  { id: "item_stone", displayNameKey: "item.stone.name", category: "MATERIAL", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_copper_ore", displayNameKey: "item.copper_ore.name", category: "MATERIAL", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_iron_ore", displayNameKey: "item.iron_ore.name", category: "MATERIAL", stackable: true, maxStack: MAX_ITEM_STACK },
  { id: "item_coal", displayNameKey: "item.coal.name", category: "MATERIAL", stackable: true, maxStack: MAX_ITEM_STACK }
]);

export const items = [...itemRegistry.values()];
