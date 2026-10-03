import { z } from "zod";
import { currencyRegistry } from "../economy";
import { itemRegistry } from "../items";

export const MAX_SHOP_REQUEST_QUANTITY = 1_000_000;

export const ShopEntrySchema = z
  .object({
    id: z.string().regex(/^shop_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /**
     * The price the server charges for one unit, or nothing when this entry does not sell that way.
     *
     * A price is the *only* place the direction is declared, so a market row cannot advertise a buy
     * price it will refuse, and the client renders one button per non-null price instead of guessing
     * from the item. Seeds carry `buyPrice`, harvested produce carries `sellPrice`, and an entry that
     * carried both of the same item would be the arbitrage loop this phase exists to close.
     */
    buyPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    sellPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxQuantityPerRequest: z.number().int().positive().max(MAX_SHOP_REQUEST_QUANTITY)
  })
  .strict()
  .refine((entry) => entry.buyPrice !== undefined || entry.sellPrice !== undefined, {
    message: "A shop entry must offer a buy price, a sell price, or both"
  })
  .refine(
    (entry) =>
      entry.buyPrice === undefined ||
      entry.sellPrice === undefined ||
      entry.sellPrice <= entry.buyPrice,
    { message: "Sell price cannot exceed buy price" }
  )
  .refine(
    (entry) =>
      (entry.buyPrice === undefined ||
        Number.isSafeInteger(entry.buyPrice * entry.maxQuantityPerRequest)) &&
      (entry.sellPrice === undefined ||
        Number.isSafeInteger(entry.sellPrice * entry.maxQuantityPerRequest)),
    { message: "Maximum shop total must be a safe integer" }
  );

export type ShopEntryData = z.infer<typeof ShopEntrySchema>;

export function createShopRegistry(input: unknown): ReadonlyMap<string, ShopEntryData> {
  const definitions = z.array(ShopEntrySchema).parse(input);
  const registry = new Map<string, ShopEntryData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate shop entry: ${definition.id}`);
    if (!itemRegistry.has(definition.itemDefinitionId)) {
      throw new Error(`Unknown shop item definition: ${definition.itemDefinitionId}`);
    }
    if (!currencyRegistry.has(definition.currencyDefinitionId)) {
      throw new Error(`Unknown shop currency definition: ${definition.currencyDefinitionId}`);
    }
    // The product decision, made structural: gold buys planting inputs (seeds and saplings) and
    // nothing else, and only gathered goods (a harvested crop, a caught fish, or a mined material)
    // can be sold. A
    // catalogue that let a player buy produce directly would bypass the activity that made it, and
    // one that let a seed be sold back would price the loop against itself.
    const item = itemRegistry.get(definition.itemDefinitionId);
    if (definition.buyPrice !== undefined && item?.category !== "SEED") {
      throw new Error(`Only seeds can be bought: ${definition.itemDefinitionId}`);
    }
    if (
      definition.sellPrice !== undefined &&
      item?.category !== "CROP" &&
      item?.category !== "FISH" &&
      item?.category !== "MATERIAL"
    ) {
      throw new Error(`Only harvested produce can be sold: ${definition.itemDefinitionId}`);
    }
    registry.set(definition.id, definition);
  }
  return registry;
}

export const shopRegistry = createShopRegistry([
  // Seeds (and tree saplings) are the only thing gold buys. Every seed is repaid by its harvest at
  // the listed prices, and no entry both buys and sells, so no item can be round-tripped for a
  // profit. The prices are the balance in `docs/design/FARMING_BALANCE.md`: a longer crop repays
  // more per seed, a shorter one turns over faster, and no single crop wins on every axis.
  { id: "shop_carrot_seed", itemDefinitionId: "item_carrot_seed", currencyDefinitionId: "currency_gold", buyPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_wheat_seed", itemDefinitionId: "item_wheat_seed", currencyDefinitionId: "currency_gold", buyPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_corn_seed", itemDefinitionId: "item_corn_seed", currencyDefinitionId: "currency_gold", buyPrice: 6, maxQuantityPerRequest: 1_000 },
  { id: "shop_potato_seed", itemDefinitionId: "item_potato_seed", currencyDefinitionId: "currency_gold", buyPrice: 6, maxQuantityPerRequest: 1_000 },
  { id: "shop_tomato_seed", itemDefinitionId: "item_tomato_seed", currencyDefinitionId: "currency_gold", buyPrice: 12, maxQuantityPerRequest: 1_000 },
  { id: "shop_strawberry_seed", itemDefinitionId: "item_strawberry_seed", currencyDefinitionId: "currency_gold", buyPrice: 14, maxQuantityPerRequest: 1_000 },
  { id: "shop_cabbage_seed", itemDefinitionId: "item_cabbage_seed", currencyDefinitionId: "currency_gold", buyPrice: 18, maxQuantityPerRequest: 1_000 },
  { id: "shop_pumpkin_seed", itemDefinitionId: "item_pumpkin_seed", currencyDefinitionId: "currency_gold", buyPrice: 22, maxQuantityPerRequest: 1_000 },
  // Harvested produce never costs gold, and selling it here is the only way it turns back into gold.
  { id: "shop_carrot", itemDefinitionId: "item_carrot", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_wheat", itemDefinitionId: "item_wheat", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_corn", itemDefinitionId: "item_corn", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 },
  { id: "shop_potato", itemDefinitionId: "item_potato", currencyDefinitionId: "currency_gold", sellPrice: 4, maxQuantityPerRequest: 1_000 },
  { id: "shop_tomato", itemDefinitionId: "item_tomato", currencyDefinitionId: "currency_gold", sellPrice: 4, maxQuantityPerRequest: 1_000 },
  { id: "shop_strawberry", itemDefinitionId: "item_strawberry", currencyDefinitionId: "currency_gold", sellPrice: 5, maxQuantityPerRequest: 1_000 },
  { id: "shop_cabbage", itemDefinitionId: "item_cabbage", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 },
  { id: "shop_pumpkin", itemDefinitionId: "item_pumpkin", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 },
  // The repeating producer plugs into the same two directions: gold buys the sapling once, and every
  // fruit after that sells like any other produce. Nothing new is bought or sold back.
  { id: "shop_apple_sapling", itemDefinitionId: "item_apple_sapling", currencyDefinitionId: "currency_gold", buyPrice: 12, maxQuantityPerRequest: 1_000 },
  { id: "shop_apple", itemDefinitionId: "item_apple", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_orange_sapling", itemDefinitionId: "item_orange_sapling", currencyDefinitionId: "currency_gold", buyPrice: 18, maxQuantityPerRequest: 1_000 },
  { id: "shop_orange", itemDefinitionId: "item_orange", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_peach_sapling", itemDefinitionId: "item_peach_sapling", currencyDefinitionId: "currency_gold", buyPrice: 24, maxQuantityPerRequest: 1_000 },
  { id: "shop_peach", itemDefinitionId: "item_peach", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  // Fish reach the same two directions through the same settlement: a catch is sold exactly like a
  // harvest, and the harbour will one day be its own market rather than this shelf. See
  // `docs/design/FISHING.md`.
  { id: "shop_fish_tilapia", itemDefinitionId: "item_fish_tilapia", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_carp", itemDefinitionId: "item_fish_carp", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_catfish", itemDefinitionId: "item_fish_catfish", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_sardine", itemDefinitionId: "item_fish_sardine", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_mackerel", itemDefinitionId: "item_fish_mackerel", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_snapper", itemDefinitionId: "item_fish_snapper", currencyDefinitionId: "currency_gold", sellPrice: 5, maxQuantityPerRequest: 1_000 },
  { id: "shop_fish_tuna", itemDefinitionId: "item_fish_tuna", currencyDefinitionId: "currency_gold", sellPrice: 15, maxQuantityPerRequest: 1_000 }
  // Raw materials sell conservatively on purpose: they are the inputs crafting and building will want,
  // so selling is early cash rather than the obviously best use of them. See
  // `docs/design/MINING_BALANCE.md`.
  ,{ id: "shop_stone", itemDefinitionId: "item_stone", currencyDefinitionId: "currency_gold", sellPrice: 1, maxQuantityPerRequest: 1_000 }
  ,{ id: "shop_copper_ore", itemDefinitionId: "item_copper_ore", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 }
  ,{ id: "shop_iron_ore", itemDefinitionId: "item_iron_ore", currencyDefinitionId: "currency_gold", sellPrice: 4, maxQuantityPerRequest: 1_000 }
  ,{ id: "shop_coal", itemDefinitionId: "item_coal", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 }
]);

export const shops = [...shopRegistry.values()];
