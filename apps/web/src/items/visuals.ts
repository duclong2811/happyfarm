import type { CropDefinitionDTO, TreeDefinitionDTO } from "@happy-farm/contracts";
import { cropModelId } from "../render/assets";
import type { ThumbnailRequest } from "../render/thumbnail";

/**
 * What an item *looks like*, and what to show when it has no picture.
 *
 * The shop's thumbnails are drawn from shipped `.glb` models, and the farming inventory is mostly
 * things that are not a model: a seed, a sapling, a pile of harvested produce. Rather than invent a
 * second art pipeline, this module answers one question per item - *which* picture to ask the shared
 * cache for, and which drawn fallback to use when the answer is "none" - so every card is either a real
 * render of the real asset or a deliberate, sized, game-style placeholder that cannot break a layout.
 *
 * Which items fall back today, with the reason:
 *
 * | Item | Picture | Why |
 * | --- | --- | --- |
 * | `item_carrot`, `item_wheat`, `item_corn` (produce) | the crop's own model | the crop *is* the model |
 * | `item_carrot_seed` and every other seed | fallback `SEED` | seeds have no model in the shipped set |
 * | `item_apple_sapling` | fallback `SAPLING` | a tree's model is the mature tree, not its sapling |
 * | anything this build has never heard of | fallback `ITEM` | the server may define items this build does not |
 *
 * Pure: the mapping is a lookup over the catalogues the page already has, and it is asserted in
 * `tests/web/item-presentation.test.ts`.
 */

export type ItemFallback = "PRODUCE" | "SEED" | "SAPLING" | "ITEM";

export interface ItemVisual {
  /** The identity a picture, a cache entry and a DOM node are keyed by. */
  readonly key: string;
  readonly request: ThumbnailRequest;
  /** What to draw when the cache has no picture for `request`. */
  readonly fallback: ItemFallback;
}

function modelVisual(modelId: string | null, fallback: ItemFallback): ItemVisual {
  return modelId === null
    ? { key: `fallback:${fallback}`, request: { modelId: null, roadTierId: null }, fallback }
    : { key: `model:${modelId}`, request: { modelId, roadTierId: null }, fallback };
}

/** A crop's own art: the model the island draws it with, or the produce fallback when there is none. */
export function cropVisualFor(cropDefinitionId: string): ItemVisual {
  return modelVisual(cropModelId(cropDefinitionId), "PRODUCE");
}

/** A seed: no model exists for one, and a pouch is honest about that. */
export function seedVisual(): ItemVisual {
  return modelVisual(null, "SEED");
}

/** A sapling: the tree's art is its mature model, so a sapling is drawn as a seedling. */
export function saplingVisual(): ItemVisual {
  return modelVisual(null, "SAPLING");
}

/** Anything this build has no definition for: a plain crate, sized like every other card. */
export function unknownItemVisual(): ItemVisual {
  return modelVisual(null, "ITEM");
}

export interface ItemVisualCatalogues {
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
}

/**
 * The visual for one inventory item, found through the definitions that name it.
 *
 * This is the whole reason the mapping lives in one function: an item id is only meaningful in terms of
 * what produces or consumes it, and both answers are already on the server's catalogues - no second
 * item table, and no guessing from the id's spelling.
 */
export function itemVisualFor(
  itemDefinitionId: string,
  catalogues: ItemVisualCatalogues
): ItemVisual {
  const producer = catalogues.cropDefinitions.find(
    (definition) => definition.harvestItemDefinitionId === itemDefinitionId
  );
  if (producer !== undefined) return cropVisualFor(producer.cropDefinitionId);
  const seedOf = catalogues.cropDefinitions.find(
    (definition) => definition.seedItemDefinitionId === itemDefinitionId
  );
  if (seedOf !== undefined) return seedVisual();
  const saplingOf = catalogues.treeDefinitions.find(
    (definition) => definition.saplingItemDefinitionId === itemDefinitionId
  );
  if (saplingOf !== undefined) return saplingVisual();
  return unknownItemVisual();
}
