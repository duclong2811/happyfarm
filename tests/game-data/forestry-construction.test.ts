import { describe, expect, it } from "vitest";
import {
  FORESTRY_CONSTRUCTION_DEFINITIONS,
  forestryConstructionDefinition,
  itemRegistry,
  shopRegistry,
  treeRegistry
} from "@happy-farm/game-data";

describe("construction forestry definitions", () => {
  it("gives persisted broadleaf and pine trees stable server-owned drops", () => {
    expect(Object.keys(FORESTRY_CONSTRUCTION_DEFINITIONS).sort()).toEqual([
      "place_tree_broad",
      "place_tree_pine",
      "world.tree_broad",
      "world.tree_pine"
    ]);
    expect(forestryConstructionDefinition("world.tree_broad")).toMatchObject({ dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 720, stumpSizeWorld: 1.15 });
    expect(forestryConstructionDefinition("world.tree_pine")).toMatchObject({ dropItemDefinitionId: "item_wood", dropQuantity: 2, regenerationSeconds: 900, stumpSizeWorld: 1.3 });
    expect(forestryConstructionDefinition("world.tree_broad")).toEqual(forestryConstructionDefinition("place_tree_broad"));
  });

  it("keeps planted Wildwood as the specialized, higher-yield producer", () => {
    const wildwood = treeRegistry.get("tree_wildwood");
    expect(wildwood?.harvest).toMatchObject({ itemDefinitionId: "item_wood", baseQuantity: 12 });
    expect(wildwood?.harvest.baseQuantity).toBeGreaterThan(FORESTRY_CONSTRUCTION_DEFINITIONS["world.tree_broad"].dropQuantity);
  });

  it("keeps wood at one gold and makes the specialist tree win on output per interaction", () => {
    const woodPrice = shopRegistry.get("shop_wood")?.sellPrice ?? 0;
    expect(woodPrice).toBe(1);

    const ordinary = [
      { id: "world.tree_broad", regenerationSeconds: 720, operationsPerHour: 5, goldPerHour: 10 },
      { id: "world.tree_pine", regenerationSeconds: 900, operationsPerHour: 4, goldPerHour: 8 }
    ] as const;
    for (const rate of ordinary) {
      const definition = FORESTRY_CONSTRUCTION_DEFINITIONS[rate.id];
      expect(3600 / definition.regenerationSeconds).toBe(rate.operationsPerHour);
      expect((3600 / definition.regenerationSeconds) * definition.dropQuantity * woodPrice).toBe(rate.goldPerHour);
    }

    const wildwood = treeRegistry.get("tree_wildwood");
    const sapling = shopRegistry.get("shop_wildwood_sapling");
    expect(wildwood?.regrowSeconds).toBe(3600);
    expect(wildwood?.harvest.baseQuantity).toBe(12);
    expect((wildwood?.harvest.baseQuantity ?? 0) * woodPrice).toBe(12);
    expect(sapling?.buyPrice).toBe(3);
    expect((wildwood?.harvest.baseQuantity ?? 0) * woodPrice - (sapling?.buyPrice ?? 0)).toBe(9);
  });

  it("does not create a second wood item or shop row", () => {
    expect([...itemRegistry.values()].filter((item) => item.id === "item_wood")).toHaveLength(1);
    expect([...shopRegistry.values()].filter((entry) => entry.itemDefinitionId === "item_wood")).toHaveLength(1);
    expect([...shopRegistry.values()].filter((entry) => entry.id === "shop_wood")).toHaveLength(1);
  });
});

