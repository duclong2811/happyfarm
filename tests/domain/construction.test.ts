import { describe, expect, it } from "vitest";
import {
  boundsIntersect,
  cellsInBounds,
  constructionBounds,
  constructionRefusal,
  createConstructionInstance,
  normaliseQuarterTurns,
  rotatedFootprint,
  type ConstructionCell,
  type ConstructionDefinition
} from "@happy-farm/domain";
import { parseConstructionId, parseFarmId, parsePlayerId } from "@happy-farm/domain";

/**
 * The construction rules, held to the promises the server makes on the shop's behalf.
 *
 * A preview may be wrong; this may not. Every refusal here is a refusal the API returns, and every
 * rectangle here is a rectangle the ledger and the tick both charge against.
 */

const definition: ConstructionDefinition = {
  entryId: "place_barn_t1",
  category: "BUILDING",
  requiredLevel: 1,
  price: 900,
  currencyDefinitionId: "currency_gold",
  footprint: { widthCells: 4, depthCells: 3 },
  capability: "BUILD",
  rotatable: true,
  status: "ACTIVE",
  requiresOwnership: true
};

function cell(x: number, y: number, overrides: Partial<ConstructionCell> = {}): ConstructionCell {
  return {
    x,
    y,
    owned: true,
    terrain: "LAND",
    capabilities: ["WALK", "BUILD", "FARM", "FORESTRY", "LIVESTOCK", "ROAD", "DECORATION"],
    occupied: false,
    ...overrides
  };
}

function cellsFor(
  bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number },
  overrides: Partial<ConstructionCell> = {}
): readonly ConstructionCell[] {
  return cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y, overrides));
}

describe("footprints and rotation", () => {
  it("turns a rectangle a quarter turn at a time", () => {
    const footprint = { widthCells: 4, depthCells: 3 };
    expect(rotatedFootprint(footprint, 0)).toEqual(footprint);
    expect(rotatedFootprint(footprint, 1)).toEqual({ widthCells: 3, depthCells: 4 });
    expect(rotatedFootprint(footprint, 2)).toEqual(footprint);
    expect(rotatedFootprint(footprint, 3)).toEqual({ widthCells: 3, depthCells: 4 });
  });

  it("wraps integer turns and refuses anything else", () => {
    expect(normaliseQuarterTurns(-1)).toBe(3);
    expect(normaliseQuarterTurns(4)).toBe(0);
    expect(() => normaliseQuarterTurns(1.5)).toThrow();
  });

  it("anchors an even footprint on the cell the player pointed at", () => {
    expect(constructionBounds({ x: 10, y: 10 }, { widthCells: 1, depthCells: 1 })).toEqual({
      minX: 10,
      maxX: 10,
      minY: 10,
      maxY: 10
    });
    expect(constructionBounds({ x: 10, y: 10 }, { widthCells: 2, depthCells: 2 })).toEqual({
      minX: 10,
      maxX: 11,
      minY: 10,
      maxY: 11
    });
    expect(constructionBounds({ x: 10, y: 10 }, { widthCells: 3, depthCells: 3 })).toEqual({
      minX: 9,
      maxX: 11,
      minY: 9,
      maxY: 11
    });
  });

  it("knows when two placements would share ground", () => {
    const left = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    expect(boundsIntersect(left, { minX: 2, maxX: 3, minY: 2, maxY: 3 })).toBe(true);
    expect(boundsIntersect(left, { minX: 3, maxX: 4, minY: 0, maxY: 2 })).toBe(false);
    expect(boundsIntersect(left, { minX: 0, maxX: 2, minY: 3, maxY: 4 })).toBe(false);
  });
});

describe("what may be built where", () => {
  const bounds = constructionBounds({ x: 10, y: 10 }, definition.footprint);

  function check(overrides: Partial<Parameters<typeof constructionRefusal>[0]> = {}) {
    return constructionRefusal({
      definition,
      footprint: definition.footprint,
      cells: cellsFor(bounds),
      occupied: [],
      playerLevel: 5,
      balance: 10_000,
      ...overrides
    });
  }

  it("allows a placement on owned land the player can afford", () => {
    expect(check()).toBeNull();
  });

  it("refuses a level the player has not reached", () => {
    expect(check({ definition: { ...definition, requiredLevel: 8 } })).toBe("LEVEL_REQUIRED");
  });

  it("refuses a price the player cannot pay", () => {
    expect(check({ balance: 899 })).toBe("INSUFFICIENT_FUNDS");
  });

  it("refuses ground the farm does not own", () => {
    expect(check({ cells: cellsFor(bounds, { owned: false }) })).toBe("NOT_OWNED");
  });

  it("refuses a footprint that leaves the island", () => {
    const cells = cellsFor(bounds).slice(0, 5);
    expect(check({ cells })).toBe("OUTSIDE_ISLAND");
  });

  it("refuses water for a building and allows it for an aquaculture cage", () => {
    expect(check({ cells: cellsFor(bounds, { terrain: "WATER" }) })).toBe("WRONG_GROUND");
    const cage: ConstructionDefinition = { ...definition, capability: "AQUACULTURE", requiresOwnership: false };
    expect(check({ definition: cage, cells: cellsFor(bounds, { terrain: "WATER", capabilities: ["AQUACULTURE"] }) })).toBeNull();
  });

  it("refuses the volcano and cells something already occupies", () => {
    expect(check({ cells: cellsFor(bounds, { terrain: "VOLCANO" }) })).toBe("VOLCANO");
    expect(check({ cells: cellsFor(bounds, { occupied: true }) })).toBe("OCCUPIED");
    expect(check({ occupied: [{ minX: 11, maxX: 12, minY: 10, maxY: 11 }] })).toBe("OCCUPIED");
  });

  it("refuses ground that cannot carry the thing", () => {
    expect(check({ cells: cellsFor(bounds, { capabilities: ["WALK"] }) })).toBe("NEEDS_CAPABILITY");
  });

  it("refuses a preview-only entry outright", () => {
    expect(check({ definition: { ...definition, status: "PREVIEW_ONLY" } })).toBe("NOT_CONSTRUCTIBLE");
  });
});

describe("the row a placement creates", () => {
  it("records the catalogue's own price and the rotated footprint", () => {
    const instance = createConstructionInstance({
      id: parseConstructionId("construct_11111111-1111-4111-8111-111111111111"),
      farmId: parseFarmId("farm_11111111-1111-4111-8111-111111111111"),
      definition,
      anchor: { x: 10, y: 10 },
      rotation: 1,
      builtByPlayerId: parsePlayerId("player_11111111-1111-4111-8111-111111111111"),
      createdAt: "2026-10-01T00:00:00.000Z"
    });
    expect(instance.costAmount).toBe(900);
    expect(instance.footprint).toEqual({ widthCells: 3, depthCells: 4 });
    expect(instance.bounds).toEqual({ minX: 9, maxX: 11, minY: 9, maxY: 12 });
    expect(instance.state).toBe("BUILT");
  });
});
