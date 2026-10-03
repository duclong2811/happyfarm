import { describe, expect, it } from "vitest";
import {
  DomainError,
  assertResourceAction,
  isResourceAvailable,
  isAtOrAfter,
  instantAfter,
  parseResourceActionId,
  resourceAvailableAt,
  resourceQuantity,
  secondsUntil,
  secondsUntilResourceAvailable,
  selectResourceDrop,
  totalDropWeight,
  type ResourceAction
} from "@happy-farm/domain";
import { PLAYER_ONE_ID } from "../support/fixtures";

/**
 * The generic resource rules: which drop, how much, when a node is back, and what an action is.
 *
 * Nothing here knows about rocks or a pickaxe, and the shared time arithmetic is the same one fishing
 * uses - so a forestry node with `CHOP` would be exercised by these same functions.
 */

const TABLE = [
  { itemDefinitionId: "item_stone", minQuantity: 2, maxQuantity: 2, weight: 70 },
  { itemDefinitionId: "item_copper_ore", minQuantity: 1, maxQuantity: 3, weight: 30 }
];
const FIRST_ENTRY = { itemDefinitionId: "item_stone", minQuantity: 2, maxQuantity: 2, weight: 70 };

const START = "2026-10-03T00:00:00.000Z";

function action(overrides: Partial<ResourceAction> = {}): ResourceAction {
  return {
    actionId: parseResourceActionId("resact_11111111-1111-4111-8111-111111111111"),
    actorPlayerId: PLAYER_ONE_ID,
    zoneKind: "HOME_ISLAND",
    zoneId: "zone_home_island_farm_11111111-1111-4111-8111-111111111111",
    nodeId: "node_stone_ridge",
    definitionId: "resource_stone",
    verb: "MINE",
    status: "ACTIVE",
    startedAt: START,
    readyAt: "2026-10-03T00:00:06.000Z",
    settledAt: null,
    version: 1,
    createdAt: START,
    updatedAt: START,
    ...overrides
  };
}

describe("the shared time helpers", () => {
  it("adds a duration to an instant and measures the wait back", () => {
    expect(instantAfter(START, 15)).toBe("2026-10-03T00:00:15.000Z");
    expect(secondsUntil("2026-10-03T00:00:15.000Z", START)).toBe(15);
    expect(secondsUntil("2026-10-03T00:00:15.000Z", "2026-10-03T00:00:20.000Z")).toBe(0);
    expect(isAtOrAfter("2026-10-03T00:00:15.000Z", START)).toBe(false);
    expect(isAtOrAfter("2026-10-03T00:00:15.000Z", "2026-10-03T00:00:15.000Z")).toBe(true);
  });

  it("refuses unusable timing rather than guessing", () => {
    expect(() => instantAfter("nonsense", 5)).toThrow(DomainError);
    expect(() => instantAfter(START, 0)).toThrow(DomainError);
    expect(() => secondsUntil("nonsense", START)).toThrow(DomainError);
  });
});

describe("the drop draw", () => {
  it("sums weights and maps a roll to the entry whose band contains it", () => {
    expect(totalDropWeight(TABLE)).toBe(100);
    expect(selectResourceDrop(TABLE, 0).itemDefinitionId).toBe("item_stone");
    expect(selectResourceDrop(TABLE, 0.6999).itemDefinitionId).toBe("item_stone");
    expect(selectResourceDrop(TABLE, 0.7).itemDefinitionId).toBe("item_copper_ore");
    expect(selectResourceDrop(TABLE, 0.999).itemDefinitionId).toBe("item_copper_ore");
  });

  it("refuses an empty table, a bad weight and a roll outside [0, 1)", () => {
    expect(() => totalDropWeight([])).toThrow(DomainError);
    expect(() => totalDropWeight([{ ...FIRST_ENTRY, weight: 0 }])).toThrow(DomainError);
    for (const roll of [-0.1, 1, Number.NaN]) {
      expect(() => selectResourceDrop(TABLE, roll), String(roll)).toThrow(DomainError);
    }
  });

  it("yields an exact quantity when the range is a point, and respects a range otherwise", () => {
    const exact = { itemDefinitionId: "item_stone", minQuantity: 2, maxQuantity: 2, weight: 1 };
    for (const roll of [0, 0.5, 0.999]) {
      expect(resourceQuantity(exact, roll)).toBe(2);
    }
    const range = { itemDefinitionId: "item_copper_ore", minQuantity: 1, maxQuantity: 3, weight: 1 };
    expect(resourceQuantity(range, 0)).toBe(1);
    expect(resourceQuantity(range, 0.5)).toBe(2);
    expect(resourceQuantity(range, 0.999)).toBe(3);
    expect(() => resourceQuantity(range, 1)).toThrow(DomainError);
  });
});

describe("node availability", () => {
  it("treats a node with no state row as available: nothing has ever been gathered", () => {
    expect(isResourceAvailable(null, START)).toBe(true);
    expect(secondsUntilResourceAvailable(null, START)).toBe(0);
  });

  it("derives availability from the server clock alone", () => {
    const availableAt = resourceAvailableAt(START, 120);
    expect(availableAt).toBe("2026-10-03T00:02:00.000Z");
    expect(isResourceAvailable(availableAt, START)).toBe(false);
    expect(secondsUntilResourceAvailable(availableAt, START)).toBe(120);
    expect(isResourceAvailable(availableAt, "2026-10-03T00:01:59.500Z")).toBe(false);
    expect(isResourceAvailable(availableAt, "2026-10-03T00:02:00.000Z")).toBe(true);
    // An offline player comes back to a ready node with no intermediate request.
    expect(isResourceAvailable(availableAt, "2026-10-04T00:00:00.000Z")).toBe(true);
  });

  it("refuses an unusable regeneration duration", () => {
    expect(() => resourceAvailableAt(START, 0)).toThrow(DomainError);
    expect(() => resourceAvailableAt("nonsense", 60)).toThrow(DomainError);
  });
});

describe("the resource action shape", () => {
  it("accepts an active action and a settled one", () => {
    expect(() => {
      assertResourceAction(action());
    }).not.toThrow();
    expect(() => {
      assertResourceAction(action({ verb: "CHOP", status: "SETTLED", settledAt: START, version: 2 }));
    }).not.toThrow();
  });

  it("refuses an action that could not have been produced", () => {
    for (const broken of [
      action({ actionId: "fishact_11111111-1111-4111-8111-111111111111" as ResourceAction["actionId"] }),
      action({ nodeId: "rock_1" }),
      action({ definitionId: "stone" }),
      action({ verb: "DIG" as ResourceAction["verb"] }),
      action({ zoneId: "" }),
      action({ readyAt: "nonsense" }),
      action({ version: 0 }),
      action({ status: "SETTLED", settledAt: null })
    ]) {
      expect(() => {
        assertResourceAction(broken);
      }).toThrow(DomainError);
    }
  });
});
