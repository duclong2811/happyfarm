import type { ActorProfile, StageId } from "./model";
import { ELEMENT_IDS, type ElementId } from "./elements";

/**
 * The required scenarios A-O, plus the five mandated population mixes, as data.
 *
 * A scenario says who is in the world, how many, how they play, which stage of the island they are at,
 * and which future systems are switched on. Nothing about the *rules* lives here, so a scenario is a
 * readable answer to "what are we testing". `stage` drives development tiers; `elementMix` and
 * `archetypeMix` drive who is playing.
 */

export interface ScenarioFeatures {
  readonly storage: boolean;
  readonly workers: boolean;
  readonly processing: boolean;
  readonly market: boolean;
  readonly livestock: boolean;
  readonly sinks: boolean;
  readonly upgrades: boolean;
  readonly npcShop: boolean;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly days: number;
  readonly actors: number;
  readonly stage: StageId;
  /** A human label for the population mix, printed by the report. */
  readonly mixLabel: string;
  readonly elementMix: Readonly<Record<ElementId, number>>;
  readonly archetypeMix: Readonly<Record<ActorProfile["id"], number>>;
  readonly features: ScenarioFeatures;
}

const SINGLE_ELEMENT: Readonly<Record<ElementId, number>> = {
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

const WATER_HEAVY: Readonly<Record<ElementId, number>> = { EARTH: 0.2, WATER: 0.4, WOOD: 0.15, METAL: 0.1, FIRE: 0.15 };
const FIRE_HEAVY: Readonly<Record<ElementId, number>> = { EARTH: 0.2, WATER: 0.15, WOOD: 0.15, METAL: 0.1, FIRE: 0.4 };
const METAL_SHORTAGE: Readonly<Record<ElementId, number>> = { EARTH: 0.25, WATER: 0.25, WOOD: 0.25, METAL: 0.1, FIRE: 0.15 };
const WOOD_SHORTAGE: Readonly<Record<ElementId, number>> = { EARTH: 0.25, WATER: 0.25, WOOD: 0.1, METAL: 0.2, FIRE: 0.2 };
const EARTH_SHORTAGE: Readonly<Record<ElementId, number>> = { EARTH: 0.1, WATER: 0.25, WOOD: 0.25, METAL: 0.2, FIRE: 0.2 };

function only(element: ElementId): Readonly<Record<ElementId, number>> {
  return Object.fromEntries(ELEMENT_IDS.map((id) => [id, id === element ? 1 : 0])) as Record<ElementId, number>;
}

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

const WORKER_HEAVY_MIX: Readonly<Record<ActorProfile["id"], number>> = {
  CASUAL: 0.05,
  NORMAL: 0.15,
  HARDCORE: 0.3,
  AUTOMATED: 0.5
};

const NO_FEATURES: ScenarioFeatures = {
  storage: false,
  workers: false,
  processing: false,
  market: false,
  livestock: false,
  sinks: false,
  upgrades: false,
  npcShop: false
};

function features(overrides: Partial<ScenarioFeatures>): ScenarioFeatures {
  return { ...NO_FEATURES, ...overrides };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "A",
    name: "Starter island, no player trade, no workers",
    question: "What does one starter island produce, and can it live without the player market?",
    days: 30,
    actors: 1,
    stage: "EARLY",
    mixLabel: "one normal Earth player",
    elementMix: SINGLE_ELEMENT,
    archetypeMix: ONE_NORMAL_PLAYER,
    features: features({ npcShop: true })
  },
  {
    id: "B",
    name: "Early progression with the NPC safety net",
    question: "Can 100 early players progress on self-production plus the NPC shop alone?",
    days: 30,
    actors: 100,
    stage: "EARLY",
    mixLabel: "balanced, realistic",
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, npcShop: true })
  },
  {
    id: "C",
    name: "Developing island with a small player market",
    question: "Once the market opens, does it save meaningful time and resources?",
    days: 30,
    actors: 100,
    stage: "DEVELOPING",
    mixLabel: "balanced, realistic",
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, market: true, npcShop: true })
  },
  {
    id: "D",
    name: "Mid game with the first workers",
    question: "Do hired workers raise utilisation, and do they stop at the island's capacity?",
    days: 30,
    actors: 200,
    stage: "MID",
    mixLabel: "balanced, realistic",
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, market: true, npcShop: true })
  },
  {
    id: "E",
    name: "Mature specialised Home Island",
    question: "At industrial scale, does specialisation create real cross-element dependency?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "balanced, realistic",
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "F",
    name: "Fire industrialisation",
    question: "Does a mature Fire island import its raw inputs, or feed itself?",
    days: 30,
    actors: 200,
    stage: "INDUSTRIAL",
    mixLabel: "100% Fire",
    elementMix: only("FIRE"),
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "G",
    name: "Metal extraction specialisation",
    question: "How much ore and coal can a Metal island supply the world with?",
    days: 30,
    actors: 200,
    stage: "INDUSTRIAL",
    mixLabel: "100% Metal",
    elementMix: only("METAL"),
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "H",
    name: "Water maritime specialisation",
    question: "Does a Water island become a fish and provisions exporter, and a timber importer?",
    days: 30,
    actors: 200,
    stage: "INDUSTRIAL",
    mixLabel: "100% Water",
    elementMix: only("WATER"),
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "I",
    name: "Wood forestry specialisation",
    question: "Does a Wood island become the world's timber, hardwood and resin supplier?",
    days: 30,
    actors: 200,
    stage: "INDUSTRIAL",
    mixLabel: "100% Wood",
    elementMix: only("WOOD"),
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "J",
    name: "Earth agricultural specialisation",
    question: "Can an Earth island feed a world and still need its neighbours?",
    days: 30,
    actors: 200,
    stage: "INDUSTRIAL",
    mixLabel: "100% Earth",
    elementMix: only("EARTH"),
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "K",
    name: "Self-sufficient player",
    question: "What does one island give up when it refuses the market entirely?",
    days: 30,
    actors: 1,
    stage: "INDUSTRIAL",
    mixLabel: "one automated Earth player",
    elementMix: SINGLE_ELEMENT,
    archetypeMix: { CASUAL: 0, NORMAL: 0, HARDCORE: 0, AUTOMATED: 1 },
    features: features({ storage: true, upgrades: true, workers: true, processing: true, livestock: true, npcShop: true })
  },
  {
    id: "L",
    name: "Specialised trader",
    question: "How much better is a Fire island that buys what it cannot make?",
    days: 30,
    actors: 1,
    stage: "INDUSTRIAL",
    mixLabel: "one automated Fire player",
    elementMix: only("FIRE"),
    archetypeMix: { CASUAL: 0, NORMAL: 0, HARDCORE: 0, AUTOMATED: 1 },
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "M",
    name: "Worker-heavy economy",
    question: "If most players hire heavily, do workers saturate the island or stop at its capacity?",
    days: 30,
    actors: 300,
    stage: "INDUSTRIAL",
    mixLabel: "balanced, worker-heavy",
    elementMix: EVEN_SPREAD,
    archetypeMix: WORKER_HEAVY_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "N",
    name: "Population imbalance (Water and Fire heavy)",
    question: "When the world leans to Water and Fire, what becomes scarce and how hard does the price move?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "Water-heavy",
    elementMix: WATER_HEAVY,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "O",
    name: "Mature economy with abstract ships, army and naval sinks",
    question: "Do the future military and naval sinks have plausible demand channels?",
    days: 60,
    actors: 1000,
    stage: "WORLD",
    mixLabel: "balanced, realistic",
    elementMix: EVEN_SPREAD,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, sinks: true, npcShop: true })
  },
  {
    id: "P",
    name: "Fire-heavy world",
    question: "What happens when 40% of players run Fire industry?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "Fire-heavy",
    elementMix: FIRE_HEAVY,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "Q",
    name: "Metal shortage",
    question: "With at most 10% Metal, do ore and steel become the bottleneck?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "Metal-shortage",
    elementMix: METAL_SHORTAGE,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "R",
    name: "Wood shortage",
    question: "With at most 10% Wood, does timber stall the industrial economies?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "Wood-shortage",
    elementMix: WOOD_SHORTAGE,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
  },
  {
    id: "S",
    name: "Earth shortage",
    question: "With at most 10% Earth, does food become the thing everyone needs?",
    days: 30,
    actors: 500,
    stage: "INDUSTRIAL",
    mixLabel: "Earth-shortage",
    elementMix: EARTH_SHORTAGE,
    archetypeMix: REALISTIC_MIX,
    features: features({ storage: true, upgrades: true, workers: true, processing: true, market: true, livestock: true, npcShop: true })
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

for (const scenario of SCENARIOS) assertScenario(scenario);
