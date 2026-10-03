import { ELEMENT_PROFILES } from "./elements";
import type { EconomyModel } from "./model";
import {
  specialisationAdvantage,
  type DominanceCheck,
  type SimulationResult
} from "./metrics";

/**
 * Turning a run into findings.
 *
 * The simulator only moves numbers; this file asks the questions the brief names - is Fire too
 * self-sufficient, do workers compound, is the market necessary, is anything scarce - and answers them
 * from the result rather than from an opinion. A check that the model cannot yet answer says so.
 */

export function analyse(result: SimulationResult, model: EconomyModel): readonly DominanceCheck[] {
  const checks: DominanceCheck[] = [];
  const days = Math.max(1, result.days);
  const netGoldPerDay = result.totals.netGold / days;
  const createdPerDay = result.totals.goldCreated / days;
  const outputValue = result.perElement.reduce((sum, entry) => sum + entry.outputValuePerDay, 0);
  const marketShare = outputValue <= 0 ? 0 : result.totals.marketVolumeGold / (outputValue * days);
  const advantage = specialisationAdvantage(result);
  const worstScarcity = result.perItem.reduce((max, item) => Math.max(max, item.scarcity), 0);
  const meanFill =
    result.daily.length === 0
      ? 0
      : result.daily.reduce((sum, day) => sum + day.storageFillRate, 0) / result.daily.length;
  const meanCeiling =
    result.daily.length === 0
      ? 0
      : result.daily.reduce((sum, day) => sum + day.ceilingUtilization, 0) / result.daily.length;
  const meanWorkerProductivity =
    result.daily.length === 0
      ? 0
      : result.daily.reduce((sum, day) => sum + day.npcProductivity, 0) / result.daily.length;

  checks.push(fireRawAdvantage(result));
  checks.push({
    id: "NPC_RUNAWAY",
    question: "Does hiring workers compound into free money, or does upkeep keep up?",
    verdict:
      meanWorkerProductivity === 0
        ? "HEALTHY"
        : meanWorkerProductivity >= 0.9 && netGoldPerDay > createdPerDay * 0.5
          ? "RISK"
          : meanWorkerProductivity < 0.6
            ? "WATCH"
            : "HEALTHY",
    detail:
      meanWorkerProductivity === 0
        ? "No workers in this scenario."
        : `Worker productivity ${(meanWorkerProductivity * 100).toFixed(0)}% of possible; net gold ${netGoldPerDay.toFixed(0)}/day against ${createdPerDay.toFixed(0)} created.`
  });
  checks.push({
    id: "MARKET_NECESSITY",
    question: "Is player trade doing any work, or is every island self-sufficient?",
    verdict: model.market.enabled ? (marketShare < 0.02 ? "WATCH" : "HEALTHY") : "WATCH",
    detail: model.market.enabled
      ? `Market volume is ${(marketShare * 100).toFixed(2)}% of produced value.`
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
    detail: `Created ${createdPerDay.toFixed(0)}/day, destroyed ${(result.totals.goldDestroyed / days).toFixed(0)}/day, net ${netGoldPerDay.toFixed(0)}/day.`
  });
  checks.push({
    id: "SCARCITY",
    question: "Does anything become scarce enough to stall progress?",
    verdict: worstScarcity > 0.5 ? "RISK" : worstScarcity > 0.15 ? "WATCH" : "HEALTHY",
    detail:
      result.perItem.length === 0
        ? "No item demand was recorded."
        : `Worst unmet demand ${(worstScarcity * 100).toFixed(1)}% (${result.perItem[0]?.itemDefinitionId ?? "none"}).`
  });
  checks.push({
    id: "STORAGE_PRESSURE",
    question: "Does storage fill quickly enough to create decisions without becoming micromanagement?",
    verdict: !model.storage.enabled || meanFill === 0 ? "WATCH" : meanFill > 0.95 ? "RISK" : "HEALTHY",
    detail: model.storage.enabled
      ? `Mean fill ${(meanFill * 100).toFixed(0)}%; first pressure on day ${String(result.totals.timeToStoragePressureDays ?? "never")}.`
      : "Storage is unlimited in this scenario."
  });
  checks.push({
    id: "HOME_CEILING",
    question: "Does one Home Island support an endgame economy indefinitely?",
    verdict: meanCeiling >= 0.98 ? "RISK" : meanCeiling < 0.05 ? "HEALTHY" : "HEALTHY",
    detail: `Players run at ${(meanCeiling * 100).toFixed(1)}% of what one island's capacity could produce; the ceiling binds only if this approaches 100% for a mature island.`
  });
  checks.push({
    id: "SPECIALISATION",
    question: "Is choosing an element worth anything compared with playing a generalist?",
    verdict: advantage < 0.05 ? "RISK" : advantage < 0.1 ? "WATCH" : advantage > 0.6 ? "WATCH" : "HEALTHY",
    detail: `The strongest element produces ${(advantage * 100).toFixed(1)}% more value per player than the average (target band 20-40%).`
  });
  return checks;
}

/**
 * Fire must never get a *raw* advantage by accident.
 *
 * This is a property of the element table, not of a run, so it is checked directly: Fire's farming,
 * mining and forestry multipliers must all sit below the strongest raw element's.
 */
function fireRawAdvantage(result: SimulationResult): DominanceCheck {
  const fire = ELEMENT_PROFILES.FIRE.capacity;
  const rawProfessions = ["FARMING", "FISHING", "MINING", "FORESTRY"] as const;
  const fireIsRawBest = rawProfessions.some((profession) => {
    const best = Math.max(...Object.values(ELEMENT_PROFILES).map((profile) => profile.capacity[profession]));
    return fire[profession] >= best;
  });
  const fireProcessingBest =
    fire.PROCESSING >= Math.max(...Object.values(ELEMENT_PROFILES).map((profile) => profile.capacity.PROCESSING));
  const fireImports = result.perElement.find((entry) => entry.element === "FIRE");
  return {
    id: "FIRE_DOMINANCE",
    question: "Can Fire out-produce the raw elements, or does it depend on them?",
    verdict: fireIsRawBest ? "RISK" : "HEALTHY",
    detail: fireIsRawBest
      ? "Fire matches or beats the best raw element in at least one gathering profession."
      : `Fire is strongest at industry (processing ${String(fire.PROCESSING)}${fireProcessingBest ? ", the highest" : ""}) and weaker than the specialists at every raw profession${
          fireImports === undefined
            ? "."
            : `; it ran at ${(fireImports.selfSufficiency * 100).toFixed(0)}% self-sufficiency.`
        }`
  };
}

export function formatResult(result: SimulationResult, checks: readonly DominanceCheck[]): string {
  const lines: string[] = [];
  const days = Math.max(1, result.days);
  lines.push(`Scenario ${result.scenarioId}: ${String(result.actors)} actors over ${String(result.days)} days`);
  lines.push(
    `  gold created ${result.totals.goldCreated.toFixed(0)}, destroyed ${result.totals.goldDestroyed.toFixed(0)}, net ` +
      `${result.totals.netGold.toFixed(0)} (${(result.totals.netGold / days).toFixed(0)}/day), end ${result.totals.goldEnd.toFixed(0)}`
  );
  lines.push(
    `  market volume ${result.totals.marketVolumeGold.toFixed(0)} gold, fees destroyed ${result.totals.feesDestroyed.toFixed(0)}, ` +
      `storage pressure day ${String(result.totals.timeToStoragePressureDays ?? "never")}, upgrade day ${String(result.totals.timeToUpgradeDays ?? "never")}`
  );
  for (const entry of result.perElement) {
    lines.push(
      `  ${entry.element.padEnd(6)} players ${entry.players.toFixed(0).padStart(6)}  output ${entry.outputValuePerDay.toFixed(0).padStart(9)} gold/day  ` +
        `self-sufficiency ${(entry.selfSufficiency * 100).toFixed(0).padStart(3)}%  gold/day ${entry.goldPerDay.toFixed(1).padStart(8)}`
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
