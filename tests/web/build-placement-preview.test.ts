import { describe, expect, it } from "vitest";
import {
  footprintCells,
  previewRejection,
  rejectionMessageKey,
  type PreviewRejection,
  type PreviewRequirement
} from "../../apps/web/src/render/placement-preview";
import { cellKey, EMPTY_WORLD_CELL_MAP, type CellCapability, type WorldCell } from "../../apps/web/src/render/world-cell";

/**
 * Where the build shop is allowed to say a thing may go.
 *
 * The placement command does not exist yet, so this rule is the shop's whole promise: what the ghost
 * shows has to be what the server will eventually agree to. It is written over the WorldCell map -
 * the same map the renderer draws from - so there is no second opinion about what ground is, what a
 * cell can carry, or what already stands on it.
 */

function cell(x: number, z: number, overrides: Partial<WorldCell> = {}): WorldCell {
  return {
    x,
    z,
    terrain: "LAND",
    zone: "NONE",
    walkable: true,
    buildable: true,
    occupancy: "EMPTY",
    productionCapability: "CROP",
    capabilities: ["WALK", "BUILD", "FARM", "FORESTRY", "ROAD", "DECORATION"],
    road: null,
    legacyFarmTile: { x, y: z },
    ...overrides
  };
}

function mapOf(...cells: readonly WorldCell[]): typeof EMPTY_WORLD_CELL_MAP {
  return {
    ...EMPTY_WORLD_CELL_MAP,
    cells: new Map(cells.map((entry) => [cellKey(entry.x, entry.z), entry]))
  };
}

const building: PreviewRequirement = {
  capability: "BUILD",
  footprint: { widthCells: 1, depthCells: 1 },
  isRoad: false,
  requiresOwnership: true
};

const road: PreviewRequirement = {
  capability: "ROAD",
  footprint: { widthCells: 1, depthCells: 1 },
  isRoad: true,
  requiresOwnership: true
};

describe("the cells a footprint covers", () => {
  it("is the cell itself for a single-cell item", () => {
    expect(footprintCells({ x: 4, y: 7 }, { widthCells: 1, depthCells: 1 })).toEqual([{ x: 4, y: 7 }]);
  });

  it("centres an odd footprint exactly and anchors an even one the way the world does", () => {
    const three = footprintCells({ x: 5, y: 5 }, { widthCells: 3, depthCells: 3 });
    expect(three).toHaveLength(9);
    expect(three[0]).toEqual({ x: 4, y: 4 });
    expect(three[8]).toEqual({ x: 6, y: 6 });

    const two = footprintCells({ x: 5, y: 5 }, { widthCells: 2, depthCells: 2 });
    expect(two).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 }
    ]);
  });

  it("covers exactly width times depth cells, in a stable order", () => {
    const cells = footprintCells({ x: 0, y: 0 }, { widthCells: 4, depthCells: 2 });
    expect(cells).toHaveLength(8);
    expect(new Set(cells.map((entry) => cellKey(entry.x, entry.y))).size).toBe(8);
    expect(footprintCells({ x: 0, y: 0 }, { widthCells: 4, depthCells: 2 })).toEqual(cells);
  });
});

describe("the preview rule", () => {
  it("refuses politely when nothing is selected", () => {
    expect(previewRejection(mapOf(cell(1, 1)), null, building)).toBe("NO_CELL");
  });

  it("refuses a cell that is not on the island", () => {
    expect(previewRejection(mapOf(cell(1, 1)), { x: 99, y: 99 }, building)).toBe("OUTSIDE_ISLAND");
    expect(
      previewRejection(mapOf(cell(1, 1)), { x: 1, y: 1 }, { ...building, footprint: { widthCells: 2, depthCells: 2 } })
    ).toBe("OUTSIDE_ISLAND");
  });

  it("refuses ground something already stands on", () => {
    expect(previewRejection(mapOf(cell(1, 1, { occupancy: "BUILDING" })), { x: 1, y: 1 }, building)).toBe("OCCUPIED");
    expect(previewRejection(mapOf(cell(1, 1, { terrain: "BLOCKED" })), { x: 1, y: 1 }, building)).toBe("OCCUPIED");
  });

  it("refuses the wrong ground, but lets a water item use water", () => {
    const sea = cell(2, 2, { terrain: "WATER", capabilities: ["AQUACULTURE"], legacyFarmTile: null });
    expect(previewRejection(mapOf(sea), { x: 2, y: 2 }, building)).toBe("NOT_WALKABLE_GROUND");
    const cage: PreviewRequirement = { capability: "AQUACULTURE", footprint: { widthCells: 1, depthCells: 1 }, isRoad: false, requiresOwnership: false };
    expect(previewRejection(mapOf(sea), { x: 2, y: 2 }, cage)).toBeNull();
    expect(previewRejection(mapOf(cell(3, 3, { terrain: "VOLCANO" })), { x: 3, y: 3 }, building)).toBe("NOT_WALKABLE_GROUND");
  });

  it("refuses ground that cannot carry the thing, and names a road as the reason", () => {
    const bare = cell(1, 1, { capabilities: ["WALK"] as readonly CellCapability[] });
    expect(previewRejection(mapOf(bare), { x: 1, y: 1 }, building)).toBe("NEEDS_CAPABILITY");
    // A cell a road already runs through: not buildable, but the road is why, and the player is told
    // which of the two refusals this is.
    // A road cell is still *land*: it can carry a road and the ground under it could carry a
    // building, but the road already claims it, so what is missing is permission rather than ground.
    const onRoad = cell(1, 1, { buildable: false, road: "harbour_spine" });
    expect(previewRejection(mapOf(onRoad), { x: 1, y: 1 }, building)).toBe("RESERVED");
    // A road on a road is the one overlap that is allowed: a tier upgrade happens in place.
    expect(previewRejection(mapOf(onRoad), { x: 1, y: 1 }, road)).toBeNull();
  });

  it("refuses land the player does not own when the entry asks for owned land", () => {
    const unowned = cell(1, 1, { legacyFarmTile: null });
    expect(previewRejection(mapOf(unowned), { x: 1, y: 1 }, building)).toBe("RESERVED");
    const civic: PreviewRequirement = { ...building, requiresOwnership: false };
    expect(previewRejection(mapOf(unowned), { x: 1, y: 1 }, civic)).toBeNull();
  });

  it("allows an ordinary owned land cell, which is the common case", () => {
    expect(previewRejection(mapOf(cell(6, 6)), { x: 6, y: 6 }, building)).toBeNull();
    expect(previewRejection(mapOf(cell(6, 6)), { x: 6, y: 6 }, road)).toBeNull();
  });
});

describe("the reason line", () => {
  it("has its own message for every refusal, and never reuses one", () => {
    const reasons: readonly PreviewRejection[] = [
      "NO_CELL",
      "OUTSIDE_ISLAND",
      "NOT_WALKABLE_GROUND",
      "NEEDS_CAPABILITY",
      "OCCUPIED",
      "RESERVED"
    ];
    const keys = reasons.map((reason) => rejectionMessageKey(reason));
    expect(new Set(keys).size).toBe(reasons.length);
    for (const key of keys) {
      expect(key.startsWith("build.reason.")).toBe(true);
    }
  });
});
