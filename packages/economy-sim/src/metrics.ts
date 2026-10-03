import { ELEMENT_IDS, type ElementId, type IslandCapacity, type Profession } from "./elements";

/**
 * What a simulation reports.
 *
 * Every number the phase brief asks for has a home here, and nothing is computed by hand in a
 * document: the docs print these values. A metric that cannot be derived from the run is a metric the
 * model cannot yet support, and it is left out rather than guessed.
 *
 * V16.1 adds the physical-capacity metrics (`DEVELOPED_CAPACITY`, `PHYSICAL_MAX_CAPACITY`,
 * `HOME_CAPACITY_UTILIZATION`, `MARGINAL_CAPACITY_COST`), the dependency metrics
 * (`IMPORT_DEPENDENCY_RATIO`, `SELF_SUFFICIENCY_INDEX`), the advantage split (`PHYSICAL_`,
 * `EFFICIENCY_`, `TOTAL_SPECIALIZATION_ADVANTAGE`), the worker metrics (`WORKPLACE_UTILIZATION`,
 * `WORKER_PRODUCTIVITY`) and the storage-pressure metrics (`STORAGE_50/80/FULL`, constrained percent,
 * lost output), and separates gold created / destroyed / transferred.
 */

export interface DayMetrics {
  readonly day: number;
  /** Gold the NPC shop paid out for goods: the world's main faucet. */
  readonly goldCreated: number;
  /** Gold spent on seeds, inputs, wages, upgrades, fees and modelled sinks. */
  readonly goldDestroyed: number;
  /** Gold that changed hands between players (market volume), never created or destroyed by trade. */
  readonly goldTransferred: number;
  readonly goldTotal: number;
  readonly production: Readonly<Record<string, number>>;
  readonly consumption: Readonly<Record<string, number>>;
  readonly wasted: Readonly<Record<string, number>>;
  /** Gold value that changed hands between players. */
  readonly marketVolumeGold: number;
  readonly marketFeesDestroyed: number;
  /** Gold value of goods bought from the NPC shop's safety net, and from other players. */
  readonly npcShopImportsGold: number;
  readonly marketImportsGold: number;
  readonly xpGained: number;
  /** Share of a cohort's storage that is full, averaged over cohorts. */
  readonly storageFillRate: number;
  /** Produced units over what the island's developed capacity could produce. */
  readonly capacityUtilization: number;
  /** Worker actions used over the actions the workplace slots could absorb. */
  readonly workplaceUtilization: number;
  /** Worker output over what the workforce could have produced with full inputs. */
  readonly workerProductivity: number;
  /** Retained for V16.0 readers; the same number as `workerProductivity`. */
  readonly npcProductivity: number;
  /** Gold-value of output lost to a full store this day. */
  readonly lostOutputToStorage: number;
  readonly storageUpgrades: number;
}

/** One item's dependency line, per element. */
export interface ItemDependency {
  readonly itemDefinitionId: string;
  readonly producedPerDay: number;
  readonly consumedPerDay: number;
  /** External supply required over total demand, 0..1. */
  readonly importDependency: number;
}

export interface ElementMetrics {
  readonly element: ElementId;
  readonly players: number;
  readonly goldPerDay: number;
  readonly xpPerDay: number;
  /** Gold value of everything the element's players produced per day, at base value. */
  readonly outputValuePerDay: number;
  /** V16.0's coarse figure, kept so nothing that read it breaks: produced value over produced+imported. */
  readonly selfSufficiency: number;
  /** Produced-over-consumed across every item, weighted by base value, 0..1. */
  readonly selfSufficiencyIndex: number;
  readonly importsGoldPerDay: number;
  readonly exportsGoldPerDay: number;
  /** The island's physical ceiling and its developed state. */
  readonly physicalMaxCapacity: IslandCapacity;
  readonly developedCapacity: IslandCapacity;
  /** Worked share of each profession's developed capacity. */
  readonly homeCapacityUtilization: Readonly<Record<Profession, number>>;
  readonly workplaceUtilization: number;
  readonly workerProductivity: number;
  /** How much of its own consumption each strategic resource had to import. */
  readonly importDependency: readonly ItemDependency[];
  /** The advantage split: geography, then efficiency, then the two combined. */
  readonly physicalCapacityAdvantage: number;
  readonly efficiencyAdvantage: number;
  readonly totalSpecializationAdvantage: number;
  /** Gold-equivalent cost of the next +1 unit of the element's primary capacity. */
  readonly marginalCapacityCost: number;
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

/** When storage first crossed each milestone, in days, or null if it never did. */
export interface StorageMilestones {
  readonly first50: number | null;
  readonly first80: number | null;
  readonly firstFull: number | null;
}

export interface SimulationTotals {
  readonly goldCreated: number;
  readonly goldDestroyed: number;
  readonly goldTransferred: number;
  readonly netGold: number;
  readonly goldEnd: number;
  readonly xpTotal: number;
  readonly marketVolumeGold: number;
  readonly feesDestroyed: number;
  readonly npcShopImportsGold: number;
  readonly marketImportsGold: number;
  /** Share of everything elements consumed that came through the NPC safety net / the player market. */
  readonly npcShopShareOfInput: number;
  readonly marketShareOfInput: number;
  readonly storage: StorageMilestones;
  readonly storageConstrainedPercent: number;
  readonly lostOutputToStorage: number;
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
 * The strongest element's output value against the average - the total specialisation advantage, as a
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

export function meanWorkerProductivity(result: SimulationResult): number {
  const values = result.daily.map((day) => day.npcProductivity);
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function meanCapacityUtilization(result: SimulationResult): number {
  const values = result.daily.map((day) => day.capacityUtilization);
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
