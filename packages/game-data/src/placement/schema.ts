import { z } from "zod";
import { ROAD_TIERS } from "../roads";

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
 * The ground a placed object can stand on.
 *
 * This is the whole of an asset's placement requirement, and it is *physical*: land, beach, the
 * shallows a moored thing needs, open water. It is deliberately not a land-use district - nothing
 * says "a farm district", "a forestry district" or "a building district", because the player decides
 * what their own land becomes. A normal owned cell carries every ordinary asset; what differs
 * between two assets here is whether they need dry ground or water.
 */
export const PLACEMENT_GROUNDS = ["LAND", "SHORE", "SHALLOW_WATER", "WATER"] as const;
export type PlacementGround = (typeof PLACEMENT_GROUNDS)[number];

/**
 * The shop's categories.
 *
 * `WATERFRONT` is the quay, the jetty and the moorings; `AQUACULTURE` is the working shallow-water
 * construction family; `UTILITY` is what makes the island work
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
  "WATERFRONT",
  "AQUACULTURE"
] as const;
export type PlacementCategory = (typeof PLACEMENT_CATEGORIES)[number];

/** How much ground a placed object takes, in whole cells. Never fractional, never negative. */
export const FootprintSchema = z
  .object({
    widthCells: z.number().int().positive().max(64),
    depthCells: z.number().int().positive().max(64)
  })
  .strict();

/**
 * When an entry may be placed at all, beyond its level and its price.
 *
 * `OWNED_LAND` is the ordinary case: a thing a player buys goes on land the player has. `NONE` is for
 * the handful of entries the island itself would place (none today), and exists so "always available"
 * is a decision rather than a missing field.
 */
export const PLACEMENT_UNLOCK_CONDITIONS = ["NONE", "OWNED_LAND"] as const;
export type PlacementUnlockCondition = (typeof PLACEMENT_UNLOCK_CONDITIONS)[number];

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
     * An id (`road.dirt`, `tree_broad_2`, `farm.barn.t1`) rather than a file: no catalogue entry names
     * a `.glb`, and the client is the one place a model is resolved. Both of the project's naming
     * styles are allowed - dotted for the curated sets, underscored for the generated ones - because
     * the catalogue's job is to name what ships, not to rename it.
     */
    modelId: z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/).nullable(),
    footprint: FootprintSchema,
    /**
     * The ground the entry needs, and the whole of its land requirement.
     *
     * An ordinary structure, planting or decoration asks for `LAND`; a moored asset asks for
     * `SHALLOW_WATER`; a future dock asks for `SHORE`. The cell answers with what it physically is,
     * and nothing else about the land is consulted.
     */
    allowedTerrain: z.array(z.enum(PLACEMENT_GROUNDS)).min(1).max(PLACEMENT_GROUNDS.length),
    /** A tier within the entry's own ladder, when it has one. */
    tier: z.enum(ROAD_TIERS).nullable(),
    /** The entry this one replaces when it is upgraded, or null at the top of its ladder. */
    upgradeTo: z.string().regex(/^place_[a-z0-9]+(?:_[a-z0-9]+)*$/).nullable(),
    /** Whether the player may turn it: a road runs along a cell edge, a monument does not. */
    rotatable: z.boolean(),
    /** Whether the player may pick it up and place it somewhere else, for free. */
    movable: z.boolean(),
    /** Whether the player may put it into storage instead of destroying it. */
    storable: z.boolean(),
    /** Whether the player may remove it. */
    removable: z.boolean(),
    /**
     * The share of the price a removal returns, 0..1.
     *
     * Per entry rather than one global constant, because the honest answer differs: a stack of planks
     * comes back as half a barn, a road's gravel is partly recoverable, and pulling up a planting
     * returns nothing at all. The value here is a *provisional* balance number - see
     * `REMOVAL_REFUND_POLICY` in the catalogue - and the architecture is what must outlive it.
     */
    removalRefundRate: z.number().min(0).max(1),
    /** Decoration is placed for how it looks; everything else is placed for what it does. */
    decorative: z.boolean(),
    /**
     * Free-form grouping labels - "planting", "storage", "roadside", "civic".
     *
     * Tags are how a later shop filters and how a designer finds things; they are never a rule, and
     * nothing branches on them.
     */
    tags: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(8),
    /** A longer description for the shop row, or null when the label is enough. */
    descriptionKey: z.string().regex(/^[a-z][a-z0-9_.]*\.description$/).nullable(),
    /** What has to be true of the world before the entry may be placed. */
    unlockCondition: z.enum(PLACEMENT_UNLOCK_CONDITIONS)
  })
  .strict();

export type PlacementCatalogEntryData = z.infer<typeof PlacementCatalogEntrySchema>;

/**
 * A readable default label for an entry, derived from its translation key.
 *
 * `place.tree_broad.name` becomes "Tree broad". The client translates the key when it has a
 * translation and falls back to this when it does not, which is what lets a catalogue entry be added
 * on the server and still read sensibly in a client that has never heard of it - the same reason the
 * road tiers carry a `label` beside their `displayNameKey`.
 */
export function catalogueLabel(entry: { readonly displayNameKey: string }): string {
  const parts = entry.displayNameKey.split(".");
  const subject = parts.length >= 2 ? parts[parts.length - 2] : entry.displayNameKey;
  const words = (subject ?? entry.displayNameKey).split("_").filter((word) => word.length > 0);
  if (words.length === 0) return entry.displayNameKey;
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

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
  // An upgrade may not be *available* before the thing it upgrades: a chain whose tiers unlock out of
  // order is a shop that offers a stone road to a player who cannot build a dirt one.
  for (const entry of catalog.values()) {
    const next = entry.upgradeTo === null ? undefined : catalog.get(entry.upgradeTo);
    if (next !== undefined && next.requiredLevel < entry.requiredLevel) {
      throw new Error(`${next.id} unlocks before the ${entry.id} it upgrades from`);
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
