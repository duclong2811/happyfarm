import type { RoadTierId } from "@happy-farm/game-data";

/**
 * The thumbnail rules that are not Three.js: what a thumbnail is asked for, what its cache key is,
 * how a box is framed in the square, and what each road tier looks like.
 *
 * Split out from `thumbnail.ts` on purpose. The renderer half needs a WebGL context and a bundler
 * (it loads the shipped GLBs), so a unit test cannot reach it; the *decisions* can and should be
 * asserted, and this is where they live. `thumbnail.ts` draws from these numbers, so the picture and
 * the test cannot drift apart.
 */

/** Thumbnail resolution. 256 is enough for a card at 2x and cheap enough to render dozens of. */
export const THUMBNAIL_SIZE = 256;

/**
 * How much of the frame the object's longest side fills.
 *
 * The former 0.72 target was mathematically safe but visually timid: after a three-quarter camera
 * projected a deep model and the card downscaled the square bitmap, the useful silhouette often
 * occupied barely half the picture. 0.84 keeps a deliberate rim around roofs and tree crowns while
 * making the model, rather than its presentation floor, the first thing the player sees.
 */
export const THUMBNAIL_FILL = 0.84;

/** Where a thumbnail came from, so the panel can fall back cleanly. */
export type ThumbnailSource = "MODEL" | "ROAD" | "IMAGE" | "FALLBACK";

export interface ThumbnailRequest {
  /** The GLB to draw, or null for a road preview. */
  readonly modelId: string | null;
  /** The road tier to draw, or null for a model. */
  readonly roadTierId: string | null;
  /** A Vite-hashed transparent illustration for an item with no suitable GLB. */
  readonly imageUrl?: string | null;
}

export interface ThumbnailResult {
  /** A data URL, or null when nothing could be drawn for this request. */
  readonly dataUrl: string | null;
  readonly source: ThumbnailSource;
}

/**
 * The cache key: the model, or the road tier, and nothing else.
 *
 * Pure and stable on purpose - the same asset asks for the same key on every render, so the cache
 * hits, and a test can pin the behaviour without a WebGL context.
 */
export function thumbnailCacheKey(request: ThumbnailRequest): string {
  if (request.imageUrl !== undefined && request.imageUrl !== null) return `image:${request.imageUrl}`;
  if (request.roadTierId !== null) return `road:${request.roadTierId}`;
  if (request.modelId !== null) return `model:${request.modelId}`;
  return "fallback";
}

/**
 * How to frame a box of a given size in a square thumbnail.
 *
 * Pure arithmetic, exported so the framing can be tested: the object is scaled so its longest side
 * takes `THUMBNAIL_FILL` of the frame, centred on its own middle, and the camera sits back along the
 * three-quarter bearing at a distance that is a small multiple of the scaled size.
 */
export function thumbnailFraming(
  size: { readonly x: number; readonly y: number; readonly z: number }
): { readonly scale: number; readonly centerY: number; readonly cameraDistance: number } {
  // The island's own scale is metres; a thumbnail is framed in whatever units the model uses, and
  // every curated model is normalised to about one unit, so no rescaling between families is needed.
  const longest = Math.max(size.x, size.y, size.z, 0.001);
  const halfFov = (32 * Math.PI) / 180 / 2;
  // A perspective camera fills the frame with `2 * d * tan(fov/2)`, so the distance that makes the
  // object fill `THUMBNAIL_FILL` of it is the object's size over that, and never closer than its own
  // bounding sphere.
  const cameraDistance = (longest / THUMBNAIL_FILL) / (2 * Math.tan(halfFov));
  return { scale: 1, centerY: size.y / 2, cameraDistance: Math.max(cameraDistance, longest) };
}

/** An axis-aligned box, in the same plain numbers a bounding box is read as. */
export interface Bounds3 {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * How much of each end of an axis is ignored when measuring what a model *looks* like.
 *
 * Five per cent of the vertices: enough to drop a stray plane, a distant corner, or the transparent
 * margin around a small subject, and small enough that no real model loses its shape. Bounding boxes
 * are honest about vertices and dishonest about *pictures* - `plant_fern` is mostly empty quad, and
 * framing it by its raw box made a fern the size of a thumbnail's shadow.
 */
export const THUMBNAIL_TRIM_FRACTION = 0.05;

/**
 * The box a thumbnail should frame: the raw bounding box with the outer vertices trimmed off.
 *
 * `values` is a flat list of xyz triples - every vertex of the model, in the model's own space. Each
 * axis is sorted on its own, which is what makes this cheap and stable: the result is axis-aligned,
 * deterministic, and cannot tilt with the camera.
 */
export function trimmedBounds(values: readonly number[], trimFraction = THUMBNAIL_TRIM_FRACTION): Bounds3 | null {
  const count = Math.floor(values.length / 3);
  if (count === 0) return null;
  const axes: number[][] = [[], [], []];
  for (let index = 0; index < count; index += 1) {
    axes[0]?.push(values[index * 3] ?? 0);
    axes[1]?.push(values[index * 3 + 1] ?? 0);
    axes[2]?.push(values[index * 3 + 2] ?? 0);
  }
  const trim = Math.min(Math.max(trimFraction, 0), 0.4);
  const cut = Math.floor(count * trim);
  const bounds: number[] = [];
  for (const axis of axes) {
    axis.sort((left, right) => left - right);
    const last = axis.length - 1;
    bounds.push(axis[cut] ?? axis[0] ?? 0);
    bounds.push(axis[last - cut] ?? axis[last] ?? 0);
  }
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds as [number, number, number, number, number, number];
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** The size of a box, as the framing rule wants it. */
export function boundsSize(bounds: Bounds3): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: Math.max(bounds.maxX - bounds.minX, 0),
    y: Math.max(bounds.maxY - bounds.minY, 0),
    z: Math.max(bounds.maxZ - bounds.minZ, 0)
  };
}

/**
 * What each road tier looks like in a thumbnail.
 *
 * Dirt and stone reuse the runtime colours exactly; gravel and paved have no runtime material yet and
 * say so, which is why they are flagged - the shop can then label them as previews instead of
 * pretending the island can already build them.
 */
export const ROAD_PREVIEW_STYLES: Readonly<
  Record<RoadTierId, { readonly surface: number; readonly cobbled: boolean; readonly provisional: boolean }>
> = {
  "road.dirt.t1": { surface: 0x9c7748, cobbled: false, provisional: false },
  "road.gravel.t2": { surface: 0xb0a698, cobbled: false, provisional: true },
  "road.stone.t3": { surface: 0x9a9488, cobbled: true, provisional: false },
  "road.paved.t4": { surface: 0xcac3b4, cobbled: false, provisional: true }
};
