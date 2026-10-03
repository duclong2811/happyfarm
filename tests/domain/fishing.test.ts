import { describe, expect, it } from "vitest";
import {
  assertFishingAction,
  DomainError,
  fishingReadyAt,
  isFishingReady,
  parseFishingActionId,
  secondsUntilFishingReady,
  selectCatch,
  totalCatchWeight,
  type FishingAction
} from "@happy-farm/domain";
import { PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The three exact pieces of fishing: a weighted draw, a wait, and an action's shape.
 *
 * Nothing here reads a database, a clock or `Math.random`: the roll is a parameter, the time is a
 * string, and the shape is a value. That is what makes the catch table reviewable and the wait
 * reproducible in a test.
 */

const TABLE = [
  { fishId: "fish_sardine", weight: 45 },
  { fishId: "fish_mackerel", weight: 30 },
  { fishId: "fish_snapper", weight: 20 },
  { fishId: "fish_tuna", weight: 5 }
];

const START = "2026-10-03T00:00:00.000Z";

function action(overrides: Partial<FishingAction> = {}): FishingAction {
  return {
    actionId: parseFishingActionId("fishact_11111111-1111-4111-8111-111111111111"),
    actorPlayerId: PLAYER_ONE_ID,
    zoneKind: "HOME_ISLAND",
    zoneId: "zone_home_island_farm_11111111-1111-4111-8111-111111111111",
    spotId: "spot_pond_north",
    tableId: "fishtable_freshwater",
    status: "ACTIVE",
    startedAt: START,
    readyAt: "2026-10-03T00:00:15.000Z",
    settledAt: null,
    version: 1,
    createdAt: START,
    updatedAt: START,
    ...overrides
  };
}

describe("the catch draw", () => {
  it("sums the weights and refuses an empty or malformed table", () => {
    expect(totalCatchWeight(TABLE)).toBe(100);
    expect(() => totalCatchWeight([])).toThrow(DomainError);
    expect(() => totalCatchWeight([{ fishId: "fish_x", weight: 0 }])).toThrow(DomainError);
    expect(() => totalCatchWeight([{ fishId: "fish_x", weight: 1.5 }])).toThrow(DomainError);
  });

  it("maps a roll to the entry whose band contains it", () => {
    // Bands: sardine [0,45), mackerel [45,75), snapper [75,95), tuna [95,100).
    expect(selectCatch(TABLE, 0).fishId).toBe("fish_sardine");
    expect(selectCatch(TABLE, 0.4499).fishId).toBe("fish_sardine");
    expect(selectCatch(TABLE, 0.45).fishId).toBe("fish_mackerel");
    expect(selectCatch(TABLE, 0.7499).fishId).toBe("fish_mackerel");
    expect(selectCatch(TABLE, 0.75).fishId).toBe("fish_snapper");
    expect(selectCatch(TABLE, 0.9499).fishId).toBe("fish_snapper");
    expect(selectCatch(TABLE, 0.95).fishId).toBe("fish_tuna");
    expect(selectCatch(TABLE, 0.999999).fishId).toBe("fish_tuna");
  });

  it("refuses a roll outside [0, 1) instead of clamping it", () => {
    for (const roll of [-0.001, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => selectCatch(TABLE, roll), String(roll)).toThrow(DomainError);
    }
  });

  it("is deterministic: the same roll always lands on the same fish", () => {
    for (const roll of [0, 0.1, 0.5, 0.9, 0.999]) {
      expect(selectCatch(TABLE, roll)).toEqual(selectCatch(TABLE, roll));
    }
  });

  it("covers the whole range: every species can be caught by some roll", () => {
    const seen = new Set<string>();
    for (let step = 0; step < 1000; step += 1) {
      seen.add(selectCatch(TABLE, step / 1000).fishId);
    }
    expect(seen).toEqual(new Set(TABLE.map((entry) => entry.fishId)));
  });
});

describe("the fishing wait", () => {
  it("becomes ready exactly after the action duration", () => {
    expect(fishingReadyAt(START, 15)).toBe("2026-10-03T00:00:15.000Z");
    expect(secondsUntilFishingReady("2026-10-03T00:00:15.000Z", START)).toBe(15);
    expect(isFishingReady(action(), START)).toBe(false);
    expect(isFishingReady(action(), "2026-10-03T00:00:14.999Z")).toBe(false);
    expect(isFishingReady(action(), "2026-10-03T00:00:15.000Z")).toBe(true);
    expect(isFishingReady(action(), "2026-10-03T00:01:00.000Z")).toBe(true);
  });

  it("never reports a negative wait, and rounds up to whole seconds", () => {
    expect(secondsUntilFishingReady("2026-10-03T00:00:15.000Z", "2026-10-03T00:00:20.000Z")).toBe(0);
    expect(secondsUntilFishingReady("2026-10-03T00:00:15.000Z", "2026-10-03T00:00:14.500Z")).toBe(1);
  });

  it("refuses unusable timing rather than guessing", () => {
    expect(() => fishingReadyAt("not-a-time", 15)).toThrow(DomainError);
    expect(() => fishingReadyAt(START, 0)).toThrow(DomainError);
    expect(() => secondsUntilFishingReady("nonsense", START)).toThrow(DomainError);
  });
});

describe("the fishing action shape", () => {
  it("accepts an active action and a settled one with a settlement time", () => {
    expect(() => {
      assertFishingAction(action());
    }).not.toThrow();
    expect(() => {
      assertFishingAction(action({ status: "SETTLED", settledAt: START, version: 2 }));
    }).not.toThrow();
  });

  it("refuses an action that could not have been produced", () => {
    for (const broken of [
      action({ actionId: "cropinst_11111111-1111-4111-8111-111111111111" as FishingAction["actionId"] }),
      action({ spotId: "pond" }),
      action({ tableId: "table" }),
      action({ zoneKind: "" }),
      action({ zoneId: "" }),
      action({ startedAt: "nonsense" }),
      action({ version: 0 }),
      action({ status: "SETTLED", settledAt: null })
    ]) {
      expect(() => {
        assertFishingAction(broken);
      }).toThrow(DomainError);
    }
  });
});
