import { z } from "zod";
import { ROAD_SEGMENT_CELLS, ROAD_TIERS, PROVISIONAL_ROAD_PRICES, roadTiers, type RoadTierId } from "../roads";

/**
 * The build catalogue: what a player can *place* on land they own.
 *
 * This is deliberately not the market. The market (`shops`) has one structural rule - gold buys seeds
 * and produce only ever sells - and a placeable object is neither: it is not inventory, it is a
 * footprint on a cell, bought once and then standing there. Mixing the two would have meant loosening
 * the market's rule to let it sell a fence.
 *
 * The shape is the one the player-built island needs: an entry names the **capability** it needs (the
 * same vocabulary `CellCapability` uses on the client), the ground it takes, the level it unlocks at,
 * what it costs, and - where it has one - the entry it upgrades into.
 *
 * Only the road tiers are populated today. Every other category is declared and empty, because a
 * catalogue that cannot *name* a category is a catalogue somebody extends by hand somewhere else.
 */

/**
 * The land-use capabilities a placed object can require.
 *
 * The same words the island's cells use. A cell that cannot do a thing cannot hold a thing that needs
 * it, and that is the whole placement rule - no district, no fixed production area, no authored zone.
 * `WALK` is the odd one: a capability a road *grants* rather than one it requires.
 */
export const PLACEMENT_CAPABILITIES = [
  "WALK",
  "BUILD",
  "FARM",
  "FORESTRY",
  "LIVESTOCK",
  "ROAD",
  "DECORATION",
  "AQUACULTURE",
  "DOCK",
  "MINING"
] as const;
export type PlacementCapability = (typeof PLACEMENT_CAPABILITIES)[number];

/**
 * The shop's categories.
 *
 * `WATERFRONT` is the quay, the jetty and the moorings; `UTILITY` is what makes the island work
 * rather than pretty; `MONUMENT` is what a player builds when they have more money than land. The
 * working systems a later pass adds - workers, vehicles, livestock as a *system* rather than as a pen -
 * are not shop categories and do not belong here.
 */
export const PLACEMENT_CATEGORIES = [
  "ROAD",
  "BUILDING",
  "DECORATION",
  "VEGETATION",
  "UTILITY",
  "MONUMENT",
  "FENCE",
  "LIGHTING",
  "WATERFRONT"
] as const;
export type PlacementCategory = (typeof PLACEMENT_CATEGORIES)[number];

/** How much ground a placed object takes, in whole cells. Never fractional, never negative. */
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
    /** 1-based: level 1 is what a new island can already build. */
    requiredLevel: z.number().int().min(1).max(1_000),
    price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    /**
     * The model the renderer resolves, or null while the entry draws as a placeholder.
     *
     * A dotted id (`road.dirt`) rather than a file: no catalogue entry names a `.glb`, and the client
     * is the one place a model is resolved.
     */
    modelId: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/).nullable(),
    footprint: FootprintSchema,
    /** The land the entry needs. The cell decides whether it is there. */
    capability: z.enum(PLACEMENT_CAPABILITIES),
    /** A tier within the entry's own ladder, when it has one. */
    tier: z.enum(ROAD_TIERS).nullable(),
    /** The entry this one replaces when it is upgraded, or null at the top of its ladder. */
    upgradeTo: z.string().regex(/^place_[a-z0-9]+(?:_[a-z0-9]+)*$/).nullable(),
    /** Whether the player may turn it: a road runs along a cell edge, a monument does not. */
    rotatable: z.boolean(),
    /** Decoration is placed for how it looks; everything else is placed for what it does. */
    decorative: z.boolean()
  })
  .strict();

export type PlacementCatalogEntryData = z.infer<typeof PlacementCatalogEntrySchema>;

/**
 * The visuals the renderer draws itself rather than loading from a file.
 *
 * A road is a ribbon the client builds from the terrain, so it has no `.glb` and never will; naming
 * one keeps the catalogue's rule intact - "a modelId is something that resolves" - without pretending
 * a road is an imported asset.
 */
export const PROCEDURAL_MODEL_IDS = ["road.dirt", "road.gravel", "road.stone", "road.paved"] as const;

/**
 * The catalogue, validated as a whole.
 *
 * The cross-checks are why this is a builder rather than a list of literals: two entries may not share
 * an id, a road entry must name a road tier that exists (and a non-road entry may not), every road tier
 * has exactly one entry, and an upgrade target must name an entry that exists. A dangling upgrade is a
 * purchase the player can see and cannot make.
 */
export function createPlacementCatalog(
  input: unknown,
  options: { readonly assetIds?: ReadonlySet<string> } = {}
): ReadonlyMap<string, PlacementCatalogEntryData> {
  const entries = z.array(PlacementCatalogEntrySchema).parse(input);
  const knownVisuals = new Set<string>([...PROCEDURAL_MODEL_IDS, ...(options.assetIds ?? [])]);
  const catalog = new Map<string, PlacementCatalogEntryData>();
  for (const entry of entries) {
    if (catalog.has(entry.id)) throw new Error(`Duplicate placement entry: ${entry.id}`);
    if (entry.modelId !== null && !knownVisuals.has(entry.modelId)) {
      throw new Error(`${entry.id} names a visual nothing can draw: ${entry.modelId}`);
    }
    catalog.set(entry.id, entry);
  }
  for (const entry of catalog.values()) {
    if (entry.category === "ROAD" && entry.tier === null) {
      throw new Error(`A road entry must name its road tier: ${entry.id}`);
    }
    if (entry.category !== "ROAD" && entry.tier !== null) {
      throw new Error(`Only a road entry may name a road tier: ${entry.id}`);
    }
    if (entry.upgradeTo !== null && !catalog.has(entry.upgradeTo)) {
      throw new Error(`${entry.id} upgrades into ${entry.upgradeTo}, which does not exist`);
    }
    if (entry.upgradeTo === entry.id) throw new Error(`${entry.id} upgrades into itself`);
  }
  for (const tierId of ROAD_TIERS) {
    const matching = entries.filter((entry) => entry.tier === tierId);
    if (matching.length !== 1) {
      throw new Error(`Road tier ${tierId} must have exactly one catalog entry, found ${String(matching.length)}`);
    }
  }
  // No upgrade chain may loop: a two-entry cycle would let a player "upgrade" between two objects for
  // ever, and the check is cheap enough to do once at load.
  for (const entry of catalog.values()) {
    const seen = new Set<string>([entry.id]);
    let current = entry.upgradeTo;
    while (current !== null) {
      if (seen.has(current)) throw new Error(`The upgrade chain cycles at ${current}`);
      seen.add(current);
      current = catalog.get(current)?.upgradeTo ?? null;
    }
  }
  return catalog;
}

/** The road entries, built from the tier table so a price can never be restated. */
function roadEntries(): PlacementCatalogEntryData[] {
  return ROAD_TIERS.map((tierId: RoadTierId) => {
    const tier = roadTiers.get(tierId);
    if (tier === undefined) throw new Error(`Missing road tier: ${tierId}`);
    const upgradeTarget = tier.upgradeTo;
    const next = upgradeTarget === null ? undefined : roadTiers.get(upgradeTarget);
    return {
      id: `place_road_${tier.surface.toLowerCase()}`,
      category: "ROAD" as const,
      displayNameKey: tier.displayNameKey,
      requiredLevel: tier.rank,
      price: tier.pricePerSegment,
      currencyDefinitionId: "currency_gold",
      modelId: `road.${tier.surface.toLowerCase()}`,
      // A segment is one cell wide and four long, laid along the row the player is standing on.
      footprint: { widthCells: 1, depthCells: ROAD_SEGMENT_CELLS },
      capability: "ROAD" as const,
      tier: tierId,
      upgradeTo: next === undefined ? null : `place_road_${next.surface.toLowerCase()}`,
      rotatable: true,
      decorative: false
    };
  });
}

/** The ship list: the four road segments, and nothing else yet. */
export const placementCatalog = createPlacementCatalog(roadEntries());

/** Every entry, in a stable order, for the client and for tests. */
export const placementEntries = [...placementCatalog.values()];

/** The provisional prices, re-exported so a caller has one import for "what a road costs". */
export { PROVISIONAL_ROAD_PRICES };
