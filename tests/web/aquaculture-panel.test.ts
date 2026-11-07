import { describe, expect, it } from "vitest";
import type { AquaculturePondDTO, ConstructionDTO } from "@happy-farm/contracts";
import { aquaculturePanelState, formatAquacultureTimestamp, isAquacultureConstruction, sortAquacultureCohorts } from "../../apps/web/src/aquaculture/panel";

const pond: AquaculturePondDTO = {
  pondId: "construct_11111111-1111-4111-8111-111111111111",
  farmId: "farm_11111111-1111-4111-8111-111111111111",
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
  version: 1
};

describe("Fish Cage action panel state", () => {
  it("recognizes the cage from the world construction row selected by its constructionId", () => {
    const selectedConstruction: ConstructionDTO = {
      constructionId: "construct_11111111-1111-4111-8111-111111111111",
      farmId: "farm_11111111-1111-4111-8111-111111111111",
      entryId: "place_fish_cage",
      category: "UTILITY",
      anchorX: 12,
      anchorY: 8,
      rotation: 0,
      footprint: { widthCells: 1, depthCells: 1 },
      state: "ACTIVE",
      source: "PLAYER_PLACED",
      placementKey: null,
      paidAmount: 100,
      costAmount: 100,
      costCurrencyDefinitionId: "currency_gold",
      createdAt: "2026-10-15T00:00:00.000Z",
      storedAt: null,
      version: 2
    };

    expect(selectedConstruction.constructionId).toBe(pond.pondId);
    expect(isAquacultureConstruction(selectedConstruction)).toBe(true);
    expect(isAquacultureConstruction({ ...selectedConstruction, entryId: "place_barn_t1" })).toBe(false);
  });

  it("keeps the click trace contract anchored to the selected construction row", () => {
    const constructions: ConstructionDTO[] = [{
      constructionId: pond.pondId,
      farmId: pond.farmId,
      entryId: "place_fish_cage",
      category: "UTILITY",
      anchorX: 12,
      anchorY: 8,
      rotation: 0,
      footprint: { widthCells: 1, depthCells: 1 },
      state: "ACTIVE",
      source: "PLAYER_PLACED",
      placementKey: null,
      paidAmount: 100,
      costAmount: 100,
      costCurrencyDefinitionId: "currency_gold",
      createdAt: "2026-10-15T00:00:00.000Z",
      storedAt: null,
      version: 2
    }];
    const selectedObjectId = pond.pondId;
    const selected = constructions.find((row) => row.constructionId === selectedObjectId) ?? null;

    expect(selected?.constructionId).toBe("construct_11111111-1111-4111-8111-111111111111");
    expect(selected?.entryId).toBe("place_fish_cage");
    expect(selected !== null && isAquacultureConstruction(selected)).toBe(true);
  });

  it("shows stocking, progress, and harvest as distinct UI states", () => {
    expect(aquaculturePanelState(pond, 3)).toMatchObject({ kind: "EMPTY", fingerlings: 3, action: "STOCK", capacity: 10, availableCapacity: 10 });
    expect(aquaculturePanelState({
      ...pond,
      status: "GROWING",
      itemDefinitionId: "item_fish_tilapia",
      stockedCount: 5,
      growingCount: 5,
      availableCapacity: 5,
      stockedAt: "2026-10-15T00:00:00.000Z",
      readyAt: "2026-10-15T01:00:00.000Z",
      cohorts: [{ cohortId: "cohort_first", itemDefinitionId: "item_fish_tilapia", quantity: 5, stockedAt: "2026-10-15T00:00:00.000Z", readyAt: "2026-10-15T01:00:00.000Z" }]
    }, 0)).toMatchObject({
      kind: "GROWING",
      fingerlings: 0,
      capacity: 10,
      stockedCount: 5,
      growingCount: 5,
      readyCount: 0,
      availableCapacity: 5,
      action: "WITHDRAW",
      withdrawLimit: 5,
      cohorts: [{ cohortId: "cohort_first" }]
    });
    expect(aquaculturePanelState({ ...pond, status: "READY", itemDefinitionId: "item_fish_tilapia", stockedCount: 1, readyCount: 1, availableCapacity: 9, readyAt: "2026-10-15T01:00:00.000Z", cohorts: [{ cohortId: "cohort_ready", itemDefinitionId: "item_fish_tilapia", quantity: 1, stockedAt: "2026-10-15T00:00:00.000Z", readyAt: "2026-10-15T01:00:00.000Z" }] }, 0)).toMatchObject({
      kind: "READY",
      fingerlings: 0,
      capacity: 10,
      stockedCount: 1,
      growingCount: 0,
      readyCount: 1,
      availableCapacity: 9,
      action: "HARVEST",
      harvestLimit: 1,
      readyAt: "2026-10-15T01:00:00.000Z"
    });
  });

  it("sorts batches by readyAt and exposes separate settlement limits", () => {
    const mixed = {
      ...pond,
      status: "GROWING" as const,
      itemDefinitionId: "item_fish_tilapia" as const,
      stockedCount: 10,
      growingCount: 5,
      readyCount: 5,
      availableCapacity: 0,
      cohorts: [
        { cohortId: "late", itemDefinitionId: "item_fish_tilapia" as const, quantity: 5, stockedAt: "2026-10-15T00:30:00.000Z", readyAt: "2026-10-15T01:30:00.000Z" },
        { cohortId: "early", itemDefinitionId: "item_fish_tilapia" as const, quantity: 5, stockedAt: "2026-10-15T00:00:00.000Z", readyAt: "2026-10-15T01:00:00.000Z" }
      ]
    };
    expect(sortAquacultureCohorts(mixed).map((cohort) => cohort.cohortId)).toEqual(["early", "late"]);
    expect(aquaculturePanelState(mixed, 0)).toMatchObject({
      readyCount: 5,
      growingCount: 5,
      action: "HARVEST",
      isFull: true,
      stockingLimit: 0,
      harvestLimit: 5,
      withdrawLimit: 5
    });
    expect(formatAquacultureTimestamp("2026-10-15T01:00:00.000Z", "vi")).toContain("15/10/26");
  });
});
