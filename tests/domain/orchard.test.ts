import { describe, expect, it } from "vitest";
import {
  APPLE_RATE_PER_TREE_PER_HOUR,
  calculateAppleOrchardCapacity,
  orchardProductionSegments
} from "@happy-farm/domain";
import { parseFarmId, parsePlayerId, parseTreeDefinitionId, parseTreeInstanceId } from "@happy-farm/domain";
import type { TreeDefinition, TreeInstance } from "@happy-farm/domain";

const APPLE: TreeDefinition = {
  id: parseTreeDefinitionId("tree_apple"), displayNameKey: "tree.apple.name",
  saplingItemDefinitionId: "item_apple_sapling" as never, firstReadySeconds: 3600,
  regrowSeconds: 900, growthStages: 4, harvest: { itemDefinitionId: "item_apple" as never, baseQuantity: 3, xp: 9 }
};
const ORANGE = { ...APPLE, id: parseTreeDefinitionId("tree_orange") };
function tree(id: string, x: number, plantedAt: string): TreeInstance {
  return { id: parseTreeInstanceId(id), farmId: parseFarmId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), tileX: x, tileY: 1,
    treeDefinitionId: parseTreeDefinitionId("tree_apple"), plantedByPlayerId: parsePlayerId("player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    plantedAt, lastHarvestedAt: null, version: 1, createdAt: plantedAt, updatedAt: plantedAt,
    storageState: "ACTIVE", rotation: 0, storedAt: null, storedRemainingSeconds: null };
}

describe("Apple Orchard capacity", () => {
  it("counts only active mature Apple Trees inside the Work Area", () => {
    const now = "2026-01-01T02:00:00.000Z";
    const candidates = [
      { tree: tree("treeinst_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, "2026-01-01T00:00:00.000Z"), definition: APPLE },
      { tree: tree("treeinst_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2, "2026-01-01T01:30:00.000Z"), definition: APPLE },
      { tree: tree("treeinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc", 3, "2026-01-01T00:00:00.000Z"), definition: ORANGE },
      { tree: tree("treeinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd", 4, "2026-01-01T00:00:00.000Z"), definition: APPLE },
      { tree: tree("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 1, "2026-01-01T00:00:00.000Z"), definition: APPLE, active: false }
    ];
    expect(calculateAppleOrchardCapacity([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], candidates, now)).toMatchObject({
      eligibleMatureAppleTreeCount: 1, ratePerHour: APPLE_RATE_PER_TREE_PER_HOUR, eligibleTreeIds: ["treeinst_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
    });
  });

  it("keeps a zero-rate empty orchard valid", () => {
    expect(calculateAppleOrchardCapacity([], [], "2026-01-01T00:00:00.000Z").ratePerHour).toBe(0);
  });

  it("splits old and new rates at the authoritative boundary", () => {
    expect(orchardProductionSegments("2026-01-01T00:00:00.000Z", "2026-01-01T03:00:00.000Z", 1, [
      { at: "2026-01-01T01:00:00.000Z", ratePerHour: 2 }
    ])).toEqual([
      { from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T01:00:00.000Z", ratePerHour: 1 },
      { from: "2026-01-01T01:00:00.000Z", to: "2026-01-01T03:00:00.000Z", ratePerHour: 2 }
    ]);
  });
});
