import {
  CAPACITY_FIELD,
  ELEMENT_IDS,
  ELEMENT_PROFILES,
  PROFESSIONS,
  islandCapacity,
  type ElementId,
  type Profession
} from "./elements";
import type { EconomyModel } from "./model";
import { meanCapacityUtilization, meanStorageFill, specialisationAdvantage, type DominanceCheck, type SimulationResult } from "./metrics";

/**
 * Turning a run into findings.
 *
 * The simulator only moves numbers; this file asks the questions the brief names - is Fire too
 * self-sufficient, do workers compound, is the market necessary, is anything scarce, does the physical
 * ceiling ever bind - and answers them from the result rather than from an opinion. A check the model
 * cannot yet answer says so.
 *
 * V16.1 splits the old SPECIALISATION check into the physical, efficiency and total advantages, and
 * adds the import-dependency, self-sufficiency and workplace checks the phase asks for.
 */

export function analyse(result: SimulationResult, model: EconomyModel): readonly DominanceCheck[] {
  const checks: DominanceCheck[] = [];
  const days = Math.max(1, result.days);
  const createdPerDay = result.totals.goldCreated / days;
  const destroyedPerDay = result.totals.goldDestroyed / days;
  const transferredPerDay = result.totals.goldTransferred / days;
  const netGoldPerDay = result.totals.netGold / days;
  const advantage = specialisationAdvantage(result);
  const worstScarcity = result.perItem.reduce((max, item) => Math.max(max, item.scarcity), 0);
  const meanFill = meanStorageFill(result);
  const meanCeiling = meanCapacityUtilization(result);
  const meanWorkerProductivity =
    result.daily.length === 0 ? 0 : result.daily.reduce((sum, day) => sum + day.npcProductivity, 0) / result.daily.length;
  const workplace = result.perElement.reduce((max, entry) => Math.max(max, entry.workplaceUtilization), 0);
  const fire = result.perElement.find((entry) => entry.element === "FIRE");
  const fireIron = fire?.importDependency.find((entry) => entry.itemDefinitionId === "item_iron_ore");
  const meanDependency =
    result.perElement.length === 0
      ? 0
      : result.perElement.reduce(
          (sum, entry) =>
            sum +
            (entry.importDependency.length === 0
              ? 0
              : entry.importDependency.reduce((inner, dep) => inner + dep.importDependency, 0) / entry.importDependency.length),
          0
        ) / result.perElement.length;

  checks.push(fireDominance(result, fire));
  checks.push({
    id: "NPC_RUNAWAY",
    question: "Does hiring workers compound into free money, or does upkeep and capacity keep up?",
    verdict:
      meanWorkerProductivity === 0
        ? "HEALTHY"
        : advantage > 0.6
          ? "RISK"
          : advantage > 0.5
            ? "WATCH"
            : "HEALTHY",
    detail:
      meanWorkerProductivity === 0
        ? "No workers in this scenario."
        : `Worker productivity ${(meanWorkerProductivity * 100).toFixed(0)}% of possible; the strongest element leads by ${(advantage * 100).toFixed(1)}% (target 20-40%).`
  });
  checks.push({
    id: "MARKET_NECESSITY",
    question: "Is player trade doing any work, or is every island self-sufficient?",
    verdict: model.market.enabled ? (result.totals.marketVolumeGold <= 0 ? "WATCH" : "HEALTHY") : "WATCH",
    detail: model.market.enabled
      ? `Market volume is ${transferredPerDay.toFixed(0)} gold/day; mean import dependency ${(meanDependency * 100).toFixed(0)}%.`
      : "The market is switched off in this scenario; self-sufficiency is the baseline by construction."
  });
  checks.push({
    id: "INFLATION",
    question: "Does the economy create gold faster than it destroys it?",
    verdict:
      createdPerDay <= 0
        ? "HEALTHY"
        : netGoldPerDay / createdPerDay > 0.35
          ? "RISK"
          : netGoldPerDay / createdPerDay > 0.15
            ? "WATCH"
            : "HEALTHY",
    detail:
      `Created ${createdPerDay.toFixed(0)}/day, destroyed ${destroyedPerDay.toFixed(0)}/day, ` +
      `transferred ${transferredPerDay.toFixed(0)}/day, net ${netGoldPerDay.toFixed(0)}/day.`
  });
  checks.push({
    id: "SCARCITY",
    question: "Does anything become scarce enough to stall progress?",
    verdict: worstScarcity > 0.6 ? "RISK" : worstScarcity > 0.25 ? "WATCH" : "HEALTHY",
    detail:
      result.perItem.length === 0
        ? "No item demand was recorded."
        : `Worst unmet demand ${(worstScarcity * 100).toFixed(1)}% (${result.perItem[0]?.itemDefinitionId ?? "none"}).`
  });
  checks.push({
    id: "STORAGE_PRESSURE",
    question: "Does storage become a decision at the right time, rather than on day one?",
    verdict: !model.storage.enabled || meanFill === 0 ? "WATCH" : result.totals.storage.first50 !== null && result.totals.storage.first50 <= 1 ? "RISK" : meanFill > 0.98 ? "RISK" : "HEALTHY",
    detail: model.storage.enabled
      ? `First 50% on day ${String(result.totals.storage.first50 ?? "never")}, first full on day ${String(
          result.totals.storage.firstFull ?? "never"
        )}; constrained ${(result.totals.storageConstrainedPercent * 100).toFixed(0)}% of days.`
      : "Storage is unlimited in this scenario."
  });
  checks.push({
    id: "HOME_CEILING",
    question: "Does one Home Island support an endgame economy indefinitely?",
    verdict: meanCeiling >= 0.95 ? "RISK" : "HEALTHY",
    detail: `Players run at ${(meanCeiling * 100).toFixed(1)}% of what one developed island could sustain; the ceiling binds only if a mature island approaches 100% and still grows.`
  });
  checks.push({
    id: "SPECIALISATION",
    question: "Is choosing an element worth anything compared with playing a generalist?",
    verdict: advantage < 0.05 ? "RISK" : advantage < 0.1 ? "WATCH" : advantage > 0.6 ? "WATCH" : "HEALTHY",
    detail: `The strongest element produces ${(advantage * 100).toFixed(1)}% more value per player than the average (target band 20-40%).`
  });
  checks.push({
    id: "IMPORT_DEPENDENCY",
    question: "Do mature specialists import the inputs their own ground cannot supply?",
    verdict: meanDependency < 0.05 ? "WATCH" : meanDependency > 0.9 ? "WATCH" : "HEALTHY",
    detail: `Mean strategic-resource import dependency ${(meanDependency * 100).toFixed(0)}%; Fire iron ${
      fireIron === undefined ? "n/a" : `${(fireIron.importDependency * 100).toFixed(0)}%`
    }.`
  });
  checks.push({
    id: "WORKPLACE_CAPACITY",
    question: "Can workers exceed the physical workplaces the island has?",
    verdict: workplace > 1.0001 ? "RISK" : "HEALTHY",
    detail: `Peak workplace fill ${(workplace * 100).toFixed(0)}% of the island's worker slots.`
  });
  return checks;
}

/**
 * Fire must never get a *raw* advantage, and its industry must actually depend on imports.
 *
 * The first half is a property of the physical table, so it is checked directly; the second half is
 * read from the run, because a Fire island that happens to import nothing is a finding, not a rule.
 */
function fireDominance(result: SimulationResult, fire: SimulationResult["perElement"][number] | undefined): DominanceCheck {
  const rawProfessions: readonly Profession[] = ["FARMING", "FISHING", "MINING", "FORESTRY"];
  const fireIsRawBest = rawProfessions.some((profession) => {
    const best = Math.max(...ELEMENT_IDS.map((id) => islandCapacity(id)[CAPACITY_FIELD[profession]]));
    return islandCapacity("FIRE")[CAPACITY_FIELD[profession]] >= best;
  });
  const fireProcessingBest =
    islandCapacity("FIRE").processingLanes >= Math.max(...ELEMENT_IDS.map((id) => islandCapacity(id).processingLanes));
  const rawItems = new Set(["item_iron_ore", "item_coal", "item_wood", "item_hardwood", "item_resin"]);
  const rawDependencies = fire?.importDependency.filter((entry) => rawItems.has(entry.itemDefinitionId)) ?? [];
  const rawDependency =
    rawDependencies.length === 0
      ? null
      : rawDependencies.reduce((sum, entry) => sum + entry.importDependency, 0) / rawDependencies.length;
  return {
    id: "FIRE_DOMINANCE",
    question: "Can Fire out-produce the raw elements, or does it depend on them?",
    verdict: fireIsRawBest ? "RISK" : "HEALTHY",
    detail: fireIsRawBest
      ? "Fire matches or beats the best raw element in at least one gathering profession."
      : `Fire's extraction ceilings are below every specialist's, its industry is ${fireProcessingBest ? "the largest" : "large"}, and it ran at ${
          rawDependency === null ? "n/a" : `${(rawDependency * 100).toFixed(0)}%`
        } mean import dependency on raw inputs.`
  };
}

export function formatResult(result: SimulationResult, checks: readonly DominanceCheck[]): string {
  const lines: string[] = [];
  const days = Math.max(1, result.days);
  lines.push(`Scenario ${result.scenarioId}: ${String(result.actors)} actors over ${String(result.days)} days`);
  lines.push(
    `  gold created ${result.totals.goldCreated.toFixed(0)}, destroyed ${result.totals.goldDestroyed.toFixed(0)}, ` +
      `transferred ${result.totals.goldTransferred.toFixed(0)}, net ${result.totals.netGold.toFixed(0)} (${(
        result.totals.netGold / days
      ).toFixed(0)}/day)`
  );
  lines.push(
    `  market volume ${result.totals.marketVolumeGold.toFixed(0)} gold, fees destroyed ${result.totals.feesDestroyed.toFixed(0)}, ` +
      `storage 50%/full day ${String(result.totals.storage.first50 ?? "never")}/${String(result.totals.storage.firstFull ?? "never")}, ` +
      `lost to storage ${result.totals.lostOutputToStorage.toFixed(0)} gold`
  );
  for (const entry of result.perElement) {
    const utilization = PROFESSIONS.map(
      (profession) => `${profession.slice(0, 1)}:${(entry.homeCapacityUtilization[profession] * 100).toFixed(0)}`
    ).join(" ");
    lines.push(
      `  ${entry.element.padEnd(6)} players ${entry.players.toFixed(0).padStart(6)}  output ${entry.outputValuePerDay
        .toFixed(0)
        .padStart(9)} gold/day  self-sufficiency ${(entry.selfSufficiencyIndex * 100).toFixed(0).padStart(3)}%  ` +
        `adv ${(entry.totalSpecializationAdvantage * 100).toFixed(0)}%  util ${utilization}`
    );
  }
  for (const item of result.perItem.slice(0, 8)) {
    lines.push(
      `  ${item.itemDefinitionId.padEnd(20)} produced/day ${item.producedPerDay.toFixed(1).padStart(9)}  ` +
        `value ${item.baseValue.toString().padStart(3)}  clearing ${item.clearingPrice.toFixed(2).padStart(6)}  scarcity ${(item.scarcity * 100).toFixed(1)}%`
    );
  }
  for (const check of checks) {
    lines.push(`  [${check.verdict}] ${check.id}: ${check.detail}`);
  }
  return lines.join("\n");
}

/** The physical table, printed once so a reader can see where the differentiation comes from. */
export function capacityTable(): string {
  const lines: string[] = ["element  " + PROFESSIONS.map((profession) => profession.padEnd(11)).join("")];
  for (const element of ELEMENT_IDS) {
    const capacity = islandCapacity(element);
    lines.push(
      element.padEnd(7) +
        PROFESSIONS.map((profession) => String(capacity[CAPACITY_FIELD[profession]]).padEnd(11)).join("") +
        `  (${ELEMENT_PROFILES[element].efficiency.FARMING.toFixed(2)}x farming efficiency)`
    );
  }
  return lines.join("\n");
}

export function elementProfileSummary(element: ElementId): string {
  const profile = ELEMENT_PROFILES[element];
  return `${profile.displayName}: ${profile.identity}`;
}
