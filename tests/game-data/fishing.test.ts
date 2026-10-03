import { describe, expect, it } from "vitest";
import {
  FISHING_ACTION_SECONDS,
  farmingBalance,
  fish,
  fishingBalance,
  fishingSpotRegistry,
  fishingSpots,
  fishingTableRegistry,
  fishingTables,
  fishRegistry,
  itemRegistry,
  shops,
  validateFishingDefinitions,
  type FishDefinitionData,
  type FishingSpotData,
  type FishingTableData
} from "@happy-farm/game-data";

/**
 * The fishing catalogue and its economy, held to the same standard as the crops.
 *
 * Validation is at the boundary: a spot with no table, a table entry naming a fish that does not
 * exist, a fish whose item is missing or is not a `FISH`, or two species sharing one item all fail
 * here rather than as a settlement that cannot find its reward. The balance half computes the
 * expected catch rather than restating it, and holds it against the farming rates so a future edit
 * cannot quietly make fishing the only thing worth doing.
 */

describe("the fishing catalogue", () => {
  it("ships a handful of species, each with its own item and a positive value", () => {
    expect(fish.length).toBeGreaterThanOrEqual(5);
    expect(fish.length).toBeLessThanOrEqual(7);
    for (const definition of fish) {
      const item = itemRegistry.get(definition.itemDefinitionId);
      expect(item?.category, definition.id).toBe("FISH");
      expect(definition.sellPrice, definition.id).toBeGreaterThan(0);
      expect(definition.xp, definition.id).toBeGreaterThan(0);
      expect(definition.catchWeight, definition.id).toBeGreaterThan(0);
      expect(definition.modelId, definition.id).toBe(definition.id);
    }
    expect(new Set(fish.map((definition) => definition.id)).size).toBe(fish.length);
    expect(new Set(fish.map((definition) => definition.itemDefinitionId)).size).toBe(fish.length);
  });

  it("has one or two catch tables whose weights and references are sound", () => {
    expect(fishingTables.length).toBeGreaterThanOrEqual(1);
    expect(fishingTables.length).toBeLessThanOrEqual(2);
    for (const table of fishingTables) {
      expect(table.entries.length, table.id).toBeGreaterThan(0);
      expect(new Set(table.entries.map((entry) => entry.fishId)).size, table.id).toBe(table.entries.length);
      for (const entry of table.entries) {
        expect(fishRegistry.has(entry.fishId), `${table.id}/${entry.fishId}`).toBe(true);
        expect(entry.weight, entry.fishId).toBeGreaterThan(0);
      }
    }
  });

  it("places every spot in water with a real table and an explicit zone", () => {
    expect(fishingSpots.length).toBeGreaterThanOrEqual(3);
    for (const spot of fishingSpots) {
      expect(spot.zoneKind, spot.id).toBe("HOME_ISLAND");
      expect(fishingTableRegistry.has(spot.tableId), spot.id).toBe(true);
      expect(Number.isFinite(spot.position.x), spot.id).toBe(true);
      expect(Number.isFinite(spot.position.y), spot.id).toBe(true);
      expect(spot.interactionRadiusTiles, spot.id).toBeGreaterThan(0);
    }
    expect(fishingSpotRegistry.get("spot_pond_north")).toBeDefined();
    expect(fishingSpotRegistry.get("spot_harbour_quay")).toBeDefined();
  });

  it("has a positive, alpha-short action duration", () => {
    expect(Number.isSafeInteger(FISHING_ACTION_SECONDS)).toBe(true);
    expect(FISHING_ACTION_SECONDS).toBeGreaterThanOrEqual(5);
    expect(FISHING_ACTION_SECONDS).toBeLessThanOrEqual(60);
  });

  it("refuses a catalogue a settlement could not pay", () => {
    const mustGet = <T>(map: ReadonlyMap<string, T>, key: string): T => {
      const value = map.get(key);
      if (value === undefined) throw new Error(`fixture is missing ${key}`);
      return value;
    };
    const goodFish = new Map<string, FishDefinitionData>([
      [
        "fish_test",
        { id: "fish_test", displayNameKey: "fish.test.name", itemDefinitionId: "item_fish_tilapia", modelId: "fish_test", sellPrice: 2, xp: 1, catchWeight: 1 }
      ]
    ]);
    const goodTable = new Map<string, FishingTableData>([
      ["fishtable_test", { id: "fishtable_test", displayNameKey: "fishtable.test.name", entries: [{ fishId: "fish_test", weight: 1 }] }]
    ]);
    const goodSpot = new Map<string, FishingSpotData>([
      ["spot_test", { id: "spot_test", displayNameKey: "spot.test.name", zoneKind: "HOME_ISLAND", position: { x: 0, y: 0 }, interactionRadiusTiles: 3, tableId: "fishtable_test", enabled: true }]
    ]);
    expect(() => {
      validateFishingDefinitions(goodFish, goodTable, goodSpot, itemRegistry);
    }).not.toThrow();

    // A fish whose item is missing, or is not a fish.
    expect(() => {
      validateFishingDefinitions(
        new Map([["fish_test", { ...mustGet(goodFish, "fish_test"), itemDefinitionId: "item_missing" }]]),
        goodTable,
        goodSpot,
        itemRegistry
      );
    }).toThrow("Unknown fish item definition");
    expect(() => {
      validateFishingDefinitions(
        new Map([["fish_test", { ...mustGet(goodFish, "fish_test"), itemDefinitionId: "item_carrot" }]]),
        goodTable,
        goodSpot,
        itemRegistry
      );
    }).toThrow("Unknown fish item definition");

    // Two species sharing one item would make a catch ambiguous about what was caught.
    expect(() => {
      validateFishingDefinitions(
        new Map([
          ["fish_test", mustGet(goodFish, "fish_test")],
          ["fish_other", { ...mustGet(goodFish, "fish_test"), id: "fish_other" }]
        ]),
        goodTable,
        goodSpot,
        itemRegistry
      );
    }).toThrow("Duplicate fish item reference");

    // A table naming a fish that does not exist, or the same fish twice.
    expect(() => {
      validateFishingDefinitions(
        goodFish,
        new Map([["fishtable_test", { ...mustGet(goodTable, "fishtable_test"), entries: [{ fishId: "fish_absent", weight: 1 }] }]]),
        goodSpot,
        itemRegistry
      );
    }).toThrow("Unknown fish in table");
    expect(() => {
      validateFishingDefinitions(
        goodFish,
        new Map([
          ["fishtable_test", { ...mustGet(goodTable, "fishtable_test"), entries: [{ fishId: "fish_test", weight: 1 }, { fishId: "fish_test", weight: 1 }] }]
        ]),
        goodSpot,
        itemRegistry
      );
    }).toThrow("Duplicate fish in table");

    // A spot with no table, and an island with no spots at all.
    expect(() => {
      validateFishingDefinitions(
        goodFish,
        goodTable,
        new Map([["spot_test", { ...mustGet(goodSpot, "spot_test"), tableId: "fishtable_absent" }]]),
        itemRegistry
      );
    }).toThrow("unknown table");
    expect(() => {
      validateFishingDefinitions(goodFish, goodTable, new Map(), itemRegistry);
    }).toThrow("no fishing spots");
  });
});

describe("the fishing economy", () => {
  it("computes each species' probability and the table's expected action", () => {
    for (const table of fishingBalance.tables) {
      const probabilities = table.entries.map((entry) => entry.probability);
      expect(probabilities.reduce((sum, value) => sum + value, 0), table.id).toBeCloseTo(1, 10);
      for (const entry of table.entries) {
        expect(entry.probability, entry.id).toBeGreaterThan(0);
        expect(entry.probability, entry.id).toBeLessThan(1);
        expect(entry.goldContribution, entry.id).toBeCloseTo(entry.sellPrice * entry.probability, 10);
        expect(entry.xpContribution, entry.id).toBeCloseTo(entry.xp * entry.probability, 10);
      }
      const expectedGold = table.entries.reduce((sum, entry) => sum + entry.sellPrice * entry.probability, 0);
      expect(table.expectedGoldPerAction, table.id).toBeCloseTo(expectedGold, 10);
      expect(table.expectedGoldPerAction, table.id).toBeGreaterThan(0);
      expect(table.goldPerMinute, table.id).toBeCloseTo(
        table.expectedGoldPerAction / (FISHING_ACTION_SECONDS / 60),
        10
      );
    }
  });

  it("gives every spot a table, and every table at least one spot", () => {
    for (const table of fishingBalance.tables) {
      expect(table.spotIds.length, table.id).toBeGreaterThan(0);
    }
    for (const spot of fishingSpots) {
      expect(fishingBalance.tables.some((table) => table.id === spot.tableId), spot.id).toBe(true);
    }
  });

  it("is worth doing without making farming pointless", () => {
    const bestCropGoldPerMinute = Math.max(...farmingBalance.crops.map((crop) => crop.goldPerMinute));
    const bestCropXpPerMinute = Math.max(...farmingBalance.crops.map((crop) => crop.xpPerMinute));
    for (const table of fishingBalance.tables) {
      // Fishing is one action at a time and needs no land, so it may beat a single crop's rate - but
      // it must stay in the same order of magnitude, and it must not out-earn a farm of many tiles.
      expect(table.goldPerMinute, table.id).toBeGreaterThan(bestCropGoldPerMinute * 5);
      expect(table.goldPerMinute, table.id).toBeLessThan(bestCropGoldPerMinute * 60);
      expect(table.xpPerMinute, table.id).toBeGreaterThan(bestCropXpPerMinute / 4);
      expect(table.xpPerMinute, table.id).toBeLessThan(bestCropXpPerMinute * 30);
    }
  });

  it("pays every fish a whole, positive sell price through the same market as produce", () => {
    for (const definition of fish) {
      const entry = shops.find((row) => row.itemDefinitionId === definition.itemDefinitionId);
      expect(entry?.sellPrice, definition.id).toBe(definition.sellPrice);
      expect(entry?.buyPrice, definition.id).toBeUndefined();
    }
  });
});
