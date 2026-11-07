import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  CropDefinitionDTO,
  InventoryEntryDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import {
  inventoryCards,
  inventoryCategoryCounts,
  inventoryCategoryOf,
  inventoryTabs,
  visibleInventoryCards
} from "../../apps/web/src/items/catalogue";
import { cropVisualFor, itemVisualFor } from "../../apps/web/src/items/visuals";
import { ITEM_THUMBNAIL_MAP } from "../../apps/web/src/items/item-thumbnail-map";
import { shops } from "@happy-farm/game-data";

/**
 * What the inventory shelf shows, and what picture each card gets.
 *
 * The rules here are the ones a player would notice going wrong: an inventory full of things they do
 * not own, a seed counted as produce, a level-locked crop's card blaming the wrong thing, a picture
 * that regenerates instead of being reused. All of it is pure, so all of it is asserted here rather
 * than discovered by tapping.
 */

const CROPS: readonly CropDefinitionDTO[] = [
  {
    cropDefinitionId: "crop_carrot",
    displayNameKey: "crop.carrot.name",
    growthDurationSeconds: 300,
    seedItemDefinitionId: "item_carrot_seed",
    seedItemDisplayNameKey: "item.carrot_seed.name",
    harvestItemDefinitionId: "item_carrot",
    baseQuantity: 2,
    harvestXp: 1,
    requiredLevel: 1
  },
  {
    cropDefinitionId: "crop_corn",
    displayNameKey: "crop.corn.name",
    growthDurationSeconds: 900,
    seedItemDefinitionId: "item_corn_seed",
    seedItemDisplayNameKey: "item.corn_seed.name",
    harvestItemDefinitionId: "item_corn",
    baseQuantity: 3,
    harvestXp: 2,
    requiredLevel: 2
  }
];

const TREES: readonly TreeDefinitionDTO[] = [
  {
    treeDefinitionId: "tree_apple",
    displayNameKey: "tree.apple.name",
    saplingItemDefinitionId: "item_apple_sapling",
    saplingItemDisplayNameKey: "item.apple_sapling.name",
    firstReadySeconds: 3600,
    regrowSeconds: 600,
    growthStages: 3,
    harvestItemDefinitionId: "item_apple",
    baseQuantity: 3,
    harvestXp: 4,
    requiredLevel: 1
  }
];

function row(
  itemDefinitionId: string,
  category: "CROP" | "SEED",
  quantity: number
): InventoryEntryDTO {
  return { itemDefinitionId, displayNameKey: `item.${itemDefinitionId}.name`, category, quantity };
}

describe("the inventory shelf", () => {
  const inventory: readonly InventoryEntryDTO[] = [
    row("item_carrot", "CROP", 35),
    row("item_corn", "CROP", 60),
    row("item_carrot_seed", "SEED", 39),
    row("item_corn_seed", "SEED", 8),
    row("item_apple_sapling", "SEED", 2),
    row("item_apple", "CROP", 0)
  ];
  const cards = inventoryCards({ inventory, cropDefinitions: CROPS, treeDefinitions: TREES });

  it("shows what the player owns and nothing else", () => {
    // Six rows, five with something in them: a zero-quantity row is a database fact, not a shelf item.
    expect(cards.map((card) => card.itemDefinitionId)).toEqual([
      "item_carrot",
      "item_corn",
      "item_carrot_seed",
      "item_corn_seed",
      "item_apple_sapling"
    ]);
    expect(cards.every((card) => card.quantity > 0)).toBe(true);
  });

  it("separates produce, seeds and saplings by what the catalogues say they are", () => {
    const byId = new Map(cards.map((card) => [card.itemDefinitionId, card.category]));
    expect(byId.get("item_carrot")).toBe("PRODUCE");
    expect(byId.get("item_corn")).toBe("PRODUCE");
    expect(byId.get("item_carrot_seed")).toBe("SEEDS");
    expect(byId.get("item_apple_sapling")).toBe("SAPLINGS");
    // A sapling is a `SEED` on the wire and a sapling to a player: the catalogue decides, not the
    // category string.
    expect(inventoryCategoryOf("item_apple_sapling", "SEED", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBe("SAPLINGS");
    expect(inventoryCategoryOf("item_carrot_seed", "SEED", { cropDefinitions: CROPS, treeDefinitions: TREES })).toBe("SEEDS");
  });

  it("offers a tab per category that has something in it, and always All", () => {
    expect(inventoryTabs(cards)).toEqual(["ALL", "PRODUCE", "SEEDS", "SAPLINGS"]);
    // A farm with only seeds gets no empty produce tab to stare at.
    const seedsOnly = inventoryCards({
      inventory: [row("item_carrot_seed", "SEED", 3)],
      cropDefinitions: CROPS,
      treeDefinitions: TREES
    });
    expect(inventoryTabs(seedsOnly)).toEqual(["ALL", "SEEDS"]);
    expect(inventoryCategoryCounts(seedsOnly)).toEqual({
      ALL: 1,
      PRODUCE: 0,
      FISH: 0,
      MATERIALS: 0,
      SEEDS: 1,
      SAPLINGS: 0
    });
  });

  it("filters to a category without changing what the cards say", () => {
    const seeds = visibleInventoryCards(cards, "SEEDS");
    expect(seeds.map((card) => card.itemDefinitionId)).toEqual(["item_carrot_seed", "item_corn_seed"]);
    expect(seeds[0]?.quantity).toBe(39);
    expect(visibleInventoryCards(cards, "ALL")).toHaveLength(cards.length);
  });

  it("sums duplicate rows for one item rather than showing the same pile twice", () => {
    const stacked = inventoryCards({
      inventory: [row("item_carrot", "CROP", 35), row("item_carrot", "CROP", 5)],
      cropDefinitions: CROPS,
      treeDefinitions: TREES
    });
    expect(stacked).toHaveLength(1);
    expect(stacked[0]?.quantity).toBe(40);
  });

  it("follows the server's numbers after a refresh, with no client copy of its own", () => {
    // The same function over the rows the server sends after a harvest: the shelf is a projection, so
    // there is nothing to keep in step.
    const before = inventoryCards({ inventory, cropDefinitions: CROPS, treeDefinitions: TREES });
    const after = inventoryCards({
      inventory: inventory.map((entry) =>
        entry.itemDefinitionId === "item_carrot" ? { ...entry, quantity: entry.quantity + 2 } : entry
      ),
      cropDefinitions: CROPS,
      treeDefinitions: TREES
    });
    expect(before.find((card) => card.itemDefinitionId === "item_carrot")?.quantity).toBe(35);
    expect(after.find((card) => card.itemDefinitionId === "item_carrot")?.quantity).toBe(37);
  });
});

describe("thumbnails and their fallbacks", () => {
  it("asks for the crop's own model as produce", () => {
    const visual = itemVisualFor("item_carrot", { cropDefinitions: CROPS, treeDefinitions: TREES });
    expect(visual.request.modelId).toBe("crop_carrot");
    expect(visual.key).toBe("model:crop_carrot");
    expect(visual.fallback).toBe("PRODUCE");
  });

  it("keys a picture by the model, so the same crop is one cached draw everywhere", () => {
    const fromItem = itemVisualFor("item_carrot", { cropDefinitions: CROPS, treeDefinitions: TREES });
    const fromPicker = cropVisualFor("crop_carrot");
    expect(fromItem.key).toBe(fromPicker.key);
    expect(fromItem.request).toEqual(fromPicker.request);
  });

  it("uses item-specific transparent art where no GLB exists", () => {
    // Seeds and saplings are not represented by mature GLBs, so each gets its own Vite asset rather
    // than sharing a generic seed icon.
    const seed = itemVisualFor("item_carrot_seed", { cropDefinitions: CROPS, treeDefinitions: TREES });
    expect(seed.request.modelId).toBeNull();
    expect(seed.request.imageUrl).toBeTruthy();
    expect(seed.key).toBe("image:seed_carrot");
    const cornSeed = itemVisualFor("item_corn_seed", { cropDefinitions: CROPS, treeDefinitions: TREES });
    expect(cornSeed.request.imageUrl).toBeTruthy();
    expect(cornSeed.key).toBe("image:seed_corn");

    const sapling = itemVisualFor("item_apple_sapling", { cropDefinitions: CROPS, treeDefinitions: TREES });
    expect(sapling.request.modelId).toBeNull();
    expect(sapling.request.imageUrl).toBeTruthy();
    expect(sapling.key).toBe("image:sapling_apple");
  });

  it("gives an item this build has never heard of a sized, deterministic placeholder", () => {
    const unknown = itemVisualFor("item_future_thing", { cropDefinitions: CROPS, treeDefinitions: TREES });
    expect(unknown.key).toBe("fallback:ITEM");
    expect(unknown.request).toEqual({ modelId: null, roadTierId: null });
  });

  it("keeps every known planting input on its own art key", () => {
    const visuals = ["item_carrot", "item_corn", "item_carrot_seed", "item_corn_seed", "item_apple_sapling"].map(
      (id) => itemVisualFor(id, { cropDefinitions: CROPS, treeDefinitions: TREES })
    );
    expect(visuals.map((visual) => visual.key)).toEqual([
      "model:crop_carrot",
      "model:crop_corn",
      "image:seed_carrot",
      "image:seed_corn",
      "image:sapling_apple"
    ]);
  });

  it("covers every Shop item with an explicit, decodable thumbnail source", () => {
    const shopItemIds = [...new Set(shops.map((entry) => entry.itemDefinitionId))].sort();
    expect(Object.keys(ITEM_THUMBNAIL_MAP).sort()).toEqual(shopItemIds);
    const assetRoot = fileURLToPath(new URL("../../apps/web/src/assets/", import.meta.url));
    for (const itemId of shopItemIds) {
      const spec = ITEM_THUMBNAIL_MAP[itemId];
      if (spec === undefined) throw new Error(`missing thumbnail mapping for ${itemId}`);
      if (spec.kind === "IMAGE") {
        const path = `${assetRoot}/items/${spec.assetName}.svg`;
        expect(existsSync(path), itemId).toBe(true);
        const source = readFileSync(path, "utf8");
        expect(source, itemId).toMatch(/^<svg\b/);
        expect(source, itemId).toContain("viewBox=");
        expect(source, itemId).not.toMatch(/<text\b/);
      } else {
        const path = spec.modelId.startsWith("crop_")
          ? `${assetRoot}/models/${spec.modelId}.glb`
          : spec.modelId.startsWith("fish_")
            ? `${assetRoot}/models/fishing/${spec.modelId}.glb`
            : `${assetRoot}/models/resources/${spec.modelId}.glb`;
        expect(existsSync(path), itemId).toBe(true);
        expect(statSync(path).size, itemId).toBeGreaterThan(32);
        expect([...readFileSync(path).subarray(0, 4)], itemId).toEqual([103, 108, 84, 70]);
      }
    }
  });

  it("uses one itemId thumbnail in both directions and separates fingerling from adult fish", () => {
    const catalogues = { cropDefinitions: CROPS, treeDefinitions: TREES, fish: [], resourceNodes: [] };
    const fingerling = itemVisualFor("item_fish_tilapia", catalogues);
    const adult = itemVisualFor("item_fish_tilapia_adult", catalogues);
    expect(fingerling.key).toBe("image:fish_tilapia_fingerling");
    expect(adult.key).toBe("model:fish_tilapia");
    expect(fingerling.key).not.toBe(adult.key);
  });
});

describe("the item presentation performance contract", () => {
  const ITEMS_DIR = fileURLToPath(new URL("../../apps/web/src/items", import.meta.url));
  const sources = readdirSync(ITEMS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(`${ITEMS_DIR}/${name}`, "utf8") }));

  it("browses items without touching the network or the clock", () => {
    for (const source of sources) {
      for (const forbidden of ["fetch(", "XMLHttpRequest", "requestAnimationFrame", "setInterval", "Date.now"]) {
        expect(source.text.includes(forbidden), `${source.name} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("has exactly one thumbnail pipeline in the application", () => {
    // One renderer, one cache: the shop, the inventory, the picker and the reward pop all come through
    // `items/thumbnails.ts`. A second `createThumbnailRenderer` call anywhere in the app would be a
    // second WebGL context and a second copy of every picture.
    const web = fileURLToPath(new URL("../../apps/web/src", import.meta.url));
    const callers: string[] = [];
    // This is a documented dev-only page entrypoint, not an application module. It may reuse the
    // renderer for QA without creating a second production thumbnail pipeline.
    const devOnlyEntryPoints = new Set(["moc-asset-contact-sheet.ts"]);
    for (const name of readdirSync(web, { recursive: true })) {
      const path = `${web}/${String(name)}`;
      if (!String(name).endsWith(".ts")) continue;
      if (devOnlyEntryPoints.has(String(name).split("\\").join("/"))) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes("createThumbnailRenderer(")) callers.push(String(name).split("\\").join("/"));
    }
    expect(callers.sort()).toEqual(["items/thumbnails.ts", "render/thumbnail.ts"]);
  });
});
