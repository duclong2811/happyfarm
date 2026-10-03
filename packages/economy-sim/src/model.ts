import type { EconomyBaseline, ResourceBaseline } from "./baseline";
import { ELEMENT_PROFILES, islandCapacity, type ElementId, type IslandBaseline } from "./elements";

/**
 * The model: every number the simulation moves, in one place.
 *
 * The rule the phase sets is that balance constants never live in the simulation logic, so this file is
 * the *only* place a future number is written down. Everything is provisional - the whole point of
 * V16.0 is to expose structure, not to fix prices - and the docs label it so.
 */

export interface ProfessionRates {
  /** Gold for one completed action, from the canonical balance helpers. */
  readonly goldPerAction: number;
  readonly xpPerAction: number;
  /** Seconds a player spends on one action, which is what bounds a day. */
  readonly secondsPerAction: number;
  /** Gold per day if this profession ran at the island's full capacity, unattended. */
  readonly goldPerDayAtCapacity: number;
  readonly xpPerDayAtCapacity: number;
  /** The resource this profession produces, when it produces a storable one. */
  readonly itemDefinitionId: string | null;
  readonly itemPerAction: number;
}

export interface ActorProfile {
  readonly id: "CASUAL" | "NORMAL" | "HARDCORE" | "AUTOMATED";
  /** Seconds of deliberate play per day. */
  readonly activeSecondsPerDay: number;
  /** Share of the island's capacity the player actually keeps working, 0..1. */
  readonly capacityUsage: number;
  /** How many NPC workers this profile hires, once workers exist. */
  readonly workers: number;
}

export const ACTOR_PROFILES: Readonly<Record<ActorProfile["id"], ActorProfile>> = {
  CASUAL: { id: "CASUAL", activeSecondsPerDay: 20 * 60, capacityUsage: 0.25, workers: 0 },
  NORMAL: { id: "NORMAL", activeSecondsPerDay: 60 * 60, capacityUsage: 0.5, workers: 4 },
  HARDCORE: { id: "HARDCORE", activeSecondsPerDay: 3 * 60 * 60, capacityUsage: 0.85, workers: 12 },
  AUTOMATED: { id: "AUTOMATED", activeSecondsPerDay: 10 * 60, capacityUsage: 0.95, workers: 40 }
};

/** What storage holds, and what expanding it costs. */
export interface StorageModel {
  readonly enabled: boolean;
  /** Units of one resource a player may hold, per resource, at tier 0. */
  readonly baseCapacityPerResource: number;
  /** Each tier multiplies capacity, with a rising Gold cost. */
  readonly tierMultiplier: number;
  readonly baseUpgradeGoldCost: number;
  readonly upgradeCostExponent: number;
  /** Wood and stone are consumed by the upgrade; a warehouse is built, not bought. */
  readonly upgradeMaterials: Readonly<Record<string, number>>;
}

export const STORAGE_MODEL: StorageModel = {
  enabled: true,
  baseCapacityPerResource: 500,
  tierMultiplier: 2,
  baseUpgradeGoldCost: 750,
  // Cost tier n is base * n^exponent, so the fifth tier is not five times the first.
  upgradeCostExponent: 1.8,
  upgradeMaterials: { item_wood: 50, item_stone: 50 }
};

/** NPC workers: throughput in exchange for food and gold. */
export interface WorkerModel {
  readonly enabled: boolean;
  /** Actions per worker per day, against whatever workplace they are assigned to. */
  readonly actionsPerWorkerPerDay: number;
  /** Housing, from buildings, limits the workforce. */
  readonly housingCapacityPerIsland: number;
  /** Food the worker eats per day: staple plus protein, in units. */
  readonly staplePerWorkerPerDay: number;
  readonly proteinPerWorkerPerDay: number;
  /** Gold upkeep per worker per day. */
  readonly goldUpkeepPerWorkerPerDay: number;
  /** A worker with no food or no storage produces at this share. */
  readonly starvedProductivity: number;
}

export const WORKER_MODEL: WorkerModel = {
  enabled: true,
  actionsPerWorkerPerDay: 240,
  housingCapacityPerIsland: 60,
  staplePerWorkerPerDay: 2,
  proteinPerWorkerPerDay: 1,
  goldUpkeepPerWorkerPerDay: 3,
  starvedProductivity: 0.35
};

/** One processing recipe: inputs in, one output out. */
export interface Recipe {
  readonly id: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly output: string;
  readonly outputQuantity: number;
  /** Seconds one batch occupies a processing lane. */
  readonly secondsPerBatch: number;
}

export const PROCESSING_MODEL: { readonly enabled: boolean; readonly recipes: readonly Recipe[] } = {
  enabled: true,
  recipes: [
    // Metal + fuel becomes a material worth several times its inputs, which is what makes Fire's
    // imports worthwhile and what the Fire-dominance check watches.
    { id: "recipe_steel", inputs: { item_iron_ore: 2, item_coal: 1 }, output: "item_steel", outputQuantity: 1, secondsPerBatch: 30 },
    { id: "recipe_timber", inputs: { item_wood: 3 }, output: "item_timber", outputQuantity: 1, secondsPerBatch: 20 },
    { id: "recipe_tools", inputs: { item_steel: 1, item_timber: 1 }, output: "item_tools", outputQuantity: 1, secondsPerBatch: 60 },
    { id: "recipe_provisions", inputs: { item_fish_snapper: 2, item_potato: 2 }, output: "item_provisions", outputQuantity: 1, secondsPerBatch: 25 }
  ]
};

/** The player market, when it exists: a clearing price and the fees that make it a Gold sink. */
export interface MarketModel {
  readonly enabled: boolean;
  /** Fraction of a trade's Gold value destroyed as a fee. */
  readonly feeRate: number;
  /** How strongly a shortage moves the clearing price above the base value. */
  readonly scarcitySensitivity: number;
  /** A trade happens only when the buyer's valuation is at least this above the seller's. */
  readonly minimumSpread: number;
}

export const MARKET_MODEL: MarketModel = {
  enabled: true,
  feeRate: 0.05,
  scarcitySensitivity: 0.8,
  minimumSpread: 0.02
};

/** The NPC shop's safety-net rule: how much of one item a player may buy per day. */
export interface NpcShopModel {
  readonly dailyPurchaseCapPerItem: number;
  /** The shop charges this much more than the base value for anything it supplies. */
  readonly markup: number;
}

export const NPC_SHOP_MODEL: NpcShopModel = { dailyPurchaseCapPerItem: 50, markup: 1.35 };

/** A recurring demand that consumes goods without producing any: the army, the fleet, the voyage. */
export interface SinkModel {
  readonly id: string;
  readonly enabled: boolean;
  /** Per player per day, in units of each item. */
  readonly itemsPerPlayerPerDay: Readonly<Record<string, number>>;
  readonly goldPerPlayerPerDay: number;
}

export const SINKS: readonly SinkModel[] = [
  {
    id: "logistics",
    enabled: true,
    // Ships at sea: provisions, timber for repair, resin to keep them tight, and the steel to build.
    itemsPerPlayerPerDay: { item_provisions: 2, item_timber: 2, item_resin: 1, item_steel: 1 },
    goldPerPlayerPerDay: 10
  },
  {
    id: "military",
    enabled: true,
    // Soldiers eat, are paid, and wear out equipment. Deliberately modest: the bible's rule is that
    // military demand must be plausible, not a number invented to absorb inflation.
    itemsPerPlayerPerDay: { item_provisions: 3, item_steel: 2, item_tools: 0.5 },
    goldPerPlayerPerDay: 25
  }
];

/** Livestock, modelled as a producer that consumes feed. */
export interface LivestockModel {
  readonly enabled: boolean;
  readonly staplesPerPenPerDay: number;
  readonly stablePerPenPerDay: number;
  readonly goldPerPenPerDay: number;
  readonly xpPerPenPerDay: number;
}

export const LIVESTOCK_MODEL: LivestockModel = {
  enabled: true,
  staplesPerPenPerDay: 3,
  stablePerPenPerDay: 4,
  goldPerPenPerDay: 6,
  xpPerPenPerDay: 3
};

export interface LandModel {
  readonly enabled: boolean;
  /** Gold a plot costs, and the level it needs, come from the baseline catalogue. */
  readonly expansionEnabled: boolean;
}

export const LAND_MODEL: LandModel = { enabled: true, expansionEnabled: true };

/** Everything the simulator needs to know, assembled from the snapshot and the assumptions. */
export interface EconomyModel {
  readonly baseline: EconomyBaseline;
  readonly storage: StorageModel;
  readonly workers: WorkerModel;
  readonly processing: { readonly enabled: boolean; readonly recipes: readonly Recipe[] };
  readonly market: MarketModel;
  readonly npcShop: NpcShopModel;
  readonly sinks: readonly SinkModel[];
  readonly livestock: LivestockModel;
  readonly land: LandModel;
}

export function defaultModel(baseline: EconomyBaseline): EconomyModel {
  return {
    baseline,
    storage: STORAGE_MODEL,
    workers: WORKER_MODEL,
    processing: PROCESSING_MODEL,
    market: MARKET_MODEL,
    npcShop: NPC_SHOP_MODEL,
    sinks: SINKS,
    livestock: LIVESTOCK_MODEL,
    land: LAND_MODEL
  };
}

/** The professions' per-action rates, taken from the canonical balance rather than invented here. */
export function professionRates(baseline: EconomyBaseline, element: ElementId): Readonly<Record<string, ProfessionRates>> {
  const capacity: IslandBaseline = islandCapacity(element);
  const bestCrop = pickBest(baseline.crops, (crop) => crop.goldPerMinute);
  const bestFishing = pickBest(baseline.fishingTables, (table) => table.goldPerMinute);
  const mining = sum(baseline.mining);
  const forestry = sum(baseline.forestry);
  const bestMining = pickBest(baseline.mining, (resource) => resource.sustainedGoldPerMinute);
  const bestForestry = pickBest(baseline.forestry, (resource) => resource.sustainedGoldPerMinute);
  return {
    FARMING: {
      goldPerAction: bestCrop?.netProfit ?? 0,
      xpPerAction: bestCrop?.xp ?? 0,
      secondsPerAction: Math.max(5, (bestCrop?.growthSeconds ?? 60) / 12),
      goldPerDayAtCapacity: (bestCrop?.goldPerMinute ?? 0) * 1440 * (capacity.farmTiles / 144),
      xpPerDayAtCapacity: (bestCrop?.xpPerMinute ?? 0) * 1440 * (capacity.farmTiles / 144),
      itemDefinitionId: bestCrop?.harvestItemDefinitionId ?? null,
      itemPerAction: bestCrop?.yieldPerHarvest ?? 0
    },
    FISHING: {
      goldPerAction: bestFishing?.expectedGoldPerAction ?? 0,
      xpPerAction: bestFishing?.expectedXpPerAction ?? 0,
      secondsPerAction: bestFishing?.actionSeconds ?? 15,
      goldPerDayAtCapacity: (bestFishing?.goldPerMinute ?? 0) * 1440 * (capacity.fishingSpots / 4),
      xpPerDayAtCapacity: (bestFishing?.xpPerMinute ?? 0) * 1440 * (capacity.fishingSpots / 4),
      itemDefinitionId: bestFishing?.fish[0]?.itemDefinitionId ?? null,
      itemPerAction: 1
    },
    MINING: {
      goldPerAction: bestMining?.goldPerGather ?? 0,
      xpPerAction: bestMining?.xpPerGather ?? 0,
      secondsPerAction: bestMining?.actionSeconds ?? 8,
      goldPerDayAtCapacity: mining.sustainedGoldPerMinute * 1440 * (capacity.miningNodes / 9),
      xpPerDayAtCapacity: mining.sustainedXpPerMinute * 1440 * (capacity.miningNodes / 9),
      itemDefinitionId: bestMining?.itemDefinitionId ?? null,
      itemPerAction: bestMining?.quantityPerGather ?? 0
    },
    FORESTRY: {
      goldPerAction: bestForestry?.goldPerGather ?? 0,
      xpPerAction: bestForestry?.xpPerGather ?? 0,
      secondsPerAction: bestForestry?.actionSeconds ?? 6,
      goldPerDayAtCapacity: forestry.sustainedGoldPerMinute * 1440 * (capacity.forestryNodes / 12),
      xpPerDayAtCapacity: forestry.sustainedXpPerMinute * 1440 * (capacity.forestryNodes / 12),
      itemDefinitionId: bestForestry?.itemDefinitionId ?? null,
      itemPerAction: bestForestry?.quantityPerGather ?? 0
    }
  };
}

/** The element's specialisation, as one number: how much more it can do than an ordinary island. */
export function specialisationMultiplier(element: ElementId, profession: keyof typeof ELEMENT_PROFILES.EARTH.capacity): number {
  return ELEMENT_PROFILES[element].capacity[profession];
}

function pickBest<T>(entries: readonly T[], score: (entry: T) => number): T | undefined {
  let best: T | undefined;
  for (const entry of entries) {
    if (best === undefined || score(entry) > score(best)) best = entry;
  }
  return best;
}

function sum(resources: readonly ResourceBaseline[]): { sustainedGoldPerMinute: number; sustainedXpPerMinute: number } {
  return {
    sustainedGoldPerMinute: resources.reduce((total, resource) => total + resource.sustainedGoldPerMinute, 0),
    sustainedXpPerMinute: resources.reduce((total, resource) => total + resource.sustainedXpPerMinute, 0)
  };
}
