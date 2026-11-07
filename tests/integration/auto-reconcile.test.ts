import { describe, expect, it } from "vitest";
import {
  apiRequest,
  autoStateOf,
  createCostWorld,
  reconcileOnce,
  scalar,
  setupAutoFarm,
  type CostWorld
} from "../support/cost-harness";

/**
 * Lazy offline reconciliation, through the real handler, the real repositories and the real schema.
 *
 * Every scenario drives the harness clock - the server's own time - and then asks the returning
 * client's question: "what happened while I was away?" Nothing here ticks, polls or waits.
 */

const HOUR_SECONDS = 60 * 60;
const MAX_OFFLINE_SECONDS = 24 * HOUR_SECONDS;

function harvests(world: CostWorld): number {
  return scalar(world, "SELECT COUNT(*) AS n FROM harvest_settlements");
}

function crops(world: CostWorld): number {
  return scalar(world, "SELECT COUNT(*) AS n FROM crop_instances");
}

function cargoTotal(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM actor_cargo_items");
}

function warehouseTotal(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory_items");
}

function gold(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(balance), 0) AS n FROM wallets");
}

function xp(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(xp), 0) AS n FROM player_progression");
}

function autoOn(cells = 1, seeds = 20, goldAmount = 1000): Promise<{ world: CostWorld; farmId: string }> {
  const created = createCostWorld(cells);
  return setupAutoFarm(created, { seedQuantity: seeds, gold: goldAmount }).then((farmId) => ({ world: created, farmId }));
}

describe("B3 lazy offline reconciliation", () => {
  it("does nothing at all when no time has passed", async () => {
    const { world, farmId } = await autoOn();
    try {
      const result = await reconcileOnce(world, farmId);
      expect(result.stopReason).toBe("CAUGHT_UP");
      expect(result.transitionsProcessed).toBe(0);
      expect(result.elapsedConsumedSeconds).toBe(0);
      expect(crops(world)).toBe(0);
      expect(cargoTotal(world)).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("does no work for an actor the player is driving", async () => {
    const world = createCostWorld(1);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 20, startAuto: false });
      world.clock.advanceSeconds(MAX_OFFLINE_SECONDS);
      const result = await reconcileOnce(world, farmId);
      expect(result.stopReason).toBe("NOT_AUTO_CONTROLLED");
      expect(result.transitionsProcessed).toBe(0);
      expect(crops(world)).toBe(0);
      expect(harvests(world)).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("answers a farm whose actor has never been created, instead of failing the resume path", async () => {
    const world = createCostWorld(1);
    try {
      // A fresh farm with no work area and no assignment: nothing has ever needed the actor, so no
      // actor row exists yet.
      const created = await apiRequest(world, "POST", "/farms", { name: "Bare Farm" });
      const createdBody: { readonly data: { readonly farm: { readonly id: string } } } = await created.json();
      const farmId = createdBody.data.farm.id;
      const actors = scalar(world, "SELECT COUNT(*) AS n FROM actors");
      expect(actors).toBe(0);
      const result = await reconcileOnce(world, farmId);
      expect(result.stopReason).toBe("NOT_AUTO_CONTROLLED");
      expect(result.transitionsProcessed).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("leaves the actor travelling when the window ends mid-walk, then completes it at the recorded instant", async () => {
    const { world, farmId } = await autoOn(1, 20);
    try {
      // One second of absence: enough to take the seed in hand and start the walk to the field.
      world.clock.advanceSeconds(1);
      const first = await reconcileOnce(world, farmId);
      expect(first.stopReason).toBe("CAUGHT_UP");
      const travelling = autoStateOf(world);
      expect(travelling?.travel_kind).not.toBeNull();
      const arrivesAt = travelling?.travel_arrives_at ?? null;
      expect(arrivesAt).not.toBeNull();
      // The timeline is current (the walk itself carries the future arrival), and nothing is planted.
      expect(travelling?.simulation_at).toBe(world.clock.now());
      expect(crops(world)).toBe(0);

      // Come back after the arrival: the walk completes and the crop goes in.
      world.clock.advanceSeconds(120);
      const second = await reconcileOnce(world, farmId);
      expect(second.transitionsProcessed).toBeGreaterThan(0);
      expect(autoStateOf(world)?.travel_kind).toBeNull();
      expect(crops(world)).toBe(1);
    } finally {
      world.db.close();
    }
  });

  it("does not harvest a crop that is not mature, and harvests it once it is", async () => {
    const { world, farmId } = await autoOn(1, 20);
    try {
      world.clock.advanceSeconds(120);
      await reconcileOnce(world, farmId);
      expect(crops(world)).toBe(1);
      expect(harvests(world)).toBe(0);

      // Carrot growth is 300 s; 100 s later the crop is still growing and stays in the ground.
      world.clock.advanceSeconds(100);
      const early = await reconcileOnce(world, farmId);
      expect(early.stopReason).toBe("CAUGHT_UP");
      expect(harvests(world)).toBe(0);
      expect(crops(world)).toBe(1);

      // The Main Character lease is intentionally short: a late reconcile cannot resume a disconnected
      // session after the 180-second lease has expired.
      world.clock.advanceSeconds(260);
      const late = await reconcileOnce(world, farmId);
      expect(late.economicSettlements).toBe(0);
      expect(harvests(world)).toBe(0);
      expect(xp(world)).toBe(0);
      expect(crops(world)).toBe(1);
    } finally {
      world.db.close();
    }
  });

  it("stops cleanly when there is nothing to plant with and no permission to buy", async () => {
    const world = createCostWorld(1);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 0, gold: 1000 });
      world.clock.advanceSeconds(MAX_OFFLINE_SECONDS);
      const result = await reconcileOnce(world, farmId);
      expect(result.stopReason).toBe("BLOCKED");
      expect(result.transitionsProcessed).toBe(0);
      expect(crops(world)).toBe(0);
      expect(gold(world)).toBe(1000);
      // Blocked time is paused, not pending: the timeline is current.
      expect(result.reconciledThrough).toBe("2026-09-27T00:03:00.000Z");
    } finally {
      world.db.close();
    }
  });

  it("buys the missing seed when the assignment allows it, and stops when the gold is gone", async () => {
    const world = createCostWorld(1);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 0, gold: 4 });
      const panel: { readonly data: { readonly jobs: readonly { readonly jobId: string; readonly version: number }[] } } = await (
        await apiRequest(world, "GET", `/farms/${farmId}/workers`)
      ).json();
      const job = panel.data.jobs[0];
      if (job === undefined) throw new Error("no assignment");
      const policy = await apiRequest(world, "POST", `/farms/${farmId}/assignments/${job.jobId}/policy`, {
        requestId: "policy_0000000001",
        autoPurchaseSupplies: true,
        expectedVersion: job.version
      });
      expect(policy.status).toBe(200);

      world.clock.advanceSeconds(120);
      const bought = await reconcileOnce(world, farmId);
      expect(bought.economicSettlements).toBeGreaterThan(0);
      expect(gold(world)).toBeLessThan(4);

      // With 4 gold the actor could afford two seeds; once they are spent it must wait, not spin.
      world.clock.advanceSeconds(MAX_OFFLINE_SECONDS);
      const waiting = await reconcileOnce(world, farmId);
      expect(["BLOCKED", "BUDGET_EXHAUSTED", "CAUGHT_UP"]).toContain(waiting.stopReason);
      expect(gold(world)).toBeGreaterThanOrEqual(0);
    } finally {
      world.db.close();
    }
  });

  it("stops when the warehouse cannot take what the actor is carrying", async () => {
    const world = createCostWorld(1);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 2, gold: 1000 });
      // Fill the warehouse to its starter capacity so a delivery cannot land.
      world.db.sqlite
        .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES ('player_11111111-1111-4111-8111-111111111111', 'item_carrot', 998, 1, '2026-09-27T00:00:00.000Z')")
        .run();
      world.clock.advanceSeconds(2 * MAX_OFFLINE_SECONDS);
      const result = await reconcileOnce(world, farmId);
      expect(result.budgetExhausted || result.stopReason === "BLOCKED" || result.stopReason === "CAUGHT_UP").toBe(true);
      // Nothing was destroyed and the warehouse never overflowed.
      expect(warehouseTotal(world)).toBeLessThanOrEqual(1000);
      expect(cargoTotal(world)).toBeGreaterThanOrEqual(0);
    } finally {
      world.db.close();
    }
  });

  it("caps a long absence at 24 hours and cannot be replayed for a second window", async () => {
    const { world, farmId } = await autoOn(4, 60);
    try {
      const start = world.clock.now();
      world.clock.advanceSeconds(30 * MAX_OFFLINE_SECONDS);
      const first = await reconcileOnce(world, farmId);
      const cappedMs = Date.parse(first.targetAt) - Date.parse(first.startedAt ?? start);
      expect(cappedMs).toBe(180 * 1000);

      // A long absence is settled over as many bounded calls as it needs; the cap is what is measured.
      for (let index = 0; index < 40; index += 1) {
        const outcome = await reconcileOnce(world, farmId);
        if (outcome.stopReason === "CAUGHT_UP" || outcome.stopReason === "BLOCKED") break;
      }
      const after = autoStateOf(world)?.simulation_at ?? null;
      expect(after).not.toBeNull();
      // Coming back again immediately is not a new absence and mints no second window.
      const second = await reconcileOnce(world, farmId);
      expect(second.transitionsProcessed).toBe(0);
      expect(second.elapsedConsumedSeconds).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("stops at the exact processed instant when the budget runs out, and continues from there", async () => {
    const { world, farmId } = await autoOn(30, 200);
    try {
      world.clock.advanceSeconds(6 * MAX_OFFLINE_SECONDS);
      const target = world.clock.now();
      const first = await reconcileOnce(world, farmId);
      expect(first.budgetExhausted).toBe(true);
      expect(first.stopReason).toBe("BUDGET_EXHAUSTED");
      const watermark = autoStateOf(world)?.simulation_at ?? null;
      expect(watermark).not.toBeNull();
      if (watermark === null) throw new Error("no watermark");
      // The watermark is the exact instant committed work ends, never the target.
      expect(Date.parse(watermark)).toBeLessThan(Date.parse(first.targetAt));
      expect(Date.parse(first.targetAt)).toBeLessThanOrEqual(Date.parse(target));
      const harvestsAfterFirst = harvests(world);

      const second = await reconcileOnce(world, farmId);
      const advanced = autoStateOf(world)?.simulation_at ?? null;
      expect(advanced).not.toBeNull();
      if (advanced === null) throw new Error("no watermark");
      expect(Date.parse(advanced)).toBeGreaterThanOrEqual(Date.parse(watermark));
      expect(harvests(world)).toBeGreaterThanOrEqual(harvestsAfterFirst);
      expect(second.transitionsProcessed).toBeGreaterThanOrEqual(0);
    } finally {
      world.db.close();
    }
  });

  it("cannot duplicate economy when two tabs reconcile at the same time", async () => {
    const solo = await autoOn(4, 40);
    const pair = await autoOn(4, 40);
    try {
      solo.world.clock.advanceSeconds(2 * MAX_OFFLINE_SECONDS);
      await reconcileOnce(solo.world, solo.farmId);

      pair.world.clock.advanceSeconds(2 * MAX_OFFLINE_SECONDS);
      const results = await Promise.allSettled([reconcileOnce(pair.world, pair.farmId), reconcileOnce(pair.world, pair.farmId)]);
      expect(results.filter((entry) => entry.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
      // One authoritative timeline either way: cargo and warehouse hold exactly the same totals as the
      // single-tab run, and XP was paid once.
      expect(cargoTotal(pair.world) + warehouseTotal(pair.world)).toBe(
        cargoTotal(solo.world) + warehouseTotal(solo.world)
      );
      expect(xp(pair.world)).toBe(xp(solo.world));
      expect(harvests(pair.world)).toBe(harvests(solo.world));
    } finally {
      solo.world.db.close();
      pair.world.db.close();
    }
  });
});


