import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResourceNodeDTO, TreeStateDTO } from "@happy-farm/contracts";
import { resourceDefinitions } from "@happy-farm/game-data";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { resourceModelUrl } from "../../apps/web/src/render/model-urls";
import { interactionPromptFor } from "../../apps/web/src/interaction/model";
import { buildInteractionIndex, type InteractionWorldInput } from "../../apps/web/src/interaction/registry";
import { interactionActivation, selectInteractionCandidate } from "../../apps/web/src/interaction/selection";
import { inventoryCards, inventoryTabs } from "../../apps/web/src/items/catalogue";

/**
 * A wild tree in the interaction system, and the separation the phase exists to prove.
 *
 * The wild tree offers Chop through the same registry and selection a rock uses for Mine; an orchard
 * tree still offers Harvest and never Chop, even though both are trees; and the stump the server
 * reports draws from its own model.
 */

function node(overrides: Partial<ResourceNodeDTO> = {}): ResourceNodeDTO {
  return {
    nodeId: "node_wildwood_north_1",
    definitionId: "resource_wildwood",
    displayNameKey: "resource.wildwood.name",
    verb: "CHOP",
    zoneKind: "HOME_ISLAND",
    position: { x: -1, y: -19 },
    interactionRadiusTiles: 3.2,
    actionSeconds: 5,
    modelId: "resource_wildwood",
    depletedModelId: "resource_wildwood_stump",
    dropItemDefinitionId: "item_wood",
    requiredLevel: 1,
    availableAt: null,
    secondsUntilAvailable: 0,
    available: true,
    ...overrides
  };
}

function orchardTree(): TreeStateDTO {
  return {
    treeInstanceId: "treeinst_eeeeeeee-eeee-4eee-8eee-111111111111",
    definitionId: "tree_apple",
    tileX: 3,
    tileY: 2,
    plantedAt: "2026-10-03T00:00:00.000Z",
    lastHarvestedAt: null,
    readyAt: "2026-10-03T01:00:00.000Z",
    secondsUntilReady: 0,
    ready: true,
    phase: "READY",
    growthStage: 3,
    growthProgress: 1,
    version: 2
  };
}

function world(overrides: Partial<InteractionWorldInput> = {}): InteractionWorldInput {
  return {
    crops: [],
    trees: [],
    constructions: [],
    cropDefinitions: [],
    treeDefinitions: [
      {
        treeDefinitionId: "tree_apple",
        displayNameKey: "tree.apple.name",
        saplingItemDefinitionId: "item_apple_sapling",
        saplingItemDisplayNameKey: "item.apple_sapling.name",
        firstReadySeconds: 3600,
        regrowSeconds: 900,
        growthStages: 4,
        harvestItemDefinitionId: "item_apple",
        baseQuantity: 3,
        harvestXp: 9,
        requiredLevel: 3
      }
    ],
    worldObjects: new Map(),
    buildCatalog: [],
    resourceNodes: [],
    nowMs: 0,
    ...overrides
  };
}

function candidateFor(input: InteractionWorldInput, position: { x: number; y: number }) {
  const index = buildInteractionIndex(input);
  const at = tileToWorld(position, worldFrame());
  return selectInteractionCandidate(index, { worldX: at.worldX, worldZ: at.worldZ, facingYaw: 0 });
}

describe("wild trees in the interaction system", () => {
  it("offers Chop on an available tree, and a stump model when it is felled", () => {
    const candidate = candidateFor(world({ resourceNodes: [node()] }), node().position);
    expect(candidate).toMatchObject({ key: "resource:node_wildwood_north_1", action: "CHOP" });
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.chop");
    expect(interactionActivation(candidate, candidate)).toMatchObject({
      kind: "GATHER",
      nodeId: "node_wildwood_north_1",
      verb: "CHOP"
    });

    const stump = node({ available: false, secondsUntilAvailable: 60 });
    const felled = candidateFor(world({ resourceNodes: [stump] }), stump.position);
    expect(felled?.action).toBe("INSPECT");
    expect(felled?.readyInSeconds).toBe(60);
  });

  it("never offers Chop on an orchard tree: that is a farming entity", () => {
    const input = world({ trees: [orchardTree()] });
    const candidate = candidateFor(input, { x: 3, y: 2 });
    expect(candidate?.kind).toBe("TREE");
    expect(candidate?.action).toBe("HARVEST");
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.harvest");
    expect(interactionActivation(candidate, candidate)).toMatchObject({ kind: "HARVEST_TREE" });
  });
});

describe("the forestry model manifest", () => {
  const MODEL_DIRECTORY = fileURLToPath(new URL("../../apps/web/src/assets/models/resources/", import.meta.url));

  it("ships a model for every CHOP definition and its stump", () => {
    const forestry = resourceDefinitions.filter((definition) => definition.verb === "CHOP");
    expect(forestry).toHaveLength(3);
    for (const definition of forestry) {
      expect(resourceModelUrl(definition.modelId), definition.id).toBeTypeOf("string");
      expect(existsSync(`${MODEL_DIRECTORY}${definition.modelId}.glb`), definition.modelId).toBe(true);
      const stump = definition.depletedModelId ?? null;
      expect(stump, definition.id).not.toBeNull();
      expect(resourceModelUrl(stump), `${definition.id} stump`).toBeTypeOf("string");
      expect(existsSync(`${MODEL_DIRECTORY}${String(stump)}.glb`), String(stump)).toBe(true);
    }
  });
});

describe("wood in the inventory", () => {
  it("lands in the Materials tab and draws the tree it came from", () => {
    const cards = inventoryCards({
      inventory: [{ itemDefinitionId: "item_wood", displayNameKey: "item.wood.name", category: "MATERIAL", quantity: 6 }],
      cropDefinitions: [],
      treeDefinitions: [],
      resourceNodes: [node()]
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.category).toBe("MATERIALS");
    expect(cards[0]?.visual.request.modelId).toContain("resource_wildwood");
    expect(inventoryTabs(cards)).toEqual(["ALL", "MATERIALS"]);
  });
});
