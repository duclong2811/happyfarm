import { describe, expect, it } from "vitest";
import { buildIslandGround, islandCellKindAt, type IslandCellKind } from "@happy-farm/game-data";
import { buildIslandCellMap, buildIslandFarmWorld, type IslandGroundView } from "../../apps/web/src/render/island-world";
import { layoutFarmTiles, tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { ISLAND_WADE_DEPTH_WORLD, islandWadeDepthAt } from "../../apps/web/src/render/terrain-height";
import { shoreDepthFor } from "../../apps/web/src/player/collision";
import { cellKey, type WorldCell } from "../../apps/web/src/render/world-cell";

/**
 * Island v2 water in the browser: shallows are wadeable, deep water is the edge, and the island's
 * colours reach the GPU linearised (they used to be drawn lifted and washed out).
 */

function stored(element: "THUY" | "KIM", seed: number): IslandGroundView {
  const ground = buildIslandGround({ element, outline: "ROUND", seed });
  return { ...ground, sites: ground.sites.map((site) => ({ ...site })) };
}

/** Cells whose whole 5x5 neighbourhood is one kind, so a softened field cannot blur their answer. */
function interiorCells(ground: IslandGroundView, kind: IslandCellKind): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (let y = ground.originY + 2; y < ground.originY + ground.size - 2; y += 1) {
    for (let x = ground.originX + 2; x < ground.originX + ground.size - 2; x += 1) {
      let uniform = true;
      for (let dy = -2; dy <= 2 && uniform; dy += 1) for (let dx = -2; dx <= 2 && uniform; dx += 1) uniform = islandCellKindAt(ground, { x: x + dx, y: y + dy }) === kind;
      if (uniform) found.push({ x, y });
    }
  }
  return found;
}

describe("island v2 water in the browser", () => {
  const layout = layoutFarmTiles([{ x: 0, y: 0 }]);
  const frame = worldFrame(layout.pitch);
  const ground = stored("THUY", 4242);
  const world = buildIslandFarmWorld(layout, ground);
  const depth = shoreDepthFor(world.terrain);

  it("lets a walker into the shallows and stops them at deep water", () => {
    const shallows = interiorCells(ground, "SHALLOW");
    const deep = interiorCells(ground, "DEEP").filter((cell) =>
      // Deep water near the shelf, not the far open sea where the grid ends.
      [-3, 3].some((d) => islandCellKindAt(ground, { x: cell.x + d, y: cell.y }) !== "DEEP" || islandCellKindAt(ground, { x: cell.x, y: cell.y + d }) !== "DEEP")
    );
    expect(shallows.length).toBeGreaterThan(20);
    expect(deep.length).toBeGreaterThan(5);
    for (const cell of shallows) {
      const at = tileToWorld(cell, frame);
      expect(depth(at.worldX, at.worldZ), `shallow ${JSON.stringify(cell)}`).toBeLessThan(0);
    }
    for (const cell of deep) {
      const at = tileToWorld(cell, frame);
      expect(depth(at.worldX, at.worldZ), `deep ${JSON.stringify(cell)}`).toBeGreaterThan(0);
    }
  });

  it("wades the walker knee deep in the shallows and not at all on land", () => {
    const shallow = interiorCells(ground, "SHALLOW")[0];
    const land = interiorCells(ground, "GRASS")[0] ?? interiorCells(ground, "MEADOW")[0];
    if (shallow === undefined || land === undefined) throw new Error("fixture island lacks shallows or land");
    const water = tileToWorld(shallow, frame);
    const dry = tileToWorld(land, frame);
    expect(islandWadeDepthAt(water.worldX, water.worldZ, world.terrain)).toBeCloseTo(ISLAND_WADE_DEPTH_WORLD, 2);
    expect(islandWadeDepthAt(dry.worldX, dry.worldZ, world.terrain)).toBe(0);
  });

  it("marks shallow cells walkable but never buildable or plantable", () => {
    const map = buildIslandCellMap({ layout, tiles: [], constructions: [], plantedTiles: [], scenery: [], roads: [] }, ground, world.terrain);
    const cell = (x: number, y: number): WorldCell | undefined => map.cells.get(cellKey(x, y));
    for (const tile of interiorCells(ground, "SHALLOW").slice(0, 30)) {
      expect(cell(tile.x, tile.y)?.walkable, JSON.stringify(tile)).toBe(true);
      expect(cell(tile.x, tile.y)?.buildable, JSON.stringify(tile)).toBe(false);
    }
    for (const tile of interiorCells(ground, "DEEP").slice(0, 30)) {
      expect(cell(tile.x, tile.y)?.walkable ?? false, JSON.stringify(tile)).toBe(false);
    }
  });

  it("hands the GPU linear colours: a grass cell is darker in linear than in its sRGB palette", () => {
    const field = world.terrain.field;
    const colors = field?.colors;
    const grass = interiorCells(ground, "GRASS")[0];
    if (field === undefined || colors === undefined || grass === undefined) throw new Error("no field colours");
    const index = (grass.y - ground.originY) * ground.size + (grass.x - ground.originX);
    // The palette's grass green is 168/255 = 0.66 in sRGB, about 0.39 linear.
    expect(colors[index * 3 + 1]).toBeLessThan(0.5);
    expect(colors[index * 3 + 1]).toBeGreaterThan(0.3);
  });
});
