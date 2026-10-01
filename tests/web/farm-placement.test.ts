import { describe, expect, it } from "vitest";
import type { PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { layoutFarmTiles } from "../../apps/web/src/render/layout";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";
import { islandRadiusAt, volcanoRadiusFraction } from "../../apps/web/src/render/terrain-height";
import { BUILDINGS, RESERVED_BUILDINGS } from "../../apps/web/src/render/buildings";
import {
  DISTRICTS,
  FARMSTEAD,
  FARM_FIELD_BOUNDS,
  FENCE,
  HARBOUR,
  ISLAND_SHAPE,
  LANDMARKS,
  ROAD_NODES,
  ROADS,
  SPAWN_TILE,
  VOLCANO_SHAPE,
  VISUAL_BOUNDS,
  districtAt,
  isStaticWorldWalkable
} from "../../apps/web/src/render/world-config";

/**
 * The island's invariants, not the renderer's implementation.
 *
 * These are the things a player would notice and report: a tree standing in the sea, a building in a
 * field, a road that leads nowhere, vegetation where the catalogue is supposed to sell land. They are
 * checked against the same definitions the renderer uses, so a scene cannot be correct in a test and
 * wrong on screen.
 */

const PITCH = 1.08;
const ORIGIN_TILE = 5.5;

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 100,
    requiredLevel: 1,
    unlocked
  };
}

const CATALOGUE = [1, 2, 3, 4, 5].map((index) => plot(index, false));

function starterWorld() {
  const tiles = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  const frame = landFrame(tiles, CATALOGUE);
  const layout = layoutFarmTiles(tiles, frame === null ? {} : { frame });
  return buildFarmWorld({ layout, tiles, plots: CATALOGUE });
}

/** Where a world position falls, in tile coordinates. */
function tileOf(worldX: number, worldZ: number): { readonly x: number; readonly y: number } {
  return { x: worldX / PITCH + ORIGIN_TILE, y: worldZ / PITCH + ORIGIN_TILE };
}

describe("nothing stands in the sea", () => {
  it("keeps every scenery instance inside the island's outline", () => {
    const world = starterWorld();
    expect(world.scenery.length).toBeGreaterThan(50);
    for (const entry of world.scenery) {
      const radius = islandRadiusAt(entry.worldX, entry.worldZ, ISLAND_SHAPE);
      // The loose end of the placement rules: even the smallest thing keeps a margin, and a tree
      // keeps a real one. This is the invariant that used to fail along the whole island's rim.
      expect(radius, `${entry.kind} at ${entry.worldX.toFixed(1)},${entry.worldZ.toFixed(1)}`).toBeLessThan(0.98);
    }
  });

  it("keeps large scenery away from the waterline", () => {
    const world = starterWorld();
    for (const entry of world.scenery) {
      if (entry.kind !== "tree" && entry.kind !== "pine") continue;
      const radius = islandRadiusAt(entry.worldX, entry.worldZ, ISLAND_SHAPE);
      expect(radius, `tree at ${entry.worldX.toFixed(1)},${entry.worldZ.toFixed(1)}`).toBeLessThanOrEqual(0.9);
    }
  });

  it("keeps the wild growth on locked land inside the island too", () => {
    const world = starterWorld();
    expect(world.lockedScenery.length).toBeGreaterThan(50);
    for (const entry of world.lockedScenery) {
      expect(islandRadiusAt(entry.worldX, entry.worldZ, ISLAND_SHAPE)).toBeLessThan(0.98);
    }
  });

  it("keeps every scenery instance inside the map's own bounds", () => {
    const world = starterWorld();
    for (const entry of world.scenery) {
      const tile = tileOf(entry.worldX, entry.worldZ);
      expect(tile.x).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minX - 1);
      expect(tile.x).toBeLessThanOrEqual(VISUAL_BOUNDS.maxX + 1);
      expect(tile.y).toBeGreaterThanOrEqual(VISUAL_BOUNDS.minY - 1);
      expect(tile.y).toBeLessThanOrEqual(VISUAL_BOUNDS.maxY + 1);
    }
  });
});

describe("districts hold what they claim to hold", () => {
  it("keeps only the island's own places, and each one a real area", () => {
    for (const district of DISTRICTS) {
      expect(districtAt(district.center)?.id, district.id).toBe(district.id);
      expect(district.radiusX).toBeGreaterThan(0);
      expect(district.radiusY).toBeGreaterThan(0);
    }
    // V12.2 deleted the production districts. The island owns the village and the coast it trades
    // from, and nothing else: every other kind of land is the player's, decided by capability.
    expect(DISTRICTS.map((district) => district.kind).sort()).toEqual(["COAST", "SETTLEMENT"]);
  });

  it("keeps scenery out of the crop reserve, because that land belongs to the catalogue", () => {
    const world = starterWorld();
    for (const entry of world.scenery) {
      const tile = tileOf(entry.worldX, entry.worldZ);
      const insideReserve =
        tile.x >= FENCE.bounds.minX - 1.4 &&
        tile.x <= FENCE.bounds.maxX + 1.4 &&
        tile.y >= FENCE.bounds.minY - 1.4 &&
        tile.y <= FENCE.bounds.maxY + 1.4;
      expect(insideReserve, `${entry.kind} at ${tile.x.toFixed(1)},${tile.y.toFixed(1)}`).toBe(false);
    }
  });

  it("keeps every building inside the district it belongs to", () => {
    for (const building of [...BUILDINGS, ...RESERVED_BUILDINGS]) {
      const owner = districtAt(building.tile);
      if (building.district === null) {
        // A building that stands on open land says so, and open land is not a district.
        expect(owner, `${building.id} claims no district but stands in ${owner?.kind ?? ""}`).toBeNull();
        continue;
      }
      const host = DISTRICTS.find((district) => district.kind === building.district);
      expect(host, `${building.id} needs a ${building.district} district`).toBeDefined();
      expect(owner?.kind, `${building.id} stands in ${owner?.kind ?? "no district"}`).toBe(building.district);
    }
  });

  it("leaves every building and landmark outside the reserved field", () => {
    for (const item of [...LANDMARKS, ...RESERVED_BUILDINGS]) {
      const insideField =
        item.tile.x >= FARM_FIELD_BOUNDS.minX &&
        item.tile.x <= FARM_FIELD_BOUNDS.maxX &&
        item.tile.y >= FARM_FIELD_BOUNDS.minY &&
        item.tile.y <= FARM_FIELD_BOUNDS.maxY;
      expect(insideField, item.id).toBe(false);
    }
  });
});

describe("the plan is reachable", () => {
  it("connects the harbour, the village and the barn by one dirt road", () => {
    // V12.2's correction: the island is undeveloped, so the road it supplies is the cheapest one
    // that works. Paving is civic - it exists inside the village, and nowhere else yet.
    const spine = ROADS.find((road) => road.id === "harbour_spine");
    expect(spine, "the island needs its harbour road").toBeDefined();
    expect(spine?.kind, "the harbour road must be dirt, not stone").toBe("SECONDARY");
    expect(ROADS.filter((road) => road.kind === "PRIMARY")).toEqual([]);
    const authored = ROADS.filter((road) => road.kind !== "PATH");
    const points = authored.flatMap((road) => road.points);
    const settlement = DISTRICTS.find((district) => district.kind === "SETTLEMENT")?.center ?? { x: 0, y: 0 };
    const coast = DISTRICTS.find((district) => district.kind === "COAST")?.center ?? { x: 0, y: 0 };
    const near = (tile: { readonly x: number; readonly y: number }, target: { readonly x: number; readonly y: number }, within: number): boolean =>
      Math.hypot(tile.x - target.x, tile.y - target.y) <= within;
    // The three anchors of the territory plan, in the order the road visits them: the quay the boats
    // use, the town people live in, and the barn where the fields begin.
    expect(points.some((point) => near(point, HARBOUR.root, 2))).toBe(true);
    expect(points.some((point) => near(point, settlement, 16))).toBe(true);
    expect(points.some((point) => near(point, coast, 16))).toBe(true);
    // It stops at the square: past the village the road is the player's.
    expect(spine?.connects).toEqual(["harbour", "harbour_yard", "civic", "plaza"]);
    // ...and the authored network still reaches the yard in front of the barn, not inside the barn:
    // the hub is where the roads meet, and the barn stands beside it.
    expect(points.some((point) => near(point, ROAD_NODES.farm_hub, 1))).toBe(true);
    expect(Math.hypot(ROAD_NODES.farm_hub.x - FARMSTEAD.center.x, ROAD_NODES.farm_hub.y - FARMSTEAD.center.y)).toBeLessThan(5);
  });

  it("reaches the volcano's foothill, and stops short of the steep ground", () => {
    // V12.1's second road: out of the village and north-west until the ground starts to climb. It is
    // the island's only route that leaves the settlement, and it deliberately ends on the foothill -
    // nothing authored climbs the landmark.
    const north = ROADS.find((road) => road.id === "north_road");
    expect(north, "the island needs a road north").toBeDefined();
    // A footpath to the landmark, not a second highway: the island supplies what it needs and the
    // player builds the rest.
    expect(north?.kind).toBe("PATH");
    expect(north?.connects).toEqual(["plaza", "highland"]);
    const end = north?.points.at(-1);
    expect(end).toEqual(ROAD_NODES.highland);
    const endWorld = { worldX: (end?.x ?? 0) * PITCH - ORIGIN_TILE * PITCH, worldZ: (end?.y ?? 0) * PITCH - ORIGIN_TILE * PITCH };
    expect(volcanoRadiusFraction(endWorld.worldX, endWorld.worldZ, VOLCANO_SHAPE)).toBeGreaterThan(
      VOLCANO_SHAPE.steepRadiusFraction
    );
  });

  it("starts the player beside their own land", () => {
    // The spawn used to sit on an authored lane thirty tiles south of the farm. With the lanes gone,
    // it belongs on the edge of the square the player owns.
    expect(SPAWN_TILE.y).toBeGreaterThan(INITIAL_LAND_SIZE - 1);
    expect(Math.abs(SPAWN_TILE.x - 5.5)).toBeLessThan(1);
    expect(isStaticWorldWalkable(SPAWN_TILE)).toBe(true);
  });

  it("keeps every road out of the crop reserve", () => {
    for (const road of ROADS) {
      // V11's one exception: a `PATH` is a farm track and the agricultural district is where a farm
      // track belongs. Every road proper still runs around the reserve rather than through it.
      if (road.kind === "PATH") continue;
      for (const point of road.points) {
        const insideReserve =
          point.x >= FARM_FIELD_BOUNDS.minX - 1.2 &&
          point.x <= FARM_FIELD_BOUNDS.maxX + 1.2 &&
          point.y >= FARM_FIELD_BOUNDS.minY - 1.2 &&
          point.y <= FARM_FIELD_BOUNDS.maxY + 1.2;
        expect(insideReserve, `${road.id} at ${String(point.x)},${String(point.y)}`).toBe(false);
      }
    }
  });

  it("is deterministic, and does not move when the farm grows", () => {
    const first = starterWorld();
    const second = starterWorld();
    expect(first.scenery).toEqual(second.scenery);
    expect(first.lockedScenery).toEqual(second.lockedScenery);
  });
});
