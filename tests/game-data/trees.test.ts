import { describe, expect, it } from "vitest";
import {
  createTreeRegistry,
  itemRegistry,
  shops,
  treeRegistry,
  trees,
  validateTreeItemReferences,
  type TreeDefinitionData
} from "@happy-farm/game-data";

const APPLE_SAPLING = "item_apple_sapling";

/** A well-formed definition the failure cases mutate one field at a time. */
const VALID: TreeDefinitionData = {
  id: "tree_pear",
  displayNameKey: "tree.pear.name",
  saplingItemDefinitionId: "item_apple_sapling",
  firstReadySeconds: 3600,
  regrowSeconds: 900,
  growthStages: 4,
  harvest: { itemDefinitionId: "item_apple", baseQuantity: 3, xp: 10 }
};

describe("tree catalogue", () => {
  it("ships a tree whose sapling and fruit are real, correctly categorised items", () => {
    expect(trees.length).toBeGreaterThanOrEqual(1);
    for (const tree of trees) {
      const sapling = itemRegistry.get(tree.saplingItemDefinitionId);
      const fruit = itemRegistry.get(tree.harvest.itemDefinitionId);
      expect(sapling?.category, tree.id).toBe("SEED");
      expect(fruit?.category, tree.id).toBe("CROP");
      expect(tree.firstReadySeconds).toBeGreaterThan(0);
      expect(tree.regrowSeconds).toBeGreaterThan(0);
      expect(tree.growthStages).toBeGreaterThanOrEqual(2);
      expect(tree.harvest.baseQuantity).toBeGreaterThan(0);
      expect(tree.harvest.xp).toBeGreaterThan(0);
      expect((tree.requiredLevel ?? 1)).toBeLessThanOrEqual(10_000);
    }
  });

  it("gives every tree its own sapling, so a planting is never ambiguous", () => {
    const saplings = trees.map((tree) => tree.saplingItemDefinitionId);
    expect(new Set(saplings).size).toBe(saplings.length);
    expect(treeRegistry.size).toBe(trees.length);
  });

  it("refuses a catalogue a planting or a harvest could not settle", () => {
    expect(() => createTreeRegistry([VALID, VALID])).toThrow("Duplicate tree definition");
    for (const definition of [
      { ...VALID, id: "crop_pear" },
      { ...VALID, firstReadySeconds: 0 },
      { ...VALID, regrowSeconds: -1 },
      { ...VALID, growthStages: 1 },
      { ...VALID, harvest: { ...VALID.harvest, baseQuantity: 0 } },
      { ...VALID, harvest: { ...VALID.harvest, xp: 0 } },
      { ...VALID, requiredLevel: 10_001 }
    ]) {
      expect(() => createTreeRegistry([definition])).toThrow();
    }
  });

  it("refuses cross-references that are missing or the wrong item kind", () => {
    const unknownSapling = createTreeRegistry([{ ...VALID, saplingItemDefinitionId: "item_missing" }]);
    expect(() => { validateTreeItemReferences(unknownSapling, itemRegistry); }).toThrow(
      "Unknown sapling item definition"
    );

    // An apple sapling is a real item, but a tree cannot harvest a seed.
    const seedFruit = createTreeRegistry([{ ...VALID, harvest: { ...VALID.harvest, itemDefinitionId: APPLE_SAPLING } }]);
    expect(() => { validateTreeItemReferences(seedFruit, itemRegistry); }).toThrow(
      "Unknown harvest item definition"
    );

    // A fruit that is not an item at all is refused the same way.
    const unknownFruit = createTreeRegistry([{ ...VALID, harvest: { ...VALID.harvest, itemDefinitionId: "item_missing" } }]);
    expect(() => { validateTreeItemReferences(unknownFruit, itemRegistry); }).toThrow(
      "Unknown harvest item definition"
    );

    // Two trees sharing one sapling would leave a planting unable to say what it paid for.
    const shared = createTreeRegistry([
      { ...VALID, id: "tree_pear" },
      { ...VALID, id: "tree_plum" }
    ]);
    expect(() => { validateTreeItemReferences(shared, itemRegistry); }).toThrow(
      "Duplicate sapling item reference"
    );
  });

  it("prices a tree so that two harvests repay its sapling and nothing is arbitraged", () => {
    for (const tree of trees) {
      const saplingEntry = shops.find((entry) => entry.itemDefinitionId === tree.saplingItemDefinitionId);
      const fruitEntry = shops.find((entry) => entry.itemDefinitionId === tree.harvest.itemDefinitionId);
      expect(saplingEntry?.buyPrice, tree.id).toBeDefined();
      expect(saplingEntry?.sellPrice, tree.id).toBeUndefined();
      expect(fruitEntry?.sellPrice, tree.id).toBeDefined();
      expect(fruitEntry?.buyPrice, tree.id).toBeUndefined();
      // A repeating producer may take more than one cycle to pay for itself, but not more than two:
      // a price edit that made trees a trap for the player fails here instead of in play.
      expect(
        (fruitEntry?.sellPrice ?? 0) * tree.harvest.baseQuantity * 2,
        tree.id
      ).toBeGreaterThanOrEqual(saplingEntry?.buyPrice ?? Number.MAX_SAFE_INTEGER);
    }
  });
});
