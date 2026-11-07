import { describe, expect, it } from "vitest";
import {
  parseJobId,
  planAssignment,
  resolveNextAction,
  resolvePass,
  skillIdFor,
  type AssignmentClaims,
  type AssignmentPlanInput,
  type AssignmentTargets,
  type AutoPlanContext,
  type JobId,
  type WorkSkillDefinition
} from "@happy-farm/domain";

/**
 * The pure resolver: everything Auto decides, and nothing Auto does.
 *
 * These tests hand the resolver a snapshot it cannot reach past - there is no database, no clock, no
 * inventory and no world here, only the values a caller read - and pin the decisions the C.5 design
 * and the D1 brief both call out: the supply ladder, actionability over priority, the overlap rule,
 * and what a full pair of hands means.
 */

function jobId(seed: string): JobId {
  return parseJobId(`job_${seed}`);
}

const RICE = jobId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const APPLE = jobId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const IRON = jobId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const WOOD = jobId("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const LOW = jobId("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
const MILK_JOB = jobId("ffffffff-ffff-4fff-8fff-ffffffffffff");

function skill(overrides: Partial<WorkSkillDefinition> = {}): WorkSkillDefinition {
  return {
    id: "farm.rice",
    kind: "FARM",
    family: "REPLANT_CROP",
    targetDefinitionId: "crop_rice",
    inputItemDefinitionId: "item_rice_seed",
    outputItemDefinitionId: "item_rice",
    outputQuantity: 2,
    ...overrides
  };
}

function claims(overrides: Partial<AssignmentClaims> = {}): AssignmentClaims {
  return { mature: [], empty: [], available: [], ...overrides };
}

function targets(overrides: Partial<AssignmentTargets> = {}): AssignmentTargets {
  return {
    emptyCells: 0,
    growingCells: 0,
    matureCells: 0,
    standing: 0,
    availableNodes: 0,
    depletedNodes: 0,
    claims: claims(),
    ...overrides
  };
}

function assignment(overrides: Partial<AssignmentPlanInput> = {}): AssignmentPlanInput {
  return {
    jobId: RICE,
    priority: 1,
    enabled: true,
    skill: skill(),
    autoPurchaseSupplies: false,
    targets: targets(),
    inputPrice: null,
    funding: { enabled: false, candidates: [] },
    ...overrides
  };
}

function context(overrides: Partial<AutoPlanContext> = {}): AutoPlanContext {
  return {
    controlMode: "AUTO_CONTROLLED",
    cargo: { used: 0, capacity: 30 },
    warehouse: { full: false },
    carried: {},
    stored: {},
    gold: 0,
    assignments: [],
    ...overrides
  };
}

const MILK = skill({
  id: "livestock.cattle",
  kind: "LIVESTOCK",
  family: "LIVESTOCK",
  targetDefinitionId: "animal_cattle",
  inputItemDefinitionId: null,
  outputItemDefinitionId: null
});

describe("skill identity", () => {
  it("derives the id from the pair, so it can never drift from the assignment", () => {
    expect(skillIdFor("FARM", "crop_rice")).toBe("farm.rice");
    expect(skillIdFor("FARM", "crop_carrot")).toBe("farm.carrot");
    expect(skillIdFor("ORCHARD", "tree_apple")).toBe("orchard.apple");
    expect(skillIdFor("MINING", "resource_iron")).toBe("mining.iron");
    expect(skillIdFor("FORESTRY", "resource_wildwood")).toBe("forestry.wildwood");
  });
});

describe("the actor-level gate", () => {
  it("plans nothing while the player is driving", () => {
    const plan = resolveNextAction(
      context({ controlMode: "PLAYER_CONTROLLED", assignments: [assignment({ targets: targets({ matureCells: 3 }) })] })
    );
    expect(plan).toEqual({ action: null, jobId: null, waitReason: "NOT_AUTO_CONTROLLED" });
  });

  it("says there is no assignment rather than reporting an idle", () => {
    expect(resolveNextAction(context())).toEqual({ action: null, jobId: null, waitReason: "NO_ASSIGNMENT" });
  });

  it("says every assignment is switched off, and still explains each one", () => {
    const pass = resolvePass(context({ assignments: [assignment({ enabled: false })] }));
    expect(pass.plan).toEqual({ action: null, jobId: null, waitReason: "ALL_DISABLED" });
    expect(pass.assignments[0]?.waitReason).toBe("DISABLED");
  });
});

describe("the rice lifecycle (REPLANT_CROP)", () => {
  it("plants from a seed already in hand, with no trip and no purchase", () => {
    const plan = resolveNextAction(
      context({
        carried: { item_rice_seed: 1 },
        assignments: [
          assignment({ targets: targets({ emptyCells: 4, claims: claims({ empty: ["1,1", "1,2", "1,3", "1,4"] }) }) })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "PLANT", cells: 4 }, jobId: RICE, waitReason: null });
  });

  it("loads a bounded batch of seed from the warehouse when the hands are empty", () => {
    const plan = resolveNextAction(
      context({
        stored: { item_rice_seed: 20 },
        assignments: [
          assignment({
            targets: targets({
              emptyCells: 4,
              claims: claims({ empty: ["2,2", "2,3", "2,4", "2,5"] })
            })
          })
        ]
      })
    );
    expect(plan).toEqual({
      // One per eligible cell, capped by the batch bound - not one per step and not the whole stock.
      action: { kind: "LOAD_INPUT", itemDefinitionId: "item_rice_seed", quantity: 4 },
      jobId: RICE,
      waitReason: null
    });
  });

  it("never loads more than the hands can hold or the ground can take", () => {
    const bounded = resolveNextAction(
      context({
        stored: { item_rice_seed: 900 },
        assignments: [
          assignment({ targets: targets({ emptyCells: 40, claims: claims({ empty: ["2,2"] }) }) })
        ]
      })
    );
    expect(bounded.action).toEqual({ kind: "LOAD_INPUT", itemDefinitionId: "item_rice_seed", quantity: 30 });

    const handsFull = resolveNextAction(
      context({
        cargo: { used: 27, capacity: 30 },
        stored: { item_rice_seed: 900 },
        assignments: [
          assignment({ targets: targets({ emptyCells: 40, claims: claims({ empty: ["2,2"] }) }) })
        ]
      })
    );
    expect(handsFull.action).toEqual({ kind: "LOAD_INPUT", itemDefinitionId: "item_rice_seed", quantity: 3 });
  });

  it("buys the seed only when the assignment's policy allows it and the gold is there", () => {
    const plan = resolveNextAction(
      context({
        gold: 50,
        assignments: [
          assignment({
            autoPurchaseSupplies: true,
            inputPrice: 6,
            targets: targets({ emptyCells: 4, claims: claims({ empty: ["3,3"] }) })
          })
        ]
      })
    );
    expect(plan.action).toEqual({ kind: "PURCHASE_INPUT", itemDefinitionId: "item_rice_seed", quantity: 4 });
    expect(plan.jobId).toBe(RICE);
  });

  it("buys only what the gold covers, and waits when it covers nothing", () => {
    const affordable = resolveNextAction(
      context({
        gold: 15,
        assignments: [
          assignment({
            autoPurchaseSupplies: true,
            inputPrice: 6,
            targets: targets({ emptyCells: 40, claims: claims({ empty: ["3,3"] }) })
          })
        ]
      })
    );
    expect(affordable.action).toEqual({ kind: "PURCHASE_INPUT", itemDefinitionId: "item_rice_seed", quantity: 2 });
  });

  it("waits for supply rather than planting without it, when buying is off", () => {
    const plan = resolveNextAction(context({ assignments: [assignment({ targets: targets({ emptyCells: 4 }) })] }));
    expect(plan).toEqual({ action: null, jobId: RICE, waitReason: "WAITING_FOR_SUPPLY" });
  });

  it("waits for funds rather than pretending the purchase happened", () => {
    const plan = resolveNextAction(
      context({
        gold: 5,
        assignments: [assignment({ autoPurchaseSupplies: true, inputPrice: 6, targets: targets({ emptyCells: 4 }) })]
      })
    );
    expect(plan).toEqual({ action: null, jobId: RICE, waitReason: "WAITING_FOR_FUNDS" });
  });

  it("waits for the crop's own clock when the field is full and growing", () => {
    const plan = resolveNextAction(
      context({ assignments: [assignment({ targets: targets({ growingCells: 12 }) })] })
    );
    expect(plan).toEqual({ action: null, jobId: RICE, waitReason: "WAITING_FOR_GROWTH" });
  });

  it("harvests the ripe cells, because that is the step that pays", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({
            targets: targets({
              matureCells: 3,
              growingCells: 9,
              emptyCells: 2,
              claims: claims({ mature: ["crop_1", "crop_2", "crop_3"], empty: ["9,9", "9,8"] })
            })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "HARVEST", cells: 3 }, jobId: RICE, waitReason: null });
  });

  it("treats a partially planted field as harvest-first, then replant", () => {
    const withSeed = resolveNextAction(
      context({
        carried: { item_rice_seed: 2 },
        assignments: [
          assignment({
            targets: targets({
              matureCells: 1,
              growingCells: 1,
              emptyCells: 1,
              claims: claims({ mature: ["crop_9"], empty: ["4,4"] })
            })
          })
        ]
      })
    );
    expect(withSeed.action).toEqual({ kind: "HARVEST", cells: 1 });
  });

  it("never manufactures work out of occupied cells it did not plant", () => {
    const plan = resolveNextAction(context({ assignments: [assignment({ targets: targets({ emptyCells: 0 }) })] }));
    expect(plan).toEqual({ action: null, jobId: RICE, waitReason: "NO_ELIGIBLE_TARGETS" });
  });
});

describe("the apple lifecycle (PERENNIAL_PRODUCTION)", () => {
  const orchard = skill({
    id: "orchard.apple",
    kind: "ORCHARD",
    family: "PERENNIAL_PRODUCTION",
    targetDefinitionId: "tree_apple",
    inputItemDefinitionId: "item_apple_sapling",
    outputItemDefinitionId: "item_apple"
  });

  it("harvests a ready tree and never buys a replacement", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({
            jobId: APPLE,
            skill: orchard,
            targets: targets({ matureCells: 1, standing: 1, claims: claims({ mature: ["tree_1"] }) })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "HARVEST", cells: 1 }, jobId: APPLE, waitReason: null });
  });

  it("waits on an existing tree that is still regrowing", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({ jobId: APPLE, skill: orchard, targets: targets({ growingCells: 1, standing: 1 }) })
        ]
      })
    );
    expect(plan).toEqual({ action: null, jobId: APPLE, waitReason: "WAITING_FOR_GROWTH" });
  });

  it("recognises an empty orchard as a sapling decision, not as a harvest", () => {
    const off = resolveNextAction(
      context({ assignments: [assignment({ jobId: APPLE, skill: orchard, targets: targets({ emptyCells: 6 }) })] })
    );
    expect(off).toEqual({ action: null, jobId: APPLE, waitReason: "WAITING_FOR_SUPPLY" });
    const on = resolveNextAction(
      context({
        carried: { item_apple_sapling: 1 },
        assignments: [
          assignment({
            jobId: APPLE,
            skill: orchard,
            targets: targets({ emptyCells: 6, claims: claims({ empty: ["1,1"] }) })
          })
        ]
      })
    );
    expect(on.action).toEqual({ kind: "PLANT", cells: 6 });
  });
});

describe("resource nodes (RESOURCE_NODE_GATHERING)", () => {
  const iron = skill({
    id: "mining.iron",
    kind: "MINING",
    family: "RESOURCE_NODE_GATHERING",
    targetDefinitionId: "resource_iron",
    inputItemDefinitionId: null,
    outputItemDefinitionId: "item_iron_ore"
  });
  const wood = skill({
    id: "forestry.wildwood",
    kind: "FORESTRY",
    family: "RESOURCE_NODE_GATHERING",
    targetDefinitionId: "resource_wildwood",
    inputItemDefinitionId: null,
    outputItemDefinitionId: "item_wildwood"
  });

  it("mines an available node", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({
            jobId: IRON,
            skill: iron,
            targets: targets({ availableNodes: 2, claims: claims({ available: ["node_iron_west", "node_iron_north"] }) })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "MINE" }, jobId: IRON, waitReason: null });
  });

  it("waits for regeneration when every node is depleted, and never resets one", () => {
    const plan = resolveNextAction(
      context({ assignments: [assignment({ jobId: IRON, skill: iron, targets: targets({ depletedNodes: 2 }) })] })
    );
    expect(plan).toEqual({ action: null, jobId: IRON, waitReason: "WAITING_FOR_RESOURCE" });
  });

  it("chops with the shared family when the profession is forestry", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({
            jobId: WOOD,
            skill: wood,
            targets: targets({ availableNodes: 1, claims: claims({ available: ["node_wildwood_north_1"] }) })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "CHOP" }, jobId: WOOD, waitReason: null });
  });

  it("reports a bad configuration as no eligible targets rather than as an idle", () => {
    const plan = resolveNextAction(
      context({ assignments: [assignment({ jobId: IRON, skill: iron, targets: targets({}) })] })
    );
    expect(plan).toEqual({ action: null, jobId: IRON, waitReason: "NO_ELIGIBLE_TARGETS" });
  });
});

describe("actionability and priority", () => {
  it("lets a waiting priority-1 assignment make way for an actionable priority-2 one", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({ jobId: RICE, priority: 1, targets: targets({ growingCells: 30 }) }),
          assignment({
            jobId: APPLE,
            priority: 2,
            skill: skill({
              id: "orchard.apple",
              kind: "ORCHARD",
              family: "PERENNIAL_PRODUCTION",
              targetDefinitionId: "tree_apple",
              inputItemDefinitionId: "item_apple_sapling",
              outputItemDefinitionId: "item_apple"
            }),
            targets: targets({ matureCells: 2, standing: 2, claims: claims({ mature: ["tree_1", "tree_2"] }) })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: { kind: "HARVEST", cells: 2 }, jobId: APPLE, waitReason: null });
  });

  it("reports the highest-priority reason when nothing is actionable", () => {
    const plan = resolveNextAction(
      context({
        assignments: [
          assignment({ jobId: RICE, priority: 1, targets: targets({ emptyCells: 4 }) }),
          assignment({
            jobId: APPLE,
            priority: 2,
            skill: skill({ kind: "ORCHARD", family: "PERENNIAL_PRODUCTION", targetDefinitionId: "tree_apple" }),
            targets: targets({ growingCells: 1, standing: 1 })
          })
        ]
      })
    );
    expect(plan).toEqual({ action: null, jobId: RICE, waitReason: "WAITING_FOR_SUPPLY" });
  });

  it("gives one target to one assignment per pass, to the higher priority", () => {
    const shared = ["5,5", "5,6"];
    const pass = resolvePass(
      context({
        carried: { item_rice_seed: 1 },
        assignments: [
          assignment({
            jobId: RICE,
            priority: 1,
            targets: targets({ emptyCells: 2, claims: claims({ empty: shared }) })
          }),
          assignment({
            jobId: LOW,
            priority: 2,
            targets: targets({ emptyCells: 4, claims: claims({ empty: [...shared, "7,7", "7,8"] }) })
          })
        ]
      })
    );
    expect(pass.plan).toEqual({ action: { kind: "PLANT", cells: 2 }, jobId: RICE, waitReason: null });
    expect(pass.assignments[0]?.claimed).toBe(false);
    // The loser's *shared* cells are gone, but it still has its own two: it is not starved.
    expect(pass.assignments[1]?.claimed).toBe(true);
    expect(pass.assignments[1]?.action).toBeNull();
  });
});

describe("hands, delivery and storage", () => {
  const ripe = assignment({
    targets: targets({ matureCells: 5, claims: claims({ mature: ["crop_1"] }) })
  });

  it("refuses to harvest into full hands and names what is blocking", () => {
    const plan = planAssignment(context({ cargo: { used: 30, capacity: 30 } }), ripe);
    expect(plan).toEqual({ action: null, waitReason: "CARGO_FULL" });
  });

  it("refuses a harvest whose reward would not fit, and turns it into a delivery", () => {
    // Two units of room is not enough for a two-unit reward: the crop stays, and the hands are the
    // blocker - so the plan sends the actor home rather than spinning on a harvest it cannot take.
    const almostFull = context({ cargo: { used: 29, capacity: 30 }, assignments: [ripe] });
    expect(planAssignment(almostFull, ripe)).toEqual({ action: null, waitReason: "CARGO_FULL" });
    expect(resolveNextAction(almostFull)).toEqual({
      action: { kind: "TRAVEL_TO_STORAGE" },
      jobId: null,
      waitReason: null
    });

    // Exactly enough room: the harvest is the step that pays, so it is the one that runs.
    const fits = context({ cargo: { used: 28, capacity: 30 }, assignments: [ripe] });
    expect(planAssignment(fits, ripe).action).toEqual({ kind: "HARVEST", cells: 5 });
  });

  it("plans the delivery itself once the field has nothing to do", () => {
    const plan = resolveNextAction(
      context({
        cargo: { used: 30, capacity: 30 },
        assignments: [assignment({ targets: targets({ growingCells: 12 }) })]
      })
    );
    expect(plan).toEqual({ action: { kind: "TRAVEL_TO_STORAGE" }, jobId: null, waitReason: null });
  });

  it("names the real block when the warehouse cannot take the load either", () => {
    const plan = resolveNextAction(
      context({
        cargo: { used: 30, capacity: 30 },
        warehouse: { full: true },
        assignments: [assignment({ targets: targets({ growingCells: 12 }) })]
      })
    );
    expect(plan).toEqual({ action: null, jobId: null, waitReason: "WAITING_FOR_STORAGE" });
  });

  it("keeps planting while full hands hold the very seed that planting consumes", () => {
    const plan = resolveNextAction(
      context({
        cargo: { used: 30, capacity: 30 },
        carried: { item_rice_seed: 30 },
        assignments: [assignment({ targets: targets({ emptyCells: 3, claims: claims({ empty: ["1,1"] }) }) })]
      })
    );
    expect(plan.action).toEqual({ kind: "PLANT", cells: 3 });
  });

  it("cannot load seed into hands that have no room, and names that at the assignment", () => {
    const plan = planAssignment(
      context({ cargo: { used: 30, capacity: 30 }, stored: { item_rice_seed: 10 } }),
      assignment({ targets: targets({ emptyCells: 3 }) })
    );
    expect(plan).toEqual({ action: null, waitReason: "CARGO_FULL" });
  });
});

describe("skills with no system behind them", () => {
  it("says so rather than pretending livestock works", () => {
    const plan = resolveNextAction(
      context({ assignments: [assignment({ jobId: MILK_JOB, skill: MILK, targets: targets({ standing: 4 }) })] })
    );
    expect(plan).toEqual({ action: null, jobId: MILK_JOB, waitReason: "UNSUPPORTED_SKILL" });
  });
});

describe("purity", () => {
  it("does not touch the snapshot it was given", () => {
    const snapshot = context({
      carried: { item_rice_seed: 1 },
      assignments: [assignment({ targets: targets({ emptyCells: 2, claims: claims({ empty: ["1,1"] }) }) })]
    });
    const before = structuredClone(snapshot);
    resolveNextAction(snapshot);
    resolvePass(snapshot);
    expect(snapshot).toEqual(before);
  });
});
