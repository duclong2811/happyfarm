import { describe, expect, it } from "vitest";
import { COMPOSED_ISLAND_MINE_POSITIONS, classifyTile, groundCapabilities } from "@happy-farm/game-data";
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

describe("the composed island's mine slots", () => {
  it.each(COMPOSED_ISLAND_MINE_POSITIONS.map((position, slot) => ({ slot, position })))(
    "slot $slot is on mining ground, outside the starter field, and walkable from the spawn",
    ({ position }) => {
      const cell = worldCellAt(map, position.x, position.y);
      const destination = cell === null ? null : movementDestinationForTarget(cell, map, spawn, () => false);
      const outsideField = position.x < FARM_FIELD_BOUNDS.minX || position.x > FARM_FIELD_BOUNDS.maxX
        || position.y < FARM_FIELD_BOUNDS.minY || position.y > FARM_FIELD_BOUNDS.maxY;

      expect(classifyTile(position).terrain).toBe("VOLCANO");
      expect(groundCapabilities(position)).toContain("MINING");
      expect(cell?.walkable).toBe(true);
      expect(destination).not.toBeNull();
      expect(pathExists(position)).toBe(true);
      expect(outsideField).toBe(true);
      expect(cell?.reserved).toBe(false);
    }
  );

  it("keeps the slots apart, so one interaction range never holds two mines", () => {
    COMPOSED_ISLAND_MINE_POSITIONS.forEach((a, index) => {
      for (const b of COMPOSED_ISLAND_MINE_POSITIONS.slice(index + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(5);
      }
    });
  });
});
