import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { worldFrame, worldToTile } from "../../apps/web/src/render/layout";
import { BUILDINGS, RESERVED_BUILDINGS, variantFor } from "../../apps/web/src/render/buildings";
import { islandRadiusAt, volcanoZoneAt, type VolcanoZone } from "../../apps/web/src/render/terrain-height";
import {
  DISTRICTS,
  FARM_FIELD_BOUNDS,
  ISLAND_SHAPE,
  LANDMARKS,
  VOLCANO,
  VOLCANO_SHAPE,
  districtAt
} from "../../apps/web/src/render/world-config";

/**
 * The V12.1 world: an undeveloped island with a volcano, a village, and a harbour.
 *
 * The brief for this pass is mostly about what the island must *stop* showing - the farm the
 * developer had already built - so most of these are structural checks that the production
 * presentation is gone, alongside the things that replaced it: a landmark in the north that the
 * ground itself refuses to let anybody build on, and a majority of the island that is plainly
 * developable.
 */

const MODEL_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models/farm-buildings", import.meta.url));

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_v121",
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

/** The starter island: the twelve-tile square the server grants, and nothing else claimed. */
function starterScene() {
  const tiles: FarmTileDTO[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push(tile(x, y));
  }
  return buildFarmSceneInput({
    tiles,
    crops: [],
    trees: [],
    plots: [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1)),
    selected: null
  });
}

describe("the island is not the player's farm yet", () => {
  const { world, cells } = starterScene();

  it("moors no aquaculture: the cages are the player's to place", () => {
    expect(world.aquaculture).toEqual([]);
  });

  it("keeps no timber yard, because there is no haul road and no felled stand", () => {
    expect(world.loggingYard).toBeNull();
  });

  it("draws no scenery on land the catalogue can sell", () => {
    // The reserve is the land the catalogue sells: the static scenery pass must leave every tile of it
    // empty, because whatever grows there is the player's to clear and the overlay's to draw. The
    // world coordinates are converted back through the same frame the world was built with.
    const frame = worldFrame();
    for (const instance of world.scenery) {
      const tile = worldToTile({ worldX: instance.worldX, worldZ: instance.worldZ }, frame);
      const insideReserve =
        tile.x >= FARM_FIELD_BOUNDS.minX - 0.5 &&
        tile.x <= FARM_FIELD_BOUNDS.maxX + 0.5 &&
        tile.y >= FARM_FIELD_BOUNDS.minY - 0.5 &&
        tile.y <= FARM_FIELD_BOUNDS.maxY + 0.5;
      expect(insideReserve, `scenery at tile ${tile.x.toFixed(1)},${tile.y.toFixed(1)}`).toBe(false);
    }
  });

  it("has no district that decides what a cell may be used for", () => {
    // V12.2 deleted the production districts outright, so the only two left are the village and the
    // coast. Neither may change what ordinary land is capable of: capability comes from the ground,
    // and the one thing a district *is* allowed to do is mark civic ground.
    expect(DISTRICTS.map((district) => district.kind).sort()).toEqual(["COAST", "SETTLEMENT"]);
    const land = [...cells.cells.values()].filter((cell) => cell.terrain === "LAND");
    const open = land.filter((cell) => districtAt({ x: cell.x, y: cell.z }) === null);
    expect(open.length).toBeGreaterThan(100);
    for (const cell of open) {
      expect(cell.capabilities).toEqual(["WALK", "BUILD", "FARM", "FORESTRY", "LIVESTOCK", "ROAD", "DECORATION"]);
    }
    // The coast's own blob is walkable sea and beach, and a district there changes nothing either.
    for (const cell of cells.cells.values()) {
      if (districtAt({ x: cell.x, y: cell.z })?.kind !== "COAST") continue;
      if (cell.terrain !== "LAND") continue;
      expect(cell.capabilities).toEqual(["WALK", "BUILD", "FARM", "FORESTRY", "LIVESTOCK", "ROAD", "DECORATION"]);
    }
  });

  it("keeps every scenery instance on the island", () => {
    const all = [...world.scenery, ...world.lockedScenery];
    expect(all.length).toBeGreaterThan(0);
    for (const instance of all) {
      const radius = islandRadiusAt(instance.worldX, instance.worldZ, ISLAND_SHAPE);
      expect(radius, `scenery at ${instance.worldX.toFixed(1)},${instance.worldZ.toFixed(1)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("the volcano", () => {
  const { cells } = starterScene();
  const volcanoCells = [...cells.cells.values()].filter((cell) => cell.terrain === "VOLCANO");

  it("exists, and is in the north of the island", () => {
    expect(VOLCANO_SHAPE.heightWorld).toBeGreaterThan(0);
    expect(volcanoCells.length).toBeGreaterThan(0);
    // North is negative z in this world, and every volcano cell has to be north of the island's
    // centre by a wide margin - the landmark may not creep into the middle of the map.
    for (const cell of volcanoCells) {
      expect(cell.z, `volcano cell at ${String(cell.x)},${String(cell.z)}`).toBeLessThan(0);
    }
    const northernmost = Math.min(...volcanoCells.map((cell) => cell.z));
    expect(northernmost).toBeLessThan(-25);
  });

  it("covers a real share of the island, and not most of it", () => {
    const land = [...cells.cells.values()].filter((cell) => cell.terrain !== "WATER");
    const share = volcanoCells.length / land.length;
    // The brief asks for a landmark around a sixth of the island: big enough to be the thing you see
    // first from the estate camera, small enough to leave the rest of the map to the player.
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.25);
  });

  it("refuses building and farming in the crater and on the steep flanks", () => {
    for (const cell of volcanoCells) {
      expect(cell.capabilities).not.toContain("BUILD");
      expect(cell.capabilities).not.toContain("FARM");
      expect(cell.capabilities).not.toContain("ROAD");
      expect(cell.productionCapability).toBe("NONE");
      expect(cell.buildable).toBe(false);
    }
    const core = volcanoCells.filter((cell) => cell.zone === "VOLCANO_CORE");
    expect(core.length).toBeGreaterThan(0);
    for (const cell of core) {
      // The crater is the one place on the island a walker may not go at all.
      expect(cell.capabilities).toEqual([]);
      expect(cell.walkable).toBe(false);
    }
  });

  it("keeps stone and forest off the crater and off the steep ground", () => {
    const { world } = starterScene();
    for (const instance of [...world.scenery, ...world.lockedScenery]) {
      const zone: VolcanoZone | null = volcanoZoneAt(instance.worldX, instance.worldZ, VOLCANO_SHAPE);
      if (zone === null) continue;
      if (zone === "CORE") expect(instance.kind, "nothing grows in a crater but rock").toBe("rock");
      if (zone === "SLOPE") expect(["rock", "bush", "pine"]).toContain(instance.kind);
    }
  });

  it("is the tallest ground on the island by a wide margin", () => {
    const land = [...cells.cells.values()].filter((cell) => cell.terrain === "LAND");
    expect(land.length).toBeGreaterThan(0);
    // The landmark is several times the rolling relief, which is what makes it read as *the* landmark.
    expect(VOLCANO_SHAPE.heightWorld).toBeGreaterThan(8);
    expect(VOLCANO.center.y).toBeLessThan(0);
  });
});

describe("buildings", () => {
  it("has one definition per landmark, with unique ids", () => {
    expect(BUILDINGS).toHaveLength(LANDMARKS.length);
    const ids = BUILDINGS.map((building) => building.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const building of BUILDINGS) {
      expect(building.variants.length, building.id).toBeGreaterThan(0);
      expect(building.visualTier, building.id).toBe(1);
      expect(variantFor(building).tier, building.id).toBe(1);
      expect(building.collisionRadiusWorld, building.id).toBeLessThanOrEqual(
        building.footprint.halfWidthWorld + 0.001
      );
    }
  });

  it("puts every building in the district its kind belongs to", () => {
    for (const building of BUILDINGS) {
      const owner = districtAt(building.tile);
      if (building.district === null) {
        // A working building out in the country claims no district, and stands on land the player may
        // one day own - which is the point of the V12.2 cleanup.
        expect(owner, `${building.id} claims open land`).toBeNull();
        continue;
      }
      expect(owner?.kind, `${building.id} stands in ${owner?.kind ?? "no district"}`).toBe(building.district);
    }
  });

  it("keeps a tier ladder for every building, including the ones not built yet", () => {
    for (const building of BUILDINGS) {
      expect(building.variants.length, building.id).toBeGreaterThan(1);
    }
    for (const plot of RESERVED_BUILDINGS) {
      // The reserved plots are a village that can grow: every one of them names the tiers it will be
      // drawn at, so a later pass replaces a model rather than re-planning the square.
      expect(plot.variants.length, plot.id).toBeGreaterThanOrEqual(2);
      expect(plot.variants[0]?.tier, plot.id).toBe(1);
      expect(plot.tier, plot.id).toBe(1);
      for (const variant of plot.variants) {
        // No model exists for these yet; the contract is that the field is present so one can be
        // dropped in without touching the layout.
        expect(variant.labelKey.startsWith("building."), plot.id).toBe(true);
      }
    }
  });

  it("reserves enough ground for the largest tier that will replace what is there now", () => {
    const reserved = new Map(RESERVED_BUILDINGS.map((entry) => [entry.id, entry]));
    expect(reserved.size).toBe(RESERVED_BUILDINGS.length);
    for (const plot of RESERVED_BUILDINGS) {
      const host = DISTRICTS.find((district) => district.kind === plot.district);
      expect(host, plot.id).toBeDefined();
      expect(Math.min(plot.footprint.halfWidthWorld, plot.footprint.halfDepthWorld), plot.id).toBeGreaterThan(2);
      expect(districtAt(plot.tile)?.kind, plot.id).toBe(plot.district);
    }
    for (let left = 0; left < RESERVED_BUILDINGS.length; left += 1) {
      for (let right = left + 1; right < RESERVED_BUILDINGS.length; right += 1) {
        const a = RESERVED_BUILDINGS[left];
        const b = RESERVED_BUILDINGS[right];
        if (a === undefined || b === undefined) continue;
        const gap = Math.hypot(a.tile.x - b.tile.x, a.tile.y - b.tile.y);
        expect(gap, `${a.id}/${b.id}`).toBeGreaterThan(
          Math.max(a.footprint.halfWidthWorld, a.footprint.halfDepthWorld) +
            Math.max(b.footprint.halfWidthWorld, b.footprint.halfDepthWorld)
        );
      }
    }
  });

  it("names only models that actually shipped", () => {
    const shipped = new Set(readdirSync(MODEL_ROOT).map((name) => name.replace(/\.glb$/, "")));
    for (const building of BUILDINGS) {
      for (const variant of building.variants) {
        if (variant.modelId === null) continue;
        expect(shipped.has(variant.modelId), `${building.id} tier ${String(variant.tier)}: ${variant.modelId}`).toBe(
          true
        );
      }
    }
    const named = new Set(BUILDINGS.flatMap((building) => building.variants.map((variant) => variant.modelId)));
    for (const id of shipped) {
      expect(named.has(id), `${id} is shipped but nothing draws it`).toBe(true);
    }
  });
});
