import { describe, expect, it } from "vitest";
import {
  calculateTreeProduction,
  canHarvestTree,
  createTreeInstance,
  DomainError,
  isCropUnlocked,
  isTreeUnlocked,
  parseFarmId,
  parseItemDefinitionId,
  parsePlayerId,
  parseTreeDefinitionId,
  parseTreeInstanceId,
  requiredLevelForTree,
  type TreeDefinition,
  type TreeInstance
} from "@happy-farm/domain";

const NOW = "2026-01-01T12:00:00.000Z";

const APPLE: TreeDefinition = {
  id: parseTreeDefinitionId("tree_apple"),
  displayNameKey: "tree.apple.name",
  saplingItemDefinitionId: parseItemDefinitionId("item_apple_sapling"),
  firstReadySeconds: 3600,
  regrowSeconds: 900,
  growthStages: 4,
  requiredLevel: 3,
  harvest: {
    itemDefinitionId: parseItemDefinitionId("item_apple"),
    baseQuantity: 3,
    xp: 10
  }
};

const PLANTED_AT = "2026-01-01T00:00:00.000Z";

const TREE_ID = parseTreeInstanceId("treeinst_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const FARM_ID = parseFarmId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const PLAYER_ID = parsePlayerId("player_11111111-1111-4111-8111-111111111111");

function instance(plantedAt = PLANTED_AT, lastHarvestedAt: string | null = null): TreeInstance {
  return {
    ...createTreeInstance(TREE_ID, FARM_ID, 0, 0, APPLE.id, PLAYER_ID, plantedAt),
    lastHarvestedAt
  };
}

/** The starting tree: the same definition with no level requirement recorded at all. */
const STARTING_TREE: TreeDefinition = {
  id: APPLE.id,
  displayNameKey: APPLE.displayNameKey,
  saplingItemDefinitionId: APPLE.saplingItemDefinitionId,
  firstReadySeconds: APPLE.firstReadySeconds,
  regrowSeconds: APPLE.regrowSeconds,
  growthStages: APPLE.growthStages,
  harvest: APPLE.harvest
};

describe("tree production cycle", () => {
  it("grows towards the first fruit and is ready exactly when the first duration elapses", () => {
    const tree = instance();
    const before = calculateTreeProduction(APPLE, tree, "2026-01-01T00:30:00.000Z");
    expect(before.phase).toBe("GROWING");
    expect(before.ready).toBe(false);
    expect(before.progress).toBeCloseTo(0.5, 12);
    expect(before.stage).toBe(1);
    expect(before.secondsUntilReady).toBe(1800);
    expect(before.readyAt).toBe("2026-01-01T01:00:00.000Z");

    const exactly = calculateTreeProduction(APPLE, tree, "2026-01-01T01:00:00.000Z");
    expect(exactly.ready).toBe(true);
    expect(exactly.phase).toBe("READY");
    expect(exactly.secondsUntilReady).toBe(0);
    expect(exactly.progress).toBe(1);
    expect(exactly.stage).toBe(APPLE.growthStages - 1);
    expect(canHarvestTree(tree, APPLE, "2026-01-01T01:00:00.000Z")).toBe(true);
  });

  it("uses the regrow duration, not the first duration, once the tree has been harvested", () => {
    const tree = instance(PLANTED_AT, "2026-01-01T05:00:00.000Z");
    const half = calculateTreeProduction(APPLE, tree, "2026-01-01T05:07:30.000Z");
    expect(half.phase).toBe("REGROWING");
    expect(half.ready).toBe(false);
    expect(half.progress).toBeCloseTo(0.5, 12);
    expect(half.readyAt).toBe("2026-01-01T05:15:00.000Z");

    const ready = calculateTreeProduction(APPLE, tree, "2026-01-01T05:15:00.000Z");
    expect(ready.phase).toBe("READY");
    expect(ready.ready).toBe(true);
    // A shorter regrow than the first growth is exactly why the two durations are separate.
    expect(ready.readyAt).toBe("2026-01-01T05:15:00.000Z");
  });

  it("stays ready instead of accumulating cycles while the player is away", () => {
    const tree = instance(PLANTED_AT, "2026-01-01T05:00:00.000Z");
    const muchLater = calculateTreeProduction(APPLE, tree, "2026-01-04T00:00:00.000Z");
    expect(muchLater.ready).toBe(true);
    expect(muchLater.secondsUntilReady).toBe(0);
    expect(muchLater.progress).toBe(1);
    // The cycle that completed is still the one that started at the last harvest; time passing does
    // not queue further harvests, so one ready tree is worth exactly one harvest.
    expect(muchLater.cycleStartAt).toBe("2026-01-01T05:00:00.000Z");
  });

  it("treats a server clock earlier than the cycle start as unstarted, never as overdue", () => {
    const tree = instance("2026-01-01T10:00:00.000Z");
    const skewed = calculateTreeProduction(APPLE, tree, "2026-01-01T09:00:00.000Z");
    expect(skewed.ready).toBe(false);
    expect(skewed.elapsedSeconds).toBe(0);
    // The countdown is expressed from the server's own clock, so a skewed reading is still a full
    // cycle away rather than a wait longer than the cycle itself.
    expect(skewed.secondsUntilReady).toBe(APPLE.firstReadySeconds);
    expect(skewed.elapsedSeconds + skewed.secondsUntilReady).toBe(skewed.cycleSeconds);
  });

  it("refuses timing data a tree could not have", () => {
    const invalid = [
      { ...APPLE, firstReadySeconds: 0 },
      { ...APPLE, firstReadySeconds: -1 },
      { ...APPLE, firstReadySeconds: 1.5 },
      { ...APPLE, regrowSeconds: 0 },
      { ...APPLE, growthStages: 1 }
    ];
    for (const definition of invalid) {
      expect(() => calculateTreeProduction(definition, instance(), NOW)).toThrow(DomainError);
    }
    expect(() => calculateTreeProduction(APPLE, instance("not-a-time"), NOW)).toThrow(DomainError);
    expect(() => calculateTreeProduction(APPLE, instance(PLANTED_AT, "not-a-time"), NOW)).toThrow(DomainError);
    expect(() => calculateTreeProduction(APPLE, instance(), "not-a-time")).toThrow(DomainError);
  });

  it("derives the level requirement through the rule crops already use", () => {
    expect(requiredLevelForTree(STARTING_TREE)).toBe(1);
    expect(isTreeUnlocked(STARTING_TREE, 1)).toBe(true);
    expect(isTreeUnlocked(APPLE, 2)).toBe(false);
    expect(isTreeUnlocked(APPLE, 3)).toBe(true);
    for (const level of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isTreeUnlocked(STARTING_TREE, level)).toBe(false);
    }
    // A requirement below the level every player starts at locks rather than unlocks.
    expect(isTreeUnlocked({ ...APPLE, requiredLevel: 0 }, 50)).toBe(false);

    // The crop rule keeps its behaviour while sharing that helper.
    const crop = {
      id: "crop_carrot",
      displayNameKey: "crop.carrot.name",
      growthDurationSeconds: 300,
      growthStages: 4,
      seedItemDefinitionId: "item_carrot_seed",
      harvest: { itemDefinitionId: "item_carrot", baseQuantity: 2, xp: 4 }
    } as never;
    expect(isCropUnlocked(crop, 1)).toBe(true);
    expect(isCropUnlocked({ ...(crop as object), requiredLevel: 2 } as never, 1)).toBe(false);
    expect(isCropUnlocked({ ...(crop as object), requiredLevel: 2 } as never, 2)).toBe(true);
  });
});
