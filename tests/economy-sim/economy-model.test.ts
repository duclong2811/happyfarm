import { describe, expect, it } from "vitest";
import {
  ACTOR_PROFILES,
  DEVELOPMENT_STEPS,
  ELEMENT_IDS,
  ELEMENT_PROFILES,
  INDUSTRIAL_PROFILE,
  LIVESTOCK_MODEL,
  PROFESSIONS,
  RESOURCE_CAPACITY_FIELD,
  RESOURCE_PROFESSIONS,
  SCENARIOS,
  analyse,
  baselineSnapshot,
  capacityPaybackDays,
  defaultModel,
  developedCapacity,
  effectiveModel,
  efficiencyFor,
  formatResult,
  islandCapacity,
  marginalCapacityCost,
  scenarioById,
  simulate,
  starterCapacity,
  type ElementId,
  type Profession,
  type ResourceProfession,
  type Scenario
} from "@happy-farm/economy-sim";

/**
 * The model's own rules, held as invariants.
 *
 * V16.1.1 locks the canonical five-resource mapping (Earth agriculture, Water fishing, Wood forestry,
 * Metal mining, Fire livestock), moves manufacturing to a shared element-neutral track, and steepens the
 * development cost curve. The V16.0/V16.1 invariants are preserved.
 */

const model = defaultModel(baselineSnapshot());
const prices = { ...model.baseline.sellPrices };

function scenarioFrom(base: Scenario, overrides: Partial<Scenario> = {}): Scenario {
  return { ...base, ...overrides };
}

function primary(element: ElementId): ResourceProfession {
  return ELEMENT_PROFILES[element].primaryProfession;
}

describe("simulation invariants (V16.0/V16.1, preserved)", () => {
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
      for (const day of result.daily) {
        expect(day.goldTotal).toBeGreaterThanOrEqual(0);
        expect(day.storageFillRate).toBeGreaterThanOrEqual(0);
        expect(day.storageFillRate).toBeLessThanOrEqual(1);
        expect(day.capacityUtilization).toBeGreaterThanOrEqual(0);
        expect(day.capacityUtilization).toBeLessThanOrEqual(1);
        expect(day.workplaceUtilization).toBeLessThanOrEqual(1);
        expect(day.npcProductivity).toBeGreaterThanOrEqual(0);
        expect(day.npcProductivity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("conserves gold: the ending balance is the start plus what was created minus what was destroyed", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      const expected = 100 * scenario.actors + result.totals.goldCreated - result.totals.goldDestroyed;
      expect(result.totals.goldEnd, scenario.id).toBeCloseTo(expected, 4);
    }
  });

  it("never lets a recipe make raw material from nothing", () => {
    for (const recipe of model.processing.recipes) {
      const inputUnits = Object.values(recipe.inputs).reduce((sum, quantity) => sum + quantity, 0);
      expect(inputUnits, recipe.id).toBeGreaterThan(recipe.outputQuantity);
    }
  });

  it("turns a scenario's features off rather than leaving them on by accident", () => {
    const none = effectiveModel(model, {
      storage: false,
      workers: false,
      processing: false,
      market: false,
      livestock: false,
      sinks: false,
      upgrades: false,
      npcShop: false
    });
    expect(none.storage.enabled).toBe(false);
    expect(none.market.enabled).toBe(false);
    expect(none.workers.enabled).toBe(false);
  });

  it("answers the brief's structural checks with a verdict and a reason", () => {
    const result = simulate(scenarioById("E"), model);
    const checks = analyse(result, model);
    const ids = checks.map((check) => check.id);
    for (const required of [
      "FIRE_DOMINANCE",
      "PROCESSING_NEUTRALITY",
      "UPGRADE_CROSSOVER",
      "NPC_RUNAWAY",
      "MARKET_NECESSITY",
      "INFLATION",
      "SCARCITY",
      "STORAGE_PRESSURE",
      "HOME_CEILING",
      "SPECIALISATION",
      "IMPORT_DEPENDENCY",
      "WORKPLACE_CAPACITY"
    ]) {
      expect(ids, required).toContain(required);
    }
    for (const check of checks) {
      expect(["HEALTHY", "WATCH", "RISK"], check.id).toContain(check.verdict);
      expect(check.detail.length, check.id).toBeGreaterThan(0);
    }
    expect(formatResult(result, checks)).toContain("PROCESSING_NEUTRALITY");
  });
});

describe("the five-profession model (V16.1.1)", () => {
  it("maps each element to exactly one resource profession", () => {
    expect(RESOURCE_PROFESSIONS).toEqual(["FARMING", "FISHING", "MINING", "FORESTRY", "LIVESTOCK"]);
    const mapping: Record<ElementId, ResourceProfession> = Object.fromEntries(
      ELEMENT_IDS.map((element) => [element, primary(element)])
    ) as Record<ElementId, ResourceProfession>;
    expect(mapping).toEqual({ EARTH: "FARMING", WATER: "FISHING", WOOD: "FORESTRY", METAL: "MINING", FIRE: "LIVESTOCK" });
  });

  it("gives each element the highest physical ceiling in its own resource profession", () => {
    const owners: Record<ResourceProfession, ElementId> = {
      FARMING: "EARTH",
      FISHING: "WATER",
      FORESTRY: "WOOD",
      MINING: "METAL",
      LIVESTOCK: "FIRE"
    };
    for (const profession of RESOURCE_PROFESSIONS) {
      const field = RESOURCE_CAPACITY_FIELD[profession];
      const best = Math.max(...ELEMENT_IDS.map((element) => ELEMENT_PROFILES[element].physicalMax[field]));
      const owner = owners[profession];
      expect(ELEMENT_PROFILES[owner].physicalMax[field], profession).toBe(best);
      for (const other of ELEMENT_IDS) {
        if (other === owner) continue;
        expect(ELEMENT_PROFILES[other].physicalMax[field], `${other}/${profession}`).toBeLessThan(best);
      }
    }
  });

  it("gives Fire no industrial or manufacturing advantage of any kind", () => {
    // Manufacturing is a shared system: the same workshop ceiling for every element...
    const lanes = ELEMENT_IDS.map((element) => islandCapacity(element).processingLanes);
    expect(new Set(lanes).size).toBe(1);
    expect(lanes[0]).toBe(INDUSTRIAL_PROFILE.maxLanes);
    // ...and no element has an efficiency modifier on it.
    for (const element of ELEMENT_IDS) {
      expect(efficiencyFor(element, "PROCESSING"), element).toBe(1);
    }
  });

  it("does not let developed capacity exceed the physical ceiling", () => {
    for (const element of ELEMENT_IDS) {
      const ceiling = islandCapacity(element);
      for (let step = 0; step <= DEVELOPMENT_STEPS + 3; step += 1) {
        const tiers = Object.fromEntries(PROFESSIONS.map((profession) => [profession, step])) as Record<Profession, number>;
        const developed = developedCapacity(element, tiers);
        for (const profession of PROFESSIONS) {
          expect(developed[capacityField(profession)]).toBeLessThanOrEqual(ceiling[capacityField(profession)]);
        }
        expect(developed.processingLanes).toBeLessThanOrEqual(INDUSTRIAL_PROFILE.maxLanes);
      }
      expect(starterCapacity(element).processingLanes).toBe(INDUSTRIAL_PROFILE.starterLanes);
    }
  });

  it("lets every element run the shared processing system", () => {
    const elements: ElementId[] = ["EARTH", "WATER", "WOOD", "METAL", "FIRE"];
    for (const element of elements) {
      const scenario: Scenario = {
        ...scenarioById("U"),
        id: `U-${element}`,
        actors: 100,
        elementMix: { EARTH: 0, WATER: 0, WOOD: 0, METAL: 0, FIRE: 0, [element]: 1 }
      };
      const result = simulate(scenario, model);
      const processed = result.perItem.filter((item) =>
        ["item_steel", "item_timber", "item_tools", "item_components", "item_machinery", "item_provisions", "item_leather", "item_textiles"].includes(
          item.itemDefinitionId
        )
      );
      expect(processed.length, element).toBeGreaterThan(0);
      expect(result.perElement[0]?.processingMargin ?? 0, element).toBeGreaterThan(1);
    }
  });

  it("makes the element-agnostic industrialist viable on all five elements", () => {
    const margins = new Map<ElementId, number>();
    for (const element of ELEMENT_IDS) {
      const scenario: Scenario = {
        ...scenarioById("U"),
        id: `U-${element}`,
        actors: 100,
        elementMix: { EARTH: 0, WATER: 0, WOOD: 0, METAL: 0, FIRE: 0, [element]: 1 }
      };
      const result = simulate(scenario, model);
      const entry = result.perElement[0];
      expect(entry, element).toBeDefined();
      expect(entry?.goldPerDay ?? -1, element).toBeGreaterThan(0);
      // The point is manufacturing viability, not total island income: use the workshop margin.
      margins.set(element, entry?.processingMargin ?? 0);
    }
    // No element is dramatically better at industry: the margin is close across all five.
    const values = [...margins.values()];
    expect(Math.min(...values)).toBeGreaterThan(1.05);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.5);
  });

  it("keeps workers working capacity, never creating it, and never exceeding workplace slots", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      for (const day of result.daily) {
        expect(day.capacityUtilization).toBeLessThanOrEqual(1);
        expect(day.workplaceUtilization).toBeLessThanOrEqual(1);
      }
      for (const element of result.perElement) {
        for (const profession of PROFESSIONS) {
          const utilization = element.homeCapacityUtilization[profession];
          expect(utilization, `${scenario.id}/${element.element}/${profession}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("does not make any element the mandatory processing hub", () => {
    const result = simulate(scenarioById("U"), model);
    const total = result.perElement.reduce((sum, entry) => sum + Math.max(0, entry.outputValuePerDay), 0);
    const shares = result.perElement.map((entry) => Math.max(0, entry.outputValuePerDay) / Math.max(1, total));
    expect(Math.max(...shares)).toBeLessThan(0.6);
  });
});

describe("development payback and the upgrade-vs-import crossover (V16.1.1)", () => {
  it("raises the payback of every development step", () => {
    for (const element of ELEMENT_IDS) {
      const costs = [1, 2, 3, 4, 5].map((step) =>
        marginalCapacityCost(element, primary(element), step, model.baseline, prices, model.development)
      );
      for (let index = 1; index < costs.length; index += 1) {
        expect(costs[index], `${element} step ${String(index + 1)}`).toBeGreaterThan(costs[index - 1] ?? 0);
      }
    }
  });

  it("makes late-tier payback substantially longer than early-tier", () => {
    for (const element of ELEMENT_IDS) {
      const early = capacityPaybackDays(element, primary(element), 1, model.baseline, prices, model.development);
      const late = capacityPaybackDays(element, primary(element), 5, model.baseline, prices, model.development);
      expect(early, element).toBeGreaterThan(0);
      expect(late, element).toBeGreaterThan(early * 5);
      // And a 1-2 day near-max payback is no longer possible.
      expect(late, element).toBeGreaterThan(20);
    }
  });

  it("lets importing beat a near-max vertical upgrade", () => {
    const result = simulate(scenarioById("E"), model);
    for (const entry of result.perElement) {
      const late = entry.capacityPaybackDays[4] ?? 0;
      expect(late, entry.element).toBeGreaterThan(30);
      expect(entry.upgradeVsImportRatio, entry.element).toBeGreaterThan(0);
    }
  });

  it("reports early upgrades as quick and near-max upgrades as slow", () => {
    const early = capacityPaybackDays("METAL", "MINING", 1, model.baseline, prices, model.development);
    const mid = capacityPaybackDays("METAL", "MINING", 3, model.baseline, prices, model.development);
    const late = capacityPaybackDays("METAL", "MINING", 5, model.baseline, prices, model.development);
    expect(early).toBeLessThan(7);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
  });
});

describe("dependency, storage and accounting (V16.1.1)", () => {
  it("does not make the early game depend on the market", () => {
    const early = simulate(scenarioById("B"), model);
    for (const entry of early.perElement) {
      expect(entry.selfSufficiencyIndex, entry.element).toBeGreaterThan(0.9);
      for (const dependency of entry.importDependency) {
        expect(dependency.importDependency, dependency.itemDefinitionId).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it("gives hardwood and resin real demand channels", () => {
    const result = simulate(scenarioById("U"), model);
    for (const item of ["item_hardwood", "item_resin"]) {
      const entry = result.perItem.find((row) => row.itemDefinitionId === item);
      expect(entry?.consumedPerDay ?? 0, item).toBeGreaterThan(0);
    }
  });

  it("models livestock as feed in, a mix of animal products out, bounded by pens", () => {
    const fire = simulate(scenarioById("F"), model);
    const feed = fire.perItem.find((item) => item.itemDefinitionId === "item_potato");
    expect(feed?.consumedPerDay ?? 0).toBeGreaterThan(0);
    for (const item of ["item_eggs", "item_milk", "item_meat", "item_hide", "item_wool"]) {
      const entry = fire.perItem.find((row) => row.itemDefinitionId === item);
      expect(entry?.producedPerDay ?? 0, item).toBeGreaterThan(0);
    }
    const pens = ELEMENT_PROFILES.FIRE.physicalMax.livestockPens * 200;
    const ceiling = pens * LIVESTOCK_MODEL.stablePerPenPerDay;
    const animalOutput = ["item_eggs", "item_milk", "item_meat", "item_hide", "item_wool"].reduce(
      (sum, item) => sum + (fire.perItem.find((row) => row.itemDefinitionId === item)?.producedPerDay ?? 0),
      0
    );
    expect(animalOutput).toBeLessThanOrEqual(ceiling + 1);
  });

  it("keeps every self-sufficiency, dependency and payback metric bounded", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      for (const entry of result.perElement) {
        expect(entry.selfSufficiencyIndex).toBeGreaterThanOrEqual(0);
        expect(entry.selfSufficiencyIndex).toBeLessThanOrEqual(1);
        for (const dependency of entry.importDependency) {
          expect(dependency.importDependency).toBeGreaterThanOrEqual(0);
          expect(dependency.importDependency).toBeLessThanOrEqual(1);
        }
        expect(entry.processingMargin).toBeGreaterThanOrEqual(0);
        expect(entry.capacityPaybackDays).toHaveLength(5);
      }
    }
  });

  it("does not put storage pressure on a starter island on day one", () => {
    const starter = simulate(scenarioById("A"), model);
    expect(starter.totals.storage.first50 === null || starter.totals.storage.first50 > 3).toBe(true);
    const early = simulate(scenarioById("B"), model);
    expect(early.totals.storage.first50 ?? 99).toBeGreaterThan(3);
  });
});

describe("scenarios and performance", () => {
  it("runs every required scenario", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      expect(result.scenarioId).toBe(scenario.id);
      expect(result.actors).toBe(scenario.actors);
      expect(result.perElement.length).toBeGreaterThan(0);
    }
    const ids = SCENARIOS.map((scenario) => scenario.id);
    for (const required of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "T", "U", "V", "W", "X", "Y"]) {
      expect(ids, required).toContain(required);
    }
    const labels = SCENARIOS.map((scenario) => scenario.mixLabel);
    for (const mix of ["Water-heavy", "Fire-heavy", "Metal-shortage", "Wood-shortage", "Earth-shortage", "Water-shortage", "Fire-shortage"]) {
      expect(labels, mix).toContain(mix);
    }
  });

  it("runs 30, 90 and 180 day horizons", () => {
    const horizons = new Set<number>();
    for (const days of [30, 90, 180]) {
      const scenario = scenarioFrom(scenarioById("E"), { days });
      const result = simulate(scenario, model);
      expect(result.daily).toHaveLength(days);
      horizons.add(days);
    }
    expect(horizons.size).toBe(3);
  });

  it("models ten thousand actors over ninety days cheaply", () => {
    const scenario = scenarioFrom(scenarioById("Y"), { actors: 10_000, days: 90 });
    const started = Date.now();
    const result = simulate(scenario, model);
    const elapsed = Date.now() - started;
    expect(result.daily).toHaveLength(90);
    expect(elapsed).toBeLessThan(1_000);
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

function capacityField(profession: Profession): keyof ReturnType<typeof islandCapacity> {
  switch (profession) {
    case "FARMING":
      return "farmTiles";
    case "FISHING":
      return "fishingSpots";
    case "MINING":
      return "miningNodes";
    case "FORESTRY":
      return "forestryNodes";
    case "LIVESTOCK":
      return "livestockPens";
    case "PROCESSING":
      return "processingLanes";
  }
}
