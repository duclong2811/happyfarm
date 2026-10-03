import { describe, expect, it } from "vitest";
import {
  ACTOR_PROFILES,
  DEVELOPMENT_STEPS,
  ELEMENT_PROFILES,
  LIVESTOCK_MODEL,
  PROFESSIONS,
  SCENARIOS,
  analyse,
  baselineSnapshot,
  defaultModel,
  developedCapacity,
  effectiveModel,
  formatResult,
  islandCapacity,
  marginalCapacityCost,
  scenarioById,
  simulate,
  starterCapacity,
  type Profession,
  type Scenario,
  type StageId
} from "@happy-farm/economy-sim";

/**
 * The model's own rules, held as invariants.
 *
 * A simulation that can invent gold, invent ore, produce a negative balance, or let a worker conjure
 * capacity out of nothing is worse than no simulation, so these are the properties the engine may
 * never break - whatever the scenario, however many days, however many actors.
 *
 * V16.1 keeps the V16.0 invariants and adds the capacity-model ones the phase brief names.
 */

const model = defaultModel(baselineSnapshot());

function scenarioFrom(base: Scenario, overrides: Partial<Scenario> = {}): Scenario {
  return { ...base, ...overrides };
}

describe("simulation invariants (V16.0, preserved)", () => {
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
        expect(day.capacityUtilization).toBeLessThanOrEqual(1);
        expect(day.capacityUtilization).toBeGreaterThanOrEqual(0);
        expect(day.npcProductivity).toBeGreaterThanOrEqual(0);
        expect(day.npcProductivity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never produces a negative balance, and never creates gold in a market trade", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      expect(result.totals.goldDestroyed).toBeLessThanOrEqual(result.totals.goldCreated + 100 * scenario.actors);
      expect(result.totals.feesDestroyed).toBeGreaterThanOrEqual(0);
      for (const day of result.daily) {
        expect(day.marketFeesDestroyed).toBeGreaterThanOrEqual(0);
        expect(day.marketVolumeGold).toBeGreaterThanOrEqual(0);
        expect(day.marketFeesDestroyed).toBeLessThanOrEqual(day.marketVolumeGold);
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

  it("turns a scenario's features off rather than leaving them on by accident", () => {
    const noStorage = effectiveModel(model, {
      storage: false,
      workers: false,
      processing: false,
      market: false,
      livestock: false,
      sinks: false,
      upgrades: false,
      npcShop: false
    });
    expect(noStorage.storage.enabled).toBe(false);
    expect(noStorage.market.enabled).toBe(false);
    expect(noStorage.workers.enabled).toBe(false);
    const result = simulate(scenarioFrom(scenarioById("B"), { stage: "INDUSTRIAL" }), noStorage);
    expect(result.daily.every((day) => day.storageFillRate === 0)).toBe(true);
    expect(result.totals.timeToStoragePressureDays).toBeNull();
  });

  it("never lets a recipe make raw material from nothing", () => {
    const baseline = baselineSnapshot();
    const steel = model.processing.recipes.find((recipe) => recipe.output === "item_steel");
    expect(steel).toBeDefined();
    expect(steel?.outputQuantity).toBe(1);
    expect(Object.values(steel?.inputs ?? {}).reduce((sum, quantity) => sum + quantity, 0)).toBeGreaterThan(1);
    // Every recipe's inputs are real items the baseline or the model prices.
    for (const recipe of model.processing.recipes) {
      for (const item of Object.keys(recipe.inputs)) {
        const known = baseline.sellPrices[item] !== undefined || item.startsWith("item_");
        expect(known, `${recipe.id} input ${item}`).toBe(true);
      }
    }
  });

  it("gives Fire industry, not raw extraction", () => {
    const rawProfessions: readonly Profession[] = ["FARMING", "FISHING", "MINING", "FORESTRY"];
    for (const profession of rawProfessions) {
      const best = Math.max(...Object.values(ELEMENT_PROFILES).map((profile) => profile.physicalMax[capacityKey(profession)]));
      expect(ELEMENT_PROFILES.FIRE.physicalMax[capacityKey(profession)], profession).toBeLessThan(best);
    }
    const bestLanes = Math.max(...Object.values(ELEMENT_PROFILES).map((profile) => profile.physicalMax.processingLanes));
    expect(ELEMENT_PROFILES.FIRE.physicalMax.processingLanes).toBe(bestLanes);
    // And every element can still do every profession: nothing is locked.
    for (const profile of Object.values(ELEMENT_PROFILES)) {
      for (const profession of PROFESSIONS) {
        expect(profile.physicalMax[capacityKey(profession)], `${profile.id}/${profession}`).toBeGreaterThan(0);
      }
    }
  });

  it("scales an island's physical ceiling by its element, in the documented direction", () => {
    expect(islandCapacity("EARTH").farmTiles).toBeGreaterThan(islandCapacity("WATER").farmTiles);
    expect(islandCapacity("WATER").fishingSpots).toBeGreaterThan(islandCapacity("EARTH").fishingSpots);
    expect(islandCapacity("WOOD").forestryNodes).toBeGreaterThan(islandCapacity("EARTH").forestryNodes);
    expect(islandCapacity("METAL").miningNodes).toBeGreaterThan(islandCapacity("EARTH").miningNodes);
    expect(islandCapacity("FIRE").livestockPens).toBeGreaterThan(islandCapacity("METAL").livestockPens);
  });

  it("answers the brief's structural checks with a verdict and a reason", () => {
    const result = simulate(scenarioById("E"), model);
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
    const text = formatResult(result, checks);
    expect(text).toContain("Scenario E");
    expect(text).toContain("FIRE_DOMINANCE");
  });
});

describe("physical capacity, development and workers (V16.1)", () => {
  it("never lets developed capacity exceed the physical ceiling", () => {
    for (const element of Object.keys(ELEMENT_PROFILES) as (keyof typeof ELEMENT_PROFILES)[]) {
      const ceiling = islandCapacity(element);
      for (let step = 0; step <= DEVELOPMENT_STEPS + 3; step += 1) {
        const tiers = Object.fromEntries(PROFESSIONS.map((profession) => [profession, step])) as Record<Profession, number>;
        const developed = developedCapacity(element, tiers);
        for (const profession of PROFESSIONS) {
          expect(developed[capacityKey(profession)], `${element}/${profession}@${String(step)}`).toBeLessThanOrEqual(
            ceiling[capacityKey(profession)]
          );
        }
      }
    }
  });

  it("starts below the ceiling and grows with the stage", () => {
    for (const element of Object.keys(ELEMENT_PROFILES) as (keyof typeof ELEMENT_PROFILES)[]) {
      const starter = starterCapacity(element);
      const ceiling = islandCapacity(element);
      for (const profession of PROFESSIONS) {
        expect(starter[capacityKey(profession)], `${element}/${profession}`).toBeLessThanOrEqual(ceiling[capacityKey(profession)]);
      }
    }
    const stages: readonly StageId[] = ["EARLY", "DEVELOPING", "MID", "INDUSTRIAL", "WORLD"];
    for (const stage of stages) {
      const scenario = scenarioFrom(scenarioById("E"), { stage });
      const result = simulate(scenario, model);
      for (const element of result.perElement) {
        expect(element.developedCapacity.processingLanes).toBeLessThanOrEqual(element.physicalMaxCapacity.processingLanes);
      }
    }
  });

  it("makes the next development step cost more per unit of capacity than the last", () => {
    const prices = { ...model.baseline.sellPrices };
    for (const element of Object.keys(ELEMENT_PROFILES) as (keyof typeof ELEMENT_PROFILES)[]) {
      const costs = [1, 2, 3, 4, 5].map((step) => marginalCapacityCost(element, "FARMING", step, prices, model.development));
      for (let index = 1; index < costs.length; index += 1) {
        expect(costs[index], `${element} step ${String(index + 1)}`).toBeGreaterThan(costs[index - 1] ?? 0);
      }
    }
  });

  it("lets workers work developed capacity but never exceed it, or the workplace slots", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      for (const element of result.perElement) {
        for (const profession of PROFESSIONS) {
          const utilization = element.homeCapacityUtilization[profession];
          expect(utilization, `${scenario.id}/${element.element}/${profession}`).toBeGreaterThanOrEqual(0);
          expect(utilization, `${scenario.id}/${element.element}/${profession}`).toBeLessThanOrEqual(1);
        }
        expect(element.workplaceUtilization, `${scenario.id}/${element.element}`).toBeLessThanOrEqual(1);
      }
      for (const day of result.daily) {
        expect(day.capacityUtilization).toBeLessThanOrEqual(1);
        expect(day.workplaceUtilization).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not let a bigger workforce multiply output without bound", () => {
    // The worker-heavy mix hires far more than the realistic one. If workers could create capacity the
    // extra hands would scale output linearly; instead the capacity ceiling caps it.
    const realistic = simulate(scenarioFrom(scenarioById("E"), { archetypeMix: { CASUAL: 0.5, NORMAL: 0.4, HARDCORE: 0.09, AUTOMATED: 0.01 } }), model);
    const heavy = simulate(scenarioFrom(scenarioById("E"), { archetypeMix: { CASUAL: 0.05, NORMAL: 0.15, HARDCORE: 0.3, AUTOMATED: 0.5 } }), model);
    const realisticWorkers = realistic.perElement.reduce((sum, entry) => sum + entry.players, 0);
    const heavyWorkers = heavy.perElement.reduce((sum, entry) => sum + entry.players, 0);
    expect(heavyWorkers).toBeCloseTo(realisticWorkers, 6);
    for (const entry of heavy.perElement) {
      for (const profession of PROFESSIONS) {
        expect(entry.homeCapacityUtilization[profession], `${entry.element}/${profession}`).toBeLessThanOrEqual(1);
      }
    }
    // The extra workers raise utilisation but the per-player output gap stays well below a linear multiple.
    const realisticOutput = realistic.perElement.reduce((sum, entry) => sum + entry.outputValuePerDay, 0) / realisticWorkers;
    const heavyOutput = heavy.perElement.reduce((sum, entry) => sum + entry.outputValuePerDay, 0) / heavyWorkers;
    expect(heavyOutput).toBeLessThan(realisticOutput * 4);
  });

  it("keeps Fire's raw extraction below the specialists' and its industry dependent", () => {
    const fire = simulate(scenarioById("F"), model).perElement.find((entry) => entry.element === "FIRE");
    expect(fire).toBeDefined();
    const raw = fire?.importDependency.filter((entry) =>
      ["item_iron_ore", "item_coal", "item_wood"].includes(entry.itemDefinitionId)
    ) ?? [];
    expect(raw.length).toBeGreaterThan(0);
    // Fire's own ground cannot feed its works: it imports most of at least one raw input.
    expect(Math.max(...raw.map((entry) => entry.importDependency))).toBeGreaterThan(0.4);
  });

  it("reports physical, efficiency and total specialisation advantage separately", () => {
    const result = simulate(scenarioById("E"), model);
    for (const entry of result.perElement) {
      expect(Number.isFinite(entry.physicalCapacityAdvantage)).toBe(true);
      expect(Number.isFinite(entry.efficiencyAdvantage)).toBe(true);
      expect(entry.totalSpecializationAdvantage).toBeCloseTo(
        (1 + entry.physicalCapacityAdvantage) * (1 + entry.efficiencyAdvantage) - 1,
        6
      );
      // Efficiency stays a small modifier; geography, not a buff, is the point.
      expect(Math.abs(entry.efficiencyAdvantage)).toBeLessThanOrEqual(0.15);
    }
  });
});

describe("dependency, storage and accounting (V16.1)", () => {
  it("does not make the early game depend on the market", () => {
    const early = simulate(scenarioById("B"), model);
    expect(early.totals.marketShareOfInput).toBeLessThanOrEqual(0.05);
    expect(early.totals.npcShopShareOfInput).toBeLessThanOrEqual(0.05);
    for (const entry of early.perElement) {
      expect(entry.selfSufficiencyIndex, entry.element).toBeGreaterThan(0.9);
      for (const dependency of entry.importDependency) {
        expect(dependency.importDependency, dependency.itemDefinitionId).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it("makes the industrial game depend on other elements", () => {
    const result = simulate(scenarioById("E"), model);
    const worst = Math.max(
      ...result.perElement.flatMap((entry) => entry.importDependency.map((dependency) => dependency.importDependency))
    );
    expect(worst).toBeGreaterThan(0.3);
    const fire = result.perElement.find((entry) => entry.element === "FIRE");
    expect(fire?.selfSufficiencyIndex ?? 1).toBeLessThan(0.95);
  });

  it("keeps every self-sufficiency and dependency metric bounded to 0..1", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      for (const entry of result.perElement) {
        expect(entry.selfSufficiencyIndex).toBeGreaterThanOrEqual(0);
        expect(entry.selfSufficiencyIndex).toBeLessThanOrEqual(1);
        expect(entry.selfSufficiency).toBeGreaterThanOrEqual(0);
        expect(entry.selfSufficiency).toBeLessThanOrEqual(1);
        for (const dependency of entry.importDependency) {
          expect(dependency.importDependency).toBeGreaterThanOrEqual(0);
          expect(dependency.importDependency).toBeLessThanOrEqual(1);
        }
      }
      expect(result.totals.npcShopShareOfInput).toBeGreaterThanOrEqual(0);
      expect(result.totals.marketShareOfInput).toBeLessThanOrEqual(1);
    }
  });

  it("does not put storage pressure on a starter island on day one", () => {
    const starter = simulate(scenarioById("A"), model);
    expect(starter.totals.storage.first50 === null || starter.totals.storage.first50 > 3).toBe(true);
    expect(starter.totals.storageConstrainedPercent).toBe(0);
    const early = simulate(scenarioById("B"), model);
    expect(early.totals.storage.first50 ?? 99).toBeGreaterThan(3);
  });

  it("models livestock as feed in, animal products out, bounded by the pens", () => {
    const fire = simulate(scenarioById("F"), model);
    const meat = fire.perItem.find((item) => item.itemDefinitionId === "item_meat");
    const feed = fire.perItem.find((item) => item.itemDefinitionId === "item_potato");
    expect(meat?.producedPerDay ?? 0).toBeGreaterThan(0);
    expect(feed?.consumedPerDay ?? 0).toBeGreaterThan(0);
    // Output can never exceed what every pen on the island could produce.
    const pens = ELEMENT_PROFILES.FIRE.physicalMax.livestockPens * 200;
    const ceiling = pens * LIVESTOCK_MODEL.stablePerPenPerDay;
    expect((meat?.producedPerDay ?? 0) * 2).toBeLessThanOrEqual(ceiling + 1);
  });

  it("models processing as raw material in, manufactured good out", () => {
    const fire = simulate(scenarioById("F"), model);
    const steel = fire.perItem.find((item) => item.itemDefinitionId === "item_steel");
    const iron = fire.perItem.find((item) => item.itemDefinitionId === "item_iron_ore");
    expect(steel?.producedPerDay ?? 0).toBeGreaterThan(0);
    expect(iron?.consumedPerDay ?? 0).toBeGreaterThan(0);
  });
});

describe("scenarios and performance", () => {
  it("runs every required scenario, plus the five mandated population mixes", () => {
    for (const scenario of SCENARIOS) {
      const result = simulate(scenario, model);
      expect(result.scenarioId).toBe(scenario.id);
      expect(result.actors).toBe(scenario.actors);
      expect(result.perElement.length).toBeGreaterThan(0);
      expect(result.totals.goldEnd).toBeGreaterThanOrEqual(0);
    }
    const ids = SCENARIOS.map((scenario) => scenario.id);
    for (const required of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]) {
      expect(ids, required).toContain(required);
    }
    expect(ids.length).toBeGreaterThanOrEqual(19);
    const labels = SCENARIOS.map((scenario) => scenario.mixLabel);
    for (const mix of ["Water-heavy", "Fire-heavy", "Metal-shortage", "Wood-shortage", "Earth-shortage"]) {
      expect(labels, mix).toContain(mix);
    }
  });

  it("models ten thousand actors over ninety days cheaply", () => {
    const scenario = scenarioFrom(scenarioById("O"), { actors: 10_000, days: 90 });
    const started = Date.now();
    const result = simulate(scenario, model);
    const elapsed = Date.now() - started;
    expect(result.actors).toBe(10_000);
    expect(result.daily).toHaveLength(90);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("keeps every archetype inside the day it is given", () => {
    for (const profile of Object.values(ACTOR_PROFILES)) {
      expect(profile.activeSecondsPerDay).toBeGreaterThan(0);
      expect(profile.activeSecondsPerDay).toBeLessThanOrEqual(24 * 60 * 60);
      expect(profile.capacityUsage).toBeGreaterThan(0);
      expect(profile.capacityUsage).toBeLessThanOrEqual(1);
      expect(profile.developmentTendency).toBeGreaterThan(0);
      expect(profile.developmentTendency).toBeLessThanOrEqual(1);
    }
  });
});

function capacityKey(profession: Profession): keyof ReturnType<typeof islandCapacity> {
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
