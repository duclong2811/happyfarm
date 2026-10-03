import { z } from "zod";
import { currencyRegistry } from "../economy";
import { itemRegistry } from "../items";

/**
 * The Island Warehouse: the one finite-storage definition, as game data.
 *
 * The warehouse is **capacity**, not a second inventory. A player's stored goods stay in
 * `inventory_items`; this catalogue says how many units one Home Island may hold, and what the next
 * tier costs. Capacity is stored per warehouse row at write time, so a warehouse keeps the tier it was
 * built at; this table is the source of truth a deployment updates deliberately.
 *
 * The tiers are a production-alpha shape, not the simulator's modelling numbers (which were thousands
 * of units because the model did not know what an item is). They are provisional.
 */

const ITEM_ID = /^item_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const WarehouseUpgradeCostSchema = z
  .object({
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    gold: z.number().int().positive().max(1_000_000_000),
    /** Real goods, by production item id. Wood and stone exist today; later tiers may add more. */
    materials: z.record(z.string().regex(ITEM_ID), z.number().int().positive().max(1_000_000))
  })
  .strict();

export type WarehouseUpgradeCostData = z.infer<typeof WarehouseUpgradeCostSchema>;

export const WarehouseTierSchema = z
  .object({
    tier: z.number().int().min(0).max(50),
    displayNameKey: z.string().regex(/^warehouse\.tier\.[a-z0-9_]+\.name$/),
    capacity: z.number().int().positive().max(1_000_000_000),
    /** The cost of moving from this tier to the next; null on the highest tier. */
    upgrade: WarehouseUpgradeCostSchema.nullable()
  })
  .strict();

export type WarehouseTierData = z.infer<typeof WarehouseTierSchema>;

/**
 * The tiers, in order. A gap or a duplicate is refused at load, because a warehouse that could not
 * find its own tier has no capacity at all.
 */
export function createWarehouseTierRegistry(input: unknown): ReadonlyMap<number, WarehouseTierData> {
  const definitions = z.array(WarehouseTierSchema).parse(input);
  const registry = new Map<number, WarehouseTierData>();
  let nextTier = 0;
  for (const definition of definitions) {
    if (registry.has(definition.tier)) throw new Error(`Duplicate warehouse tier: ${String(definition.tier)}`);
    if (definition.tier !== nextTier) {
      throw new Error(`Warehouse tiers must be contiguous from tier 0: ${String(definition.tier)}`);
    }
    for (const itemId of Object.keys(definition.upgrade?.materials ?? {})) {
      if (!itemRegistry.has(itemId)) throw new Error(`Warehouse tier ${String(definition.tier)} names an unknown material: ${itemId}`);
    }
    if (definition.upgrade !== null && !currencyRegistry.has(definition.upgrade.currencyDefinitionId)) {
      throw new Error(`Warehouse tier ${String(definition.tier)} names an unknown currency: ${definition.upgrade.currencyDefinitionId}`);
    }
    // Every tier but the last must have an upgrade; the last must not.
    const isLast = definition.tier === definitions.length - 1;
    if (isLast !== (definition.upgrade === null)) {
      throw new Error(`Warehouse tier ${String(definition.tier)} has an inconsistent upgrade entry`);
    }
    nextTier += 1;
    registry.set(definition.tier, definition);
  }
  if (registry.size === 0) throw new Error("The warehouse tier catalogue is empty");
  return registry;
}

export const warehouseTierRegistry = createWarehouseTierRegistry([
  {
    tier: 0,
    displayNameKey: "warehouse.tier.starter.name",
    capacity: 1_000,
    upgrade: { currencyDefinitionId: "currency_gold", gold: 500, materials: { item_wood: 50, item_stone: 50 } }
  },
  {
    tier: 1,
    displayNameKey: "warehouse.tier.early.name",
    capacity: 2_500,
    upgrade: { currencyDefinitionId: "currency_gold", gold: 2_000, materials: { item_wood: 150, item_stone: 150 } }
  },
  {
    tier: 2,
    displayNameKey: "warehouse.tier.developing.name",
    capacity: 6_000,
    upgrade: { currencyDefinitionId: "currency_gold", gold: 8_000, materials: { item_wood: 400, item_stone: 400 } }
  },
  {
    tier: 3,
    displayNameKey: "warehouse.tier.mid.name",
    capacity: 15_000,
    upgrade: null
  }
]);

export const warehouseTiers: readonly WarehouseTierData[] = [...warehouseTierRegistry.values()];

/** The starter capacity a player's Home Island begins with. */
export const STARTER_WAREHOUSE_CAPACITY = warehouseTiers[0]?.capacity ?? 0;

export function warehouseTierFor(tier: number): WarehouseTierData | null {
  return warehouseTierRegistry.get(tier) ?? null;
}

export function nextWarehouseTier(tier: number): WarehouseTierData | null {
  return warehouseTierRegistry.get(tier + 1) ?? null;
}
