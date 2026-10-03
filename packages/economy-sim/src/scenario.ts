import type { ActorProfile } from "./model";
import { ELEMENT_IDS, type ElementId } from "./elements";

/**
 * Scenarios A-H from the phase brief, as data.
 *
 * A scenario says who is in the world, how many, how they play, and which future systems are switched
 * on. Nothing about the *rules* lives here, so a scenario is a readable answer to "what are we testing".
 */

export interface ScenarioFeatures {
  readonly storage: boolean;
  readonly workers: boolean;
  readonly processing: boolean;
  readonly market: boolean;
  readonly livestock: boolean;
  readonly sinks: boolean;
  readonly upgrades: boolean;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly days: number;
  readonly actors: number;
  readonly elementMix: Readonly<Record<ElementId, number>>;
  readonly archetypeMix: Readonly<Record<ActorProfile["id"], number>>;
  readonly features: ScenarioFeatures;
}

const PURE_FARM_ISLAND: Readonly<Record<ElementId, number>> = {
  // Scenario A is today's game: one island, one player, no elements.
  EARTH: 1,
  WATER: 0,
  WOOD: 0,
  METAL: 0,
  FIRE: 0
};

const EVEN_SPREAD: Readonly<Record<ElementId, number>> = {
  EARTH: 0.2,
  WATER: 0.2,
  WOOD: 0.2,
  METAL: 0.2,
  FIRE: 0.2
};

const ONE_NORMAL_PLAYER: Readonly<Record<ActorProfile["id"], number>> = {
  CASUAL: 0,
  NORMAL: 1,
  HARDCORE: 0,
  AUTOMATED: 0
};

const REALISTIC_MIX: Readonly<Record<ActorProfile["id"], number>> = {
  CASUAL: 0.5,
  NORMAL: 0.4,
  HARDCORE: 0.09,
  AUTOMATED: 0.01
};

const NO_FEATURES: ScenarioFeatures = {
  storage: false,
  workers: false,
  processing: false,
  market: false,
  livestock: false,
  sinks: false,
  upgrades: false
};

function features(overrides: Partial<ScenarioFeatures>): ScenarioFeatures {
  return { ...NO_FEATURES, ...overrides };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "A",
    name: "Current economy baseline",
    question: "What does one normal player earn today, and how fast does a single island fill up?",
    days: 30,
    actors: 1,
    elementMix: PURE_FARM_ISLAND,
    archetypeMix: ONE_NORMAL_PLAYER,
    features: features({})
  },
  {
    id: "B",
    name: "Five elements, no automation",
    question: "Do comparative advantages alone create trade pressure, or is every island self-sufficient?",
    days: 30,
    actors: 100,
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    // The player market exists here even though automation does not: the question is whether
    // comparative advantage alone creates trade, and a scenario with no market could only answer "no".
    features: features({ market: true })
  },
  {
    id: "C",
    name: "Five elements + storage constraints",
    question: "When does finite storage start costing production, and does upgrading beat trading?",
    days: 30,
    actors: 100,
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true })
  },
  {
    id: "D",
    name: "Five elements + NPC workers",
    question: "Do hired workers pay for their food and wages, and do they compound?",
    days: 30,
    actors: 100,
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true })
  },
  {
    id: "E",
    name: "Workers + processing + trade",
    question: "Does processing and player trade make specialisation clearly better than self-sufficiency?",
    days: 30,
    actors: 500,
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true })
  },
  {
    id: "F",
    name: "Mature economy with logistics and military sinks",
    question: "Can plausible military and voyage consumption absorb a mature economy's output?",
    days: 90,
    actors: 1000,
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({
      storage: true,
      upgrades: true,
      workers: true,
      processing: true,
      market: true,
      livestock: true,
      sinks: true
    })
  },
  {
    id: "G",
    name: "Element population imbalance",
    question: "When the population leans to one element, what becomes scarce and how hard does the price move?",
    days: 30,
    actors: 500,
    elementMix: { EARTH: 0.1, WATER: 0.4, WOOD: 0.1, METAL: 0.1, FIRE: 0.3 },
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true })
  },
  {
    id: "H",
    name: "Self-sufficient island vs specialised trader",
    question: "How much does a balanced island give up against one that buys what it lacks?",
    days: 30,
    actors: 200,
    // Every element, but half the population plays a single element as its only source of everything.
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true })
  }
];

export function scenarioById(id: string): Scenario {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (scenario === undefined) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}

/** The shares sum to one, and every element is present (possibly at zero). */
export function assertScenario(scenario: Scenario): void {
  const elementTotal = ELEMENT_IDS.reduce((sum, id) => sum + scenario.elementMix[id], 0);
  if (Math.abs(elementTotal - 1) > 1e-9) {
    throw new Error(`Scenario ${scenario.id} element mix does not sum to 1`);
  }
  const archetypeTotal = Object.values(scenario.archetypeMix).reduce((sum, share) => sum + share, 0);
  if (Math.abs(archetypeTotal - 1) > 1e-9) {
    throw new Error(`Scenario ${scenario.id} archetype mix does not sum to 1`);
  }
  if (!Number.isSafeInteger(scenario.days) || scenario.days <= 0) {
    throw new Error(`Scenario ${scenario.id} needs a positive whole number of days`);
  }
  if (!Number.isSafeInteger(scenario.actors) || scenario.actors <= 0) {
    throw new Error(`Scenario ${scenario.id} needs a positive whole number of actors`);
  }
}
