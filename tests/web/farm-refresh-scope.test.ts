import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FULL_FARM_REFRESH,
  GROWTH_REFRESH,
  farmRefreshReadCount,
  farmRefreshScopeFor,
  type FarmAction,
  type FarmRefreshScope
} from "../../apps/web/src/farm-refresh";

/**
 * What the farm page re-reads, and when.
 *
 * The V16.2.1A audit found the staging database's rows-read was dominated by full-list reads of
 * `farm_tiles` and `farm_constructions` - 86% of the day - and that they came from re-reading every
 * list after every action, not from the growth timer. These tests pin the two halves of the fix:
 * the pure scope (which list each action and the timer may re-read) and the wiring in `main.ts`
 * (that the scope is the only thing that decides a list read).
 */

const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));

const FARM_ACTIONS: readonly FarmAction[] = [
  "PLANT_CROP",
  "HARVEST_CROP",
  "UPROOT_CROP",
  "PLANT_TREE",
  "HARVEST_TREE",
  "REMOVE_TREE"
];

/** The body of a top-level `async function name(...)` in main.ts, up to the next closing brace. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `main.ts declares ${signature}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function enabled(scope: FarmRefreshScope): readonly string[] {
  return (["tiles", "crops", "trees", "constructions"] as const).filter((key) => scope[key]);
}

describe("growth refresh scope", () => {
  it("reads crops and trees, and nothing else, on the 5-second timer", () => {
    expect(enabled(GROWTH_REFRESH)).toEqual(["crops", "trees"]);
  });

  it("can never read the tiles or the built objects - the two expensive lists", () => {
    expect(GROWTH_REFRESH.tiles).toBe(false);
    expect(GROWTH_REFRESH.constructions).toBe(false);
    expect(farmRefreshReadCount(GROWTH_REFRESH)).toBe(2);
  });
});

describe("per-action refresh scope", () => {
  it("never re-reads the built objects, because no farming action can change them", () => {
    // Building and editing update `state.constructions` from their own response, and they do not
    // call this refresh at all. So no farming action needs the construction list.
    for (const action of FARM_ACTIONS) {
      expect(farmRefreshScopeFor(action).constructions, action).toBe(false);
    }
  });

  it("re-reads the tiles only for the two actions that can add a tile row", () => {
    const planting = FARM_ACTIONS.filter((action) => farmRefreshScopeFor(action).tiles);
    expect(planting).toEqual(["PLANT_CROP", "PLANT_TREE"]);
  });

  it("keeps a crop action on the crop list and a tree action on the tree list", () => {
    expect(enabled(farmRefreshScopeFor("PLANT_CROP"))).toEqual(["tiles", "crops"]);
    expect(enabled(farmRefreshScopeFor("HARVEST_CROP"))).toEqual(["crops"]);
    expect(enabled(farmRefreshScopeFor("UPROOT_CROP"))).toEqual(["crops"]);
    expect(enabled(farmRefreshScopeFor("PLANT_TREE"))).toEqual(["tiles", "trees"]);
    expect(enabled(farmRefreshScopeFor("HARVEST_TREE"))).toEqual(["trees"]);
    expect(enabled(farmRefreshScopeFor("REMOVE_TREE"))).toEqual(["trees"]);
  });

  it("re-reads at most two lists per action, against four before the fix", () => {
    for (const action of FARM_ACTIONS) {
      expect(farmRefreshReadCount(farmRefreshScopeFor(action)), action).toBeLessThanOrEqual(2);
    }
  });

  it("still reads everything when a farm is opened or Refresh is pressed", () => {
    expect(enabled(FULL_FARM_REFRESH)).toEqual(["tiles", "crops", "trees", "constructions"]);
    expect(farmRefreshReadCount(FULL_FARM_REFRESH)).toBe(4);
  });
});

describe("the scope is the only thing that reads a farm list", () => {
  it("reads each list in exactly one place, inside the scoped refresh", () => {
    const source = readFileSync(MAIN, "utf8");
    const refresh = functionBody(source, "async function refreshFarm(");
    for (const getter of ["getTiles", "getCrops", "getTrees", "getFarmConstructions"]) {
      const calls = source.split(`client.${getter}(`).length - 1;
      expect(calls, `main.ts calls ${getter} exactly once`).toBe(1);
      expect(refresh, `${getter} is read inside refreshFarm`).toContain(`client.${getter}(`);
    }
  });

  it("sends the growth timer through the growth scope", () => {
    const source = readFileSync(MAIN, "utf8");
    const growth = functionBody(source, "async function refreshGrowth(");
    expect(growth).toContain("refreshFarm(GROWTH_REFRESH)");
    expect(growth).not.toContain("getTiles");
    expect(growth).not.toContain("getFarmConstructions");
  });

  it("passes a scope at each farming-action refresh site, including the two Auto shares", () => {
    const source = readFileSync(MAIN, "utf8");
    const scoped = source.split("refreshFarm(farmRefreshScopeFor(").length - 1;
    // The six manual actions, plus the two reads an Auto step performs after planting and harvesting:
    // an Auto plant changes exactly what a manual plant changes, so it re-reads exactly the same lists.
    expect(scoped).toBe(FARM_ACTIONS.length + 2);
    for (const action of FARM_ACTIONS) {
      expect(source).toContain(`farmRefreshScopeFor("${action}")`);
    }
    const auto = functionBody(source, "async function refreshAfterAutoStep(");
    expect(auto).toContain('refreshFarm(farmRefreshScopeFor("PLANT_CROP"))');
    expect(auto).toContain('refreshFarm(farmRefreshScopeFor("HARVEST_CROP"))');
  });
});
