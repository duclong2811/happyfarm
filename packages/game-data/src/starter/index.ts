import { z } from "zod";
import { currencyRegistry } from "../economy";
import { itemRegistry } from "../items";

/**
 * The one-time carrot seeds every new player is given.
 *
 * 10 is two full plantings of a six-tile-wide starter row plus a spare: enough to learn the loop and
 * fund the next seed from the first harvest's proceeds, without handing out so many that the shop
 * stops mattering. The starting crop is the only crop a level 1 player can plant, and it is the only
 * crop this package names.
 */
export const STARTER_SEED_QUANTITY = 10;

/**
 * The gold every new player starts with.
 *
 * A player who starts with nothing cannot plant (a seed costs gold) and cannot buy a seed, so the
 * loop never begins. 100 covers a seed purchase, a first land expansion, or a few mistakes, and is
 * the same number for everyone: it is game data, never a client input.
 */
export const STARTER_GOLD_AMOUNT = 100;

/**
 * The receipt key this package is granted under.
 *
 * A player holds at most one receipt per key, so the key is what makes the grant one-time and what
 * lets a future package (`starter_package_v2`) be granted to a player who already received this one.
 * It is game data and never a client input.
 */
export const STARTER_GRANT_KEY = "starter_package_v1";

/**
 * The authoritative starter package.
 *
 * This is game data, not player state and not a client input: the seeds, the currency, and the gold
 * amount are fixed here, the application hands them to the grant use case, and no request body can
 * name any of them. The registries are validated on load so the package can never point at an item
 * that does not exist, an item that is not a seed, or a currency that was never defined.
 */
export const StarterPackageSchema = z
  .object({
    grantKey: z.string().regex(/^starter_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    seedItemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    seedQuantity: z.number().int().positive().max(2_147_483_647),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    goldAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict();

export type StarterPackageData = z.infer<typeof StarterPackageSchema>;

export const starterPackage: StarterPackageData = StarterPackageSchema.parse({
  grantKey: STARTER_GRANT_KEY,
  seedItemDefinitionId: "item_carrot_seed",
  seedQuantity: STARTER_SEED_QUANTITY,
  currencyDefinitionId: "currency_gold",
  goldAmount: STARTER_GOLD_AMOUNT
});

if (itemRegistry.get(starterPackage.seedItemDefinitionId)?.category !== "SEED") {
  throw new Error(`Starter package must reference a seed item: ${starterPackage.seedItemDefinitionId}`);
}

if (!currencyRegistry.has(starterPackage.currencyDefinitionId)) {
  throw new Error(`Starter package must reference a currency: ${starterPackage.currencyDefinitionId}`);
}
