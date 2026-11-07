import type { AquaculturePondDTO } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { createAquaculturePondLoader, selectedAquaculturePond, type AquacultureLoadState } from "../../apps/web/src/aquaculture/load";

function pond(id: string): AquaculturePondDTO {
  return {
    pondId: id,
    farmId: "farm_test",
    itemDefinitionId: null,
    status: "EMPTY",
    stockedAt: null,
    readyAt: null,
    capacity: 10,
    stockedCount: 0,
    growingCount: 0,
    readyCount: 0,
    availableCapacity: 10,
    cohorts: [],
    version: 1
  };
}

describe("aquaculture pond loading", () => {
  it("exposes loading, then loaded, and distinguishes a missing cage pond", async () => {
    let resolve: ((value: readonly AquaculturePondDTO[]) => void) | undefined;
    const states: AquacultureLoadState[] = [];
    const load = createAquaculturePondLoader(
      () => new Promise<readonly AquaculturePondDTO[]>((done) => { resolve = done; }),
      (state) => states.push(state)
    );
    const pending = load("farm_test");
    expect(states[states.length - 1]?.kind).toBe("LOADING");
    resolve?.([pond("cage_1")]);
    await pending;
    const loaded = states[states.length - 1];
    if (loaded === undefined) throw new Error("missing loaded state");
    expect(loaded.kind).toBe("LOADED");
    expect(selectedAquaculturePond(loaded, "farm_test", "cage_missing")).toEqual({ kind: "NOT_FOUND" });
  });

  it("turns a rejected request into an error state and allows a successful retry", async () => {
    let attempt = 0;
    const states: AquacultureLoadState[] = [];
    const load = createAquaculturePondLoader(
      () => {
        attempt += 1;
        if (attempt === 1) throw new Error("401 Unauthorized");
        return Promise.resolve([pond("cage_1")]);
      },
      (state) => states.push(state)
    );
    await load("farm_test");
    const failed = states[states.length - 1];
    if (failed === undefined) throw new Error("missing error state");
    expect(failed).toMatchObject({ kind: "ERROR", farmId: "farm_test" });
    expect(selectedAquaculturePond(failed, "farm_test", "cage_1")).toMatchObject({ kind: "ERROR" });
    await load("farm_test");
    const retried = states[states.length - 1];
    if (retried === undefined) throw new Error("missing retry state");
    expect(retried).toMatchObject({ kind: "LOADED", farmId: "farm_test" });
    expect(selectedAquaculturePond(retried, "farm_test", "cage_1")).toMatchObject({ kind: "FOUND" });
  });

  it("does not let a late response from an older farm overwrite the current load", async () => {
    const resolvers: Array<(value: readonly AquaculturePondDTO[]) => void> = [];
    const states: AquacultureLoadState[] = [];
    const load = createAquaculturePondLoader(
      () => new Promise<readonly AquaculturePondDTO[]>((resolve) => resolvers.push(resolve)),
      (state) => states.push(state)
    );
    const old = load("farm_old");
    const current = load("farm_current");
    resolvers[0]?.([pond("old_cage")]);
    await old;
    expect(states[states.length - 1]?.kind).toBe("LOADING");
    resolvers[1]?.([pond("current_cage")]);
    await current;
    expect(states[states.length - 1]).toMatchObject({ kind: "LOADED", farmId: "farm_current" });
  });

  it("keeps stockedAt and readyAt for every batch across a reload", async () => {
    const batches = [
      { cohortId: "early", itemDefinitionId: "item_fish_tilapia" as const, quantity: 5, stockedAt: "2026-10-15T00:00:00.000Z", readyAt: "2026-10-15T01:00:00.000Z" },
      { cohortId: "late", itemDefinitionId: "item_fish_tilapia" as const, quantity: 5, stockedAt: "2026-10-15T00:30:00.000Z", readyAt: "2026-10-15T01:30:00.000Z" }
    ];
    let state: AquacultureLoadState | undefined;
    const load = createAquaculturePondLoader(
      () => Promise.resolve([{ ...pond("cage_1"), status: "GROWING" as const, itemDefinitionId: "item_fish_tilapia" as const, stockedCount: 10, growingCount: 10, availableCapacity: 0, cohorts: batches }]),
      (next) => { state = next; }
    );
    await load("farm_test");
    expect(state).toMatchObject({ kind: "LOADED", ponds: [{ cohorts: batches }] });
  });
});
