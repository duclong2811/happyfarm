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
    // The product decision, made structural: gold buys seeds and only seeds, and harvested produce
    // can only be sold. A catalogue that let a player buy produce directly would bypass planting,
    // and one that let a seed be sold back would price the loop against itself.
    const item = itemRegistry.get(definition.itemDefinitionId);
    if (definition.buyPrice !== undefined && item?.category !== "SEED") {
      throw new Error(`Only seeds can be bought: ${definition.itemDefinitionId}`);
    }
    if (definition.sellPrice !== undefined && item?.category !== "CROP") {
      throw new Error(`Only harvested produce can be sold: ${definition.itemDefinitionId}`);
    }
    registry.set(definition.id, definition);
  }
  return registry;
}

export const shopRegistry = createShopRegistry([
  // Seeds are the only thing gold buys. Every crop repays its seed price at least twice over at
  // the listed prices -- carrot 4 gold for a 2-gold seed, wheat 9 for 3, corn 18 for 6 -- and the
  // resulting gold per second is the same for all three, so a slower crop is never a worse crop.
  { id: "shop_carrot_seed", itemDefinitionId: "item_carrot_seed", currencyDefinitionId: "currency_gold", buyPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_wheat_seed", itemDefinitionId: "item_wheat_seed", currencyDefinitionId: "currency_gold", buyPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_corn_seed", itemDefinitionId: "item_corn_seed", currencyDefinitionId: "currency_gold", buyPrice: 6, maxQuantityPerRequest: 1_000 },
  // Harvested produce never costs gold, and selling it here is the only way it turns back into gold.
  { id: "shop_carrot", itemDefinitionId: "item_carrot", currencyDefinitionId: "currency_gold", sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_wheat", itemDefinitionId: "item_wheat", currencyDefinitionId: "currency_gold", sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_corn", itemDefinitionId: "item_corn", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 },
  // The repeating producer plugs into the same two directions: gold buys the sapling once, and every
  // fruit after that sells like any other produce. Nothing new is bought or sold back.
  { id: "shop_apple_sapling", itemDefinitionId: "item_apple_sapling", currencyDefinitionId: "currency_gold", buyPrice: 20, maxQuantityPerRequest: 1_000 },
  { id: "shop_apple", itemDefinitionId: "item_apple", currencyDefinitionId: "currency_gold", sellPrice: 6, maxQuantityPerRequest: 1_000 }
]);

export const shops = [...shopRegistry.values()];
