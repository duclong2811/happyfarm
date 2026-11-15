import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FISH_MODEL_URLS, RESOURCE_MODEL_URLS, TREE_STAGE_MODEL_URLS, treeStageModelId } from "../../apps/web/src/render/model-urls";

/**
 * Imported CC0 model sets that replaced generated placeholders (2026-11-15): fruit-tree stages, the
 * resource nodes and the catch. Each file is one self-contained, vertex-coloured mesh, and every id the
 * client names has exactly one shipped file behind it.
 */

const MODELS = fileURLToPath(new URL("../../apps/web/src/assets/models", import.meta.url));

function glbJson(path: string): { readonly meshes?: { primitives: { attributes: Record<string, number> }[] }[]; readonly images?: unknown[] } {
  const bytes = new Uint8Array(readFileSync(path));
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as ReturnType<typeof glbJson>;
}

function expectSingleColouredMesh(path: string, label: string): void {
  const json = glbJson(path);
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
  expect(primitives, label).toHaveLength(1);
  expect(primitives[0]?.attributes.COLOR_0, `${label} vertex colours`).toBeTypeOf("number");
  expect(json.images ?? [], `${label} needs no texture`).toHaveLength(0);
  expect(readFileSync(path).length, label).toBeLessThan(64 * 1024);
}

describe("imported model sets", () => {
  it("gives every fruit tree four stages and a picked look, and nothing else in its folder", () => {
    for (const tree of ["tree_apple", "tree_orange", "tree_peach"]) {
      for (const look of ["s1", "s2", "s3", "s4", "harvested"]) expect(TREE_STAGE_MODEL_URLS[`${tree}.${look}`], `${tree}.${look}`).toBeDefined();
    }
    const files = readdirSync(`${MODELS}/trees`).sort();
    expect(files).toEqual(Object.keys(TREE_STAGE_MODEL_URLS).map((id) => `${id}.glb`).sort());
    for (const file of files) expectSingleColouredMesh(`${MODELS}/trees/${file}`, file);
  });

  it("maps a tree's visual stage to its look", () => {
    expect(treeStageModelId("tree_apple", "SAPLING", 0)).toBe("tree_apple.s1");
    expect(treeStageModelId("tree_apple", "GROWING", 0.2)).toBe("tree_apple.s2");
    expect(treeStageModelId("tree_apple", "GROWING", 0.8)).toBe("tree_apple.s3");
    expect(treeStageModelId("tree_orange", "READY", 1)).toBe("tree_orange.s4");
    expect(treeStageModelId("tree_peach", "REGROWING", 0.4)).toBe("tree_peach.harvested");
    expect(treeStageModelId("tree_peach", "DEPLETED", 0)).toBe("tree_peach.harvested");
    expect(treeStageModelId("tree_wildwood", "READY", 1)).toBeNull();
  });

  it("ships every resource node and fish as one coloured mesh", () => {
    for (const id of Object.keys(RESOURCE_MODEL_URLS)) expectSingleColouredMesh(`${MODELS}/resources/${id}.glb`, id);
    for (const file of readdirSync(`${MODELS}/fishing`)) expectSingleColouredMesh(`${MODELS}/fishing/${file}`, file);
    expect(readdirSync(`${MODELS}/fishing`).length).toBe(Object.keys(FISH_MODEL_URLS).length);
  });
});
