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
