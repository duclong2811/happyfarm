import { describe, expect, it } from "vitest";
import {
  resourceClusterPieces,
  resourceNodeCollisionObstacles,
  resourceNodePickRadius
} from "../../apps/web/src/render/resource-cluster";

const ore = {
  id: "node_stone_ridge",
  definitionId: "resource_ore",
  worldX: 7.02,
  worldZ: -18.9
} as const;

describe("unified ore presentation footprint", () => {
  it("keeps one node identity while drawing a recognisable cluster", () => {
    const pieces = resourceClusterPieces(ore);

    expect(pieces).toHaveLength(3);
    expect(Math.max(...pieces.map((piece) => piece.scale))).toBeGreaterThan(2);
    expect(resourceNodePickRadius(ore)).toBeGreaterThan(2);
  });

  it("leaves the authoritative work point open while blocking the side rocks", () => {
    const obstacles = resourceNodeCollisionObstacles(ore);

    expect(obstacles).toHaveLength(2);
    for (const obstacle of obstacles) {
      const distance = Math.hypot(
        obstacle.centerWorldX - ore.worldX,
        obstacle.centerWorldZ - ore.worldZ
      );
      expect(distance).toBeGreaterThan(obstacle.radiusWorld + 0.3);
      expect(obstacle.id).toContain(ore.id);
    }
  });

  it("does not turn unrelated resource props into mine collision", () => {
    expect(resourceClusterPieces({ definitionId: "resource_wood" })).toHaveLength(1);
    expect(resourceNodePickRadius({ definitionId: "resource_wood" })).toBe(1.14);
    expect(resourceNodeCollisionObstacles({ ...ore, definitionId: "resource_wood" })).toHaveLength(0);
  });
});
