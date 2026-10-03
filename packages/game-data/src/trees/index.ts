import { z } from "zod";
import { DefinitionIdSchema } from "../schema";
import { itemRegistry } from "../items";

/**
 * A repeating producer's static definition.
 *
 * Two durations rather than one, because the first fruit and every fruit after it are separate
 * design choices: a tree that takes an hour to bear fruit the first time can still be worth picking
 * every fifteen minutes afterwards. `regrowSeconds` is the whole repeating loop, and the domain
 * derives every ready/phase/stage answer from it rather than storing one.
 */
export const TreeDefinitionSchema = z
  .object({
    id: z.string().regex(/^tree_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^tree\.[a-z0-9_]+\.name$/),
    /**
     * The sapling this tree consumes when planted, exactly one.
     *
     * `validateTreeItemReferences` refuses a reference that is missing or that is not a `SEED`, so a
     * tree can never be planted with something the shop does not sell as its input.
     */
    saplingItemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    firstReadySeconds: z.number().int().positive().max(31_536_000),
    regrowSeconds: z.number().int().positive().max(31_536_000),
    growthStages: z.number().int().min(2).max(16),
    /** Bounded by the same level ceiling the progression schema and the API contract use. */
    requiredLevel: z.number().int().positive().max(10_000).optional(),
    harvest: z
      .object({
        itemDefinitionId: DefinitionIdSchema.refine((id) => id.startsWith("item_")),
        baseQuantity: z.number().int().positive().max(1_000_000),
        xp: z.number().int().positive().max(1_000_000)
      })
      .strict()
  })
  .strict();

export type TreeDefinitionData = z.infer<typeof TreeDefinitionSchema>;

export function createTreeRegistry(input: unknown): ReadonlyMap<string, TreeDefinitionData> {
  const definitions = z.array(TreeDefinitionSchema).parse(input);
  const registry = new Map<string, TreeDefinitionData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate tree definition: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  return registry;
}

/**
 * The orchard: three species on one lifecycle.
 *
 * A tree is a long-term investment, not a better crop: its sapling costs more than any seed, its
 * first fruit takes one to two hours, and every fruit after that repeats on a cycle. Its gold per
 * minute sits at or just below the best field crop, because it pays without replanting; its XP per
 * minute is deliberately lower (0.6 against the crops' 0.8), so the orchard is not the XP path.
 *
 * Every species obeys `two harvests repay the sapling` - the rule `tests/game-data/trees.test.ts`
 * enforces - so a sapling can never be a trap. Later species are longer bets: more sapling, a longer
 * first wait, a longer cycle, and a larger cycle payoff.
 *
 * `docs/design/FARMING_BALANCE.md` carries the numbers; no use case knows them.
 */
export const treeRegistry = createTreeRegistry([
  {
    id: "tree_apple",
    displayNameKey: "tree.apple.name",
    saplingItemDefinitionId: "item_apple_sapling",
    firstReadySeconds: 3600,
    regrowSeconds: 900,
    growthStages: 4,
    requiredLevel: 3,
    harvest: { itemDefinitionId: "item_apple", baseQuantity: 3, xp: 9 }
  },
  {
    id: "tree_orange",
    displayNameKey: "tree.orange.name",
    saplingItemDefinitionId: "item_orange_sapling",
    firstReadySeconds: 5400,
    regrowSeconds: 1200,
    growthStages: 4,
    requiredLevel: 5,
    harvest: { itemDefinitionId: "item_orange", baseQuantity: 3, xp: 12 }
  },
  {
    id: "tree_peach",
    displayNameKey: "tree.peach.name",
    saplingItemDefinitionId: "item_peach_sapling",
    firstReadySeconds: 7200,
    regrowSeconds: 1500,
    growthStages: 4,
    requiredLevel: 9,
    harvest: { itemDefinitionId: "item_peach", baseQuantity: 4, xp: 15 }
  }
]);

/**
 * Refuses a catalogue whose trees point at items a planting or a harvest could not settle.
 *
 * A tree's sapling has to be a real `SEED` because that is the category the shop sells, and its
 * fruit has to be a real `CROP` because that is the category the shop buys back. Two trees sharing
 * one sapling would make a planting ambiguous about which tree it paid for, so that is refused at
 * load rather than interpreted at runtime.
 */
export function validateTreeItemReferences(
  treeDefinitions: ReadonlyMap<string, TreeDefinitionData>,
  itemDefinitions: ReadonlyMap<string, { readonly category?: string }>
): void {
  const claimedSaplings = new Set<string>();
  for (const tree of treeDefinitions.values()) {
    const fruit = itemDefinitions.get(tree.harvest.itemDefinitionId);
    if (fruit === undefined || fruit.category !== "CROP") {
      throw new Error(`Unknown harvest item definition: ${tree.harvest.itemDefinitionId}`);
    }
    const sapling = itemDefinitions.get(tree.saplingItemDefinitionId);
    if (sapling === undefined || sapling.category !== "SEED") {
      throw new Error(`Unknown sapling item definition: ${tree.saplingItemDefinitionId}`);
    }
    if (claimedSaplings.has(tree.saplingItemDefinitionId)) {
      throw new Error(`Duplicate sapling item reference: ${tree.saplingItemDefinitionId}`);
    }
    claimedSaplings.add(tree.saplingItemDefinitionId);
  }
}

validateTreeItemReferences(treeRegistry, itemRegistry);

export const trees = [...treeRegistry.values()];
