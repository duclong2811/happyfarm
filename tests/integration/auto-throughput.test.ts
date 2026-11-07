import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCostWorld, driveCycle, type CycleResult } from "../support/cost-harness";

/**
 * Main Character farming throughput, measured through the production handler, repositories and
 * settlements.
 *
 * One simulated hour per scenario, so every cadence sees the same world time and the comparison is
 * about how much Auto fits into it. The only thing a "cadence" changes here is the client's
 * presentation window after a successful transition (`AUTO_GESTURE_MS` in the shipped client); there
 * is no authoritative Plant or Harvest work duration in this architecture to change.
 */

const FIELD_SIZES = [30, 60, 100, 121] as const;
const CADENCES = [500, 350, 250] as const;
const WINDOW_SECONDS = 3600;

interface Row {
  readonly cells: number;
  readonly cadenceMs: number;
  readonly plants: number;
  readonly harvests: number;
  readonly plantPerMin: number;
  readonly harvestPerMin: number;
  readonly transitions: number;
  readonly supplyTrips: number;
  readonly unloadTrips: number;
  readonly statementsPerHour: number;
  readonly readsPerHour: number;
  readonly rowsReadPerHour: number;
  readonly elapsed: number;
  readonly distribution: CycleResult["timeDistribution"];
}

describe("Main Character farming throughput", () => {
  it("measures one simulated hour per field size and cadence", async () => {
    const rows: Row[] = [];
    for (const cells of FIELD_SIZES) {
      for (const cadenceMs of CADENCES) {
        const world = createCostWorld(cells);
        try {
          const cycle = await driveCycle(world, {
            cellCount: cells,
            seedQuantity: cells * 4 + 200,
            maxSteps: 4000,
            gestureMs: cadenceMs,
            untilSeconds: WINDOW_SECONDS,
            warehouseCapacity: 200_000
          });
          rows.push(toRow(cells, cadenceMs, cycle));
        } finally {
          world.db.close();
        }
      }
    }

    process.stdout.write(
      "cells cadence plants harvests plant/min harvest/min transitions supply unload stmts/h reads/h rowsRead/h travelS growthS workS supplyS\n"
    );
    for (const row of rows) {
      process.stdout.write(
        [
          String(row.cells).padStart(5),
          String(row.cadenceMs).padStart(7),
          String(row.plants).padStart(6),
          String(row.harvests).padStart(8),
          row.plantPerMin.toFixed(1).padStart(9),
          row.harvestPerMin.toFixed(1).padStart(11),
          String(row.transitions).padStart(11),
          String(row.supplyTrips).padStart(6),
          String(row.unloadTrips).padStart(6),
          row.statementsPerHour.toFixed(0).padStart(8),
          row.readsPerHour.toFixed(0).padStart(8),
          row.rowsReadPerHour.toFixed(0).padStart(10),
          row.distribution.travel.toFixed(0).padStart(7),
          row.distribution.growth.toFixed(0).padStart(8),
          row.distribution.work.toFixed(0).padStart(6),
          row.distribution.supply.toFixed(0).padStart(7)
        ].join(" ") + "\n"
      );
    }

    // The window is a fair one: every row covers about an hour of world time.
    for (const row of rows) {
      expect(row.elapsed).toBeGreaterThanOrEqual(WINDOW_SECONDS - 60);
      expect(row.elapsed).toBeLessThan(WINDOW_SECONDS + 600);
    }
    // A faster presentation window can only ever add work inside the same world hour.
    for (const cells of FIELD_SIZES) {
      const at500 = rows.find((row) => row.cells === cells && row.cadenceMs === 500);
      const at350 = rows.find((row) => row.cells === cells && row.cadenceMs === 350);
      expect(at500).toBeDefined();
      expect(at350).toBeDefined();
      if (at500 === undefined || at350 === undefined) continue;
      expect(at350.transitions).toBeGreaterThanOrEqual(at500.transitions);
      // The authoritative waits dominate the hour at every size: growth on a small field, travel on a
      // large one. The work gesture is the minority, which is why D2.4 - not faster economic work -
      // is the real lever.
      const waits = at350.distribution.travel + at350.distribution.growth;
      expect(waits / at350.elapsed).toBeGreaterThan(0.5);
      // The extra work costs proportionally more D1, not multiplicatively more.
      const d1Ratio = at350.statementsPerHour / Math.max(1, at500.statementsPerHour);
      const workRatio = at350.transitions / Math.max(1, at500.transitions);
      expect(d1Ratio).toBeLessThanOrEqual(workRatio + 0.15);
    }
  }, 1_200_000);
});

describe("the shipped presentation cadence", () => {
  it("is the calibrated 350 ms window", () => {
    const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");
    expect(source).toContain("const AUTO_GESTURE_MS = 350;");
  });
});

function toRow(cells: number, cadenceMs: number, cycle: CycleResult): Row {
  const minutes = cycle.elapsedSeconds / 60;
  const hours = cycle.elapsedSeconds / 3600;
  const plantEvents = cycle.byStep["WORKED:PLANT"]?.batches ?? 0;
  const harvestEvents = cycle.byStep["WORKED:HARVEST"]?.batches ?? 0;
  return {
    cells,
    cadenceMs,
    plants: plantEvents,
    harvests: harvestEvents,
    plantPerMin: minutes === 0 ? 0 : plantEvents / minutes,
    harvestPerMin: minutes === 0 ? 0 : harvestEvents / minutes,
    transitions: cycle.settlements,
    supplyTrips: (cycle.byStep["WORKED:LOAD_INPUT"]?.batches ?? 0) + (cycle.byStep["WORKED:PURCHASE_INPUT"]?.batches ?? 0),
    unloadTrips: cycle.byStep["WORKED:UNLOAD"]?.batches ?? 0,
    statementsPerHour: hours === 0 ? 0 : cycle.counters.statements / hours,
    readsPerHour: hours === 0 ? 0 : cycle.counters.reads / hours,
    rowsReadPerHour: hours === 0 ? 0 : cycle.counters.readRows / hours,
    elapsed: cycle.elapsedSeconds,
    distribution: cycle.timeDistribution
  };
}
