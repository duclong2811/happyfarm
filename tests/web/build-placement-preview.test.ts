import { describe, expect, it } from "vitest";
import { rotatedFootprint } from "../../apps/web/src/build-shop/shop-state";
import {
  footprintCells,
  previewRejection,
  rejectionMessageKey,
  type PreviewRejection,
  type PreviewRequirement
} from "../../apps/web/src/render/placement-preview";
import { cellKey, EMPTY_WORLD_CELL_MAP, type WorldCell } from "../../apps/web/src/render/world-cell";

/**
 * Where the build shop is allowed to say a thing may go.
 *
 * This rule is the shop's promise: what the ghost shows has to be what the server will agree to. It
 * is written over the WorldCell map - the same map the renderer draws from - so there is no second
 * opinion about what ground is, whose it is, or what already stands on it.
 *
 * It is also where the freeform rule is pinned: there is no FARM, FORESTRY, BUILD or DECORATION
 * capability anywhere in these requirements, because land use belongs to the player and not to the
 * map. What an entry names is the ground it physically needs.
 */

function cell(x: number, z: number, overrides: Partial<WorldCell> = {}): WorldCell {
  return {
    x,
    z,
    terrain: "LAND",
    zone: "NONE",
    owned: true,
    shallowWater: false,
    reserved: false,
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
  allowedTerrain: ["LAND"],
  footprint: { widthCells: 1, depthCells: 1 },
  isRoad: false,
  requiresOwnership: true
};

const road: PreviewRequirement = {
  allowedTerrain: ["LAND"],
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
    expect(previewRejection(mapOf(cell(1, 1)), { x: 99, y: 99 }, building)).toBe("OUT_OF_WORLD");
    expect(
      previewRejection(mapOf(cell(1, 1)), { x: 1, y: 1 }, { ...building, footprint: { widthCells: 2, depthCells: 2 } })
    ).toBe("OUT_OF_WORLD");
  });

  it("refuses ground something already stands on, and ground the island keeps", () => {
    expect(previewRejection(mapOf(cell(1, 1, { occupancy: "BUILDING" })), { x: 1, y: 1 }, building)).toBe("OCCUPIED");
    expect(previewRejection(mapOf(cell(1, 1, { occupancy: "SCENERY" })), { x: 1, y: 1 }, building)).toBe("OCCUPIED");
    // A world building, a reserved plot and the crater are all "not yours to change".
    expect(previewRejection(mapOf(cell(1, 1, { terrain: "BLOCKED" })), { x: 1, y: 1 }, building)).toBe("BLOCKED");
    expect(previewRejection(mapOf(cell(1, 1, { reserved: true })), { x: 1, y: 1 }, building)).toBe("BLOCKED");
    expect(previewRejection(mapOf(cell(1, 1, { terrain: "VOLCANO" })), { x: 1, y: 1 }, building)).toBe("BLOCKED");
  });

  it("refuses the wrong ground, but lets a water item use water", () => {
    const sea = cell(2, 2, { terrain: "WATER", shallowWater: true, owned: false });
    expect(previewRejection(mapOf(sea), { x: 2, y: 2 }, building)).toBe("NOT_OWNED");
    // A moored asset asks for the shallows, and the shallows are what it gets.
    const cage: PreviewRequirement = {
      allowedTerrain: ["SHALLOW_WATER"],
      footprint: { widthCells: 1, depthCells: 1 },
      isRoad: false,
      // A cage is moored on water, which nobody owns in land terms yet: this entry does not ask.
      requiresOwnership: false
    };
    expect(previewRejection(mapOf(sea), { x: 2, y: 2 }, cage)).toBeNull();
    // Open water is not the shelf a cage is moored in.
    expect(previewRejection(mapOf(cell(2, 2, { terrain: "WATER", shallowWater: false })), { x: 2, y: 2 }, cage)).toBe(
      "INVALID_TERRAIN"
    );
    // And a cage cannot be walked onto dry land, which is the mirror image of the same rule.
    expect(previewRejection(mapOf(cell(3, 3)), { x: 3, y: 3 }, cage)).toBe("INVALID_TERRAIN");
    // A beach is neither: only something that asks for the shore may stand on it.
    expect(previewRejection(mapOf(cell(4, 4, { terrain: "SHORE" })), { x: 4, y: 4 }, building)).toBe("INVALID_TERRAIN");
    expect(
      previewRejection(mapOf(cell(4, 4, { terrain: "SHORE" })), { x: 4, y: 4 }, { ...building, allowedTerrain: ["SHORE"] })
    ).toBeNull();
  });

  it("keeps the island's own road clear, and lets a road lie on a road", () => {
    // The starter harbour-to-village road is world infrastructure: a barn may not be built over it.
    const onRoad = cell(1, 1, { buildable: false, road: "harbour_spine" });
    expect(previewRejection(mapOf(onRoad), { x: 1, y: 1 }, building)).toBe("BLOCKED");
    // A road on a road is the one overlap that is allowed: a tier upgrade happens in place.
    expect(previewRejection(mapOf(onRoad), { x: 1, y: 1 }, road)).toBeNull();
  });

  it("refuses land the player does not own when the entry asks for owned land", () => {
    const unowned = cell(1, 1, { owned: false, legacyFarmTile: null });
    expect(previewRejection(mapOf(unowned), { x: 1, y: 1 }, building)).toBe("NOT_OWNED");
    const civic: PreviewRequirement = { ...building, requiresOwnership: false };
    expect(previewRejection(mapOf(unowned), { x: 1, y: 1 }, civic)).toBeNull();
  });

  it("allows an ordinary owned land cell, which is the common case - for every ordinary asset", () => {
    expect(previewRejection(mapOf(cell(6, 6)), { x: 6, y: 6 }, building)).toBeNull();
    expect(previewRejection(mapOf(cell(6, 6)), { x: 6, y: 6 }, road)).toBeNull();
    // The bug the freeform pass exists for: a broadleaf tree, a crop or a decoration on a plain owned
    // cell. Nothing about that cell is a district, and nothing has to be.
    for (const allowedTerrain of [["LAND"]] as const) {
      expect(previewRejection(mapOf(cell(6, 6)), { x: 6, y: 6 }, { ...building, allowedTerrain })).toBeNull();
    }
  });

  it("checks every cell of a footprint, including the far corner", () => {
    const strip = [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1)];
    // The far corner is unowned; a rule that only looked at the anchor would call this legal.
    const withCornerUnowned = strip.map((entry) => (entry.x === 2 && entry.z === 1 ? { ...entry, owned: false } : entry));
    expect(
      previewRejection(mapOf(...withCornerUnowned), { x: 1, y: 0 }, { ...building, footprint: { widthCells: 3, depthCells: 2 } })
    ).toBe("NOT_OWNED");
    expect(
      previewRejection(mapOf(...strip), { x: 1, y: 0 }, { ...building, footprint: { widthCells: 3, depthCells: 2 } })
    ).toBeNull();
  });

  it("treats the object being moved as free ground, and nothing else", () => {
    // A move re-checks the ground around the thing being moved, so the thing's own cells must not
    // count as obstacles - otherwise no object could ever be turned in place.
    const occupied = cell(4, 4, { occupancy: "BUILDING" });
    expect(previewRejection(mapOf(occupied), { x: 4, y: 4 }, building)).toBe("OCCUPIED");
    expect(previewRejection(mapOf(occupied), { x: 4, y: 4 }, { ...building, ignore: [{ x: 4, y: 4 }] })).toBeNull();
  });
});

describe("the reason line", () => {
  it("has its own message for every refusal, and never reuses one", () => {
    const reasons: readonly PreviewRejection[] = [
      "NO_CELL",
      "OUT_OF_WORLD",
      "NOT_OWNED",
      "BLOCKED",
      "OCCUPIED",
      "INVALID_TERRAIN"
    ];
    const keys = reasons.map((reason) => rejectionMessageKey(reason));
    expect(new Set(keys).size).toBe(reasons.length);
    for (const key of keys) {
      expect(key.startsWith("build.reason.")).toBe(true);
    }
  });
});

describe("a rotated footprint", () => {
  /** A three-wide, two-deep strip of owned land: enough for a 3x2 item and not for a 2x3 one. */
  function wideStrip(): typeof EMPTY_WORLD_CELL_MAP {
    const cells: WorldCell[] = [];
    for (let x = 0; x < 3; x += 1) {
      for (let y = 0; y < 2; y += 1) cells.push(cell(x, y));
    }
    return mapOf(...cells);
  }

  const barn: PreviewRequirement = {
    allowedTerrain: ["LAND"],
    footprint: { widthCells: 2, depthCells: 3 },
    isRoad: false,
    requiresOwnership: true
  };

  it("is what the rule checks, not the catalogue's own numbers", () => {
    const map = wideStrip();
    // Upright, the barn needs three cells of depth and the strip has two.
    expect(previewRejection(map, { x: 1, y: 0 }, barn)).toBe("OUT_OF_WORLD");
    // Turned a quarter, the same barn is three wide and two deep, which is exactly the strip.
    const turned = rotatedFootprint(barn.footprint, 1);
    expect(previewRejection(map, { x: 1, y: 0 }, { ...barn, footprint: turned })).toBeNull();
  });

  it("returns to the catalogue's own footprint after a half turn", () => {
    expect(rotatedFootprint(barn.footprint, 2)).toEqual(barn.footprint);
  });
});
