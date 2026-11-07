import { describe, expect, it } from "vitest";
import {
  forestryBalance,
  itemRegistry,
  miningBalance,
  resourceDefinitionRegistry,
  resourceDefinitions,
  resourceDropTables,
  resourceNodes,
  shops,
  validateResourceDefinitions
} from "@happy-farm/game-data";

/**
 * Forestry as the second consumer of the resource-node catalogue.
 *
 * The same validators, the same tables and the same balance maths as mining - only the *data* differs:
 * a verb, a stump, a longer wait, a different material. If any of this needed a new rule, the V15.2
 * abstraction would have been wrong.
 */

const forestryDefinitions = resourceDefinitions.filter((definition) => definition.verb === "CHOP");
const forestryNodes = resourceNodes.filter((node) =>
  forestryDefinitions.some((definition) => definition.id === node.definitionId)
);

describe("the forestry catalogue", () => {
  it("ships three wild tree definitions, all CHOP, all with a stump", () => {
    expect(forestryDefinitions).toHaveLength(3);
    for (const definition of forestryDefinitions) {
      expect(definition.verb, definition.id).toBe("CHOP");
      expect(definition.actionSeconds, definition.id).toBeGreaterThan(0);
      expect(definition.actionSeconds, definition.id).toBeLessThanOrEqual(60);
      expect(definition.regenerationSeconds, definition.id).toBeGreaterThan(definition.actionSeconds);
      expect(definition.xp, definition.id).toBeGreaterThan(0);
      // A tree that is chopped leaves a stump; a rock has nothing better than shrinking.
      expect(definition.depletedModelId, definition.id).toMatch(/^resource_[a-z_]+_stump$/);
      expect(resourceDefinitionRegistry.has(definition.id), definition.id).toBe(true);
    }
    // Mining keeps its own answer: no stump, and the renderer shrinks it instead.
    for (const definition of resourceDefinitions.filter((entry) => entry.verb === "MINE")) {
      expect(definition.depletedModelId, definition.id).toBeUndefined();
    }
  });

  it("places thirteen wild trees in the island's woods, clear of the mining deposits", () => {
    expect(forestryNodes.length).toBeGreaterThanOrEqual(8);
    expect(forestryNodes.length).toBeLessThanOrEqual(15);
    expect(new Set(forestryNodes.map((node) => node.id)).size).toBe(forestryNodes.length);
    const miningNodes = resourceNodes.filter((node) => !forestryNodes.includes(node));
    for (const node of forestryNodes) {
      expect(node.zoneKind, node.id).toBe("HOME_ISLAND");
      expect(Number.isFinite(node.position.x), node.id).toBe(true);
      expect(node.interactionRadiusTiles, node.id).toBeGreaterThan(0);
      // Nothing puts two different kinds of node inside one interaction range.
      for (const other of miningNodes) {
        const distance = Math.hypot(other.position.x - node.position.x, other.position.y - node.position.y);
        expect(distance, `${node.id} vs ${other.id}`).toBeGreaterThan(4);
      }
    }
  });

  it("gives each tree its own material, and each material its own tree", () => {
    const forestryTables = resourceDropTables.filter((table) =>
      forestryDefinitions.some((definition) => definition.dropTableId === table.id)
    );
    const dropped = forestryTables.flatMap((table) =>
      table.entries.map((entry) => entry.itemDefinitionId)
    );
    expect([...new Set(dropped)].sort()).toEqual(["item_hardwood", "item_resin", "item_wood"]);
    for (const id of ["item_wood", "item_hardwood", "item_resin"]) {
      expect(itemRegistry.get(id)?.category, id).toBe("MATERIAL");
    }
    // Deterministic for the alpha: one entry, one exact quantity.
    for (const table of forestryTables) {
      expect(table.entries, table.id).toHaveLength(1);
      expect(table.entries[0]?.minQuantity, table.id).toBe(table.entries[0]?.maxQuantity);
    }
  });

  it("validates through the same rules as mining, refusing a chop tree with no material", () => {
    const definition = forestryDefinitions[0];
    const table = resourceDropTables.find((entry) => entry.id === definition?.dropTableId);
    const node = forestryNodes[0];
    if (definition === undefined || table === undefined || node === undefined) {
      throw new Error("the forestry fixture is missing");
    }
    expect(() => {
      validateResourceDefinitions(new Map([[definition.id, definition]]), new Map([[table.id, table]]), new Map([[node.id, node]]), itemRegistry);
    }).not.toThrow();
    // A CHOP tree that dropped something which is not a material is refused by the same rule.
    expect(() => {
      validateResourceDefinitions(
        new Map([[definition.id, definition]]),
        new Map([[table.id, { ...table, entries: [{ itemDefinitionId: "item_carrot", minQuantity: 1, maxQuantity: 1, weight: 1 }] }]]),
        new Map([[node.id, node]]),
        itemRegistry
      );
    }).toThrow("Unknown material item");
  });
});

describe("the forestry economy (provisional)", () => {
  it("computes a sustained rate after regeneration, like mining", () => {
    expect(forestryBalance.resources).toHaveLength(3);
    for (const resource of forestryBalance.resources) {
      expect(resource.verb, resource.id).toBe("CHOP");
      expect(resource.nodeCount, resource.id).toBeGreaterThan(0);
      expect(resource.sustainedGoldPerMinute, resource.id).toBeGreaterThan(0);
      expect(resource.sustainedXpPerMinute, resource.id).toBeGreaterThan(0);
    }
  });

  it("remains a separate lower-throughput profession than unified Mining", () => {
    const forestryGold = forestryBalance.resources.reduce((sum, entry) => sum + entry.sustainedGoldPerMinute, 0);
    const miningGold = miningBalance.resources.reduce((sum, entry) => sum + entry.sustainedGoldPerMinute, 0);
    // Unified Mining is intentionally labor-driven at 2 ore / 6 seconds; forestry keeps its
    // regenerating-node rate and therefore does not share the mining throughput number.
    expect(miningGold).toBeGreaterThan(forestryGold);
  });

  it("keeps every forestry material cheap and sellable through the same market", () => {
    for (const resource of forestryBalance.resources) {
      expect(resource.unitSellPrice, resource.id).toBeGreaterThan(0);
      expect(resource.unitSellPrice, resource.id).toBeLessThanOrEqual(3);
      const entry = shops.find((row) => row.itemDefinitionId === resource.dropItemDefinitionId);
      expect(entry?.sellPrice, resource.id).toBe(resource.unitSellPrice);
      expect(entry?.buyPrice, resource.id).toBeUndefined();
    }
  });
});
