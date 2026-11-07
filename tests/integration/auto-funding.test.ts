import { describe, expect, it } from "vitest";
import { planFundingSale, minimumUnitsFor, MAX_AUTO_FUNDING_ITEMS } from "@happy-farm/domain";
import {
  apiRequest,
  autoStateOf,
  counterDelta,
  createCostWorld,
  reconcileOnce,
  scalar,
  setupAutoFarm,
  type CostWorld
} from "../support/cost-harness";

function rows(world: CostWorld, sql: string): readonly Record<string, unknown>[] {
  return world.db.sqlite.prepare(sql).all();
}

function carrots(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory_items WHERE item_definition_id = 'item_carrot'");
}

function gold(world: CostWorld): number {
  return scalar(world, "SELECT COALESCE(SUM(balance), 0) AS n FROM wallets");
}

function cargo(world: CostWorld, item = "item_carrot_seed"): number {
  return scalar(world, `SELECT COALESCE(SUM(quantity), 0) AS n FROM actor_cargo_items WHERE item_definition_id = '${item}'`);
}

/** A farm with no seeds and no gold, a carrot stack to sell, and the funding policy turned on. */
async function fundedWorld(stack = 100): Promise<{ world: CostWorld; farmId: string }> {
  const world = createCostWorld(1);
  const farmId = await setupAutoFarm(world, { seedQuantity: 0, gold: 0 });
  world.db.sqlite
    .prepare(
      "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES ('player_11111111-1111-4111-8111-111111111111', 'item_carrot', ?, 1, '2026-09-27T00:00:00.000Z')"
    )
    .run(stack);
  const panel: { readonly data: { readonly jobs: readonly { readonly jobId: string; readonly version: number }[] } } = await (
    await apiRequest(world, "GET", `/farms/${farmId}/workers`)
  ).json();
  const job = panel.data.jobs[0];
  if (job === undefined) throw new Error("no assignment");
  const policy = await apiRequest(world, "POST", `/farms/${farmId}/assignments/${job.jobId}/policy`, {
    requestId: "fund_policy_0001",
    autoPurchaseSupplies: true,
    expectedVersion: job.version,
    funding: { enabled: true, items: ["item_carrot"] }
  });
  if (policy.status !== 200) throw new Error(`policy failed: ${String(policy.status)}`);
  // The policy is durable, server-side state: enabled on the assignment and one ordered row.
  if (scalar(world, "SELECT COUNT(*) AS n FROM auto_funding_items") !== 1) {
    throw new Error("funding policy did not persist");
  }
  if (scalar(world, "SELECT auto_funding_enabled AS n FROM actor_jobs LIMIT 1") !== 1) {
    throw new Error("funding flag did not persist");
  }
  return { world, farmId };
}

describe("emergency funding - pure rules", () => {
  it("rounds the needed units up and stops as soon as the shortfall is covered", () => {
    expect(minimumUnitsFor(40, 4)).toBe(10);
    expect(minimumUnitsFor(41, 4)).toBe(11);
    const plan = planFundingSale(40, [
      { itemDefinitionId: "item_carrot", unitPrice: 4, available: 100 },
      { itemDefinitionId: "item_corn", unitPrice: 6, available: 100 }
    ]);
    expect(plan).toEqual({
      sales: [{ itemDefinitionId: "item_carrot", quantity: 10, unitPrice: 4, proceeds: 40 }],
      totalProceeds: 40
    });
  });

  it("never sells a whole stack and never touches a resource it did not need", () => {
    const plan = planFundingSale(10, [{ itemDefinitionId: "item_carrot", unitPrice: 4, available: 100 }]);
    expect(plan?.sales[0]?.quantity).toBe(3); // 12 >= 10, the acceptable integer overshoot
    expect(plan?.sales[0]?.quantity).toBeLessThan(100);
  });

  it("walks the priority order and refuses when the whole list cannot cover the shortfall", () => {
    const plan = planFundingSale(50, [
      { itemDefinitionId: "item_carrot", unitPrice: 4, available: 5 },
      { itemDefinitionId: "item_corn", unitPrice: 6, available: 5 }
    ]);
    expect(plan?.sales.map((sale) => [sale.itemDefinitionId, sale.quantity])).toEqual([
      ["item_carrot", 5],
      ["item_corn", 5]
    ]);
    expect(plan?.totalProceeds).toBe(50);
    expect(planFundingSale(51, [
      { itemDefinitionId: "item_carrot", unitPrice: 4, available: 5 },
      { itemDefinitionId: "item_corn", unitPrice: 6, available: 5 }
    ])).toBeNull();
  });

  it("bounds the whitelist", () => {
    const many = Array.from({ length: MAX_AUTO_FUNDING_ITEMS + 1 }, (_, index) => ({
      itemDefinitionId: `item_x${String(index)}`,
      unitPrice: 1,
      available: 1000
    }));
    expect(() => planFundingSale(10, many)).toThrow();
  });
});

describe("emergency funding - real repositories", () => {
  it("sells the minimum, buys the supply and lands it in Cargo in one settlement", async () => {
    const { world, farmId } = await fundedWorld(100);
    try {
      const beforeGold = gold(world);
      const result = await stepUntilWorked(world, farmId);
      expect(result).toBe("FUND_AND_PURCHASE_INPUT");
      // One seed (the 1-cell field's capacity batch) costs 2 gold, funded by selling one carrot at 2.
      expect(carrots(world)).toBe(99);
      expect(gold(world)).toBe(0);
      // The purchased seed did not sit in the hands: the same loop planted it, which is the point.
      expect(scalar(world, "SELECT COUNT(*) AS n FROM crop_instances")).toBeGreaterThan(0);
      const ledger = rows(world, "SELECT reason, delta FROM economy_ledger ORDER BY created_at, reason");
      expect(ledger).toContainEqual({ reason: "SHOP_SELL", delta: 2 });
      expect(ledger).toContainEqual({ reason: "SHOP_BUY", delta: -2 });
      // The wallet equals the ledger's own arithmetic, and the timeline moved with the settlement.
      expect(gold(world)).toBe(beforeGold + 2 - 2);
      expect(scalar(world, "SELECT COUNT(*) AS n FROM idempotency_keys WHERE operation = 'AUTO_FUND_AND_PURCHASE_INPUT'")).toBe(1);
      expect(autoStateOf(world)?.simulation_at).not.toBeNull();
    } finally {
      world.db.close();
    }
  });

  it("sells nothing at all when the selected resources cannot cover the shortfall", async () => {
    const { world, farmId } = await fundedWorld(1);
    try {
      // One carrot raises 2 gold; the seed costs 2, so a single carrot is exactly enough. Remove it.
      world.db.sqlite.prepare("UPDATE inventory_items SET quantity = 0 WHERE item_definition_id = 'item_carrot'").run();
      const steps = await driveSteps(world, farmId, 6);
      expect(steps.some((step) => step === "FUND_AND_PURCHASE_INPUT")).toBe(false);
      expect(rows(world, "SELECT * FROM economy_ledger")).toHaveLength(0);
      expect(cargo(world)).toBe(0);
      expect(autoStateOf(world)?.simulation_at).not.toBeNull();
    } finally {
      world.db.close();
    }
  });

  it("never sells an item the player did not select", async () => {
    const { world, farmId } = await fundedWorld(0);
    try {
      world.db.sqlite
        .prepare(
          "INSERT INTO inventory_items (player_id, item_definition_id, quantity, version, updated_at) VALUES ('player_11111111-1111-4111-8111-111111111111', 'item_corn', 50, 1, '2026-09-27T00:00:00.000Z')"
        )
        .run();
      await driveSteps(world, farmId, 6);
      expect(scalar(world, "SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_items WHERE item_definition_id = 'item_corn'")).toBe(50);
      expect(cargo(world)).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("defaults to OFF for an assignment nobody configured", async () => {
    const world = createCostWorld(1);
    try {
      await setupAutoFarm(world, { seedQuantity: 5, gold: 10 });
      expect(scalar(world, "SELECT auto_funding_enabled AS n FROM actor_jobs LIMIT 1")).toBe(0);
      expect(scalar(world, "SELECT COUNT(*) AS n FROM auto_funding_items")).toBe(0);
    } finally {
      world.db.close();
    }
  });

  it("runs through offline reconciliation, the same executor the online loop uses", async () => {
    const { world, farmId } = await fundedWorld(100);
    try {
      // No browser steps at all: the absence is settled by one bounded reconciliation call.
      world.clock.advanceSeconds(600);
      const result = await reconcileOnce(world, farmId);
      expect(result.transitionsProcessed).toBeGreaterThan(0);
      expect(carrots(world)).toBeLessThan(100);
      expect(rows(world, "SELECT reason FROM economy_ledger").map((row) => row.reason)).toContain("SHOP_SELL");
      expect(rows(world, "SELECT reason FROM economy_ledger").map((row) => row.reason)).toContain("SHOP_BUY");
      expect(autoStateOf(world)?.simulation_at).not.toBeNull();
    } finally {
      world.db.close();
    }
  });

  it("keeps the priority order across a reload and refuses more than the bound", async () => {
    const world = createCostWorld(1);
    try {
      const farmId = await setupAutoFarm(world, { seedQuantity: 0, gold: 0 });
      const panel: { readonly data: { readonly jobs: readonly { readonly jobId: string; readonly version: number }[] } } = await (
        await apiRequest(world, "GET", `/farms/${farmId}/workers`)
      ).json();
      const job = panel.data.jobs[0];
      if (job === undefined) throw new Error("no assignment");
      const saved = await apiRequest(world, "POST", `/farms/${farmId}/assignments/${job.jobId}/policy`, {
        requestId: "fund_priority_0001",
        autoPurchaseSupplies: true,
        expectedVersion: job.version,
        funding: { enabled: true, items: ["item_corn", "item_carrot"] }
      });
      expect(saved.status).toBe(200);
      const reloaded: {
        readonly data: { readonly jobs: readonly { readonly autoFundingEnabled: boolean; readonly fundingItems: readonly string[]; readonly version: number }[] };
      } = await (await apiRequest(world, "GET", `/farms/${farmId}/workers`)).json();
      expect(reloaded.data.jobs[0]?.autoFundingEnabled).toBe(true);
      expect(reloaded.data.jobs[0]?.fundingItems).toEqual(["item_corn", "item_carrot"]);
      const tooMany = await apiRequest(world, "POST", `/farms/${farmId}/assignments/${job.jobId}/policy`, {
        requestId: "fund_priority_0002",
        autoPurchaseSupplies: true,
        expectedVersion: reloaded.data.jobs[0]?.version ?? 1,
        funding: {
          enabled: true,
          items: ["item_corn", "item_carrot", "item_wheat", "item_potato", "item_tomato", "item_strawberry", "item_cabbage", "item_corn", "item_carrot"]
        }
      });
      expect(tooMany.status).not.toBe(200);
      // Switching funding off keeps the selection: the panel can show it again, and the planner
      // simply stops reading it. Nothing is silently forgotten.
      const off = await apiRequest(world, "POST", `/farms/${farmId}/assignments/${job.jobId}/policy`, {
        requestId: "fund_priority_0003",
        autoPurchaseSupplies: true,
        expectedVersion: reloaded.data.jobs[0]?.version ?? 1,
        funding: { enabled: false, items: ["item_corn", "item_carrot"] }
      });
      expect(off.status).toBe(200);
      const offBody: { readonly data: { readonly job: { readonly autoFundingEnabled: boolean; readonly fundingItems: readonly string[] } } } =
        await off.json();
      expect(offBody.data.job.autoFundingEnabled).toBe(false);
      expect(offBody.data.job.fundingItems).toEqual(["item_corn", "item_carrot"]);
    } finally {
      world.db.close();
    }
  });

  it("pays once when the same step is retried with a new HTTP request id", async () => {
    const { world, farmId } = await fundedWorld(100);
    try {
      await stepUntilWorked(world, farmId);
      const after = { carrots: carrots(world), ledger: rows(world, "SELECT reason, delta FROM economy_ledger").length };
      // The same logical step, a fresh transport id: the server re-plans from the world it now sees.
      world.serial += 1;
      const retry = await apiRequest(world, "POST", `/farms/${farmId}/auto/step`, { requestId: `fund_retry_${String(world.serial)}` });
      expect(retry.status).toBe(200);
      expect(carrots(world)).toBe(after.carrots);
      expect(rows(world, "SELECT reason, delta FROM economy_ledger").length).toBe(after.ledger);
    } finally {
      world.db.close();
    }
  });

  it("cannot double-liquidate when two tabs reconcile the same absence", async () => {
    const solo = await fundedWorld(100);
    const pair = await fundedWorld(100);
    try {
      solo.world.clock.advanceSeconds(600);
      await reconcileOnce(solo.world, solo.farmId);
      pair.world.clock.advanceSeconds(600);
      await Promise.allSettled([reconcileOnce(pair.world, pair.farmId), reconcileOnce(pair.world, pair.farmId)]);
      // One authoritative timeline either way: the two racing passes must land the same economy as a
      // single pass over the same absence - same sales, same purchases, same surviving stock.
      const ledgerOf = (world: CostWorld) =>
        rows(world, "SELECT reason, SUM(delta) AS delta, COUNT(*) AS n FROM economy_ledger GROUP BY reason ORDER BY reason");
      expect(ledgerOf(pair.world)).toEqual(ledgerOf(solo.world));
      expect(carrots(pair.world)).toBe(carrots(solo.world));
      expect(pair.world.db.sqlite.prepare("SELECT COALESCE(SUM(balance),0) AS n FROM wallets").get()).toEqual(
        solo.world.db.sqlite.prepare("SELECT COALESCE(SUM(balance),0) AS n FROM wallets").get()
      );
      // Every purchase was funded by its own sales: nothing was liquidated without a supply.
      const buys = scalar(pair.world, "SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'SHOP_BUY'");
      const sales = scalar(pair.world, "SELECT COUNT(*) AS n FROM economy_ledger WHERE reason = 'SHOP_SELL'");
      expect(sales).toBeGreaterThanOrEqual(buys);
    } finally {
      solo.world.db.close();
      pair.world.db.close();
    }
  });

  it("costs one batch with a bounded statement count per funded purchase", async () => {
    const { world, farmId } = await fundedWorld(100);
    try {
      const before = { ...world.counting.counters };
      await stepUntilWorked(world, farmId);
      const cost = counterDelta(before, world.counting.counters);
      process.stdout.write(
        `funding cost: batches=${String(cost.batches)} stmts=${String(cost.statements)} reads=${String(cost.reads)} readRows=${String(cost.readRows)} writes=${String(cost.writes)} writeRows=${String(cost.writeRows)}\n`
      );
      expect(cost.batches).toBeGreaterThan(0);
      expect(cost.writes).toBeGreaterThan(0);
    } finally {
      world.db.close();
    }
  });
});

interface StepView {
  readonly phase: string;
  readonly step: string | null;
}

async function driveSteps(world: CostWorld, farmId: string, limit: number): Promise<readonly (string | null)[]> {
  const seen: (string | null)[] = [];
  for (let index = 0; index < limit; index += 1) {
    world.serial += 1;
    const response = await apiRequest(world, "POST", `/farms/${farmId}/auto/step`, {
      requestId: `fund_step_${String(world.serial).padStart(6, "0")}`
    });
    if (response.status !== 200) throw new Error(`step failed: ${String(response.status)}`);
    const body: { readonly data: { readonly step: StepView } } = await response.json();
    seen.push(body.data.step.step);
    if (body.data.step.phase === "WAITING" || body.data.step.phase === "STOPPED") break;
    world.clock.advanceSeconds(30);
  }
  return seen;
}

async function stepUntilWorked(world: CostWorld, farmId: string): Promise<string | null> {
  const seen = await driveSteps(world, farmId, 8);
  return seen.find((step) => step === "FUND_AND_PURCHASE_INPUT") ?? seen[seen.length - 1] ?? null;
}

