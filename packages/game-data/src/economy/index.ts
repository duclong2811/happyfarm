import { z } from "zod";

export const MAX_CURRENCY_BALANCE = Number.MAX_SAFE_INTEGER;

export const CurrencyDefinitionSchema = z
  .object({
    id: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^currency\.[a-z0-9_]+\.name$/),
    maxBalance: z.literal(MAX_CURRENCY_BALANCE)
  })
  .strict();

export type CurrencyDefinitionData = z.infer<typeof CurrencyDefinitionSchema>;

export function createCurrencyRegistry(input: unknown): ReadonlyMap<string, CurrencyDefinitionData> {
  const definitions = z.array(CurrencyDefinitionSchema).parse(input);
  const registry = new Map<string, CurrencyDefinitionData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate currency definition: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  return registry;
}

export const currencyRegistry = createCurrencyRegistry([
  { id: "currency_gold", displayNameKey: "currency.gold.name", maxBalance: MAX_CURRENCY_BALANCE }
]);

export const currencies = [...currencyRegistry.values()];
