import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CROP_STAGE_COUNT, CROP_STAGE_MODEL_URLS, cropStageFor, cropStageModelId } from "../../apps/web/src/render/model-urls";

/**
 * Growth-stage crop models (Quaternius Nature Crops Pack, CC0).
 *
 * Each staged crop ships exactly four models, every one a single vertex-coloured mesh (one draw call
 * a tile), self-contained, and light enough to plant a whole field of.
 */

const CROP_DIR = fileURLToPath(new URL("../../apps/web/src/assets/models/crops", import.meta.url));

function glbJson(path: string): {
  readonly meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  readonly materials?: unknown[];
  readonly images?: unknown[];
  readonly buffers?: { uri?: string }[];
} {
  const bytes = new Uint8Array(readFileSync(path));
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as ReturnType<typeof glbJson>;
}

describe("growth-stage crop models", () => {
  it("ships four stages for every staged crop, and nothing else", () => {
    const ids = Object.keys(CROP_STAGE_MODEL_URLS).sort();
    const crops = new Set(ids.map((id) => id.replace(/\.s\d$/, "")));
    for (const crop of crops) {
      for (let stage = 1; stage <= CROP_STAGE_COUNT; stage += 1) expect(cropStageModelId(crop, stage)).toBe(`${crop}.s${String(stage)}`);
    }
    expect(readdirSync(CROP_DIR).sort()).toEqual(ids.map((id) => `${id}.glb`));
  });

  it("draws each stage as one self-contained, vertex-coloured mesh", () => {
    for (const file of readdirSync(CROP_DIR)) {
      const json = glbJson(`${CROP_DIR}/${file}`);
      const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
      expect(primitives, file).toHaveLength(1);
      expect(primitives[0]?.attributes.COLOR_0, `${file} carries vertex colours`).toBeTypeOf("number");
      expect(json.images ?? [], `${file} needs no texture`).toHaveLength(0);
      expect(json.buffers?.[0]?.uri, `${file} buffer embedded`).toBeUndefined();
      expect(readFileSync(`${CROP_DIR}/${file}`).length, file).toBeLessThan(80 * 1024);
    }
  });

  it("shows the grown stage only when the server says mature", () => {
    expect(cropStageFor(false, 0)).toBe(1);
    expect(cropStageFor(false, 0.4)).toBe(2);
    expect(cropStageFor(false, 0.99)).toBe(3);
    expect(cropStageFor(false, 1)).toBe(3);
    expect(cropStageFor(true, 0.2)).toBe(4);
    expect(cropStageFor(false, Number.NaN)).toBe(1);
    expect(cropStageModelId("crop_potato", 1)).toBeNull();
  });
});
