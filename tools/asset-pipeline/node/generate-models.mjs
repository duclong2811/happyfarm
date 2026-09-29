#!/usr/bin/env node
/**
 * Generates every model in `specs.mjs` into the client's asset tree.
 *
 * Run: `npm run assets:generate --workspace @happy-farm/web`
 *
 * The builder describes a shape; this runner makes it obey the contract, so a builder cannot ship a
 * crop that floats, sinks, or overhangs its tile: it measures the parts, puts the base on y = 0,
 * centres the footprint, scales the whole model to the spec's exact height, and refuses to write a
 * file whose footprint does not fit.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGlb, measureGlb } from "./glb.mjs";
import { MODEL_SPECS } from "./specs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Bounding box of a part list, before anything is written. */
function boundsOf(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const current of parts) {
    for (const vertex of current.triangles) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  return { min, max };
}

/** Base on the ground, footprint centred, height exactly the spec's - in that order. */
function normalise(parts, spec) {
  const { min, max } = boundsOf(parts);
  const height = max[1] - min[1];
  if (!Number.isFinite(height) || height <= 0) throw new Error(`${spec.id}: no height to normalise`);
  const scale = spec.envelope.height / height;
  const centerX = (min[0] + max[0]) / 2;
  const centerZ = (min[2] + max[2]) / 2;
  for (const current of parts) {
    current.triangles = current.triangles.map((vertex) => [
      (vertex[0] - centerX) * scale,
      (vertex[1] - min[1]) * scale,
      (vertex[2] - centerZ) * scale
    ]);
  }
  const normalised = boundsOf(parts);
  for (const axis of [0, 2]) {
    const extent = Math.max(Math.abs(normalised.min[axis]), Math.abs(normalised.max[axis]));
    if (extent > spec.envelope.halfFootprint + 1e-6) {
      throw new Error(
        `${spec.id}: footprint reaches ${extent.toFixed(3)} but the spec allows ${String(spec.envelope.halfFootprint)}`
      );
    }
  }
  return parts;
}

let failed = false;
for (const spec of MODEL_SPECS) {
  const parts = normalise(spec.build(), spec);
  const { glb, triangles } = buildGlb(spec.id, parts);
  const target = join(REPO_ROOT, spec.directory);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${spec.id}.glb`), glb);

  const measured = measureGlb(new Uint8Array(glb));
  const bytes = glb.length;
  const budget = spec.budget;
  const problems = [];
  if (triangles > budget.triangles) problems.push(`triangles ${String(triangles)} > ${String(budget.triangles)}`);
  if (measured.materials > budget.materials) problems.push(`materials ${String(measured.materials)} > ${String(budget.materials)}`);
  if (bytes > budget.bytes) problems.push(`bytes ${String(bytes)} > ${String(budget.bytes)}`);
  if (problems.length > 0) failed = true;

  process.stdout.write(
    `${spec.id.padEnd(18)} ${String(bytes).padStart(6)} B  ${String(triangles).padStart(5)} tri  ` +
      `${String(measured.materials)} mat  height ${measured.size[1].toFixed(3)}  ` +
      `footprint ${(Math.max(measured.size[0], measured.size[2]) / 2).toFixed(3)}  ` +
      `size ${measured.size.map((value) => value.toFixed(2)).join(" x ")}` +
      `${problems.length > 0 ? `  BUDGET: ${problems.join(", ")}` : ""}\n`
  );
}

if (failed) {
  process.stderr.write("one or more models exceed their budget; see the lines above\n");
  process.exitCode = 1;
}
