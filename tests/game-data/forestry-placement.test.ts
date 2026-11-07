import { describe, expect, it } from "vitest";
import { classifyTile, groundCapabilities, resourceDefinitions, resourceNodes, STARTER_WORLD_PLACEMENTS_V2 } from "@happy-farm/game-data";
import { constructionBounds } from "@happy-farm/domain";
import { layoutFarmTiles, tileToWorld, worldFrame, worldToTile } from "../../apps/web/src/render/layout";
import { buildFarmWorld } from "../../apps/web/src/render/world";
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

function pathExists(start: { readonly x: number; readonly y: number }, goal: { readonly x: number; readonly y: number }): boolean {
  const queue = [{ x: start.x, y: start.y }];
  const visited = new Set([cellKey(start.x, start.y)]);
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

describe("forestry placement discovery", () => {
  it("keeps every CHOP node on reachable Forestry-capable ground", () => {
    const forestryDefinitionIds = new Set(resourceDefinitions.filter((definition) => definition.verb === "CHOP").map((definition) => definition.id));
    const forestry = resourceNodes.filter((node) => forestryDefinitionIds.has(node.definitionId));
    expect(forestry).toHaveLength(13);
    const rows = forestry.map((node) => {
      const cell = worldCellAt(map, node.position.x, node.position.y);
      const destination = cell === null ? null : movementDestinationForTarget(cell, map, spawn, () => false);
      const packageTerrain = classifyTile(node.position);
      const destinationDistance = destination === null ? Number.POSITIVE_INFINITY : Math.hypot(
        destination.worldX - tileToWorld(node.position, frame).worldX,
        destination.worldZ - tileToWorld(node.position, frame).worldZ
      );
      return { id: node.id, position: node.position, cell: cell?.zone ?? "MISSING", walkable: cell?.walkable ?? false, destination: destination !== null, path: pathExists(startCell, node.position), packageTerrain: packageTerrain.terrain, packageCaps: groundCapabilities(node.position), destinationDistance };
    });
    for (const row of rows) {
      expect(row.packageCaps, row.id).toContain("FORESTRY");
      expect(row.packageTerrain, row.id).not.toBe("WATER");
      expect(row.cell, row.id).not.toBe("MISSING");
      expect(row.walkable, row.id).toBe(true);
      expect(row.destination, row.id).toBe(true);
      expect(row.path, row.id).toBe(true);
      expect(row.destinationDistance, row.id).toBeLessThanOrEqual(3.2);
      expect(row.position.x < FARM_FIELD_BOUNDS.minX || row.position.x > FARM_FIELD_BOUNDS.maxX || row.position.y < FARM_FIELD_BOUNDS.minY || row.position.y > FARM_FIELD_BOUNDS.maxY, row.id).toBe(true);
      expect(worldCellAt(map, row.position.x, row.position.y)?.reserved, row.id).toBe(false);
    }
  });

  it("places a level-one Wildwood beside the starting area without making scenery chop-able", () => {
    const node = resourceNodes.find((candidate) => candidate.id === "node_wildwood_start_1");
    const definition = resourceDefinitions.find((candidate) => candidate.id === "resource_wildwood");
    if (node === undefined || definition === undefined) throw new Error("starter Wildwood fixture is incomplete");

    const cell = worldCellAt(map, node.position.x, node.position.y);
    const destination = cell === null ? null : movementDestinationForTarget(cell, map, spawn, () => false);
    expect(definition.requiredLevel ?? 1).toBe(1);
    expect(node.position).toEqual({ x: -1, y: 13 });
    expect(classifyTile(node.position).terrain).toBe("LAND");
    expect(groundCapabilities(node.position)).toContain("FORESTRY");
    expect(cell?.walkable).toBe(true);
    expect(destination).not.toBeNull();
    expect(pathExists(startCell, node.position)).toBe(true);
    expect(Math.hypot(node.position.x - SPAWN_TILE.x, node.position.y - SPAWN_TILE.y)).toBeLessThan(10);
    expect(node.position.x < FARM_FIELD_BOUNDS.minX || node.position.x > FARM_FIELD_BOUNDS.maxX || node.position.y < FARM_FIELD_BOUNDS.minY || node.position.y > FARM_FIELD_BOUNDS.maxY).toBe(true);
    expect(cell?.reserved).toBe(false);

    const staticWorld = buildFarmWorld({ layout, tiles: [], plots: [] });
    const decorativeOccupants = staticWorld.scenery.filter((entry) => {
      const tile = worldToTile({ worldX: entry.worldX, worldZ: entry.worldZ }, frame);
      return tile.x === node.position.x && tile.y === node.position.y;
    });
    expect(decorativeOccupants, `${node.id} must not share a cell with decorative scenery`).toHaveLength(0);

    for (const starter of STARTER_WORLD_PLACEMENTS_V2) {
      const bounds = constructionBounds(starter.tile, { widthCells: 1, depthCells: 1 });
      expect(
        node.position.x < bounds.minX || node.position.x > bounds.maxX || node.position.y < bounds.minY || node.position.y > bounds.maxY,
        `${node.id} overlaps ${starter.key}`
      ).toBe(true);
    }
  });

  it("keeps the corrected pine node clear of the starter object that occupied its old cell", () => {
    const oldPosition = { x: 56, y: -20 };
    const corrected = resourceNodes.find((node) => node.id === "node_pine_east_4");
    const starter = STARTER_WORLD_PLACEMENTS_V2.find((placement) => placement.key === "starter.tree.008");
    if (corrected === undefined || starter === undefined) throw new Error("Forestry placement fixture is incomplete");
    const oldBounds = constructionBounds(starter.tile, { widthCells: 1, depthCells: 1 });
    const contains = (point: { readonly x: number; readonly y: number }): boolean =>
      point.x >= oldBounds.minX && point.x <= oldBounds.maxX && point.y >= oldBounds.minY && point.y <= oldBounds.maxY;
    expect(contains(oldPosition)).toBe(true);
    expect(contains(corrected.position)).toBe(false);
    expect(corrected.position).toEqual({ x: 27, y: -20 });

    for (const other of resourceNodes) {
      if (other.id === corrected.id) continue;
      const distance = Math.hypot(corrected.position.x - other.position.x, corrected.position.y - other.position.y);
      expect(distance, `${corrected.id} overlaps ${other.id}`).toBeGreaterThan(
        Math.max(corrected.interactionRadiusTiles, other.interactionRadiusTiles)
      );
    }
  });
});
