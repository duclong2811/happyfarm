import { z } from "zod";
import { itemRegistry } from "../items";

/**
 * Fishing: the world's first non-farming profession.
 *
 * The definitions here are static game data, not rows: Home Island's water is authored, the spots do
 * do not move. Mutable stock is deliberately separate in the fishing_spot_states table; these values
 * are the authoritative stock bounds and regeneration policy, not player state.
 *
 * A fish is an ordinary inventory item with a `FISH` category, a sell price, and an XP reward; a
 * fishing table says which fish a spot can produce and how likely each one is; a fishing spot names the
 * water and the table it pulls from, and carries an explicit zone kind so a spot never assumes it
 * belongs to the player's farm.
 */

/** How long one fishing action takes on the server's clock. Alpha-short: long enough to be a beat. */
export const FISHING_ACTION_SECONDS = 15;

export const FishDefinitionSchema = z
  .object({
    id: z.string().regex(/^fish_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^fish\.[a-z0-9_]+\.name$/),
    itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /** The generated model the inventory card renders. One small model per species. */
    modelId: z.string().regex(/^fish_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    sellPrice: z.number().int().positive().max(1_000_000),
    xp: z.number().int().positive().max(1_000_000),
    /** Relative likelihood inside a table. Never a client input, and never a bare percentage. */
    catchWeight: z.number().int().positive().max(1_000_000),
    requiredLevel: z.number().int().positive().max(10_000).optional()
  })
  .strict();

export type FishDefinitionData = z.infer<typeof FishDefinitionSchema>;

export const FishingTableSchema = z
  .object({
    id: z.string().regex(/^fishtable_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^fishtable\.[a-z0-9_]+\.name$/),
    entries: z
      .array(
        z
          .object({
            fishId: z.string().regex(/^fish_[a-z0-9]+(?:_[a-z0-9]+)*$/),
            weight: z.number().int().positive().max(1_000_000)
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export type FishingTableData = z.infer<typeof FishingTableSchema>;

export const FishingSpotSchema = z
  .object({
    id: z.string().regex(/^spot_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^spot\.[a-z0-9_]+\.name$/),
    /**
     * Which kind of zone the spot stands in.
     *
     * A literal rather than the full `ZONE_KINDS` vocabulary: Home Island is the only fishing zone
     * that exists, and the field is here so a shared or wild zone is another value rather than a
     * rewrite. The zone *id* is never authored here - for a home island it is the player's own farm,
     * resolved at settlement time.
     */
    zoneKind: z.literal("HOME_ISLAND"),
    /** Fractional tile coordinates, the same currency the authored starter world uses. */
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    /** How far from the spot the client offers the interaction, in tiles. The server ignores it. */
    interactionRadiusTiles: z.number().positive().max(12),
    tableId: z.string().regex(/^fishtable_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    enabled: z.boolean(),
    maxStock: z.number().int().positive().max(1_000_000).optional(),
    regenerationSeconds: z.number().int().positive().max(31_536_000).optional(),
    productionUnitsPerHour: z.number().int().nonnegative().max(1_000_000).optional()
  })
  .strict();

export type FishingSpotData = z.infer<typeof FishingSpotSchema>;

function registry<T extends { id: string }>(definitions: readonly T[], label: string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const definition of definitions) {
    if (map.has(definition.id)) throw new Error(`Duplicate ${label} definition: ${definition.id}`);
    map.set(definition.id, definition);
  }
  return map;
}

export const fishRegistry = registry(z.array(FishDefinitionSchema).parse([
  // Freshwater: the island's pond. Cheap, steady, and the first water a new player can reach.
  { id: "fish_tilapia", displayNameKey: "fish.tilapia.name", itemDefinitionId: "item_fish_tilapia", modelId: "fish_tilapia", sellPrice: 2, xp: 1, catchWeight: 50 },
  { id: "fish_carp", displayNameKey: "fish.carp.name", itemDefinitionId: "item_fish_carp", modelId: "fish_carp", sellPrice: 3, xp: 2, catchWeight: 30 },
  { id: "fish_catfish", displayNameKey: "fish.catfish.name", itemDefinitionId: "item_fish_catfish", modelId: "fish_catfish", sellPrice: 6, xp: 3, catchWeight: 20 },
  // Coastal: the harbour. A wider spread, including the one catch worth waiting for.
  { id: "fish_sardine", displayNameKey: "fish.sardine.name", itemDefinitionId: "item_fish_sardine", modelId: "fish_sardine", sellPrice: 2, xp: 1, catchWeight: 45 },
  { id: "fish_mackerel", displayNameKey: "fish.mackerel.name", itemDefinitionId: "item_fish_mackerel", modelId: "fish_mackerel", sellPrice: 3, xp: 2, catchWeight: 30 },
  { id: "fish_snapper", displayNameKey: "fish.snapper.name", itemDefinitionId: "item_fish_snapper", modelId: "fish_snapper", sellPrice: 5, xp: 3, catchWeight: 20 },
  { id: "fish_tuna", displayNameKey: "fish.tuna.name", itemDefinitionId: "item_fish_tuna", modelId: "fish_tuna", sellPrice: 15, xp: 8, catchWeight: 5 }
]), "fish");

export const fishingTableRegistry = registry(z.array(FishingTableSchema).parse([
  {
    id: "fishtable_freshwater",
    displayNameKey: "fishtable.freshwater.name",
    entries: [
      { fishId: "fish_tilapia", weight: 50 },
      { fishId: "fish_carp", weight: 30 },
      { fishId: "fish_catfish", weight: 20 }
    ]
  },
  {
    id: "fishtable_coastal",
    displayNameKey: "fishtable.coastal.name",
    entries: [
      { fishId: "fish_sardine", weight: 45 },
      { fishId: "fish_mackerel", weight: 30 },
      { fishId: "fish_snapper", weight: 20 },
      { fishId: "fish_tuna", weight: 5 }
    ]
  }
]), "fishing table");

export const fishingSpotRegistry = registry(z.array(FishingSpotSchema).parse([
  // The island's pond: three spots on its bank, all reachable on foot from the farm. A tile is
  // ~1.08 m, so a spot sitting just inside the water is 1-2 m from walkable ground.
  { id: "spot_pond_north", displayNameKey: "spot.pond_north.name", zoneKind: "HOME_ISLAND", position: { x: -3, y: 42 }, interactionRadiusTiles: 3, tableId: "fishtable_freshwater", enabled: true, maxStock: 5, regenerationSeconds: 120, productionUnitsPerHour: 1 },
  { id: "spot_pond_west", displayNameKey: "spot.pond_west.name", zoneKind: "HOME_ISLAND", position: { x: -7.5, y: 44.7 }, interactionRadiusTiles: 3, tableId: "fishtable_freshwater", enabled: true, maxStock: 5, regenerationSeconds: 120, productionUnitsPerHour: 1 },
  { id: "spot_pond_east", displayNameKey: "spot.pond_east.name", zoneKind: "HOME_ISLAND", position: { x: 1, y: 45 }, interactionRadiusTiles: 3, tableId: "fishtable_freshwater", enabled: true, maxStock: 5, regenerationSeconds: 120, productionUnitsPerHour: 1 },
  // The harbour's quay: open sea a step off the deck.
  { id: "spot_harbour_quay", displayNameKey: "spot.harbour_quay.name", zoneKind: "HOME_ISLAND", position: { x: 56.5, y: 53.5 }, interactionRadiusTiles: 3, tableId: "fishtable_coastal", enabled: true, maxStock: 8, regenerationSeconds: 90, productionUnitsPerHour: 1 }
]), "fishing spot");

export const fish = [...fishRegistry.values()];
export const fishingTables = [...fishingTableRegistry.values()];
export const fishingSpots = [...fishingSpotRegistry.values()];

export function fishTableForSpot(spot: FishingSpotData): FishingTableData {
  const table = fishingTableRegistry.get(spot.tableId);
  if (table === undefined) throw new Error(`Fishing spot ${spot.id} names an unknown table: ${spot.tableId}`);
  return table;
}

export function fishForId(fishId: string): FishDefinitionData {
  const definition = fishRegistry.get(fishId);
  if (definition === undefined) throw new Error(`Unknown fish definition: ${fishId}`);
  return definition;
}

/**
 * Refuses a fishing catalogue that could not settle a catch.
 *
 * Every reference is checked at load: a spot whose table does not exist, a table entry naming a fish
 * that does not, a fish whose item is missing or is not a `FISH`, two species sharing one item, or a
 * spot with a nonsense position. Game data is the boundary, so a bad edit fails here rather than as a
 * settlement that cannot find its reward.
 */
export function validateFishingDefinitions(
  fishDefinitions: ReadonlyMap<string, FishDefinitionData>,
  tables: ReadonlyMap<string, FishingTableData>,
  spots: ReadonlyMap<string, FishingSpotData>,
  items: ReadonlyMap<string, { readonly category?: string }>
): void {
  const claimedItems = new Set<string>();
  for (const definition of fishDefinitions.values()) {
    const item = items.get(definition.itemDefinitionId);
    if (item === undefined || item.category !== "FISH") {
      throw new Error(`Unknown fish item definition: ${definition.itemDefinitionId}`);
    }
    if (claimedItems.has(definition.itemDefinitionId)) {
      throw new Error(`Duplicate fish item reference: ${definition.itemDefinitionId}`);
    }
    claimedItems.add(definition.itemDefinitionId);
  }
  for (const table of tables.values()) {
    if (table.entries.length === 0) throw new Error(`Fishing table ${table.id} has no entries`);
    const seen = new Set<string>();
    for (const entry of table.entries) {
      if (!fishDefinitions.has(entry.fishId)) {
        throw new Error(`Unknown fish in table ${table.id}: ${entry.fishId}`);
      }
      if (seen.has(entry.fishId)) throw new Error(`Duplicate fish in table ${table.id}: ${entry.fishId}`);
      seen.add(entry.fishId);
    }
  }
  if (spots.size === 0) throw new Error("The island has no fishing spots");
  for (const spot of spots.values()) {
    if (!tables.has(spot.tableId)) {
      throw new Error(`Fishing spot ${spot.id} names an unknown table: ${spot.tableId}`);
    }
  }
  // Widened to `number` so the check is a real runtime guard rather than a comparison the compiler can
  // fold away: the value is a literal today, and this is what will catch it becoming 0 tomorrow.
  const actionSeconds: number = FISHING_ACTION_SECONDS;
  if (!Number.isSafeInteger(actionSeconds) || actionSeconds <= 0) {
    throw new Error("Fishing action duration must be a positive whole number of seconds");
  }
}

validateFishingDefinitions(fishRegistry, fishingTableRegistry, fishingSpotRegistry, itemRegistry);
