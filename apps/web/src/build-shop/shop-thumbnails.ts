import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import { createThumbnailRenderer, thumbnailCacheKey, type ThumbnailResult } from "../render/thumbnail";
import { thumbnailRequestFor } from "./shop-state";

/**
 * The shop's view of the thumbnail pipeline.
 *
 * One renderer for the whole page, created on the first ask and never again, plus the URLs it has
 * produced so far. The card grid and the inspector both come through here, which is what makes the
 * inspector's big picture free: the first ask draws the picture and every later ask - another card,
 * the same card after a search, the inspector - is the same cached string.
 *
 * Failures are not remembered: a model that is still downloading when the shop opens must be able to
 * appear on the second look.
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
  onProblem?: (modelId: string, error: unknown) => void
): ShopThumbnails {
  const urls = new Map<string, string>();
  let renderer: ReturnType<typeof createThumbnailRenderer> | null = null;

  function rendererOnce(): ReturnType<typeof createThumbnailRenderer> {
    // The one renderer, and never a second: a card must not be able to create its own.
    renderer ??= createThumbnailRenderer(onProblem === undefined ? {} : { onProblem });
    return renderer;
  }

  return {
    cached(entry: BuildCatalogEntryDTO): string | null {
      const key = thumbnailCacheKey(thumbnailRequestFor(entry));
      return urls.get(key) ?? null;
    },
    async request(entry: BuildCatalogEntryDTO): Promise<ThumbnailResult> {
      const request = thumbnailRequestFor(entry);
      const key = thumbnailCacheKey(request);
      const known = urls.get(key);
      if (known !== undefined) return { dataUrl: known, source: request.roadTierId === null ? "MODEL" : "ROAD" };
      const result = await rendererOnce().render(request);
      if (result.dataUrl !== null) urls.set(key, result.dataUrl);
      return result;
    },
    stats(): { readonly drawn: number; readonly cached: number } {
      return renderer?.stats() ?? { drawn: 0, cached: 0 };
    },
    dispose(): void {
      urls.clear();
      renderer?.dispose();
      renderer = null;
    }
  };
}
