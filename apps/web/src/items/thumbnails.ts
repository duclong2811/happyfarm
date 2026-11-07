import {
  createThumbnailRenderer,
  thumbnailCacheKey,
  type ThumbnailRequest,
  type ThumbnailResult
} from "../render/thumbnail";

/**
 * The one picture pipeline for the whole page.
 *
 * The shop proved the shape in V12.4: one offscreen renderer, drawn on demand, cached as data URLs,
 * never a Three.js scene per card. V14.2 adds two more readers - the inventory grid and the planting
 * picker - and a fourth in passing (the reward pop that rises from a harvested crop). All four ask
 * *this* cache, keyed by the model (or the road tier) and nothing else, so a carrot is drawn once per
 * session however many places show one, and there is exactly one WebGL context behind all of them.
 *
 * Failures are not remembered: a model still downloading when a panel opens must be able to appear on
 * the second look.
 */

export interface ItemThumbnails {
  /** The picture if it is already drawn, else null - and the render starts when it is not. */
  cached(request: ThumbnailRequest): string | null;
  /** The picture, waiting for it if this is the first ask. */
  request(request: ThumbnailRequest): Promise<ThumbnailResult>;
  /**
   * Fills an `<img>` when it can.
   *
   * A cached picture lands synchronously; otherwise the draw starts and the `src` is assigned when it
   * arrives. `onResult` is always called, so a card can swap in its own fallback art when the picture
   * turned out not to exist - and never before the answer is known, which is what stops a placeholder
   * from flashing over a picture that was about to load.
   */
  apply(
    request: ThumbnailRequest,
    image: HTMLImageElement,
    onResult?: (result: ThumbnailResult) => void
  ): void;
  /** How many pictures were drawn, and how many asks were answered from the cache. */
  stats(): { readonly drawn: number; readonly cached: number };
  dispose(): void;
}

export function createItemThumbnails(
  onProblem?: (modelId: string, error: unknown) => void
): ItemThumbnails {
  const urls = new Map<string, string>();
  let renderer: ReturnType<typeof createThumbnailRenderer> | null = null;

  function rendererOnce(): ReturnType<typeof createThumbnailRenderer> {
    // The one renderer, and never a second: a card must not be able to create its own.
    renderer ??= createThumbnailRenderer(onProblem === undefined ? {} : { onProblem });
    return renderer;
  }

  function sourceOf(request: ThumbnailRequest): ThumbnailResult["source"] {
    if (request.imageUrl !== undefined && request.imageUrl !== null) return "IMAGE";
    return request.roadTierId === null ? "MODEL" : "ROAD";
  }

  function take(request: ThumbnailRequest): Promise<ThumbnailResult> {
    const key = thumbnailCacheKey(request);
    const known = urls.get(key);
    if (known !== undefined) return Promise.resolve({ dataUrl: known, source: sourceOf(request) });
    return rendererOnce()
      .render(request)
      .then((result) => {
        if (result.dataUrl !== null) urls.set(key, result.dataUrl);
        return result;
      });
  }

  return {
    cached(request: ThumbnailRequest): string | null {
      return urls.get(thumbnailCacheKey(request)) ?? null;
    },
    request: take,
    apply(request, image, onResult): void {
      const known = urls.get(thumbnailCacheKey(request));
      if (known !== undefined) {
        image.src = known;
        onResult?.({ dataUrl: known, source: sourceOf(request) });
        return;
      }
      void take(request)
        .then((result) => {
          if (result.dataUrl !== null) image.src = result.dataUrl;
          onResult?.(result);
        })
        .catch(() => {
          // A picture is decoration: one that cannot be drawn leaves the card's own fallback in place.
          onResult?.({ dataUrl: null, source: sourceOf(request) });
        });
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
