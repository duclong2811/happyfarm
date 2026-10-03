import type { EconomyBaseline } from "./baseline";
import { ELEMENT_IDS, islandCapacity, type ElementId, type Profession } from "./elements";
import {
  ACTOR_PROFILES,
  professionRates,
  type ActorProfile,
  type EconomyModel,
  type Recipe
} from "./model";
import {
  type DayMetrics,
  type ElementMetrics,
  type ItemMetrics,
  type SimulationResult,
  type SimulationTotals
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
 *   * gold moves between cohorts or is created by the NPC shop and destroyed by purchases, wages, fees,
 *     upgrades and sinks - a market trade never creates gold;
 *   * goods move between cohorts, are consumed by recipes, livestock, workers and sinks, or are wasted
 *     by a full store - a recipe never makes raw material from nothing;
 *   * nothing goes negative: a cohort spends what it has and no more.
 */

/** Future goods the model trades but the game does not yet ship, with their modelled base value. */
export const MODEL_ITEM_VALUES: Readonly<Record<string, number>> = {
  item_steel: 14,
  item_timber: 4,
  item_tools: 30,
  item_provisions: 10,
  item_meat: 6,
  item_eggs: 4,
  item_milk: 5,
  item_hide: 8,
  item_wool: 6
};

/** What counts as a staple and as protein, so a worker eats what the island grows rather than one id. */
const STAPLES = ["item_potato", "item_wheat", "item_corn", "item_cabbage", "item_pumpkin"];
const PROTEINS = ["item_fish_sardine", "item_fish_mackerel", "item_fish_snapper", "item_fish_tuna", "item_meat", "item_eggs"];

/** How a player of an element splits their attention across the gather professions. */
const TIME_SHARE: Readonly<Record<ElementId, Readonly<Partial<Record<Profession, number>>>>> = {
  EARTH: { FARMING: 0.65, FISHING: 0.1, MINING: 0.05, FORESTRY: 0.2 },
  WATER: { FARMING: 0.1, FISHING: 0.75, MINING: 0.05, FORESTRY: 0.1 },
  WOOD: { FARMING: 0.15, FISHING: 0.1, MINING: 0.05, FORESTRY: 0.7 },
  METAL: { FARMING: 0.1, FISHING: 0.05, MINING: 0.75, FORESTRY: 0.1 },
  FIRE: { FARMING: 0.25, FISHING: 0.1, MINING: 0.05, FORESTRY: 0.6 }
};

/** What a player keeps on hand before selling the rest: a working stock, not a hoard. */
const RESERVE_PER_PLAYER = 20;

interface Cohort {
  readonly element: ElementId;
  readonly archetype: ActorProfile;
  readonly players: number;
  gold: number;
  xp: number;
  readonly inventory: Map<string, number>;
  storageTier: number;
  workers: number;
}

/** One day's tally for one cohort, so per-element metrics never have to be guessed afterwards. */
interface CohortDay {
  actions: number;
  capacityActions: number;
  producedValue: number;
  importedGold: number;
  exportedGold: number;
  workerProduced: number;
  workerPossible: number;
}

function emptyDay(): CohortDay {
  return {
    actions: 0,
    capacityActions: 0,
    producedValue: 0,
    importedGold: 0,
    exportedGold: 0,
    workerProduced: 0,
    workerPossible: 0
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
  if (left <= 0) cohort.inventory.delete(item);
  else cohort.inventory.set(item, left);
  return taken;
}

/** Take up to `wanted` from whichever of `items` the cohort holds, cheapest first. */
function takeAny(cohort: Cohort, items: readonly string[], wanted: number): number {
  let remaining = wanted;
  let taken = 0;
  for (const item of items) {
    if (remaining <= 0) break;
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
function give(cohort: Cohort, item: string, quantity: number, wasted: Map<string, number>, capacity: number): void {
  if (quantity <= 0) return;
  const held = cohort.inventory.get(item) ?? 0;
  const ceiling = capacity * cohort.players;
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

/** A player's action count for one profession: what their time allows, capped by the island. */
function actionsFor(
  cohort: Cohort,
  capacityActions: number,
  secondsPerAction: number,
  share: number
): number {
  const active = (cohort.players * cohort.archetype.activeSecondsPerDay * share) / Math.max(1, secondsPerAction);
  const capped = capacityActions * cohort.players * cohort.archetype.capacityUsage;
  return Math.max(0, Math.min(active, capped));
}

function produce(
  cohort: Cohort,
  model: EconomyModel,
  day: CohortDay,
  produced: Map<string, number>,
  wasted: Map<string, number>,
  goldSink: { value: number }
): void {
  const rates = professionRates(model.baseline, cohort.element);
  const capacity = islandCapacity(cohort.element);
  const shares = TIME_SHARE[cohort.element];
  const capacityActions: Record<Profession, number> = {
    FARMING: (capacity.farmTiles / 144) * 144,
    FISHING: capacity.fishingSpots * (86400 / 15),
    MINING: capacity.miningNodes * (86400 / 8),
    FORESTRY: capacity.forestryNodes * (86400 / 6),
    LIVESTOCK: 0,
    PROCESSING: 0
  };
  for (const profession of ["FARMING", "FISHING", "MINING", "FORESTRY"] as const) {
    const share = shares[profession] ?? 0;
    const rate = rates[profession];
    if (share <= 0 || rate === undefined || rate.itemDefinitionId === null) continue;
    const actions = actionsFor(cohort, capacityActions[profession], rate.secondsPerAction, share);
    day.actions += actions;
    day.capacityActions += capacityActions[profession] * cohort.players * cohort.archetype.capacityUsage * share;
    if (actions <= 0) continue;
    const units = actions * rate.itemPerAction;
    add(produced, rate.itemDefinitionId, units);
    give(cohort, rate.itemDefinitionId, units, wasted, capacityPerResource(model, cohort));
    day.producedValue += units * baseValue(rate.itemDefinitionId, model.baseline);
    cohort.xp += actions * rate.xpPerAction;
    // Farming buys its seed; the gather professions buy nothing.
    if (profession === "FARMING") {
      const seedCost = actions * Math.min(...model.baseline.crops.map((crop) => crop.seedCost));
      const paid = Math.min(cohort.gold, seedCost);
      cohort.gold -= paid;
      goldSink.value += paid;
    }
  }
}

function runLivestock(
  cohort: Cohort,
  model: EconomyModel,
  day: CohortDay,
  produced: Map<string, number>,
  consumed: Map<string, number>,
  wasted: Map<string, number>
): void {
  if (!model.livestock.enabled) return;
  const pens = islandCapacity(cohort.element).livestockPens * cohort.players * cohort.archetype.capacityUsage;
  if (pens <= 0) return;
  const feedWanted = pens * model.livestock.staplesPerPenPerDay;
  const fed = takeAny(cohort, STAPLES, feedWanted);
  add(consumed, "item_potato", fed);
  const fedShare = feedWanted <= 0 ? 1 : fed / feedWanted;
  const output = pens * model.livestock.stablePerPenPerDay * fedShare;
  const half = output / 2;
  add(produced, "item_meat", half);
  add(produced, "item_eggs", half);
  give(cohort, "item_meat", half, wasted, capacityPerResource(model, cohort));
  give(cohort, "item_eggs", half, wasted, capacityPerResource(model, cohort));
  day.producedValue +=
    half * (baseValue("item_meat", model.baseline) + baseValue("item_eggs", model.baseline));
  cohort.gold += pens * model.livestock.goldPerPenPerDay * fedShare;
  cohort.xp += pens * model.livestock.xpPerPenPerDay * fedShare;
}

function affordableBatches(cohort: Cohort, recipe: Recipe, wanted: number): number {
  let batches = wanted;
  for (const [item, quantity] of Object.entries(recipe.inputs)) {
    batches = Math.min(batches, Math.floor((cohort.inventory.get(item) ?? 0) / quantity));
  }
  return Math.max(0, batches);
}

function runProcessing(
  cohort: Cohort,
  model: EconomyModel,
  day: CohortDay,
  produced: Map<string, number>,
  consumed: Map<string, number>,
  wasted: Map<string, number>
): void {
  if (!model.processing.enabled) return;
  const lanes = islandCapacity(cohort.element).processingLanes * cohort.players * cohort.archetype.capacityUsage;
  for (const recipe of model.processing.recipes) {
    const wanted = Math.floor(lanes * (86400 / Math.max(1, recipe.secondsPerBatch)));
    const batches = affordableBatches(cohort, recipe, wanted);
    if (batches <= 0) continue;
    for (const [item, quantity] of Object.entries(recipe.inputs)) {
      add(consumed, item, take(cohort, item, quantity * batches));
    }
    const output = recipe.outputQuantity * batches;
    add(produced, recipe.output, output);
    give(cohort, recipe.output, output, wasted, capacityPerResource(model, cohort));
    day.producedValue += output * baseValue(recipe.output, model.baseline);
  }
}

/**
 * Workers add throughput, and cost food, wages and housing.
 *
 * The point of modelling them is the *check*: a worker whose food and wages cost more than the goods
 * they produce is a trap, and a worker whose output compounds without a limit is an exploit. The
 * engine computes their productivity so `report.ts` can say which happened.
 */
function runWorkers(
  cohort: Cohort,
  model: EconomyModel,
  day: CohortDay,
  produced: Map<string, number>,
  consumed: Map<string, number>,
  wasted: Map<string, number>,
  goldSink: { value: number }
): void {
  if (!model.workers.enabled) return;
  const housing = Math.min(
    model.workers.housingCapacityPerIsland * cohort.players,
    cohort.archetype.workers * cohort.players
  );
  cohort.workers = Math.max(0, Math.min(cohort.workers === 0 ? housing : cohort.workers, housing));
  const workers = cohort.workers;
  if (workers <= 0) return;

  const staplesWanted = workers * model.workers.staplePerWorkerPerDay;
  const proteinWanted = workers * model.workers.proteinPerWorkerPerDay;
  const staples = takeAny(cohort, STAPLES, staplesWanted);
  const protein = takeAny(cohort, PROTEINS, proteinWanted);
  add(consumed, "item_potato", staples);
  add(consumed, "item_fish_sardine", protein);
  const fed = Math.min(
    1,
    Math.min(staples / Math.max(1, staplesWanted), protein / Math.max(1, proteinWanted))
  );
  const foodProductivity = model.workers.starvedProductivity + (1 - model.workers.starvedProductivity) * fed;

  const wages = workers * model.workers.goldUpkeepPerWorkerPerDay;
  const paid = Math.min(cohort.gold, wages);
  cohort.gold -= paid;
  goldSink.value += paid;
  const paidShare = wages <= 0 ? 1 : paid / wages;
  const effective = foodProductivity * Math.min(1, paidShare);

  const rates = professionRates(model.baseline, cohort.element);
  const primary: Profession =
    cohort.element === "EARTH"
      ? "FARMING"
      : cohort.element === "WATER"
        ? "FISHING"
        : cohort.element === "METAL"
          ? "MINING"
          : "FORESTRY";
  const rate = rates[primary];
  const possible = workers * model.workers.actionsPerWorkerPerDay;
  const actions = possible * effective;
  day.workerPossible += possible;
  day.workerProduced += actions;
  if (rate !== undefined && rate.itemDefinitionId !== null) {
    const units = actions * rate.itemPerAction;
    add(produced, rate.itemDefinitionId, units);
    give(cohort, rate.itemDefinitionId, units, wasted, capacityPerResource(model, cohort));
    day.producedValue += units * baseValue(rate.itemDefinitionId, model.baseline);
    cohort.xp += actions * rate.xpPerAction;
  }
}

function runSinks(
  cohort: Cohort,
  model: EconomyModel,
  consumed: Map<string, number>,
  goldSink: { value: number }
): void {
  for (const sink of model.sinks) {
    if (!sink.enabled) continue;
    for (const [item, perPlayer] of Object.entries(sink.itemsPerPlayerPerDay)) {
      const used = takeAny(cohort, [item], perPlayer * cohort.players);
      add(consumed, item, used);
    }
    const goldWanted = sink.goldPerPlayerPerDay * cohort.players;
    const paid = Math.min(cohort.gold, goldWanted);
    cohort.gold -= paid;
    goldSink.value += paid;
  }
}

function sellToNpcShop(cohort: Cohort, model: EconomyModel, goldCreated: { value: number }): void {
  for (const [item, held] of [...cohort.inventory.entries()]) {
    const sellPrice = model.baseline.sellPrices[item];
    if (sellPrice === undefined) continue;
    const surplus = held - RESERVE_PER_PLAYER * cohort.players;
    if (surplus <= 0) continue;
    const cap = model.npcShop.dailyPurchaseCapPerItem * cohort.players;
    const sold = Math.min(surplus, cap);
    if (sold <= 0) continue;
    take(cohort, item, sold);
    const gold = sold * sellPrice;
    cohort.gold += gold;
    goldCreated.value += gold;
  }
}

function buyStorageUpgrades(cohort: Cohort, model: EconomyModel, goldSink: { value: number }): number {
  if (!model.storage.enabled) return 0;
  if (storageFill(cohort, model) < 0.9) return 0;
  const cost = storageUpgradeCost(model, cohort);
  if (cohort.gold < cost.gold) return 0;
  for (const [item, quantity] of Object.entries(cost.materials)) {
    if ((cohort.inventory.get(item) ?? 0) < quantity) return 0;
  }
  cohort.gold -= cost.gold;
  goldSink.value += cost.gold;
  for (const [item, quantity] of Object.entries(cost.materials)) take(cohort, item, quantity);
  cohort.storageTier += 1;
  return 1;
}

interface MarketOutcome {
  readonly volumeGold: number;
  readonly fees: number;
  readonly unmet: Map<string, number>;
  readonly demand: Map<string, number>;
  readonly clearingPrices: Map<string, number>;
}

/**
 * The player market: surplus meets deficit at a scarcity-derived price.
 *
 * Gold and goods only ever move between cohorts - the fee is the one thing destroyed - so a market can
 * never create wealth, and a shortage shows up as a price rather than as a free lunch. Only goods the
 * buyer may actually hold are traded, and a buyer spends what it has.
 */
function runMarket(cohorts: Cohort[], model: EconomyModel, days: CohortDay[]): MarketOutcome {
  const unmet = new Map<string, number>();
  const demand = new Map<string, number>();
  const clearingPrices = new Map<string, number>();
  let volumeGold = 0;
  let fees = 0;
  if (!model.market.enabled) return { volumeGold, fees, unmet, demand, clearingPrices };

  const items = new Set<string>();
  for (const cohort of cohorts) for (const item of cohort.inventory.keys()) items.add(item);
  for (const item of Object.keys(MODEL_ITEM_VALUES)) items.add(item);

  for (const item of items) {
    const sellers = cohorts
      .map((cohort) => {
        const held = cohort.inventory.get(item) ?? 0;
        return { cohort, surplus: Math.max(0, held - RESERVE_PER_PLAYER * cohort.players) };
      })
      .filter((entry) => entry.surplus > 0);
    const buyers = cohorts
      .map((cohort) => {
        const held = cohort.inventory.get(item) ?? 0;
        return { cohort, deficit: Math.max(0, RESERVE_PER_PLAYER * cohort.players - held) };
      })
      .filter((entry) => entry.deficit > 0 && entry.cohort.gold > 0);
    if (sellers.length === 0 || buyers.length === 0) continue;

    const supply = sellers.reduce((sum, entry) => sum + entry.surplus, 0);
    const wanted = buyers.reduce((sum, entry) => sum + entry.deficit, 0);
    add(demand, item, wanted);
    const base = baseValue(item, model.baseline);
    const scarcity = wanted / Math.max(1, wanted + supply);
    const price = base * (1 + model.market.scarcitySensitivity * scarcity);
    clearingPrices.set(item, price);

    for (const buyer of buyers) {
      const affordable = Math.min(buyer.deficit, Math.floor(buyer.cohort.gold / price));
      if (affordable <= 0) continue;
      let remaining = affordable;
      for (const seller of sellers) {
        if (remaining <= 0) break;
        const available = Math.max(0, seller.cohort.inventory.get(item) ?? 0);
        const sold = Math.min(seller.surplus, remaining, available);
        if (sold <= 0) continue;
        const gross = sold * price;
        const fee = gross * model.market.feeRate;
        take(seller.cohort, item, sold);
        seller.cohort.gold += gross - fee;
        buyer.cohort.gold -= gross;
        buyer.cohort.inventory.set(item, (buyer.cohort.inventory.get(item) ?? 0) + sold);
        const buyerDay = days[cohorts.indexOf(buyer.cohort)];
        const sellerDay = days[cohorts.indexOf(seller.cohort)];
        if (buyerDay !== undefined) buyerDay.importedGold += gross;
        if (sellerDay !== undefined) sellerDay.exportedGold += gross;
        volumeGold += gross;
        fees += fee;
        remaining -= sold;
      }
      const bought = affordable - remaining;
      if (bought < buyer.deficit) {
        add(unmet, item, buyer.deficit - bought);
      }
    }
  }
  return { volumeGold, fees, unmet, demand, clearingPrices };
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
      cohorts.push({
        element,
        archetype: ACTOR_PROFILES[archetypeId as ActorProfile["id"]],
        players,
        // Every player starts with the starter package's gold.
        gold: 100 * players,
        xp: 0,
        inventory: new Map(),
        storageTier: 0,
        workers: 0
      });
    }
  }

  const daily: DayMetrics[] = [];
  const totals = {
    goldCreated: 0,
    goldDestroyed: 0,
    xp: 0,
    marketVolumeGold: 0,
    fees: 0,
    timeToStoragePressureDays: null as number | null,
    timeToUpgradeDays: null as number | null
  };
  const productionTotal = new Map<string, number>();
  const consumptionTotal = new Map<string, number>();
  const unmetTotal = new Map<string, number>();
  const demandTotal = new Map<string, number>();
  const clearingPrices = new Map<string, number>();
  const perElementOutputValue = new Map<ElementId, number>();
  const perElementGoldStart = new Map<ElementId, number>();
  const perElementImports = new Map<ElementId, number>();
  const perElementExports = new Map<ElementId, number>();
  const perElementXp = new Map<ElementId, number>();
  for (const cohort of cohorts) {
    perElementGoldStart.set(cohort.element, (perElementGoldStart.get(cohort.element) ?? 0) + cohort.gold);
  }

  for (let dayNumber = 1; dayNumber <= scenario.days; dayNumber += 1) {
    const production = new Map<string, number>();
    const consumption = new Map<string, number>();
    const wasted = new Map<string, number>();
    const goldCreated = { value: 0 };
    const goldSink = { value: 0 };
    const days: CohortDay[] = cohorts.map(() => emptyDay());
    let storageUpgrades = 0;
    let fill = 0;

    cohorts.forEach((cohort, index) => {
      const day = days[index];
      if (day === undefined) return;
      produce(cohort, active, day, production, wasted, goldSink);
      runLivestock(cohort, active, day, production, consumption, wasted);
      runWorkers(cohort, active, day, production, consumption, wasted, goldSink);
      runProcessing(cohort, active, day, production, consumption, wasted);
      runSinks(cohort, active, consumption, goldSink);
      sellToNpcShop(cohort, active, goldCreated);
      if (scenario.features.upgrades) storageUpgrades += buyStorageUpgrades(cohort, active, goldSink);
      fill = Math.max(fill, storageFill(cohort, active));
    });

    const market = runMarket(cohorts, active, days);
    for (const [item, quantity] of market.unmet) add(unmetTotal, item, quantity);
    for (const [item, quantity] of market.demand) add(demandTotal, item, quantity);
    for (const [item, price] of market.clearingPrices) clearingPrices.set(item, price);
    for (const [item, quantity] of production) add(productionTotal, item, quantity);
    for (const [item, quantity] of consumption) add(consumptionTotal, item, quantity);

    let actions = 0;
    let capacityActions = 0;
    let workerProduced = 0;
    let workerPossible = 0;
    cohorts.forEach((cohort, index) => {
      const day = days[index];
      if (day === undefined) return;
      actions += day.actions;
      capacityActions += day.capacityActions;
      workerProduced += day.workerProduced;
      workerPossible += day.workerPossible;
      perElementOutputValue.set(cohort.element, (perElementOutputValue.get(cohort.element) ?? 0) + day.producedValue);
      perElementImports.set(cohort.element, (perElementImports.get(cohort.element) ?? 0) + day.importedGold);
      perElementExports.set(cohort.element, (perElementExports.get(cohort.element) ?? 0) + day.exportedGold);
      perElementXp.set(cohort.element, (perElementXp.get(cohort.element) ?? 0) + cohort.xp);
    });

    const goldTotal = cohorts.reduce((sum, cohort) => sum + cohort.gold, 0);
    if (totals.timeToStoragePressureDays === null && fill >= 0.9) {
      totals.timeToStoragePressureDays = dayNumber;
    }
    if (totals.timeToUpgradeDays === null && storageUpgrades > 0) {
      totals.timeToUpgradeDays = dayNumber;
    }
    totals.goldCreated += goldCreated.value;
    totals.goldDestroyed += goldSink.value + market.fees;
    totals.marketVolumeGold += market.volumeGold;
    totals.fees += market.fees;
    totals.xp = cohorts.reduce((sum, cohort) => sum + cohort.xp, 0);

    daily.push({
      day: dayNumber,
      goldCreated: goldCreated.value,
      goldDestroyed: goldSink.value + market.fees,
      goldTotal,
      production: Object.fromEntries(production),
      consumption: Object.fromEntries(consumption),
      wasted: Object.fromEntries(wasted),
      marketVolumeGold: market.volumeGold,
      marketFeesDestroyed: market.fees,
      xpGained: totals.xp,
      storageFillRate: fill,
      ceilingUtilization: capacityActions <= 0 ? 0 : Math.min(1, actions / capacityActions),
      npcProductivity: workerPossible <= 0 ? 0 : workerProduced / workerPossible,
      storageUpgrades
    });
  }

  const perElement: ElementMetrics[] = ELEMENT_IDS.filter((id) => scenario.elementMix[id] > 0).map((element) => {
    const elementCohorts = cohorts.filter((cohort) => cohort.element === element);
    const players = elementCohorts.reduce((sum, cohort) => sum + cohort.players, 0);
    const goldEnd = elementCohorts.reduce((sum, cohort) => sum + cohort.gold, 0);
    const goldStart = perElementGoldStart.get(element) ?? 0;
    const produced = perElementOutputValue.get(element) ?? 0;
    const imported = perElementImports.get(element) ?? 0;
    const exported = perElementExports.get(element) ?? 0;
    // Self-sufficiency is produced value over produced-plus-imported value: how much of what the
    // element consumed it made itself.
    const selfSufficiency = produced + imported <= 0 ? 1 : produced / (produced + imported);
    return {
      element,
      players,
      goldPerDay: (goldEnd - goldStart) / Math.max(1, scenario.days),
      xpPerDay: (perElementXp.get(element) ?? 0) / Math.max(1, scenario.days),
      outputValuePerDay: produced / Math.max(1, scenario.days),
      selfSufficiency,
      importsGoldPerDay: imported / Math.max(1, scenario.days),
      exportsGoldPerDay: exported / Math.max(1, scenario.days)
    };
  });

  const perItem: ItemMetrics[] = [...productionTotal.keys()]
    .filter((item) => (productionTotal.get(item) ?? 0) > 0 || (consumptionTotal.get(item) ?? 0) > 0)
    .map((item) => {
      const itemDemand = demandTotal.get(item) ?? 0;
      const itemUnmet = unmetTotal.get(item) ?? 0;
      return {
        itemDefinitionId: item,
        producedPerDay: (productionTotal.get(item) ?? 0) / scenario.days,
        consumedPerDay: (consumptionTotal.get(item) ?? 0) / scenario.days,
        scarcity: itemDemand <= 0 ? 0 : itemUnmet / itemDemand,
        baseValue: baseValue(item, model.baseline),
        clearingPrice: clearingPrices.get(item) ?? baseValue(item, model.baseline)
      };
    })
    .sort((left, right) => right.scarcity - left.scarcity || left.itemDefinitionId.localeCompare(right.itemDefinitionId));

  return {
    scenarioId: scenario.id,
    days: scenario.days,
    actors: scenario.actors,
    daily,
    totals: {
      goldCreated: totals.goldCreated,
      goldDestroyed: totals.goldDestroyed,
      netGold: totals.goldCreated - totals.goldDestroyed,
      goldEnd: cohorts.reduce((sum, cohort) => sum + cohort.gold, 0),
      xpTotal: totals.xp,
      marketVolumeGold: totals.marketVolumeGold,
      feesDestroyed: totals.fees,
      timeToStoragePressureDays: totals.timeToStoragePressureDays,
      timeToUpgradeDays: totals.timeToUpgradeDays
    } satisfies SimulationTotals,
    perElement,
    perItem,
    findings: []
  };
}
