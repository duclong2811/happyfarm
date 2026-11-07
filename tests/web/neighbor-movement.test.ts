import { describe, expect, it } from "vitest";
import { neighborLandCollisionDepth, neighborTerrainCollisionDepth } from "../../apps/web/src/player/neighbor-collision";
import { neighborIslandTemplate, neighborLandDepth, neighborWorldPoint } from "../../apps/web/src/render/neighbor-island-template";

describe("active neighbour movement terrain", () => {
  it("keeps the valid beach walkable instead of treating normalized depth as metres", () => {
    const template = neighborIslandTemplate("MOC");
    const beach = neighborWorldPoint(template, { x: 0, z: 0 }, Math.PI, 0.99);
    const normalizedDepth = neighborLandDepth(template, beach.x, beach.z);
    expect(neighborLandCollisionDepth(template, beach.x, beach.z)).toBeLessThanOrEqual(0);
    expect(0.35 + normalizedDepth).toBeGreaterThan(0);
  });

  it("still blocks deep water outside the same outline", () => {
    const template = neighborIslandTemplate("MOC");
    const water = neighborWorldPoint(template, { x: 0, z: 0 }, Math.PI, 1.04);
    expect(neighborTerrainCollisionDepth(template, water.x, water.z)).toBeGreaterThan(0);
  });
});
