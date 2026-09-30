import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The contract every imported environment model is held to.
 *
 * The renderer assumes three things about a scenery GLB, and each of them is a coordinate or a
 * reference that would be painful to discover at runtime:
 *
 * 1. It exists. A `?url` import fails the build, but an id that no file backs would only fail in the
 *    browser, and a missing tree is a hole in a forest.
 * 2. It is **self-contained**: one embedded buffer and embedded images, no sibling files. A `.gltf`
 *    that refers to a `.bin` next to it does not survive Vite's per-file asset handling.
 * 3. It is **normalized**: one world unit tall with its base on `y = 0`, so the world model can say
 *    "this tree is 3.4 metres" and be right, instead of carrying a per-asset magic number.
 *
 * The test walks the production folders rather than a manifest, because the manifest is verified by
 * the build itself - and walking the folders is also what proves the repository holds no unpacked
 * source pack that nobody is using.
 */

const MODEL_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models", import.meta.url));

/** The curated set: what the island actually places, and nothing else. */
const EXPECTED = {
  environment: [
    "bush_flowering",
    "bush_leafy",
    "flower_group_1",
    "flower_group_2",
    "plant_clover",
    "plant_fern",
    "plant_grass_tall",
    "plant_grass_wispy",
    "rock_boulder_1",
    "rock_boulder_2",
    "rock_boulder_3",
    "tree_broad_1",
    "tree_broad_2",
    "tree_broad_3",
    "tree_broad_4",
    "tree_pine_1",
    "tree_pine_2",
    "tree_pine_3"
  ],
  props: [
    // Medieval Village: the first four props the project imported.
    "prop_crate",
    "prop_fence_rail",
    "prop_fence_rail_long",
    "prop_wagon",
    // Fantasy Props: the set-dressing vocabulary V10 curates. One barrel, one crate, one bench, one
    // stall - the point of the list is that sixty compositions can be dressed without sixty models.
    "prop_anvil_log",
    "prop_axe",
    "prop_barrel",
    "prop_barrel_apples",
    "prop_bench",
    "prop_bucket",
    "prop_cage_small",
    "prop_chest",
    "prop_crate_carrot",
    "prop_crate_empty",
    "prop_crate_produce",
    "prop_crate_wooden",
    "prop_lantern",
    "prop_planter",
    "prop_rope",
    "prop_sack",
    "prop_stall",
    "prop_stall_cart",
    "prop_whetstone",
    "prop_workbench"
  ]
} as const;

/**
 * The imported farm buildings, which are the same contract in a different family: self-contained GLBs
 * normalized to one world unit, drawn at the size their manifest entry names.
 */
const BUILDINGS: readonly string[] = [
  "civic.well.t1",
  "farm.barn.t1",
  "farm.barn.t2",
  "farm.barn.t3",
  "farm.coop.t1",
  "farm.openbarn.t1",
  "farm.silo.t1",
  "farm.silo_house.t2",
  "farm.windmill.t2"
];

interface GltfJson {
  readonly accessors?: { min?: number[]; max?: number[]; count?: number }[];
  readonly buffers?: { uri?: string; byteLength: number }[];
  readonly bufferViews?: { byteOffset: number; byteLength: number }[];
  readonly images?: { uri?: string; bufferView?: number }[];
  readonly meshes?: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
  readonly nodes?: { scale?: number[]; translation?: number[] }[];
  readonly scenes?: unknown[];
}

interface Glb {
  readonly json: GltfJson;
  readonly bytes: number;
}

function readGlb(path: string): Glb {
  // Plain bytes and a DataView rather than Node's Buffer helpers: the Buffer a test reads is not the
  // one Node's typings describe, and this is the same convention the crop-model test already uses.
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true), `${path} magic`).toBe(0x46546c67);
  expect(view.getUint32(4, true), `${path} version`).toBe(2);
  expect(view.getUint32(8, true), `${path} declared length`).toBe(bytes.length);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true), `${path} first chunk is JSON`).toBe(0x4e4f534a);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson;
  return { json, bytes: bytes.length };
}

/** The model's own extents, before the root node's normalizing scale. */
/**
 * The model's own extents, before the root node's normalizing scale.
 *
 * Only the POSITION accessors count. Reading every accessor that happens to carry a `min`/`max` also
 * reads the normals, which are unit vectors - so they always measure a two-unit cube and would hide a
 * model that was never normalized at all.
 */
function extentsOf(json: GltfJson): {
  readonly size: number;
  readonly baseY: number;
} {
  const accessors = json.accessors ?? [];
  const positions = (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives.map((primitive) => accessors[primitive.attributes.POSITION]))
    .filter(
      (accessor): accessor is { min: number[]; max: number[] } =>
        accessor !== undefined && accessor.min !== undefined && accessor.max !== undefined
    );
  const minY = Math.min(...positions.map((accessor) => accessor.min[1] ?? 0));
  const spans = [0, 1, 2].map(
    (axis) =>
      Math.max(...positions.map((accessor) => accessor.max[axis] ?? 0)) -
      Math.min(...positions.map((accessor) => accessor.min[axis] ?? 0))
  );
  return { size: Math.max(...spans), baseY: minY };
}

describe("imported environment models", () => {
  it("ships exactly the curated set, in the categories the manifest names", () => {
    for (const [category, ids] of Object.entries(EXPECTED)) {
      const folder = `${MODEL_ROOT}/${category}`;
      expect(existsSync(folder), `${category} folder`).toBe(true);
      const files = readdirSync(folder)
        .filter((name) => name.endsWith(".glb"))
        .map((name) => name.replace(/\.glb$/, ""))
        .sort();
      expect(files, `${category} contents`).toEqual([...ids].sort());
    }
  });

  it("keeps every model self-contained, normalized, and light enough for its role", () => {
    for (const [category, ids] of Object.entries(EXPECTED)) {
      for (const id of ids) {
        const glb = readGlb(`${MODEL_ROOT}/${category}/${id}.glb`);
        const json = glb.json;

        // Self-contained: one embedded buffer, embedded images, no external file of any kind.
        const buffers = json.buffers ?? [];
        expect(buffers, id).toHaveLength(1);
        expect(buffers[0]?.uri, `${id} buffer must be embedded`).toBeUndefined();
        for (const image of json.images ?? []) {
          expect(image.uri, `${id} image must be embedded`).toBeUndefined();
          expect(image.bufferView, id).toBeTypeOf("number");
        }

        // A scene with something in it.
        expect((json.scenes ?? []).length, id).toBe(1);
        expect((json.meshes ?? []).length, id).toBeGreaterThan(0);

        // Normalized to one world unit across its largest dimension, base on y = 0. The largest
        // dimension rather than the height, because a flower is wide and short and dividing by its
        // height would make it metres across.
        const root = (json.nodes ?? [])[0];
        const scale = root?.scale?.[0] ?? 1;
        const { size, baseY } = extentsOf(json);
        expect(size * scale, `${id} drawn size`).toBeCloseTo(1, 3);
        expect(baseY * scale + (root?.translation?.[1] ?? 0), `${id} base on the ground`).toBeCloseTo(0, 3);

        // A curated tree is a few thousand triangles; anything past this has outgrown its role.
        let triangles = 0;
        const accessors = json.accessors ?? [];
        for (const mesh of json.meshes ?? []) {
          for (const primitive of mesh.primitives) {
            if (primitive.indices !== undefined) triangles += accessors[primitive.indices]?.count ?? 0;
          }
        }
        expect(triangles / 3, `${id} triangles`).toBeLessThan(7000);
        // Nothing in the set should be a megabyte: these are props, not hero characters.
        expect(glb.bytes, `${id} bytes`).toBeLessThan(600 * 1024);
      }
    }
  });

  it("leaves no unpacked source pack behind", () => {
    // The brief's rule, enforced: download to a temporary area, copy in what is used, and ship
    // nothing else. A stray archive or a whole extracted pack would be somebody's licence problem
    // and several megabytes of bundle that nothing renders.
    const walk = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]
      );
    const assets = walk(MODEL_ROOT);
    const strays = assets.filter((path) => /\.(zip|rar|7z|fbx|obj|mtl|blend|gltf)$/i.test(path));
    expect(strays, "only .glb files belong in the model folders").toEqual([]);
  });

  it("ships the imported farm buildings under the same contract", () => {
    const folder = `${MODEL_ROOT}/farm-buildings`;
    const files = readdirSync(folder)
      .filter((name) => name.endsWith(".glb"))
      .map((name) => name.replace(/\.glb$/, ""))
      .sort();
    expect(files).toEqual([...BUILDINGS].sort());

    for (const id of BUILDINGS) {
      const glb = readGlb(`${folder}/${id}.glb`);
      const root = (glb.json.nodes ?? [])[0];
      const scale = root?.scale?.[0] ?? 1;
      const { size, baseY } = extentsOf(glb.json);
      // One world unit across the largest dimension and grounded, exactly like the scenery: the
      // manifest decides how many metres a barn is, not the file.
      expect(size * scale, `${id} drawn size`).toBeCloseTo(1, 2);
      expect(baseY * scale + (root?.translation?.[1] ?? 0), `${id} base on the ground`).toBeCloseTo(0, 2);
      expect(glb.bytes, `${id} bytes`).toBeLessThan(900 * 1024);
    }
  });
});
