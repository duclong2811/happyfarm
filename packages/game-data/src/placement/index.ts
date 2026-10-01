import { z } from "zod";
import { roadTiers, ROAD_TIERS, type RoadTierId } from "../roads";

/**
 * The build catalogue: what a player can *place* on land they own.
 *
 * This is deliberately not the market. The market (`shops`) has one structural rule - gold buys seeds
 * and produce only ever sells - and a placeable object is neither: it is not inventory, it is a
 * footprint on a cell, bought once and then standing there. Mixing the two would have meant loosening
 * the market's rule to let it sell a fence, which is exactly the kind of contract change the V12
 * recovery is not allowed to make.
 *
 * So the shape is separate, and it is the shape the new direction needs: an entry names the
 * **capability** it needs (`CellCapability`, the same vocabulary the player-built island uses), the
 * ground it takes, the level it unlocks at, and what it costs. Where it goes is decided by the player
 * and checked against the cell, not here.
 *
 * Only the roads are populated today. The rest of the vocabulary is declared because a catalogue that
 * cannot name a category is a catalogue somebody will extend by hand somewhere else - and the point of
 * this file is that there *is* one place.
 */

/**
 * The land-use capabilities a placed object can require.
 *
 * The same words the island's cells use. A cell that cannot do a thing cannot hold a thing that needs
 * it, and that is the whole placement rule - no district, no fixed production area, no authored zone.
 * `WALK` is the odd one: a capability that *grants* movement rather than requiring it, which is what a
 * road is, and it is why a road can be placed on ground nothing else may use.
 */
export const PLACEMENT_CAPABILITIES = [
  "FARM",
  "FORESTRY",
  "AQUACULTURE",
  "LIVESTOCK",
  "ROAD",
  "BUILD",
  "DECORATION",
  "DOCK",
  "WALK"
] as const;
export type PlacementCapability = (typeof PLACEMENT_CAPABILITIES)[number];

/**
 * The shop's categories.
 *
 * `WORKERS`, `VEHICLES`, `LIVESTOCK` and `PROCESSING` are named and empty: they are the sections a
 * later pass fills, and naming them now is how this list stays the only one.
 */
export const PLACEMENT_CATEGORIES = [
  "ROADS",
  "FENCES",
  "FARMING",
  "FORESTRY",
  "AQUACULTURE",
  "BUILDINGS",
  "STORAGE",
  "DECORATIONS",
  "NATURE",
  "UTILITY",
  "MONUMENTS",
  "WORKERS",
  "VEHICLES",
  "LIVESTOCK",
  "PROCESSING"
] as const;
export type PlacementCategory = (typeof PLACEMENT_CATEGORIES)[number];

/** How much ground a placed object takes, in whole cells. Never a fractional or a negative footprint. */
export const FootprintSchema = z
  .object({
    widthCells: z.number().int().positive().max(64),
    depthCells: z.number().int().positive().max(64)
  })
  .strict();

export const PlacementCatalogEntrySchema = z
  .object({
    id: z.string().regex(/^place_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    category: z.enum(PLACEMENT_CATEGORIES),
    /** A dotted translation key. It may point at another catalogue's key rather than restating one. */
    displayNameKey: z.string().regex(/^[a-z][a-z0-9_.]*\.name$/),
    /** 1-based: level 1 is what a new farm can already build. */
    unlockLevel: z.number().int().min(1).max(1_000),
    price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /** The asset the renderer resolves. Null means the entry is not drawable yet. */
    modelId: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/).nullable(),
    footprint: FootprintSchema,
    /** The land the entry needs. The cell decides whether it is there. */
    capability: z.enum(PLACEMENT_CAPABILITIES),
    /** A tier within the entry's own ladder, when it has one. */
    tier: z.enum(ROAD_TIERS).nullable(),
    /** The group an upgrade replaces within, or null when the entry does not upgrade. */
    upgradeGroup: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
    /** The road tier this entry builds, when it is a road. */
    roadTierId: z.enum(ROAD_TIERS).nullable()
  })
  .strict();

export type PlacementCatalogEntryData = z.infer<typeof PlacementCatalogEntrySchema>;

/**
 * The catalogue, validated as a whole.
 *
 * The cross-checks are the point of building it here rather than as a list of object literals:
 * two entries may not share an id, a road entry must name a road tier that exists, a non-road entry
 * may not name one, and an entry that upgrades must say which group it upgrades within.
 */
export function createPlacementCatalog(input: unknown): ReadonlyMap<string, PlacementCatalogEntryData> {
  const entries = z.array(PlacementCatalogEntrySchema).parse(input);
  const catalog = new Map<string, PlacementCatalogEntryData>();
  for (const entry of entries) {
    if (catalog.has(entry.id)) throw new Error(`Duplicate placement entry: ${entry.id}`);
    if (entry.roadTierId !== null && !roadTiers.has(entry.roadTierId)) {
      throw new Error(`Unknown road tier on ${entry.id}: ${entry.roadTierId}`);
    }
    if (entry.category === "ROADS" && entry.roadTierId === null) {
      throw new Error(`A road entry must name its road tier: ${entry.id}`);
    }
    if (entry.category !== "ROADS" && entry.roadTierId !== null) {
      throw new Error(`Only a road entry may name a road tier: ${entry.id}`);
    }
    if (entry.upgradeGroup !== null && entry.tier === null) {
      throw new Error(`An entry that upgrades must carry a tier: ${entry.id}`);
    }
    catalog.set(entry.id, entry);
  }
  // Every road tier has exactly one entry. A tier a player cannot buy is a tier that does not exist.
  for (const tierId of ROAD_TIERS) {
    const matching = entries.filter((entry) => entry.roadTierId === tierId);
    if (matching.length !== 1) {
      throw new Error(`Road tier ${tierId} must have exactly one catalog entry, found ${String(matching.length)}`);
    }
  }
  return catalog;
}

/**
 * The ship list: the four road tiers, and nothing else yet.
 *
 * The price is the tier table's own price, so the two cannot drift: this file never restates what a
 * road costs, it points at the one place that decides.
 */
export const placementCatalog = createPlacementCatalog(
  ROAD_TIERS.map((tierId: RoadTierId) => {
    const tier = roadTiers.get(tierId);
    if (tier === undefined) throw new Error(`Missing road tier: ${tierId}`);
    return {
      id: `place_road_${tier.surface.toLowerCase()}`,
      category: "ROADS" as const,
      displayNameKey: tier.displayNameKey,
      unlockLevel: tier.rank,
      price: tier.pricePerTile,
      currencyDefinitionId: "currency_gold",
      modelId: `road.${tier.surface.toLowerCase()}`,
      footprint: { widthCells: 1, depthCells: 1 },
      capability: "ROAD" as const,
      tier: tierId,
      upgradeGroup: tier.upgradeGroup,
      roadTierId: tierId
    };
  })
);

/** Every entry, in a stable order, for the client and for tests. */
export const placementEntries = [...placementCatalog.values()];
