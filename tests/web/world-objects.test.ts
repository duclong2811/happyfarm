import { describe, expect, it } from "vitest";
import type { BuildCatalogEntryDTO, ConstructionDTO, WorldObjectDefinitionDTO } from "@happy-farm/contracts";
import {
  activeObjects,
  indexWorldObjects,
  objectPolicy,
  objectPresentation,
  removalRefundPreview,
  storageStacks,
  storedObjects
} from "../../apps/web/src/world-objects";

/**
 * How the client draws and edits an object, whoever made it.
 *
 * V13.3's whole promise is that a starter tree and a bought tree behave the same way, and this is the
 * layer that has to make that true: one row, one definition, the same presentation and the same
 * actions - and a refund that reads what the object *cost* rather than what the catalogue charges.
 */

function definition(overrides: Partial<WorldObjectDefinitionDTO> = {}): WorldObjectDefinitionDTO {
  return {
    id: "world.tree_broad",
    displayNameKey: "object.tree_broad.name",
    modelId: "tree_broad_2",
    landmarkKind: null,
    sizeWorld: 3.4,
    collisionRadiusWorld: 0.5,
    footprint: { widthCells: 1, depthCells: 1 },
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    ...overrides
  };
}

function row(overrides: Partial<ConstructionDTO> = {}): ConstructionDTO {
  return {
    constructionId: "construct_11111111-1111-4111-8111-111111111111",
    farmId: "farm_11111111-1111-4111-8111-111111111111",
    entryId: "world.tree_broad",
    category: "WORLD_OBJECT",
    anchorX: -4,
    anchorY: -1,
    rotation: 0,
    footprint: { widthCells: 1, depthCells: 1 },
    state: "ACTIVE",
    source: "STARTER",
    placementKey: "starter.tree.west.01",
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: "currency_gold",
    createdAt: "2026-10-01T00:00:00.000Z",
    storedAt: null,
    version: 1,
    ...overrides
  };
}

function catalogEntry(overrides: Partial<BuildCatalogEntryDTO> = {}): BuildCatalogEntryDTO {
  return {
    entryId: "place_tree_broad",
    category: "VEGETATION",
    displayNameKey: "place.tree_broad.name",
    label: "Tree broad",
    descriptionKey: null,
    modelId: "tree_broad_2",
    requiredLevel: 1,
    price: 40,
    currencyDefinitionId: "currency_gold",
    footprint: { widthCells: 1, depthCells: 1 },
    allowedTerrain: ["LAND"],
    tier: null,
    tierRank: null,
    upgradeTo: null,
    rotatable: true,
    movable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0,
    decorative: true,
    tags: [],
    unlockCondition: "OWNED_LAND",
    gameplay: {
      classification: "COSMETIC",
      status: "ACTIVE",
      summaryKey: "place.tree_broad.effect",
      production: null,
      storage: null,
      movement: null,
      workerTask: null
    },
    ...overrides
  };
}

describe("drawing an object", () => {
  it("takes a world object's own model and size", () => {
    const objects = indexWorldObjects([definition()]);
    expect(objectPresentation(row(), objects, [])).toEqual({ modelId: "tree_broad_2", sizeWorld: 3.4 });
  });

  it("gives a bought object a real size rather than one world unit", () => {
    // The V13.2 defect this pins: a placed tree was drawn at the model's normalized size - a metre -
    // beside the island's own three-metre trees. A catalogue row has no size of its own, so it is
    // resolved from the model family.
    expect(objectPresentation(row({ entryId: "place_tree_broad", source: "PLAYER_PLACED" }), indexWorldObjects([]), [catalogEntry()]))
      .toEqual({ modelId: "tree_broad_2", sizeWorld: 3.4 });
    // Props and buildings carry their size in their own manifests.
    expect(objectPresentation(row({ entryId: "place_barrel" }), indexWorldObjects([]), [catalogEntry({ entryId: "place_barrel", modelId: "prop_barrel" })])).toEqual({
      modelId: "prop_barrel",
      sizeWorld: 0.95
    });
    expect(objectPresentation(row({ entryId: "place_barn_t1" }), indexWorldObjects([]), [catalogEntry({ entryId: "place_barn_t1", modelId: "farm.barn.t1" })])).toEqual({
      modelId: "farm.barn.t1",
      sizeWorld: 4.6
    });
  });
});

describe("what an object offers", () => {
  it("answers the same policy shape for a starter object and a bought one", () => {
    const starter = objectPolicy(row(), indexWorldObjects([definition()]), []);
    expect(starter).toMatchObject({ movable: true, rotatable: true, storable: true, removable: true, price: 0 });
    const bought = objectPolicy(
      row({ entryId: "place_tree_broad", source: "PLAYER_PLACED", paidAmount: 40, costAmount: 40 }),
      indexWorldObjects([]),
      [catalogEntry()]
    );
    expect(bought).toMatchObject({ movable: true, rotatable: true, storable: true, removable: true, price: 40 });
  });

  it("offers nothing at all for a row it cannot describe", () => {
    expect(objectPolicy(row({ entryId: "world.unknown" }), indexWorldObjects([]), [])).toBeNull();
  });
});

describe("what a removal returns", () => {
  it("reads the cost basis, so a free starter object pays nothing", () => {
    const objects = indexWorldObjects([definition({ removalRefundRate: 1 })]);
    const starter = row({ paidAmount: 0, costAmount: 0 });
    const policy = objectPolicy(starter, objects, []);
    expect(policy).not.toBeNull();
    if (policy === null) return;
    // Even at a hundred per cent: nobody paid anything, so nothing comes back.
    expect(removalRefundPreview(starter, policy)).toBe(0);
  });

  it("pays a share of what a bought object actually cost", () => {
    const bought = row({ entryId: "place_tree_broad", source: "PLAYER_PLACED", paidAmount: 40, costAmount: 40 });
    const policy = objectPolicy(bought, indexWorldObjects([]), [
      catalogEntry({ removalRefundRate: 0.5 })
    ]);
    expect(policy).not.toBeNull();
    if (policy === null) return;
    expect(removalRefundPreview(bought, policy)).toBe(20);
  });
});

describe("storage", () => {
  const stored = (id: string, entryId: string, storedAt: string): ConstructionDTO =>
    row({
      constructionId: id,
      entryId,
      state: "STORED",
      storedAt,
      anchorX: 2,
      anchorY: 2
    });

  it("separates what stands on the island from what is held", () => {
    const rows = [row(), stored("construct_22222222-2222-4222-8222-222222222222", "world.rock", "2026-10-02T00:00:00.000Z")];
    expect(activeObjects(rows)).toHaveLength(1);
    expect(storedObjects(rows)).toHaveLength(1);
    expect(storedObjects(rows)[0]?.entryId).toBe("world.rock");
  });

  it("stacks stored objects by definition, newest first", () => {
    const rows = [
      stored("construct_33333333-3333-4333-8333-333333333333", "world.rock", "2026-10-01T00:00:00.000Z"),
      stored("construct_44444444-4444-4444-8444-444444444444", "world.rock", "2026-10-03T00:00:00.000Z"),
      stored("construct_55555555-5555-4555-8555-555555555555", "world.bush", "2026-10-02T00:00:00.000Z")
    ];
    const stacks = storageStacks(rows);
    expect(stacks).toHaveLength(2);
    const rocks = stacks.find((stack) => stack.entryId === "world.rock");
    expect(rocks?.count).toBe(2);
    // The newest row is the one a placement restores, so a store/restore pair cannot resurrect an
    // older copy.
    expect(rocks?.newest.constructionId).toBe("construct_44444444-4444-4444-8444-444444444444");
  });
});
