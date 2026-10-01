import { describe, expect, it } from "vitest";
import { placementEntries, ROAD_TIERS } from "@happy-farm/game-data";
import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import {
  descriptionKeyFor,
  entryAvailability,
  isPreviewOnly,
  normaliseQuarterTurns,
  normaliseQuery,
  quarterTurnYaw,
  resolveCategory,
  rotatedFootprint,
  shopCategories,
  thumbnailRequestFor,
  visibleEntries
} from "../../apps/web/src/build-shop/shop-state";
import { createTranslator, displayName, type Language } from "../../apps/web/src/i18n";

/**
 * The construction shop's own rules, held to what the brief asks of them: categories that exist,
 * a search that filters what the player read rather than what the server keyed, names a player would
 * recognise, and a rotation that changes the ground an item takes.
 */

function entry(overrides: Partial<BuildCatalogEntryDTO>): BuildCatalogEntryDTO {
  return {
    entryId: "place_test",
    category: "DECORATION",
    displayNameKey: "place.barrel.name",
    label: "Barrel",
    descriptionKey: null,
    modelId: "prop_barrel",
    requiredLevel: 1,
    price: 60,
    currencyDefinitionId: "currency_gold",
    footprint: { widthCells: 1, depthCells: 1 },
    capability: "DECORATION",
    tier: null,
    tierRank: null,
    upgradeTo: null,
    rotatable: true,
    decorative: true,
    tags: [],
    unlockCondition: "OWNED_LAND",
    ...overrides
  };
}

const nameOf = (item: BuildCatalogEntryDTO): string => item.label;

describe("the category rail", () => {
  it("hides a category the catalogue does not fill", () => {
    const catalog = [entry({ entryId: "a" }), entry({ entryId: "b", category: "FENCE" })];
    expect(shopCategories(catalog)).toEqual(["DECORATION", "FENCE"]);
    // MONUMENT ships nothing, so it must not appear as an empty shelf.
    expect(shopCategories(catalog)).not.toContain("MONUMENT");
  });

  it("keeps the reading order rather than the catalogue's order", () => {
    const catalog = [
      entry({ entryId: "b", category: "BUILDING" }),
      entry({ entryId: "r", category: "ROAD" }),
      entry({ entryId: "v", category: "VEGETATION" })
    ];
    expect(shopCategories(catalog)).toEqual(["ROAD", "BUILDING", "VEGETATION"]);
  });

  it("falls back to a category that has entries when the preferred one is empty", () => {
    const catalog = [entry({ entryId: "r", category: "ROAD" })];
    expect(resolveCategory(catalog, "DECORATION")).toBe("ROAD");
    expect(resolveCategory(catalog, "ROAD")).toBe("ROAD");
    expect(resolveCategory([], "ROAD")).toBeNull();
  });
});

describe("what the player may do with an entry", () => {
  it("is locked below the required level, whatever else is true", () => {
    expect(entryAvailability(entry({ requiredLevel: 8 }), 7)).toBe("LOCKED");
    expect(entryAvailability(entry({ requiredLevel: 8 }), 8)).toBe("AVAILABLE");
  });

  it("marks a road tier the island cannot draw as preview only", () => {
    const gravel = entry({ entryId: "road", category: "ROAD", tier: "road.gravel.t2", modelId: "road.gravel.t2" });
    const dirt = entry({ entryId: "road2", category: "ROAD", tier: "road.dirt.t1", modelId: "road.dirt.t1" });
    expect(isPreviewOnly(gravel)).toBe(true);
    expect(entryAvailability(gravel, 10)).toBe("PREVIEW_ONLY");
    expect(isPreviewOnly(dirt)).toBe(false);
    expect(entryAvailability(dirt, 10)).toBe("AVAILABLE");
  });

  it("does not mistake a plain object for a preview tier", () => {
    expect(isPreviewOnly(entry({ category: "DECORATION", tier: null }))).toBe(false);
  });
});

describe("the search box", () => {
  const catalog = [
    entry({ entryId: "pine", label: "Pine Tree", category: "VEGETATION" }),
    entry({ entryId: "barn", label: "Barn", category: "BUILDING", requiredLevel: 1 }),
    entry({ entryId: "grand", label: "Grand Barn", category: "BUILDING", requiredLevel: 8 }),
    entry({ entryId: "barrel", label: "Barrel", category: "DECORATION" })
  ];

  it("matches the localised name, case-insensitively and after trimming", () => {
    const options = { category: "BUILDING" as const, query: "  bArN ", filter: "ALL" as const, playerLevel: 1, nameOf };
    expect(visibleEntries(catalog, options).map((item) => item.entryId)).toEqual(["barn", "grand"]);
  });

  it("never leaves the current category", () => {
    const found = visibleEntries(catalog, {
      category: "VEGETATION",
      query: "barn",
      filter: "ALL",
      playerLevel: 8,
      nameOf
    });
    expect(found).toEqual([]);
  });

  it("filters by availability without touching the catalogue", () => {
    const before = JSON.stringify(catalog);
    const locked = visibleEntries(catalog, {
      category: "BUILDING",
      query: "",
      filter: "LOCKED",
      playerLevel: 1,
      nameOf
    });
    expect(locked.map((item) => item.entryId)).toEqual(["grand"]);
    const available = visibleEntries(catalog, {
      category: "BUILDING",
      query: "",
      filter: "AVAILABLE",
      playerLevel: 8,
      nameOf
    });
    expect(available.map((item) => item.entryId)).toEqual(["barn", "grand"]);
    // A search is a view over the catalogue, not an edit of it.
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("normalises the way the comparison does", () => {
    expect(normaliseQuery("  Barn  ")).toBe("barn");
    expect(normaliseQuery("")).toBe("");
  });
});

describe("descriptions", () => {
  it("prefers the catalogue's own key", () => {
    expect(descriptionKeyFor(entry({ descriptionKey: "place.road.description" }))).toBe("place.road.description");
  });

  it("falls back to the presentation mapping, then to nothing", () => {
    // A silo's catalogue row carries no description key, so the shop's own mapping answers.
    expect(descriptionKeyFor(entry({ entryId: "place_silo" }))).toBe("place.silo.description");
    expect(descriptionKeyFor(entry({ entryId: "place_unknown_thing" }))).toBeNull();
  });
});

describe("rotation", () => {
  it("keeps the footprint for half turns and swaps the axes for quarter turns", () => {
    const barn = { widthCells: 2, depthCells: 3 };
    expect(rotatedFootprint(barn, 0)).toEqual(barn);
    expect(rotatedFootprint(barn, 1)).toEqual({ widthCells: 3, depthCells: 2 });
    expect(rotatedFootprint(barn, 2)).toEqual(barn);
    expect(rotatedFootprint(barn, 3)).toEqual({ widthCells: 3, depthCells: 2 });
  });

  it("wraps turns instead of growing without limit", () => {
    expect(normaliseQuarterTurns(-1)).toBe(3);
    expect(normaliseQuarterTurns(4)).toBe(0);
    expect(normaliseQuarterTurns(7)).toBe(3);
    expect(quarterTurnYaw(1)).toBeCloseTo(Math.PI / 2, 10);
    expect(quarterTurnYaw(4)).toBe(0);
  });
});

describe("names and descriptions the player actually reads", () => {
  const languages: readonly Language[] = ["en", "vi"];

  it("has a human name for every shipped catalogue entry, in both languages", () => {
    for (const language of languages) {
      for (const shipped of placementEntries) {
        // The fallback is the key itself, so a name that came back unchanged means the client is
        // showing the player an internal string.
        const name = displayName(language, shipped.displayNameKey, shipped.displayNameKey);
        expect(name, `${language}:${shipped.id}`).not.toBe("");
        expect(name, `${language}:${shipped.id}`).not.toBe(shipped.displayNameKey);
      }
    }
  });

  it("names the roads the shop sells", () => {
    const t = createTranslator("en");
    expect(t("road.dirt.name")).toBe("Dirt Road");
    expect(t("road.stone.name")).toBe("Stone Road");
    expect(ROAD_TIERS).toHaveLength(4);
  });

  it("replaces the developer-ish catalogue labels with natural names", () => {
    const expected: Readonly<Record<string, string>> = {
      place_tree_broad: "Broadleaf Tree",
      place_tree_pine: "Pine Tree",
      place_plant_fern: "Fern",
      place_plant_grass: "Tall Grass",
      place_rock_small: "Small Landscape Rock",
      place_silo: "Grain Silo",
      place_coop: "Chicken Coop"
    };
    for (const [id, name] of Object.entries(expected)) {
      const shipped = placementEntries.find((candidate) => candidate.id === id);
      expect(shipped, id).toBeDefined();
      expect(displayName("en", shipped?.displayNameKey ?? "", ""), id).toBe(name);
    }
  });

  it("has a description for every shipped entry, and never one that restates a rule", () => {
    for (const language of languages) {
      for (const shipped of placementEntries) {
        const key = descriptionKeyFor({
          ...entry({}),
          entryId: shipped.id,
          descriptionKey: shipped.descriptionKey
        });
        expect(key, `${language}:${shipped.id}`).not.toBeNull();
        const text = displayName(language, key ?? "", key ?? "");
        expect(text.length, `${language}:${shipped.id}`).toBeGreaterThan(10);
        expect(text, `${language}:${shipped.id}`).not.toBe(key);
        expect(text, `${language}:${shipped.id}`).not.toContain(String(shipped.price));
      }
    }
  });
});

describe("what the thumbnail renderer is asked for", () => {
  it("asks for the tier of a road and the model of everything else", () => {
    expect(thumbnailRequestFor(entry({ category: "ROAD", tier: "road.dirt.t1", modelId: "road.dirt.t1" }))).toEqual({
      modelId: null,
      roadTierId: "road.dirt.t1"
    });
    expect(thumbnailRequestFor(entry({ modelId: "prop_barrel" }))).toEqual({
      modelId: "prop_barrel",
      roadTierId: null
    });
  });

  it("asks the same question for the card and the inspector", () => {
    const item = entry({ modelId: "farm.barn.t1" });
    expect(thumbnailRequestFor(item)).toEqual(thumbnailRequestFor(item));
  });
});
