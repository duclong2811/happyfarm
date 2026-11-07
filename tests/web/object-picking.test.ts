import { describe, expect, it } from "vitest";
import {
  FISHING_SPOT_ID_KEY,
  RESOURCE_NODE_ID_KEY,
  constructionIdFromWorldPoint,
  prioritizeWorldPick,
  worldTargetIdFromNode
} from "../../apps/web/src/render/object-picking";

interface TestNode {
  readonly userData: Record<string, unknown>;
  readonly parent: TestNode | null;
}

function node(userData: Record<string, unknown>, parent: TestNode | null = null): TestNode {
  return { userData, parent };
}

describe("direct world target picking metadata", () => {
  it("keeps a placed world object on its management panel when the direct mesh is hit", () => {
    expect(
      prioritizeWorldPick({
        directWorldTarget: null,
        directConstructionId: "tree-broad-1",
        fallbackWorldTarget: { kind: "RESOURCE_NODE", id: "node_wildwood_start_1" },
        fallbackConstructionId: "tree-broad-1"
      })
    ).toEqual({ kind: "CONSTRUCTION", id: "tree-broad-1" });
  });

  it("selects a Wildwood resource when its direct mesh is hit", () => {
    expect(
      prioritizeWorldPick({
        directWorldTarget: { kind: "RESOURCE_NODE", id: "node_wildwood_start_1" },
        directConstructionId: "tree-broad-1",
        fallbackWorldTarget: { kind: "RESOURCE_NODE", id: "node_wildwood_start_1" },
        fallbackConstructionId: "tree-broad-1"
      })
    ).toEqual({ kind: "RESOURCE_NODE", id: "node_wildwood_start_1" });
  });

  it("keeps a late resource model selectable through ground fallback near a world object", () => {
    expect(
      prioritizeWorldPick({
        directWorldTarget: null,
        directConstructionId: null,
        fallbackWorldTarget: { kind: "RESOURCE_NODE", id: "node_wildwood_start_1" },
        fallbackConstructionId: "tree-broad-1"
      })
    ).toEqual({ kind: "RESOURCE_NODE", id: "node_wildwood_start_1" });
  });

  it("resolves a construction footprint while its async model is not loaded", () => {
    expect(
      constructionIdFromWorldPoint(
        { worldX: 10.2, worldZ: 20.1 },
        [{ id: "cage-1", worldX: 10, worldZ: 20, widthCells: 1, depthCells: 1 }],
        1
      )
    ).toBe("cage-1");
    expect(
      constructionIdFromWorldPoint(
        { worldX: 11.2, worldZ: 20.1 },
        [{ id: "cage-1", worldX: 10, worldZ: 20, widthCells: 1, depthCells: 1 }],
        1
      )
    ).toBeNull();
  });

  it("resolves a resource node id through a GLB child hierarchy", () => {
    const root = node({ [RESOURCE_NODE_ID_KEY]: "node_stone_ridge" });
    const child = node({}, root);
    expect(worldTargetIdFromNode(child, RESOURCE_NODE_ID_KEY)).toBe("node_stone_ridge");
  });

  it("keeps fishing spot ids separate from resource node ids", () => {
    const resource = node({ [RESOURCE_NODE_ID_KEY]: "node_wildwood_north_1" });
    const fishing = node({ [FISHING_SPOT_ID_KEY]: "spot_pond_north" });
    expect(worldTargetIdFromNode(resource, FISHING_SPOT_ID_KEY)).toBeNull();
    expect(worldTargetIdFromNode(fishing, FISHING_SPOT_ID_KEY)).toBe("spot_pond_north");
  });

  it("does not resolve empty or unrelated metadata", () => {
    const root = node({ [RESOURCE_NODE_ID_KEY]: "" });
    const child = node({ other: "not-a-target" }, root);
    expect(worldTargetIdFromNode(child, RESOURCE_NODE_ID_KEY)).toBeNull();
  });
});
