import { z } from "zod";
import { currencyRegistry } from "../economy";
import { itemRegistry } from "../items";

export const MAX_SHOP_REQUEST_QUANTITY = 1_000_000;

export const ShopEntrySchema = z
  .object({
    id: z.string().regex(/^shop_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    buyPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sellPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxQuantityPerRequest: z.number().int().positive().max(MAX_SHOP_REQUEST_QUANTITY)
  })
  .strict()
  .refine((entry) => entry.sellPrice <= entry.buyPrice, { message: "Sell price cannot exceed buy price" })
  .refine(
    (entry) =>
      Number.isSafeInteger(entry.buyPrice * entry.maxQuantityPerRequest) &&
      Number.isSafeInteger(entry.sellPrice * entry.maxQuantityPerRequest),
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
    registry.set(definition.id, definition);
  }
  return registry;
}

export const shopRegistry = createShopRegistry([
  { id: "shop_carrot", itemDefinitionId: "item_carrot", currencyDefinitionId: "currency_gold", buyPrice: 4, sellPrice: 2, maxQuantityPerRequest: 1_000 },
  { id: "shop_wheat", itemDefinitionId: "item_wheat", currencyDefinitionId: "currency_gold", buyPrice: 6, sellPrice: 3, maxQuantityPerRequest: 1_000 },
  { id: "shop_corn", itemDefinitionId: "item_corn", currencyDefinitionId: "currency_gold", buyPrice: 8, sellPrice: 4, maxQuantityPerRequest: 1_000 }
]);

export const shops = [...shopRegistry.values()];
