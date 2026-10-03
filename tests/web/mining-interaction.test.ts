import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResourceNodeDTO } from "@happy-farm/contracts";
import { resourceDefinitions } from "@happy-farm/game-data";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { resourceModelUrl } from "../../apps/web/src/render/model-urls";
import { INTERACTION_RANGE_WORLD, interactionPromptFor } from "../../apps/web/src/interaction/model";
import {
  buildInteractionIndex,
  type InteractionWorldInput
} from "../../apps/web/src/interaction/registry";
import {
  interactionActivation,
  selectInteractionCandidate
} from "../../apps/web/src/interaction/selection";
import { inventoryCards, inventoryTabs } from "../../apps/web/src/items/catalogue";

/**
 * Mining as Character gameplay, and the generic node shape behind it.
 *
 * An available deposit is an ordinary interaction target whose verb comes from its definition; a
 * depleted one offers only a look, with the server's own countdown. The last case uses a `CHOP` node -
 * which no shipped content declares - to show that nothing in the interaction layer knows what a rock
 * is, which is what forestry will rely on.
 */

function node(overrides: Partial<ResourceNodeDTO> = {}): ResourceNodeDTO {
  return {
    nodeId: "node_stone_ridge",
    definitionId: "resource_stone",
    displayNameKey: "resource.stone.name",
    verb: "MINE",
    zoneKind: "HOME_ISLAND",
    position: { x: 12, y: -12 },
    interactionRadiusTiles: 3,
    actionSeconds: 6,
    modelId: "resource_stone",
    depletedModelId: null,
    dropItemDefinitionId: "item_stone",
    requiredLevel: 1,
    availableAt: null,
    secondsUntilAvailable: 0,
    available: true,
    ...overrides
  };
}

function world(nodes: readonly ResourceNodeDTO[]): InteractionWorldInput {
  return {
    crops: [],
    trees: [],
    constructions: [],
    cropDefinitions: [],
    treeDefinitions: [],
    worldObjects: new Map(),
    buildCatalog: [],
    resourceNodes: nodes,
    nowMs: 0
  };
}

function candidateFor(entry: ResourceNodeDTO) {
  const index = buildInteractionIndex(world([entry]));
  const at = tileToWorld(entry.position, worldFrame());
  return selectInteractionCandidate(index, { worldX: at.worldX, worldZ: at.worldZ, facingYaw: 0 });
}

describe("resource nodes in the interaction system", () => {
  it("offers the definition's verb on an available node", () => {
    const candidate = candidateFor(node());
    expect(candidate).toMatchObject({
      key: "resource:node_stone_ridge",
      kind: "RESOURCE_NODE",
      action: "MINE",
      nameKey: "resource.stone.name",
      readyInSeconds: null
    });
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.mine");
    expect(interactionActivation(candidate, candidate)).toMatchObject({
      kind: "GATHER",
      nodeId: "node_stone_ridge",
      verb: "MINE"
    });
  });

  it("offers only a look at a depleted node, with the server's countdown", () => {
    const depleted = node({ available: false, availableAt: "2026-10-03T00:02:00.000Z", secondsUntilAvailable: 74 });
    const candidate = candidateFor(depleted);
    expect(candidate?.action).toBe("INSPECT");
    expect(candidate?.readyInSeconds).toBe(74);
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.inspect");
    expect(interactionActivation(candidate, candidate)).toMatchObject({ kind: "INSPECT" });
  });

  it("carries whatever verb the definition declares, so forestry is another value", () => {
    // No shipped content declares CHOP; this is the generic shape doing its job.
    const tree = node({ nodeId: "node_oak_wild", definitionId: "resource_wood", verb: "CHOP", modelId: "resource_stone" });
    const candidate = candidateFor(tree);
    expect(candidate?.action).toBe("CHOP");
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.chop");
    expect(interactionActivation(candidate, candidate)).toMatchObject({ kind: "GATHER", verb: "CHOP" });
  });

  it("is out of reach from across the island, like any other target", () => {
    const index = buildInteractionIndex(world([node()]));
    const at = tileToWorld(node().position, worldFrame());
    expect(
      selectInteractionCandidate(index, {
        worldX: at.worldX + INTERACTION_RANGE_WORLD.RESOURCE_NODE + 1,
        worldZ: at.worldZ,
        facingYaw: 0
      })
    ).toBeNull();
  });
});

describe("the resource model manifest", () => {
  const MODEL_DIRECTORY = fileURLToPath(new URL("../../apps/web/src/assets/models/resources/", import.meta.url));

  it("ships a model for every deposit definition", () => {
    for (const definition of resourceDefinitions) {
      expect(resourceModelUrl(definition.modelId), definition.id).toBeTypeOf("string");
      expect(existsSync(`${MODEL_DIRECTORY}${definition.modelId}.glb`), definition.modelId).toBe(true);
    }
  });

  it("answers null for a deposit this build has never heard of", () => {
    expect(resourceModelUrl("resource_mythril")).toBeNull();
    expect(resourceModelUrl(null)).toBeNull();
  });
});

describe("mined material in the inventory", () => {
  it("gets its own tab, and draws the deposit it came from", () => {
    const cards = inventoryCards({
      inventory: [
        { itemDefinitionId: "item_iron_ore", displayNameKey: "item.iron_ore.name", category: "MATERIAL", quantity: 4 }
      ],
      cropDefinitions: [],
      treeDefinitions: [],
      resourceNodes: [node({ nodeId: "node_iron_west", definitionId: "resource_iron", modelId: "resource_iron", dropItemDefinitionId: "item_iron_ore" })]
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.category).toBe("MATERIALS");
    expect(cards[0]?.visual.request.modelId).toContain("resource_iron");
    expect(inventoryTabs(cards)).toEqual(["ALL", "MATERIALS"]);
  });
});
