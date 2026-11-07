/**
 * Presentation-only footprint for a resource node.
 *
 * The server still owns one node and one target. These helpers describe how that one target is
 * drawn and how the local walker keeps clear of it; they never create another production source.
 */
export interface ResourceClusterNode {
  readonly id: string;
  readonly definitionId: string;
  readonly worldX: number;
  readonly worldZ: number;
}

export interface ResourceClusterPiece {
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly scale: number;
  readonly rotationY: number;
}

/** One large face and two shoulders make the unified ore deposit read as a mine rather than a prop. */
const ORE_CLUSTER: readonly ResourceClusterPiece[] = [
  { offsetX: 0, offsetZ: 0.05, scale: 2.4, rotationY: 0.18 },
  { offsetX: -1.05, offsetZ: 0.22, scale: 1.55, rotationY: -0.32 },
  { offsetX: 0.98, offsetZ: 0.08, scale: 1.42, rotationY: 0.52 }
];

const SINGLE_NODE: readonly ResourceClusterPiece[] = [
  { offsetX: 0, offsetZ: 0, scale: 1, rotationY: 0 }
];

export function resourceClusterPieces(node: Pick<ResourceClusterNode, "definitionId">): readonly ResourceClusterPiece[] {
  return node.definitionId === "resource_ore" ? ORE_CLUSTER : SINGLE_NODE;
}

/** Ground hit-test radius, larger than the old one-model radius but still local to the node. */
export function resourceNodePickRadius(node: Pick<ResourceClusterNode, "definitionId">): number {
  return node.definitionId === "resource_ore" ? 2.55 : 1.14;
}

/**
 * Side rocks are solid; the authoritative node's centre remains the open work point.
 *
 * This is intentionally a few circles rather than a large enclosing circle: Auto Mining can still
 * approach the node, while a player cannot walk through the visible shoulders of the cluster.
 */
export function resourceNodeCollisionObstacles(
  node: ResourceClusterNode
): readonly {
  readonly id: string;
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly radiusWorld: number;
}[] {
  if (node.definitionId !== "resource_ore") return [];
  return [
    {
      id: `${node.id}:left-rock`,
      centerWorldX: node.worldX - 1.05,
      centerWorldZ: node.worldZ + 0.22,
      radiusWorld: 0.62
    },
    {
      id: `${node.id}:right-rock`,
      centerWorldX: node.worldX + 0.98,
      centerWorldZ: node.worldZ + 0.08,
      radiusWorld: 0.58
    }
  ];
}
