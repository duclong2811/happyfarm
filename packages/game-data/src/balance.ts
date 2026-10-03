import { cropRegistry, type CropDefinitionData } from "./crops";
import {
  FISHING_ACTION_SECONDS,
  fish,
  fishingSpots,
  fishingTables,
  type FishDefinitionData,
  type FishingTableData
} from "./fishing";
import { shopRegistry } from "./shops";
import {
  resourceDefinitionRegistry,
  resourceDropTableRegistry,
  resourceNodes
} from "./resources";
import { treeRegistry, type TreeDefinitionData } from "./trees";

/**
 * The farming economy, computed from the definitions rather than restated.
 *
 * A balance pass is only reviewable if the numbers behind it are derived from the same catalogue the
 * game runs, so this module is the one place that turns a crop or tree plus its shop entries into the
 * figures a designer reasons about: net profit, ROI, gold per minute, XP per minute. The balance test
 * asserts the shape of these numbers and `docs/design/FARMING_BALANCE.md` prints them; neither
 * restates a value by hand.
 *
 * Currency is assumed to be gold and one unit per item (the shop sells and buys exactly one item per
 * entry), which is what every shipped entry does. The module throws when a definition has no price,
 * so a crop added without a market row fails here rather than silently scoring zero.
 */

export interface CropEconomics {
  readonly id: string;
  readonly requiredLevel: number;
  readonly growthSeconds: number;
  readonly growthMinutes: number;
  readonly seedCost: number;
  readonly yieldPerHarvest: number;
  readonly sellPrice: number;
  readonly grossRevenue: number;
  readonly netProfit: number;
  readonly roi: number;
  readonly goldPerMinute: number;
  readonly xp: number;
  readonly xpPerMinute: number;
}

export interface TreeEconomics {
  readonly id: string;
  readonly requiredLevel: number;
  readonly saplingCost: number;
  readonly firstReadySeconds: number;
  readonly firstReadyMinutes: number;
  readonly cycleSeconds: number;
  readonly cycleMinutes: number;
  readonly yieldPerCycle: number;
  readonly sellPrice: number;
  readonly revenuePerCycle: number;
  readonly goldPerMinute: number;
  readonly xpPerCycle: number;
  readonly xpPerMinute: number;
  /** Harvests needed for the cycle revenue to repay the sapling; the game-data test caps it at 2. */
  readonly paybackCycles: number;
}

function requiredBuyPrice(itemDefinitionId: string): number {
  const entry = [...shopRegistry.values()].find((row) => row.itemDefinitionId === itemDefinitionId);
  if (entry?.buyPrice === undefined) {
    throw new Error(`No buy entry prices ${itemDefinitionId}`);
  }
  return entry.buyPrice;
}

function requiredSellPrice(itemDefinitionId: string): number {
  const entry = [...shopRegistry.values()].find((row) => row.itemDefinitionId === itemDefinitionId);
  if (entry?.sellPrice === undefined) {
    throw new Error(`No sell entry prices ${itemDefinitionId}`);
  }
  return entry.sellPrice;
}

export function cropEconomics(crop: CropDefinitionData): CropEconomics {
  const seedCost = requiredBuyPrice(crop.seedItemDefinitionId);
  const sellPrice = requiredSellPrice(crop.harvest.itemDefinitionId);
  const grossRevenue = crop.harvest.baseQuantity * sellPrice;
  const netProfit = grossRevenue - seedCost;
  const growthMinutes = crop.growthDurationSeconds / 60;
  return {
    id: crop.id,
    requiredLevel: crop.requiredLevel ?? 1,
    growthSeconds: crop.growthDurationSeconds,
    growthMinutes,
    seedCost,
    yieldPerHarvest: crop.harvest.baseQuantity,
    sellPrice,
    grossRevenue,
    netProfit,
    roi: netProfit / seedCost,
    goldPerMinute: netProfit / growthMinutes,
    xp: crop.harvest.xp,
    xpPerMinute: crop.harvest.xp / growthMinutes
  };
}

export function treeEconomics(tree: TreeDefinitionData): TreeEconomics {
  const saplingCost = requiredBuyPrice(tree.saplingItemDefinitionId);
  const sellPrice = requiredSellPrice(tree.harvest.itemDefinitionId);
  const revenuePerCycle = tree.harvest.baseQuantity * sellPrice;
  const cycleMinutes = tree.regrowSeconds / 60;
  return {
    id: tree.id,
    requiredLevel: tree.requiredLevel ?? 1,
    saplingCost,
    firstReadySeconds: tree.firstReadySeconds,
    firstReadyMinutes: tree.firstReadySeconds / 60,
    cycleSeconds: tree.regrowSeconds,
    cycleMinutes,
    yieldPerCycle: tree.harvest.baseQuantity,
    sellPrice,
    revenuePerCycle,
    goldPerMinute: revenuePerCycle / cycleMinutes,
    xpPerCycle: tree.harvest.xp,
    xpPerMinute: tree.harvest.xp / cycleMinutes,
    paybackCycles: saplingCost / revenuePerCycle
  };
}

export const farmingBalance = {
  crops: [...cropRegistry.values()].map(cropEconomics),
  trees: [...treeRegistry.values()].map(treeEconomics)
} as const;

export interface FishEconomics extends FishDefinitionData {
  /** This species' share of its table, 0..1. */
  readonly probability: number;
  /** sellPrice x probability - the gold this species contributes to one action's expectation. */
  readonly goldContribution: number;
  readonly xpContribution: number;
}

export interface FishingTableEconomics {
  readonly id: string;
  /** The spots that pull from this table. A spot is the *place*; the table is the *odds*. */
  readonly spotIds: readonly string[];
  readonly entries: readonly FishEconomics[];
  readonly expectedGoldPerAction: number;
  readonly expectedXpPerAction: number;
  readonly goldPerMinute: number;
  readonly xpPerMinute: number;
}

/**
 * The fishing economy, computed from the catch tables exactly as the crops are computed from theirs.
 *
 * `goldPerMinute` divides by the server's own action duration, so retuning the wait retunes the rate
 * without touching a fish's value; the fishing balance test holds the result against the farming
 * numbers in `farmingBalance`.
 */
export function fishingTableEconomics(table: FishingTableData): FishingTableEconomics {
  const totalWeight = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  const entries: FishEconomics[] = table.entries.map((entry) => {
    const definition = fish.find((candidate) => candidate.id === entry.fishId);
    if (definition === undefined) throw new Error(`Unknown fish in table ${table.id}: ${entry.fishId}`);
    const probability = entry.weight / totalWeight;
    return {
      ...definition,
      probability,
      goldContribution: definition.sellPrice * probability,
      xpContribution: definition.xp * probability
    };
  });
  const expectedGoldPerAction = entries.reduce((sum, entry) => sum + entry.goldContribution, 0);
  const expectedXpPerAction = entries.reduce((sum, entry) => sum + entry.xpContribution, 0);
  const minutesPerAction = FISHING_ACTION_SECONDS / 60;
  return {
    id: table.id,
    spotIds: fishingSpots.filter((spot) => spot.tableId === table.id).map((spot) => spot.id),
    entries,
    expectedGoldPerAction,
    expectedXpPerAction,
    goldPerMinute: expectedGoldPerAction / minutesPerAction,
    xpPerMinute: expectedXpPerAction / minutesPerAction
  };
}

export const fishingBalance = {
  actionSeconds: FISHING_ACTION_SECONDS,
  tables: fishingTables.map(fishingTableEconomics)
} as const;

export interface ResourceEconomics {
  readonly id: string;
  readonly verb: string;
  readonly actionSeconds: number;
  readonly regenerationSeconds: number;
  readonly xp: number;
  readonly dropItemDefinitionId: string;
  readonly quantityPerGather: number;
  readonly unitSellPrice: number;
  readonly goldPerGather: number;
  /** How many of this node type stand on Home Island. */
  readonly nodeCount: number;
  /**
   * Sustained gold per minute for this node type once regeneration is accounted for.
   *
   * `nodeCount x goldPerGather / max(nodeCount x actionSeconds, regenerationSeconds)`: mining every
   * node of a type back to back then waiting is the fastest a single player can farm it.
   */
  readonly sustainedGoldPerMinute: number;
  readonly sustainedXpPerMinute: number;
}

/**
 * The mining economy, computed from the node definitions exactly as the crops and fish are.
 *
 * `sustained` is the honest number: instantaneous gold per action is meaningless when the node then
 * has to come back, so the rate divides by whichever is longer - the time to walk and mine every node
 * of that type, or one node's regeneration.
 */
export function resourceEconomics(definitionId: string): ResourceEconomics {
  const definition = resourceDefinitionRegistry.get(definitionId);
  if (definition === undefined) throw new Error(`Unknown resource definition: ${definitionId}`);
  const table = resourceDropTableRegistry.get(definition.dropTableId);
  if (table === undefined) throw new Error(`Unknown drop table: ${definition.dropTableId}`);
  const entry = table.entries[0];
  if (entry === undefined) throw new Error(`Empty drop table: ${table.id}`);
  const unitSellPrice = requiredSellPrice(entry.itemDefinitionId);
  const quantityPerGather = entry.minQuantity;
  const goldPerGather = quantityPerGather * unitSellPrice;
  const nodeCount = resourceNodes.filter((node) => node.definitionId === definition.id).length;
  const windowSeconds = Math.max(nodeCount * definition.actionSeconds, definition.regenerationSeconds);
  const windowsPerMinute = 60 / windowSeconds;
  return {
    id: definition.id,
    verb: definition.verb,
    actionSeconds: definition.actionSeconds,
    regenerationSeconds: definition.regenerationSeconds,
    xp: definition.xp,
    dropItemDefinitionId: entry.itemDefinitionId,
    quantityPerGather,
    unitSellPrice,
    goldPerGather,
    nodeCount,
    sustainedGoldPerMinute: nodeCount * goldPerGather * windowsPerMinute,
    sustainedXpPerMinute: nodeCount * definition.xp * windowsPerMinute
  };
}

export const miningBalance = {
  resources: [...resourceDefinitionRegistry.values()]
    .filter((definition) => definition.verb === "MINE")
    .map((definition) => resourceEconomics(definition.id))
} as const;

/** The forestry half of the same computation: the same shape, filtered by verb. */
export const forestryBalance = {
  resources: [...resourceDefinitionRegistry.values()]
    .filter((definition) => definition.verb === "CHOP")
    .map((definition) => resourceEconomics(definition.id))
} as const;
