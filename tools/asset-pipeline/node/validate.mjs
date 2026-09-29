#!/usr/bin/env node
/**
 * Validates every shipped generated model against the spec that describes it.
 *
 * Run: `npm run assets:validate` (from the repository root, or any workspace).
 *
 * The checks are the review of an artifact nobody reads at review time: the file exists and is a
 * well-formed GLB, it is one mesh in the repository's narrow subset, it has no textures, it obeys its
 * budget, and it sits exactly in the envelope the renderer scales against. `checkGeneratedAssets`
 * is exported so `tests/integration/asset-models.test.ts` runs the same checks in CI.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureGlb } from "./glb.mjs";
import { MODEL_SPECS } from "./specs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const TRIANGLES = 4;
const ENVELOPE_TOLERANCE = 1e-3;

/**
 * Every problem found, as human-readable lines. An empty list means every artifact matches its spec.
 */
export function checkGeneratedAssets(repoRoot = REPO_ROOT) {
  const problems = [];
  const metrics = [];

  for (const spec of MODEL_SPECS) {
    const file = join(repoRoot, spec.directory, `${spec.id}.glb`);
    if (!existsSync(file)) {
      problems.push(`${spec.id}: missing ${spec.directory}/${spec.id}.glb`);
      continue;
    }
    const bytes = new Uint8Array(readFileSync(file));
    if (bytes.byteLength === 0) {
      problems.push(`${spec.id}: empty file`);
      continue;
    }

    let measured;
    try {
      measured = measureGlb(bytes);
    } catch (error) {
      problems.push(`${spec.id}: not a readable GLB (${String(error)})`);
      continue;
    }

    if (measured.magic !== GLB_MAGIC) problems.push(`${spec.id}: wrong container magic`);
    if (measured.version !== GLB_VERSION) problems.push(`${spec.id}: container is not glTF 2`);
    if (measured.declaredLength !== bytes.byteLength) problems.push(`${spec.id}: declared length disagrees with the file`);
    if (measured.meshes !== 1) problems.push(`${spec.id}: expected one mesh, found ${String(measured.meshes)}`);
    if (measured.primitives !== spec.build().length) {
      problems.push(`${spec.id}: expected one primitive per material part (${String(spec.build().length)})`);
    }
    if (measured.textures !== 0 || measured.images !== 0) problems.push(`${spec.id}: must not depend on textures`);
    if (measured.materials > spec.budget.materials) problems.push(`${spec.id}: ${String(measured.materials)} materials over budget`);
    if (measured.triangles > spec.budget.triangles) problems.push(`${spec.id}: ${String(measured.triangles)} triangles over budget`);
    if (bytes.byteLength > spec.budget.bytes) problems.push(`${spec.id}: ${String(bytes.byteLength)} bytes over budget`);

    if (Math.abs(measured.min[1]) > ENVELOPE_TOLERANCE) problems.push(`${spec.id}: base is not on y = 0`);
    if (Math.abs(measured.size[1] - spec.envelope.height) > ENVELOPE_TOLERANCE) {
      problems.push(`${spec.id}: height ${measured.size[1].toFixed(3)} is not ${String(spec.envelope.height)}`);
    }
    for (const axis of [0, 2]) {
      const extent = Math.max(Math.abs(measured.min[axis]), Math.abs(measured.max[axis]));
      if (extent > spec.envelope.halfFootprint + ENVELOPE_TOLERANCE) {
        problems.push(`${spec.id}: footprint ${extent.toFixed(3)} exceeds ${String(spec.envelope.halfFootprint)}`);
      }
    }

    metrics.push({
      id: spec.id,
      bytes: bytes.byteLength,
      triangles: measured.triangles,
      materials: measured.materials,
      textures: measured.textures,
      size: measured.size
    });
  }

  // A file nobody declares is as much a defect as a declaration with no file: the renderer would
  // never load it, and a reviewer would never know where it came from.
  const declared = new Set(MODEL_SPECS.map((spec) => join(spec.directory, `${spec.id}.glb`)));
  for (const spec of MODEL_SPECS) {
    const directory = join(repoRoot, spec.directory);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".glb")) continue;
      if (!declared.has(join(spec.directory, name))) {
        problems.push(`${spec.directory}/${name}: not declared by any spec`);
      }
    }
  }

  return { problems, metrics };
}

/** Prints the metrics table and exits non-zero when anything failed. */
function main() {
  const { problems, metrics } = checkGeneratedAssets();
  process.stdout.write("asset              bytes   tri   mat  tex   size (x y z)\n");
  for (const entry of metrics) {
    process.stdout.write(
      `${entry.id.padEnd(18)} ${String(entry.bytes).padStart(6)} ${String(entry.triangles).padStart(5)} ` +
        `${String(entry.materials).padStart(5)} ${String(entry.textures).padStart(4)}   ` +
        `${entry.size.map((value) => value.toFixed(2)).join(" x ")}\n`
    );
  }
  if (problems.length > 0) {
    process.stderr.write(`\n${String(problems.length)} problem(s):\n${problems.map((line) => `  ${line}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nall ${String(metrics.length)} models match their specs\n`);
  // A read of the directory is cheap insurance that the walk above saw real files.
  for (const spec of MODEL_SPECS) {
    const stat = statSync(join(REPO_ROOT, spec.directory, `${spec.id}.glb`));
    if (stat.size === 0) process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
