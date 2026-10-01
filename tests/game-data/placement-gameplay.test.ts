import { describe, expect, it } from "vitest";
import {
  GAMEPLAY_CLASSIFICATIONS,
  ROAD_TIERS,
  gameplayCoverageProblems,
  gameplayFor,
  placementEntries,
  roadFootprintWidthCells,
  roadTiers
} from "@happy-farm/game-data";

/**
 * The functional-asset contract, enforced.
 *
 * The catalogue is only allowed to sell things it can explain: every entry has a classification, every
 * functional entry carries structured effects, and the roads' prices and footprints follow the ladder
 * the economy document describes. A later pass that adds a warehouse without capacity, or a road
 * whose logical footprint is narrower than the ribbon it draws, fails here rather than in the shop.
 */

describe("every shipped asset declares what it does", () => {
  it("has a gameplay definition for every entry, and no definitions for entries that do not ship", () => {
    expect(gameplayCoverageProblems()).toEqual([]);
  });

  it("gives every classification a definition the shop can read", () => {
    for (const entry of placementEntries) {
      const gameplay = gameplayFor(entry.id);
      expect(gameplay, entry.id).not.toBeNull();
      expect(GAMEPLAY_CLASSIFICATIONS).toContain(gameplay?.classification);
      expect(gameplay?.summaryKey).toMatch(/^place\.[a-z0-9_]+\.effect$/);
    }
  });

  it("gives functional assets structured effects, and lets cosmetics have none", () => {
    for (const entry of placementEntries) {
      const gameplay = gameplayFor(entry.id);
      if (gameplay === null) throw new Error(`missing gameplay for ${entry.id}`);
      const functional = gameplay.classification !== "COSMETIC" && gameplay.classification !== "UTILITY";
      if (functional) {
        const hasEffect =
          gameplay.production !== null || gameplay.storage !== null || gameplay.movement !== null;
        expect(hasEffect, `${entry.id} must carry an effect`).toBe(true);
      }
      // Only a storage asset may claim capacity, and only production may claim a cycle.
      if (gameplay.storage !== null) expect(gameplay.classification).toBe("STORAGE");
      if (gameplay.production !== null) expect(gameplay.classification).toBe("PRODUCTION");
    }
  });

  it("never calls an unbuilt effect ACTIVE", () => {
    for (const tier of ROAD_TIERS) {
      const entry = placementEntries.find((candidate) => candidate.tier === tier);
      expect(gameplayFor(entry?.id ?? "")?.status).toBe("PREVIEW_ONLY");
    }
    // Storage and production are defined but nothing enforces or runs them yet.
    for (const id of ["place_barn_t1", "place_silo", "place_coop", "place_windmill"]) {
      expect(gameplayFor(id)?.status, id).toBe("FOUNDATION_ONLY");
    }
    // A decoration is real today: it is built, persisted and drawn.
    expect(gameplayFor("place_tree_broad")?.status).toBe("ACTIVE");
  });
});

describe("the road contract", () => {
  it("gives every tier a footprint at least as wide as the ribbon it draws", () => {
    for (const tierId of ROAD_TIERS) {
      const tier = roadTiers.get(tierId);
      const entry = placementEntries.find((candidate) => candidate.tier === tierId);
      expect(tier, tierId).toBeDefined();
      expect(entry, tierId).toBeDefined();
      const logical = entry?.footprint.widthCells ?? 0;
      const rendered = tier === undefined ? 0 : roadFootprintWidthCells(tier.renderKind);
      expect(logical).toBeGreaterThanOrEqual(rendered);
      expect(entry?.footprint.depthCells).toBe(4);
    }
  });

  it("keeps the cost ladder monotonic and stones at roughly five times dirt", () => {
    const prices = ROAD_TIERS.map((tierId) => roadTiers.get(tierId)?.pricePerSegment ?? 0);
    for (let index = 1; index < prices.length; index += 1) {
      expect(prices[index] ?? 0).toBeGreaterThan(prices[index - 1] ?? 0);
    }
    const dirt = prices[0] ?? 0;
    const stone = prices[2] ?? 0;
    expect(stone / dirt).toBeGreaterThanOrEqual(4);
    expect(stone / dirt).toBeLessThanOrEqual(6);
  });

  it("keeps every road tier's movement multiplier a plan, not a claim", () => {
    for (const tierId of ROAD_TIERS) {
      const movement = gameplayFor(
        placementEntries.find((candidate) => candidate.tier === tierId)?.id ?? ""
      )?.movement;
      expect(movement?.multiplier ?? 0).toBeGreaterThan(1);
    }
  });
});
