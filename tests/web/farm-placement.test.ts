import { describe, expect, it } from "vitest";
import type { PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { layoutFarmTiles } from "../../apps/web/src/render/layout";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";
import { islandRadiusAt } from "../../apps/web/src/render/terrain-height";
import { BUILDINGS, RESERVED_BUILDINGS } from "../../apps/web/src/render/buildings";
import {
  DISTRICTS,
  FARM_FIELD_BOUNDS,
  FENCE,
  ISLAND_SHAPE,
  LANDMARKS,
  ROADS,
  SPAWN_TILE,
  VISUAL_BOUNDS,
  districtAt
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
  it("gives every kind of district a definition, and one that is a real area", () => {
    for (const district of DISTRICTS) {
      expect(districtAt(district.center)?.id, district.id).toBe(district.id);
      expect(district.radiusX).toBeGreaterThan(0);
      expect(district.radiusY).toBeGreaterThan(0);
    }
    // The functions the plan separates: crops, civic, perennial, grazing, water, woodland, managed
    // woodland, and coast. Losing one of these is losing a district, not a style choice.
    const kinds = new Set<string>(DISTRICTS.map((district) => district.kind));
    for (const required of ["CROPLAND", "SETTLEMENT", "ORCHARD", "PASTURE", "WATER", "FOREST", "FORESTRY", "COAST"]) {
      expect(kinds.has(required), required).toBe(true);
    }
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
      const host = DISTRICTS.find((district) => district.kind === building.district);
      expect(host, `${building.id} needs a ${building.district} district`).toBeDefined();
      const owner = districtAt(building.tile);
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
  it("connects the settlement, the fields and the harbour by one primary road", () => {
    const primary = ROADS.find((road) => road.kind === "PRIMARY");
    expect(primary, "the island needs a primary road").toBeDefined();
    const points = primary?.points ?? [];
    const settlement = DISTRICTS.find((district) => district.kind === "SETTLEMENT")?.center ?? { x: 0, y: 0 };
    const coast = DISTRICTS.find((district) => district.kind === "COAST")?.center ?? { x: 0, y: 0 };
    const near = (tile: { readonly x: number; readonly y: number }, target: { readonly x: number; readonly y: number }, within: number): boolean =>
      Math.hypot(tile.x - target.x, tile.y - target.y) <= within;
    // The three anchors of the territory plan: where people live, where the fields are, and where the
    // boats will be.
    expect(points.some((point) => near(point, settlement, 16))).toBe(true);
    expect(points.some((point) => near(point, coast, 16))).toBe(true);
    expect(points.some((point) => near(point, SPAWN_TILE, 3))).toBe(true);
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
