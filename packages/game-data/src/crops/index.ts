import { z } from "zod";
import { DefinitionIdSchema } from "../schema";

export const CropDefinitionSchema = z
  .object({
    id: z.string().regex(/^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().regex(/^crop\.[a-z0-9_]+\.name$/),
    growthDurationSeconds: z.number().int().positive().max(31_536_000),
    growthStages: z.number().int().min(2).max(16),
    requiredFarmLevel: z.number().int().positive().optional(),
    harvest: z
      .object({
        itemDefinitionId: DefinitionIdSchema.refine((id) => id.startsWith("item_")),
        baseQuantity: z.number().int().positive().max(1_000_000)
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
    harvest: { itemDefinitionId: "item_carrot", baseQuantity: 2 }
  },
  {
    id: "crop_wheat",
    displayNameKey: "crop.wheat.name",
    growthDurationSeconds: 900,
    growthStages: 5,
    harvest: { itemDefinitionId: "item_wheat", baseQuantity: 3 }
  },
  {
    id: "crop_corn",
    displayNameKey: "crop.corn.name",
    growthDurationSeconds: 1800,
    growthStages: 4,
    harvest: { itemDefinitionId: "item_corn", baseQuantity: 2 }
  }
]);

export const crops = [...cropRegistry.values()];
