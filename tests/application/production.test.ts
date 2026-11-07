/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";
import { SettleProductionAssignment, type ProductionAssignmentRecord, type ProductionSettlementPlan } from "@happy-farm/application";
import type { Farm, FarmMember, WarehouseState } from "@happy-farm/domain";

const PLAYER = "player_11111111-1111-4111-8111-111111111111" as never;
const FARM = "farm_22222222-2222-4222-8222-222222222222" as never;
const OTHER_FARM = "farm_33333333-3333-4333-8333-333333333333" as never;
const SOURCE = "production_source_44444444-4444-4444-8444-444444444444";
const ASSIGNMENT = "production_assignment_66666666-6666-4666-8666-666666666666";
const NOW = "2026-10-06T01:00:00.000Z";
const farm = (id: typeof FARM): Farm => ({ id, ownerPlayerId: PLAYER, name: "Test", createdAt: NOW, updatedAt: NOW });
const assignment = (overrides: Partial<ProductionAssignmentRecord> = {}): ProductionAssignmentRecord => ({
  id: ASSIGNMENT, farmId: FARM, actorId: "actor_77777777-7777-4777-8777-777777777777" as never,
  workAreaId: null, sourceId: SOURCE, enabled: true, settlementCursor: "2026-10-06T00:00:00.000Z",
  productionRemainder: 0, version: 1, executionMode: "RATE_PRODUCTION", ...overrides
});
const source = (overrides = {}) => ({ id: SOURCE, farmId: FARM, kind: "RENEWABLE" as const, outputItemDefinitionId: "item_output" as never, ratePerHour: 10, remainingStock: null, enabled: true, version: 1, ...overrides });

function make(overrides: { readonly member?: FarmMember | null; readonly job?: ProductionAssignmentRecord | null; readonly source?: ReturnType<typeof source> | null; readonly warehouse?: WarehouseState | null; readonly now?: string } = {}) {
  const commit = vi.fn(async (plan: ProductionSettlementPlan) => ({ applied: true, result: plan.result }));
  const useCase = new SettleProductionAssignment(
    { findById: async (id: typeof FARM) => id === FARM ? farm(FARM) : farm(OTHER_FARM) } as never,
    { findByFarmAndPlayer: async () => overrides.member === undefined ? ({ farmId: FARM, playerId: PLAYER, role: "OWNER", createdAt: NOW } as never) : overrides.member },
    { findByFarmAndId: async () => overrides.job === undefined ? assignment() : overrides.job } as never,
    { findByFarmAndId: async () => overrides.source === undefined ? source() : overrides.source } as never,
    { find: async () => ({ tier: 0, capacity: 1000, used: 0, version: 1 }) } as never,
    { find: async () => overrides.warehouse === undefined ? ({ tier: 0, capacity: 1000, used: 0, version: 1 } as WarehouseState) : overrides.warehouse } as never,
    { settle: commit },
    { now: () => overrides.now ?? NOW }
  );
  return { useCase, commit };
}

describe("SettleProductionAssignment application boundary", () => {
  it("loads authoritative source/Warehouse and commits a calculated renewable plan", async () => {
    const { useCase, commit } = make();
    const result = await useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT });
    expect(result.producedQuantity).toBe(10);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SOURCE, warehouseCapacity: 1000, settledAt: NOW }));
  });
  it("rejects wrong farm authorization before commit", async () => {
    const { useCase, commit } = make({ member: null });
    await expect(useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT })).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects cross-farm assignment and legacy mode", async () => {
    const cross = make({ job: assignment({ farmId: OTHER_FARM }) });
    await expect(cross.useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT })).rejects.toThrow();
    const legacy = make({ job: assignment({ executionMode: "LEGACY_ACTION_AUTO" }) });
    await expect(legacy.useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT })).rejects.toThrow();
    expect(cross.commit).not.toHaveBeenCalled(); expect(legacy.commit).not.toHaveBeenCalled();
  });
  it("uses injected server time and assignment-derived source", async () => {
    const { useCase, commit } = make({ now: "2026-10-06T02:00:00.000Z" });
    await useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SOURCE, result: expect.objectContaining({ producedQuantity: 20 }) }));
  });
  it("wires finite and Warehouse-limited plans without accepting economic inputs", async () => {
    const finite = make({ source: source({ kind: "FINITE", remainingStock: 5 }), warehouse: { tier: 0, capacity: 2, used: 0, version: 1 } });
    await finite.useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT });
    expect(finite.commit).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ producedQuantity: 2 }) }));
  });
  it("returns zero output for a disabled assignment", async () => {
    const { useCase, commit } = make({ job: assignment({ enabled: false }) });
    const result = await useCase.execute({ playerId: PLAYER, farmId: FARM, assignmentId: ASSIGNMENT });
    expect(result.producedQuantity).toBe(0); expect(commit).toHaveBeenCalledTimes(1);
  });
});
