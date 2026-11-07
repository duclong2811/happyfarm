import type {
  CropDefinitionDTO,
  FishDefinitionDTO,
  ResourceNodeDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import { cropModelId } from "../render/assets";
import { fishModelUrl, resourceModelUrl } from "../render/model-urls";
import type { ThumbnailRequest } from "../render/thumbnail";
import { ITEM_THUMBNAIL_MAP } from "./item-thumbnail-map";
import { itemThumbnailUrl } from "./item-thumbnail-urls";

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
 * | harvested crops, fish and ores | their own GLB | the same model is used in the world |
 * | seeds, saplings, fingerlings and forestry materials | item-specific transparent SVG | no suitable GLB exists |
 * | anything this build has never heard of | fallback `ITEM` | the server may define items this build does not |
 *
 * Pure: the mapping is a lookup over the catalogues the page already has, and it is asserted in
 * `tests/web/item-presentation.test.ts`.
 */

export type ItemFallback = "PRODUCE" | "SEED" | "SEED_CARROT" | "SEED_CORN" | "SAPLING" | "ITEM";

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

function imageVisual(assetName: string, fallback: ItemFallback): ItemVisual {
  const imageUrl = itemThumbnailUrl(assetName);
  if (imageUrl === null) return unknownItemVisual();
  return {
    key: `image:${assetName}`,
    request: { modelId: null, roadTierId: null, imageUrl },
    fallback
  };
}

function explicitItemVisual(itemDefinitionId: string): ItemVisual | null {
  const spec = ITEM_THUMBNAIL_MAP[itemDefinitionId];
  if (spec === undefined) return null;
  if (spec.kind === "MODEL") return modelVisual(spec.modelId, "PRODUCE");
  const fallback: ItemFallback = spec.assetName.startsWith("seed_") ? "SEED" : spec.assetName.startsWith("sapling_") ? "SAPLING" : "PRODUCE";
  return imageVisual(spec.assetName, fallback);
}

/** A crop's own art: the model the island draws it with, or the produce fallback when there is none. */
export function cropVisualFor(cropDefinitionId: string): ItemVisual {
  return modelVisual(cropModelId(cropDefinitionId), "PRODUCE");
}

/** A seed: no model exists for one, and a pouch is honest about that. */
export function seedVisual(cropDefinitionId?: string): ItemVisual {
  const fallback = cropDefinitionId === "crop_carrot"
    ? "SEED_CARROT"
    : cropDefinitionId === "crop_corn"
      ? "SEED_CORN"
      : "SEED";
  return modelVisual(null, fallback);
}

/** A sapling: the tree's art is its mature model, so a sapling is drawn as a seedling. */
export function saplingVisual(): ItemVisual {
  return modelVisual(null, "SAPLING");
}

/** A fish: the species' own model when this build ships one, and produce fallback otherwise. */
export function fishVisualFor(modelId: string | null): ItemVisual {
  return modelVisual(fishModelUrl(modelId), "PRODUCE");
}

/** A mined material: the deposit's own art, so a card shows the rock the ore came out of. */
export function resourceVisualFor(modelId: string | null): ItemVisual {
  return modelVisual(resourceModelUrl(modelId), "PRODUCE");
}

/** Anything this build has no definition for: a plain crate, sized like every other card. */
export function unknownItemVisual(): ItemVisual {
  return modelVisual(null, "ITEM");
}

export interface ItemVisualCatalogues {
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  /** The species this deployment can catch, so a fish item draws its own species rather than a crate. */
  readonly fish?: readonly FishDefinitionDTO[];
  /** The island's deposits, so a material item draws the node it was mined from. */
  readonly resourceNodes?: readonly ResourceNodeDTO[];
}

/**
 * The visual for one inventory or market item. Shipped Shop ids are resolved by the explicit stable
 * map first; catalogue lookup remains the compatibility path for a future server item this client has
 * not mapped yet.
 *
 * This is the whole reason the mapping lives in one function: an item id is only meaningful in terms of
 * what produces or consumes it, and both answers are already on the server's catalogues - no second
 * item table, and no guessing from the id's spelling.
 */
export function itemVisualFor(
  itemDefinitionId: string,
  catalogues: ItemVisualCatalogues
): ItemVisual {
  const explicit = explicitItemVisual(itemDefinitionId);
  if (explicit !== null) return explicit;
  const producer = catalogues.cropDefinitions.find(
    (definition) => definition.harvestItemDefinitionId === itemDefinitionId
  );
  if (producer !== undefined) return cropVisualFor(producer.cropDefinitionId);
  const caught = (catalogues.fish ?? []).find(
    (definition) => definition.itemDefinitionId === itemDefinitionId
  );
  if (caught !== undefined) return fishVisualFor(caught.modelId);
  const mined = (catalogues.resourceNodes ?? []).find(
    (node) => node.dropItemDefinitionId === itemDefinitionId
  );
  if (mined !== undefined) return resourceVisualFor(mined.modelId);
  const seedOf = catalogues.cropDefinitions.find(
    (definition) => definition.seedItemDefinitionId === itemDefinitionId
  );
  if (seedOf !== undefined) return seedVisual(seedOf.cropDefinitionId);
  const saplingOf = catalogues.treeDefinitions.find(
    (definition) => definition.saplingItemDefinitionId === itemDefinitionId
  );
  if (saplingOf !== undefined) return saplingVisual();
  return unknownItemVisual();
}
