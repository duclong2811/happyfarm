/**
 * The five-element island economy, modelled as **physical capacity first, numeric efficiency second**.
 *
 * V16.0 described an element as a bundle of production multipliers (0.6x-1.9x). That made every island
 * the same island with different stats, and the simulation showed the consequence: no element ever
 * needed a neighbour, because a better multiplier is not the same as *having more ground*. V16.1
 * replaces the multiplier table with a **physical island profile** - how many agricultural cells, how
 * much coastline, how many deposits, pens and workshops an island's geography can ever support - and
 * keeps only a small efficiency modifier (0.9x-1.15x) on top of it.
 *
 * The element belongs to the **Home Island**, not to the player. Every island can still run every
 * profession; the element decides how far a profession can be *developed*, never whether it is allowed.
 * There is no respec: an island's geography is what it is. See `docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md`.
 */

export const ELEMENT_IDS = ["EARTH", "WATER", "WOOD", "METAL", "FIRE"] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

/** The professions a Home Island can develop, in the order the economy bible describes them. */
export const PROFESSIONS = ["FARMING", "FISHING", "MINING", "FORESTRY", "LIVESTOCK", "PROCESSING"] as const;
export type Profession = (typeof PROFESSIONS)[number];

/**
 * A developed Home Island's capacity, in the unit each profession is bounded by: tiles, spots, nodes,
 * wild trees, pens and lanes. It is the *developed* capacity, so it grows with investment but can
 * never pass the physical ceiling (`ELEMENT_PROFILES[...].physicalMax`).
 */
export interface IslandCapacity {
  /** Farm tiles under cultivation. */
  readonly farmTiles: number;
  /** Fishable spots (coastline and pond). */
  readonly fishingSpots: number;
  /** Mineral deposits that may be worked. */
  readonly miningNodes: number;
  /** Forest trees that may be worked. */
  readonly forestryNodes: number;
  /** Livestock pens. */
  readonly livestockPens: number;
  /** Processing/workshop lanes. */
  readonly processingLanes: number;
}

/** Which capacity field is bounded by which profession. The one mapping; nothing re-guesses it. */
export const CAPACITY_FIELD: Readonly<Record<Profession, keyof IslandCapacity>> = {
  FARMING: "farmTiles",
  FISHING: "fishingSpots",
  MINING: "miningNodes",
  FORESTRY: "forestryNodes",
  LIVESTOCK: "livestockPens",
  PROCESSING: "processingLanes"
};

export interface ElementProfile {
  readonly id: ElementId;
  readonly displayName: string;
  readonly identity: string;
  /** The immediate profession the island's geography favours, used only as a modelling weight. */
  readonly primaryProfession: Profession;
  /** The physical ceiling: the most of each profession the island's ground, coast and rock can hold. */
  readonly physicalMax: IslandCapacity;
  /** A small modifier (0.9-1.15) on top of the physical profile. Geography does most of the work. */
  readonly efficiency: Readonly<Record<Profession, number>>;
}

/**
 * The five physical profiles.
 *
 * The numbers are model values, not map edits: nothing in `apps/` or `workers/` reads them. They are
 * calibrated so that (a) each element has a clear physical ceiling in one profession, (b) every element
 * has a real, if small, second best, and (c) Fire's extraction ceilings sit below the raw specialists'
 * so its industry has to be fed from elsewhere.
 */
export const ELEMENT_PROFILES: Readonly<Record<ElementId, ElementProfile>> = {
  EARTH: {
    id: "EARTH",
    displayName: "Earth",
    identity: "Agriculture: the widest fields, feed and staples",
    primaryProfession: "FARMING",
    physicalMax: { farmTiles: 160, fishingSpots: 4, miningNodes: 6, forestryNodes: 10, livestockPens: 12, processingLanes: 4 },
    efficiency: { FARMING: 1.12, FISHING: 0.95, MINING: 0.9, FORESTRY: 0.95, LIVESTOCK: 1.0, PROCESSING: 0.95 }
  },
  WATER: {
    id: "WATER",
    displayName: "Water",
    identity: "Fishing and maritime: coastline, aquaculture, harbour and fleets",
    primaryProfession: "FISHING",
    physicalMax: { farmTiles: 96, fishingSpots: 12, miningNodes: 5, forestryNodes: 9, livestockPens: 9, processingLanes: 5 },
    efficiency: { FARMING: 0.95, FISHING: 1.12, MINING: 0.95, FORESTRY: 0.95, LIVESTOCK: 0.95, PROCESSING: 0.98 }
  },
  WOOD: {
    id: "WOOD",
    displayName: "Wood",
    identity: "Forestry: renewable timber, hardwood, resin, buildings and ships",
    primaryProfession: "FORESTRY",
    physicalMax: { farmTiles: 120, fishingSpots: 6, miningNodes: 7, forestryNodes: 20, livestockPens: 10, processingLanes: 7 },
    efficiency: { FARMING: 0.98, FISHING: 0.95, MINING: 0.95, FORESTRY: 1.12, LIVESTOCK: 0.98, PROCESSING: 1.05 }
  },
  METAL: {
    id: "METAL",
    displayName: "Metal",
    identity: "Extraction: mineral deposits, stone, coal and ore",
    primaryProfession: "MINING",
    physicalMax: { farmTiles: 96, fishingSpots: 5, miningNodes: 18, forestryNodes: 10, livestockPens: 8, processingLanes: 9 },
    efficiency: { FARMING: 0.95, FISHING: 0.95, MINING: 1.12, FORESTRY: 0.95, LIVESTOCK: 0.95, PROCESSING: 1.06 }
  },
  FIRE: {
    id: "FIRE",
    displayName: "Fire",
    identity: "Livestock and industry: pens first, refining and manufacture at scale",
    primaryProfession: "LIVESTOCK",
    // Fire's raw extraction ceilings are deliberately ordinary: 6 deposits against Metal's 24, 12
    // trees against Wood's 26. Its industry (18 lanes) is the largest, and it cannot feed that from
    // its own ground.
    physicalMax: { farmTiles: 72, fishingSpots: 5, miningNodes: 6, forestryNodes: 12, livestockPens: 20, processingLanes: 14 },
    efficiency: { FARMING: 1.0, FISHING: 0.95, MINING: 0.9, FORESTRY: 0.92, LIVESTOCK: 1.1, PROCESSING: 1.15 }
  }
};

/** How many development steps take a profession from its starter capacity to the physical ceiling. */
export const DEVELOPMENT_STEPS = 5;

/**
 * Where a profession starts, as a fraction of the physical ceiling.
 *
 * A player does not begin with the island developed to its maximum: a Metal island begins with a
 * handful of deposits and has to clear and open the rest. The element's primary profession starts a
 * little further along (the settlers chose that ground first), never above 60%.
 */
export const STARTER_FRACTION: Readonly<Record<Profession, number>> = {
  FARMING: 0.25,
  FISHING: 0.3,
  MINING: 0.18,
  FORESTRY: 0.2,
  LIVESTOCK: 0.25,
  PROCESSING: 0.15
};

const PRIMARY_STARTER_BONUS = 1.4;
const MAX_STARTER_FRACTION = 0.6;

/** The developed capacity an island begins with, before any investment. */
export function starterCapacity(element: ElementId): IslandCapacity {
  const profile = ELEMENT_PROFILES[element];
  const scale = (profession: Profession): number => {
    const bonus = profession === profile.primaryProfession ? PRIMARY_STARTER_BONUS : 1;
    const fraction = Math.min(MAX_STARTER_FRACTION, STARTER_FRACTION[profession] * bonus);
    return Math.max(1, Math.round(profile.physicalMax[CAPACITY_FIELD[profession]] * fraction));
  };
  return {
    farmTiles: scale("FARMING"),
    fishingSpots: scale("FISHING"),
    miningNodes: scale("MINING"),
    forestryNodes: scale("FORESTRY"),
    livestockPens: scale("LIVESTOCK"),
    processingLanes: scale("PROCESSING")
  };
}

/** The physical ceiling. Kept under the V16.0 name so callers read "the island's full capacity". */
export function islandCapacity(element: ElementId): IslandCapacity {
  return ELEMENT_PROFILES[element].physicalMax;
}

/**
 * Interpolate developed capacity between the starter and the physical ceiling.
 *
 * `tiers[profession]` is a development step in `[0, DEVELOPMENT_STEPS]`; the result never exceeds the
 * physical ceiling, whatever the caller passes, and never falls below the starter.
 */
export function developedCapacity(
  element: ElementId,
  tiers: Readonly<Record<Profession, number>>
): IslandCapacity {
  const starter = starterCapacity(element);
  const ceiling = islandCapacity(element);
  const at = (profession: Profession): number => {
    const field = CAPACITY_FIELD[profession];
    const step = Math.max(0, Math.min(DEVELOPMENT_STEPS, Math.round(tiers[profession])));
    const from = starter[field];
    const to = ceiling[field];
    return Math.max(1, Math.round(from + ((to - from) * step) / DEVELOPMENT_STEPS));
  };
  return {
    farmTiles: at("FARMING"),
    fishingSpots: at("FISHING"),
    miningNodes: at("MINING"),
    forestryNodes: at("FORESTRY"),
    livestockPens: at("LIVESTOCK"),
    processingLanes: at("PROCESSING")
  };
}

/** The small efficiency modifier, clamped so a data edit can never turn it into a dominant buff. */
export function efficiencyFor(element: ElementId, profession: Profession): number {
  return Math.max(0.9, Math.min(1.15, ELEMENT_PROFILES[element].efficiency[profession]));
}
