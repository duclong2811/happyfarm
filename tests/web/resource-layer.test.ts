import { describe, expect, it } from "vitest";
import { resourceNodeLayerSignature, type ResourceLayerNode } from "../../apps/web/src/render/resource-layer";

const tree: ResourceLayerNode = {
  id: "resource-1",
  definitionId: "resource_wood",
  modelId: "resource_pine",
  depletedModelId: "resource_pine_stump",
  available: true
};

describe("resource layer model readiness", () => {
  it("invalidates the layer when a node model arrives late", () => {
    const pending = resourceNodeLayerSignature([tree], () => false);
    const ready = resourceNodeLayerSignature([tree], (modelId) => modelId === "resource_pine");

    expect(pending).not.toBe(ready);
  });

  it("keeps depleted nodes keyed to their stump model", () => {
    const depleted: ResourceLayerNode = { ...tree, available: false };
    const stumpPending = resourceNodeLayerSignature([depleted], () => false);
    const stumpReady = resourceNodeLayerSignature([depleted], (modelId) => modelId === "resource_pine_stump");

    expect(stumpPending).not.toBe(stumpReady);
    expect(stumpReady).toContain(":resource_pine_stump:ready");
  });
});
