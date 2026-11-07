import { describe, expect, it } from "vitest";
import type { ResourceActionDTO, ResourceNodeDTO, TreeDefinitionDTO, TreeStateDTO } from "@happy-farm/contracts";
import { plantedForestryPanelState, resourcePanelState } from "../../apps/web/src/forestry/panel";

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

function activeAction(overrides: Partial<ResourceActionDTO> = {}): ResourceActionDTO {
  return {
    actionId: "resact_11111111-1111-4111-8111-111111111111",
    zone: { kind: "HOME_ISLAND", zoneId: "farm_11111111-1111-4111-8111-111111111111" },
    nodeId: "node_wildwood_north_1",
    definitionId: "resource_wildwood",
    verb: "CHOP",
    status: "ACTIVE",
    startedAt: "2026-10-15T00:00:00.000Z",
    readyAt: "2026-10-15T00:00:05.000Z",
    secondsUntilReady: 5,
    version: 1,
    ...overrides
  };
}

describe("Forestry resource panel state", () => {
  it("shows the tree type, product, level and CHOP action without inventing authority", () => {
    expect(resourcePanelState(node({ requiredLevel: 3 }), null, true)).toEqual(expect.objectContaining({
      profession: "FORESTRY",
      displayNameKey: "resource.wildwood.name",
      productItemDefinitionId: "item_wood",
      productDisplayKey: "item.wood.name",
      requiredLevel: 3,
      status: "READY",
      action: "CHOP",
      inRange: true,
      readyAt: null
    }));
  });

  it("keeps CHOP visible but explains that the player must move closer", () => {
    expect(resourcePanelState(node(), null, false)).toMatchObject({
      profession: "FORESTRY",
      status: "READY",
      action: "CHOP",
      inRange: false
    });
  });

  it("replaces CHOP with a regeneration state after the server depletes the node", () => {
    expect(resourcePanelState(node({ available: false, secondsUntilAvailable: 42, availableAt: "2026-10-15T00:00:42.000Z" }), null, false)).toMatchObject({
      status: "REGENERATING",
      action: null,
      secondsUntilReady: 42,
      inRange: false
    });
  });

  it("shows an active server settlement as working rather than offering a second chop", () => {
    expect(resourcePanelState(node(), activeAction(), true)).toMatchObject({
      status: "WORKING",
      action: null,
      secondsUntilReady: 5,
      readyAt: "2026-10-15T00:00:05.000Z"
    });
  });

  it("keeps a mining node on the separate Mining profession panel", () => {
    expect(resourcePanelState(node({
      nodeId: "node_stone_ridge",
      definitionId: "resource_stone",
      displayNameKey: "resource.stone.name",
      verb: "MINE",
      modelId: "resource_stone",
      depletedModelId: null,
      dropItemDefinitionId: "item_stone",
      requiredLevel: 1,
      actionSeconds: 6,
      interactionRadiusTiles: 3
    }), null, true)).toMatchObject({
      profession: "MINING",
      displayNameKey: "resource.stone.name",
      productItemDefinitionId: "item_stone",
      status: "READY",
      action: "MINE",
      inRange: true
    });
  });

  it("uses the server growth timestamp for a planted Wildwood tree", () => {
    const definition: TreeDefinitionDTO = {
      treeDefinitionId: "tree_wildwood",
      displayNameKey: "tree.wildwood.name",
      saplingItemDefinitionId: "item_wildwood_sapling",
      saplingItemDisplayNameKey: "item.wildwood_sapling.name",
      firstReadySeconds: 3600,
      regrowSeconds: 3600,
      growthStages: 4,
      harvestItemDefinitionId: "item_wood",
      baseQuantity: 12,
      harvestXp: 0,
      requiredLevel: 1
    };
    const tree: TreeStateDTO = {
      treeInstanceId: "treeinst_wildwood_1",
      definitionId: "tree_wildwood",
      tileX: -2,
      tileY: 12,
      plantedAt: "2026-10-15T00:00:00.000Z",
      lastHarvestedAt: null,
      readyAt: "2026-10-15T01:00:00.000Z",
      secondsUntilReady: 3600,
      ready: false,
      phase: "GROWING",
      growthStage: 1,
      growthProgress: 0.2,
      version: 4
    };
    expect(plantedForestryPanelState(tree, definition, false)).toMatchObject({
      origin: "PLANTED",
      status: "GROWING",
      action: null,
      secondsUntilReady: 3600,
      readyAt: tree.readyAt,
      needsCleanup: false
    });
  });

  it("offers Chop only when ready and shows cleanup without a fake regrowth timer after Wildwood", () => {
    const definition: TreeDefinitionDTO = {
      treeDefinitionId: "tree_wildwood",
      displayNameKey: "tree.wildwood.name",
      saplingItemDefinitionId: "item_wildwood_sapling",
      saplingItemDisplayNameKey: "item.wildwood_sapling.name",
      firstReadySeconds: 3600,
      regrowSeconds: 3600,
      growthStages: 4,
      harvestItemDefinitionId: "item_wood",
      baseQuantity: 12,
      harvestXp: 0,
      requiredLevel: 1
    };
    const ready: TreeStateDTO = {
      treeInstanceId: "treeinst_wildwood_ready",
      definitionId: "tree_wildwood",
      tileX: 0,
      tileY: 0,
      plantedAt: "2026-10-15T00:00:00.000Z",
      lastHarvestedAt: null,
      readyAt: "2026-10-15T00:00:00.000Z",
      secondsUntilReady: 0,
      ready: true,
      phase: "READY",
      growthStage: 4,
      growthProgress: 1,
      version: 2
    };
    const depleted: TreeStateDTO = { ...ready, treeInstanceId: "treeinst_wildwood_depleted", ready: false, phase: "DEPLETED", readyAt: null };
    expect(plantedForestryPanelState(ready, definition, true)).toMatchObject({ status: "READY", action: "CHOP", readyAt: null, needsCleanup: false });
    expect(plantedForestryPanelState(depleted, definition, false)).toMatchObject({ status: "DEPLETED", action: null, readyAt: null, secondsUntilReady: 0, needsCleanup: true });
  });
});
