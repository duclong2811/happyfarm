import { describe, expect, it } from "vitest";
import {
  ErrorCodeSchema,
  HarvestTreeRequestSchema,
  HarvestTreeResponseSchema,
  PlantTreeRequestSchema,
  RemoveTreeRequestSchema,
  TreeDefinitionDTOSchema,
  TreeStateDTOSchema
} from "@happy-farm/contracts";

const TREE_INSTANCE_ID = "treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const definition = {
  treeDefinitionId: "tree_apple",
  displayNameKey: "tree.apple.name",
  saplingItemDefinitionId: "item_apple_sapling",
  saplingItemDisplayNameKey: "item.apple_sapling.name",
  firstReadySeconds: 3600,
  regrowSeconds: 900,
  growthStages: 4,
  harvestItemDefinitionId: "item_apple",
  baseQuantity: 3,
  harvestXp: 10,
  requiredLevel: 3
};

const state = {
  treeInstanceId: TREE_INSTANCE_ID,
  definitionId: "tree_apple",
  tileX: 0,
  tileY: 0,
  plantedAt: "2026-09-27T00:00:00.000Z",
  lastHarvestedAt: null,
  readyAt: "2026-09-27T01:00:00.000Z",
  secondsUntilReady: 3600,
  ready: false,
  phase: "GROWING",
  growthStage: 1,
  growthProgress: 0.5,
  version: 1
};

describe("tree contracts", () => {
  it("accepts a served definition and a served tree state", () => {
    expect(TreeDefinitionDTOSchema.safeParse(definition).success).toBe(true);
    expect(TreeStateDTOSchema.safeParse(state).success).toBe(true);
    expect(TreeStateDTOSchema.safeParse({ ...state, lastHarvestedAt: state.plantedAt, phase: "REGROWING" }).success).toBe(true);
    expect(HarvestTreeResponseSchema.safeParse({
      harvest: { treeInstanceId: TREE_INSTANCE_ID, itemDefinitionId: "item_apple", quantityAdded: 3 },
      progression: { xpAwarded: 10, leveledUp: false, progression: { level: 3, xp: 370, xpIntoLevel: 10, xpForNextLevel: 120, maxLevel: 50 } }
    }).success).toBe(true);
  });

  it("rejects a definition or a state the server could not have produced", () => {
    for (const invalid of [
      { ...definition, treeDefinitionId: "apple" },
      { ...definition, firstReadySeconds: 0 },
      { ...definition, regrowSeconds: -5 },
      { ...definition, growthStages: 1 },
      { ...definition, baseQuantity: 0 },
      { ...definition, harvestXp: 0 },
      { ...definition, requiredLevel: 0 },
      { ...definition, saplingItemDefinitionId: "crop_apple" }
    ]) {
      expect(TreeDefinitionDTOSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
    for (const invalid of [
      { ...state, phase: "RIPE" },
      { ...state, growthProgress: 1.5 },
      { ...state, secondsUntilReady: -1 },
      { ...state, version: 0 },
      { ...state, readyAt: "yesterday" }
    ]) {
      expect(TreeStateDTOSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });

  it("carries only intent, rejecting anything a client cannot decide", () => {
    expect(
      PlantTreeRequestSchema.safeParse({
        requestId: "tree_plant_001",
        treeDefinitionId: "tree_apple",
        x: 0,
        y: 0,
        expectedTileVersion: 1
      }).success
    ).toBe(true);
    expect(HarvestTreeRequestSchema.safeParse({ requestId: "tree_harvest_001", expectedTreeVersion: 1 }).success).toBe(true);
    expect(RemoveTreeRequestSchema.safeParse({ requestId: "tree_remove_001", expectedTreeVersion: 1 }).success).toBe(true);

    const base = {
      requestId: "tree_plant_001",
      treeDefinitionId: "tree_apple",
      x: 0,
      y: 0,
      expectedTileVersion: 1
    };
    for (const injected of [
      { ...base, saplingItemDefinitionId: "item_carrot_seed" },
      { ...base, level: 99 },
      { ...base, ready: true },
      { ...base, plantedAt: "2020-01-01T00:00:00.000Z" },
      { ...base, xp: 1000 }
    ]) {
      expect(PlantTreeRequestSchema.safeParse(injected).success, JSON.stringify(injected)).toBe(false);
    }
    for (const injected of [
      { requestId: "tree_harvest_001", expectedTreeVersion: 1, ready: true },
      { requestId: "tree_harvest_001", expectedTreeVersion: 1, itemDefinitionId: "item_apple" },
      { requestId: "tree_harvest_001", expectedTreeVersion: 1, quantityAdded: 99 },
      { requestId: "tree_harvest_001", expectedTreeVersion: 1, level: 50 }
    ]) {
      expect(HarvestTreeRequestSchema.safeParse(injected).success, JSON.stringify(injected)).toBe(false);
    }
    expect(PlantTreeRequestSchema.safeParse({ ...base, x: 1_000_001 }).success).toBe(false);
    expect(HarvestTreeRequestSchema.safeParse({ requestId: "short", expectedTreeVersion: 1 }).success).toBe(false);
  });

  it("publishes the tree error codes the API can return", () => {
    for (const code of ["TREE_DEFINITION_NOT_FOUND", "TREE_NOT_FOUND", "TREE_NOT_READY", "TREE_LEVEL_REQUIRED"]) {
      expect(ErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});
