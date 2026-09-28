import { z } from "zod";

/**
 * The numbers behind player levelling.
 *
 * Level 1 starts at zero experience, and moving from level n to level n + 1 costs `n * xpStep`, so
 * the total needed to reach level L is the triangular number `xpStep * (L - 1) * L / 2`. At the
 * values below that is 147,000 experience for the cap, which stays far inside the safe integer
 * range and inside the documented `player_progression` bounds.
 *
 * Only the numbers live here. The arithmetic lives in `packages/domain/src/progression.ts`, so the
 * curve can be retuned as data without touching a rule, and the same instance is what the Worker
 * hands to the application layer.
 */
export const ProgressionDefinitionSchema = z
  .object({
    id: z.string().regex(/^progression_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayName: z.string().trim().min(1).max(100),
    maxLevel: z.number().int().min(2).max(10_000),
    xpStep: z.number().int().positive().max(1_000_000)
  })
  .strict();

export type ProgressionDefinitionData = z.infer<typeof ProgressionDefinitionSchema>;

export const playerProgressionRegistry = new Map<string, ProgressionDefinitionData>([
  [
    "progression_player_default",
    ProgressionDefinitionSchema.parse({
      id: "progression_player_default",
      displayName: "Player progression",
      maxLevel: 50,
      xpStep: 120
    })
  ]
]);

/** The curve the Worker runs. One named instance, so there is one place to retune. */
const defaultPlayerProgression = playerProgressionRegistry.get("progression_player_default");
if (defaultPlayerProgression === undefined) {
  throw new Error("The default player progression definition is missing");
}
export const playerProgression: ProgressionDefinitionData = defaultPlayerProgression;
