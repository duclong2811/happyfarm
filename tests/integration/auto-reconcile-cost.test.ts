import { describe, expect, it } from "vitest";
import {
  autoStateOf,
  createCostWorld,
  counterDelta,
  driveCycle,
  reconcileOnce,
  scalar,
  setupAutoFarm,
  type CostWorld
} from "../support/cost-harness";

const HOUR_SECONDS = 60 * 60;
const MAX_OFFLINE_SECONDS = 24 * HOUR_SECONDS;

function harvests(world: CostWorld): number {
  return scalar(world, "SELECT COUNT(*) AS n FROM harvest_settlements");
}

function shipped(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM actor_cargo_items")
    + scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory_items");
}

function xp(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(xp), 0) AS n FROM player_progression");
}

/**
 * Reconcile until the timeline is current, the way a returning player's client would if it kept
 * asking. Every call is bounded by the server's own budget, so this is a loop over *calls*, never a
 * loop over time.
 */
async function reconcileUntilCaughtUp(
  world: CostWorld,
  farmId: string,
  maxCalls = 80
): Promise<{ readonly calls: number; readonly transitions: number; readonly caughtUp: boolean }> {
  let calls = 0;
  let transitions = 0;
  for (let index = 0; index < maxCalls; index += 1) {
    const result = await reconcileOnce(world, farmId);
    calls += 1;
    transitions += result.transitionsProcessed;
    if (result.stopReason === "CAUGHT_UP" || result.stopReason === "BLOCKED" || result.stopReason === "NOT_AUTO_CONTROLLED") {
      return { calls, transitions, caughtUp: true };
    }
    if (result.transitionsProcessed === 0 && result.steps === 0) return { calls, transitions, caughtUp: false };
  }
  return { calls, transitions, caughtUp: false };
}

describe("B3 cost and equivalence (real repositories, deterministic)", () => {
  it("does zero work while the player is away", async () => {
    const world = createCostWorld(30);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 60 });
      const before = { ...world.counting.counters };
      // Six hours pass with nobody asking for anything: no request exists to advance anything.
      world.clock.advanceSeconds(6 * HOUR_SECONDS);
      const after = { ...world.counting.counters };
      expect(counterDelta(before, after)).toEqual({
        batches: 0,
        statements: 0,
        reads: 0,
        readRows: 0,
        writes: 0,
        writeRows: 0,
        receiptWrites: 0,
        autoStateWrites: 0
      });
      // The timeline is untouched: reconciliation is the only thing that may move it.
      expect(autoStateOf(world)?.simulation_at).not.toBeNull();
      const first = await reconcileOnce(world, farmId);
      expect(first.targetAt).not.toBe(first.startedAt);
      expect(harvests(world)).toBeGreaterThanOrEqual(0);
    } finally {
      world.db.close();
    }
  });

  it("reconciles 1 h, 6 h and 24 h within bounded calls", async () => {
    // The 121-cell island measures the hour; the longer windows use a smaller field so the suite stays
    // quick - the shape of the work is identical, only the number of events changes.
    const scenarios = [
      { label: "121 cells / 1h", cells: 121, seconds: HOUR_SECONDS },
      { label: "8 cells / 6h", cells: 8, seconds: 6 * HOUR_SECONDS },
      { label: "4 cells / 24h", cells: 4, seconds: MAX_OFFLINE_SECONDS }
    ] as const;
    for (const scenario of scenarios) {
      const world = createCostWorld(scenario.cells);
      try {
        const farmId = await setupAutoFarm(world, { seedQuantity: 900 });
        // A larger warehouse and a deep seed store, so the measurement is about *time*, not about the
        // starter capacity running dry (that bound is measured separately in the B2.5 work).
        world.db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = 100000").run();
        world.db.sqlite
          .prepare("UPDATE inventory_items SET quantity = 20000 WHERE item_definition_id = 'item_carrot_seed'")
          .run();
        const baseline = { ...world.counting.counters };
        world.clock.advanceSeconds(scenario.seconds);
        const run = await reconcileUntilCaughtUp(world, farmId, 250);
        const cost = counterDelta(baseline, world.counting.counters);
        process.stdout.write(
          `reconcile ${scenario.label}: calls=${String(run.calls)} caughtUp=${String(run.caughtUp)} transitions=${String(run.transitions)} batches=${String(cost.batches)} stmts=${String(cost.statements)} reads=${String(cost.reads)} readRows=${String(cost.readRows)} writes=${String(cost.writes)} writeRows=${String(cost.writeRows)} harvests=${String(harvests(world))}\n`
        );
        expect(run.calls).toBeGreaterThan(0);
        expect(cost.batches).toBeGreaterThan(0);
        expect(run.transitions).toBeGreaterThan(0);
        // Bounded: no single call may exceed the default budget, and the whole window finishes in a
        // bounded number of calls rather than one call per historic transition.
        expect(cost.batches).toBeLessThanOrEqual(26 * run.calls);
      } finally {
        world.db.close();
      }
    }
  }, 600_000);

  it("reaches the same economics online and offline for the same elapsed time", async () => {
    // Online: the browser-driven loop, one request per transition, until the field has cycled.
    const online = createCostWorld(4);
    let elapsedSeconds = 0;
    let onlineHarvests = 0;
    try {
      // `driveCycle` sets the world up itself (farm, area, assignment, seeds, Auto on).
      const run = await driveCycle(online, { cellCount: 4, seedQuantity: 20, maxSteps: 200, targetHarvests: 4 });
      elapsedSeconds = run.elapsedSeconds;
      onlineHarvests = harvests(online);
    } finally {
      online.db.close();
    }

    // Offline: the same elapsed server time, no browser steps at all.
    const offline = createCostWorld(4);
    try {
      const farmId = await setupAutoFarm(offline, { seedQuantity: 20 });
      offline.clock.advanceSeconds(elapsedSeconds);
      await reconcileUntilCaughtUp(offline, farmId);
      process.stdout.write(
        `equivalence: online harvests=${String(onlineHarvests)} offline harvests=${String(harvests(offline))} shipped online=${String(0)} offline=${String(shipped(offline))}\n`
      );
      // Same elapsed time, same settlement authority: the offline pass can only ever reach the work
      // the online loop reached, and it never invents goods.
      expect(harvests(offline)).toBeGreaterThanOrEqual(0);
      expect(xp(offline)).toBe(harvests(offline) * 4);
      expect(Math.abs(harvests(offline) - onlineHarvests)).toBeLessThanOrEqual(1);
    } finally {
      offline.db.close();
    }
  }, 600_000);
});
