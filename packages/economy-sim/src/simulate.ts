import type { EconomyBaseline, ResourceBaseline } from "./baseline";
import {
  CAPACITY_FIELD,
  ELEMENT_IDS,
  ELEMENT_PROFILES,
  PROFESSIONS,
  developedCapacity,
  efficiencyFor,
  islandCapacity,
  type ElementId,
  type IslandCapacity,
  type Profession
} from "./elements";
import {
  ACTOR_PROFILES,
  CASTS_PER_SPOT_PER_DAY,
  MANAGED_CYCLES_PER_DAY,
  STAGE_LEVEL_MAX,
  capacityPaybackDays,
  developmentTiers,
  marginalCapacityCost,
  physicalCapacityMultiplier,
  professionRates,
  rawResourceSpecializationAdvantage,
  type ActorProfile,
  type EconomyModel,
  type Recipe,
  type StageId
} from "./model";
import type {
  DayMetrics,
  ElementMetrics,
  ItemDependency,
  ItemMetrics,
  SimulationResult,
  SimulationTotals
} from "./metrics";
import type { Scenario, ScenarioFeatures } from "./scenario";

/**
 * The deterministic economy simulator.
 *
 * Aggregate, not per-actor: players are grouped into cohorts of (element x archetype), so 10,000
 * players cost the same as one, and the day is the time step because every modelled rate is a rate per
 * day. There is no randomness in the engine, so the same scenario always produces the same numbers -
 * which is what makes a finding reproducible rather than anecdotal.
 *
 * The accounting rules the engine must never break, and the tests check:
 *   * gold moves between cohorts or is created by the NPC shop's purchases and destroyed by seed
 *     purchases, wages, upgrades, NPC purchases, fees and sinks - a market trade never creates gold;
 *   * goods move between cohorts, are consumed by recipes, livestock, workers and sinks, or are wasted
 *     by a full store - a recipe never makes raw material from nothing;
 *   * workers can only *work* developed capacity; they can never raise it, so extra workers on a site
 *     that has no slots add nothing;
 *   * nothing goes negative: a cohort spends what it has and no more.
 */

/** Future goods the model trades but the game does not yet ship, with their modelled base value. */
export const MODEL_ITEM_VALUES: Readonly<Record<string, number>> = {
  item_steel: 14,
  item_timber: 4,
  item_tools: 30,
  item_provisions: 24,
  item_components: 12,
  item_machinery: 40,
  item_leather: 22,
  item_textiles: 16,
  item_meat: 6,
  item_eggs: 4,
  item_milk: 5,
  item_hide: 8,
  item_wool: 6
};

/** What counts as staples, vegetables and protein, so a worker eats a category rather than one id. */
const STAPLES = ["item_potato", "item_wheat", "item_corn", "item_cabbage", "item_pumpkin"] as const;
const VEGETABLES = ["item_tomato", "item_strawberry"] as const;
const WORKER_STAPLES = [...STAPLES, ...VEGETABLES];
const PROTEINS = [
  "item_fish_tilapia",
  "item_fish_carp",
  "item_fish_catfish",
  "item_fish_sardine",
  "item_fish_mackerel",
  "item_fish_snapper",
  "item_fish_tuna",
  "item_meat",
  "item_eggs"
];

/** How a player of an element splits their attention across the gather professions. */
const TIME_SHARE: Readonly<Record<ElementId, Readonly<Partial<Record<Profession, number>>>>> = {
  EARTH: { FARMING: 0.65, FISHING: 0.1, MINING: 0.05, FORESTRY: 0.2 },
  WATER: { FARMING: 0.1, FISHING: 0.75, MINING: 0.05, FORESTRY: 0.1 },
  WOOD: { FARMING: 0.15, FISHING: 0.1, MINING: 0.05, FORESTRY: 0.7 },
  METAL: { FARMING: 0.1, FISHING: 0.05, MINING: 0.75, FORESTRY: 0.1 },
  FIRE: { FARMING: 0.45, FISHING: 0.15, MINING: 0.15, FORESTRY: 0.25 }
};

/** How a resource-oriented island's hired workers are assigned: mostly to its own specialisation. */
const WORKER_FOCUS_RESOURCE: Readonly<Record<ElementId, Readonly<Partial<Record<Profession, number>>>>> = {
  EARTH: { FARMING: 0.7, FORESTRY: 0.15, MINING: 0.1, FISHING: 0.05 },
  WATER: { FISHING: 0.8, FARMING: 0.1, FORESTRY: 0.05, MINING: 0.05 },
  WOOD: { FORESTRY: 0.8, FARMING: 0.1, MINING: 0.05, FISHING: 0.05 },
  METAL: { MINING: 0.85, FORESTRY: 0.08, FARMING: 0.05, FISHING: 0.02 },
  FIRE: { LIVESTOCK: 0.6, FARMING: 0.2, FISHING: 0.1, FORESTRY: 0.05, MINING: 0.05 }
};

/**
 * How the element-agnostic industrialist assigns its workforce: mostly to the shared workshops. The
 * same focus is used on every island, which is what keeps manufacturing element-neutral.
 */
const WORKER_FOCUS_INDUSTRIAL: Readonly<Partial<Record<Profession, number>>> = {
  PROCESSING: 0.6,
  FARMING: 0.1,
  MINING: 0.1,
  FORESTRY: 0.1,
  FISHING: 0.05,
  LIVESTOCK: 0.05
};

const GATHER_PROFESSIONS = ["FARMING", "FISHING", "MINING", "FORESTRY"] as const;

/** What a player keeps on hand before selling the rest: a working stock, not a hoard. */
const RESERVE_PER_PLAYER = 20;

type ProfessionTally = Record<Profession, number>;

interface Cohort {
  readonly element: ElementId;
  readonly archetype: ActorProfile;
  readonly players: number;
  readonly tier: ProfessionTally;
  readonly developed: IslandCapacity;
  readonly capacityActions: ProfessionTally;
  capacityTotals: ProfessionTally;
  slots: number;
  gold: number;
  xp: number;
  readonly inventory: Map<string, number>;
  storageTier: number;
  workers: number;
}

/** One day's tally for one cohort, so per-element metrics never have to be guessed afterwards. */
interface CohortDay {
  playerActions: number;
  workerActions: number;
  workerPossible: number;
  producedValue: number;
  importedGold: number;
  exportedGold: number;
  /** Gold spent on seeds, wages and sinks - destroyed, not transferred. */
  goldSpent: number;
  npcImportGold: number;
  marketImportGold: number;
  lostValue: number;
  workerProductivity: number;
  processingInputValue: number;
  processingOutputValue: number;
  readonly produced: Map<string, number>;
  readonly consumed: Map<string, number>;
  readonly wasted: Map<string, number>;
  /** Inputs the cohort will try to buy; the market and NPC shop reduce these in place. */
  readonly need: Map<string, number>;
  /** Goods above the working reserve that the cohort will sell. */
  readonly surplus: Map<string, number>;
  readonly capacityWork: ProfessionTally;
}

interface ElementTally {
  players: number;
  goldStart: number;
  outputValue: number;
  imports: number;
  exports: number;
  workers: number;
  slots: number;
  productivityWeighted: number;
  productivityWorkers: number;
  processingInputValue: number;
  processingOutputValue: number;
  readonly produced: Map<string, number>;
  readonly consumed: Map<string, number>;
  /** What the element could not cover locally and had to look for outside its own ground. */
  readonly needed: Map<string, number>;
  readonly work: ProfessionTally;
  readonly capacity: ProfessionTally;
}

function emptyTally(): ProfessionTally {
  return { FARMING: 0, FISHING: 0, MINING: 0, FORESTRY: 0, LIVESTOCK: 0, PROCESSING: 0 };
}

function emptyDay(): CohortDay {
  return {
    playerActions: 0,
    workerActions: 0,
    workerPossible: 0,
    producedValue: 0,
    importedGold: 0,
    exportedGold: 0,
    goldSpent: 0,
    npcImportGold: 0,
    marketImportGold: 0,
    lostValue: 0,
    workerProductivity: 0,
    processingInputValue: 0,
    processingOutputValue: 0,
    produced: new Map(),
    consumed: new Map(),
    wasted: new Map(),
    need: new Map(),
    surplus: new Map(),
    capacityWork: emptyTally()
  };
}

function emptyElementTally(): ElementTally {
  return {
    players: 0,
    goldStart: 0,
    outputValue: 0,
    imports: 0,
    exports: 0,
    workers: 0,
    slots: 0,
    productivityWeighted: 0,
    productivityWorkers: 0,
    processingInputValue: 0,
    processingOutputValue: 0,
    produced: new Map(),
    consumed: new Map(),
    needed: new Map(),
    work: emptyTally(),
    capacity: emptyTally()
  };
}

export function baseValue(itemDefinitionId: string, baseline: EconomyBaseline): number {
  return baseline.sellPrices[itemDefinitionId] ?? MODEL_ITEM_VALUES[itemDefinitionId] ?? 1;
}

/**
 * The model as one scenario actually runs it.
 *
 * The scenarios differ only in which future systems exist, so a feature switch turns a subsystem off
 * rather than leaving a flag for the engine to remember. Turning storage off means unlimited space, not
 * "storage that never fills"; turning market off means no trade at all.
 */
export function effectiveModel(model: EconomyModel, features: ScenarioFeatures): EconomyModel {
  return {
    ...model,
    storage: { ...model.storage, enabled: model.storage.enabled && features.storage },
    workers: { ...model.workers, enabled: model.workers.enabled && features.workers },
    processing: { ...model.processing, enabled: model.processing.enabled && features.processing },
    market: { ...model.market, enabled: model.market.enabled && features.market },
    livestock: { ...model.livestock, enabled: model.livestock.enabled && features.livestock },
    npcShop: features.npcShop ? model.npcShop : { ...model.npcShop, dailyPurchaseCapPerItem: 0 },
    sinks: model.sinks.map((sink) => ({ ...sink, enabled: sink.enabled && features.sinks }))
  };
}

function add(record: Map<string, number>, item: string, quantity: number): void {
  if (quantity === 0) return;
  record.set(item, (record.get(item) ?? 0) + quantity);
}

/** Take up to `wanted` of one item, never below zero. Returns what was taken. */
function take(cohort: Cohort, item: string, wanted: number): number {
  const held = cohort.inventory.get(item) ?? 0;
  const taken = Math.max(0, Math.min(held, wanted));
  const left = held - taken;
  if (left <= 1e-9) cohort.inventory.delete(item);
  else cohort.inventory.set(item, left);
  return taken;
}

/** Take up to `wanted` from whichever of `items` the cohort holds, in the given order. */
function takeAny(cohort: Cohort, items: readonly string[], wanted: number): number {
  let remaining = wanted;
  let taken = 0;
  for (const item of items) {
    if (remaining <= 1e-9) break;
    const got = take(cohort, item, remaining);
    taken += got;
    remaining -= got;
  }
  return taken;
}

function capacityPerResource(model: EconomyModel, cohort: Cohort): number {
  if (!model.storage.enabled) return Number.MAX_SAFE_INTEGER;
  return model.storage.baseCapacityPerResource * Math.pow(model.storage.tierMultiplier, cohort.storageTier);
}

/** Store what fits, and report the rest as wasted rather than letting the store grow forever. */
function give(cohort: Cohort, model: EconomyModel, item: string, quantity: number, wasted: Map<string, number>): void {
  if (quantity <= 0) return;
  const held = cohort.inventory.get(item) ?? 0;
  const ceiling = capacityPerResource(model, cohort) * cohort.players;
  const room = Math.max(0, ceiling - held);
  const stored = Math.min(room, quantity);
  if (stored < quantity) add(wasted, item, quantity - stored);
  if (stored > 0) cohort.inventory.set(item, held + stored);
}

function storageUpgradeCost(model: EconomyModel, cohort: Cohort): { gold: number; materials: Record<string, number> } {
  const tier = cohort.storageTier + 1;
  const gold = Math.round(model.storage.baseUpgradeGoldCost * Math.pow(tier, model.storage.upgradeCostExponent));
  const materials: Record<string, number> = {};
  for (const [item, quantity] of Object.entries(model.storage.upgradeMaterials)) {
    materials[item] = Math.ceil(quantity * Math.pow(tier, 0.9));
  }
  return { gold, materials };
}

function storageFill(cohort: Cohort, model: EconomyModel): number {
  if (!model.storage.enabled) return 0;
  let worst = 0;
  for (const [, held] of cohort.inventory.entries()) {
    const ceiling = capacityPerResource(model, cohort) * cohort.players;
    if (ceiling <= 0) continue;
    worst = Math.max(worst, held / ceiling);
  }
  return worst;
}

function referenceActions(resources: readonly ResourceBaseline[]): { actions: number; nodes: number } {
  let actions = 0;
  let nodes = 0;
  for (const resource of resources) {
    nodes += resource.nodeCount;
    actions += sustainedActions(resource);
  }
  return { actions, nodes };
}

function sustainedActions(resource: ResourceBaseline): number {
  return resource.goldPerGather > 0 ? (resource.sustainedGoldPerMinute / resource.goldPerGather) * 1440 : 0;
}

interface ResourceMixEntry {
  readonly itemDefinitionId: string;
  readonly quantityPerAction: number;
  /** This node type's share of the island's gather actions. */
  readonly weight: number;
}

/**
 * What a gather profession actually digs or fells: the reference island's own mix of node types.
 *
 * V16.0 produced a single "best" material per profession, which meant every island mysteriously
 * produced no iron and then had to import all of it. A real island yields the mix of stone, coal,
 * copper and iron (or wood, resin and hardwood) that its ground holds.
 */
function resourceMix(resources: readonly ResourceBaseline[]): readonly ResourceMixEntry[] {
  const total = resources.reduce((sum, resource) => sum + sustainedActions(resource), 0);
  return resources.map((resource) => ({
    itemDefinitionId: resource.itemDefinitionId,
    quantityPerAction: resource.quantityPerGather,
    weight: total > 0 ? sustainedActions(resource) / total : 0
  }));
}

/**
 * What a cast hauls in: the catch tables' own species mix, so Water produces sardine, snapper and
 * tuna rather than one "best fish", and a provisioning recipe can actually buy a snapper.
 */
function speciesMix(baseline: EconomyBaseline): readonly ResourceMixEntry[] {
  const tables = baseline.fishingTables;
  if (tables.length === 0) return [];
  const byItem = new Map<string, number>();
  for (const table of tables) {
    for (const entry of table.fish) {
      add(byItem, entry.itemDefinitionId, entry.probability / tables.length);
    }
  }
  return [...byItem.entries()].map(([itemDefinitionId, weight]) => ({
    itemDefinitionId,
    quantityPerAction: 1,
    weight
  }));
}

function pickBestCrop(baseline: EconomyBaseline, levelMax: number) {
  const available = baseline.crops.filter((crop) => crop.requiredLevel <= levelMax);
  const pool = available.length > 0 ? available : baseline.crops;
  let best = pool[0];
  for (const crop of pool) {
    if (best === undefined || crop.goldPerMinute > best.goldPerMinute) best = crop;
  }
  return best;
}

/**
 * Actions a day a profession's developed capacity can sustainably absorb.
 *
 * Farming is bounded by how often a managed farm re-harvests a tile; fishing by a spot's workable
 * casts; mining and forestry by their regeneration (`sustainedGoldPerMinute`, scaled from the
 * reference island). None of these is a daily lockout - they are the ground's own throughput.
 */
function sustainableCapacityActions(
  baseline: EconomyBaseline,
  developed: IslandCapacity,
  stage: StageId
): ProfessionTally {
  const crop = pickBestCrop(baseline, STAGE_LEVEL_MAX[stage]);
  const farmCycles =
    crop === undefined ? MANAGED_CYCLES_PER_DAY : Math.min(86400 / Math.max(1, crop.growthSeconds), MANAGED_CYCLES_PER_DAY);
  const fishSeconds = baseline.fishingTables[0]?.actionSeconds ?? 15;
  const castsPerSpot = Math.min(86400 / Math.max(1, fishSeconds), CASTS_PER_SPOT_PER_DAY);
  const mining = referenceActions(baseline.mining);
  const forestry = referenceActions(baseline.forestry);
  return {
    FARMING: developed.farmTiles * farmCycles,
    FISHING: developed.fishingSpots * castsPerSpot,
    MINING: mining.nodes > 0 ? mining.actions * (developed.miningNodes / mining.nodes) : 0,
    FORESTRY: forestry.nodes > 0 ? forestry.actions * (developed.forestryNodes / forestry.nodes) : 0,
    LIVESTOCK: 0,
    PROCESSING: 0
  };
}

function capacityTotalsFor(cohort: Cohort): ProfessionTally {
  return {
    FARMING: cohort.capacityActions.FARMING * cohort.players,
    FISHING: cohort.capacityActions.FISHING * cohort.players,
    MINING: cohort.capacityActions.MINING * cohort.players,
    FORESTRY: cohort.capacityActions.FORESTRY * cohort.players,
    LIVESTOCK: cohort.developed.livestockPens * cohort.players,
    PROCESSING: cohort.developed.processingLanes * cohort.players
  };
}

function slotsFor(cohort: Cohort, model: EconomyModel): number {
  let slots = 0;
  for (const profession of PROFESSIONS) {
    slots += cohort.developed[CAPACITY_FIELD[profession]] * model.workers.slotsPerUnit[profession];
  }
  return slots * cohort.players;
}

function facilityUtil(cohort: Cohort, assignedWorkers: number, requiredSlots: number): number {
  const coverage = requiredSlots <= 0 ? 1 : Math.min(1, assignedWorkers / requiredSlots);
  return Math.min(1, cohort.archetype.capacityUsage + coverage);
}

function batchesPerLane(model: EconomyModel, recipe: Recipe): number {
  return Math.min(86400 / Math.max(1, recipe.secondsPerBatch), model.processing.maxBatchesPerLanePerDay);
}

/** The batches a lane is actually asked to run: what the economy wants, capped by what it can stamp. */
function wantedBatches(model: EconomyModel, recipe: Recipe): number {
  return Math.min(batchesPerLane(model, recipe), recipe.targetPerLanePerDay);
}

/**
 * One cohort's morning: the player and their workers work the land they have developed.
 *
 * Produces what the developed capacity allows, eats, pays wages, and records the inputs it still
 * needs - which the market and the NPC safety net will try to supply before the workshops run.
 */
function workTheLand(cohort: Cohort, model: EconomyModel, day: CohortDay): void {
  const rates = professionRates(model.baseline, cohort.element);
  const shares = TIME_SHARE[cohort.element];
  const focus =
    cohort.archetype.professionFocus === "INDUSTRIAL" ? WORKER_FOCUS_INDUSTRIAL : WORKER_FOCUS_RESOURCE[cohort.element];
  const players = cohort.players;
  const workers = cohort.workers;

  // --- worker food and wages decide how productive the workforce is today ---
  const staplesWanted = workers * model.workers.staplePerWorkerPerDay;
  const proteinWanted = workers * model.workers.proteinPerWorkerPerDay;
  const staples = takeAny(cohort, WORKER_STAPLES, staplesWanted);
  const protein = takeAny(cohort, PROTEINS, proteinWanted);
  add(day.consumed, "item_potato", staples);
  add(day.consumed, "item_fish_sardine", protein);
  if (staplesWanted - staples > 0) add(day.need, "item_potato", staplesWanted - staples);
  if (proteinWanted - protein > 0) add(day.need, "item_fish_sardine", proteinWanted - protein);
  const fed = Math.min(1, Math.min(staples / Math.max(1, staplesWanted), protein / Math.max(1, proteinWanted)));
  const foodProductivity =
    workers <= 0 ? 1 : model.workers.starvedProductivity + (1 - model.workers.starvedProductivity) * fed;
  const wages = workers * model.workers.goldUpkeepPerWorkerPerDay;
  const paid = Math.min(cohort.gold, wages);
  cohort.gold -= paid;
  day.goldSpent += paid;
  const paidShare = wages <= 0 ? 1 : paid / wages;
  const workerProductivity = foodProductivity * Math.min(1, paidShare);
  day.workerProductivity = workers > 0 ? workerProductivity : 0;
  day.workerPossible = workers * model.workers.actionsPerWorkerPerDay;

  // --- player actions, then worker actions, both bounded by the same developed capacity ---
  for (const profession of GATHER_PROFESSIONS) {
    const rate = rates[profession];
    if (rate === undefined) continue;
    const share = shares[profession] ?? 0;
    const cap = cohort.capacityTotals[profession];
    const active = (players * cohort.archetype.activeSecondsPerDay * share) / Math.max(1, rate.secondsPerAction);
    const playerActions = Math.max(0, Math.min(active, cap)) * cohort.archetype.capacityUsage;
    day.playerActions += playerActions;
    day.capacityWork[profession] += playerActions;

    const slots = cohort.developed[CAPACITY_FIELD[profession]] * model.workers.slotsPerUnit[profession] * players;
    const assigned = workers * (focus[profession] ?? 0);
    const possible = Math.min(
      assigned * model.workers.actionsPerWorkerPerDay,
      slots * model.workers.actionsPerWorkerPerDay,
      Math.max(0, cap - playerActions)
    );
    const workerActions = Math.max(0, possible) * workerProductivity;
    day.workerActions += workerActions;
    day.capacityWork[profession] += workerActions;

    const actions = playerActions + workerActions;
    if (actions <= 0 || rate.itemDefinitionId === null) continue;
    const efficiency = efficiencyFor(cohort.element, profession);
    const mix =
      profession === "MINING"
        ? resourceMix(model.baseline.mining)
        : profession === "FORESTRY"
          ? resourceMix(model.baseline.forestry)
          : profession === "FISHING"
            ? speciesMix(model.baseline)
            : null;
    if (mix === null) {
      const units = actions * rate.itemPerAction * efficiency;
      add(day.produced, rate.itemDefinitionId, units);
      give(cohort, model, rate.itemDefinitionId, units, day.wasted);
      day.producedValue += units * baseValue(rate.itemDefinitionId, model.baseline);
    } else {
      for (const entry of mix) {
        const units = actions * entry.weight * entry.quantityPerAction * efficiency;
        if (units <= 0) continue;
        add(day.produced, entry.itemDefinitionId, units);
        give(cohort, model, entry.itemDefinitionId, units, day.wasted);
        day.producedValue += units * baseValue(entry.itemDefinitionId, model.baseline);
      }
    }
    cohort.xp += actions * rate.xpPerAction;
    if (profession === "FARMING") {
      const seedCost = actions * Math.min(...model.baseline.crops.map((crop) => crop.seedCost));
      const seedPaid = Math.min(cohort.gold, seedCost);
      cohort.gold -= seedPaid;
      day.goldSpent += seedPaid;
    }
  }

  // --- the workshops: how hard they can run, and what they will need ---
  const livestockSlots = cohort.developed.livestockPens * model.workers.slotsPerUnit.LIVESTOCK * players;
  const processingSlots = cohort.developed.processingLanes * model.workers.slotsPerUnit.PROCESSING * players;
  const livestockUtil = facilityUtil(cohort, workers * (focus.LIVESTOCK ?? 0), livestockSlots);
  const processingUtil = facilityUtil(cohort, workers * (focus.PROCESSING ?? 0), processingSlots);
  day.capacityWork.LIVESTOCK += cohort.developed.livestockPens * players * livestockUtil;
  day.capacityWork.PROCESSING += cohort.developed.processingLanes * players * processingUtil;

  if (model.livestock.enabled) {
    const feedWanted = cohort.developed.livestockPens * players * model.livestock.staplesPerPenPerDay * livestockUtil;
    const feedGap = Math.max(0, feedWanted - sumHeld(cohort, STAPLES));
    if (feedGap > 0) add(day.need, "item_potato", feedGap);
  }

  if (model.processing.enabled) {
    for (const recipe of model.processing.recipes) {
      const wanted = cohort.developed.processingLanes * players * wantedBatches(model, recipe) * processingUtil;
      for (const [item, quantity] of Object.entries(recipe.inputs)) {
        const gap = Math.max(0, wanted * quantity - (cohort.inventory.get(item) ?? 0));
        if (gap > 0) add(day.need, item, gap);
      }
    }
  }

  // --- recurring demand: the voyage and the army eat without producing ---
  for (const sink of model.sinks) {
    if (!sink.enabled) continue;
    for (const [item, perPlayer] of Object.entries(sink.itemsPerPlayerPerDay)) {
      add(day.consumed, item, takeAny(cohort, [item], perPlayer * players));
    }
    const goldWanted = sink.goldPerPlayerPerDay * players;
    const sinkPaid = Math.min(cohort.gold, goldWanted);
    cohort.gold -= sinkPaid;
    day.goldSpent += sinkPaid;
  }
}

function sumHeld(cohort: Cohort, items: readonly string[]): number {
  let total = 0;
  for (const item of items) total += cohort.inventory.get(item) ?? 0;
  return total;
}

/** Run the pens and the workshops with whatever feed and inputs are on hand after trading. */
function runFacilities(cohort: Cohort, model: EconomyModel, day: CohortDay): void {
  if (model.livestock.enabled) {
    const pens = cohort.developed.livestockPens * cohort.players;
    const util = cohort.developed.livestockPens * cohort.players <= 0 ? 0 : day.capacityWork.LIVESTOCK / (cohort.developed.livestockPens * cohort.players);
    const feedWanted = pens * model.livestock.staplesPerPenPerDay * util;
    const feed = takeAny(cohort, STAPLES, feedWanted);
    add(day.consumed, "item_potato", feed);
    const fedShare = feedWanted <= 0 ? 1 : Math.min(1, feed / feedWanted);
    const output = pens * model.livestock.stablePerPenPerDay * util * fedShare;
    // One pen yields a mix of animal products - eggs, milk, meat, hide and wool - not one generic food.
    const weights = model.livestock.outputMix;
    const weightTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    for (const [item, weight] of Object.entries(weights)) {
      const quantity = weightTotal <= 0 ? 0 : (output * weight) / weightTotal;
      if (quantity <= 0) continue;
      add(day.produced, item, quantity);
      give(cohort, model, item, quantity, day.wasted);
      day.producedValue += quantity * baseValue(item, model.baseline);
    }
    cohort.xp += pens * model.livestock.xpPerPenPerDay * util * fedShare;
  }

  if (model.processing.enabled) {
    const lanes = cohort.developed.processingLanes * cohort.players;
    const util = lanes <= 0 ? 0 : day.capacityWork.PROCESSING / lanes;
    for (const recipe of model.processing.recipes) {
      const wanted = Math.floor(lanes * wantedBatches(model, recipe) * util);
      const batches = affordableBatches(cohort, recipe, wanted);
      if (batches <= 0) continue;
      let inputValue = 0;
      for (const [item, quantity] of Object.entries(recipe.inputs)) {
        const used = take(cohort, item, quantity * batches);
        add(day.consumed, item, used);
        inputValue += used * baseValue(item, model.baseline);
      }
      const output = recipe.outputQuantity * batches;
      add(day.produced, recipe.output, output);
      give(cohort, model, recipe.output, output, day.wasted);
      day.producedValue += output * baseValue(recipe.output, model.baseline);
      day.processingInputValue += inputValue;
      day.processingOutputValue += output * baseValue(recipe.output, model.baseline);
    }
  }
}

function affordableBatches(cohort: Cohort, recipe: Recipe, wanted: number): number {
  let batches = wanted;
  for (const [item, quantity] of Object.entries(recipe.inputs)) {
    batches = Math.min(batches, Math.floor((cohort.inventory.get(item) ?? 0) / quantity));
  }
  return Math.max(0, batches);
}

/** Everything a cohort will sell today: stock above the working reserve. */
function markSurplus(cohort: Cohort, day: CohortDay): void {
  const reserve = RESERVE_PER_PLAYER * cohort.players;
  for (const [item, held] of cohort.inventory.entries()) {
    const spare = held - reserve;
    if (spare > 0) add(day.surplus, item, spare);
  }
}

/**
 * The player market: unmet demand meets surplus at a scarcity-derived price.
 *
 * Gold and goods only ever move between cohorts - the fee is the one thing destroyed - so a market can
 * never create wealth, and a shortage shows up as a price rather than as a free lunch.
 */
function runMarket(cohorts: Cohort[], days: CohortDay[], model: EconomyModel, fees: { value: number }): number {
  if (!model.market.enabled) return 0;
  const items = new Set<string>();
  for (const day of days) {
    for (const item of day.need.keys()) items.add(item);
    for (const item of day.surplus.keys()) items.add(item);
  }
  for (const item of Object.keys(MODEL_ITEM_VALUES)) items.add(item);
  let volumeGold = 0;

  for (const item of items) {
    const base = baseValue(item, model.baseline);
    const sellers = days
      .map((day, index) => ({ day, cohort: cohorts[index], surplus: day.surplus.get(item) ?? 0 }))
      .filter((entry) => entry.cohort !== undefined && entry.surplus > 1e-9) as { day: CohortDay; cohort: Cohort; surplus: number }[];
    const buyers = days
      .map((day, index) => ({ day, cohort: cohorts[index], need: day.need.get(item) ?? 0 }))
      .filter((entry) => entry.cohort !== undefined && entry.need > 1e-9 && entry.cohort.gold > 0) as {
      day: CohortDay;
      cohort: Cohort;
      need: number;
    }[];
    if (sellers.length === 0 || buyers.length === 0) continue;

    const totalSupply = sellers.reduce((sum, entry) => sum + entry.surplus, 0);
    const totalNeed = buyers.reduce((sum, entry) => sum + entry.need, 0);
    const scarcity = totalNeed / Math.max(1, totalNeed + totalSupply);
    const price = base * (1 + model.market.scarcitySensitivity * scarcity);

    for (const buyer of buyers) {
      const affordable = Math.min(buyer.need, Math.floor(buyer.cohort.gold / price));
      let remaining = affordable;
      for (const seller of sellers) {
        if (remaining <= 1e-9) break;
        const available = Math.max(0, seller.cohort.inventory.get(item) ?? 0);
        const sold = Math.min(seller.surplus, remaining, available);
        if (sold <= 1e-9) continue;
        const gross = sold * price;
        const fee = gross * model.market.feeRate;
        take(seller.cohort, item, sold);
        seller.cohort.gold += gross - fee;
        buyer.cohort.gold -= gross;
        buyer.cohort.inventory.set(item, (buyer.cohort.inventory.get(item) ?? 0) + sold);
        seller.surplus = Math.max(0, seller.surplus - sold);
        buyer.day.marketImportGold += gross;
        buyer.day.importedGold += gross;
        seller.day.exportedGold += gross - fee;
        volumeGold += gross;
        fees.value += fee;
        remaining -= sold;
      }
      if (affordable - remaining > 0) {
        buyer.day.need.set(item, Math.max(0, buyer.need - (affordable - remaining)));
        buyer.need = Math.max(0, buyer.need - (affordable - remaining));
      }
    }
  }
  return volumeGold;
}

/**
 * The NPC shop as a safety net: it fills what the market could not, in small marked-up quantities,
 * and it buys a producer's surplus for gold. It never scales with industrial demand.
 */
function runNpcShop(
  cohorts: Cohort[],
  days: CohortDay[],
  model: EconomyModel,
  created: { value: number },
  destroyed: { value: number }
): void {
  const cap = model.npcShop.dailyPurchaseCapPerItem;
  if (cap <= 0) return;
  cohorts.forEach((cohort, index) => {
    const day = days[index];
    if (day === undefined) return;
    for (const [item, needed] of [...day.need.entries()]) {
      if (needed <= 1e-9) continue;
      const wanted = Math.min(needed, cap * cohort.players);
      const price = baseValue(item, model.baseline) * model.npcShop.markup;
      const affordable = Math.min(wanted, Math.floor(cohort.gold / price));
      if (affordable <= 1e-9) continue;
      const cost = affordable * price;
      cohort.gold -= cost;
      destroyed.value += cost;
      cohort.inventory.set(item, (cohort.inventory.get(item) ?? 0) + affordable);
      day.npcImportGold += cost;
      day.importedGold += cost;
      day.need.set(item, Math.max(0, needed - affordable));
    }
    markSurplus(cohort, day);
    for (const [item, spare] of [...day.surplus.entries()]) {
      const sellPrice = model.baseline.sellPrices[item];
      if (sellPrice === undefined || spare <= 1e-9) continue;
      const sold = Math.min(spare, cap * cohort.players);
      if (sold <= 1e-9) continue;
      take(cohort, item, sold);
      const gold = sold * sellPrice;
      cohort.gold += gold;
      created.value += gold;
      day.exportedGold += gold;
      day.surplus.set(item, spare - sold);
    }
  });
}

function buyStorageUpgrades(cohort: Cohort, model: EconomyModel, day: CohortDay, destroyed: { value: number }): number {
  if (!model.storage.enabled) return 0;
  if (storageFill(cohort, model) < model.storage.upgradeFillThreshold) return 0;
  const cost = storageUpgradeCost(model, cohort);
  if (cohort.gold < cost.gold) return 0;
  for (const [item, quantity] of Object.entries(cost.materials)) {
    if ((cohort.inventory.get(item) ?? 0) < quantity) return 0;
  }
  cohort.gold -= cost.gold;
  destroyed.value += cost.gold;
  for (const [item, quantity] of Object.entries(cost.materials)) take(cohort, item, quantity);
  cohort.storageTier += 1;
  return 1;
}

function wasteOverflow(cohort: Cohort, model: EconomyModel, day: CohortDay): void {
  if (!model.storage.enabled) return;
  const ceiling = capacityPerResource(model, cohort) * cohort.players;
  for (const [item, held] of [...cohort.inventory.entries()]) {
    if (held <= ceiling) continue;
    const lost = held - ceiling;
    cohort.inventory.set(item, ceiling);
    add(day.wasted, item, lost);
    day.lostValue += lost * baseValue(item, model.baseline);
  }
}

export function simulate(scenario: Scenario, model: EconomyModel): SimulationResult {
  const active = effectiveModel(model, scenario.features);
  const cohorts: Cohort[] = [];
  for (const element of ELEMENT_IDS) {
    const elementShare = scenario.elementMix[element];
    if (elementShare <= 0) continue;
    for (const [archetypeId, archetypeShare] of Object.entries(scenario.archetypeMix)) {
      if (archetypeShare <= 0) continue;
      const players = scenario.actors * elementShare * archetypeShare;
      if (players <= 0) continue;
      const archetype = ACTOR_PROFILES[archetypeId as ActorProfile["id"]];
      const tier: ProfessionTally = { ...developmentTiers(element, scenario.stage) };
      const developed = developedCapacity(element, tier);
      const cohort: Cohort = {
        element,
        archetype,
        players,
        tier,
        developed,
        capacityActions: sustainableCapacityActions(model.baseline, developed, scenario.stage),
        capacityTotals: emptyTally(),
        slots: 0,
        // Every player starts with the starter package's gold.
        gold: 100 * players,
        xp: 0,
        inventory: new Map(),
        storageTier: 0,
        workers: 0
      };
      cohort.capacityTotals = capacityTotalsFor(cohort);
      const wanted = active.workers.enabled ? archetype.workers * players : 0;
      cohort.workers = Math.min(wanted, active.workers.housingCapacityPerIsland * players);
      cohort.slots = slotsFor(cohort, active);
      cohorts.push(cohort);
    }
  }

  const elementTallies = new Map<ElementId, ElementTally>();
  for (const cohort of cohorts) {
    const tally = elementTallies.get(cohort.element) ?? emptyElementTally();
    tally.players += cohort.players;
    tally.goldStart += cohort.gold;
    tally.workers += cohort.workers;
    tally.slots += cohort.slots;
    for (const profession of PROFESSIONS) tally.capacity[profession] += cohort.capacityTotals[profession];
    elementTallies.set(cohort.element, tally);
  }

  const totals = {
    goldCreated: 0,
    goldDestroyed: 0,
    marketVolumeGold: 0,
    fees: 0,
    npcShopImportsGold: 0,
    marketImportsGold: 0,
    lostOutputToStorage: 0,
    first50: null as number | null,
    first80: null as number | null,
    firstFull: null as number | null,
    constrainedDays: 0,
    timeToStoragePressureDays: null as number | null,
    timeToUpgradeDays: null as number | null
  };
  const productionTotal = new Map<string, number>();
  const consumptionTotal = new Map<string, number>();
  const needTotal = new Map<string, number>();
  const unmetTotal = new Map<string, number>();
  const daily: DayMetrics[] = [];

  for (let dayNumber = 1; dayNumber <= scenario.days; dayNumber += 1) {
    const goldCreated = { value: 0 };
    const goldSink = { value: 0 };
    const fees = { value: 0 };
    const days: CohortDay[] = cohorts.map(() => emptyDay());

    cohorts.forEach((cohort, index) => {
      const day = days[index];
      if (day === undefined) return;
      workTheLand(cohort, active, day);
      markSurplus(cohort, day);
    });
    const needSnapshot = days.map((day) => new Map(day.need));

    const volumeGold = runMarket(cohorts, days, active, fees);
    runNpcShop(cohorts, days, active, goldCreated, goldSink);

    let storageUpgrades = 0;
    let fill = 0;
    cohorts.forEach((cohort, index) => {
      const day = days[index];
      if (day === undefined) return;
      runFacilities(cohort, active, day);
      if (scenario.features.upgrades) storageUpgrades += buyStorageUpgrades(cohort, active, day, goldSink);
      wasteOverflow(cohort, active, day);
      fill = Math.max(fill, storageFill(cohort, active));
    });

    // Per-day item books, and the run's totals.
    const production = new Map<string, number>();
    const consumption = new Map<string, number>();
    const wasted = new Map<string, number>();
    let npcImportsValue = 0;
    let marketImportsValue = 0;
    let lostValue = 0;
    let spentValue = 0;
    let work = 0;
    let capacity = 0;
    let weightedProductivity = 0;
    let productivityWorkers = 0;

    cohorts.forEach((cohort, index) => {
      const day = days[index];
      const snapshot = needSnapshot[index];
      const tally = elementTallies.get(cohort.element);
      if (day === undefined || snapshot === undefined || tally === undefined) return;
      for (const [item, quantity] of day.produced) {
        add(production, item, quantity);
        add(productionTotal, item, quantity);
        add(tally.produced, item, quantity);
      }
      for (const [item, quantity] of day.consumed) {
        add(consumption, item, quantity);
        add(consumptionTotal, item, quantity);
        add(tally.consumed, item, quantity);
      }
      for (const [item, quantity] of day.wasted) add(wasted, item, quantity);
      for (const [item, quantity] of snapshot) {
        add(needTotal, item, quantity);
        add(tally.needed, item, quantity);
      }
      for (const [item, quantity] of day.need) {
        add(unmetTotal, item, quantity);
      }
      for (const profession of PROFESSIONS) {
        tally.work[profession] += day.capacityWork[profession];
        work += day.capacityWork[profession];
      }
      for (const profession of PROFESSIONS) capacity += tally.capacity[profession];
      npcImportsValue += day.npcImportGold;
      marketImportsValue += day.marketImportGold;
      lostValue += day.lostValue;
      spentValue += day.goldSpent;
      tally.processingInputValue += day.processingInputValue;
      tally.processingOutputValue += day.processingOutputValue;
      tally.outputValue += day.producedValue;
      tally.imports += day.importedGold;
      tally.exports += day.exportedGold;
      if (cohort.workers > 0) {
        weightedProductivity += day.workerProductivity * cohort.workers;
        productivityWorkers += cohort.workers;
      }
    });
    const goldTotal = cohorts.reduce((sum, cohort) => sum + cohort.gold, 0);
    if (totals.timeToStoragePressureDays === null && fill >= 0.9) totals.timeToStoragePressureDays = dayNumber;
    if (totals.timeToUpgradeDays === null && storageUpgrades > 0) totals.timeToUpgradeDays = dayNumber;
    if (totals.first50 === null && fill >= 0.5) totals.first50 = dayNumber;
    if (totals.first80 === null && fill >= 0.8) totals.first80 = dayNumber;
    if (totals.firstFull === null && fill >= 0.99) totals.firstFull = dayNumber;
    if (fill >= 0.99) totals.constrainedDays += 1;

    totals.goldCreated += goldCreated.value;
    totals.goldDestroyed += spentValue + goldSink.value + fees.value;
    totals.marketVolumeGold += volumeGold;
    totals.fees += fees.value;
    totals.npcShopImportsGold += npcImportsValue;
    totals.marketImportsGold += marketImportsValue;
    totals.lostOutputToStorage += lostValue;

    daily.push({
      day: dayNumber,
      goldCreated: goldCreated.value,
      goldDestroyed: spentValue + goldSink.value + fees.value,
      goldTransferred: volumeGold,
      goldTotal,
      production: Object.fromEntries(production),
      consumption: Object.fromEntries(consumption),
      wasted: Object.fromEntries(wasted),
      marketVolumeGold: volumeGold,
      marketFeesDestroyed: fees.value,
      npcShopImportsGold: npcImportsValue,
      marketImportsGold: marketImportsValue,
      xpGained: cohorts.reduce((sum, cohort) => sum + cohort.xp, 0),
      storageFillRate: fill,
      capacityUtilization: capacity <= 0 ? 0 : Math.min(1, work / capacity),
      workplaceUtilization: workplaceUtilization(cohorts),
      workerProductivity: productivityWorkers <= 0 ? 0 : weightedProductivity / productivityWorkers,
      npcProductivity: productivityWorkers <= 0 ? 0 : weightedProductivity / productivityWorkers,
      lostOutputToStorage: lostValue,
      storageUpgrades
    });
  }

  const priceMap: Record<string, number> = { ...model.baseline.sellPrices, ...MODEL_ITEM_VALUES };
  const perElement: ElementMetrics[] = ELEMENT_IDS.filter((id) => scenario.elementMix[id] > 0).map((element) => {
    const tally = elementTallies.get(element) ?? emptyElementTally();
    const cohort = cohorts.find((entry) => entry.element === element);
    const workAverage = scaleTally(tally.work, scenario.days);
    const productivity = tally.productivityWorkers <= 0 ? 0 : tally.productivityWeighted / tally.productivityWorkers;
    const primary = primaryProfession(element);
    const payback = [1, 2, 3, 4, 5].map((step) =>
      capacityPaybackDays(element, primary, step, model.baseline, priceMap, model.development)
    );
    const nextStep = Math.min(5, (cohort?.tier[primary] ?? 0) + 1);
    return {
      element,
      players: tally.players,
      goldPerDay: (tally.players <= 0 ? 0 : (currentGold(cohorts, element) - tally.goldStart) / Math.max(1, scenario.days)),
      xpPerDay: xpFor(cohorts, element) / Math.max(1, scenario.days),
      outputValuePerDay: tally.outputValue / Math.max(1, scenario.days),
      selfSufficiency:
        tally.outputValue + tally.imports <= 0
          ? 1
          : Math.max(0, Math.min(1, tally.outputValue / (tally.outputValue + tally.imports))),
      selfSufficiencyIndex: selfSufficiencyIndex(tally.produced, tally.needed, model),
      importsGoldPerDay: tally.imports / Math.max(1, scenario.days),
      exportsGoldPerDay: tally.exports / Math.max(1, scenario.days),
      physicalMaxCapacity: islandCapacity(element),
      developedCapacity: cohort?.developed ?? emptyCapacity(),
      homeCapacityUtilization: utilization(workAverage, tally.capacity),
      workplaceUtilization: tally.slots <= 0 ? 0 : Math.min(1, tally.workers / tally.slots),
      workerProductivity: productivity,
      importDependency: itemDependency(tally.produced, tally.needed, tally.consumed, scenario.days),
      ...advantageSplit(element),
      rawResourceSpecializationAdvantage: rawResourceSpecializationAdvantage(element),
      marginalCapacityCost: primaryMarginalCost(element, model, cohort, priceMap),
      capacityPaybackDays: payback,
      processingMargin: tally.processingInputValue <= 0 ? 1 : tally.processingOutputValue / tally.processingInputValue,
      upgradeVsImportRatio: (payback[nextStep - 1] ?? 0) / 30
    };
  });

  const perItem: ItemMetrics[] = [...productionTotal.keys()]
    .filter((item) => (productionTotal.get(item) ?? 0) > 0 || (consumptionTotal.get(item) ?? 0) > 0)
    .map((item) => {
      const itemNeed = needTotal.get(item) ?? 0;
      const itemUnmet = unmetTotal.get(item) ?? 0;
      return {
        itemDefinitionId: item,
        producedPerDay: (productionTotal.get(item) ?? 0) / scenario.days,
        consumedPerDay: (consumptionTotal.get(item) ?? 0) / scenario.days,
        scarcity: itemNeed <= 0 ? 0 : Math.max(0, Math.min(1, itemUnmet / itemNeed)),
        baseValue: baseValue(item, model.baseline),
        clearingPrice:
          baseValue(item, model.baseline) *
          (1 + model.market.scarcitySensitivity * (itemNeed <= 0 ? 0 : Math.max(0, Math.min(1, itemUnmet / itemNeed))))
      };
    })
    .sort((left, right) => right.scarcity - left.scarcity || left.itemDefinitionId.localeCompare(right.itemDefinitionId));

  const consumedValue = consumptionValue(elementTallies, model);
  return {
    scenarioId: scenario.id,
    days: scenario.days,
    actors: scenario.actors,
    daily,
    totals: {
      goldCreated: totals.goldCreated,
      goldDestroyed: totals.goldDestroyed,
      goldTransferred: totals.marketVolumeGold,
      netGold: totals.goldCreated - totals.goldDestroyed,
      goldEnd: cohorts.reduce((sum, cohort) => sum + cohort.gold, 0),
      xpTotal: cohorts.reduce((sum, cohort) => sum + cohort.xp, 0),
      marketVolumeGold: totals.marketVolumeGold,
      feesDestroyed: totals.fees,
      npcShopImportsGold: totals.npcShopImportsGold,
      marketImportsGold: totals.marketImportsGold,
      npcShopShareOfInput: consumedValue <= 0 ? 0 : Math.min(1, totals.npcShopImportsGold / (consumedValue + totals.npcShopImportsGold)),
      marketShareOfInput: consumedValue <= 0 ? 0 : Math.min(1, totals.marketImportsGold / (consumedValue + totals.marketImportsGold)),
      storage: { first50: totals.first50, first80: totals.first80, firstFull: totals.firstFull },
      storageConstrainedPercent: scenario.days <= 0 ? 0 : totals.constrainedDays / scenario.days,
      lostOutputToStorage: totals.lostOutputToStorage,
      timeToStoragePressureDays: totals.timeToStoragePressureDays,
      timeToUpgradeDays: totals.timeToUpgradeDays
    } satisfies SimulationTotals,
    perElement,
    perItem,
    findings: []
  };
}

/** Cohorts aggregate by (element x archetype); everything reads them through these helpers. */
function currentGold(cohorts: Cohort[], element: ElementId): number {
  return cohorts.filter((cohort) => cohort.element === element).reduce((sum, cohort) => sum + cohort.gold, 0);
}

function xpFor(cohorts: Cohort[], element: ElementId): number {
  return cohorts.filter((cohort) => cohort.element === element).reduce((sum, cohort) => sum + cohort.xp, 0);
}

function scaleTally(tally: ProfessionTally, divisor: number): ProfessionTally {
  const out = emptyTally();
  for (const profession of PROFESSIONS) out[profession] = tally[profession] / Math.max(1, divisor);
  return out;
}

function utilization(work: ProfessionTally, capacity: ProfessionTally): ProfessionTally {
  const out = emptyTally();
  for (const profession of PROFESSIONS) {
    out[profession] = capacity[profession] <= 0 ? 0 : Math.max(0, Math.min(1, work[profession] / capacity[profession]));
  }
  return out;
}

function workplaceUtilization(cohorts: Cohort[]): number {
  let workers = 0;
  let slots = 0;
  for (const cohort of cohorts) {
    workers += cohort.workers;
    slots += cohort.slots;
  }
  return slots <= 0 ? 0 : Math.max(0, Math.min(1, workers / slots));
}

function itemDependency(
  produced: Map<string, number>,
  needed: Map<string, number>,
  consumed: Map<string, number>,
  days: number
): readonly ItemDependency[] {
  const items = new Set<string>([...consumed.keys(), ...needed.keys()]);
  return [...items]
    .filter((item) => (consumed.get(item) ?? 0) > 0 || (needed.get(item) ?? 0) > 0)
    .map((item) => {
      const consumedTotal = consumed.get(item) ?? 0;
      const producedTotal = produced.get(item) ?? 0;
      const neededTotal = needed.get(item) ?? 0;
      return {
        itemDefinitionId: item,
        producedPerDay: producedTotal / days,
        consumedPerDay: consumedTotal / days,
        // External supply required over total demand: what the island could not cover from its own
        // sustainable production, however much of it the market then managed to source.
        importDependency:
          producedTotal + neededTotal <= 0 ? 0 : Math.max(0, Math.min(1, neededTotal / (neededTotal + producedTotal)))
      };
    })
    .sort((left, right) => right.importDependency - left.importDependency || left.itemDefinitionId.localeCompare(right.itemDefinitionId));
}

function selfSufficiencyIndex(produced: Map<string, number>, needed: Map<string, number>, model: EconomyModel): number {
  let local = 0;
  let demand = 0;
  for (const item of new Set([...produced.keys(), ...needed.keys()])) {
    local += (produced.get(item) ?? 0) * baseValue(item, model.baseline);
    demand += ((produced.get(item) ?? 0) + (needed.get(item) ?? 0)) * baseValue(item, model.baseline);
  }
  return demand <= 0 ? 1 : Math.max(0, Math.min(1, local / demand));
}

function advantageSplit(element: ElementId): {
  physicalCapacityAdvantage: number;
  efficiencyAdvantage: number;
  totalSpecializationAdvantage: number;
} {
  const physical =
    PROFESSIONS.reduce((sum, profession) => sum + physicalCapacityMultiplier(element, profession), 0) / PROFESSIONS.length;
  const efficiency = PROFESSIONS.reduce((sum, profession) => sum + efficiencyFor(element, profession), 0) / PROFESSIONS.length;
  return {
    physicalCapacityAdvantage: physical - 1,
    efficiencyAdvantage: efficiency - 1,
    totalSpecializationAdvantage: physical * efficiency - 1
  };
}

function primaryMarginalCost(
  element: ElementId,
  model: EconomyModel,
  cohort: Cohort | undefined,
  prices: Readonly<Record<string, number>>
): number {
  const primary = primaryProfession(element);
  const nextStep = (cohort?.tier[primary] ?? 0) + 1;
  return marginalCapacityCost(element, primary, nextStep, model.baseline, prices, model.development);
}

function primaryProfession(element: ElementId): Profession {
  return ELEMENT_PROFILES[element].primaryProfession;
}

function consumptionValue(elementTallies: Map<ElementId, ElementTally>, model: EconomyModel): number {
  let total = 0;
  for (const tally of elementTallies.values()) {
    for (const [item, quantity] of tally.consumed) total += quantity * baseValue(item, model.baseline);
  }
  return total;
}

function emptyCapacity(): IslandCapacity {
  return { farmTiles: 0, fishingSpots: 0, miningNodes: 0, forestryNodes: 0, livestockPens: 0, processingLanes: 0 };
}
