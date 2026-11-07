import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AutoPlanDTO, AutoStepDTO, JobDTO, WorkAreaSummaryDTO } from "@happy-farm/contracts";
import {
  autoFieldProgress,
  autoPreviewFor,
  autoRunStatusFor,
  autoStatusFor,
  compatibleAreas,
  jobListSignature,
  jobOrderOf,
  jobTargetsFor,
  kindIsAssignable,
  lifecycleStepsFor,
  moveJobInOrder,
  planForAssignment,
  type JobTargetSources
} from "../../apps/web/src/workers/model";

/**
 * The worker panel's pure half, and the promise that it stays off the farm's hot paths.
 *
 * A job is configuration: the panel chooses from the definitions the world already ships, offers only
 * areas of the matching kind, and says plainly that nothing works the assignments yet. These tests
 * pin the choice rules, the order arithmetic, and the fact that jobs are read in exactly one place.
 */

const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));

const SOURCES: JobTargetSources = {
  crops: [
    { cropDefinitionId: "crop_carrot", displayNameKey: "crop.carrot.name" },
    { cropDefinitionId: "crop_wheat", displayNameKey: "crop.wheat.name" }
  ],
  trees: [{ treeDefinitionId: "tree_apple", displayNameKey: "tree.apple.name" }],
  resourceNodes: [
    { definitionId: "resource_stone", displayNameKey: "resource.stone.name", verb: "MINE" },
    { definitionId: "resource_stone", displayNameKey: "resource.stone.name", verb: "MINE" },
    { definitionId: "resource_iron", displayNameKey: "resource.iron.name", verb: "MINE" },
    { definitionId: "resource_wildwood", displayNameKey: "resource.wildwood.name", verb: "CHOP" }
  ]
};

function area(workAreaId: string, kind: string, displayName: string): WorkAreaSummaryDTO {
  return {
    workAreaId,
    farmId: "farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: kind as WorkAreaSummaryDTO["kind"],
    displayName,
    cellCount: 4,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    jobId: "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actorId: "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workAreaId: "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "FARM",
    targetDefinitionId: "crop_carrot",
    targetDisplayNameKey: "crop.carrot.name",
    priority: 1,
    enabled: true,
    autoPurchaseSupplies: false,
    autoFundingEnabled: false,
    fundingItems: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("what can be assigned", () => {
  it("takes each profession's targets from its own catalogue", () => {
    expect(jobTargetsFor("FARM", SOURCES).map((option) => option.id)).toEqual(["crop_carrot", "crop_wheat"]);
    expect(jobTargetsFor("ORCHARD", SOURCES).map((option) => option.id)).toEqual(["tree_apple"]);
    // Mining and forestry read the definitions the island's own nodes are placed with, split by verb
    // and de-duplicated - and only what is actually in the world.
    expect(jobTargetsFor("MINING", SOURCES).map((option) => option.id)).toEqual(["resource_stone", "resource_iron"]);
    expect(jobTargetsFor("FORESTRY", SOURCES).map((option) => option.id)).toEqual(["resource_wildwood"]);
  });

  it("offers nothing for a profession the game cannot describe yet", () => {
    expect(jobTargetsFor("LIVESTOCK", SOURCES)).toEqual([]);
    expect(jobTargetsFor("AQUACULTURE", SOURCES)).toEqual([]);
    expect(kindIsAssignable("LIVESTOCK", SOURCES)).toBe(false);
    expect(kindIsAssignable("MINING", SOURCES)).toBe(true);
  });

  it("offers only areas of the matching kind", () => {
    const areas = [area("workarea_1", "FARM", "East Field"), area("workarea_2", "MINING", "North Mine")];
    expect(compatibleAreas("FARM", areas).map((entry) => entry.workAreaId)).toEqual(["workarea_1"]);
    expect(compatibleAreas("MINING", areas).map((entry) => entry.workAreaId)).toEqual(["workarea_2"]);
    expect(compatibleAreas("ORCHARD", areas)).toEqual([]);
  });
});

describe("the order", () => {
  const order = ["job_a", "job_b", "job_c"];

  it("moves one job one place and returns the whole new order", () => {
    expect(moveJobInOrder(order, "job_b", -1)).toEqual(["job_b", "job_a", "job_c"]);
    expect(moveJobInOrder(order, "job_b", 1)).toEqual(["job_a", "job_c", "job_b"]);
  });

  it("leaves the order alone at the edges and for an unknown job", () => {
    expect(moveJobInOrder(order, "job_a", -1)).toEqual(order);
    expect(moveJobInOrder(order, "job_c", 1)).toEqual(order);
    expect(moveJobInOrder(order, "job_z", 1)).toEqual(order);
  });

  it("reads the order off the list, and re-renders only when something visible changed", () => {
    const jobs = [job({ jobId: "job_a" }), job({ jobId: "job_b", priority: 2 })];
    expect(jobOrderOf(jobs)).toEqual(["job_a", "job_b"]);
    const base = jobListSignature(jobs);
    expect(jobListSignature([...jobs])).toBe(base);
    expect(jobListSignature([job({ jobId: "job_a" }), job({ jobId: "job_b", priority: 2, enabled: false })])).not.toBe(base);
    expect(jobListSignature([job({ jobId: "job_a" }), job({ jobId: "job_b", priority: 2, version: 3 })])).not.toBe(base);
    expect(jobListSignature([job({ jobId: "job_b", priority: 2 }), job({ jobId: "job_a", priority: 1 })])).not.toBe(base);
  });
});

describe("jobs stay off the farm's hot paths", () => {
  function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `main.ts declares ${signature}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("reads them in exactly one place, and never from a farm load or the growth poll", () => {
    const source = readFileSync(MAIN, "utf8");
    expect(source.split("getWorkers(").length - 1).toBe(1);
    for (const signature of [
      "async function refreshFarm(",
      "async function refreshGrowth(",
      "async function refreshAccount("
    ]) {
      const body = functionBody(source, signature);
      expect(body, signature).not.toContain("Job");
      expect(body, signature).not.toContain("job");
      expect(body, signature).not.toContain("worker");
    }
  });

  it("loads them when the panel opens, and nowhere on a timer", () => {
    const source = readFileSync(MAIN, "utf8");
    const load = functionBody(source, "async function loadWorkers(");
    expect(load).toContain("api().getWorkers(");
    const open = functionBody(source, "function setActivePanel(");
    expect(open).toContain('panels.active === "workers"');
    expect(open).toContain("loadWorkers()");
    // No timer may name the worker panel at all.
    const poll = functionBody(source, "function refreshGrowthOnce(");
    expect(poll).not.toContain("worker");
    expect(poll).not.toContain("job");
  });

  it("reads cargo with the same panel, and unloads only from the button", () => {
    const source = readFileSync(MAIN, "utf8");
    // Two read sites, both deliberate: the worker panel's own load (beside the actor and the areas),
    // and the one settled Auto step's refresh. Never a third, and never on a hot path.
    expect(source.split("getActorCargo(").length - 1).toBe(2);
    expect(functionBody(source, "async function loadWorkers(")).toContain("api().getActorCargo(");
    expect(functionBody(source, "async function refreshAfterAutoStep(")).toContain("getActorCargo(");
    // One write site: the unload button's handler.
    expect(source.split("unloadCargo(").length - 1).toBe(1);
    expect(source).toContain('element<HTMLButtonElement>("workers-cargo-unload").addEventListener');
    expect(functionBody(source, "async function unloadCargoAtWarehouse(")).toContain("client.unloadCargo(");
    // And neither the growth poll nor the movement loop knows cargo exists.
    expect(functionBody(source, "function refreshGrowthOnce(")).not.toContain("cargo");
    expect(functionBody(source, "async function refreshFarm(")).not.toContain("cargo");
  });

  it("reads the plan with the same panel, and never on a timer or a hot path", () => {
    const source = readFileSync(MAIN, "utf8");
    // The panel's own load, plus the one re-read a settled step performs while the sheet is open.
    expect(source.split("getAutoPlan(").length - 1).toBe(2);
    expect(functionBody(source, "async function loadWorkers(")).toContain("api().getAutoPlan(");
    // The resolver is a plan read, not a poll: no timer, no frame, no pointer, no movement loop.
    for (const signature of [
      "function refreshGrowthOnce(",
      "async function refreshFarm(",
      "async function refreshGrowth(",
      "async function refreshAccount("
    ]) {
      const body = functionBody(source, signature);
      expect(body, signature).not.toContain("AutoPlan");
      expect(body, signature).not.toContain("autoPlan");
    }
  });

  it("drives Auto from one step function, and never from a repeating timer", () => {
    const source = readFileSync(MAIN, "utf8");
    // One place asks the server to advance, and one place schedules the next ask.
    expect(source.split("advanceAuto(").length - 1).toBe(1);
    expect(source.split("setTimeout(").length - 1).toBeGreaterThanOrEqual(2);
    // The loop is a one-shot schedule driven by the server's own numbers, not a poll.
    const schedule = functionBody(source, "function scheduleAutoStep(");
    expect(schedule).toContain("setTimeout(");
    expect(schedule).not.toContain("setInterval(");
    expect(schedule).toContain("document.visibilityState");
    // And the step loop never runs from the growth poll, a farm load or the account refresh.
    for (const signature of ["function refreshGrowthOnce(", "async function refreshFarm(", "async function refreshAccount("]) {
      const body = functionBody(source, signature);
      expect(body, signature).not.toContain("runAutoStep");
      expect(body, signature).not.toContain("advanceAuto");
      expect(body, signature).not.toContain("scheduleAutoStep");
    }
  });

  it("rehydrates authoritative state when a late step reports STOPPED", () => {
    const source = readFileSync(MAIN, "utf8");
    const step = functionBody(source, "async function runAutoStep(");
    expect(step).toContain('result.step.phase === "STOPPED"');
    expect(step).toContain("await loadWorkers()");
    expect(step).toContain("cancelAutoStepTimer()");
    expect(step).toContain("renderResourcePanel()");
  });

  it("refreshes the Warehouse projection only after Auto unload", () => {
    const source = readFileSync(MAIN, "utf8");
    const refresh = functionBody(source, "async function refreshAfterAutoStep(");
    expect(refresh).toContain('step.step === "UNLOAD"');
    expect(refresh).toContain("getWarehouse()");
    expect(refresh).not.toContain("refreshAccount()");
  });

  it("does not show a manual out-of-range prompt while Auto owns the actor", () => {
    const source = readFileSync(MAIN, "utf8");
    const interaction = functionBody(source, "function renderInteraction(");
    expect(interaction).toContain("const autoDriving = autoIsDriving()");
    expect(interaction).toContain("!autoDriving");
  });

  it("opening another panel never stops the Auto scheduler", () => {
    const source = readFileSync(MAIN, "utf8");
    const open = functionBody(source, "function setActivePanel(");
    expect(open).not.toContain("stopAutoStepLoop");
  });

  it("switching camera modes never changes Auto control", () => {
    const source = readFileSync(MAIN, "utf8");
    const cameraStart = source.indexOf("function setCameraMode(");
    const cameraEnd = source.indexOf("function selectCameraFocus", cameraStart);
    const camera = source.slice(cameraStart, cameraEnd > cameraStart ? cameraEnd : cameraStart + 2200);
    expect(camera).not.toContain("stopAutoStepLoop");
    expect(camera).not.toContain("requestTakeoverFromInput");
    expect(camera).toContain("if (!autoIsDriving()) playerRuntime.clearDestination()");
  });

  it("treats target selection as inspection while Auto owns the actor", () => {
    const source = readFileSync(MAIN, "utf8");
    const targetStart = source.indexOf("function onWorldTargetSelected(");
    const targetEnd = source.indexOf("/** Exact open-ground movement target", targetStart);
    const targetSelection = source.slice(targetStart, targetEnd);
    expect(targetSelection).not.toContain("requestTakeoverFromInput");
    expect(targetSelection).toContain("TARGET_SELECTED_WHILE_AUTO");
    expect(targetSelection).toContain("if (destination !== null) playerRuntime.setDestination(destination)");
    expect(targetSelection).toContain("if (autoIsDriving())");
  });

  it("does not reroute a selected object while Auto owns the actor", () => {
    const source = readFileSync(MAIN, "utf8");
    const objectStart = source.indexOf("function onObjectSelectedForCharacter(");
    const objectEnd = source.indexOf("/** Whether this cell has anything", objectStart);
    const objectSelection = source.slice(objectStart, objectEnd);
    expect(objectSelection).toContain("resolved !== undefined && !autoIsDriving()");
    expect(objectSelection).toContain("OBJECT_SELECTED_WHILE_AUTO");
  });

  it("keeps the only takeover paths explicit", () => {
    const source = readFileSync(MAIN, "utf8");
    expect(source).toContain('requestTakeoverFromInput("PLAYER_MOVEMENT")');
    expect(source).toContain('requestTakeoverFromInput("GO_BUTTON")');
    expect(source).not.toContain("requestTakeoverFromInput();");
  });
});

describe("the production cycle a skill runs", () => {
  it("draws the replanting loop for a crop, and a plant-once loop for an orchard", () => {
    expect(lifecycleStepsFor("REPLANT_CROP")).toEqual(["seed", "plant", "grow", "harvest", "warehouse", "repeat"]);
    expect(lifecycleStepsFor("PERENNIAL_PRODUCTION")).toEqual([
      "sapling",
      "plantOnce",
      "grow",
      "harvest",
      "warehouse",
      "repeat"
    ]);
    expect(lifecycleStepsFor("RESOURCE_NODE_GATHERING")).toEqual(["travel", "gather", "wait", "repeat"]);
  });
});

describe("how a plan reads", () => {
  type PlanEntry = AutoPlanDTO["perAssignment"][number];

  function planEntry(): PlanEntry {
    return {
      jobId: "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      priority: 1,
      enabled: true,
      skillId: "farm.carrot",
      skillFamily: "REPLANT_CROP",
      action: null,
      waitReason: "WAITING_FOR_SUPPLY",
      claimed: false
    };
  }

  function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
    return { ...planEntry(), ...overrides };
  }

  function plan(entries: readonly PlanEntry[]): AutoPlanDTO {
    return {
      actorId: "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      controlMode: "PLAYER_CONTROLLED",
      action: null,
      jobId: null,
      waitReason: "NOT_AUTO_CONTROLLED",
      perAssignment: [...entries]
    };
  }

  it("maps the resolver's own vocabulary to a tone and a token", () => {
    expect(autoStatusFor({ kind: "PLANT", cells: 4 }, null)).toEqual({ tone: "ready", token: "plant" });
    expect(autoStatusFor({ kind: "LOAD_INPUT", itemDefinitionId: "item_carrot_seed", quantity: 1 }, null)).toEqual({
      tone: "ready",
      token: "load"
    });
    expect(autoStatusFor(null, "WAITING_FOR_GROWTH")).toEqual({ tone: "waiting", token: "growth" });
    expect(autoStatusFor(null, "CARGO_FULL")).toEqual({ tone: "blocked", token: "cargoFull" });
    expect(autoStatusFor(null, "DISABLED")).toEqual({ tone: "off", token: "disabled" });
  });

  it("previews what Auto would do while the player is still driving", () => {
    // Nothing actionable: the highest-priority enabled assignment's own wait is the preview.
    expect(autoPreviewFor(plan([entry()]))).toEqual({
      status: { tone: "waiting", token: "supply" },
      action: null
    });
    // The waiting priority-1 entry does not hide the actionable priority-2 one.
    const second = entry({ action: { kind: "PLANT", cells: 2 } });
    expect(plan([entry(), second]).perAssignment).toHaveLength(2);
    expect(autoPreviewFor(plan([entry({ priority: 1 }), { ...second, priority: 2 }])).status).toEqual({
      tone: "ready",
      token: "plant"
    });
  });

  it("finds one assignment's own plan entry, and nothing when the plan does not describe it", () => {
    const described = plan([entry()]);
    expect(planForAssignment(described, described.perAssignment[0]?.jobId ?? "")?.skillId).toBe("farm.carrot");
    expect(planForAssignment(described, "job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(planForAssignment(null, "job_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
  });
});

describe("how a running step reads", () => {
  function step(overrides: Partial<AutoStepDTO> = {}): AutoStepDTO {
    return {
      controlMode: "AUTO_CONTROLLED",
      phase: "WAITING",
      step: null,
      waitReason: "WAITING_FOR_GROWTH",
      jobId: null,
      skillId: null,
      targetDefinitionId: null,
      targetDisplayNameKey: null,
      itemDefinitionId: null,
      quantity: null,
      cell: null,
      from: null,
      to: null,
      arrivesAt: null,
      retryAfterMs: 0,
      progress: null,
      cargo: { used: 0, capacity: 30 },
      ...overrides
    };
  }

  it("names the work that just happened, not the work that might happen next", () => {
    expect(autoRunStatusFor(step({ phase: "WORKED", step: "LOAD_INPUT", itemDefinitionId: "item_carrot_seed", quantity: 3 }))).toEqual({
      token: "load",
      itemDefinitionId: "item_carrot_seed",
      quantity: 3,
      progress: null
    });
    expect(autoRunStatusFor(step({ phase: "WORKED", step: "PLANT" })).token).toBe("plant");
    expect(autoRunStatusFor(step({ phase: "WORKED", step: "HARVEST", itemDefinitionId: "item_carrot", quantity: 2 })).token).toBe("harvest");
    expect(autoRunStatusFor(step({ phase: "WORKED", step: "UNLOAD" })).token).toBe("unload");
    expect(autoRunStatusFor(step({ phase: "RETRY" })).token).toBe("retry");
    expect(autoRunStatusFor(step({ phase: "STOPPED" })).token).toBe("stopped");
  });

  it("says where a walk is going, from the anchor the server named", () => {
    const warehouse = autoRunStatusFor(
      step({ phase: "TRAVELLING", to: { kind: "WAREHOUSE", x: null, y: null }, retryAfterMs: 4000 })
    );
    expect(warehouse.token).toBe("travelWarehouse");
    expect(autoRunStatusFor(step({ phase: "TRAVELLING", to: { kind: "MARKET", x: null, y: null } })).token).toBe("travelMarket");
    expect(autoRunStatusFor(step({ phase: "TRAVELLING", to: { kind: "CELL", x: 3, y: 4 } })).token).toBe("travelField");
  });

  it("turns the field counts into the progress the panel prints", () => {
    expect(autoFieldProgress({ planted: 4, empty: 6, mature: 0 })).toEqual({ planted: 4, total: 10 });
    expect(autoFieldProgress({ planted: 0, empty: 0, mature: 0 })).toBeNull();
    expect(autoFieldProgress(null)).toBeNull();
  });
});
