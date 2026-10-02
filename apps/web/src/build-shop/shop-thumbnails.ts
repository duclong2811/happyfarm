import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import type { ThumbnailResult } from "../render/thumbnail";
import { createItemThumbnails, type ItemThumbnails } from "../items/thumbnails";
import { thumbnailRequestFor } from "./shop-state";

/**
 * The shop's view of the page's shared picture cache.
 *
 * The cache itself lives in `items/thumbnails.ts`, because the inventory grid and the planting picker
 * need the same pictures: a carrot costs one draw per session, not one per panel. This file is only the
 * shop's *wording* of a request - a catalogue entry rather than a model - so the card grid and the
 * inspector keep asking in the vocabulary they already had.
 *
 * A caller may hand in a cache to share; one that does not (a test, a one-off) gets its own and owns
 * its disposal.
 */

export interface ShopThumbnails {
  /** The picture if it is already drawn, else null - and the render starts when it is not. */
  cached(entry: BuildCatalogEntryDTO): string | null;
  /** The picture, waiting for it if this is the first ask. */
  request(entry: BuildCatalogEntryDTO): Promise<ThumbnailResult>;
  /** How many pictures were drawn, and how many asks were answered from the cache. */
  stats(): { readonly drawn: number; readonly cached: number };
  dispose(): void;
}

export function createShopThumbnails(
  onProblem?: (modelId: string, error: unknown) => void,
  shared?: ItemThumbnails
): ShopThumbnails {
  const thumbnails = shared ?? createItemThumbnails(onProblem);
  return {
    cached(entry: BuildCatalogEntryDTO): string | null {
      return thumbnails.cached(thumbnailRequestFor(entry));
    },
    request(entry: BuildCatalogEntryDTO): Promise<ThumbnailResult> {
      return thumbnails.request(thumbnailRequestFor(entry));
    },
    stats(): { readonly drawn: number; readonly cached: number } {
      return thumbnails.stats();
    },
    dispose(): void {
      // Only dispose what this call created: a shared cache belongs to whoever built it.
      if (shared === undefined) thumbnails.dispose();
    }
  };
}
