import { describe, expect, it } from "vitest";
import type { AquaculturePondDTO, ConstructionDTO, CropStateDTO, TreeStateDTO } from "@happy-farm/contracts";
import {
  INTERACTION_RANGE_WORLD,
  interactionPromptFor,
  type InteractableTarget
} from "../../apps/web/src/interaction/model";
import {
  buildInteractionIndex,
  interactionSearchRadiusCells,
  targetsNear,
  worldObjectIsInteractable,
  type InteractionWorldInput
} from "../../apps/web/src/interaction/registry";
import {
  interactionActivation,
  interactionCandidateFrom,
  selectFocusedInteractionCandidate,
  selectInteractionCandidate,
  type InteractionQuery
} from "../../apps/web/src/interaction/selection";
import type { WorldObjectDefinitions } from "../../apps/web/src/world-objects";

/**
 * Discovery, choice, and activation - the three questions the interaction framework answers.
 *
 * These are pure: no renderer, no network and no clock of its own (a crop's countdown is phrased from
 * a `nowMs` the caller passes). The rules pinned here are the ones a player would notice: only what is
 * near, the useful thing over the pretty thing, the same answer twice, and nothing at all when the
 * world has moved on.
 */

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const GROWTH_SECONDS = 600;

function crop(overrides: Partial<CropStateDTO> = {}): CropStateDTO {
  return {
    cropInstanceId: "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    definitionId: "crop_carrot",
    tileX: 5,
    tileY: 5,
    plantedAt: new Date(NOW - 60_000).toISOString(),
    growthStage: 1,
    growthProgress: 0.5,
    mature: false,
    version: 3,
    ...overrides
  };
}

function tree(overrides: Partial<TreeStateDTO> = {}): TreeStateDTO {
  return {
    treeInstanceId: "treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    definitionId: "tree_apple",
    tileX: 6,
    tileY: 5,
    plantedAt: new Date(NOW - 600_000).toISOString(),
    lastHarvestedAt: null,
    readyAt: new Date(NOW + 30_000).toISOString(),
    secondsUntilReady: 30,
    ready: false,
    phase: "GROWING",
    growthStage: 2,
    growthProgress: 0.4,
    version: 7,
    ...overrides
  };
}

function construction(overrides: Partial<ConstructionDTO> = {}): ConstructionDTO {
  return {
    constructionId: "construct_11111111-1111-4111-8111-111111111111",
    farmId: "farm_11111111-1111-4111-8111-111111111111",
    entryId: "world.windmill",
    category: "BUILDING",
    anchorX: 7,
    anchorY: 5,
    rotation: 0,
    footprint: { widthCells: 3, depthCells: 3 },
    state: "ACTIVE",
    source: "STARTER",
    placementKey: "starter.mill",
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: "currency_gold",
    createdAt: "2026-09-01T00:00:00.000Z",
    storedAt: null,
    version: 1,
    ...overrides
  };
}

function world(overrides: Partial<InteractionWorldInput> = {}): InteractionWorldInput {
  return {
    crops: [],
    trees: [],
    constructions: [],
    cropDefinitions: [
      {
        cropDefinitionId: "crop_carrot",
        displayNameKey: "crop.carrot.name",
        growthDurationSeconds: GROWTH_SECONDS,
        requiredLevel: 1,
        seedItemDefinitionId: "item_carrot_seed",
        seedItemDisplayNameKey: "item.carrot_seed.name",
        harvestItemDefinitionId: "item_carrot",
        baseQuantity: 2,
        harvestXp: 1
      }
    ],
    treeDefinitions: [
      {
        treeDefinitionId: "tree_apple",
        displayNameKey: "tree.apple.name",
        requiredLevel: 1,
        firstReadySeconds: 300,
        regrowSeconds: 120,
        growthStages: 3,
        saplingItemDefinitionId: "item_apple_sapling",
        saplingItemDisplayNameKey: "item.apple_sapling.name",
        harvestItemDefinitionId: "item_apple",
        baseQuantity: 3,
        harvestXp: 2
      }
    ],
    worldObjects: new Map() as WorldObjectDefinitions,
    buildCatalog: [],
    nowMs: NOW,
    ...overrides
  };
}

/** The world position of a tile, through the same mapping the renderer uses. */
function at(tileX: number, tileY: number): InteractionQuery {
  const target = interactionTargetAt(tileX, tileY);
  return { worldX: target.worldX, worldZ: target.worldZ, facingYaw: null };
}

function interactionTargetAt(tileX: number, tileY: number): { worldX: number; worldZ: number } {
  const index = buildInteractionIndex(world({ crops: [crop({ tileX, tileY })] }));
  const only = index.targets[0];
  if (only === undefined) throw new Error("fixture produced no target");
  return only;
}

function keyedTargets(targets: readonly InteractableTarget[]): readonly InteractableTarget[] {
  return [...targets].sort((a, b) => a.key.localeCompare(b.key));
}

describe("adapting the island's own rows into targets", () => {
  it("offers an empty cage for stocking and a ready cage for server-authoritative harvest", () => {
    const pond: AquaculturePondDTO = {
      pondId: construction().constructionId,
      farmId: construction().farmId,
      itemDefinitionId: null,
      status: "EMPTY",
      stockedAt: null,
      readyAt: null,
      capacity: 10,
      stockedCount: 0,
      growingCount: 0,
      readyCount: 0,
      availableCapacity: 10,
      cohorts: [],
      version: 4
    };
    const empty = buildInteractionIndex(world({ constructions: [construction({ entryId: "place_fish_cage" })], aquaculturePonds: [pond] })).targets[0];
    if (empty === undefined) throw new Error("empty pond fixture produced no target");
    expect(empty.action).toBe("STOCK_AQUACULTURE");
    const stockDecision = interactionActivation(
      { ...empty, distanceWorld: 0, facing: 1 },
      { ...empty, distanceWorld: 0, facing: 1 }
    );
    expect(stockDecision).toMatchObject({ kind: "STOCK_AQUACULTURE", pondId: pond.pondId, expectedPondVersion: 4 });

    const readyPond: AquaculturePondDTO = {
      ...pond,
      itemDefinitionId: "item_fish_tilapia",
      status: "READY",
      stockedAt: "2026-10-02T00:00:00.000Z",
      readyAt: "2026-10-02T01:00:00.000Z",
      stockedCount: 1,
      growingCount: 0,
      readyCount: 1,
      availableCapacity: 9,
      cohorts: [{ cohortId: "cohort_ready", itemDefinitionId: "item_fish_tilapia", quantity: 1, stockedAt: "2026-10-02T00:00:00.000Z", readyAt: "2026-10-02T01:00:00.000Z" }],
      version: 5
    };
    const ready = buildInteractionIndex(world({ constructions: [construction({ entryId: "place_fish_cage" })], aquaculturePonds: [readyPond] })).targets[0];
    if (ready === undefined) throw new Error("ready pond fixture produced no target");
    expect(ready.action).toBe("HARVEST_AQUACULTURE");
    expect(interactionActivation({ ...ready, distanceWorld: 0, facing: 1 }, { ...ready, distanceWorld: 0, facing: 1 })).toMatchObject({
      kind: "HARVEST_AQUACULTURE",
      pondId: readyPond.pondId,
      expectedPondVersion: 5
    });
  });

  it("offers a mature crop as a harvest and a growing one as an inspection", () => {
    const mature = buildInteractionIndex(world({ crops: [crop({ mature: true })] })).targets[0];
    expect(mature?.action).toBe("HARVEST");
    expect(mature?.priority).toBeGreaterThan(0);
    expect(mature?.nameKey).toBe("crop.carrot.name");
    expect(mature?.readyInSeconds).toBeNull();
    expect(mature?.version).toBe(3);

    const growing = buildInteractionIndex(world({ crops: [crop()] })).targets[0];
    expect(growing?.action).toBe("INSPECT");
    // The countdown is the server's timing data, phrased - never a second opinion about maturity.
    expect(growing?.readyInSeconds).toBe(540);
  });

  it("offers a ready tree's fruit and a growing tree's inspection", () => {
    const ready = buildInteractionIndex(world({ trees: [tree({ ready: true, phase: "READY" })] })).targets[0];
    expect(ready?.kind).toBe("TREE");
    expect(ready?.action).toBe("HARVEST");
    expect(ready?.readyInSeconds).toBeNull();

    const growing = buildInteractionIndex(world({ trees: [tree()] })).targets[0];
    expect(growing?.action).toBe("INSPECT");
    expect(growing?.readyInSeconds).toBe(30);
  });

  it("walks up to buildings and to the player's own things, not to every tuft of scenery", () => {
    // A player-placed one-cell prop is theirs and worth naming.
    expect(worldObjectIsInteractable(construction({ source: "PLAYER_PLACED", footprint: { widthCells: 1, depthCells: 1 } }))).toBe(true);
    // A multi-cell starter building is a place a person can stand outside of.
    expect(worldObjectIsInteractable(construction())).toBe(true);
    // Single-cell island scenery is not: narrating all of it would leave a prompt on screen forever.
    expect(
      worldObjectIsInteractable(construction({ entryId: "world.tree_pine", footprint: { widthCells: 1, depthCells: 1 } }))
    ).toBe(false);
    expect(
      worldObjectIsInteractable(construction({
        entryId: "world.tree_pine",
        forestry: {
          constructionId: "construct_11111111-1111-4111-8111-111111111111",
          entryId: "world.tree_pine",
          status: "READY",
          dropItemDefinitionId: "item_wood",
          dropQuantity: 2,
          regenerationAt: null,
          version: 1
        }
      }))
    ).toBe(true);
  });

  it("routes a ready persisted tree construction to Forestry instead of asset management only", () => {
    const index = buildInteractionIndex(world({
      constructions: [construction({
        entryId: "world.tree_broad",
        footprint: { widthCells: 1, depthCells: 1 },
        forestry: {
          constructionId: "construct_11111111-1111-4111-8111-111111111111",
          entryId: "world.tree_broad",
          status: "READY",
          dropItemDefinitionId: "item_wood",
          dropQuantity: 2,
          regenerationAt: null,
          version: 4
        }
      })]
    }));
    const candidate = selectInteractionCandidate(index, at(7, 5));
    expect(candidate).toMatchObject({ kind: "WORLD_OBJECT", action: "CHOP_CONSTRUCTION", version: 4 });
    if (candidate === null) throw new Error("missing forestry construction target");
    expect(interactionActivation(candidate, candidate)).toMatchObject({
      kind: "CHOP_FORESTRY_CONSTRUCTION",
      constructionId: candidate.targetId,
      expectedForestryVersion: 4
    });
  });

  it("ignores an object that is in storage and one that is not standing", () => {
    const stored = buildInteractionIndex(world({ constructions: [construction({ state: "STORED" })] }));
    expect(stored.targets).toHaveLength(0);

    const rows = buildInteractionIndex(
      world({ constructions: [construction(), construction({ constructionId: "construct_22222222-2222-4222-8222-222222222222" })] })
    );
    expect(rows.targets).toHaveLength(2);
  });

  it("gives every target a stable key and a name the UI can translate", () => {
    const index = buildInteractionIndex(
      world({
        crops: [crop()],
        trees: [tree()],
        constructions: [construction()]
      })
    );
    const keys = index.targets.map((target) => target.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const target of index.targets) {
      expect(target.key).toMatch(/^(crop|tree|object):/);
      expect(target.nameFallback.length).toBeGreaterThan(0);
    }
    const first = index.targets[0] as InteractableTarget;
    const prompt = interactionPromptFor({ ...first, distanceWorld: 0, facing: 1 });
    expect(prompt.actionKey).toBe("interaction.inspect");
  });
});

describe("choosing what the player means", () => {
  it("offers nothing when there is nothing, and nothing when it is out of reach", () => {
    expect(selectInteractionCandidate(buildInteractionIndex(world()), at(0, 0))).toBeNull();

    const far = buildInteractionIndex(world({ crops: [crop({ tileX: 40, tileY: 40, mature: true })] }));
    // Standing on the crop's own tile is in range; twenty metres away is not.
    expect(selectInteractionCandidate(far, at(5, 5))).toBeNull();
  });

  it("finds the one target that is near", () => {
    const index = buildInteractionIndex(world({ crops: [crop({ mature: true })] }));
    const candidate = selectInteractionCandidate(index, at(5, 5));
    expect(candidate?.kind).toBe("CROP");
    expect(candidate?.distanceWorld).toBeCloseTo(0, 6);
  });

  it("prefers the nearer of two targets, and the one the character faces when they are close", () => {
    // Two mature crops, one two tiles away and one adjacent.
    const index = buildInteractionIndex(
      world({
        crops: [
          crop({ cropInstanceId: "cropinst_11111111-1111-4111-8111-111111111111", tileX: 7, tileY: 5, mature: true }),
          crop({ cropInstanceId: "cropinst_22222222-2222-4222-8222-222222222222", tileX: 6, tileY: 5, mature: true })
        ]
      })
    );
    const here = at(5, 5);
    const candidate = selectInteractionCandidate(index, here);
    expect(candidate?.targetId).toBe("cropinst_22222222-2222-4222-8222-222222222222");
  });

  it("breaks a tie by which way the player is facing, then by a stable key", () => {
    // Two crops the same distance away, north and south of the player.
    const signs = buildInteractionIndex(
      world({
        crops: [
          crop({ cropInstanceId: "cropinst_11111111-1111-4111-8111-111111111111", tileX: 5, tileY: 7, mature: true }),
          crop({ cropInstanceId: "cropinst_22222222-2222-4222-8222-222222222222", tileX: 5, tileY: 3, mature: true })
        ]
      })
    );
    const here = at(5, 5);
    // Facing +Z (north on the map) picks the northern crop...
    const facingNorth = selectInteractionCandidate(signs, { ...here, facingYaw: 0 });
    expect(facingNorth?.targetId).toBe("cropinst_11111111-1111-4111-8111-111111111111");
    // ...and turning around picks the other one, from the same data.
    const facingSouth = selectInteractionCandidate(signs, { ...here, facingYaw: Math.PI });
    expect(facingSouth?.targetId).toBe("cropinst_22222222-2222-4222-8222-222222222222");
  });

  it("lets a useful action beat a merely nearby one", () => {
    const index = buildInteractionIndex(
      world({
        crops: [crop({ mature: true, tileX: 6, tileY: 5 })],
        constructions: [construction({ anchorX: 5, anchorY: 5, footprint: { widthCells: 3, depthCells: 3 } })]
      })
    );
    const candidate = selectInteractionCandidate(index, at(5, 5));
    expect(candidate?.action).toBe("HARVEST");
  });

  it("never lets the order of the rows decide", () => {
    const first = crop({ cropInstanceId: "cropinst_11111111-1111-4111-8111-111111111111", tileX: 6, tileY: 5, mature: true });
    const second = crop({ cropInstanceId: "cropinst_22222222-2222-4222-8222-222222222222", tileX: 5, tileY: 6, mature: true });
    const here = at(5, 5);
    const forwards = selectInteractionCandidate(buildInteractionIndex(world({ crops: [first, second] })), here);
    const backwards = selectInteractionCandidate(buildInteractionIndex(world({ crops: [second, first] })), here);
    expect(forwards?.key).toBe(backwards?.key);
    expect(forwards?.key).toBe(`crop:${first.cropInstanceId}`);
  });

  it("does not move anything while it looks", () => {
    // Discovery is a read: two identical scans over the same rows give the same answer, and the rows
    // themselves are untouched - which is what "discovery does not mutate" means in practice.
    const rows = [crop({ mature: true })];
    const snapshot = JSON.stringify(rows);
    const before = selectInteractionCandidate(buildInteractionIndex(world({ crops: rows })), at(5, 5));
    const after = selectInteractionCandidate(buildInteractionIndex(world({ crops: rows })), at(5, 5));
    expect(after).toEqual(before);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("sorts the target list the same way whatever order it arrives in", () => {
    const targets = [
      ...buildInteractionIndex(world({ crops: [crop()] })).targets,
      ...buildInteractionIndex(world({ trees: [tree()] })).targets
    ];
    expect(keyedTargets(targets).map((target) => target.key)).toEqual(
      keyedTargets([...targets].reverse()).map((target) => target.key)
    );
  });
});

describe("the bounded neighbourhood", () => {
  it("sizes itself from the ranges, not from a guess", () => {
    const radius = interactionSearchRadiusCells();
    const maxRange = Math.max(...Object.values(INTERACTION_RANGE_WORLD));
    expect(radius).toBeGreaterThan(0);
    // Small enough to stay cheap on an island with hundreds of rows.
    expect(radius).toBeLessThanOrEqual(8);
    expect(radius * 1.08).toBeGreaterThan(maxRange);
  });

  it("never returns a target outside the neighbourhood, however good it looks", () => {
    const index = buildInteractionIndex(
      world({
        crops: [
          crop({ cropInstanceId: "cropinst_11111111-1111-4111-8111-111111111111", tileX: 5, tileY: 5, mature: true }),
          crop({ cropInstanceId: "cropinst_22222222-2222-4222-8222-222222222222", tileX: 90, tileY: 90, mature: true })
        ]
      })
    );
    const here = at(5, 5);
    const near = targetsNear(index, here.worldX, here.worldZ);
    expect(near).toHaveLength(1);
    expect(near[0]?.targetId).toBe("cropinst_11111111-1111-4111-8111-111111111111");
    // And the choice agrees, even though the far crop is the same kind and equally mature.
    expect(selectInteractionCandidate(index, here)?.targetId).toBe("cropinst_11111111-1111-4111-8111-111111111111");
  });

  it("finds a target at the edge of its own range", () => {
    // Two tiles away is about 2.16 m, so it is inside a crop's 2.6 m reach - and a diagonal two tiles
    // (about 3.05 m) is not, which is the rule rather than an accident of the fixture.
    const here = at(5, 5);
    const near = interactionCandidateFrom(
      buildInteractionIndex(world({ crops: [crop({ tileX: 7, tileY: 5, mature: true })] })).targets,
      here
    );
    expect(near).not.toBeNull();
    expect(near?.distanceWorld).toBeLessThanOrEqual(INTERACTION_RANGE_WORLD.CROP);

    const diagonal = interactionCandidateFrom(
      buildInteractionIndex(world({ crops: [crop({ tileX: 7, tileY: 7, mature: true })] })).targets,
      here
    );
    expect(diagonal).toBeNull();
  });
});

describe("activating a candidate", () => {
  it("keeps a clicked aquaculture cage as the E target while another target is nearer", () => {
    const cage: InteractableTarget = {
      key: "object:cage-1",
      kind: "WORLD_OBJECT",
      action: "STOCK_AQUACULTURE",
      targetId: "cage-1",
      tileX: 5,
      tileY: 5,
      worldX: 0,
      worldZ: 0,
      rangeWorld: 2,
      priority: 2,
      nameKey: null,
      nameFallback: "Fish Cage",
      version: 9,
      readyInSeconds: null
    };
    const cropTarget: InteractableTarget = {
      ...cage,
      key: "crop:nearby",
      kind: "CROP",
      action: "HARVEST",
      targetId: "crop-1",
      tileX: 5,
      tileY: 5,
      rangeWorld: 2,
      priority: 3,
      version: 4
    };
    const index = { buckets: new Map(), targets: [cage, cropTarget] };
    const focused = selectFocusedInteractionCandidate(index, cage, { worldX: 0, worldZ: 0, facingYaw: null });
    expect(focused?.key).toBe(cage.key);
    expect(interactionActivation(focused, focused)).toMatchObject({
      kind: "STOCK_AQUACULTURE",
      pondId: "cage-1",
      expectedPondVersion: 9
    });
  });

  it("harvests the crop it was showing, with the version the client was looking at", () => {
    const index = buildInteractionIndex(world({ crops: [crop({ mature: true })] }));
    const candidate = selectInteractionCandidate(index, at(5, 5));
    expect(interactionActivation(candidate, candidate)).toEqual({
      kind: "HARVEST_CROP",
      cropInstanceId: "cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedCropVersion: 3
    });
  });

  it("harvests a tree's cycle with the tree's own version", () => {
    const index = buildInteractionIndex(world({ trees: [tree({ ready: true, phase: "READY" })] }));
    const candidate = selectInteractionCandidate(index, at(6, 5));
    expect(interactionActivation(candidate, candidate)).toEqual({
      kind: "HARVEST_TREE",
      treeInstanceId: "treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      expectedTreeVersion: 7
    });
  });

  it("inspects what is not ready rather than pretending it can be harvested", () => {
    const index = buildInteractionIndex(world({ crops: [crop()] }));
    const candidate = selectInteractionCandidate(index, at(5, 5));
    const decision = interactionActivation(candidate, candidate);
    expect(decision.kind).toBe("INSPECT");
  });

  it("refuses a candidate the world has moved past", () => {
    const index = buildInteractionIndex(world({ crops: [crop({ mature: true })] }));
    const candidate = selectInteractionCandidate(index, at(5, 5));
    // The player walked away: discovery now finds nothing.
    expect(interactionActivation(candidate, null)).toEqual({ kind: "STALE", reason: "GONE" });
    // Or the target changed under them: a different crop is what is in reach now.
    const other = selectInteractionCandidate(
      buildInteractionIndex(
        world({ crops: [crop({ cropInstanceId: "cropinst_33333333-3333-4333-8333-333333333333", mature: true })] })
      ),
      at(5, 5)
    );
    expect(interactionActivation(candidate, other)).toEqual({ kind: "STALE", reason: "CHANGED" });
    // And pressing with nothing selected at all is stale too, never a crash.
    expect(interactionActivation(null, null)).toEqual({ kind: "STALE", reason: "GONE" });
  });
});
