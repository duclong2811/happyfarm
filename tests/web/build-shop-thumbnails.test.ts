import { describe, expect, it } from "vitest";
import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import { createShopThumbnails } from "../../apps/web/src/build-shop/shop-thumbnails";

/**
 * The shop's thumbnail source, held to the promise that keeps the shop cheap: one renderer for the
 * whole page, created only when something actually asks for a picture.
 *
 * A WebGL context cannot be opened in this test, which is the point - the laziness is exactly what is
 * being checked. If `createShopThumbnails` built a renderer eagerly, this file would fail rather than
 * quietly opening a canvas in a machine with no display.
 */

function entry(overrides: Partial<BuildCatalogEntryDTO> = {}): BuildCatalogEntryDTO {
  return {
    entryId: "place_barrel",
    category: "DECORATION",
    displayNameKey: "place.barrel.name",
    label: "Barrel",
    descriptionKey: null,
    modelId: "prop_barrel",
    requiredLevel: 1,
    price: 60,
    currencyDefinitionId: "currency_gold",
    footprint: { widthCells: 1, depthCells: 1 },
    allowedTerrain: ["LAND"],
    tier: null,
    tierRank: null,
    upgradeTo: null,
    rotatable: true,
    movable: true,
    removable: true,
    removalRefundRate: 0,
    decorative: true,
    tags: [],
    unlockCondition: "OWNED_LAND",
    gameplay: {
      classification: "COSMETIC" as const,
      status: "ACTIVE" as const,
      summaryKey: "place.barrel.effect",
      production: null,
      storage: null,
      movement: null,
      workerTask: null
    },
    ...overrides
  };
}

describe("the shop's thumbnail source", () => {
  it("creates no renderer until something asks for a picture", () => {
    const thumbnails = createShopThumbnails();
    expect(thumbnails.cached(entry())).toBeNull();
    expect(thumbnails.stats()).toEqual({ drawn: 0, cached: 0 });
    thumbnails.dispose();
  });

  it("answers the card and the inspector with the same source", () => {
    const thumbnails = createShopThumbnails();
    const item = entry({ modelId: "farm.barn.t1" });
    // Both areas ask through this one object, and neither ask has drawn anything yet.
    expect(thumbnails.cached(item)).toBeNull();
    expect(thumbnails.cached(item)).toBeNull();
    expect(thumbnails.stats().drawn).toBe(0);
    thumbnails.dispose();
  });

  it("survives being disposed before it was ever used", () => {
    const thumbnails = createShopThumbnails();
    expect(() => { thumbnails.dispose(); }).not.toThrow();
  });
});
