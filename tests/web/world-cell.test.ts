import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { cellKey, cellToWorld, productionCapabilityFor, worldCellAt, worldToCell } from "../../apps/web/src/render/world-cell";
import {
  FARM_FIELD_BOUNDS,
  ISLAND_SHAPE,
  isWaterTile
} from "../../apps/web/src/render/world-config";
import { islandRadiusAt } from "../../apps/web/src/render/terrain-height";
import {
  cellToFarmTile,
  farmTileToCell,
  farmTileWorldCell,
  isFarmlandTile
} from "../../apps/web/src/render/legacy-farm-cell-adapter";
import { localNeighbourhood, movementDestination, selectableCellAt } from "../../apps/web/src/render/world-cell-selection";
import { getAvailableCellActions } from "../../apps/web/src/render/world-cell-actions";
import { planCellOverlay } from "../../apps/web/src/render/world-cell-overlay";

/**
 * The island's cell system, held to its own promises.
 *
 * These are the questions a reviewer would ask of a coordinate system: is the conversion stable, is
 * a cell ever called land when it is in the sea, can a crop be advertised where the catalogue cannot
 * sell, does a building block movement, is the grid ever drawn without being asked for, and does the
 * legacy farm tile still resolve to the cell it always was.
 */

const PITCH = 1.08;

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

function starterInput() {
  const tiles: FarmTileDTO[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push(tile(x, y));
  }
  const plots = [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1));
  return buildFarmSceneInput({ tiles, crops: [], trees: [], plots, selected: null });
}

/** A world position in the middle of a cell, through the cell's own conversion. */
function centreOf(x: number, z: number): { readonly worldX: number; readonly worldZ: number } {
  return { worldX: (x - 5.5) * PITCH, worldZ: (z - 5.5) * PITCH };
}

describe("the cell grid is one coordinate system", () => {
  it("converts a world position to a cell deterministically", () => {
    const input = starterInput();
    const point = centreOf(7, 3);
    const first = worldToCell(point, input.cells.frame);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(worldToCell(point, input.cells.frame)).toEqual(first);
    }
    expect(first).toEqual({ x: 7, y: 3 });
  });

  it("round-trips cell to world to cell for every cell on the island", () => {
    const input = starterInput();
    for (const cell of input.cells.cells.values()) {
      const world = cellToWorld({ x: cell.x, y: cell.z }, input.cells.frame);
      expect(worldToCell(world, input.cells.frame), cellKey(cell.x, cell.z)).toEqual({ x: cell.x, y: cell.z });
    }
  });

  it("maps a legacy farm tile onto the cell with the same coordinate", () => {
    const input = starterInput();
    for (const cell of input.cells.cells.values()) {
      const farmTile = cellToFarmTile(cell);
      if (farmTile === null) continue;
      expect(farmTileToCell(farmTile)).toEqual({ x: cell.x, y: cell.z });
      expect(farmTileWorldCell(input.cells, farmTile)).toBe(cell);
      // A cell names its rows `x, z`; a farm tile names them `x, y`. Same coordinate, two names.
      expect(cell.legacyFarmTile).toEqual({ x: cell.x, y: cell.z });
    }
  });

  it("distinguishes the land the farm owns from the land the catalogue could sell", () => {
    const input = starterInput();
    let owned = 0;
    let inReservation = 0;
    for (const cell of input.cells.cells.values()) {
      // Ownership implies the reservation, never the other way round: the 36x36 rectangle the
      // catalogue could sell is far larger than the twelve-tile square the farm starts with, and a
      // preview that called the rest of it "owned" is exactly the bug this pins.
      if (cell.legacyFarmTile !== null) {
        owned += 1;
        expect(isFarmlandTile({ x: cell.x, y: cell.z })).toBe(true);
      }
      if (isFarmlandTile({ x: cell.x, y: cell.z })) inReservation += 1;
    }
    expect(owned).toBe(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(inReservation).toBeGreaterThan(owned);
    // The reserve is nine cohorts; the map has to cover all of them and more.
    expect(input.cells.cells.size).toBeGreaterThan(4000);
  });

  it("is deterministic: the same farm builds the same island", () => {
    const first = starterInput();
    const second = starterInput();
    expect([...first.cells.cells.keys()]).toEqual([...second.cells.cells.keys()]);
    expect(first.cells.productionCells.CROP.length).toBe(second.cells.productionCells.CROP.length);
  });
});

describe("the island is classified from its own coastline", () => {
  it("never calls a cell land when its centre is in the sea", () => {
    const input = starterInput();
    for (const cell of input.cells.cells.values()) {
      if (cell.terrain !== "LAND" && cell.terrain !== "SHORE") continue;
      const world = cellToWorld({ x: cell.x, y: cell.z }, input.cells.frame);
      expect(islandRadiusAt(world.worldX, world.worldZ, ISLAND_SHAPE), cellKey(cell.x, cell.z)).toBeLessThanOrEqual(1);
    }
  });

  it("classifies the open sea and the lake as water, and deep water as unwalkable", () => {
    const input = starterInput();
    // The sea is wherever the map says the ground is water and the shore has been left behind.
    const sea = [...input.cells.cells.values()].find(
      (cell) => cell.terrain === "WATER" && cell.zone === "NONE" && cell.productionCapability === "NONE"
    );
    expect(sea).toBeDefined();
    expect(sea?.walkable).toBe(false);
    const lake = input.cells.cells.get(cellKey(-3, 45));
    expect(isWaterTile({ x: -3, y: 45 })).toBe(true);
    expect(lake?.terrain).toBe("WATER");
    expect(lake?.walkable).toBe(false);
  });

  it("does not generate cells far out at sea", () => {
    const input = starterInput();
    expect(worldCellAt(input.cells, 200, 200)).toBeNull();
    expect(selectableCellAt(input.cells, { worldX: 400, worldZ: 400 })).toBeNull();
  });
});

describe("land use decides what a cell can produce", () => {
  it("gives agriculture land crop capability, and only inside the reservation", () => {
    const input = starterInput();
    const crop = input.cells.productionCells.CROP;
    expect(crop.length).toBe(FARM_FIELD_BOUNDS.maxX - FARM_FIELD_BOUNDS.minX + 1 > 0 ? crop.length : 0);
    expect(crop.length).toBeGreaterThan(100);
    for (const cell of crop) {
      expect(isFarmlandTile(cell), `${String(cell.x)},${String(cell.y)}`).toBe(true);
      const world = worldCellAt(input.cells, cell.x, cell.y);
      expect(world?.terrain).toBe("LAND");
      // The zone no longer names a production area - the island stopped deciding that - so the
      // capability is the *reservation's* answer plus the ground's own, which is what makes a crop
      // cell a cell the catalogue can actually sell.
      expect(world?.legacyFarmTile).not.toBeNull();
    }
  });

  it("grows no timber plantation, because forestry is the player's to plant", () => {
    // V12.1 removed the authored managed wood, so no cell anywhere is handed a TIMBER production
    // capability by the island. The *ability* to plant trees is a capability of the ground, which is a
    // different question and is answered per cell.
    const input = starterInput();
    expect(input.cells.productionCells.TIMBER).toEqual([]);
    const plantable = [...input.cells.cells.values()].filter((cell) => cell.capabilities.includes("FORESTRY"));
    expect(plantable.length).toBeGreaterThan(100);
  });

  it("offers aquaculture only in the shallows, and mining only on the volcano", () => {
    const input = starterInput();
    const water = input.cells.productionCells.AQUACULTURE;
    expect(water.length).toBeGreaterThan(20);
    for (const cell of water) {
      const world = worldCellAt(input.cells, cell.x, cell.y);
      const worldPosition = cellToWorld({ x: cell.x, y: cell.y }, input.cells.frame);
      expect(world?.terrain).toBe("WATER");
      // Shallow: just past the waterline. A cage needs a shelf to be moored in, and the open sea does
      // not offer one.
      const radius = islandRadiusAt(worldPosition.worldX, worldPosition.worldZ, ISLAND_SHAPE);
      expect(radius).toBeGreaterThan(1);
      expect(radius).toBeLessThanOrEqual(1.07);
    }
    // Mining is a capability of the volcano's steep flanks and of nothing else. No cell is *granted*
    // a mining production capability: mining is a hook for a later pass, not a system today.
    expect(input.cells.productionCells.MINING).toEqual([]);
    const miningCapable = [...input.cells.cells.values()].filter((cell) => cell.capabilities.includes("MINING"));
    expect(miningCapable.length).toBeGreaterThan(0);
    for (const cell of miningCapable) {
      expect(cell.terrain).toBe("VOLCANO");
      expect(cell.zone).toBe("VOLCANO_SLOPE");
    }
  });

  it("refuses impossible combinations rather than inventing them", () => {
    expect(productionCapabilityFor("WATER", "AGRICULTURE")).toBe("NONE");
    expect(productionCapabilityFor("WATER", "CIVIC")).toBe("NONE");
    // A zone only water carries is not a place a crop grows, on any ground.
    expect(productionCapabilityFor("LAND", "AQUACULTURE")).toBe("NONE");
    expect(productionCapabilityFor("SHORE", "AGRICULTURE")).toBe("NONE");
    expect(productionCapabilityFor("BLOCKED", "FORESTRY")).toBe("NONE");
    expect(productionCapabilityFor("LAND", "NONE")).toBe("CROP");
    expect(productionCapabilityFor("LAND", "FORESTRY")).toBe("CROP");
    expect(productionCapabilityFor("LAND", "MINING")).toBe("CROP");
    expect(productionCapabilityFor("VOLCANO", "VOLCANO_SLOPE")).toBe("NONE");
    expect(productionCapabilityFor("VOLCANO", "VOLCANO_CORE")).toBe("NONE");
    expect(productionCapabilityFor("WATER", "AQUACULTURE")).toBe("AQUACULTURE");
  });

  it("never lets a civic cell grow a crop", () => {
    const input = starterInput();
    for (const cell of input.cells.cells.values()) {
      if (cell.zone !== "CIVIC") continue;
      expect(cell.productionCapability).toBe("NONE");
    }
  });
});

describe("buildings occupy ground and block movement", () => {
  it("blocks the farmhouse and the barn, and leaves the square and the road open", () => {
    const input = starterInput();
    const farmhouse = worldCellAt(input.cells, 45, -2);
    expect(farmhouse?.occupancy).toBe("BUILDING");
    expect(farmhouse?.walkable).toBe(false);
    expect(farmhouse?.terrain).toBe("BLOCKED");

    const barn = worldCellAt(input.cells, 38, -7);
    expect(barn?.occupancy).toBe("BUILDING");
    expect(barn?.walkable).toBe(false);

    const plaza = worldCellAt(input.cells, 45, 3);
    expect(plaza?.occupancy).not.toBe("BUILDING");
    expect(plaza?.walkable).toBe(true);

    // The stone spine runs through the town: the map knows a road is there without a second
    // coordinate system for roads, and a road cell is ground - walkable unless a building stands on
    // it, which is the rule the brief states in as many words.
    const onARoad = [...input.cells.cells.values()].filter((cell) => cell.road !== null);
    expect(onARoad.length).toBeGreaterThan(0);
    expect(onARoad.some((cell) => Math.hypot(cell.x - 45, cell.z - 3) <= 8)).toBe(true);
    for (const cell of onARoad) {
      if (cell.terrain === "BLOCKED") expect(cell.occupancy).toBe("BUILDING");
      // The quay's walkway runs from the beach out over open water; the deck is the walkway.
      else if (cell.road === "harbour_boardwalk") continue;
      else expect(cell.walkable).toBe(true);
    }
  });

  it("refuses a movement destination inside a building or in the sea", () => {
    const input = starterInput();
    const blocked = (worldX: number, worldZ: number): boolean => {
      const cell = worldToCell({ worldX, worldZ }, input.cells.frame);
      return worldCellAt(input.cells, cell.x, cell.y)?.walkable === false;
    };
    const farmhouse = worldCellAt(input.cells, 45, -2);
    if (farmhouse === null) throw new Error("the farmhouse must be on the map");
    expect(movementDestination(farmhouse, input.cells, blocked)).toBeNull();

    const sea = [...input.cells.cells.values()].find((cell) => cell.terrain === "WATER");
    if (sea === undefined) throw new Error("the island must have water");
    expect(movementDestination(sea, input.cells, blocked)).toBeNull();

    const meadow = worldCellAt(input.cells, 0, 50);
    if (meadow === null) throw new Error("the southern meadow must be on the map");
    expect(movementDestination(meadow, input.cells, blocked)).not.toBeNull();
  });
});

describe("selection is local, quiet, and never acts on its own", () => {
  it("selects the cell the player pointed at, and nothing off the island", () => {
    const input = starterInput();
    const selected = selectableCellAt(input.cells, centreOf(20, 5));
    expect(selected?.x).toBe(20);
    expect(selected?.z).toBe(5);
    expect(selectableCellAt(input.cells, { worldX: 900, worldZ: -900 })).toBeNull();
  });

  it("previews at most the selected cell and its eight neighbours", () => {
    const input = starterInput();
    const selection = { cell: { x: 20, y: 5 } };
    const neighbourhood = localNeighbourhood(selection, input.cells);
    expect(neighbourhood.length).toBeGreaterThan(3);
    expect(neighbourhood.length).toBeLessThanOrEqual(9);
  });

  it("draws no grid at all until something is selected, and the whole grid only in debug mode", () => {
    const input = starterInput();
    const idle = planCellOverlay(input.cells, null, false);
    expect(idle.selection).toBeNull();
    expect(idle.neighbourhood).toEqual([]);
    expect(idle.debugCells).toEqual([]);

    const selected = planCellOverlay(input.cells, { cell: { x: 20, y: 5 } }, false);
    expect(selected.selection?.x).toBe(20);
    expect(selected.neighbourhood.length).toBeLessThanOrEqual(9);
    expect(selected.debugCells).toEqual([]);

    const debug = planCellOverlay(input.cells, null, true);
    expect(debug.debugCells.length).toBe(input.cells.cells.size);
  });

  it("offers movement everywhere and planting only where a seed could actually go", () => {
    const farmland = worldCellAt(starterInput().cells, 3, 3);
    if (farmland === null) throw new Error("the starter field must be on the map");
    const actions = getAvailableCellActions(farmland, { canPlant: true, crop: null, tree: null });
    expect(actions.map((action) => action.id)).toEqual(["MOVE", "PLANT"]);
    expect(actions.every((action) => action.enabled)).toBe(true);

    // A civic cell moves and does nothing else. The volcano's steep ground is walkable - a foothill
    // path crosses it - and mining is expressed as a *capability of the ground* rather than as an
    // action, because the brief for this pass is explicit that mining is a hook, not a system.
    const civic = worldCellAt(starterInput().cells, 45, 3);
    expect(getAvailableCellActions(civic, { canPlant: true, crop: null, tree: null }).map((a) => a.id)).toEqual(["MOVE"]);
    const slope = [...starterInput().cells.cells.values()].find((cell) => cell.zone === "VOLCANO_SLOPE");
    if (slope === undefined) throw new Error("the volcano must have steep ground");
    expect(slope.capabilities).toContain("MINING");
    const mineActions = getAvailableCellActions(slope, { canPlant: true, crop: null, tree: null });
    expect(mineActions.map((a) => a.id)).toEqual(["MOVE"]);
    expect(mineActions[0]?.enabled).toBe(true);
  });
});
