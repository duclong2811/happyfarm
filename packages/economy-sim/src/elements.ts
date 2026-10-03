/**
 * The five-element model, V16.1.1: **five resource specialisations**, plus a shared industrial system.
 *
 * The canonical mapping is now one profession per element and nothing else:
 *
 *   Earth  -> Agriculture        Water -> Fishing / Aquaculture
 *   Wood   -> Forestry           Metal -> Mining
 *   Fire   -> Livestock / Animal Husbandry
 *
 * Processing, refining, crafting, cooking, manufacturing, shipbuilding and every other value-added
 * activity are **shared economic systems** that any island can build. They are not an element, and no
 * element gets a throughput bonus for them. The brief that changed this is V16.1.1; before it, Fire was
 * modelled as a refining specialist, and that rule is removed here and in the docs.
 *
 * The element still belongs to the **Home Island**, never the player, and it remains a comparative
 * advantage rather than a lock: every island can run every resource profession. Geography (physical
 * capacity) is the primary differentiation; the efficiency modifier is a small second.
 */

export const ELEMENT_IDS = ["EARTH", "WATER", "WOOD", "METAL", "FIRE"] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

/** The five resource professions. One per element; every island can run all five. */
export const RESOURCE_PROFESSIONS = ["FARMING", "FISHING", "MINING", "FORESTRY", "LIVESTOCK"] as const;
export type ResourceProfession = (typeof RESOURCE_PROFESSIONS)[number];

/**
 * The capacity keys the engine tracks. The five resource professions above, plus the shared workshop
 * capacity ("PROCESSING"), which is a horizontal system rather than a profession.
 */
export const PROFESSIONS = [...RESOURCE_PROFESSIONS, "PROCESSING"] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** The resource capacities a Home Island's geography bounds. */
export interface ResourceCapacity {
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
}

/**
 * A developed Home Island's capacity: the five resource capacities plus the shared workshop lanes.
 * Workshop lanes are element-neutral (see `INDUSTRIAL_PROFILE`), so two islands of different elements
 * with the same investment run the same number of workshops.
 */
export interface IslandCapacity extends ResourceCapacity {
  /** Shared workshop/processing lanes. Element-neutral. */
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

/** The resource-only mapping, for indexing `ResourceCapacity` without the workshop lane. */
export const RESOURCE_CAPACITY_FIELD: Readonly<Record<ResourceProfession, keyof ResourceCapacity>> = {
  FARMING: "farmTiles",
  FISHING: "fishingSpots",
  MINING: "miningNodes",
  FORESTRY: "forestryNodes",
  LIVESTOCK: "livestockPens"
};

export interface ElementProfile {
  readonly id: ElementId;
  readonly displayName: string;
  readonly identity: string;
  /** The resource profession the island's geography favours. */
  readonly primaryProfession: ResourceProfession;
  /** The physical ceiling for the five resource professions. */
  readonly physicalMax: ResourceCapacity;
  /** A small modifier (0.90-1.15) on the *resource* professions. Industry has no modifier. */
  readonly efficiency: Readonly<Record<ResourceProfession, number>>;
}

/**
 * The five physical resource profiles.
 *
 * Each element has the highest ceiling in exactly one resource profession and usable (if lower)
 * ceilings in the rest. There is deliberately no processing lane here: V16.1.1 moved industry to a
 * shared, element-neutral track.
 */
export const ELEMENT_PROFILES: Readonly<Record<ElementId, ElementProfile>> = {
  EARTH: {
    id: "EARTH",
    displayName: "Earth",
    identity: "Agriculture: the widest fields, feed and staples",
    primaryProfession: "FARMING",
    physicalMax: { farmTiles: 160, fishingSpots: 4, miningNodes: 6, forestryNodes: 10, livestockPens: 8 },
    efficiency: { FARMING: 1.12, FISHING: 0.95, MINING: 0.9, FORESTRY: 0.95, LIVESTOCK: 1.0 }
  },
  WATER: {
    id: "WATER",
    displayName: "Water",
    identity: "Fishing and aquaculture: coastline, ponds and maritime protein",
    primaryProfession: "FISHING",
    physicalMax: { farmTiles: 80, fishingSpots: 12, miningNodes: 5, forestryNodes: 9, livestockPens: 9 },
    efficiency: { FARMING: 0.95, FISHING: 1.12, MINING: 0.95, FORESTRY: 0.95, LIVESTOCK: 0.95 }
  },
  WOOD: {
    id: "WOOD",
    displayName: "Wood",
    identity: "Forestry: renewable timber, hardwood and resin",
    primaryProfession: "FORESTRY",
    physicalMax: { farmTiles: 100, fishingSpots: 6, miningNodes: 7, forestryNodes: 20, livestockPens: 9 },
    efficiency: { FARMING: 0.98, FISHING: 0.95, MINING: 0.95, FORESTRY: 1.12, LIVESTOCK: 0.98 }
  },
  METAL: {
    id: "METAL",
    displayName: "Metal",
    identity: "Mining: mineral deposits, stone, coal, copper and iron",
    primaryProfession: "MINING",
    physicalMax: { farmTiles: 80, fishingSpots: 5, miningNodes: 18, forestryNodes: 10, livestockPens: 8 },
    efficiency: { FARMING: 0.95, FISHING: 0.95, MINING: 1.12, FORESTRY: 0.95, LIVESTOCK: 0.95 }
  },
  FIRE: {
    id: "FIRE",
    displayName: "Fire",
    identity: "Livestock and animal husbandry: eggs, milk, meat, hide and wool",
    primaryProfession: "LIVESTOCK",
    physicalMax: { farmTiles: 72, fishingSpots: 5, miningNodes: 6, forestryNodes: 12, livestockPens: 20 },
    efficiency: { FARMING: 1.0, FISHING: 0.95, MINING: 0.9, FORESTRY: 0.92, LIVESTOCK: 1.12 }
  }
};

/** How many development steps take a profession from its starter capacity to the physical ceiling. */
export const DEVELOPMENT_STEPS = 5;

/**
 * The shared industrial track. Every island starts with one workshop and can develop up to twelve,
 * whatever its element - the same ceiling, the same development cost, no bonus.
 */
export const INDUSTRIAL_PROFILE: { readonly starterLanes: number; readonly maxLanes: number } = {
  starterLanes: 1,
  maxLanes: 12
};

/**
 * Where a resource profession starts, as a fraction of the physical ceiling. The element's primary
 * profession starts a little further along (the settlers chose that ground first), never above 60%.
 */
export const STARTER_FRACTION: Readonly<Record<ResourceProfession, number>> = {
  FARMING: 0.25,
  FISHING: 0.3,
  MINING: 0.18,
  FORESTRY: 0.2,
  LIVESTOCK: 0.25
};

const PRIMARY_STARTER_BONUS = 1.4;
const MAX_STARTER_FRACTION = 0.6;

/** The developed capacity an island begins with, before any investment. */
export function starterCapacity(element: ElementId): IslandCapacity {
  const profile = ELEMENT_PROFILES[element];
  const scale = (profession: ResourceProfession): number => {
    const bonus = profession === profile.primaryProfession ? PRIMARY_STARTER_BONUS : 1;
    const fraction = Math.min(MAX_STARTER_FRACTION, STARTER_FRACTION[profession] * bonus);
    return Math.max(1, Math.round(profile.physicalMax[RESOURCE_CAPACITY_FIELD[profession]] * fraction));
  };
  return {
    farmTiles: scale("FARMING"),
    fishingSpots: scale("FISHING"),
    miningNodes: scale("MINING"),
    forestryNodes: scale("FORESTRY"),
    livestockPens: scale("LIVESTOCK"),
    processingLanes: INDUSTRIAL_PROFILE.starterLanes
  };
}

/** The physical ceiling. Workshop lanes come from the shared industrial profile, not the element. */
export function islandCapacity(element: ElementId): IslandCapacity {
  return { ...ELEMENT_PROFILES[element].physicalMax, processingLanes: INDUSTRIAL_PROFILE.maxLanes };
}

/**
 * Interpolate developed capacity between the starter and the ceiling.
 *
 * `tiers[profession]` is a development step in `[0, DEVELOPMENT_STEPS]`; the result never exceeds the
 * ceiling, whatever the caller passes, and never falls below the starter. The processing tier is
 * element-independent.
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

/**
 * The small efficiency modifier. Resource professions only; the shared workshop system has **no**
 * element modifier (1.0 for every element), which is the rule V16.1.1 locks in.
 */
export function efficiencyFor(element: ElementId, profession: Profession): number {
  if (profession === "PROCESSING") return 1;
  return Math.max(0.9, Math.min(1.15, ELEMENT_PROFILES[element].efficiency[profession]));
}
