import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { createSharedAssets } from "../../apps/web/src/render/materials";
import { ribbonSurface, stonePlateSurface } from "../../apps/web/src/render/road-surface";
import { buildRoadNetwork, reachableFrom, REQUIRED_ROAD_DESTINATIONS } from "../../apps/web/src/render/road-network";
import { GROUND_SURFACE_Y, islandRadiusAt, terrainHeightAt } from "../../apps/web/src/render/terrain-height";
import { ROAD_LIFT_WORLD } from "../../apps/web/src/render/roads";
import {
  FARMSTEAD,
  HARBOUR,
  ISLAND_SHAPE,
  LANDMARKS,
  ROAD_NODES,
  ROADS,
  ROAD_WIDTH_TILES,
  VISUAL_BOUNDS
} from "../../apps/web/src/render/world-config";

/**
 * The road network, held to the claims the pass makes about it.
 *
 * A road is the map's explanation, so the things worth checking are the things a player would notice
 * if they were wrong: a district nothing reaches, a highway that is not wider than a track, a road
 * that floats above a hill or sinks into it, a road that runs off the island. None of it is
 * gameplay - the network decides nothing that the server enforces - but all of it is legibility.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_one",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 500,
    requiredLevel: 1,
    unlocked
  };
}

function sceneInput() {
  const tiles: FarmTileDTO[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push(tile(x, y));
  }
  const plots = [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1));
  return buildFarmSceneInput({ tiles, crops: [], trees: [], plots, selected: null });
}

const NETWORK = buildRoadNetwork();

describe("the road hierarchy", () => {
  it("is three widths, in the order the classes are drawn", () => {
    expect(ROAD_WIDTH_TILES.PRIMARY).toBeGreaterThan(ROAD_WIDTH_TILES.SECONDARY);
    expect(ROAD_WIDTH_TILES.SECONDARY).toBeGreaterThan(ROAD_WIDTH_TILES.PATH);
    // A primary is not merely wider than a secondary; it is wide enough to read as a different thing
    // from the far side of the estate.
    expect(ROAD_WIDTH_TILES.PRIMARY).toBeGreaterThan(ROAD_WIDTH_TILES.SECONDARY * 1.5);
  });

  it("gives each class its own surface", () => {
    const assets = createSharedAssets();
    try {
      const stone = assets.roadStone.color.getHex();
      const dirt = assets.roadDirt.color.getHex();
      const path = assets.roadPath.color.getHex();
      expect(stone).not.toBe(dirt);
      expect(dirt).not.toBe(path);
      expect(stone).not.toBe(path);
      // Grey stone, warm earth, and a path between the two: the stone is the least saturated of the
      // three, which is what makes it read as stone rather than as pale dirt.
      const warmth = (hex: number): number => ((hex >> 16) & 0xff) - (hex & 0xff);
      expect(warmth(stone)).toBeLessThan(warmth(path));
      expect(warmth(path)).toBeLessThan(warmth(dirt));
    } finally {
      assets.dispose();
    }
  });

  it("writes every class into the network", () => {
    const kinds = new Set(ROADS.map((road) => road.kind));
    expect(kinds).toEqual(new Set(["PRIMARY", "SECONDARY", "PATH"]));
    expect(ROADS.filter((road) => road.kind === "PRIMARY")).toHaveLength(1);
  });
});

describe("the road connectivity graph", () => {
  it("reaches every destination the island names", () => {
    const reachable = reachableFrom("harbour", NETWORK);
    for (const destination of REQUIRED_ROAD_DESTINATIONS) {
      expect(reachable.has(destination), `${destination} is cut off from the harbour`).toBe(true);
    }
  });

  it("reaches them from the farm hub too, so no district depends on one direction", () => {
    const reachable = reachableFrom("farm_hub", NETWORK);
    for (const destination of REQUIRED_ROAD_DESTINATIONS) {
      expect(reachable.has(destination), `${destination} is cut off from the farm`).toBe(true);
    }
  });

  it("has no road that leads nowhere", () => {
    for (const road of ROADS) {
      expect(road.points.length, road.id).toBeGreaterThan(1);
      for (const node of road.connects) {
        expect(ROAD_NODES[node], `${road.id} names a stop that does not exist`).toBeDefined();
      }
      // Every road either joins two named stops or is a tail that continues one; a road that named a
      // stop nothing else touches would be a fragment, and fragments are the thing being fixed.
      if (road.connects.length >= 2) continue;
      expect(
        ROADS.some((other) => other !== road && other.connects.some((node) => road.connects.includes(node))),
        `${road.id} is a fragment`
      ).toBe(true);
    }
  });

  it("anchors its stops at the places they name", () => {
    expect(ROAD_NODES.harbour).toEqual(HARBOUR.root);
    expect(ROAD_NODES.harbour_yard).toEqual(HARBOUR.yard);
    // The hub is the yard in front of the barn rather than the barn, so the roads have somewhere to
    // meet that is not inside a building - and the barn is still the landmark they meet at.
    const barn = LANDMARKS.find((landmark) => landmark.kind === "OPEN_BARN");
    expect(barn).toBeDefined();
    expect(
      Math.hypot(ROAD_NODES.farm_hub.x - FARMSTEAD.center.x, ROAD_NODES.farm_hub.y - FARMSTEAD.center.y)
    ).toBeLessThan(5);
    expect(
      Math.hypot(ROAD_NODES.farm_hub.x - (barn?.tile.x ?? 0), ROAD_NODES.farm_hub.y - (barn?.tile.y ?? 0))
    ).toBeLessThan(6);
  });
});

describe("the drawn network follows the ground and the island", () => {
  it("sits on the terrain it crosses rather than floating or sinking", () => {
    const { world } = sceneInput();
    expect(world.roads.length).toBe(ROADS.length);
    for (const road of world.roads) {
      expect(road.samples.length, road.id).toBeGreaterThan(2);
      for (const sample of road.samples) {
        const expected = GROUND_SURFACE_Y + terrainHeightAt(sample.worldX, sample.worldZ, world.terrain) + ROAD_LIFT_WORLD;
        expect(sample.worldY, road.id).toBeCloseTo(expected, 9);
      }
    }
  });

  it("stays on the island, with the quay allowed to reach the water", () => {
    const { world } = sceneInput();
    for (const road of world.roads) {
      for (const sample of road.samples) {
        const radius = islandRadiusAt(sample.worldX, sample.worldZ, ISLAND_SHAPE);
        const allowance = road.id === "harbour_boardwalk" ? 1.02 : 0.98;
        expect(radius, `${road.id} leaves the island`).toBeLessThanOrEqual(allowance);
      }
    }
  });

  it("keeps every road inside the drawn world", () => {
    for (const road of ROADS) {
      for (const point of road.points) {
        expect(point.x, road.id).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minX);
        expect(point.x, road.id).toBeLessThanOrEqual(VISUAL_BOUNDS.maxX);
        expect(point.y, road.id).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minY);
        expect(point.y, road.id).toBeLessThanOrEqual(VISUAL_BOUNDS.maxY);
      }
    }
  });

  it("knows a road cell is walkable ground", () => {
    const { cells } = sceneInput();
    const onARoad = [...cells.cells.values()].filter((cell) => cell.road !== null);
    expect(onARoad.length).toBeGreaterThan(0);
    for (const cell of onARoad) {
      // A road carries no building of its own: the cell it passes through is ground a character may
      // stand on unless a building already stands there, which is the rule the cell map applies.
      if (cell.terrain === "BLOCKED") {
        expect(cell.occupancy, `cell ${String(cell.x)},${String(cell.z)}`).toBe("BUILDING");
        continue;
      }
      // The quay's own walkway crosses open water: that is the pier, and the deck is the walkway.
      if (cell.road === "harbour_boardwalk") continue;
      expect(cell.walkable, `cell ${String(cell.x)},${String(cell.z)} on ${cell.road ?? ""}`).toBe(true);
      expect(cell.occupancy).not.toBe("BUILDING");
    }
  });
});

describe("the road surfaces are drawn once, cheaply", () => {
  const { world } = sceneInput();

  it("batches the cobbles of the stone road into one geometry", () => {
    const plates = stonePlateSurface(world.roads);
    const plateCount = plates.indices.length / 6;
    expect(plateCount).toBeGreaterThan(400);
    // One geometry, not one mesh per stone, and still a bounded amount of geometry to upload.
    expect(plateCount).toBeLessThan(6000);
    expect(plates.positions.length / 3).toBe(plateCount * 4);
    expect(plates.colors?.length).toBe(plates.positions.length);
  });

  it("does not draw a stone surface for a world with no stone road", () => {
    const onlyPaths = world.roads.filter((road) => road.kind === "PATH");
    expect(stonePlateSurface(onlyPaths).indices.length).toBe(0);
  });

  it("tints every ribbon vertex, so no road is one flat colour", () => {
    const ribbons = ribbonSurface(world.roads, ["SECONDARY"]);
    const colours = ribbons.colors;
    expect(colours).not.toBeNull();
    if (colours === null) throw new Error("a ribbon must carry vertex colours");
    expect(colours.length).toBe(ribbons.positions.length);
    const tones = new Set(Array.from(colours, (value) => value.toFixed(3)));
    expect(tones.size).toBeGreaterThan(1);
  });

  it("puts a paved disc at the stops the roads share", () => {
    expect(world.junctions.length).toBeGreaterThan(4);
    for (const junction of world.junctions) {
      expect(junction.radiusWorld).toBeGreaterThan(0);
      // The widest road through the junction sets its surface, so a stone spine paves the whole disc.
      const expected = GROUND_SURFACE_Y + terrainHeightAt(junction.worldX, junction.worldZ, world.terrain) + ROAD_LIFT_WORLD;
      expect(junction.worldY).toBeCloseTo(expected, 9);
    }
    // The harbour end of the spine is a junction, and it is stone.
    const harbour = world.junctions.find((junction) => junction.id === "junction_harbour");
    expect(harbour?.kind).toBe("PRIMARY");
  });
});
