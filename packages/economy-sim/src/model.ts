import type { EconomyBaseline, ResourceBaseline } from "./baseline";
import {
  CAPACITY_FIELD,
  DEVELOPMENT_STEPS,
  ELEMENT_PROFILES,
  RESOURCE_CAPACITY_FIELD,
  islandCapacity,
  starterCapacity,
  type ElementId,
  type Profession,
  type ResourceProfession
} from "./elements";

/**
 * The model: every number the simulation moves, in one place.
 *
 * V16.1.1 simplifies the model around the canonical five-resource mapping (Earth agriculture, Water
 * fishing, Wood forestry, Metal mining, Fire livestock) and moves all value-added activity to a shared,
 * element-neutral industrial track. It also steepens the Home Island development cost curve so that
 * late upgrades stop being a 1-2 day payback, and gives hardwood and resin real demand channels.
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

/** The progression stages, from a starter island to the endgame. */
export type StageId = "EARLY" | "DEVELOPING" | "MID" | "INDUSTRIAL" | "WORLD";
export const STAGE_IDS: readonly StageId[] = ["EARLY", "DEVELOPING", "MID", "INDUSTRIAL", "WORLD"];

export interface ActorProfile {
  readonly id: "CASUAL" | "NORMAL" | "HARDCORE" | "AUTOMATED" | "INDUSTRIALIST";
  /** Seconds of deliberate play per day. */
  readonly activeSecondsPerDay: number;
  /** Share of the island's capacity the player actually keeps working, 0..1. */
  readonly capacityUsage: number;
  /** How many NPC workers this profile hires, once workers exist. */
  readonly workers: number;
  /** How far this profile pushes Home Island development, 0..1. */
  readonly developmentTendency: number;
  /** How readily this profile buys from the market, 0..1. */
  readonly marketTendency: number;
  /** How strongly this profile leans on its element's own profession, 0..1. */
  readonly specialisationTendency: number;
  /**
   * What the profile aims its workforce at. INDUSTRIALIST is deliberately element-agnostic: it buys raw
   * inputs and runs the shared workshops, whatever island it stands on.
   */
  readonly professionFocus: "RESOURCE" | "INDUSTRIAL";
}

export const ACTOR_PROFILES: Readonly<Record<ActorProfile["id"], ActorProfile>> = {
  CASUAL: { id: "CASUAL", activeSecondsPerDay: 20 * 60, capacityUsage: 0.25, workers: 0, developmentTendency: 0.3, marketTendency: 0.3, specialisationTendency: 0.5, professionFocus: "RESOURCE" },
  NORMAL: { id: "NORMAL", activeSecondsPerDay: 60 * 60, capacityUsage: 0.5, workers: 2, developmentTendency: 0.55, marketTendency: 0.55, specialisationTendency: 0.7, professionFocus: "RESOURCE" },
  HARDCORE: { id: "HARDCORE", activeSecondsPerDay: 3 * 60 * 60, capacityUsage: 0.85, workers: 8, developmentTendency: 0.8, marketTendency: 0.7, specialisationTendency: 0.85, professionFocus: "RESOURCE" },
  AUTOMATED: { id: "AUTOMATED", activeSecondsPerDay: 10 * 60, capacityUsage: 0.95, workers: 45, developmentTendency: 0.95, marketTendency: 0.85, specialisationTendency: 0.9, professionFocus: "RESOURCE" },
  // Buys raw materials, runs workshops, sells finished goods. No element owns this business model.
  INDUSTRIALIST: { id: "INDUSTRIALIST", activeSecondsPerDay: 30 * 60, capacityUsage: 0.5, workers: 30, developmentTendency: 0.9, marketTendency: 0.95, specialisationTendency: 0.2, professionFocus: "INDUSTRIAL" }
};

/**
 * How far each resource profession develops at a stage, as a share of the stage's headline tier.
 *
 * Only resource professions appear here. The shared workshop track has no element weight: every island
 * develops it at the same rate (see `developmentTiers`).
 */
export const PROFESSION_DEVELOPMENT_WEIGHT: Readonly<Record<ElementId, Readonly<Record<ResourceProfession, number>>>> = {
  EARTH: { FARMING: 1.0, FISHING: 0.6, MINING: 0.5, FORESTRY: 0.6, LIVESTOCK: 0.7 },
  WATER: { FARMING: 0.6, FISHING: 1.0, MINING: 0.5, FORESTRY: 0.5, LIVESTOCK: 0.6 },
  WOOD: { FARMING: 0.6, FISHING: 0.5, MINING: 0.5, FORESTRY: 1.0, LIVESTOCK: 0.6 },
  METAL: { FARMING: 0.55, FISHING: 0.5, MINING: 1.0, FORESTRY: 0.5, LIVESTOCK: 0.6 },
  FIRE: { FARMING: 0.5, FISHING: 0.5, MINING: 0.5, FORESTRY: 0.5, LIVESTOCK: 1.0 }
};

/** The stage's headline tiers: resource development slower than the shared industrial track. */
export const STAGE_TIERS: Readonly<Record<StageId, { readonly extraction: number; readonly processing: number }>> = {
  EARLY: { extraction: 0, processing: 0 },
  DEVELOPING: { extraction: 1, processing: 1 },
  MID: { extraction: 2, processing: 3 },
  INDUSTRIAL: { extraction: 3, processing: 5 },
  WORLD: { extraction: 5, processing: 5 }
};

/** The character-level band each stage sits in; used to pick which crop a stage actually grows. */
export const STAGE_LEVEL_MAX: Readonly<Record<StageId, number>> = {
  EARLY: 10,
  DEVELOPING: 20,
  MID: 35,
  INDUSTRIAL: 50,
  WORLD: 50
};

/** A managed farm harvests a tile at most this often in a day, however fast the crop grows. */
export const MANAGED_CYCLES_PER_DAY = 2;
/** A worked fishing spot supports one worker's casts per day, and no more. */
export const CASTS_PER_SPOT_PER_DAY = 240;

export function developmentTiers(element: ElementId, stage: StageId): Readonly<Record<Profession, number>> {
  const headline = STAGE_TIERS[stage];
  const weight = PROFESSION_DEVELOPMENT_WEIGHT[element];
  const tier = (profession: ResourceProfession): number =>
    Math.max(0, Math.min(DEVELOPMENT_STEPS, Math.round(headline.extraction * weight[profession])));
  return {
    FARMING: tier("FARMING"),
    FISHING: tier("FISHING"),
    MINING: tier("MINING"),
    FORESTRY: tier("FORESTRY"),
    LIVESTOCK: tier("LIVESTOCK"),
    // The shared workshop track: identical for every element.
    PROCESSING: Math.max(0, Math.min(DEVELOPMENT_STEPS, headline.processing))
  };
}

/**
 * What expanding a Home Island profession costs.
 *
 * The cost is defined **relative to the output the upgrade adds**: step `n` costs
 * `paybackDaysByStep[n]` days of that added output, in gold-equivalent terms. A farm tile adds little
 * value, so a farm upgrade is cheap; a mine adds a lot, so a mine upgrade is expensive. That is what
 * keeps payback comparable across professions and lets the late steps become genuinely slow (the V16.1
 * model paid a near-max upgrade back in ~1.5 days).
 *
 * The cost is paid in gold **and** real goods: half gold, a quarter wood/stone, and - from step three -
 * a quarter industrial goods (timber, steel, tools, provisions), so late development pulls on every
 * other profession's output.
 */
export interface DevelopmentModel {
  readonly steps: number;
  /** Target payback in days for steps 1..5: early quick, near-max slow. */
  readonly paybackDaysByStep: readonly number[];
  readonly goldShare: number;
  readonly materialShare: number;
  readonly materialMix: Readonly<Record<string, number>>;
  readonly industrialShare: number;
  readonly industrialMix: Readonly<Record<string, number>>;
  readonly industrialFromStep: number;
}

export const DEVELOPMENT_MODEL: DevelopmentModel = {
  steps: DEVELOPMENT_STEPS,
  paybackDaysByStep: [2, 5, 12, 30, 70],
  goldShare: 0.5,
  materialShare: 0.25,
  materialMix: { item_wood: 0.5, item_stone: 0.5 },
  industrialShare: 0.25,
  industrialMix: { item_timber: 0.3, item_steel: 0.3, item_tools: 0.15, item_provisions: 0.25 },
  industrialFromStep: 3
};

export interface DevelopmentCost {
  readonly step: number;
  readonly gold: number;
  readonly materials: Readonly<Record<string, number>>;
}

function paybackTarget(step: number, model: DevelopmentModel): number {
  const index = Math.max(0, Math.min(model.paybackDaysByStep.length - 1, step - 1));
  return model.paybackDaysByStep[index] ?? 1;
}

/**
 * The gold value one developed unit of a resource profession adds per day, at the physical ceiling:
 * a farm tile, a fishing spot, a mining node, a forestry node, or a livestock pen.
 */
export function capacityOutputPerUnitPerDay(
  baseline: EconomyBaseline,
  element: ElementId,
  profession: Profession,
  prices: Readonly<Record<string, number>> = {}
): number {
  if (profession === "PROCESSING") return 0;
  if (profession === "LIVESTOCK") {
    const weights = LIVESTOCK_MODEL.outputMix;
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    const perUnit =
      total <= 0
        ? 0
        : Object.entries(weights).reduce((sum, [item, weight]) => sum + (weight / total) * (prices[item] ?? 1), 0);
    return LIVESTOCK_MODEL.stablePerPenPerDay * perUnit;
  }
  switch (profession) {
    case "FARMING": {
      const crop = pickBest(baseline.crops, (entry) => entry.goldPerMinute);
      if (crop === undefined) return 0;
      const cycles = Math.min(1440 / Math.max(1, crop.growthSeconds / 60), MANAGED_CYCLES_PER_DAY);
      return cycles * crop.netProfit;
    }
    case "FISHING": {
      const table = pickBest(baseline.fishingTables, (entry) => entry.goldPerMinute);
      if (table === undefined) return 0;
      const casts = Math.min(86400 / Math.max(1, table.actionSeconds), CASTS_PER_SPOT_PER_DAY);
      return casts * table.expectedGoldPerAction;
    }
    case "MINING": {
      const total = sum(baseline.mining).sustainedGoldPerMinute;
      const nodes = baseline.mining.reduce((count, resource) => count + resource.nodeCount, 0);
      return nodes <= 0 ? 0 : (total / nodes) * 1440;
    }
    case "FORESTRY": {
      const total = sum(baseline.forestry).sustainedGoldPerMinute;
      const nodes = baseline.forestry.reduce((count, resource) => count + resource.nodeCount, 0);
      return nodes <= 0 ? 0 : (total / nodes) * 1440;
    }
  }
}

/** The gold value one development step adds per day. */
export function addedOutputPerDay(
  element: ElementId,
  profession: Profession,
  step: number,
  baseline: EconomyBaseline,
  prices: Readonly<Record<string, number>> = {}
): number {
  const gain = Math.max(
    0,
    developedUnits(element, profession, step) - developedUnits(element, profession, step - 1)
  );
  return gain * capacityOutputPerUnitPerDay(baseline, element, profession, prices);
}

/** The gold-equivalent value of one development step, from the payback target and the added output. */
export function developmentCostValue(
  element: ElementId,
  profession: Profession,
  step: number,
  baseline: EconomyBaseline,
  prices: Readonly<Record<string, number>>,
  model: DevelopmentModel = DEVELOPMENT_MODEL
): number {
  const clamped = Math.max(1, Math.min(model.steps, Math.round(step)));
  return paybackTarget(clamped, model) * addedOutputPerDay(element, profession, clamped, baseline, prices);
}

/** The upgrade's cost split into gold and real goods, using the market prices for the materials. */
export function developmentCost(
  element: ElementId,
  profession: Profession,
  step: number,
  baseline: EconomyBaseline,
  prices: Readonly<Record<string, number>>,
  model: DevelopmentModel = DEVELOPMENT_MODEL
): DevelopmentCost {
  const clamped = Math.max(1, Math.min(model.steps, Math.round(step)));
  const total = developmentCostValue(element, profession, clamped, baseline, prices, model);
  const materials: Record<string, number> = {};
  for (const [item, weight] of Object.entries(model.materialMix)) {
    materials[item] = Math.max(0, Math.ceil((total * model.materialShare * weight) / Math.max(1e-9, prices[item] ?? 1)));
  }
  if (clamped >= model.industrialFromStep) {
    for (const [item, weight] of Object.entries(model.industrialMix)) {
      materials[item] =
        (materials[item] ?? 0) + Math.max(0, Math.ceil((total * model.industrialShare * weight) / Math.max(1e-9, prices[item] ?? 1)));
    }
  }
  return { step: clamped, gold: Math.round(total * model.goldShare), materials };
}

/**
 * The gold-equivalent cost of adding one more unit of capacity: "should I develop this island, or buy
 * the good from someone else?".
 */
export function marginalCapacityCost(
  element: ElementId,
  profession: Profession,
  nextStep: number,
  baseline: EconomyBaseline,
  prices: Readonly<Record<string, number>>,
  model: DevelopmentModel = DEVELOPMENT_MODEL
): number {
  const clamped = Math.max(1, Math.min(model.steps, Math.round(nextStep)));
  const gain = Math.max(1e-9, developedUnits(element, profession, clamped) - developedUnits(element, profession, clamped - 1));
  return developmentCostValue(element, profession, clamped, baseline, prices, model) / gain;
}

/**
 * How many days of a profession's added output repay one development step. It rises by construction -
 * the cost of a step is defined as a growing number of days of the output it adds - which is what
 * eventually makes importing cheaper than another upgrade.
 */
export function capacityPaybackDays(
  element: ElementId,
  profession: Profession,
  step: number,
  baseline: EconomyBaseline,
  prices: Readonly<Record<string, number>>,
  model: DevelopmentModel = DEVELOPMENT_MODEL
): number {
  const clamped = Math.max(1, Math.min(model.steps, Math.round(step)));
  const added = addedOutputPerDay(element, profession, clamped, baseline, prices);
  if (added <= 0) return Number.POSITIVE_INFINITY;
  return developmentCostValue(element, profession, clamped, baseline, prices, model) / added;
}

function developedUnits(element: ElementId, profession: Profession, step: number): number {
  const field = CAPACITY_FIELD[profession];
  const starter = starterCapacity(element)[field];
  const ceiling = islandCapacity(element)[field];
  const clamped = Math.max(0, Math.min(DEVELOPMENT_STEPS, step));
  // Fractional on purpose: a step's capacity *gain* is what makes the marginal cost curve monotonic.
  return Math.max(1, starter + ((ceiling - starter) * clamped) / DEVELOPMENT_STEPS);
}

/** What storage holds, and what expanding it costs. Storage scales with progression, not one big cap. */
export interface StorageModel {
  readonly enabled: boolean;
  readonly baseCapacityPerResource: number;
  readonly tierMultiplier: number;
  readonly baseUpgradeGoldCost: number;
  readonly upgradeCostExponent: number;
  readonly upgradeMaterials: Readonly<Record<string, number>>;
  readonly upgradeFillThreshold: number;
}

export const STORAGE_MODEL: StorageModel = {
  enabled: true,
  // Roomier than one starter island's daily output, so the opening sessions are not a storage-tetris;
  // upgrades then have to keep up with production, which is where the strategic decision appears.
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
  readonly actionsPerWorkerPerDay: number;
  readonly housingCapacityPerIsland: number;
  /**
   * Workplace slots one developed capacity unit supports. A worker can only work capacity that already
   * exists; extra workers on a full site add nothing.
   */
  readonly slotsPerUnit: Readonly<Record<Profession, number>>;
  readonly staplePerWorkerPerDay: number;
  readonly proteinPerWorkerPerDay: number;
  readonly goldUpkeepPerWorkerPerDay: number;
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

/** One processing recipe: inputs in, one output out. Recipes belong to the shared system, not Fire. */
export interface Recipe {
  readonly id: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly output: string;
  readonly outputQuantity: number;
  readonly secondsPerBatch: number;
  readonly targetPerLanePerDay: number;
}

export const PROCESSING_MODEL: {
  readonly enabled: boolean;
  readonly maxBatchesPerLanePerDay: number;
  readonly recipes: readonly Recipe[];
} = {
  enabled: true,
  maxBatchesPerLanePerDay: 8,
  recipes: [
    // Shared smelting: Metal + fuel becomes steel. Every island may smelt; none gets a bonus.
    { id: "recipe_steel", inputs: { item_iron_ore: 2, item_coal: 1 }, output: "item_steel", outputQuantity: 1, secondsPerBatch: 30, targetPerLanePerDay: 6 },
    // Wood -> timber. Hardwood is now a required input to tools, so Wood has a strategic channel.
    { id: "recipe_timber", inputs: { item_wood: 3 }, output: "item_timber", outputQuantity: 1, secondsPerBatch: 20, targetPerLanePerDay: 5 },
    { id: "recipe_components", inputs: { item_copper_ore: 2, item_coal: 1 }, output: "item_components", outputQuantity: 1, secondsPerBatch: 40, targetPerLanePerDay: 3 },
    // Tools want hardwood; machinery wants resin (a sealant) and copper. Both strengthen Wood.
    { id: "recipe_tools", inputs: { item_steel: 1, item_timber: 1, item_hardwood: 1 }, output: "item_tools", outputQuantity: 1, secondsPerBatch: 60, targetPerLanePerDay: 1 },
    { id: "recipe_machinery", inputs: { item_steel: 2, item_copper_ore: 1, item_timber: 1, item_resin: 1 }, output: "item_machinery", outputQuantity: 1, secondsPerBatch: 90, targetPerLanePerDay: 1 },
    { id: "recipe_provisions", inputs: { item_fish_snapper: 2, item_potato: 2 }, output: "item_provisions", outputQuantity: 1, secondsPerBatch: 25, targetPerLanePerDay: 1 },
    // Animal products become leather and textiles - shared, not Fire's monopoly.
    { id: "recipe_leather", inputs: { item_hide: 2, item_resin: 1 }, output: "item_leather", outputQuantity: 1, secondsPerBatch: 35, targetPerLanePerDay: 1 },
    { id: "recipe_textiles", inputs: { item_wool: 2 }, output: "item_textiles", outputQuantity: 1, secondsPerBatch: 35, targetPerLanePerDay: 1 }
  ]
};

/** The player market, when it exists: a clearing price and the fees that make it a Gold sink. */
export interface MarketModel {
  readonly enabled: boolean;
  readonly feeRate: number;
  readonly scarcitySensitivity: number;
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
  readonly markup: number;
}

export const NPC_SHOP_MODEL: NpcShopModel = { dailyPurchaseCapPerItem: 50, markup: 1.4 };

/** A recurring demand that consumes goods without producing any: the army, the fleet, the voyage. */
export interface SinkModel {
  readonly id: string;
  readonly enabled: boolean;
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
    // Soldiers eat, are paid, and wear out equipment.
    itemsPerPlayerPerDay: { item_provisions: 3, item_steel: 2, item_components: 1, item_tools: 0.5, item_machinery: 0.2, item_leather: 0.3 },
    goldPerPlayerPerDay: 25
  }
];

/** Livestock, modelled as a conversion economy that turns feed into animal products. */
export interface LivestockModel {
  readonly enabled: boolean;
  /** Staples one pen eats per day. Feed is the Earth->Fire dependency. */
  readonly staplesPerPenPerDay: number;
  /** Output units one fully fed pen produces per day, split across the animal products. */
  readonly stablePerPenPerDay: number;
  /** The split of a pen's output across its products (weights are normalised at use). */
  readonly outputMix: Readonly<Record<string, number>>;
  readonly xpPerPenPerDay: number;
}

export const LIVESTOCK_MODEL: LivestockModel = {
  enabled: true,
  staplesPerPenPerDay: 12,
  stablePerPenPerDay: 5,
  outputMix: { item_eggs: 0.3, item_milk: 0.25, item_meat: 0.25, item_hide: 0.1, item_wool: 0.1 },
  xpPerPenPerDay: 3
};

export interface LandModel {
  readonly enabled: boolean;
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
 * The element's *physical* specialisation in a resource profession: its ceiling over the five-element
 * average. The shared workshop track is element-neutral, so it always returns 1.
 */
export function physicalCapacityMultiplier(element: ElementId, profession: Profession): number {
  if (profession === "PROCESSING") return 1;
  const field = RESOURCE_CAPACITY_FIELD[profession];
  const values = Object.values(ELEMENT_PROFILES).map((profile) => profile.physicalMax[field]);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average <= 0 ? 1 : ELEMENT_PROFILES[element].physicalMax[field] / average;
}

/** The element's primary resource advantage: its own profession's physical multiplier. */
export function rawResourceSpecializationAdvantage(element: ElementId): number {
  return physicalCapacityMultiplier(element, ELEMENT_PROFILES[element].primaryProfession) - 1;
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

