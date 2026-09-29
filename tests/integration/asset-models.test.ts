import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkGeneratedAssets } from "../../tools/asset-pipeline/node/validate.mjs";
import { MODEL_SPECS } from "../../tools/asset-pipeline/node/specs.mjs";

/**
 * Holds every shipped generated model to the spec that describes it.
 *
 * The pipeline's own validator does the measuring (`tools/asset-pipeline/node/validate.mjs`), and
 * this runs it in CI: container, narrow subset, no textures, envelope, budgets, and no undeclared
 * `.glb` next to a declared one. Art cannot be reviewed as a diff, so the checkpoint is the contract
 * the renderer scales against - not a pixel.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("generated asset pipeline", () => {
  it("ships every model its spec declares, matching the contract", () => {
    const { problems } = checkGeneratedAssets(REPO_ROOT);
    expect(problems).toEqual([]);
  });

  it("keeps every model inside the budgets the art bible states", () => {
    const { metrics } = checkGeneratedAssets(REPO_ROOT);
    expect(metrics).toHaveLength(MODEL_SPECS.length);
    for (const entry of metrics) {
      const spec = MODEL_SPECS.find((candidate) => candidate.id === entry.id);
      expect(spec, entry.id).toBeDefined();
      expect(entry.triangles, entry.id).toBeLessThanOrEqual(spec?.budget.triangles ?? 0);
      expect(entry.materials, entry.id).toBeLessThanOrEqual(spec?.budget.materials ?? 0);
      expect(entry.bytes, entry.id).toBeLessThanOrEqual(spec?.budget.bytes ?? 0);
      expect(entry.textures, entry.id).toBe(0);
    }
  });

  it("measures the shipped files rather than trusting the generator's own report", () => {
    for (const spec of MODEL_SPECS) {
      const bytes = readFileSync(`${REPO_ROOT}${spec.directory}/${spec.id}.glb`);
      expect(bytes.byteLength, spec.id).toBeGreaterThan(0);
      // The GLB header carries the file's own length; a truncated copy would still start with MAGIC.
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(header.getUint32(8, true), spec.id).toBe(bytes.byteLength);
    }
  });

  it("keeps every spec inside the art bible's envelopes", () => {
    for (const spec of MODEL_SPECS) {
      expect(spec.envelope.height, spec.id).toBeGreaterThan(0);
      expect(spec.envelope.halfFootprint, spec.id).toBeGreaterThan(0);
      expect(spec.directory.startsWith("apps/web/src/assets/models"), spec.id).toBe(true);
    }
    // Ids are stable snake-like namespaces and unique, so a file cannot silently take another's place.
    const ids = MODEL_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/);
  });
});
