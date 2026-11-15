import { describe, expect, it } from "vitest";
import { buildIslandGround, classifyIslandTile, islandCellKindAt } from "@happy-farm/game-data";
import { buildIslandCellMap, buildIslandFarmWorld, islandSpawnWorld, type IslandGroundView } from "../../apps/web/src/render/island-world";
import { layoutFarmTiles, tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { islandRadiusAt, terrainHeightAt } from "../../apps/web/src/render/terrain-height";
import { createPlayerCollisionWorld, shoreDepthFor } from "../../apps/web/src/player/collision";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";

function stored(element: "THO" | "KIM" | "MOC" | "THUY" | "HOA", outline: "ROUND" | "ATOLL" | "TWIN", seed: number): IslandGroundView {
  const ground = buildIslandGround({ element, outline, seed });
  return { ...ground, sites: ground.sites.map((site) => ({ ...site })) };
}

describe("a chosen island in the renderer", () => {
  const layout = layoutFarmTiles([{ x: 0, y: 0 }]);
  const frame = worldFrame(layout.pitch);

  it("draws land where the stored ground is land, and sea where it is sea", () => {
    const ground = stored("THUY", "ATOLL", 4242);
    const world = buildIslandFarmWorld(layout, ground);
    let checked = 0;
    for (let y = ground.originY; y < ground.originY + ground.size; y += 3) {
      for (let x = ground.originX; x < ground.originX + ground.size; x += 3) {
        const kind = islandCellKindAt(ground, { x, y });
        const at = tileToWorld({ x, y }, frame);
        const radius = islandRadiusAt(at.worldX, at.worldZ, world.terrain);
        // The softened coast may move by a fraction of a cell; whole cells keep their side of it.
        const interior = [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => islandCellKindAt(ground, { x: x + dx, y: y + dy }) === kind));
        if (!interior) continue;
        if (kind === "DEEP" || kind === "SHALLOW") expect(radius).toBeGreaterThan(1);
        else expect(radius).toBeLessThan(1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("keeps workable ground level and lets only rock rise", () => {
    const ground = stored("KIM", "ROUND", 31);
    const world = buildIslandFarmWorld(layout, ground);
    let rose = 0;
    for (let y = ground.originY + 2; y < ground.originY + ground.size - 2; y += 1) {
      for (let x = ground.originX + 2; x < ground.originX + ground.size - 2; x += 1) {
        const kind = islandCellKindAt(ground, { x, y });
        const ring = [-2, -1, 0, 1, 2].every((dy) => [-2, -1, 0, 1, 2].every((dx) => islandCellKindAt(ground, { x: x + dx, y: y + dy }) === kind));
        if (!ring) continue;
        const at = tileToWorld({ x, y }, frame);
        const height = terrainHeightAt(at.worldX, at.worldZ, world.terrain);
        if (kind === "GRASS" || kind === "FIELD" || kind === "MEADOW" || kind === "FOREST") expect(height).toBe(0);
        if (kind === "ROCK" && height > 0.5) rose += 1;
      }
    }
    expect(rose).toBeGreaterThan(10);
  });

  it("builds a cell map that agrees with the server about what can be worked", () => {
    const ground = stored("KIM", "TWIN", 77);
    const world = buildIslandFarmWorld(layout, ground);
    const map = buildIslandCellMap({ layout, tiles: [], constructions: [], plantedTiles: [], scenery: [], roads: [] }, ground, world.terrain);
    let compared = 0;
    for (const cell of map.cells.values()) {
      const server = classifyIslandTile(ground, { x: cell.x, y: cell.z });
      const serverPlantable = server.terrain === "LAND" && !server.protectedGround;
      expect(cell.productionCapability === "CROP").toBe(serverPlantable);
      if (server.terrain === "WATER" && server.shallowWater) expect(cell.productionCapability).toBe("AQUACULTURE");
      if (server.terrain === "BLOCKED") expect(cell.capabilities).toContain("MINING");
      compared += 1;
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it("puts the character on dry land at the camp, inside the coast", () => {
    for (const element of ["THO", "KIM", "MOC", "THUY", "HOA"] as const) {
      const ground = stored(element, "ROUND", 5);
      const world = buildIslandFarmWorld(layout, ground);
      const spawn = islandSpawnWorld(ground, frame);
      const collision = createPlayerCollisionWorld([], [], {
        heightAt: () => 0,
        maxSlope: 1,
        maxStepWorld: 0.3,
        depthAt: shoreDepthFor(world.terrain),
        staticObstacles: []
      });
      expect(collision.depth(spawn.worldX, spawn.worldZ)).toBeLessThan(0);
      expect(collision.depth(world.terrain.centerWorldX + 500, world.terrain.centerWorldZ)).toBeGreaterThan(0);
    }
  });

  it("replaces the composed island in the scene input, and leaves it alone otherwise", () => {
    const ground = stored("MOC", "ROUND", 9);
    const base = { tiles: [], crops: [], trees: [], plots: [], selected: null };
    const chosen = buildFarmSceneInput({ ...base, island: ground });
    const composed = buildFarmSceneInput(base);
    expect(chosen.world.terrain.field).toBeDefined();
    expect(chosen.world.roads.length).toBe(0);
    expect(chosen.world.landmarks.length).toBe(0);
    expect(chosen.world.scenery.length).toBeGreaterThan(300);
    expect(composed.world.terrain.field).toBeUndefined();
    // The same stored ground is not rebuilt on every refresh.
    expect(buildFarmSceneInput({ ...base, island: ground }).world).toBe(chosen.world);
  });
});
