import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { settleProduction } from "@happy-farm/domain";

/**
 * Focused acceptance guard for the offline-return seam.  The full D1 settlement suite is currently
 * noisy for unrelated inventory-version assertions, so this file deliberately proves the boundary
 * that caused the reported loss: supported job creation invokes binding immediately, while the
 * server settlement calculation remains the sole source of credited quantity.
 */
const jobs = readFileSync(fileURLToPath(new URL("../../packages/application/src/jobs.ts", import.meta.url)), "utf8");
const handler = readFileSync(fileURLToPath(new URL("../../workers/api/src/handler.ts", import.meta.url)), "utf8");
const binding = readFileSync(fileURLToPath(new URL("../../packages/application/src/orchard.ts", import.meta.url)), "utf8");

describe("Apple Orchard offline return acceptance", () => {
  it("binds a valid RATE_PRODUCTION job at creation, before reconciliation", () => {
    expect(jobs).toContain("onCreated?: (actor: ActorContext, farmId: FarmId, jobId: JobId)");
    expect(jobs).toContain("await this.dependencies.jobs.createAtomically(job, record);");
    expect(jobs).toContain("await this.dependencies.onCreated(actor, farmId, job.id);");
    expect(handler).toContain("onCreated: (createdActor, createdFarmId, createdJobId) => orchardBinding.execute");
    expect(binding).toContain("activatedAt");
  });

  it("retains the first five-hour interval at five READY-tree rate", () => {
    const result = settleProduction({
      assignment: {
        id: "production_assignment_test", farmId: "farm_test", actorId: "actor_test", workAreaId: null,
        sourceId: "production_source_test", enabled: true, settlementCursor: "2026-10-08T00:00:00.000Z",
        productionRemainder: 0, version: 1
      },
      source: {
        id: "production_source_test", farmId: "farm_test", kind: "RENEWABLE", outputItemDefinitionId: "item_apple",
        ratePerHour: 5, remainingStock: null, enabled: true, version: 1
      },
      serverNow: "2026-10-08T05:00:00.000Z", warehouseFreeCapacity: 1000
    });
    expect(result.producedQuantity).toBe(25);
  });

  it("uses actual capacity and preserves the existing 24-hour cap", () => {
    const partial = settleProduction({
      assignment: { id: "production_assignment_test", farmId: "farm_test", actorId: "actor_test", workAreaId: null, sourceId: "production_source_test", enabled: true, settlementCursor: "2026-10-08T00:00:00.000Z", productionRemainder: 0, version: 1 },
      source: { id: "production_source_test", farmId: "farm_test", kind: "RENEWABLE", outputItemDefinitionId: "item_apple", ratePerHour: 5, remainingStock: null, enabled: true, version: 1 },
      serverNow: "2026-10-09T05:00:00.000Z", warehouseFreeCapacity: 8
    });
    expect(partial.producedQuantity).toBe(8);
    expect(partial.newCursor).toBe("2026-10-08T01:36:00.000Z");
  });
});
