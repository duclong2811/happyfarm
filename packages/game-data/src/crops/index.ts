import { z } from "zod";
import { DefinitionIdSchema } from "../schema";
import { itemRegistry } from "../items";

export const CropDefinitionSchema = z
  .object({
    id: z.string().regex(/^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^crop\.[a-z0-9_]+\.name$/),
    growthDurationSeconds: z.number().int().positive().max(31_536_000),
    growthStages: z.number().int().min(2).max(16),
    /**
     * The player level that unlocks this crop. Absent means the starting crop: no requirement.
     *
     * A farm has no level of its own, so this is the *player's* level. `requiredLevelFor` in
     * `packages/domain/src/crop.ts` is the single rule that reads it, so designers set a number here
     * and cannot invent a second interpretation of it.
     */
    // Bounded by the same level ceiling the progression schema and `player_progression` use, so game
    // data cannot define a crop no level could ever satisfy — and cannot define one the API contract
    // would reject later, which would take the whole crop catalogue down with it.
    requiredLevel: z.number().int().positive().max(10_000).optional(),
    /**
     * The authoritative seed this crop consumes when it is planted.
     *
     * The planting settlement reads the seed from *here*, never from a client, so a crop and its seed
     * cannot be pointed at different items by a caller. `validateCropItemReferences` refuses a
     * reference that is missing or that is not a `SEED`, and refuses two crops sharing one seed.
     */
    seedItemDefinitionId: z
      .string()
      .regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/)
      .refine((id) => id.startsWith("item_")),
    harvest: z
      .object({
        itemDefinitionId: DefinitionIdSchema.refine((id) => id.startsWith("item_")),
        baseQuantity: z.number().int().positive().max(1_000_000),
        xp: z.number().int().positive().max(1_000_000)
      })
      .strict()
  })
  .strict();

export type CropDefinitionData = z.infer<typeof CropDefinitionSchema>;

export function createCropRegistry(input: unknown): ReadonlyMap<string, CropDefinitionData> {
  const definitions = z.array(CropDefinitionSchema).parse(input);
  const registry = new Map<string, CropDefinitionData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate crop definition: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  return registry;
}

export const cropRegistry = createCropRegistry([
  // An alpha economy, hand-tuned around two invariants a test then holds:
  //
  //   xp        = 0.8 x growth minutes  (a harvest is worth the time it took, so no crop is an XP
  //                                      exploit and none is XP-poor)
  //   net profit strictly rises with growth time (so a shorter crop can never dominate a longer one
  //                                      on every axis at once)
  //
  // Within that shape each crop has a role: carrot is the fast starter, wheat the dependable
  // workhorse, corn the mid-value staple, potato the gold-per-minute bulk crop, tomato a steady
  // premium, strawberry and cabbage the capital-efficient long crops, and pumpkin the long bet.
  // `docs/design/FARMING_BALANCE.md` carries the table and `tests/game-data/farming-balance.test.ts`
  // recomputes it from these definitions.
  {
    id: "crop_carrot",
    displayNameKey: "crop.carrot.name",
    growthDurationSeconds: 300,
    growthStages: 4,
    seedItemDefinitionId: "item_carrot_seed",
    harvest: { itemDefinitionId: "item_carrot", baseQuantity: 2, xp: 4 }
  },
  {
    id: "crop_wheat",
    displayNameKey: "crop.wheat.name",
    growthDurationSeconds: 900,
    growthStages: 5,
    requiredLevel: 2,
    seedItemDefinitionId: "item_wheat_seed",
    harvest: { itemDefinitionId: "item_wheat", baseQuantity: 3, xp: 12 }
  },
  {
    id: "crop_corn",
    displayNameKey: "crop.corn.name",
    growthDurationSeconds: 1800,
    growthStages: 4,
    requiredLevel: 3,
    seedItemDefinitionId: "item_corn_seed",
    harvest: { itemDefinitionId: "item_corn", baseQuantity: 3, xp: 24 }
  },
  {
    id: "crop_potato",
    displayNameKey: "crop.potato.name",
    growthDurationSeconds: 1200,
    growthStages: 4,
    requiredLevel: 4,
    seedItemDefinitionId: "item_potato_seed",
    harvest: { itemDefinitionId: "item_potato", baseQuantity: 4, xp: 16 }
  },
  {
    id: "crop_tomato",
    displayNameKey: "crop.tomato.name",
    growthDurationSeconds: 2700,
    growthStages: 5,
    requiredLevel: 5,
    seedItemDefinitionId: "item_tomato_seed",
    harvest: { itemDefinitionId: "item_tomato", baseQuantity: 7, xp: 36 }
  },
  {
    id: "crop_strawberry",
    displayNameKey: "crop.strawberry.name",
    growthDurationSeconds: 3600,
    growthStages: 5,
    requiredLevel: 6,
    seedItemDefinitionId: "item_strawberry_seed",
    harvest: { itemDefinitionId: "item_strawberry", baseQuantity: 8, xp: 48 }
  },
  {
    id: "crop_cabbage",
    displayNameKey: "crop.cabbage.name",
    growthDurationSeconds: 4500,
    growthStages: 4,
    requiredLevel: 7,
    seedItemDefinitionId: "item_cabbage_seed",
    harvest: { itemDefinitionId: "item_cabbage", baseQuantity: 8, xp: 60 }
  },
  {
    id: "crop_pumpkin",
    displayNameKey: "crop.pumpkin.name",
    growthDurationSeconds: 5400,
    growthStages: 4,
    requiredLevel: 8,
    seedItemDefinitionId: "item_pumpkin_seed",
    harvest: { itemDefinitionId: "item_pumpkin", baseQuantity: 10, xp: 72 }
  }
]);

export function validateCropItemReferences(
  cropDefinitions: ReadonlyMap<string, CropDefinitionData>,
  itemDefinitions: ReadonlyMap<string, { readonly category?: string }>
): void {
  const claimedSeeds = new Set<string>();
  for (const crop of cropDefinitions.values()) {
    if (!itemDefinitions.has(crop.harvest.itemDefinitionId)) {
      throw new Error(`Unknown harvest item definition: ${crop.harvest.itemDefinitionId}`);
    }
    const seed = itemDefinitions.get(crop.seedItemDefinitionId);
    if (seed === undefined || seed.category !== "SEED") {
      throw new Error(`Unknown seed item definition: ${crop.seedItemDefinitionId}`);
    }
    // Two crops sharing one seed would make a harvest ambiguous about what it cost, so the catalogue
    // is refused at load rather than left to be interpreted at runtime.
    if (claimedSeeds.has(crop.seedItemDefinitionId)) {
      throw new Error(`Duplicate seed item reference: ${crop.seedItemDefinitionId}`);
    }
    claimedSeeds.add(crop.seedItemDefinitionId);
  }
}

validateCropItemReferences(cropRegistry, itemRegistry);

export const crops = [...cropRegistry.values()];
