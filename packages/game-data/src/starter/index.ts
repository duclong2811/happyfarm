import { z } from "zod";
import { itemRegistry } from "../items";

/**
 * The one-time carrot seeds every new player is given.
 *
 * 36 is three full plantings of the starting crop: enough to learn the loop and fund the fourth from
 * the first harvest's proceeds, without handing out so many that the shop stops mattering.
 */
export const STARTER_SEED_QUANTITY = 36;

/**
 * The authoritative starter grant.
 *
 * This is game data, not player state and not a client input: the quantity and the item are fixed
 * here, the application hands them to the grant use case, and no request body can name either. The
 * registry is validated on load so the grant can never point at an item that does not exist or is
 * not a seed.
 */
export const StarterSeedGrantSchema = z
  .object({
    itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    quantity: z.number().int().positive().max(2_147_483_647)
  })
  .strict();

export type StarterSeedGrantData = z.infer<typeof StarterSeedGrantSchema>;

export const starterSeedGrant: StarterSeedGrantData = StarterSeedGrantSchema.parse({
  itemDefinitionId: "item_carrot_seed",
  quantity: STARTER_SEED_QUANTITY
});

if (itemRegistry.get(starterSeedGrant.itemDefinitionId)?.category !== "SEED") {
  throw new Error(`Starter grant must reference a seed item: ${starterSeedGrant.itemDefinitionId}`);
}
