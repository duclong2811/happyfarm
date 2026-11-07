import { describe, expect, it } from "vitest";
import { settleProduction, PRODUCTION_HOUR_MS, type ProductionSettlementInput } from "@happy-farm/domain";

const base = (overrides: Partial<ProductionSettlementInput> = {}): ProductionSettlementInput => ({
  assignment: {
    id: "production_assignment_test", farmId: "farm_test", actorId: "actor_test", workAreaId: null,
    sourceId: "production_source_test", enabled: true, settlementCursor: "2026-01-01T00:00:00.000Z",
    productionRemainder: 0, version: 1
  },
  source: {
    id: "production_source_test", farmId: "farm_test", kind: "RENEWABLE", outputItemDefinitionId: "item_apple",
    ratePerHour: 10, remainingStock: null, enabled: true, version: 1
  },
  serverNow: "2026-01-01T01:00:00.000Z", warehouseFreeCapacity: 100,
  ...overrides
});

describe("Production Rate core", () => {
  it("settles one hour using integer fixed-point arithmetic", () => {
    expect(settleProduction(base()).producedQuantity).toBe(10);
  });
  it("retains fractional remainder and partition invariance", () => {
    const one = settleProduction(base({ serverNow: "2026-01-01T01:00:00.000Z" }));
    let cursor = "2026-01-01T00:00:00.000Z"; let remainder = 0; let total = 0;
    for (let i = 1; i <= 60; i += 1) {
      const serverNow = new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString();
      const result = settleProduction(base({ assignment: { ...base().assignment, settlementCursor: cursor, productionRemainder: remainder }, serverNow }));
      total += result.producedQuantity; cursor = result.newCursor; remainder = result.newRemainder;
    }
    expect(total).toBe(one.producedQuantity); expect(remainder).toBe(one.newRemainder);
  });
  it("pauses at warehouse capacity without hidden backlog", () => {
    const result = settleProduction(base({ warehouseFreeCapacity: 32, serverNow: "2026-01-01T05:00:00.000Z" }));
    expect(result.producedQuantity).toBe(32); expect(result.blockedReason).toBe("WAREHOUSE_FULL");
    expect(result.productiveElapsedMs).toBe(3 * PRODUCTION_HOUR_MS + 12 * 60_000);
  });
  it("does not advance a zero-capacity warehouse into hidden backlog", () => {
    const result = settleProduction(base({ warehouseFreeCapacity: 0 }));
    expect(result.producedQuantity).toBe(0);
    expect(result.blockedReason).toBe("WAREHOUSE_FULL");
    expect(result.newCursor).toBe("2026-01-01T00:00:00.000Z");
    expect(result.newRemainder).toBe(0);
  });
  it("does not accumulate blocked time after capacity is restored", () => {
    const result = settleProduction(base({
      assignment: { ...base().assignment, settlementCursor: "2026-01-01T03:12:00.000Z", blockedReason: "WAREHOUSE_FULL" },
      serverNow: "2026-01-01T06:00:00.000Z", warehouseFreeCapacity: 10
    }));
    expect(result.producedQuantity).toBe(0); expect(result.newCursor).toBe("2026-01-01T06:00:00.000Z");
  });
  it("depletes a finite source at its exact production boundary", () => {
    const result = settleProduction(base({ source: { ...base().source, kind: "FINITE", remainingStock: 37 }, serverNow: "2026-01-01T05:00:00.000Z" }));
    expect(result.producedQuantity).toBe(37); expect(result.newSourceRemainingStock).toBe(0); expect(result.sourceDepleted).toBe(true);
  });
  it("honors the explicit 24 hour cap", () => {
    const result = settleProduction(base({ serverNow: "2026-01-03T00:00:00.000Z", warehouseFreeCapacity: 1_000 }));
    expect(result.elapsedMs).toBe(24 * PRODUCTION_HOUR_MS); expect(result.producedQuantity).toBe(240);
  });
  it("does not require Cargo, Wallet, or client-produced quantities", () => {
    const result = settleProduction(base());
    expect(result.outputItemDefinitionId).toBe("item_apple");
  });
});
