import type { EconomyBaseline, ResourceBaseline } from "./baseline";
import {
  CAPACITY_FIELD,
  DEVELOPMENT_STEPS,
  ELEMENT_PROFILES,
  islandCapacity,
  starterCapacity,
  type ElementId,
  type Profession
} from "./elements";

/**
 * The model: every number the simulation moves, in one place.
 *
 * The rule the phase sets is that balance constants never live in the simulation logic, so this file is
 * the *only* place a future number is written down. Everything is provisional - the whole point of the
 * phase is to expose structure, not to fix prices - and the docs label it so. V16.1 adds the
 * development cost curve, workplace slots and a progression-scaled storage model, and keeps the
 * physical capacities in `elements.ts` where geography is described.
 */

export interface ProfessionRates {
  /** Gold for one completed action, from the canonical balance helpers. */
  readonly goldPerAction: number;
  readonly xpPerAction: number;
  /** Seconds a player spends on one action, which is what bounds a day. */
  readonly secondsPerAction: number;
  /** Gold per day if this profession ran at the island's *physical* ceiling, unattended. */
  readonly goldPerDayAtCapacity: number;
  readonly xpPerDayAtCapacity: number;
  /** The resource this profession produces, when it produces a storable one. */
  readonly itemDefinitionId: string | null;
  readonly itemPerAction: number;
}

/** The progression stages the brief names, from a starter island to the endgame. */
export type StageId = "EARLY" | "DEVELOPING" | "MID" | "INDUSTRIAL" | "WORLD";
export const STAGE_IDS: readonly StageId[] = ["EARLY", "DEVELOPING", "MID", "INDUSTRIAL", "WORLD"];

export interface ActorProfile {
  readonly id: "CASUAL" | "NORMAL" | "HARDCORE" | "AUTOMATED";
  /** Seconds of deliberate play per day. */
  readonly activeSecondsPerDay: number;
  /** Share of the island's capacity the player actually keeps working, 0..1. */
  readonly capacityUsage: number;
  /** How many NPC workers this profile hires, once workers exist. */
  readonly workers: number;
  /** How far this profile pushes Home Island development, 0..1 (a modelling intent, reported). */
  readonly developmentTendency: number;
  /** How readily this profile buys from the market, 0..1. */
  readonly marketTendency: number;
  /** How strongly this profile leans on its element's own profession, 0..1. */
  readonly specialisationTendency: number;
}

export const ACTOR_PROFILES: Readonly<Record<ActorProfile["id"], ActorProfile>> = {
  CASUAL: { id: "CASUAL", activeSecondsPerDay: 20 * 60, capacityUsage: 0.25, workers: 0, developmentTendency: 0.3, marketTendency: 0.3, specialisationTendency: 0.5 },
  NORMAL: { id: "NORMAL", activeSecondsPerDay: 60 * 60, capacityUsage: 0.5, workers: 2, developmentTendency: 0.55, marketTendency: 0.55, specialisationTendency: 0.7 },
  HARDCORE: { id: "HARDCORE", activeSecondsPerDay: 3 * 60 * 60, capacityUsage: 0.85, workers: 8, developmentTendency: 0.8, marketTendency: 0.7, specialisationTendency: 0.85 },
  AUTOMATED: { id: "AUTOMATED", activeSecondsPerDay: 10 * 60, capacityUsage: 0.95, workers: 45, developmentTendency: 0.95, marketTendency: 0.85, specialisationTendency: 0.9 }
};

/**
 * How far each profession develops at a stage, as a share of the stage's headline tier.
 *
 * The element changes the *emphasis*: an Earth island pushes farming, a Metal island pushes mining, and
 * Fire pushes pens and workshops. The weights are why a mature Fire island runs 18 lanes while its
 * extraction stays at a starter's handful of nodes.
 */
export const PROFESSION_DEVELOPMENT_WEIGHT: Readonly<Record<ElementId, Readonly<Record<Profession, number>>>> = {
  EARTH: { FARMING: 1.0, FISHING: 0.6, MINING: 0.5, FORESTRY: 0.6, LIVESTOCK: 0.7, PROCESSING: 0.5 },
  WATER: { FARMING: 0.6, FISHING: 1.0, MINING: 0.5, FORESTRY: 0.5, LIVESTOCK: 0.6, PROCESSING: 0.6 },
  WOOD: { FARMING: 0.6, FISHING: 0.5, MINING: 0.5, FORESTRY: 1.0, LIVESTOCK: 0.6, PROCESSING: 0.8 },
  METAL: { FARMING: 0.55, FISHING: 0.5, MINING: 1.0, FORESTRY: 0.5, LIVESTOCK: 0.6, PROCESSING: 0.85 },
  FIRE: { FARMING: 0.4, FISHING: 0.5, MINING: 0.45, FORESTRY: 0.35, LIVESTOCK: 1.0, PROCESSING: 1.0 }
};

/** The stage's headline tiers: extraction/farming develops slower than industry, as the brief wants. */
export const STAGE_TIERS: Readonly<Record<StageId, { readonly extraction: number; readonly processing: number }>> = {
  EARLY: { extraction: 0, processing: 0 },
  DEVELOPING: { extraction: 1, processing: 1 },
  MID: { extraction: 2, processing: 3 },
  INDUSTRIAL: { extraction: 3, processing: 5 },
  WORLD: { extraction: 5, processing: 5 }
};

/**
 * The character-level band each stage sits in (the brief's L1-10 / 10-20 / 20-35 / 35-50 hypothesis).
 * The simulator uses it to pick which crop a stage actually grows, so early capacity is measured
 * against the crops a starter can plant rather than against the endgame's best crop.
 */
export const STAGE_LEVEL_MAX: Readonly<Record<StageId, number>> = {
  EARLY: 10,
  DEVELOPING: 20,
  MID: 35,
  INDUSTRIAL: 50,
  WORLD: 50
};

export function developmentTiers(element: ElementId, stage: StageId): Readonly<Record<Profession, number>> {
  const headline = STAGE_TIERS[stage];
  const weight = PROFESSION_DEVELOPMENT_WEIGHT[element];
  const tier = (profession: Profession): number => {
    const base = profession === "PROCESSING" ? headline.processing : headline.extraction;
    return Math.max(0, Math.min(DEVELOPMENT_STEPS, Math.round(base * weight[profession])));
  };
  return {
    FARMING: tier("FARMING"),
    FISHING: tier("FISHING"),
    MINING: tier("MINING"),
    FORESTRY: tier("FORESTRY"),
    LIVESTOCK: tier("LIVESTOCK"),
    PROCESSING: tier("PROCESSING")
  };
}

/**
 * What expanding a Home Island profession costs.
 *
 * Each step is more expensive than the last in both gold and materials, and the late steps start to
 * consume industrial goods (timber, steel) rather than only wood and stone. That is the structural
 * reason a mature island eventually prefers to trade or expand instead of pouring everything into
 * another engineering tier.
 */
export interface DevelopmentModel {
  readonly steps: number;
  readonly baseGoldCost: number;
  readonly goldExponent: number;
  readonly baseMaterials: Readonly<Record<string, number>>;
  readonly materialExponent: number;
  readonly industrialMaterials: Readonly<Record<string, number>>;
  readonly industrialFromStep: number;
}

export const DEVELOPMENT_MODEL: DevelopmentModel = {
  steps: DEVELOPMENT_STEPS,
  baseGoldCost: 300,
  goldExponent: 1.9,
  baseMaterials: { item_wood: 25, item_stone: 25 },
  materialExponent: 1.6,
  industrialMaterials: { item_timber: 4, item_steel: 2 },
  industrialFromStep: 3
};

export interface DevelopmentCost {
  readonly step: number;
  readonly gold: number;
  readonly materials: Readonly<Record<string, number>>;
}

export function developmentCost(step: number, model: DevelopmentModel = DEVELOPMENT_MODEL): DevelopmentCost {
  const s = Math.max(1, step);
  const materials: Record<string, number> = {};
  for (const [item, quantity] of Object.entries(model.baseMaterials)) {
    materials[item] = Math.ceil(quantity * Math.pow(s, model.materialExponent));
  }
  if (s >= model.industrialFromStep) {
    for (const [item, quantity] of Object.entries(model.industrialMaterials)) {
      materials[item] = (materials[item] ?? 0) + Math.ceil(quantity * (s - model.industrialFromStep + 1));
    }
  }
  return {
    step: s,
    gold: Math.round(model.baseGoldCost * Math.pow(s, model.goldExponent)),
    materials
  };
}

/**
 * The gold-equivalent cost of adding one more unit of capacity, which is the number the brief wants:
 * "should I develop this island, or buy the good from someone else?".
 */
export function marginalCapacityCost(
  element: ElementId,
  profession: Profession,
  nextStep: number,
  prices: Readonly<Record<string, number>>,
  model: DevelopmentModel = DEVELOPMENT_MODEL
): number {
  const step = Math.max(1, Math.min(model.steps, Math.round(nextStep)));
  const from = developedUnits(element, profession, step - 1);
  const to = developedUnits(element, profession, step);
  const gained = Math.max(1, to - from);
  const cost = developmentCost(step, model);
  let goldEquivalent = cost.gold;
  for (const [item, quantity] of Object.entries(cost.materials)) {
    goldEquivalent += quantity * (prices[item] ?? 1);
  }
  return goldEquivalent / gained;
}

function developedUnits(element: ElementId, profession: Profession, step: number): number {
  const field = CAPACITY_FIELD[profession];
  const starter = starterCapacity(element)[field];
  const ceiling = islandCapacity(element)[field];
  const clamped = Math.max(0, Math.min(DEVELOPMENT_STEPS, step));
  // Fractional on purpose: a step's capacity *gain* is what makes the marginal cost curve monotonic,
  // and rounding each step first would put a false dip in it.
  return Math.max(1, starter + ((ceiling - starter) * clamped) / DEVELOPMENT_STEPS);
}

/** What storage holds, and what expanding it costs. Storage scales with progression, not one big cap. */
export interface StorageModel {
  readonly enabled: boolean;
  /** Units of one resource a player may hold at tier 0 - enough for the first sessions. */
  readonly baseCapacityPerResource: number;
  /** Each upgrade multiplies capacity, with a rising Gold-and-materials cost. */
  readonly tierMultiplier: number;
  readonly baseUpgradeGoldCost: number;
  readonly upgradeCostExponent: number;
  /** Upgrades are built, not bought: wood and stone, then industrial goods. */
  readonly upgradeMaterials: Readonly<Record<string, number>>;
  /** A cohort upgrades when its fullest store passes this share of capacity. */
  readonly upgradeFillThreshold: number;
}

export const STORAGE_MODEL: StorageModel = {
  enabled: true,
  // Starter storage is deliberately roomy against a starter island's daily output, so the first
  // sessions are not a Tetris game; it becomes a decision once industrial throughput arrives.
  // Roomier than one starter island's daily output, so the opening sessions are not a storage-tetris;
  // upgrades then have to keep up with production, which is where the strategic decision appears.
  // Calibrated to roughly a month of a starter island's daily output, so the first sessions are
  // comfortable and the pressure arrives with industrial throughput rather than on day one.
  baseCapacityPerResource: 40000,
  tierMultiplier: 2,
  baseUpgradeGoldCost: 1500,
  upgradeCostExponent: 1.9,
  upgradeMaterials: { item_wood: 200, item_stone: 200, item_timber: 5 },
  upgradeFillThreshold: 0.85
};

/** NPC workers: throughput in exchange for food and gold, bounded by workplace slots and capacity. */
export interface WorkerModel {
  readonly enabled: boolean;
  /** Actions per worker per day against whatever workplace they are assigned to. */
  readonly actionsPerWorkerPerDay: number;
  /** Housing, from buildings, limits the workforce. */
  readonly housingCapacityPerIsland: number;
  /**
   * Workplace slots one developed capacity unit supports. A mine with five slots cannot be worked by
   * twenty miners: the extra workers add nothing, which is exactly what the brief asks the model to
   * enforce. A worker can only work capacity that already exists.
   */
  readonly slotsPerUnit: Readonly<Record<Profession, number>>;
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
  slotsPerUnit: { FARMING: 1 / 6, FISHING: 1, MINING: 1 / 2, FORESTRY: 1 / 3, LIVESTOCK: 1 / 2, PROCESSING: 2 },
  staplePerWorkerPerDay: 3,
  proteinPerWorkerPerDay: 2,
  goldUpkeepPerWorkerPerDay: 4,
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
  /**
   * The batches a lane is actually *asked* to run in a day.
   *
   * This is what stops an industrial island declaring infinite demand for finished goods: it wants as
   * much as its economy can absorb, not as many batches as a lane could physically stamp out.
   */
  readonly targetPerLanePerDay: number;
}

export const PROCESSING_MODEL: {
  readonly enabled: boolean;
  /**
   * A lane's practical ceiling. The recipe time says a lane *could* run thousands of batches a day;
   * a managed workshop does not, and the cap is what keeps an industrial island's raw demand within
   * the range where local extraction can still cover part of it.
   */
  readonly maxBatchesPerLanePerDay: number;
  readonly recipes: readonly Recipe[];
} = {
  enabled: true,
  maxBatchesPerLanePerDay: 8,
  recipes: [
    // Metal + fuel becomes a material worth several times its inputs, which is what makes Fire's
    // imports worthwhile and what the Fire-dependency check watches.
    { id: "recipe_steel", inputs: { item_iron_ore: 2, item_coal: 1 }, output: "item_steel", outputQuantity: 1, secondsPerBatch: 30, targetPerLanePerDay: 6 },
    { id: "recipe_timber", inputs: { item_wood: 3 }, output: "item_timber", outputQuantity: 1, secondsPerBatch: 20, targetPerLanePerDay: 5 },
    // Copper needs a sink; without one it is a dead material in the flow graph.
    { id: "recipe_components", inputs: { item_copper_ore: 2, item_coal: 1 }, output: "item_components", outputQuantity: 1, secondsPerBatch: 40, targetPerLanePerDay: 3 },
    { id: "recipe_tools", inputs: { item_steel: 1, item_timber: 1 }, output: "item_tools", outputQuantity: 1, secondsPerBatch: 60, targetPerLanePerDay: 1 },
    { id: "recipe_provisions", inputs: { item_fish_snapper: 2, item_potato: 2 }, output: "item_provisions", outputQuantity: 1, secondsPerBatch: 25, targetPerLanePerDay: 1 }
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

// Capped and marked up: ten wood is possible, five thousand is not how a large economy is fed.
export const NPC_SHOP_MODEL: NpcShopModel = { dailyPurchaseCapPerItem: 50, markup: 1.4 };

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
    // Ships at sea: provisions, timber for repair, resin to keep them tight, hardwood and steel to build.
    itemsPerPlayerPerDay: { item_provisions: 2, item_timber: 2, item_resin: 1, item_hardwood: 1, item_steel: 1 },
    goldPerPlayerPerDay: 10
  },
  {
    id: "military",
    enabled: true,
    // Soldiers eat, are paid, and wear out equipment. Deliberately modest: the bible's rule is that
    // military demand must be plausible, not a number invented to absorb inflation.
    itemsPerPlayerPerDay: { item_provisions: 3, item_steel: 2, item_components: 1, item_tools: 0.5 },
    goldPerPlayerPerDay: 25
  }
];

/** Livestock, modelled as a conversion economy that consumes feed. */
export interface LivestockModel {
  readonly enabled: boolean;
  /** Staples one pen eats per day. Feed is the Earth->Fire dependency. */
  readonly staplesPerPenPerDay: number;
  /** Output units one fully fed pen produces per day (split across products). */
  readonly stablePerPenPerDay: number;
  readonly xpPerPenPerDay: number;
}

export const LIVESTOCK_MODEL: LivestockModel = {
  enabled: true,
  // A pen is a real feed bill: Fire's industrial livestock has to buy staples when its own fields
  // cannot cover the herd, which is the Earth->Fire dependency the brief asks the model to show.
  staplesPerPenPerDay: 12,
  stablePerPenPerDay: 5,
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
  readonly processing: { readonly enabled: boolean; readonly maxBatchesPerLanePerDay: number; readonly recipes: readonly Recipe[] };
  readonly market: MarketModel;
  readonly npcShop: NpcShopModel;
  readonly sinks: readonly SinkModel[];
  readonly livestock: LivestockModel;
  readonly land: LandModel;
  readonly development: DevelopmentModel;
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
    land: LAND_MODEL,
    development: DEVELOPMENT_MODEL
  };
}

/** The professions' per-action rates, taken from the canonical balance rather than invented here. */
export function professionRates(baseline: EconomyBaseline, element: ElementId): Readonly<Record<string, ProfessionRates>> {
  const capacity = islandCapacity(element);
  const bestCrop = pickBest(baseline.crops, (crop) => crop.goldPerMinute);
  const bestFishing = pickBest(baseline.fishingTables, (table) => table.goldPerMinute);
  const mining = sum(baseline.mining);
  const forestry = sum(baseline.forestry);
  const bestMining = pickBest(baseline.mining, (resource) => resource.sustainedGoldPerMinute);
  const bestForestry = pickBest(baseline.forestry, (resource) => resource.sustainedGoldPerMinute);
  // Capacity gold/day uses the physical ceiling so the number reads "an island fully built out".
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

/**
 * The element's *physical* specialisation: how much more of a profession its ceiling holds than an
 * ordinary island's. This is deliberately separate from the efficiency modifier, so a report can say
 * which one produced an advantage.
 */
export function physicalCapacityMultiplier(element: ElementId, profession: Profession): number {
  const values = Object.values(ELEMENT_PROFILES).map((profile) => profile.physicalMax[CAPACITY_FIELD[profession]]);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average <= 0 ? 1 : ELEMENT_PROFILES[element].physicalMax[CAPACITY_FIELD[profession]] / average;
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
