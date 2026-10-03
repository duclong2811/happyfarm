/**
 * The five-element island economy, as comparative advantages rather than locks.
 *
 * Every island can farm, fish, mine, forest and keep animals: the multipliers below are *capacity*
 * multipliers on a shared baseline, and they are deliberately mild (0.6x-1.9x) so that choosing an
 * element changes what an island is best at, never what it is allowed to do. Specialisation pressure
 * is meant to come from geography, capacity and logistics, with numeric buffs secondary.
 */

export const ELEMENT_IDS = ["EARTH", "WATER", "WOOD", "METAL", "FIRE"] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

/** The professions an island can run, in the order the bible describes them. */
export const PROFESSIONS = ["FARMING", "FISHING", "MINING", "FORESTRY", "LIVESTOCK", "PROCESSING"] as const;
export type Profession = (typeof PROFESSIONS)[number];

export interface ElementProfile {
  readonly id: ElementId;
  readonly displayName: string;
  readonly identity: string;
  /** Capacity multipliers on the shared island baseline: 1.0 is an ordinary island. */
  readonly capacity: Readonly<Record<Profession, number>>;
}

export const ELEMENT_PROFILES: Readonly<Record<ElementId, ElementProfile>> = {
  EARTH: {
    id: "EARTH",
    displayName: "Earth",
    identity: "Agriculture: large flat land, strong crops, feed and provisions",
    capacity: { FARMING: 1.6, FISHING: 0.7, MINING: 0.6, FORESTRY: 0.8, LIVESTOCK: 1.2, PROCESSING: 0.9 }
  },
  WATER: {
    id: "WATER",
    displayName: "Water",
    identity: "Fishing and maritime: coastline, aquaculture, harbour and fleets",
    capacity: { FARMING: 0.7, FISHING: 1.9, MINING: 0.6, FORESTRY: 0.8, LIVESTOCK: 0.8, PROCESSING: 1.0 }
  },
  WOOD: {
    id: "WOOD",
    displayName: "Wood",
    identity: "Forestry: renewable timber, hardwood, resin, buildings and ships",
    capacity: { FARMING: 0.9, FISHING: 0.8, MINING: 0.7, FORESTRY: 1.9, LIVESTOCK: 0.9, PROCESSING: 1.0 }
  },
  METAL: {
    id: "METAL",
    displayName: "Metal",
    identity: "Extraction: mineral deposits and sustainable ore capacity",
    capacity: { FARMING: 0.7, FISHING: 0.7, MINING: 1.9, FORESTRY: 0.7, LIVESTOCK: 0.8, PROCESSING: 1.1 }
  },
  FIRE: {
    id: "FIRE",
    displayName: "Fire",
    identity: "Livestock and industry: eggs, milk, meat, hide and value-adding manufacture",
    capacity: { FARMING: 0.8, FISHING: 0.7, MINING: 0.6, FORESTRY: 0.7, LIVESTOCK: 1.8, PROCESSING: 1.8 }
  }
};

/**
 * What one Home Island can sustain, before any upgrade.
 *
 * The numbers are the *current* island's own counts (see `docs/economy/ECONOMY_BASELINE.md`), which is
 * what makes Scenario B comparable to Scenario A: the same farm, described as an Earth island with an
 * Earth multiplier, and as a Metal island with a Metal one.
 */
export interface IslandBaseline {
  /** Profitable actions per day at this profession, if it were the only thing the player did. */
  readonly farmTiles: number;
  readonly fishingSpots: number;
  readonly miningNodes: number;
  readonly forestryNodes: number;
  /** Livestock and processing do not exist yet; their capacity is a modelling assumption. */
  readonly livestockPens: number;
  readonly processingLanes: number;
}

export const HOME_ISLAND_BASELINE: IslandBaseline = {
  farmTiles: 144,
  fishingSpots: 4,
  miningNodes: 9,
  forestryNodes: 12,
  // Future systems. Chosen so a starting island can keep a few animals and run one workshop; the
  // numbers are assumptions to test, not content.
  livestockPens: 6,
  processingLanes: 1
};

export function islandCapacity(
  element: ElementId,
  baseline: IslandBaseline = HOME_ISLAND_BASELINE
): IslandBaseline {
  const profile = ELEMENT_PROFILES[element];
  const scale = (value: number, profession: Profession): number =>
    Math.max(1, Math.round(value * profile.capacity[profession]));
  return {
    farmTiles: scale(baseline.farmTiles, "FARMING"),
    fishingSpots: scale(baseline.fishingSpots, "FISHING"),
    miningNodes: scale(baseline.miningNodes, "MINING"),
    forestryNodes: scale(baseline.forestryNodes, "FORESTRY"),
    livestockPens: scale(baseline.livestockPens, "LIVESTOCK"),
    processingLanes: scale(baseline.processingLanes, "PROCESSING")
  };
}
