import { describe, expect, it } from "vitest";
import { classifyTile, groundCapabilities, activeResourceNodes } from "@happy-farm/game-data";
import { layoutFarmTiles, tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { movementDestinationForTarget } from "../../apps/web/src/render/world-cell-selection";
import { buildWorldCellMap } from "../../apps/web/src/render/world-cell-map";
import { cellKey, worldCellAt } from "../../apps/web/src/render/world-cell";
import { FARM_FIELD_BOUNDS, SPAWN_TILE, TERRAIN_SHAPE } from "../../apps/web/src/render/world-config";

const frame = worldFrame();
const startCell = { x: Math.round(SPAWN_TILE.x), y: SPAWN_TILE.y };
const layout = layoutFarmTiles([startCell], {
  frame: { minX: -34, maxX: 70, minY: -34, maxY: 70 }
});
const map = buildWorldCellMap({
  layout,
  tiles: [],
  constructions: [],
  plantedTiles: [],
  scenery: [],
  roads: []
}, TERRAIN_SHAPE);
const spawn = tileToWorld(startCell, frame);

function pathExists(goal: { readonly x: number; readonly y: number }): boolean {
  const queue = [startCell];
  const visited = new Set([cellKey(startCell.x, startCell.y)]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    if (current.x === goal.x && current.y === goal.y) return true;
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ]) {
      const key = cellKey(next.x, next.y);
      const cell = worldCellAt(map, next.x, next.y);
      if (visited.has(key) || cell?.walkable !== true) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

describe("active ore mine placement", () => {
  it("is on mining ground, outside the starter field, and has a reachable interaction destination", () => {
    const node = activeResourceNodes.find((candidate) => candidate.id === "node_stone_ridge");
    if (node === undefined) throw new Error("active ore mine fixture is missing");
    const cell = worldCellAt(map, node.position.x, node.position.y);
    const destination = cell === null ? null : movementDestinationForTarget(cell, map, spawn, () => false);
    const outsideField = node.position.x < FARM_FIELD_BOUNDS.minX || node.position.x > FARM_FIELD_BOUNDS.maxX
      || node.position.y < FARM_FIELD_BOUNDS.minY || node.position.y > FARM_FIELD_BOUNDS.maxY;

    expect(classifyTile(node.position).terrain).toBe("VOLCANO");
    expect(groundCapabilities(node.position)).toContain("MINING");
    expect(cell?.walkable).toBe(true);
    expect(destination).not.toBeNull();
    expect(pathExists(node.position)).toBe(true);
    expect(outsideField).toBe(true);
    expect(cell?.reserved).toBe(false);
    expect(destination && Math.hypot(
      destination.worldX - tileToWorld(node.position, frame).worldX,
      destination.worldZ - tileToWorld(node.position, frame).worldZ
    )).toBe(0);

    // The authoritative work-area ground is the server-side placement gate. Character navigation
    // may choose a stepped path around the volcano slope rather than the straight-line probe used by
    // this fixture, so reachability is asserted by the walkable-cell search above.
  });
});
