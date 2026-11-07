import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import { ROAD_PREVIEW_STYLES, type ThumbnailRequest } from "../render/thumbnail-spec";

/**
 * The build shop's decisions, as pure functions.
 *
 * The shop is presentation: it may *describe* what the catalogue says, and it may not decide any of
 * it. So this module knows three things and nothing else - which category an entry belongs to, whether
 * the player could place it, and how a name or a description is found. Prices, levels, footprints,
 * capabilities and unlock rules stay in the DTO they arrived in.
 *
 * Everything here is plain data in, plain data out, so the shop's behaviour can be tested without a
 * DOM, a canvas, or a running game.
 */

export type ShopCategory = BuildCatalogEntryDTO["category"];

/**
 * Why a catalogue entry can or cannot be placed right now.
 *
 * `PREVIEW_ONLY` is the honest state for a tier the island can *draw* but not build: gravel and paved
 * have a thumbnail and no runtime surface, so the shop shows them and refuses to place them rather
 * than selling a picture.
 */
export type EntryAvailability = "AVAILABLE" | "LOCKED" | "PREVIEW_ONLY";

/** The browsing filter. Deliberately three options and no query engine. */
export type AvailabilityFilter = "ALL" | "AVAILABLE" | "LOCKED";

/**
 * The order a player reads the rail in: infrastructure first, then what grows, then what stands.
 *
 * A category with no entry never reaches the rail, so `MONUMENT` is simply absent until something is
 * shipped for it.
 */
export const SHOP_CATEGORY_ORDER: readonly ShopCategory[] = [
  "ROAD",
  "BUILDING",
  "VEGETATION",
  "DECORATION",
  "FENCE",
  "LIGHTING",
  "UTILITY",
  "WATERFRONT",
  "AQUACULTURE",
  "MONUMENT"
];

/** The categories the catalogue actually fills, in reading order. */
export function shopCategories(catalog: readonly BuildCatalogEntryDTO[]): readonly ShopCategory[] {
  return SHOP_CATEGORY_ORDER.filter((category) => catalog.some((entry) => entry.category === category));
}

/**
 * Whether this entry can be placed, is still locked, or is a preview of a tier that does not exist yet.
 *
 * Level first: a locked preview-only road is locked, because "you cannot place this yet" is the more
 * useful truth for a player at level one.
 */
export function entryAvailability(entry: BuildCatalogEntryDTO, playerLevel: number): EntryAvailability {
  if (playerLevel < entry.requiredLevel) return "LOCKED";
  return isPreviewOnly(entry) ? "PREVIEW_ONLY" : "AVAILABLE";
}

/**
 * Whether the entry's picture is a promise the island cannot keep yet.
 *
 * The flag lives with the road preview styles the thumbnail and the ghost draw from, so the badge, the
 * disabled button and the picture can never disagree.
 */
export function isPreviewOnly(entry: BuildCatalogEntryDTO): boolean {
  if (entry.category !== "ROAD" || entry.tier === null) return false;
  return ROAD_PREVIEW_STYLES[entry.tier as keyof typeof ROAD_PREVIEW_STYLES].provisional;
}

/**
 * Descriptions the catalogue does not carry, keyed by the stable entry id.
 *
 * Presentation only: a description explains what a thing is *for* and never restates a price, a level
 * or a rule. Entries whose catalogue entry already names a description key keep that one.
 */
const DESCRIPTION_KEYS: Readonly<Record<string, string>> = {
  place_tree_broad: "place.tree_broad.description",
  place_tree_pine: "place.tree_pine.description",
  place_bush_leafy: "place.bush_leafy.description",
  place_bush_flowering: "place.bush_flowering.description",
  place_flower_group: "place.flower_group.description",
  place_plant_clover: "place.plant_clover.description",
  place_plant_fern: "place.plant_fern.description",
  place_plant_grass: "place.plant_grass.description",
  place_rock_small: "place.rock_small.description",
  place_rock_large: "place.rock_large.description",
  place_fence_rail: "place.fence_rail.description",
  place_fence_rail_long: "place.fence_rail_long.description",
  place_barrel: "place.barrel.description",
  place_crate: "place.crate.description",
  place_sack: "place.sack.description",
  place_planter: "place.planter.description",
  place_bench: "place.bench.description",
  place_wagon: "place.wagon.description",
  place_stall: "place.stall.description",
  place_well: "place.well.description",
  place_lantern: "place.lantern.description",
  place_workbench: "place.workbench.description",
  place_fish_cage: "place.fish_cage.description",
  place_open_barn: "place.open_barn.description",
  place_silo: "place.silo.description",
  place_silo_house: "place.silo_house.description",
  place_windmill: "place.windmill.description"
};

/** The description key for an entry: the catalogue's own, else the presentation mapping. */
export function descriptionKeyFor(entry: BuildCatalogEntryDTO): string | null {
  return entry.descriptionKey ?? DESCRIPTION_KEYS[entry.entryId] ?? null;
}

/** Trims a search box's value the way the filter compares it. */
export function normaliseQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/**
 * The entries of one category that pass the search box and the availability filter.
 *
 * `nameOf` is the localised name, passed in rather than computed here: the shop's wording belongs to
 * the translation layer, and a search that filtered on ids would be searching the wrong thing.
 */
export function visibleEntries(
  catalog: readonly BuildCatalogEntryDTO[],
  options: {
    readonly category: ShopCategory;
    readonly query: string;
    readonly filter: AvailabilityFilter;
    readonly playerLevel: number;
    readonly nameOf: (entry: BuildCatalogEntryDTO) => string;
  }
): readonly BuildCatalogEntryDTO[] {
  const needle = normaliseQuery(options.query);
  return catalog.filter((entry) => {
    if (entry.category !== options.category) return false;
    if (needle.length > 0 && !normaliseQuery(options.nameOf(entry)).includes(needle)) return false;
    const availability = entryAvailability(entry, options.playerLevel);
    if (options.filter === "AVAILABLE") return availability === "AVAILABLE";
    if (options.filter === "LOCKED") return availability === "LOCKED";
    return true;
  });
}

/** How many quarter turns of rotation are in force, always 0-3. */
export function normaliseQuarterTurns(turns: number): 0 | 1 | 2 | 3 {
  const wrapped = ((turns % 4) + 4) % 4;
  return wrapped as 0 | 1 | 2 | 3;
}

/**
 * The footprint a rotated item actually occupies.
 *
 * A quarter turn swaps the two axes, which is the whole reason a 2x3 barn becomes a 3x2 one when it
 * faces the other way - and the reason the preview may not simply keep drawing the catalogue's numbers.
 */
export function rotatedFootprint(
  footprint: { readonly widthCells: number; readonly depthCells: number },
  quarterTurns: number
): { readonly widthCells: number; readonly depthCells: number } {
  const turns = normaliseQuarterTurns(quarterTurns);
  return turns % 2 === 0
    ? { widthCells: footprint.widthCells, depthCells: footprint.depthCells }
    : { widthCells: footprint.depthCells, depthCells: footprint.widthCells };
}

/** The yaw, in radians, that a given number of quarter turns means. */
export function quarterTurnYaw(quarterTurns: number): number {
  return (normaliseQuarterTurns(quarterTurns) * Math.PI) / 2;
}

/** Whether an entry may be turned at all. */
export function isRotatable(entry: BuildCatalogEntryDTO): boolean {
  return entry.rotatable;
}

/**
 * Which category to show: the one that was showing if it still has entries, else the first one that does.
 *
 * Called after the catalogue arrives, so a rail never points at a category the server stopped shipping.
 */
export function resolveCategory(
  catalog: readonly BuildCatalogEntryDTO[],
  preferred: ShopCategory
): ShopCategory | null {
  const categories = shopCategories(catalog);
  if (categories.includes(preferred)) return preferred;
  return categories[0] ?? null;
}

/** The category an entry belongs to, for a status line that has to name it. */
export function categoryOf(entry: BuildCatalogEntryDTO): ShopCategory {
  return entry.category;
}

/** Road visuals are drawn by the client rather than loaded, so they are not GLB ids. */
export function isProceduralVisual(modelId: string): boolean {
  return modelId.startsWith("road.");
}

/**
 * What to ask the thumbnail renderer for, for one catalogue entry.
 *
 * Both the card and the inspector ask this question, and the answer is the same string every time, so
 * the renderer's cache serves the second ask - which is also why the inspector can never cost a second
 * render of a model the grid already drew.
 */
export function thumbnailRequestFor(entry: BuildCatalogEntryDTO): ThumbnailRequest {
  return {
    modelId: entry.modelId !== null && !isProceduralVisual(entry.modelId) ? entry.modelId : null,
    roadTierId: entry.category === "ROAD" ? entry.tier : null
  };
}
