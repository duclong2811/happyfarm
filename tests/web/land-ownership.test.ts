import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import {
  EXPANSION_PARCEL_CELLS,
  buildLandOwnership,
  ownedShare,
  type LandOwnership
} from "../../apps/web/src/render/land-ownership";
import { cellKey } from "../../apps/web/src/render/world-cell";

/**
 * Starter ground, and the ground that could come next.
 *
 * The island gives the player a small piece of land and a way to grow it. These are the promises that
 * makes: the starter land is theirs and nothing else's, it is one piece rather than a scatter, the
 * island's own protected places are never for sale, and the only parcels that can come next are the
 * ones next to what they already have.
 *
 * Ownership here is a projection of the server's land, so the *share* it reports is a measurement
 * rather than a decision - see the note at the end of this file.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_own",
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

function starterTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

function ownershipFor(owned: { x: number; y: number }[]): LandOwnership {
  const scene = buildFarmSceneInput({
    tiles: owned.map((entry) => tile(entry.x, entry.y)),
    crops: [],
    trees: [],
    plots: [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1)),
    selected: null
  });
  return buildLandOwnership({ cells: scene.cells, ownedTiles: owned });
}

const STARTER = starterTiles();
const OWNERSHIP = ownershipFor(STARTER);

describe("starter ownership", () => {
  it("exists, and belongs to the player", () => {
    expect(OWNERSHIP.ownedCellCount).toBe(STARTER.length);
    expect(OWNERSHIP.ownedBlocks.length).toBeGreaterThan(0);
    for (const entry of STARTER) {
      expect(OWNERSHIP.ownedCells.has(cellKey(entry.x, entry.y))).toBe(true);
    }
  });

  it("is one piece of ground rather than a scatter", () => {
    // Contiguous: every owned cell is one step from another owned cell, so the starter land is a
    // single territory rather than a set of islands.
    const owned = OWNERSHIP.ownedCells;
    for (const key of owned) {
      const [x, y] = key.split(",").map(Number);
      let neighbours = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const) {
        if (owned.has(cellKey((x ?? 0) + dx, (y ?? 0) + dy))) neighbours += 1;
      }
      expect(neighbours, `owned cell ${key} has no owned neighbour`).toBeGreaterThan(0);
    }
  });

  it("never includes the sea, the lake, or a beach", () => {
    const { cells } = buildFarmSceneInput({
      tiles: STARTER.map((entry) => tile(entry.x, entry.y)),
      crops: [],
      trees: [],
      plots: [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1)),
      selected: null
    });
    for (const entry of STARTER) {
      const cell = cells.cells.get(cellKey(entry.x, entry.y));
      expect(cell, `${String(entry.x)},${String(entry.y)}`).toBeDefined();
      expect(cell?.terrain).toBe("LAND");
    }
  });

  it("never includes the volcano's crater", () => {
    const coreOwned = [...OWNERSHIP.ownedCells].filter((key) => {
      const [x, y] = key.split(",").map(Number);
      const state = OWNERSHIP.blocks.find((block) => block.block.id === blockIdFor(x ?? 0, y ?? 0));
      return state?.protectedReason === "VOLCANO";
    });
    expect(coreOwned).toEqual([]);
    expect(OWNERSHIP.blocks.some((block) => block.protectedReason === "VOLCANO")).toBe(true);
  });

  it("never includes the village's buildings or its square", () => {
    for (const block of OWNERSHIP.blocks) {
      if (block.owned) expect(block.protectedReason, block.block.id).toBeNull();
    }
    expect(OWNERSHIP.blocks.filter((block) => block.protectedReason === "VILLAGE").length).toBeGreaterThan(0);
  });

  it("reports the share of developable land the player starts with", () => {
    const share = ownedShare(OWNERSHIP);
    expect(OWNERSHIP.developableCellCount).toBeGreaterThan(OWNERSHIP.ownedCellCount);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.05);
    // See the note below: the 8-12% the brief asks for is a *server* decision, and the client may not
    // make it. This test pins what the shipped starter square actually is so the gap stays visible.
  });
});

describe("expansion blocks", () => {
  it("has stable ids, derived from the parcel grid", () => {
    const again = ownershipFor(STARTER);
    expect(again.blocks.map((block) => block.block.id)).toEqual(OWNERSHIP.blocks.map((block) => block.block.id));
    for (const block of OWNERSHIP.blocks) {
      expect(block.block.id).toMatch(/^parcel_-?\d+_-?\d+$/);
      expect(block.block.cells).toHaveLength(EXPANSION_PARCEL_CELLS * EXPANSION_PARCEL_CELLS);
    }
  });

  it("divides the island into parcels of a size a player can buy", () => {
    // The brief asks for parcels of 4-16 cells: big enough to be a decision, small enough to be one.
    expect(EXPANSION_PARCEL_CELLS * EXPANSION_PARCEL_CELLS).toBeGreaterThanOrEqual(4);
    expect(EXPANSION_PARCEL_CELLS * EXPANSION_PARCEL_CELLS).toBeLessThanOrEqual(16);
  });

  it("offers only the parcels next to the player's own ground", () => {
    expect(OWNERSHIP.eligibleBlocks.length).toBeGreaterThan(0);
    for (const id of OWNERSHIP.eligibleBlocks) {
      const state = OWNERSHIP.blocks.find((block) => block.block.id === id);
      expect(state?.owned).toBe(false);
      expect(state?.adjacentToOwned).toBe(true);
      expect(state?.developable).toBe(true);
      expect(state?.protectedReason).toBeNull();
    }
    // ...and every parcel more than one step away is not eligible.
    const eligible = new Set(OWNERSHIP.eligibleBlocks);
    for (const block of OWNERSHIP.blocks) {
      if (block.owned || block.adjacentToOwned) continue;
      expect(eligible.has(block.block.id), block.block.id).toBe(false);
    }
  });

  it("never offers a protected parcel", () => {
    for (const block of OWNERSHIP.blocks) {
      if (block.protectedReason === null) continue;
      expect(block.eligible, `${block.block.id} is ${block.protectedReason}`).toBe(false);
      expect(block.owned, block.block.id).toBe(false);
    }
  });

  it("is deterministic: the same farm offers the same parcels in the same order", () => {
    expect(ownershipFor(STARTER)).toEqual(OWNERSHIP);
  });
});

/** The id of the parcel a cell falls in, for tests that reason about one cell at a time. */
function blockIdFor(x: number, y: number): string {
  return `parcel_${String(Math.floor(x / EXPANSION_PARCEL_CELLS))}_${String(
    Math.floor(y / EXPANSION_PARCEL_CELLS)
  )}`;
}

/*
 * KNOWN GAP, recorded rather than hidden.
 *
 * The brief asks the starter land to be 8-12% of the island's developable land. The shipped starter
 * square is what the *server* grants on farm creation (`INITIAL_LAND_SIZE` = 12, so 144 cells), which
 * on this island is on the order of one and a half per cent. Raising it is not a client change: it
 * moves plot geometry, the plot catalogue, and every existing farm's `farm_tiles`, and it would need a
 * migration. This pass is explicitly forbidden from running one, so the number above is measured and
 * reported instead of quietly "fixed" by inventing a second idea of ownership on the client.
 */
