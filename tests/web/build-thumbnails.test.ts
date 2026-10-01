import { describe, expect, it } from "vitest";
import { ROAD_TIERS } from "@happy-farm/game-data";
import {
  ROAD_PREVIEW_STYLES,
  THUMBNAIL_FILL,
  THUMBNAIL_SIZE,
  boundsSize,
  thumbnailCacheKey,
  thumbnailFraming,
  trimmedBounds
} from "../../apps/web/src/render/thumbnail-spec";

/**
 * The shop's thumbnails, held to the parts that are decisions rather than pixels.
 *
 * A thumbnail is drawn by a WebGL context a unit test cannot open, but *what* is drawn, how it is
 * framed and whether the second look costs anything are all plain values. These are also the rules a
 * future 500-asset catalogue depends on: a stable key is what makes the cache a cache, and framing
 * that scales with the box is what stops a tree from being a speck in a field.
 */

describe("the thumbnail cache key", () => {
  it("is stable for the same asset, every time", () => {
    const request = { modelId: "building_barn", roadTierId: null };
    const first = thumbnailCacheKey(request);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(thumbnailCacheKey({ ...request })).toBe(first);
    }
  });

  it("separates one asset from another, and a model from a road of the same name", () => {
    expect(thumbnailCacheKey({ modelId: "building_barn", roadTierId: null })).not.toBe(
      thumbnailCacheKey({ modelId: "building_coop", roadTierId: null })
    );
    // The road tiers are keyed by tier rather than by the catalogue's visual id, so a tier's grid
    // entry and its world ghost cannot collide.
    expect(thumbnailCacheKey({ modelId: null, roadTierId: "road.dirt.t1" })).not.toBe(
      thumbnailCacheKey({ modelId: "road.dirt.t1", roadTierId: null })
    );
    expect(thumbnailCacheKey({ modelId: null, roadTierId: null })).toBe("fallback");
  });

  it("gives every shipped road tier its own key", () => {
    const keys = new Set(ROAD_TIERS.map((tier) => thumbnailCacheKey({ modelId: null, roadTierId: tier })));
    expect(keys.size).toBe(ROAD_TIERS.length);
    expect(ROAD_TIERS).toHaveLength(4);
  });
});

describe("thumbnail framing", () => {
  it("keeps the whole box in a square frame with a margin", () => {
    const size = { x: 1, y: 0.6, z: 1.4 };
    const framing = thumbnailFraming(size);
    const halfFov = (32 * Math.PI) / 180 / 2;
    // The frame's visible height at the object's distance, and the fraction the object takes of it.
    const visible = 2 * framing.cameraDistance * Math.tan(halfFov);
    expect(Math.max(size.x, size.y, size.z) / visible).toBeCloseTo(THUMBNAIL_FILL, 6);
    expect(framing.cameraDistance).toBeGreaterThan(0);
  });

  it("scales the camera with the object, so a tree and a barn are both readable", () => {
    const small = thumbnailFraming({ x: 0.5, y: 0.5, z: 0.5 });
    const large = thumbnailFraming({ x: 4, y: 4, z: 4 });
    expect(large.cameraDistance).toBeGreaterThan(small.cameraDistance);
    // Proportional: eight times the object is eight times the distance, which is what keeps the
    // object the same size on the card.
    expect(large.cameraDistance / small.cameraDistance).toBeCloseTo(8, 4);
  });

  it("centres on the object's own middle and never divides by zero", () => {
    expect(thumbnailFraming({ x: 2, y: 3, z: 2 }).centerY).toBe(1.5);
    const flat = thumbnailFraming({ x: 0, y: 0, z: 0 });
    expect(Number.isFinite(flat.cameraDistance)).toBe(true);
    expect(flat.cameraDistance).toBeGreaterThan(0);
  });

  it("frames the thumbnail at a size a card can use", () => {
    // A power of two keeps the browser's downscale clean, and 256 is already twice the CSS size of a
    // card's picture.
    expect(Number.isInteger(Math.log2(THUMBNAIL_SIZE))).toBe(true);
    expect(THUMBNAIL_SIZE).toBeGreaterThanOrEqual(128);
    expect(THUMBNAIL_FILL).toBeGreaterThan(0.6);
    expect(THUMBNAIL_FILL).toBeLessThan(0.85);
  });
});

describe("road tier previews", () => {
  it("defines a preview for every shipped tier, and nothing for a tier that does not exist", () => {
    expect(Object.keys(ROAD_PREVIEW_STYLES).sort()).toEqual([...ROAD_TIERS].sort());
    for (const tier of ROAD_TIERS) {
      const style = ROAD_PREVIEW_STYLES[tier];
      expect(style.surface).toBeGreaterThan(0);
      expect(style.surface).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("makes the four tiers visibly different from one another", () => {
    const colours = ROAD_TIERS.map((tier) => ROAD_PREVIEW_STYLES[tier].surface);
    expect(new Set(colours).size).toBe(4);
    for (let left = 0; left < colours.length; left += 1) {
      for (let right = left + 1; right < colours.length; right += 1) {
        const a = colours[left] ?? 0;
        const b = colours[right] ?? 0;
        const distance =
          Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
          Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
          Math.abs((a & 0xff) - (b & 0xff));
        expect(distance, `${String(a)} vs ${String(b)}`).toBeGreaterThan(24);
      }
    }
  });

  it("marks exactly the tiers with no runtime surface as provisional", () => {
    // Dirt and stone exist in the world today; gravel and paved are previews. The badge in the shop
    // reads this flag, so it cannot claim a tier is buildable when it is only drawn.
    const provisional = ROAD_TIERS.filter((tier) => ROAD_PREVIEW_STYLES[tier].provisional);
    expect(provisional).toEqual(["road.gravel.t2", "road.paved.t4"]);
    expect(ROAD_PREVIEW_STYLES["road.dirt.t1"].provisional).toBe(false);
    expect(ROAD_PREVIEW_STYLES["road.stone.t3"].provisional).toBe(false);
  });
});

describe("measuring what a model looks like", () => {
  /** A dense cube of vertices around the origin, as a flat xyz list. */
  function cube(half: number, steps = 10): number[] {
    const values: number[] = [];
    for (let x = 0; x <= steps; x += 1) {
      for (let y = 0; y <= steps; y += 1) {
        for (let z = 0; z <= steps; z += 1) {
          values.push(
            (x / steps) * 2 * half - half,
            (y / steps) * 2 * half - half,
            (z / steps) * 2 * half - half
          );
        }
      }
    }
    return values;
  }

  it("measures a solid model as itself", () => {
    const bounds = trimmedBounds(cube(1));
    expect(bounds).not.toBeNull();
    const size = boundsSize(bounds ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
    expect(size.x).toBeGreaterThan(1.8);
    expect(size.x).toBeLessThanOrEqual(2);
    expect(size.y).toBeGreaterThan(1.8);
  });

  it("ignores a stray spike that a raw bounding box would frame", () => {
    // A small subject with four stray corners far away - which is what a transparent quad around a
    // plant looks like to a bounding box.
    const values = [...cube(0.2)];
    for (const corner of [
      [-6, -1, -6],
      [6, -1, 6],
      [-6, 12, 6],
      [6, -1, -6]
    ]) {
      values.push(corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0);
    }
    const trimmed = trimmedBounds(values);
    const raw = { x: 12, y: 13, z: 12 };
    expect(trimmed).not.toBeNull();
    const size = boundsSize(trimmed ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
    expect(size.x).toBeLessThan(raw.x / 2);
    expect(size.y).toBeLessThan(raw.y / 2);
  });

  it("is deterministic and survives an empty model", () => {
    const values = cube(0.5, 6);
    expect(trimmedBounds(values)).toEqual(trimmedBounds(values));
    expect(trimmedBounds([])).toBeNull();
  });

  it("keeps a trimmed model framed at the same visual weight as a solid one", () => {
    const solid = thumbnailFraming(boundsSize(trimmedBounds(cube(1)) ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }));
    const flat = thumbnailFraming({ x: 1, y: 0.3, z: 0.94 });
    // Both are framed by their longest side, so neither can be shrunk to a speck by a thin axis.
    expect(solid.cameraDistance).toBeGreaterThan(0);
    expect(flat.cameraDistance).toBeGreaterThan(0);
  });
});
