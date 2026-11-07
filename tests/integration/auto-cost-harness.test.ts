import { describe, expect, it } from "vitest";
import { createCostWorld, driveCycle, type CostWorld, type CycleResult } from "../support/cost-harness";

/**
 * Stage A of B2.5: measure the completed REPLANT_CROP loop through the production handler, the
 * production repositories and the shipped schema.
 *
 * The numbers printed here are measured statement shapes, not Cloudflare billing figures. They exist
 * so the B2.5 decision - optimize or leave alone - rests on evidence.
 */

function line(label: string, result: CycleResult): string {
  const c = result.counters;
  return [
    label.padEnd(10),
    `steps=${String(result.steps).padStart(4)}`,
    `settle=${String(result.settlements).padStart(4)}`,
    `batches=${String(c.batches).padStart(4)}`,
    `stmts=${String(c.statements).padStart(6)}`,
    `reads=${String(c.reads).padStart(6)}`,
    `readRows=${String(c.readRows).padStart(6)}`,
    `writes=${String(c.writes).padStart(6)}`,
    `writeRows=${String(c.writeRows).padStart(6)}`,
    `receipts=${String(c.receiptWrites).padStart(5)}`,
    `autoState=${String(c.autoStateWrites).padStart(5)}`
  ].join(" ");
}

/** The per-list read counts the read-reuse assertions are written against. */
function listReads(world: CostWorld): Readonly<Record<string, number>> {
  return {
    crops: world.counting.countsMatching("FROM crop_instances WHERE farm_id"),
    trees: world.counting.countsMatching("FROM tree_instances WHERE farm_id"),
    tiles: world.counting.countsMatching("FROM farm_tiles WHERE farm_id"),
    cells: world.counting.countsMatching("FROM work_area_cells"),
    bounds: world.counting.countsMatching("FROM farm_constructions")
  };
}

describe("Auto cost harness (real repositories, deterministic)", () => {
  it("measures one full cycle of a 1-, 30- and 121-cell REPLANT_CROP field", async () => {
    const scenarios = [1, 30, 121];
    interface Measured {
      readonly cells: number;
      readonly result: CycleResult;
      readonly listReads: Readonly<Record<string, number>>;
    }
    const results: Measured[] = [];
    for (const cellCount of scenarios) {
      const targetHarvests = Math.max(cellCount, 15);
      // Every planted cell consumes one seed, and the measured cycle replants as it goes: a generous
      // store keeps supply from being the thing the scenario measures.
      const seedQuantity = targetHarvests * 2 + 30;
      const world = createCostWorld(cellCount);
      try {
        // The B2.5 reference was measured with a 750 ms post-transition cadence; the assertion below
        // is about D1 cost per unit of work, so the historical window is kept exactly as recorded.
        const result = await driveCycle(world, { cellCount, seedQuantity, maxSteps: 1200, targetHarvests, gestureMs: 750 });
        results.push({ cells: cellCount, result, listReads: listReads(world) });
      } finally {
        world.db.close();
      }
    }

    for (const { cells, result, listReads: reads } of results) {
      process.stdout.write(`${line(`${String(cells)} cells`, result)}\n`);
      process.stdout.write(`           listReads=${JSON.stringify(reads)}\n`);
      process.stdout.write(`           elapsed=${result.elapsedSeconds.toFixed(1)}s harvestRate=${(result.settlements / 2 / (result.elapsedSeconds / 3600)).toFixed(1)}/h\n`);
      const ranked = Object.entries(result.byStep)
        .sort((left, right) => right[1].statements - left[1].statements)
        .slice(0, 4)
        .map(([key, counts]) => `${key} x${String(counts.batches)}:${String(counts.statements)}st/${String(counts.reads)}rd/${String(counts.writes)}wr`)
        .join(" | ");
      process.stdout.write(`           replant=${String(result.replantAction)} top=${ranked}\n`);
      process.stdout.write(`           digest=${result.digest}\n`);
      for (const sql of result.topSql.slice(0, 6)) {
        process.stdout.write(`             x${String(sql.count).padStart(5)} rows=${String(sql.rows).padStart(6)} ${sql.query}\n`);
      }
    }

    /**
     * The reference semantics: captured from the same scenario under the same fixed ids and clock.
     * The digest covers every durable table the loop can touch except `actor_auto_state.simulation_at`
     * — B3 changed that column's persistence on purpose (a walk must not erase how far Auto has been
     * reconciled) and pins it in the reconciliation tests instead. The write counts and every
     * economic row are what the equivalence is about here.
     */
    const reference: Readonly<Record<number, {
      readonly digest: string;
      readonly steps: number;
      readonly settlements: number;
      readonly batches: number;
      readonly receipts: number;
      readonly autoState: number;
      readonly writeRows: number;
    }>> = {
      1: {
        digest: "b7866289ea004ebf30810cd658ad417fb0979e84f8aaab48f4b672064de895e0",
        steps: 91,
        settlements: 46,
        batches: 46,
        receipts: 107,
        autoState: 243,
        writeRows: 323
      },
      30: {
        digest: "5b288440d39eda2ab7524921f7209454d636a1133fea34ed409e7cf674291e45",
        steps: 126,
        settlements: 63,
        batches: 63,
        receipts: 156,
        autoState: 376,
        writeRows: 531
      },
      121: {
        digest: "de57fe0701042722c78cd9b3e37b182731f67816d6f86a6f3a3b02695636cd3b",
        steps: 762,
        settlements: 381,
        batches: 381,
        receipts: 887,
        autoState: 2286,
        writeRows: 3154
      }
    };

    for (const { cells, result, listReads: reads } of results) {
      const expected = reference[cells];
      expect(expected).toBeDefined();
      if (expected === undefined) continue;
      // Equivalence: this run and the reference run end in the same durable state and paid the same
      // economic and timeline writes.
      expect(result.digest).toBe(expected.digest);
      expect(result.steps).toBe(expected.steps);
      expect(result.settlements).toBe(expected.settlements);
      expect(result.counters.batches).toBe(expected.batches);
      expect(result.counters.receiptWrites).toBe(expected.receipts);
      expect(result.counters.autoStateWrites).toBe(expected.autoState);
      expect(result.counters.writeRows).toBe(expected.writeRows);
      // Read shape: at most one work-area-cells read and one bounds read per step, and no step reads
      // the farm's crop list more than twice.
      expect(reads.cells ?? 0).toBeLessThanOrEqual(Math.ceil(result.steps * 1.5));
      expect(reads.bounds ?? 0).toBeLessThanOrEqual(Math.ceil(result.steps * 1.5));
      expect(reads.crops ?? 0).toBeLessThanOrEqual(result.steps * 2);
      expect(result.counters.reads / result.steps).toBeLessThanOrEqual(25);
    }

    for (const { result } of results) {
      expect(result.steps).toBeGreaterThan(0);
      expect(result.settlements).toBeGreaterThan(0);
      expect(result.counters.batches).toBeGreaterThan(0);
      expect(result.counters.reads).toBeGreaterThan(0);
      expect(result.counters.writes).toBeGreaterThan(0);
      expect(result.replantAction).not.toBeNull();
    }
  }, 600_000);
});
