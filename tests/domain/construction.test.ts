import { describe, expect, it } from "vitest";
import {
  boundsIntersect,
  cellsInBounds,
  constructionBounds,
  constructionRefusal,
  createConstructionInstance,
  groundRefusal,
  moveConstruction,
  moveRefusal,
  normaliseQuarterTurns,
  removalRefund,
  removalRefusal,
  rotationRefusal,
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
  // Owned land is the whole requirement: no district, no capability, just the ground an asset needs.
  allowedTerrain: ["LAND"],
  rotatable: true,
  movable: true,
  removable: true,
  removalRefundRate: 0.5,
  status: "ACTIVE",
  requiresOwnership: true
};

function cell(x: number, y: number, overrides: Partial<ConstructionCell> = {}): ConstructionCell {
  return {
    x,
    y,
    owned: true,
    terrain: "LAND",
    shallowWater: false,
    protectedGround: false,
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

  it("refuses the volcano and cells something already occupies", () => {
    expect(check({ cells: cellsFor(bounds, { terrain: "VOLCANO" }) })).toBe("BLOCKED");
    expect(check({ cells: cellsFor(bounds, { occupied: true }) })).toBe("OCCUPIED");
    expect(check({ occupied: [{ minX: 11, maxX: 12, minY: 10, maxY: 11 }] })).toBe("OCCUPIED");
  });

  it("refuses ground the island keeps for itself", () => {
    expect(check({ cells: cellsFor(bounds, { protectedGround: true }) })).toBe("BLOCKED");
  });

  it("lets a tree, a crop or a decoration stand on any owned dry cell", () => {
    // The whole point of the freeform pass: no district, no capability, no zone. A normal owned cell
    // carries a normal asset, and the only question left is whether the ground is dry.
    const tree: ConstructionDefinition = { ...definition, footprint: { widthCells: 1, depthCells: 1 }, price: 40 };
    const one = cellsInBounds(constructionBounds({ x: 10, y: 10 }, tree.footprint)).map((entry) =>
      cell(entry.x, entry.y)
    );
    expect(constructionRefusal({ definition: tree, footprint: tree.footprint, cells: one, occupied: [], playerLevel: 1, balance: 40 })).toBeNull();
  });

  it("checks every cell of a multi-cell footprint, not only the anchor", () => {
    const cells = cellsFor(bounds);
    // The anchor and every other cell are owned; make the *far corner* unowned and the whole
    // placement has to fail, which is the bug a single-cell check would hide.
    const corner = cells[cells.length - 1];
    expect(corner).toBeDefined();
    expect(check({ cells: cells.map((cell) => (cell === corner ? { ...cell, owned: false } : cell)) })).toBe("NOT_OWNED");
  });

  it("refuses water for a building and dry land for a moored cage", () => {
    expect(check({ cells: cellsFor(bounds, { terrain: "WATER", shallowWater: true }) })).toBe("INVALID_TERRAIN");
    const cage: ConstructionDefinition = { ...definition, allowedTerrain: ["SHALLOW_WATER"], requiresOwnership: false };
    expect(check({ definition: cage, cells: cellsFor(bounds, { terrain: "WATER", shallowWater: true }) })).toBeNull();
    // A cage in the middle of dry land is the mirror image, and it is refused the same way.
    expect(check({ definition: cage, cells: cellsFor(bounds) })).toBe("INVALID_TERRAIN");
    // Open water is not the shelf a cage is moored in.
    expect(check({ definition: cage, cells: cellsFor(bounds, { terrain: "WATER", shallowWater: false }) })).toBe("INVALID_TERRAIN");
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

/**
 * Moving, turning and taking down: the rules, not the transport.
 *
 * Every one of these is a refusal the API returns or a rectangle the database writes, and each is a
 * case a player would notice getting wrong: a barn that overlaps another, a turn that leaves the farm,
 * a refund that pays more than the thing cost.
 */
describe("moving an existing object", () => {
  const instance = createConstructionInstance({
    id: parseConstructionId("construct_22222222-2222-4222-8222-222222222222"),
    farmId: parseFarmId("farm_11111111-1111-4111-8111-111111111111"),
    definition,
    anchor: { x: 10, y: 10 },
    rotation: 0,
    builtByPlayerId: parsePlayerId("player_11111111-1111-4111-8111-111111111111"),
    createdAt: "2026-10-01T00:00:00.000Z"
  });

  function editCheck(overrides: Partial<Parameters<typeof moveRefusal>[0]> = {}) {
    const footprint = definition.footprint;
    const bounds = constructionBounds({ x: 20, y: 20 }, footprint);
    return {
      definition,
      footprint,
      cells: cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y)),
      occupied: [instance.bounds],
      ignoreBounds: instance.bounds,
      ...overrides
    };
  }

  it("allows a move onto free owned ground and keeps the object's own footprint out of the way", () => {
    // The destination overlaps nothing; the *object's* old rectangle is excluded, which is why the
    // check does not refuse every move by finding the thing being moved standing in its own way.
    expect(moveRefusal(editCheck())).toBeNull();
  });

  it("refuses a move onto ground the farm does not own", () => {
    const bounds = constructionBounds({ x: 20, y: 20 }, definition.footprint);
    const cells = cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y, { owned: false }));
    expect(moveRefusal(editCheck({ cells }))).toBe("NOT_OWNED");
  });

  it("refuses a move into another object, but not into its own old cells", () => {
    expect(moveRefusal(editCheck({ occupied: [instance.bounds, { minX: 21, maxX: 22, minY: 20, maxY: 21 }] }))).toBe("OCCUPIED");
    // A move that lands *on* the object's own rectangle is the object obstructing itself: with the
    // ignore list it is legal (a turn in place), without it the overlap rule refuses it. That is
    // exactly what the list exists for.
    const inPlace = {
      definition,
      footprint: definition.footprint,
      cells: cellsInBounds(instance.bounds).map((entry) => cell(entry.x, entry.y)),
      occupied: [instance.bounds]
    };
    expect(moveRefusal(inPlace)).toBe("OCCUPIED");
    expect(moveRefusal({ ...inPlace, ignoreBounds: instance.bounds })).toBeNull();
  });

  it("refuses to move something whose asset says it may not be moved", () => {
    const fixed: ConstructionDefinition = { ...definition, movable: false };
    expect(moveRefusal(editCheck({ definition: fixed }))).toBe("NOT_MOVABLE");
  });

  it("keeps the object's identity, owner and ledger history when it moves", () => {
    const moved = moveConstruction(instance, {
      anchor: { x: 20, y: 21 },
      rotation: 1,
      footprint: rotatedFootprint(definition.footprint, 1),
      updatedAt: "2026-10-02T00:00:00.000Z"
    });
    expect(moved.id).toBe(instance.id);
    expect(moved.builtByPlayerId).toBe(instance.builtByPlayerId);
    expect(moved.costAmount).toBe(instance.costAmount);
    expect(moved.createdAt).toBe(instance.createdAt);
    // One version further on, and its rectangle is the new ground and only the new ground.
    expect(moved.version).toBe(instance.version + 1);
    expect(moved.anchorX).toBe(20);
    expect(moved.anchorY).toBe(21);
    expect(moved.rotation).toBe(1);
    expect(moved.footprint).toEqual({ widthCells: 3, depthCells: 4 });
    expect(moved.bounds).toEqual(constructionBounds({ x: 20, y: 21 }, { widthCells: 3, depthCells: 4 }));
    expect(moved.updatedAt).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("turning an existing object", () => {
  it("swaps a 2x3 footprint to 3x2 and back, in four quarter turns", () => {
    const oblong: ConstructionDefinition = { ...definition, footprint: { widthCells: 2, depthCells: 3 } };
    expect(rotatedFootprint(oblong.footprint, 0)).toEqual({ widthCells: 2, depthCells: 3 });
    expect(rotatedFootprint(oblong.footprint, 1)).toEqual({ widthCells: 3, depthCells: 2 });
    expect(rotatedFootprint(oblong.footprint, 2)).toEqual({ widthCells: 2, depthCells: 3 });
    expect(rotatedFootprint(oblong.footprint, 3)).toEqual({ widthCells: 3, depthCells: 2 });
    expect(normaliseQuarterTurns(4)).toBe(0);
    // A square stays a square whatever way it is turned.
    expect(rotatedFootprint({ widthCells: 1, depthCells: 1 }, 3)).toEqual({ widthCells: 1, depthCells: 1 });
  });

  it("refuses a turn whose new footprint does not fit, and one the asset forbids", () => {
    const bounds = constructionBounds({ x: 10, y: 10 }, { widthCells: 3, depthCells: 4 });
    const cells = cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y));
    expect(
      rotationRefusal({
        definition,
        footprint: { widthCells: 3, depthCells: 4 },
        cells: cells.map((entry) => ({ ...entry, owned: entry.x === 9 ? false : entry.owned })),
        occupied: []
      })
    ).toBe("NOT_OWNED");
    expect(rotationRefusal({ definition: { ...definition, rotatable: false }, footprint: definition.footprint, cells, occupied: [] })).toBe("NOT_ROTATABLE");
    expect(
      rotationRefusal({
        definition,
        footprint: { widthCells: 3, depthCells: 4 },
        cells,
        occupied: [{ minX: 9, maxX: 9, minY: 10, maxY: 10 }]
      })
    ).toBe("OCCUPIED");
  });

  it("refuses to turn an object that cannot be turned or moved", () => {
    const bounds = constructionBounds({ x: 10, y: 10 }, definition.footprint);
    const cells = cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y));
    expect(rotationRefusal({ definition: { ...definition, rotatable: false }, footprint: definition.footprint, cells, occupied: [] })).toBe("NOT_ROTATABLE");
    expect(moveRefusal({ definition: { ...definition, movable: false }, footprint: definition.footprint, cells, occupied: [] })).toBe("NOT_MOVABLE");
  });
});

describe("taking an object down", () => {
  it("returns a share of the price the asset declares, and never more than it cost", () => {
    expect(removalRefund(definition)).toBe(450);
    expect(removalRefund({ ...definition, removalRefundRate: 0 })).toBe(0);
    expect(removalRefund({ ...definition, removalRefundRate: 0.25, price: 41 })).toBe(10);
    // A rate that tried to be a money press is clamped rather than trusted.
    expect(removalRefund({ ...definition, removalRefundRate: 4 })).toBe(900);
  });

  it("refuses to remove something the asset says is permanent", () => {
    expect(removalRefusal(definition)).toBeNull();
    expect(removalRefusal({ ...definition, removable: false })).toBe("NOT_REMOVABLE");
  });
});

describe("the ground rule is the same one in every direction", () => {
  it("answers a placement, a move and a turn through the same function", () => {
    const bounds = constructionBounds({ x: 4, y: 4 }, { widthCells: 1, depthCells: 1 });
    const unowned = cellsInBounds(bounds).map((entry) => cell(entry.x, entry.y, { owned: false }));
    const shape = { definition, footprint: { widthCells: 1, depthCells: 1 }, occupied: [] };
    expect(groundRefusal({ ...shape, cells: unowned })).toBe("NOT_OWNED");
    expect(moveRefusal({ ...shape, cells: unowned })).toBe("NOT_OWNED");
    expect(rotationRefusal({ ...shape, cells: unowned })).toBe("NOT_OWNED");
  });
});
