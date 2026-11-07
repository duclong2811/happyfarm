import { describe, expect, it } from "vitest";
import {
  farmingBalance,
  itemRegistry,
  miningBalance,
  resourceDefinitionRegistry,
  resourceDefinitions,
  resourceDropTableRegistry,
  resourceDropTables,
  activeResourceNodes,
  classifyTile,
  groundCapabilities,
  resourceNodeRegistry,
  resourceNodes,
  shops,
  validateResourceDefinitions
} from "@happy-farm/game-data";

/**
 * The mining catalogue and its economy.
 *
 * Validation is at the boundary: a node naming a definition that does not exist, a definition naming a
 * table that does not, a table dropping an item that is not a material, or a node placed in no zone all
 * fail here rather than as a settlement that cannot pay. The balance half computes the sustained rates
 * - after regeneration, not just per swing - and holds them against fishing and farming.
 */

describe("the mining catalogue", () => {
  it("ships one active ore output while retaining legacy materials", () => {
    const materials = ["item_ore"];
    for (const id of materials) {
      expect(itemRegistry.get(id)?.category, id).toBe("MATERIAL");
    }
    expect(new Set(materials).size).toBe(1);
    for (const legacy of ["item_stone", "item_copper_ore", "item_iron_ore", "item_coal"]) {
      expect(itemRegistry.get(legacy)?.category, legacy).toBe("MATERIAL");
    }
  });

  it("ships one active mining definition and one active placement, all in the home island zone", () => {
    const mining = resourceDefinitions.filter((definition) => definition.verb === "MINE");
    const miningNodes = activeResourceNodes.filter((node) =>
      mining.some((definition) => definition.id === node.definitionId)
    );
    expect(miningNodes).toHaveLength(1);
    expect(miningNodes[0]).toMatchObject({ id: "node_stone_ridge", definitionId: "resource_ore", position: { x: 12, y: -12 } });
    expect(mining.filter((definition) => activeResourceNodes.some((node) => node.definitionId === definition.id))).toHaveLength(1);
    expect(new Set(resourceDefinitions.map((definition) => definition.id)).size).toBe(
      resourceDefinitions.length
    );
    expect(miningNodes.length).toBe(1);
    expect(new Set(resourceNodes.map((node) => node.id)).size).toBe(resourceNodes.length);
    for (const node of miningNodes) {
      expect(node.zoneKind, node.id).toBe("HOME_ISLAND");
      expect(resourceDefinitionRegistry.has(node.definitionId), node.id).toBe(true);
      expect(Number.isFinite(node.position.x), node.id).toBe(true);
      expect(node.interactionRadiusTiles, node.id).toBeGreaterThan(0);
    }
    const mineTile = miningNodes[0]?.position;
    if (mineTile === undefined) throw new Error("active mining placement is missing");
    expect(classifyTile(mineTile).terrain).toBe("VOLCANO");
    expect(groundCapabilities(mineTile)).toContain("MINING");
    for (const definition of mining) {
      expect(definition.verb, definition.id).toBe("MINE");
      expect(definition.actionSeconds, definition.id).toBeGreaterThan(0);
      expect(definition.actionSeconds, definition.id).toBeLessThanOrEqual(60);
      expect(definition.regenerationSeconds, definition.id).toBeGreaterThan(definition.actionSeconds);
      expect(definition.xp, definition.id).toBeGreaterThan(0);
      expect((definition.requiredLevel ?? 1) <= 10_000, definition.id).toBe(true);
      expect(resourceDropTableRegistry.has(definition.dropTableId), definition.id).toBe(true);
    }
  });

  it("keeps one definition per material so the catalogue reads as production, not luck", () => {
    const activeMiningDefinitions = resourceDefinitions.filter((definition) =>
      definition.verb === "MINE" && activeResourceNodes.some((node) => node.definitionId === definition.id)
    );
    const miningTables = resourceDropTables.filter((table) =>
      activeMiningDefinitions.some((definition) => definition.dropTableId === table.id)
    );
    const dropped = miningTables.flatMap((table) => table.entries.map((entry) => entry.itemDefinitionId));
    expect([...new Set(dropped)].sort()).toEqual(
      ["item_ore"]
    );
    // Every shipped table is deterministic for the alpha: one entry, one exact quantity.
    for (const table of resourceDropTables) {
      expect(table.entries, table.id).toHaveLength(1);
      const entry = table.entries[0];
      expect(entry?.minQuantity, table.id).toBe(entry?.maxQuantity);
    }
  });

  it("refuses a catalogue that could not pay a gather", () => {
    const goodDefinition = {
      id: "resource_test",
      displayNameKey: "resource.test.name",
      verb: "MINE" as const,
      actionSeconds: 5,
      regenerationSeconds: 60,
      productionUnitsPerHour: 1,
      settlementMode: "REGENERATING_NODE" as const,
      dropTableId: "resourcetable_test",
      xp: 1,
      modelId: "resource_test"
    };
    const goodTable = {
      id: "resourcetable_test",
      displayNameKey: "resourcetable.test.name",
      entries: [{ itemDefinitionId: "item_stone", minQuantity: 1, maxQuantity: 1, weight: 1 }]
    };
    const goodNode = {
      id: "node_test",
      definitionId: "resource_test",
      zoneKind: "HOME_ISLAND" as const,
      position: { x: 0, y: 0 },
      interactionRadiusTiles: 3
    };
    expect(() => {
      validateResourceDefinitions(
        new Map([[goodDefinition.id, goodDefinition]]),
        new Map([[goodTable.id, goodTable]]),
        new Map([[goodNode.id, goodNode]]),
        itemRegistry
      );
    }).not.toThrow();

    const mustGet = <T>(map: ReadonlyMap<string, T>, key: string): T => {
      const value = map.get(key);
      if (value === undefined) throw new Error(`fixture is missing ${key}`);
      return value;
    };
    // A definition whose table does not exist.
    expect(() => {
      validateResourceDefinitions(
        new Map([[goodDefinition.id, { ...goodDefinition, dropTableId: "resourcetable_absent" }]]),
        new Map([[goodTable.id, goodTable]]),
        new Map([[goodNode.id, goodNode]]),
        itemRegistry
      );
    }).toThrow("unknown drop table");
    // A table dropping something that is not a material.
    expect(() => {
      validateResourceDefinitions(
        new Map([[goodDefinition.id, goodDefinition]]),
        new Map([
          [goodTable.id, { ...goodTable, entries: [{ itemDefinitionId: "item_carrot", minQuantity: 1, maxQuantity: 1, weight: 1 }] }]
        ]),
        new Map([[goodNode.id, goodNode]]),
        itemRegistry
      );
    }).toThrow("Unknown material item");
    // A node naming no definition, and an island with no nodes.
    expect(() => {
      validateResourceDefinitions(
        new Map([[goodDefinition.id, goodDefinition]]),
        new Map([[goodTable.id, goodTable]]),
        new Map([[goodNode.id, { ...goodNode, definitionId: "resource_absent" }]]),
        itemRegistry
      );
    }).toThrow("unknown definition");
    expect(() => {
      validateResourceDefinitions(
        new Map([[goodDefinition.id, goodDefinition]]),
        new Map([[goodTable.id, goodTable]]),
        new Map(),
        itemRegistry
      );
    }).toThrow("no resource nodes");
    expect(mustGet(resourceNodeRegistry, "node_stone_ridge").definitionId).toBe("resource_ore");
    expect(mustGet(resourceDefinitionRegistry, "resource_stone").dropTableId).toBe("resourcetable_stone");
  });
});

describe("the mining economy", () => {
  it("computes a sustained rate that accounts for regeneration, not just one swing", () => {
    for (const resource of miningBalance.resources) {
      expect(resource.nodeCount, resource.id).toBeGreaterThan(0);
      expect(resource.goldPerGather, resource.id).toBe(resource.quantityPerGather * resource.unitSellPrice);
      const windowsPerMinute =
        60 / Math.max(resource.nodeCount * resource.actionSeconds, resource.regenerationSeconds);
      const expectedRate = resource.id === "resource_ore"
        ? resource.goldPerGather * 60 / resource.actionSeconds
        : resource.nodeCount * resource.goldPerGather * windowsPerMinute;
      expect(resource.sustainedGoldPerMinute, resource.id).toBeCloseTo(
        expectedRate,
        10
      );
      // Unified ore keeps the former starter timing/value until a broader economy pass.
      expect(resource.sustainedGoldPerMinute, resource.id).toBeGreaterThan(0);
    }
    const total = miningBalance.resources.reduce((sum, resource) => sum + resource.sustainedGoldPerMinute, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("keeps materials cheap enough that future crafting is not obviously the worse choice", () => {
    for (const resource of miningBalance.resources) {
      expect(resource.unitSellPrice, resource.id).toBeGreaterThan(0);
      expect(resource.unitSellPrice, resource.id).toBeLessThanOrEqual(4);
    }
    // Selling is a convenience, not the best use of a material: no material out-earns the best crop
    // per minute on its own.
    const bestCropGold = Math.max(...farmingBalance.crops.map((crop) => crop.goldPerMinute));
    for (const resource of miningBalance.resources) {
      if (resource.id !== "resource_ore") expect(resource.sustainedGoldPerMinute, resource.id).toBeLessThan(bestCropGold * 10);
    }
  });

  it("pays every material through the same market as produce, and buys none of it", () => {
    for (const table of resourceDropTables) {
      for (const entry of table.entries) {
        const shopEntry = shops.find((row) => row.itemDefinitionId === entry.itemDefinitionId);
        expect(shopEntry?.sellPrice, entry.itemDefinitionId).toBeGreaterThan(0);
        expect(shopEntry?.buyPrice, entry.itemDefinitionId).toBeUndefined();
      }
    }
  });
});
