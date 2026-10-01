import { describe, expect, it } from "vitest";
import {
  PLACEMENT_CATEGORIES,
  PLACEMENT_CAPABILITIES,
  ROAD_TIERS,
  createPlacementCatalog,
  createRoadTierRegistry,
  placementCatalog,
  placementEntries,
  roadCost,
  roadTiers,
  STARTER_ROAD_TIER
} from "@happy-farm/game-data";

/**
 * The build catalogue and the road ladder.
 *
 * These are the two pieces of the new direction that are *data*: the player builds the roads, so the
 * roads have prices; the player builds everything else, so there is a place for it to be declared.
 * The tests hold the parts that must not drift - the one ratio the prototype balances on, the three
 * drawn surfaces the renderer actually has, and the rule that a tier nobody can buy is a tier that
 * does not exist.
 */

describe("road tiers", () => {
  it("is a four-rung ladder, cheapest first, drawn by the renderer's own three surfaces", () => {
    expect([...roadTiers.keys()]).toEqual([...ROAD_TIERS]);
    const tiers = [...roadTiers.values()];
    expect(tiers.map((tier) => tier.rank)).toEqual([1, 2, 3, 4]);
    for (const tier of tiers) {
      expect(["PATH", "SECONDARY", "PRIMARY"]).toContain(tier.renderKind);
      expect(tier.upgradeGroup).toBe("road");
      expect(tier.moveMultiplier).toBeGreaterThanOrEqual(1);
    }
    // A better road is never slower, and never cheaper.
    for (let index = 1; index < tiers.length; index += 1) {
      const previous = tiers[index - 1];
      const current = tiers[index];
      if (previous === undefined || current === undefined) throw new Error("missing tier");
      expect(current.pricePerTile).toBeGreaterThan(previous.pricePerTile);
      expect(current.moveMultiplier).toBeGreaterThanOrEqual(previous.moveMultiplier);
    }
  });

  it("keeps the one prototype ratio the brief names: a dirt road is a fifth of a stone road", () => {
    const dirt = roadTiers.get("T2");
    const stone = roadTiers.get("T3");
    expect(dirt).toBeDefined();
    expect(stone).toBeDefined();
    expect(dirt?.pricePerTile).toBe(12);
    expect(stone?.pricePerTile).toBe(60);
    expect((dirt?.pricePerTile ?? 0) * 5).toBe(stone?.pricePerTile);
  });

  it("rejects a ladder that is out of order or repeats a tier", () => {
    const tier = (id: string, rank: number) => ({
      id,
      displayNameKey: "road.dirt_path.name",
      label: "Dirt path",
      rank,
      surface: "DIRT_PATH",
      renderKind: "PATH",
      pricePerTile: 1,
      upgradeGroup: "road",
      moveMultiplier: 1
    });
    expect(() => createRoadTierRegistry([tier("T1", 1), tier("T2", 1)])).toThrow();
    expect(() => createRoadTierRegistry([tier("T2", 2), tier("T1", 1)])).toThrow();
    expect(() => createRoadTierRegistry([tier("T1", 1), tier("T1", 2)])).toThrow();
    expect(() => createRoadTierRegistry([tier("T1", 2)])).toThrow();
  });

  it("prices a length in whole gold, and refuses to charge for nothing", () => {
    expect(roadCost("T2", 10)).toBe(120);
    expect(roadCost("T3", 10)).toBe(600);
    expect(roadCost("T1", 0.5)).toBe(3);
    expect(roadCost("T1", 0)).toBe(0);
    expect(roadCost("T1", -4)).toBe(0);
    expect(Number.isInteger(roadCost("T1", 1.0000001))).toBe(true);
  });

  it("starts a player on the cheapest surface", () => {
    const starter = roadTiers.get(STARTER_ROAD_TIER);
    expect(starter?.rank).toBe(1);
    expect(starter?.pricePerTile).toBe(Math.min(...[...roadTiers.values()].map((tier) => tier.pricePerTile)));
  });
});

describe("the build catalogue", () => {
  it("declares every category the direction names, including the ones it will fill later", () => {
    expect([...PLACEMENT_CATEGORIES]).toEqual([
      "ROADS",
      "FENCES",
      "FARMING",
      "FORESTRY",
      "AQUACULTURE",
      "BUILDINGS",
      "STORAGE",
      "DECORATIONS",
      "NATURE",
      "UTILITY",
      "MONUMENTS",
      "WORKERS",
      "VEHICLES",
      "LIVESTOCK",
      "PROCESSING"
    ]);
    expect([...PLACEMENT_CAPABILITIES]).toEqual([
      "FARM",
      "FORESTRY",
      "AQUACULTURE",
      "LIVESTOCK",
      "ROAD",
      "BUILD",
      "DECORATION",
      "DOCK",
      "WALK"
    ]);
  });

  it("ships one entry per road tier, and nothing else yet", () => {
    expect(placementEntries).toHaveLength(ROAD_TIERS.length);
    for (const tierId of ROAD_TIERS) {
      const entry = placementEntries.find((candidate) => candidate.roadTierId === tierId);
      expect(entry).toBeDefined();
      expect(entry?.category).toBe("ROADS");
      expect(entry?.capability).toBe("ROAD");
      expect(entry?.tier).toBe(tierId);
      expect(entry?.price).toBe(roadTiers.get(tierId)?.pricePerTile);
    }
  });

  it("unlocks each road at the level of its own rank, so the ladder is the progression", () => {
    for (const entry of placementEntries) {
      expect(entry.unlockLevel).toBe(roadTiers.get(entry.tier ?? "T1")?.rank);
    }
  });

  it("has unique ids and a footprint on the cell grid", () => {
    const ids = placementEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of placementEntries) {
      expect(entry.footprint.widthCells).toBeGreaterThan(0);
      expect(entry.footprint.depthCells).toBeGreaterThan(0);
      expect(entry.price).toBeGreaterThanOrEqual(0);
      expect(placementCatalog.has(entry.id)).toBe(true);
    }
  });

  it("refuses a catalogue that could not be fulfilled", () => {
    const road = {
      id: "place_road_dirt_road",
      category: "ROADS",
      displayNameKey: "road.dirt_road.name",
      unlockLevel: 2,
      price: 12,
      currencyDefinitionId: "currency_gold",
      modelId: "road.dirt_road",
      footprint: { widthCells: 1, depthCells: 1 },
      capability: "ROAD",
      tier: "T2",
      upgradeGroup: "road",
      roadTierId: "T2"
    };
    // A catalogue with only one of the four tiers cannot be bought out in full.
    expect(() => createPlacementCatalog([road])).toThrow();
    // Two entries for the same tier is the same problem from the other side.
    expect(() => createPlacementCatalog([road, { ...road, id: "place_road_dirt_road_again" }])).toThrow();
    // And two entries with one id is simply ambiguous.
    expect(() => createPlacementCatalog([road, road])).toThrow();
  });

  it("refuses an entry that names a tier it does not belong to", () => {
    const fence = {
      id: "place_fence_wood",
      category: "FENCES",
      displayNameKey: "place.fence_wood.name",
      unlockLevel: 1,
      price: 10,
      currencyDefinitionId: "currency_gold",
      modelId: "fence.wood",
      footprint: { widthCells: 1, depthCells: 1 },
      capability: "DECORATION",
      tier: null,
      upgradeGroup: null,
      roadTierId: "T1"
    };
    expect(() => createPlacementCatalog([fence])).toThrow();
  });
});
