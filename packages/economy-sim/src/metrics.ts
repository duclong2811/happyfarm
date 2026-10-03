import { ELEMENT_IDS, type ElementId } from "./elements";

/**
 * What a simulation reports.
 *
 * Every number the phase brief asks for has a home here, and nothing is computed by hand in a
 * document: the docs print these values. A metric that cannot be derived from the run is a metric the
 * model cannot yet support, and it is left out rather than guessed.
 */

export interface DayMetrics {
  readonly day: number;
  /** Gold the NPC shop paid out for goods: the world's main faucet. */
  readonly goldCreated: number;
  /** Gold spent on seeds, inputs, wages, upgrades, fees and modelled sinks. */
  readonly goldDestroyed: number;
  readonly goldTotal: number;
  readonly production: Readonly<Record<string, number>>;
  readonly consumption: Readonly<Record<string, number>>;
  readonly wasted: Readonly<Record<string, number>>;
  /** Gold value that changed hands between players. */
  readonly marketVolumeGold: number;
  readonly marketFeesDestroyed: number;
  readonly xpGained: number;
  /** Share of a cohort's storage that is full, averaged over cohorts. */
  readonly storageFillRate: number;
  /** Produced units over what the island's capacity could have produced. */
  readonly ceilingUtilization: number;
  /** Worker output over what the workforce could have produced with full inputs. */
  readonly npcProductivity: number;
  readonly storageUpgrades: number;
}

export interface ElementMetrics {
  readonly element: ElementId;
  readonly players: number;
  readonly goldPerDay: number;
  readonly xpPerDay: number;
  /** Gold value of everything the element's players produced per day, at base value. */
  readonly outputValuePerDay: number;
  /** Share of its own consumption the element produced itself. */
  readonly selfSufficiency: number;
  readonly importsGoldPerDay: number;
  readonly exportsGoldPerDay: number;
}

export interface ItemMetrics {
  readonly itemDefinitionId: string;
  readonly producedPerDay: number;
  readonly consumedPerDay: number;
  /** Demand that could not be met from production or trade, over demand. */
  readonly scarcity: number;
  readonly baseValue: number;
  readonly clearingPrice: number;
}

export interface SimulationTotals {
  readonly goldCreated: number;
  readonly goldDestroyed: number;
  readonly netGold: number;
  readonly goldEnd: number;
  readonly xpTotal: number;
  readonly marketVolumeGold: number;
  readonly feesDestroyed: number;
  /** The day storage first ran above 90% full, or null. */
  readonly timeToStoragePressureDays: number | null;
  /** The day the first storage upgrade was bought, or null. */
  readonly timeToUpgradeDays: number | null;
}

export interface SimulationResult {
  readonly scenarioId: string;
  readonly days: number;
  readonly actors: number;
  readonly daily: readonly DayMetrics[];
  readonly totals: SimulationTotals;
  readonly perElement: readonly ElementMetrics[];
  readonly perItem: readonly ItemMetrics[];
  /** Human-readable structural findings, in the order the engine noticed them. */
  readonly findings: readonly string[];
}

/** Structural checks the brief calls out by name, run over a finished result. */
export interface DominanceCheck {
  readonly id: string;
  readonly question: string;
  readonly verdict: "HEALTHY" | "WATCH" | "RISK";
  readonly detail: string;
}

export function elementShare(result: SimulationResult): Readonly<Record<ElementId, number>> {
  const shares = Object.fromEntries(ELEMENT_IDS.map((id) => [id, 0])) as Record<ElementId, number>;
  const totalPlayers = result.perElement.reduce((sum, entry) => sum + entry.players, 0);
  for (const entry of result.perElement) {
    shares[entry.element] = totalPlayers === 0 ? 0 : entry.players / totalPlayers;
  }
  return shares;
}

/**
 * The strongest element's output value against the average - the specialisation advantage, as a
 * fraction. 0.25 means the best island produces 25% more value per player than an ordinary one.
 */
export function specialisationAdvantage(result: SimulationResult): number {
  const perPlayer = result.perElement
    .filter((entry) => entry.players > 0)
    .map((entry) => entry.outputValuePerDay / entry.players);
  if (perPlayer.length === 0) return 0;
  const average = perPlayer.reduce((sum, value) => sum + value, 0) / perPlayer.length;
  if (average <= 0) return 0;
  return Math.max(...perPlayer) / average - 1;
}

export function meanStorageFill(result: SimulationResult): number {
  const values = result.daily.map((day) => day.storageFillRate);
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
