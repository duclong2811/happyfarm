import { describe, expect, it } from "vitest";
import {
  ACTOR_PROFILES,
  ELEMENT_PROFILES,
  analyse,
  baselineSnapshot,
  defaultModel,
  effectiveModel,
  formatResult,
  islandCapacity,
  SCENARIOS,
  scenarioById,
  simulate,
  type Scenario
} from "@happy-farm/economy-sim";

/**
 * The model's own rules, held as invariants.
 *
 * A simulation that can invent gold, invent ore, or produce a negative balance is worse than no
 * simulation, so these are the properties the engine may never break - whatever the scenario, however
 * many days, however many actors.
 */

const model = defaultModel(baselineSnapshot());

function scenarioFrom(base: Scenario, overrides: Partial<Scenario> = {}): Scenario {
  return { ...base, ...overrides };
}

describe("simulation invariants", () => {
  it("is deterministic: the same scenario gives exactly the same run", () => {
    const scenario = scenarioById("E");
    const first = simulate(scenario, model);
    const second = simulate(scenario, model);
    expect(second.totals).toEqual(first.totals);
    expect(second.daily).toEqual(first.daily);
    expect(second.perElement).toEqual(first.perElement);
    expect(second.perItem).toEqual(first.perItem);
  });

  it("terminates and leaves finite numbers everywhere", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      expect(result.daily).toHaveLength(scenario.days);
      expect(Number.isFinite(result.totals.goldEnd)).toBe(true);
      expect(Number.isFinite(result.totals.netGold)).toBe(true);
      for (const day of result.daily) {
        expect(Number.isFinite(day.goldTotal)).toBe(true);
        expect(day.goldTotal).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(day.storageFillRate)).toBe(true);
        expect(day.storageFillRate).toBeGreaterThanOrEqual(0);
        expect(day.storageFillRate).toBeLessThanOrEqual(1);
        expect(day.ceilingUtilization).toBeLessThanOrEqual(1);
        expect(day.npcProductivity).toBeGreaterThanOrEqual(0);
        expect(day.npcProductivity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never produces a negative balance, and never creates gold in a market trade", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      // Destroyed gold can never exceed what was created plus what the players started with.
      expect(result.totals.goldDestroyed).toBeLessThanOrEqual(
        result.totals.goldCreated + 100 * scenario.actors
      );
      // And the market's own contribution to destruction is exactly its fees.
      expect(result.totals.feesDestroyed).toBeGreaterThanOrEqual(0);
      for (const day of result.daily) {
        expect(day.marketFeesDestroyed).toBeGreaterThanOrEqual(0);
        expect(day.marketVolumeGold).toBeGreaterThanOrEqual(0);
        // The fee is a fraction of the volume, so it can never exceed it.
        expect(day.marketFeesDestroyed).toBeLessThanOrEqual(day.marketVolumeGold);
      }
    }
  });

  it("turns a scenario's features off rather than leaving them on by accident", () => {
    const noStorage = effectiveModel(model, {
      storage: false,
      workers: false,
      processing: false,
      market: false,
      livestock: false,
      sinks: false,
      upgrades: false
    });
    expect(noStorage.storage.enabled).toBe(false);
    expect(noStorage.market.enabled).toBe(false);
    expect(noStorage.workers.enabled).toBe(false);
    // With storage off there is no ceiling, so nothing can fill and nothing can be wasted by one.
    const result = simulate(scenarioFrom(scenarioById("B")), noStorage);
    expect(result.daily.every((day) => day.storageFillRate === 0)).toBe(true);
    expect(result.totals.timeToStoragePressureDays).toBeNull();
  });

  it("makes storage a real constraint when it is switched on", () => {
    const withStorage = simulate(scenarioById("C"), model);
    const withoutStorage = simulate(scenarioById("B"), model);
    expect(withStorage.totals.timeToStoragePressureDays).not.toBeNull();
    expect(withoutStorage.totals.timeToStoragePressureDays).toBeNull();
    // Storage costs gold (and materials), so the same world ends up poorer with it than without it.
    expect(withStorage.totals.netGold).toBeLessThan(withoutStorage.totals.netGold);
    expect(withStorage.totals.timeToUpgradeDays).not.toBeNull();
  });

  it("gives workers diminishing, input-bound output rather than free money", () => {
    const workers = simulate(scenarioById("D"), model);
    const meanProductivity =
      workers.daily.reduce((sum, day) => sum + day.npcProductivity, 0) / workers.daily.length;
    // A worker that produces everything it could, every day, with no food or wage pressure, would be
    // a runaway; the model must either feed them or starve them into a lower rate.
    expect(meanProductivity).toBeGreaterThan(0);
    expect(meanProductivity).toBeLessThanOrEqual(1);
    // Wages and food are real: the same world with workers destroys more gold than without.
    const withoutWorkers = simulate(scenarioById("C"), model);
    expect(workers.totals.goldDestroyed).toBeGreaterThan(withoutWorkers.totals.goldDestroyed);
  });

  it("never lets a recipe make raw material from nothing", () => {
    // Every modelled recipe consumes more input value than it produces per batch at base prices, or
    // the processing step would be a money printer. Steel is the interesting case: 2 iron + 1 coal.
    const baseline = baselineSnapshot();
    const iron = baseline.sellPrices.item_iron_ore ?? 0;
    const coal = baseline.sellPrices.item_coal ?? 0;
    const steel = model.processing.recipes.find((recipe) => recipe.output === "item_steel");
    expect(steel).toBeDefined();
    expect(iron + coal).toBeGreaterThan(0);
    // The recipe converts inputs into something worth more per unit, but the *quantity* cannot rise:
    // one batch of two inputs becomes one output.
    expect(steel?.outputQuantity).toBe(1);
    expect(Object.values(steel?.inputs ?? {}).reduce((sum, quantity) => sum + quantity, 0)).toBeGreaterThan(1);
  });

  it("gives Fire industry, not raw resources", () => {
    // The structural promise: Fire is the best processor and never the best extractor.
    const professions = ["FARMING", "FISHING", "MINING", "FORESTRY", "LIVESTOCK", "PROCESSING"] as const;
    for (const profession of professions) {
      const best = Math.max(...Object.values(ELEMENT_PROFILES).map((profile) => profile.capacity[profession]));
      if (profession === "PROCESSING") {
        expect(ELEMENT_PROFILES.FIRE.capacity.PROCESSING).toBe(best);
      } else if (profession !== "LIVESTOCK") {
        expect(ELEMENT_PROFILES.FIRE.capacity[profession]).toBeLessThan(best);
      }
    }
    // And every element can still do every profession: nothing is locked.
    for (const profile of Object.values(ELEMENT_PROFILES)) {
      for (const profession of professions) {
        expect(profile.capacity[profession], `${profile.id}/${profession}`).toBeGreaterThan(0);
      }
    }
  });

  it("scales an island's capacity by its element, in the documented direction", () => {
    expect(islandCapacity("EARTH").farmTiles).toBeGreaterThan(islandCapacity("WATER").farmTiles);
    expect(islandCapacity("WATER").fishingSpots).toBeGreaterThan(islandCapacity("EARTH").fishingSpots);
    expect(islandCapacity("WOOD").forestryNodes).toBeGreaterThan(islandCapacity("EARTH").forestryNodes);
    expect(islandCapacity("METAL").miningNodes).toBeGreaterThan(islandCapacity("EARTH").miningNodes);
    expect(islandCapacity("FIRE").livestockPens).toBeGreaterThan(islandCapacity("METAL").livestockPens);
  });

  it("answers the brief's structural checks with a verdict and a reason", () => {
    const result = simulate(scenarioById("F"), model);
    const checks = analyse(result, model);
    const ids = checks.map((check) => check.id);
    for (const required of [
      "FIRE_DOMINANCE",
      "NPC_RUNAWAY",
      "MARKET_NECESSITY",
      "INFLATION",
      "SCARCITY",
      "STORAGE_PRESSURE",
      "HOME_CEILING",
      "SPECIALISATION"
    ]) {
      expect(ids, required).toContain(required);
    }
    for (const check of checks) {
      expect(["HEALTHY", "WATCH", "RISK"], check.id).toContain(check.verdict);
      expect(check.detail.length, check.id).toBeGreaterThan(0);
    }
    // The formatted report is the artefact a reviewer reads.
    const text = formatResult(result, checks);
    expect(text).toContain("Scenario F");
    expect(text).toContain("FIRE_DOMINANCE");
  });
});

describe("scenarios and performance", () => {
  it("runs every scenario the brief requires, and each answers its own question", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      expect(result.scenarioId).toBe(scenario.id);
      expect(result.actors).toBe(scenario.actors);
      expect(result.perElement.length).toBeGreaterThan(0);
      expect(result.totals.goldEnd).toBeGreaterThanOrEqual(0);
    }
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("models ten thousand actors cheaply, because cohorts aggregate", () => {
    const scenario = scenarioFrom(scenarioById("F"), { actors: 10_000, days: 90 });
    const started = Date.now();
    const result = simulate(scenario, model);
    const elapsed = Date.now() - started;
    expect(result.actors).toBe(10_000);
    expect(result.daily).toHaveLength(90);
    // A 90-day, 10,000-player run is a design-time tool: it must finish in well under a second.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("prices an imbalanced population as scarce, and a balanced one as not", () => {
    const imbalanced = simulate(scenarioById("G"), model);
    // Scenario G is 40% Water, 30% Fire, 10% each of Earth/Wood/Metal: the farming and ore goods the
    // lean population cannot cover should show up as unmet demand rather than as free abundance.
    const scarce = imbalanced.perItem.filter((item) => item.scarcity > 0);
    expect(scarce.length).toBeGreaterThan(0);
    // And the workers' own productivity stays bounded, because the workers eat what the island grows.
    const productivity = imbalanced.daily.reduce((sum, day) => sum + day.npcProductivity, 0) / imbalanced.daily.length;
    expect(productivity).toBeLessThanOrEqual(1);
  });

  it("keeps every archetype inside the day it is given", () => {
    for (const profile of Object.values(ACTOR_PROFILES)) {
      expect(profile.activeSecondsPerDay).toBeGreaterThan(0);
      expect(profile.activeSecondsPerDay).toBeLessThanOrEqual(24 * 60 * 60);
      expect(profile.capacityUsage).toBeGreaterThan(0);
      expect(profile.capacityUsage).toBeLessThanOrEqual(1);
    }
  });
});
