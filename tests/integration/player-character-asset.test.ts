import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAYER_CHARACTER_ASSET } from "../../apps/web/src/render/player-character";

/**
 * The contract the imported player character is held to.
 *
 * A character is the one model in the project that is **skinned**, so the rules the environment models
 * follow do not all apply: its geometry is deliberately not normalised to one unit (rescaling POSITION
 * accessors without the skeleton would tear the skin apart), and instead the client measures the model
 * and scales it to the world's character height. What must hold is everything else:
 *
 * 1. it exists, and is the *only* thing in its folder - a stray archive or a second pack is a licence
 *    problem and bundle weight nobody renders;
 * 2. it is **self-contained**: one embedded buffer, the palette embedded as an image, no sibling file
 *    (a GLB that refers to `Textures/colormap.png` next to it cannot survive Vite's asset hashing);
 * 3. it carries the clips the presentation config names, so the state machine has something to play;
 * 4. it is light enough to be a hero character in a browser game, and small enough to check by hand.
 */

const MODEL_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models", import.meta.url));
const CHARACTER_DIR = `${MODEL_ROOT}/player`;
const FILE = `${CHARACTER_DIR}/player-farmer.glb`;

interface GltfJson {
  readonly buffers?: { uri?: string; byteLength: number }[];
  readonly images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  readonly textures?: unknown[];
  readonly materials?: unknown[];
  readonly meshes?: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
  readonly accessors?: { count?: number; min?: number[]; max?: number[] }[];
  readonly animations?: { name?: string; channels?: unknown[] }[];
  readonly skins?: { joints: number[] }[];
  readonly nodes?: unknown[];
}

function readGlb(path: string): { readonly json: GltfJson; readonly bytes: number } {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true), `${path} magic`).toBe(0x46546c67);
  expect(view.getUint32(4, true), `${path} version`).toBe(2);
  expect(view.getUint32(8, true), `${path} declared length`).toBe(bytes.length);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true), `${path} first chunk is JSON`).toBe(0x4e4f534a);
  return {
    json: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson,
    bytes: bytes.length
  };
}

describe("the imported player character", () => {
  it("ships exactly one file, and nothing a pack left behind", () => {
    expect(existsSync(CHARACTER_DIR), "the character folder exists").toBe(true);
    expect(readdirSync(CHARACTER_DIR).sort()).toEqual(["player-farmer.glb"]);
    const strays = readdirSync(CHARACTER_DIR).filter((name) => !name.endsWith(".glb"));
    expect(strays, "only GLBs belong in a model folder").toEqual([]);
  });

  it("is self-contained: one embedded buffer and an embedded palette", () => {
    const { json } = readGlb(FILE);
    const buffers = json.buffers ?? [];
    expect(buffers).toHaveLength(1);
    expect(buffers[0]?.uri, "the buffer must be embedded").toBeUndefined();
    const images = json.images ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      // The Kenney pack ships the palette as a sibling `Textures/colormap.png`; the importer folds it
      // into the binary chunk, and this is what proves it stayed folded.
      expect(image.uri, "no image may point at a sibling file").toBeUndefined();
      expect(image.bufferView, "an embedded image needs a bufferView").toBeTypeOf("number");
      expect(image.mimeType).toBe("image/png");
    }
  });

  it("carries the clips the presentation config asks for", () => {
    const { json } = readGlb(FILE);
    const clips = (json.animations ?? []).map((animation) => animation.name ?? "");
    const wanted = [
      PLAYER_CHARACTER_ASSET.animations.idle,
      PLAYER_CHARACTER_ASSET.animations.walk,
      PLAYER_CHARACTER_ASSET.animations.run
    ];
    for (const name of wanted) {
      expect(name, "the shipped config names a clip").not.toBeNull();
      expect(clips, `${String(name)} is in the file`).toContain(name);
    }
    // Every clip has something to drive it: an animation with no channels animates nothing.
    for (const animation of json.animations ?? []) {
      expect((animation.channels ?? []).length, animation.name).toBeGreaterThan(0);
    }
  });

  it("is a skinned character with a skeleton a mixer can drive", () => {
    const { json } = readGlb(FILE);
    expect(json.skins?.length ?? 0).toBeGreaterThan(0);
    for (const skin of json.skins ?? []) {
      expect(skin.joints.length, "a rig needs joints").toBeGreaterThan(1);
    }
    // The height the client will measure: positive, and small enough that scaling it up to 1.6 m is
    // a normalisation rather than a repair.
    const positions = (json.meshes ?? [])
      .flatMap((mesh) => mesh.primitives.map((primitive) => json.accessors?.[primitive.attributes.POSITION]))
      .filter(
        (accessor): accessor is { readonly min: number[]; readonly max: number[] } =>
          accessor !== undefined && accessor.min !== undefined && accessor.max !== undefined
      );
    const minY = Math.min(...positions.map((accessor) => accessor.min[1] ?? 0));
    const maxY = Math.max(...positions.map((accessor) => accessor.max[1] ?? 0));
    const height = maxY - minY;
    expect(height).toBeGreaterThan(0.2);
    expect(height).toBeLessThan(4);
    expect(minY).toBeGreaterThanOrEqual(-0.01);
  });

  it("is light enough to be a hero character on a phone", () => {
    const { json, bytes } = readGlb(FILE);
    let indices = 0;
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives) {
        if (primitive.indices !== undefined) indices += json.accessors?.[primitive.indices]?.count ?? 0;
      }
    }
    expect(indices / 3).toBeLessThan(2500);
    expect(json.materials?.length ?? 0).toBeLessThanOrEqual(2);
    expect(json.textures?.length ?? 0).toBeLessThanOrEqual(1);
    // The pack ships the full clip set because a later pass may want it (see the docs); it is still a
    // quarter of a megabyte, which is a character's worth rather than a pack's.
    expect(bytes).toBeLessThan(400 * 1024);
  });
});
