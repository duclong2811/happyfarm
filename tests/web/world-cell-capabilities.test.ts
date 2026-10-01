import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import {
  cellCapabilitiesFor,
  cellHasCapability,
  worldCellAt,
  type CellCapability
} from "../../apps/web/src/render/world-cell";
import { FARM_FIELD_BOUNDS } from "../../apps/web/src/render/world-config";

/**
 * The player-built island's land-use rule.
 *
 * The direction this pass migrates to says the island must stop deciding that a patch of ground is a
 * field, an orchard or a wood. The ground says what it *can* carry, and the player's placement
 * decides what it becomes. These are the properties that make that true rather than aspirational:
 * the rule is total, it never mentions a district, and it never duplicates the reservation.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_caps",
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

const DEVELOPABLE: readonly CellCapability[] = [
  "WALK",
  "BUILD",
  "FARM",
  "FORESTRY",
  "LIVESTOCK",
  "ROAD",
  "DECORATION"
];

describe("cell capabilities", () => {
  it("answers for every kind of ground, so no caller has to invent an answer", () => {
    expect(cellCapabilitiesFor("BLOCKED", "CIVIC")).toEqual([]);
    expect(cellCapabilitiesFor("WATER", "NONE")).toEqual([]);
    expect(cellCapabilitiesFor("WATER", "AQUACULTURE")).toEqual(["AQUACULTURE"]);
    expect(cellCapabilitiesFor("SHORE", "NONE")).toEqual(["WALK", "DOCK"]);
    expect(cellCapabilitiesFor("LAND", "NONE")).toEqual(DEVELOPABLE);
  });

  it("gives dry land every developable use, whether or not a district is drawn over it", () => {
    // The district is scenery. Two cells of the same ground answer the same way wherever they are.
    for (const zone of ["NONE", "AGRICULTURE", "FORESTRY", "CIVIC", "MINING", "WILDERNESS"] as const) {
      expect(cellCapabilitiesFor("LAND", zone)).toEqual(DEVELOPABLE);
    }
  });

  it("keeps the sea out of reach and the beach usable", () => {
    expect(cellCapabilitiesFor("WATER", "NONE")).not.toContain("BUILD");
    expect(cellCapabilitiesFor("WATER", "NONE")).not.toContain("FARM");
    expect(cellCapabilitiesFor("WATER", "AQUACULTURE")).not.toContain("WALK");
    expect(cellCapabilitiesFor("SHORE", "NONE")).not.toContain("FARM");
  });

  it("is independent of the reservation the plot catalogue sells", () => {
    // Capability is a fact about the ground. Which cells may actually be planted is still the
    // reservation plus the server, and this rule must not quietly restate either.
    const scene = starterScene();
    const inside = worldCellAt(scene.cells, FARM_FIELD_BOUNDS.minX, FARM_FIELD_BOUNDS.minY);
    const outsideReserve = [...scene.cells.cells.values()].find(
      (cell) =>
        cell.terrain === "LAND" &&
        (cell.x < FARM_FIELD_BOUNDS.minX ||
          cell.x > FARM_FIELD_BOUNDS.maxX ||
          cell.z < FARM_FIELD_BOUNDS.minY ||
          cell.z > FARM_FIELD_BOUNDS.maxY)
    );
    expect(inside).not.toBeNull();
    expect(outsideReserve).toBeDefined();
    expect(inside?.capabilities).toEqual(outsideReserve?.capabilities);
    expect(outsideReserve?.legacyFarmTile).toBeNull();
  });

  it("marks the ground a building stands on as unusable rather than as developable", () => {
    const scene = starterScene();
    const blocked = [...scene.cells.cells.values()].filter((cell) => cell.terrain === "BLOCKED");
    expect(blocked.length).toBeGreaterThan(0);
    for (const cell of blocked) {
      expect(cell.capabilities).toEqual([]);
      expect(cellHasCapability(cell, "WALK")).toBe(false);
      expect(cellHasCapability(cell, "BUILD")).toBe(false);
    }
  });

  it("names the vocabulary the build catalogue uses, no more and no fewer", () => {
    const seen = new Set<CellCapability>();
    for (const terrain of ["LAND", "SHORE", "WATER", "BLOCKED"] as const) {
      for (const zone of ["NONE", "AGRICULTURE", "AQUACULTURE", "FORESTRY", "MINING", "CIVIC", "WILDERNESS"] as const) {
        for (const capability of cellCapabilitiesFor(terrain, zone)) seen.add(capability);
      }
    }
    expect([...seen].sort()).toEqual(
      ["AQUACULTURE", "BUILD", "DECORATION", "DOCK", "FARM", "FORESTRY", "LIVESTOCK", "ROAD", "WALK"].sort()
    );
  });
});
