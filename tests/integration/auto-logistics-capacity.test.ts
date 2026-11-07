import { describe, expect, it } from "vitest";
import { createCostWorld, driveCycle, type CycleResult } from "../support/cost-harness";

/**
 * D2.4.1 - the Main Character *carry capacity* benchmark.
 *
 * The question is economic: how much does a bigger pair of hands actually buy an Auto farm? So every
 * scenario runs the production handler, planner, settlements and the shipped schema behind the
 * counting database, one simulated hour of world time each, and the only variable is the capacity the
 * actor is created with.
 *
 * The capacity is injected through the production `CargoCapacityLookup` port (`createCostWorld`'s
 * `cargoCapacity` option), so the actor row and therefore the database's own `cargo_full` guard carry
 * the candidate. Nothing here changes `STARTER_CARGO_CAPACITY`; Cargo 30 is still the shipped default
 * and the regression that proves it lives beside this file.
 */

const FIELD_SIZES = [30, 60, 100, 121] as const;
const CAPACITIES = [30, 45, 60, 90, 120] as const;
const PROBE_FIELD = 150;
const PROBE_CAPACITIES = [30, 60, 120] as const;
const WINDOW_SECONDS = 3600;
const GESTURE_MS = 350;

interface Scenario {
  readonly cells: number;
  readonly capacity: number;
  readonly cycle: CycleResult;
}

function perHour(cycle: CycleResult, value: number): number {
  const hours = cycle.elapsedSeconds / 3600;
  return hours === 0 ? 0 : value / hours;
}

function worked(cycle: CycleResult, step: string): number {
  return cycle.byStep[`WORKED:${step}`]?.batches ?? 0;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

async function runScenario(cells: number, capacity: number): Promise<Scenario> {
  const world = createCostWorld(cells, { cargoCapacity: capacity });
  try {
    // A deep seed store and a raised shelf so *capacity and travel* are the variables under test, not
    // the starter 1000-unit warehouse running dry (that interaction is measured on its own below).
    const cycle = await driveCycle(world, {
      cellCount: cells,
      seedQuantity: cells * 12 + 1000,
      maxSteps: 8000,
      gestureMs: GESTURE_MS,
      untilSeconds: WINDOW_SECONDS,
      warehouseCapacity: 200_000
    });
    return { cells, capacity, cycle };
  } finally {
    world.db.close();
  }
}

describe("D2.4.1 logistics capacity benchmark", () => {
  it("measures 30/45/60/90/120 cargo across 30/60/100/121 cells for one simulated hour", async () => {
    const scenarios: Scenario[] = [];
    for (const cells of FIELD_SIZES) {
      for (const capacity of CAPACITIES) {
        scenarios.push(await runScenario(cells, capacity));
      }
    }

    process.stdout.write("\nD2.4.1 logistics capacity benchmark (one simulated hour, AUTO_GESTURE_MS=350)\n");
    process.stdout.write(
      "cells cargo  plants harvests plant/min harv/min  supply/h unload/h whVis/h mktVis/h travelS travel%  cargoAvg cargoPeak util% peakUtil units/supply units/unload unusedAtUnload supplyUnits unloadUnits stmts/h reads/h rowsRead/h\n"
    );
    for (const { cells, capacity, cycle } of scenarios) {
      const travelPct = cycle.elapsedSeconds === 0 ? 0 : (cycle.timeDistribution.travel / cycle.elapsedSeconds) * 100;
      process.stdout.write(
        [
          pad(cells, 5),
          pad(capacity, 5),
          pad(worked(cycle, "PLANT"), 7),
          pad(worked(cycle, "HARVEST"), 8),
          pad(fixed(perHour(cycle, worked(cycle, "PLANT")) / 60, 1), 9),
          pad(fixed(perHour(cycle, worked(cycle, "HARVEST")) / 60, 1), 8),
          pad(fixed(perHour(cycle, cycle.logistics.supplyTrips), 1), 9),
          pad(fixed(perHour(cycle, cycle.logistics.unloadTrips), 1), 8),
          pad(fixed(perHour(cycle, cycle.walksByDestination.warehouse), 1), 8),
          pad(fixed(perHour(cycle, cycle.walksByDestination.market), 1), 8),
          pad(fixed(cycle.timeDistribution.travel, 0), 7),
          pad(fixed(travelPct, 0) + "%", 7),
          pad(fixed(cycle.cargoMetrics.avgUsed, 1), 8),
          pad(fixed(cycle.cargoMetrics.peakUsed, 0), 9),
          pad(fixed(cycle.cargoMetrics.avgUtilization * 100, 0), 5),
          pad(fixed(cycle.cargoMetrics.peakUtilization * 100, 0), 8),
          pad(fixed(cycle.cargoMetrics.avgUnitsPerSupplyTrip, 1), 11),
          pad(fixed(cycle.cargoMetrics.avgUnitsPerUnloadTrip, 1), 13),
          pad(fixed(cycle.cargoMetrics.avgUnusedCapacityAtUnload, 1), 14),
          pad(fixed(cycle.logistics.supplyUnits, 0), 11),
          pad(fixed(cycle.logistics.unloadUnits, 0), 11),
          pad(fixed(perHour(cycle, cycle.counters.statements), 0), 7),
          pad(fixed(perHour(cycle, cycle.counters.reads), 0), 7),
          pad(fixed(perHour(cycle, cycle.counters.readRows), 0), 10)
        ].join(" ") + "\n"
      );
    }

    // The travel decomposition the capacity lever is supposed to attack.
    process.stdout.write("\nTravel decomposition (seconds of the simulated hour)\n");
    process.stdout.write("cells cargo  fieldS field% whS wh% mktS mkt% | CELL->WH WH->CELL CELL->MKT MKT->CELL\n");
    for (const { cells, capacity, cycle } of scenarios) {
      const total = Math.max(1, cycle.elapsedSeconds);
      const leg = (key: string): number => cycle.travelByLeg[key] ?? 0;
      process.stdout.write(
        [
          pad(cells, 5),
          pad(capacity, 5),
          pad(fixed(cycle.travelByDestination.cell, 0), 6),
          pad(fixed((cycle.travelByDestination.cell / total) * 100, 0) + "%", 5),
          pad(fixed(cycle.travelByDestination.warehouse, 0), 5),
          pad(fixed((cycle.travelByDestination.warehouse / total) * 100, 0) + "%", 4),
          pad(fixed(cycle.travelByDestination.market, 0), 4),
          pad(fixed((cycle.travelByDestination.market / total) * 100, 0) + "%", 5),
          pad(fixed(leg("CELL->WAREHOUSE"), 0), 9),
          pad(fixed(leg("WAREHOUSE->CELL"), 0), 8),
          pad(fixed(leg("CELL->MARKET"), 0), 9),
          pad(fixed(leg("MARKET->CELL"), 0), 8)
        ].join(" ") + "\n"
      );
    }

    // Everything is measured: the matrix exists, every run covered about an hour, and the peak cargo
    // never exceeded the capacity the actor row carried.
    expect(scenarios).toHaveLength(FIELD_SIZES.length * CAPACITIES.length);
    for (const { capacity, cycle } of scenarios) {
      expect(cycle.elapsedSeconds).toBeGreaterThanOrEqual(WINDOW_SECONDS - 120);
      expect(cycle.cargoMetrics.peakUsed).toBeLessThanOrEqual(capacity);
      expect(cycle.cargoMetrics.capacity).toBe(capacity);
      expect(cycle.settlements).toBeGreaterThan(0);
    }

    // Baseline validation: Cargo 30 must reproduce the D2.3.2 shape, or the comparison is invalid.
    const baseline: Readonly<Record<number, { readonly plantPerMin: number; readonly travelPct: number }>> = {
      30: { plantPerMin: 4.5, travelPct: 29 },
      60: { plantPerMin: 7.2, travelPct: 51 },
      100: { plantPerMin: 9.0, travelPct: 80 },
      121: { plantPerMin: 10.0, travelPct: 84 }
    };
    process.stdout.write("\nBaseline validation vs D2.3.2\n");
    for (const cells of FIELD_SIZES) {
      const row = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === 30);
      expect(row).toBeDefined();
      if (row === undefined) continue;
      const plantPerMin = perHour(row.cycle, worked(row.cycle, "PLANT")) / 60;
      const travelPct = (row.cycle.timeDistribution.travel / row.cycle.elapsedSeconds) * 100;
      const reference = baseline[cells];
      if (reference === undefined) continue;
      process.stdout.write(
        `${pad(cells, 4)} plant/min ${fixed(plantPerMin, 1)} (ref ${fixed(reference.plantPerMin, 1)})  travel ${fixed(travelPct, 0)}% (ref ${fixed(reference.travelPct, 0)}%)\n`
      );
      expect(plantPerMin).toBeGreaterThan(reference.plantPerMin * 0.75);
      expect(plantPerMin).toBeLessThan(reference.plantPerMin * 1.4);
      expect(travelPct).toBeGreaterThan(reference.travelPct - 15);
      expect(travelPct).toBeLessThan(reference.travelPct + 15);
    }

    const steps = [
      [30, 45],
      [45, 60],
      [60, 90],
      [90, 120]
    ] as const;
    process.stdout.write("\nMarginal benefit per capacity step (per simulated hour)\n");
    process.stdout.write(
      "cells step     dSupply dUnload dTravelS dTravelPct dPlant/m dHarv/m dTransitions dStmts dRowsRead\n"
    );
    for (const cells of FIELD_SIZES) {
      const at = (capacity: number): Scenario => {
        const found = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === capacity);
        if (found === undefined) throw new Error("missing scenario");
        return found;
      };
      for (const [from, to] of steps) {
        const a = at(from).cycle;
        const b = at(to).cycle;
        const d = (x: number, y: number): number => y - x;
        process.stdout.write(
          [
            pad(cells, 5),
            pad(`${String(from)}->${String(to)}`, 8),
            pad(fixed(d(perHour(a, a.logistics.supplyTrips), perHour(b, b.logistics.supplyTrips)), 1), 7),
            pad(fixed(d(perHour(a, a.logistics.unloadTrips), perHour(b, b.logistics.unloadTrips)), 1), 7),
            pad(fixed(d(a.timeDistribution.travel, b.timeDistribution.travel), 0), 8),
            pad(fixed((b.timeDistribution.travel / b.elapsedSeconds - a.timeDistribution.travel / a.elapsedSeconds) * 100, 1), 10),
            pad(fixed(d(perHour(a, worked(a, "PLANT")) / 60, perHour(b, worked(b, "PLANT")) / 60), 2), 8),
            pad(fixed(d(perHour(a, worked(a, "HARVEST")) / 60, perHour(b, worked(b, "HARVEST")) / 60), 2), 7),
            pad(fixed(d(perHour(a, a.settlements), perHour(b, b.settlements)), 1), 12),
            pad(fixed(d(perHour(a, a.counters.statements), perHour(b, b.counters.statements)), 0), 6),
            pad(fixed(d(perHour(a, a.counters.readRows), perHour(b, b.counters.readRows)), 0), 9)
          ].join(" ") + "\n"
        );
      }
    }

    process.stdout.write("\nProductivity multiplier vs Cargo 30 (harvests/min, by field size)\n");
    for (const cells of FIELD_SIZES) {
      const baseline = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === 30)?.cycle;
      if (baseline === undefined) continue;
      const base = perHour(baseline, worked(baseline, "HARVEST")) / 60;
      const cells30Base = base === 0 ? 1 : base;
      process.stdout.write(`${pad(cells, 4)}: `);
      for (const capacity of CAPACITIES) {
        const cycle = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === capacity)?.cycle;
        if (cycle === undefined) continue;
        const value = perHour(cycle, worked(cycle, "HARVEST")) / 60;
        process.stdout.write(`cargo ${String(capacity)}=${fixed(value / cells30Base, 2)}x  `);
      }
      process.stdout.write("\n");
    }

    // The larger capacity never breaks the guard and, on the fields where logistics matters, meaningfully
    // reduces the number of supply trips (a smaller number of larger loads).
    for (const cells of [100, 121] as const) {
      const small = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === 30)?.cycle;
      const large = scenarios.find((scenario) => scenario.cells === cells && scenario.capacity === 120)?.cycle;
      expect(small).toBeDefined();
      expect(large).toBeDefined();
      if (small === undefined || large === undefined) continue;
      expect(large.logistics.supplyTrips).toBeLessThanOrEqual(small.logistics.supplyTrips);
      expect(large.cargoMetrics.peakUsed).toBeLessThanOrEqual(120);
    }
  }, 1_800_000);

  it("probes a 150-cell field at cargo 30/60/120 when the layout allows it", async () => {
    let probe: Scenario[] = [];
    try {
      for (const capacity of PROBE_CAPACITIES) probe.push(await runScenario(PROBE_FIELD, capacity));
    } catch (error: unknown) {
      // The optional probe is allowed to be impractical; it must never fail the phase.
      process.stdout.write(`150-cell probe skipped: ${String(error)}\n`);
      probe = [];
    }
    if (probe.length === 0) return;
    process.stdout.write("\n150-cell probe (optional)\n");
    process.stdout.write("cargo plant/min harv/min supply/h unload/h travel% peakCargo util% stmts/h\n");
    for (const { capacity, cycle } of probe) {
      process.stdout.write(
        [
          pad(capacity, 5),
          pad(fixed(perHour(cycle, worked(cycle, "PLANT")) / 60, 1), 9),
          pad(fixed(perHour(cycle, worked(cycle, "HARVEST")) / 60, 1), 8),
          pad(fixed(perHour(cycle, cycle.logistics.supplyTrips), 1), 8),
          pad(fixed(perHour(cycle, cycle.logistics.unloadTrips), 1), 8),
          pad(fixed((cycle.timeDistribution.travel / cycle.elapsedSeconds) * 100, 0) + "%", 7),
          pad(fixed(cycle.cargoMetrics.peakUsed, 0), 9),
          pad(fixed(cycle.cargoMetrics.avgUtilization * 100, 0), 5),
          pad(fixed(perHour(cycle, cycle.counters.statements), 0), 7)
        ].join(" ") + "\n"
      );
      expect(cycle.cargoMetrics.peakUsed).toBeLessThanOrEqual(capacity);
    }
  }, 1_800_000);

  it("reports the starter-warehouse interaction (§18) without changing any warehouse tier", async () => {
    // Everything above raises the shelf so *labor* is the limit. This run deliberately leaves the
    // shipped starter warehouse in place: the question is whether a bigger pair of hands just fills
    // the starter shelf sooner and then blocks, which is future balance evidence, not a fix.
    const rows: { readonly capacity: number; readonly cycle: CycleResult }[] = [];
    for (const capacity of [30, 120] as const) {
      const world = createCostWorld(121, { cargoCapacity: capacity });
      try {
        // A seed store that fits the starter 1000-unit shelf; the run stops when the shelf is full.
        rows.push({
          capacity,
          cycle: await driveCycle(world, {
            cellCount: 121,
            seedQuantity: 900,
            maxSteps: 4000,
            gestureMs: GESTURE_MS,
            untilSeconds: WINDOW_SECONDS,
            tolerateStepFailure: true
          })
        });
      } finally {
        world.db.close();
      }
    }
    process.stdout.write("\nStarter warehouse interaction (121 cells, shipped 1000-unit shelf)\n");
    process.stdout.write("cargo elapsedS plants harvests supply/h unload/h travelS blocksWith stmts/h\n");
    for (const { capacity, cycle } of rows) {
      process.stdout.write(
        [
          pad(capacity, 5),
          pad(fixed(cycle.elapsedSeconds, 0), 7),
          pad(worked(cycle, "PLANT"), 7),
          pad(worked(cycle, "HARVEST"), 8),
          pad(fixed(perHour(cycle, cycle.logistics.supplyTrips), 1), 8),
          pad(fixed(perHour(cycle, cycle.logistics.unloadTrips), 1), 8),
          pad(fixed(cycle.timeDistribution.travel, 0), 7),
          pad(cycle.endedWith === null ? "hour" : `HTTP ${String(cycle.endedWith)}`, 10),
          pad(fixed(perHour(cycle, cycle.counters.statements), 0), 7)
        ].join(" ") + "\n"
      );
      // The shelf is a real bound: the run cannot keep delivering past it, whatever the capacity.
      expect(cycle.cargoMetrics.peakUsed).toBeLessThanOrEqual(capacity);
    }
    // At least one of the two runs must have been cut short by the shelf rather than the hour, which is
    // the interaction §18 asks about: more hands do not help once the shelf refuses the delivery.
    expect(rows.some((row) => row.cycle.endedWith === 409 || row.cycle.elapsedSeconds < WINDOW_SECONDS - 120)).toBe(true);
  }, 1_800_000);
});

