import { z } from "zod";

export const DefinitionIdSchema = z.string().regex(/^[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*$/);

export const GameDataDefinitionSchema = z
  .object({
    id: DefinitionIdSchema,
    displayName: z.string().trim().min(1).max(100)
  })
  .strict();

export type GameDataDefinition = z.infer<typeof GameDataDefinitionSchema>;

export function validateDefinitions(input: unknown): readonly GameDataDefinition[] {
  return z.array(GameDataDefinitionSchema).parse(input);
}
