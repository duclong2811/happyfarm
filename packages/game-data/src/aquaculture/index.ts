import { z } from "zod";

/** Server-owned cage contract: one cage holds at most ten fish. */
export const AquacultureDefinitionSchema = z
  .object({
    stockingItemDefinitionId: z.literal("item_fish_tilapia"),
    harvestItemDefinitionId: z.literal("item_fish_tilapia_adult"),
    growthDurationSeconds: z.number().int().positive().max(31_536_000),
    capacity: z.number().int().positive().max(10_000)
  })
  .strict();

export const aquacultureDefinition = AquacultureDefinitionSchema.parse({
  stockingItemDefinitionId: "item_fish_tilapia",
  harvestItemDefinitionId: "item_fish_tilapia_adult",
  growthDurationSeconds: 3_600,
  capacity: 10
});
