import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLACEMENT_CAPABILITIES,
  PLACEMENT_CATEGORIES,
  PROCEDURAL_MODEL_IDS,
  PROVISIONAL_ROAD_PRICES,
  ROAD_SEGMENT_CELLS,
  ROAD_TIERS,
  createPlacementCatalog,
  createRoadTierRegistry,
  placementCatalog,
  placementEntries,
  roadCost,
  roadTiers,
  upgradeChain,
  STARTER_ROAD_TIER
} from "@happy-farm/game-data";

/**
 * The road ladder and the build catalogue.
 *
 * These are the two pieces of the player-built island that are *data*: the player builds the roads, so
 * the roads have tiers and prices; the player builds everything else, so there is a place for it to be
 * declared. The tests hold the parts that must not drift - the one ratio the prototype balances on,
 * the upgrade chain, the uniqueness of ids, and the rule that a catalogue entry names a visual
 * something can actually draw.
 */

const ASSET_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models", import.meta.url));

/** Every model id the client ships, read from disk so the manifest cannot drift from the bundle. */
function shippedAssetIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const folder of readdirSync(ASSET_ROOT, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const file of readdirSync(`${ASSET_ROOT}/${folder.name}`)) {
      ids.add(file.replace(/\.glb$/, ""));
    }
  }
  return ids;
}

describe("road tiers", () => {
  it("is a four-rung ladder, cheapest first, drawn by the renderer's own three surfaces", () => {
    expect([...roadTiers.keys()]).toEqual([...ROAD_TIERS]);
    const tiers = [...roadTiers.values()];
    expect(tiers.map((tier) => tier.rank)).toEqual([1, 2, 3, 4]);
    expect(tiers.map((tier) => tier.surface)).toEqual(["DIRT", "GRAVEL", "STONE", "PAVED"]);
    for (const tier of tiers) {
      expect(["PATH", "SECONDARY", "PRIMARY"]).toContain(tier.renderKind);
      expect(tier.upgradeGroup).toBe("road");
      expect(tier.segmentCells).toBe(ROAD_SEGMENT_CELLS);
      expect(tier.moveMultiplier).toBeGreaterThanOrEqual(1);
    }
    // A better road is never slower and never cheaper.
    for (let index = 1; index < tiers.length; index += 1) {
      const previous = tiers[index - 1];
      const current = tiers[index];
      if (previous === undefined || current === undefined) throw new Error("missing tier");
      expect(current.pricePerSegment).toBeGreaterThan(previous.pricePerSegment);
      expect(current.moveMultiplier).toBeGreaterThanOrEqual(previous.moveMultiplier);
    }
  });

  it("upgrades upwards, one rung at a time, and stops at the top", () => {
    expect(roadTiers.get("road.dirt.t1")?.upgradeTo).toBe("road.gravel.t2");
    expect(roadTiers.get("road.gravel.t2")?.upgradeTo).toBe("road.stone.t3");
    expect(roadTiers.get("road.stone.t3")?.upgradeTo).toBe("road.paved.t4");
    expect(roadTiers.get("road.paved.t4")?.upgradeTo).toBeNull();
    // …and the chain a road travels is the whole ladder from wherever it starts.
    expect(upgradeChain("road.dirt.t1")).toEqual([
      "road.dirt.t1",
      "road.gravel.t2",
      "road.stone.t3",
      "road.paved.t4"
    ]);
    expect(upgradeChain("road.stone.t3")).toEqual(["road.stone.t3", "road.paved.t4"]);
    expect(upgradeChain("road.paved.t4")).toEqual(["road.paved.t4"]);
  });

  it("keeps the one prototype ratio the brief names: stone is five times dirt", () => {
    const dirt = roadTiers.get("road.dirt.t1");
    const stone = roadTiers.get("road.stone.t3");
    expect(dirt?.pricePerSegment).toBe(100);
    expect(stone?.pricePerSegment).toBe(500);
    expect((dirt?.pricePerSegment ?? 0) * 5).toBe(stone?.pricePerSegment);
    // The provisional table is the only place those numbers live.
    expect(PROVISIONAL_ROAD_PRICES["road.dirt.t1"]).toBe(dirt?.pricePerSegment);
    expect(PROVISIONAL_ROAD_PRICES["road.stone.t3"]).toBe(stone?.pricePerSegment);
  });

  it("rejects a ladder that skips a rung, repeats one, or points at nothing", () => {
    const tier = (id: string, rank: number, upgradeTo: string | null) => ({
      id,
      displayNameKey: "road.dirt.name",
      label: "Dirt road",
      rank,
      surface: "DIRT",
      renderKind: "SECONDARY",
      segmentCells: ROAD_SEGMENT_CELLS,
      pricePerSegment: 1,
      upgradeTo,
      upgradeGroup: "road",
      moveMultiplier: 1
    });
    const ladder = [
      tier("road.dirt.t1", 1, "road.gravel.t2"),
      tier("road.gravel.t2", 2, "road.stone.t3"),
      tier("road.stone.t3", 3, "road.paved.t4"),
      tier("road.paved.t4", 4, null)
    ];
    expect(() => createRoadTierRegistry(ladder)).not.toThrow();
    // A rung that skips the one above it, a duplicate, and an incomplete ladder all fail.
    expect(() => createRoadTierRegistry([...ladder.slice(0, 3), { ...ladder[3], upgradeTo: null }].map((entry) => ({ ...entry, upgradeTo: entry.id === "road.stone.t3" ? null : entry.upgradeTo })))).toThrow();
    expect(() => createRoadTierRegistry([...ladder, ladder[0]])).toThrow();
    expect(() => createRoadTierRegistry(ladder.slice(0, 2))).toThrow();
  });

  it("prices whole segments in gold, and refuses to charge for nothing", () => {
    expect(roadCost("road.dirt.t1", ROAD_SEGMENT_CELLS)).toBe(100);
    expect(roadCost("road.dirt.t1", ROAD_SEGMENT_CELLS * 3)).toBe(300);
    // Part of a segment is still a segment: a player buys road in the unit the shop sells it in.
    expect(roadCost("road.dirt.t1", 1)).toBe(100);
    expect(roadCost("road.stone.t3", ROAD_SEGMENT_CELLS)).toBe(500);
    expect(roadCost("road.dirt.t1", 0)).toBe(0);
    expect(roadCost("road.dirt.t1", -4)).toBe(0);
    expect(Number.isInteger(roadCost("road.gravel.t2", 2.5))).toBe(true);
  });

  it("starts the island and a new player on the cheapest surface", () => {
    const starter = roadTiers.get(STARTER_ROAD_TIER);
    expect(starter?.rank).toBe(1);
    expect(starter?.surface).toBe("DIRT");
    expect(starter?.pricePerSegment).toBe(
      Math.min(...[...roadTiers.values()].map((tier) => tier.pricePerSegment))
    );
  });
});

describe("the build catalogue", () => {
  it("declares every category the direction names, including the ones it will fill later", () => {
    expect([...PLACEMENT_CATEGORIES]).toEqual([
      "ROAD",
      "BUILDING",
      "DECORATION",
      "VEGETATION",
      "UTILITY",
      "MONUMENT",
      "FENCE",
      "LIGHTING",
      "WATERFRONT"
    ]);
    // The capability vocabulary is the island's own, and a catalogue entry may only ask for one of it.
    expect([...PLACEMENT_CAPABILITIES]).toEqual([
      "WALK",
      "BUILD",
      "FARM",
      "FORESTRY",
      "LIVESTOCK",
      "ROAD",
      "DECORATION",
      "AQUACULTURE",
      "DOCK",
      "MINING"
    ]);
  });

  it("ships one entry per road tier, and nothing else yet", () => {
    expect(placementEntries).toHaveLength(ROAD_TIERS.length);
    for (const tierId of ROAD_TIERS) {
      const entry = placementEntries.find((candidate) => candidate.tier === tierId);
      expect(entry).toBeDefined();
      expect(entry?.category).toBe("ROAD");
      expect(entry?.capability).toBe("ROAD");
      expect(entry?.price).toBe(roadTiers.get(tierId)?.pricePerSegment);
      // A road segment is four cells long and one wide, and it can be turned.
      expect(entry?.footprint).toEqual({ widthCells: 1, depthCells: ROAD_SEGMENT_CELLS });
      expect(entry?.rotatable).toBe(true);
      expect(entry?.decorative).toBe(false);
    }
  });

  it("unlocks each tier at the level of its own rank, so the ladder is the progression", () => {
    for (const entry of placementEntries) {
      expect(entry.requiredLevel).toBe(roadTiers.get(entry.tier ?? "road.dirt.t1")?.rank);
    }
  });

  it("has unique ids, and every one of them addresses the catalogue", () => {
    const ids = placementEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of placementEntries) {
      expect(placementCatalog.has(entry.id)).toBe(true);
      expect(entry.id).toMatch(/^place_[a-z0-9_]+$/);
    }
  });

  it("points every upgrade at an entry that exists, and never cycles", () => {
    for (const entry of placementEntries) {
      if (entry.upgradeTo === null) continue;
      expect(placementCatalog.has(entry.upgradeTo), `${entry.id} -> ${entry.upgradeTo}`).toBe(true);
      const seen = new Set<string>([entry.id]);
      let current: string | null = entry.upgradeTo;
      while (current !== null) {
        expect(seen.has(current), `${entry.id} cycles at ${current}`).toBe(false);
        seen.add(current);
        current = placementCatalog.get(current)?.upgradeTo ?? null;
      }
    }
  });

  it("never sells anything for less than nothing", () => {
    for (const entry of placementEntries) {
      expect(entry.price).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.price)).toBe(true);
    }
  });

  it("names only visuals that resolve: a shipped model or one the renderer draws itself", () => {
    const shipped = shippedAssetIds();
    for (const entry of placementEntries) {
      if (entry.modelId === null) continue;
      const resolvable = shipped.has(entry.modelId) || (PROCEDURAL_MODEL_IDS as readonly string[]).includes(entry.modelId);
      expect(resolvable, `${entry.id} names ${entry.modelId}`).toBe(true);
    }
    // …and the catalogue refuses a visual nothing can draw rather than shipping a hole.
    expect(() =>
      createPlacementCatalog(
        placementEntries.map((entry) =>
          entry.id === "place_road_dirt" ? { ...entry, modelId: "nothing.at.all" } : entry
        )
      )
    ).toThrow();
  });

  it("refuses a catalogue that could not be fulfilled", () => {
    const road = {
      id: "place_road_dirt",
      category: "ROAD",
      displayNameKey: "road.dirt.name",
      requiredLevel: 1,
      price: 100,
      currencyDefinitionId: "currency_gold",
      modelId: "road.dirt",
      footprint: { widthCells: 1, depthCells: 4 },
      capability: "ROAD",
      tier: "road.dirt.t1",
      upgradeTo: null,
      rotatable: true,
      decorative: false
    };
    // A catalogue with only one of the four tiers cannot be bought out in full.
    expect(() => createPlacementCatalog([road])).toThrow();
    // Two entries for the same tier is the same problem from the other side.
    expect(() => createPlacementCatalog([road, { ...road, id: "place_road_dirt_again" }])).toThrow();
    // And two entries with one id is simply ambiguous.
    expect(() => createPlacementCatalog([road, road])).toThrow();
  });

  it("refuses an entry that names a tier it does not belong to", () => {
    const fence = {
      id: "place_fence_wood",
      category: "FENCE",
      displayNameKey: "place.fence_wood.name",
      requiredLevel: 1,
      price: 10,
      currencyDefinitionId: "currency_gold",
      modelId: null,
      footprint: { widthCells: 1, depthCells: 1 },
      capability: "DECORATION",
      tier: "road.dirt.t1",
      upgradeTo: null,
      rotatable: true,
      decorative: true
    };
    expect(() => createPlacementCatalog([fence])).toThrow();
  });
});
