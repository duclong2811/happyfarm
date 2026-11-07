import { describe, expect, it, vi } from "vitest";
import { ResolveResourceProductionContext } from "@happy-farm/application";
import { GameDataResourceCatalogue, gameDataWorkAreaGround } from "../../workers/api/src/runtime";
import type { ActorJob, FarmId, JobId, WorkAreaId } from "@happy-farm/domain";
import type { WorkArea } from "@happy-farm/domain";

const FARM = "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as FarmId;
const JOB = "job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as JobId;
const AREA = "workarea_cccccccc-cccc-4ccc-8ccc-cccccccccccc" as WorkAreaId;
const NOW = "2026-10-08T00:00:00.000Z";

function job(kind: "FORESTRY" | "MINING", targetDefinitionId: string): ActorJob {
  return {
    id: JOB,
    actorId: "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
    farmId: FARM,
    workAreaId: AREA,
    kind,
    targetDefinitionId,
    executionMode: "RATE_PRODUCTION",
    priority: 1,
    enabled: true,
    autoPurchaseSupplies: false,
    autoFundingEnabled: false,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function area(kind: "FORESTRY" | "MINING"): WorkArea {
  return {
    id: AREA,
    farmId: FARM,
    zoneKind: "HOME_ISLAND",
    zoneId: `zone_home_island_${FARM}`,
    kind,
    displayName: `${kind} test area`,
    version: 1,
    createdByPlayerId: "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function resolver(kind: "FORESTRY" | "MINING", target: string, cells: readonly { x: number; y: number }[], states: readonly object[] = []) {
  return new ResolveResourceProductionContext({
    farms: {} as never,
    members: {} as never,
    jobs: { findById: vi.fn(() => Promise.resolve(job(kind, target))) } as never,
    workAreas: { findById: vi.fn(() => Promise.resolve(area(kind))), listCells: vi.fn(() => Promise.resolve(cells)) } as never,
    catalogue: new GameDataResourceCatalogue(),
    states: { listByZone: vi.fn(() => Promise.resolve(states)) } as never,
    ground: gameDataWorkAreaGround,
    clock: { now: () => NOW }
  });
}

describe("resource Production Rate eligibility", () => {
  it("Forestry includes only matching CHOP nodes inside the area and excludes Mining nodes", async () => {
    const context = await resolver("FORESTRY", "resource_wildwood", [{ x: 36, y: -18 }, { x: 12, y: -12 }]).execute({ id: "production_assignment_x", farmId: FARM, actorId: "actor_x", workAreaId: AREA, sourceId: "source_x", enabled: true, settlementCursor: NOW, productionRemainder: 0, version: 1, actorJobId: JOB }, NOW);
    expect(context?.sourceRatePerHour).toBe(1);
    expect(context?.availableNodes.map((node) => node.nodeId)).toEqual(["node_wildwood_north_1"]);
  });

  it("Mining treats the unified ore node as a continuous labor anchor", async () => {
    const context = await resolver("MINING", "resource_ore", [{ x: 12, y: -12 }, { x: 36, y: -18 }]).execute({ id: "production_assignment_x", farmId: FARM, actorId: "actor_x", workAreaId: AREA, sourceId: "source_x", enabled: true, settlementCursor: NOW, productionRemainder: 0, version: 1, actorJobId: JOB }, NOW);
    expect(context?.sourceRatePerHour).toBe(1_200);
    expect(context?.continuousLabor).toBe(true);
    expect(context?.availableNodes.map((node) => node.nodeId)).toEqual(["node_stone_ridge"]);
  });

  it("does not count a node whose authoritative regeneration timestamp is still in the future", async () => {
    const context = await resolver("FORESTRY", "resource_wildwood", [{ x: 36, y: -18 }], [{ nodeId: "node_wildwood_north_1", availableAt: "2026-10-08T00:05:00.000Z", depletedAt: NOW, version: 1 }]).execute({ id: "production_assignment_x", farmId: FARM, actorId: "actor_x", workAreaId: AREA, sourceId: "source_x", enabled: true, settlementCursor: NOW, productionRemainder: 0, version: 1, actorJobId: JOB }, NOW);
    expect(context).toEqual({ sourceRatePerHour: 0, continuousLabor: false, availableNodes: [] });
  });
});
