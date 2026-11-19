import { describe, expect, it } from "vitest";
import { MAIN_CHARACTER_AUTO_LEASE_SECONDS } from "@happy-farm/application";
import { CARGO_CAPACITY_BY_ACTOR_KIND, STARTER_CARGO_CAPACITY } from "@happy-farm/game-data";
import { gameDataCargoCapacities } from "../../workers/api/src/runtime";
import {
  createCostWorld,
  driveCycle,
  reconcileOnce,
  scalar,
  setupAutoFarm,
  type CostWorld
} from "../support/cost-harness";

/**
 * D2.4.1 correctness: the capacity the benchmark injects must be the *same* capacity production
 * enforces, and the shipped default must still be 30.
 *
 * The benchmark's whole validity rests on this file: candidates are only meaningful if the injected
 * number reaches the actor row, the database's `cargo_full` guard, and the offline reconciler, while
 * normal play keeps the starter 30.
 */

function actorRow(world: CostWorld): { readonly id: string; readonly cargo_capacity: number } | undefined {
  return world.db.sqlite.prepare("SELECT id, cargo_capacity FROM actors WHERE kind = 'MAIN_CHARACTER'").get() as
    | { readonly id: string; readonly cargo_capacity: number }
    | undefined;
}

function harvests(world: CostWorld): number {
  return scalar(world, "SELECT COUNT(*) AS n FROM harvest_settlements");
}

/** What a window of Auto work leaves behind: the field, the seed store, the harvests and the cargo. */
function workDone(world: CostWorld): { readonly planted: number; readonly seeds: number; readonly harvests: number; readonly carried: number } {
  return {
    planted: scalar(world, "SELECT COUNT(*) AS n FROM crop_instances"),
    seeds: scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory_items WHERE item_definition_id = 'item_carrot_seed'"),
    harvests: harvests(world),
    carried: scalar(world, "SELECT COALESCE(SUM(quantity), 0) AS n FROM actor_cargo_items")
  };
}

async function reconcileUntilCaughtUp(world: CostWorld, farmId: string, maxCalls = 80): Promise<void> {
  for (let index = 0; index < maxCalls; index += 1) {
    const result = await reconcileOnce(world, farmId);
    if (result.stopReason === "CAUGHT_UP" || result.stopReason === "BLOCKED" || result.stopReason === "NOT_AUTO_CONTROLLED") return;
    if (result.transitionsProcessed === 0 && result.steps === 0) return;
  }
}

describe("D2.4.1 cargo capacity correctness", () => {
  it("keeps the shipped Main Character capacity at exactly 30", async () => {
    // Content, port wiring and the actor a fresh save actually creates all agree on 30.
    expect(STARTER_CARGO_CAPACITY).toBe(30);
    expect(CARGO_CAPACITY_BY_ACTOR_KIND.MAIN_CHARACTER).toBe(30);
    expect(gameDataCargoCapacities.forActorKind("MAIN_CHARACTER")).toBe(30);

    const world = createCostWorld(30);
    try {
      await setupAutoFarm(world, { seedQuantity: 60 });
      const actor = actorRow(world);
      expect(actor?.cargo_capacity).toBe(30);
      expect(world.cargoCapacity).toBe(30);
    } finally {
      world.db.close();
    }
  });

  it("lands an injected capacity on the actor row and lets the actor really carry more than 30", async () => {
    const world = createCostWorld(60, { cargoCapacity: 60 });
    try {
      await setupAutoFarm(world, { seedQuantity: 400, warehouseCapacity: 200_000 });
      const actor = actorRow(world);
      expect(actor?.cargo_capacity).toBe(60);

      // The guard follows the row: a 61st unit is refused inside the database transaction.
      world.db.sqlite.prepare("DELETE FROM actor_cargo_items WHERE actor_id = ?").run(actor?.id ?? "");
      world.db.sqlite
        .prepare(
          "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot', 60, 1, ?)"
        )
        .run(actor?.id ?? "", "2026-01-01T00:00:00.000Z");
      expect(() => {
        world.db.sqlite
          .prepare(
            "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, 'item_carrot_seed', 1, 1, ?)"
          )
          .run(actor?.id ?? "", "2026-01-01T00:00:00.000Z");
      }).toThrow(/cargo_full/u);
      world.db.sqlite.prepare("DELETE FROM actor_cargo_items WHERE actor_id = ?").run(actor?.id ?? "");
    } finally {
      world.db.close();
    }

    // And the carried amount genuinely exceeds the starter 30 when the row says 60.
    const runWorld = createCostWorld(60, { cargoCapacity: 60 });
    try {
      const cycle = await driveCycle(runWorld, {
        cellCount: 60,
        seedQuantity: 760,
        maxSteps: 3000,
        gestureMs: 350,
        untilSeconds: 1800,
        warehouseCapacity: 200_000
      });
      expect(cycle.cargoMetrics.peakUsed).toBeGreaterThan(30);
      expect(cycle.cargoMetrics.peakUsed).toBeLessThanOrEqual(60);
    } finally {
      runWorld.db.close();
    }
  }, 600_000);

  it("keeps online Auto and B3 offline reconciliation equivalent at the same configured capacity", async () => {
    // Offline work is bounded by the Main Character lease (180 seconds after the last online renewal;
    // docs/design/AUTOMATION_LOGISTICS.md section 19), so the comparison is one lease of world time.
    const capacity = 60;
    let onlineState: ReturnType<typeof workDone> | null = null;
    const online = createCostWorld(8, { cargoCapacity: capacity });
    try {
      await driveCycle(online, {
        cellCount: 8,
        seedQuantity: 60,
        maxSteps: 400,
        untilSeconds: MAIN_CHARACTER_AUTO_LEASE_SECONDS,
        gestureMs: 350
      });
      onlineState = workDone(online);
    } finally {
      online.db.close();
    }

    const offline = createCostWorld(8, { cargoCapacity: capacity });
    try {
      const farmId = await setupAutoFarm(offline, { seedQuantity: 60 });
      expect(actorRow(offline)?.cargo_capacity).toBe(capacity);
      // An absence far longer than the lease: the pass still stops at the lease.
      offline.clock.advanceSeconds(60 * 60);
      await reconcileUntilCaughtUp(offline, farmId);
      const offlineState = workDone(offline);
      process.stdout.write(
        `capacity ${String(capacity)} equivalence (lease window): online ${JSON.stringify(onlineState)} offline ${JSON.stringify(offlineState)}\n`
      );
      // Same window and same configured capacity: the offline pass reaches the same work, and never
      // invents goods the online loop could not have made.
      expect(actorRow(offline)?.cargo_capacity).toBe(capacity);
      expect(offlineState.planted).toBeGreaterThan(0);
      expect(onlineState).not.toBeNull();
      expect(offlineState).toEqual(onlineState);
    } finally {
      offline.db.close();
    }
  }, 600_000);
});

