import { describe, expect, it } from "vitest";
import { StockAquaculturePond } from "@happy-farm/application";
import { parseConstructionId, parseFarmId, parsePlayerId } from "@happy-farm/domain";

describe("Aquaculture execution paths", () => {
  it("keeps the worker path behind an aquaculture work-area check", async () => {
    const farmId = parseFarmId("farm_11111111-1111-4111-8111-111111111111");
    const pondId = parseConstructionId("construct_11111111-1111-4111-8111-111111111111");
    const dependencies = {
      farms: { findById: () => Promise.resolve({}) },
      members: { findByFarmAndPlayer: () => Promise.resolve({ role: "OWNER" }) },
      constructions: {
        findById: () => Promise.resolve({ farmId, id: pondId, state: "ACTIVE", entryId: "place_fish_cage", anchorX: 0, anchorY: 0 })
      },
      terrain: { classify: () => ({ terrain: "WATER", shallowWater: true, protectedGround: false }) },
      workAreas: { listByFarm: () => Promise.resolve([]) }
    } as never;

    await expect(new StockAquaculturePond(dependencies).executeForWorker(
      { playerId: parsePlayerId("player_11111111-1111-4111-8111-111111111111") },
      farmId,
      pondId,
      { requestId: "worker-area-required", expectedPondVersion: 0, quantity: 1 }
    )).rejects.toMatchObject({ code: "AQUACULTURE_AREA_REQUIRED" });
  });
});
