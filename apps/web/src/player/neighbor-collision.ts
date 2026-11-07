import { PLAYER_RADIUS } from "./controller";
import { neighborLandDepth, neighborWaterDepth, type NeighborIslandTemplate } from "../render/neighbor-island-template";

/** Convert the normalized neighbour shore depth into the world-space value used by CollisionWorld. */
export function neighborLandCollisionDepth(template: NeighborIslandTemplate, localX: number, localZ: number): number {
  const worldScale = Math.min(template.radiusX, template.radiusZ);
  return PLAYER_RADIUS + neighborLandDepth(template, localX, localZ) * worldScale;
}

/** Complete terrain veto for an active neighbour island, including authored water channels. */
export function neighborTerrainCollisionDepth(template: NeighborIslandTemplate, localX: number, localZ: number): number {
  return Math.max(
    neighborLandCollisionDepth(template, localX, localZ),
    neighborWaterDepth(template, localX, localZ) > 0.22 ? 1.2 : 0
  );
}
