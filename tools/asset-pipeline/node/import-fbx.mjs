/**
 * Converts the FBX-only Quaternius packs into HappyFarm's runtime GLB contract.
 *
 * Quaternius ships the farm buildings as FBX, Blend and OBJ - no glTF - so the glTF importer in
 * `import-cc0.mjs` cannot read them. This tool uses the copy of three.js the client already depends
 * on: `FBXLoader` parses the binary FBX into geometry and materials, and `GLTFExporter` writes a
 * self-contained GLB. The same normalization rules apply as for the glTF packs - one world unit
 * across the largest dimension, centred on X/Z, base on `y = 0` - so a placement can still say "this
 * barn is six metres wide" and be right.
 *
 * Usage:
 *   node tools/asset-pipeline/node/import-fbx.mjs --source <dir with .fbx> --out <dir> [--report <file>] [--set <name>]
 *
 * `--set` picks the curated list: `farm-buildings` (the default, Quaternius Lowpoly Farm Buildings) or
 * `crops` (Quaternius Nature Crops Pack). A crop ships one model per growth stage, and every stage of
 * one crop is scaled by the factor that makes its *mature* stage one unit across, so a sprout stays a
 * sprout next to the grown plant instead of being blown up to the same size.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BufferAttribute, Mesh, Box3, Group, Matrix4, MeshStandardMaterial, SRGBColorSpace, Vector3 } from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * The glTF exporter reads an image blob through `FileReader`, which Node does not have. The only
 * method the exporter calls is `readAsArrayBuffer`, and Node's `Blob` can already do that, so the
 * polyfill is four lines rather than a dependency.
 */
if (globalThis.FileReader === undefined) {
  globalThis.FileReader = class {
    result = null;
    onloadend = null;
    readAsArrayBuffer(blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

/** The curated farm-buildings set: what the island's structures are actually drawn from. */
const CURATED = [
  { id: "farm.barn.t2", source: "Barn" },
  { id: "farm.barn.t3", source: "BigBarn" },
  { id: "farm.barn.t1", source: "SmallBarn" },
  { id: "farm.openbarn.t1", source: "OpenBarn" },
  { id: "farm.silo.t1", source: "Silo" },
  { id: "farm.silo_house.t2", source: "Silo_House" },
  { id: "farm.windmill.t2", source: "TowerWindmill" },
  // Windmill, WaterTower and the two fences are deliberately absent: nothing draws them yet, and an
  // asset that ships without a scene that uses it is a bundle cost and a licence entry with no
  // purpose. They are the first models to import again when a pass gives them a place.
  { id: "civic.well.t1", source: "Well" },
  { id: "farm.coop.t1", source: "ChickenCoop" },
  // Fence and Fence2 are deliberately absent: nothing in the world draws a fence yet, and an asset
  // that ships without a scene that uses it is a bundle cost and a licence entry with no purpose.
  // They are the first models to import again when the field-boundary pass lands.
];

/** Crops with growth stages: the game's crop id and the pack's name for its grower. */
const CROP_SOURCES = [
  // `clump`: how many plants one tile holds. A single wheat stalk or carrot top reads as a weed, a
  // little stand of them as a field; they are merged into the one mesh, so it costs no draw calls.
  { id: "crop_carrot", source: "Carrot", clump: 3 },
  { id: "crop_corn", source: "Corn", clump: 2 },
  { id: "crop_wheat", source: "Wheat", clump: 5 },
  { id: "crop_tomato", source: "Tomato" },
  { id: "crop_pumpkin", source: "Pumpkin" },
  // The pack has no cabbage or strawberry; its lettuce and berry bush are the closest growers.
  { id: "crop_cabbage", source: "Lettuce" },
  { id: "crop_strawberry", source: "BushBerries" }
];
const CROP_STAGES = 4;
const CROPS = CROP_SOURCES.flatMap((crop) =>
  Array.from({ length: CROP_STAGES }, (_, index) => ({
    id: `crops/${crop.id}.s${String(index + 1)}`,
    source: `${crop.source}_${String(index + 1)}`,
    scaleFrom: `${crop.source}_${String(CROP_STAGES)}`,
    clump: crop.clump ?? 1
  }))
);

/** Where the plants of a clump stand, in model units, and how each is turned. Fixed, so builds repeat. */
const CLUMP_LAYOUTS = {
  1: [[0, 0, 0]],
  2: [[-0.17, -0.1, 0.4], [0.17, 0.12, 2.1]],
  3: [[-0.2, -0.13, 0.3], [0.21, -0.1, 2.4], [0.01, 0.2, 4.2]],
  5: [[0, 0, 0], [-0.25, -0.23, 1.3], [0.26, -0.21, 2.6], [-0.23, 0.25, 3.9], [0.24, 0.24, 5.2]]
};

/**
 * Resource nodes (Quaternius Ultimate Fantasy RTS). The pack has one kind of ore - gold veins in
 * stone - so the other ores are the same rocks with the vein material recoloured (`tint`, linear RGB
 * by material name): a player has to tell copper from coal at a glance.
 */
const RESOURCES = [
  { id: "resources/resource_stone", source: "Resource_Gold_1" },
  { id: "resources/resource_copper", source: "Resource_Gold_2", tint: { Gold: [0.5, 0.17, 0.06] } },
  // Iron and coal recolour the rock as well as the vein: a few dark nuggets on grey stone do not read
  // as a different ore from across the field.
  { id: "resources/resource_iron", source: "Resource_Gold_3", tint: { Gold: [0.3, 0.07, 0.04], Stone: [0.26, 0.17, 0.13] } },
  { id: "resources/resource_coal", source: "Resource_Gold_1", tint: { Gold: [0.012, 0.012, 0.014], Stone: [0.07, 0.07, 0.075] }, turn: 2.2 },
  { id: "resources/resource_pine", source: "Resource_PineTree" },
  { id: "resources/resource_hardwood", source: "Resource_Tree1" },
  { id: "resources/resource_wildwood", source: "Resource_Tree2" },
  { id: "resources/resource_pine_stump", source: "Resource_PineTree_Group_Cut" },
  { id: "resources/resource_hardwood_stump", source: "Resource_Tree_Group_Cut" },
  { id: "resources/resource_wildwood_stump", source: "Resource_Tree_Group_Cut", turn: 1.9 }
];

/** The catch (Quaternius Cute Fish): the closest of the pack's fish to each one the game names. */
const FISH = [
  { id: "fishing/fish_carp", source: "Koi" },
  { id: "fishing/fish_catfish", source: "ArmoredCatfish" },
  { id: "fishing/fish_snapper", source: "RedSnapper" },
  { id: "fishing/fish_tuna", source: "Tuna" },
  { id: "fishing/fish_sardine", source: "Tetra" },
  { id: "fishing/fish_mackerel", source: "BlueTang" },
  // A silver, deep-bodied fish: the tilapia's shape, rather than a second red one beside the snapper.
  { id: "fishing/fish_tilapia", source: "Sunfish" }
];

/**
 * Fruit trees (Quaternius Nature Crops Pack): four growth stages and the picked tree, every look of a
 * tree at its grown stage's scale. The pack has no peach, so the peach is the apple with its fruit
 * recoloured.
 */
const ORCHARD_SOURCES = [
  { id: "tree_apple", source: "Apple" },
  { id: "tree_orange", source: "Orange" },
  { id: "tree_peach", source: "Apple", tint: { DarkRed: [0.95, 0.36, 0.16] } }
];
const ORCHARD = ORCHARD_SOURCES.flatMap((tree) =>
  [...Array.from({ length: 4 }, (_, index) => [`s${String(index + 1)}`, `${tree.source}_${String(index + 1)}`]), ["harvested", `${tree.source}_Harvested`]].map(
    ([look, source]) => ({ id: `trees/${tree.id}.${look}`, source, scaleFrom: `${tree.source}_4`, ...(tree.tint === undefined ? {} : { tint: tree.tint }) })
  )
);

const SETS = { "farm-buildings": CURATED, crops: CROPS, resources: RESOURCES, fish: FISH, orchard: ORCHARD };
/** Sets of flat-coloured models: merged to one vertex-coloured mesh per model (one draw call each). */
const MERGED_SETS = new Set(["crops", "resources", "fish", "orchard"]);

/**
 * One mesh, one material: every part's flat colour becomes a vertex colour and the parts are merged.
 *
 * A crop is drawn on every planted tile, so a model of five coloured parts is five draw calls a tile;
 * merged it is one, and it looks the same because the pack's materials are flat colours, not textures.
 */
function mergeToVertexColors(root, clump = 1, tint = {}, turn = 0) {
  const parts = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = (child.geometry.index === null ? child.geometry : child.geometry.toNonIndexed()).clone();
    // Position and colour only. The pack is flat-shaded, and a glTF primitive without normals is drawn
    // flat-shaded by the loader - so dropping them keeps the look and lets shared corners be merged.
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position") geometry.deleteAttribute(name);
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    // Non-indexed, a group's range is a vertex range; a mesh with no groups is one material.
    const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      // The pack writes its colours as *linear* values, and FBXLoader reads them as sRGB and converts
      // them again, which darkens every crop (a lettuce came out near black). Reading the colour back as
      // sRGB recovers the numbers the file holds, which are the linear colour a vertex colour wants.
      const material = materials[group.materialIndex ?? 0] ?? materials[0];
      const linear = { r: 0, g: 0, b: 0 };
      material.color.getRGB(linear, SRGBColorSpace);
      const override = tint[material.name];
      if (override !== undefined) [linear.r, linear.g, linear.b] = override;
      for (let index = group.start; index < Math.min(count, group.start + group.count); index += 1) {
        colors.set([linear.r, linear.g, linear.b], index * 3);
      }
    }
    geometry.clearGroups();
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    parts.push(geometry);
  });
  const single = mergeGeometries(parts, false);
  if (single === null) throw new Error("could not merge the model's parts");
  const layout = CLUMP_LAYOUTS[clump];
  if (layout === undefined) throw new Error(`no clump layout for ${String(clump)} plants`);
  const copies = layout.map(([x, z, yaw]) =>
    single.clone().applyMatrix4(new Matrix4().makeRotationY(yaw + turn).premultiply(new Matrix4().makeTranslation(x, 0, z)))
  );
  const joined = copies.length === 1 ? single : mergeGeometries(copies, false);
  if (joined === null) throw new Error("could not merge the clump");
  const merged = mergeVertices(joined);
  const group = new Group();
  group.add(new Mesh(merged, new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.02 })));
  return group;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/**
 * Places a model on the ground and scales it so its largest dimension is one world unit - or, when
 * `fixedScale` is given, by that factor instead (the crop stages share their mature stage's scale).
 */
function normalize(root, fixedScale) {
  // FBX arrives with Phong materials, which the exporter only converts with a warning and which
  // would not match the flat stylized shading of the rest of the world. Each one is replaced by the
  // standard material that keeps its colour and its texture.
  const toStandard = (material) =>
    Object.assign(new MeshStandardMaterial({
      color: material.color ?? 0xffffff,
      ...(material.map === null || material.map === undefined ? {} : { map: material.map }),
      roughness: 0.85,
      metalness: 0.02
    }), { name: material.name });
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    // A mesh may carry one material per geometry group (a plant's leaves, fruit and stem in one mesh);
    // each keeps its own colour rather than all of them taking the first one's.
    child.material = Array.isArray(child.material) ? child.material.map(toStandard) : toStandard(child.material);
  });
  root.updateMatrixWorld(true);

  /**
   * Flatten the model into meshes whose geometry is already in world space.
   *
   * FBXLoader hands back a hierarchy whose matrices it does not rebuild, and the glTF exporter reads
   * matrices rather than transforms - so a normalization written onto a node was silently dropped and
   * every building shipped at the FBX's own centimetre scale. Baking each mesh's world matrix into its
   * geometry removes the node transforms from the question entirely.
   */
  const flat = new Group();
  const meshes = [];
  root.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    flat.add(new Mesh(geometry, mesh.material));
  }

  const box = new Box3().setFromObject(flat);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.0001);
  const scale = fixedScale ?? 1 / largest;
  // One world unit across the largest dimension, centred on X/Z, base on y = 0. The models are the
  // pack's own orientation (Y up, +Z facing), which is the same convention the world uses.
  const normalize = new Matrix4()
    .makeTranslation(-centre.x, -box.min.y, -centre.z)
    .premultiply(new Matrix4().makeScale(scale, scale, scale));
  for (const mesh of flat.children) {
    if (mesh instanceof Mesh) mesh.geometry.applyMatrix4(normalize);
  }
  return { root: flat, scale, triangles: countTriangles(flat), size };
}

function countTriangles(root) {
  let triangles = 0;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry;
    const count = geometry.index !== null ? geometry.index.count : geometry.attributes.position.count;
    triangles += count / 3;
  });
  return Math.round(triangles);
}

function exportGlb(root) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(Buffer.from(result)),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, onlyVisible: false }
    );
  });
}

async function main() {
  const source = arg("source");
  const out = arg("out");
  const reportPath = arg("report", "tools/asset-pipeline/node/import-fbx-report.json");
  if (source === undefined || out === undefined) throw new Error("--source and --out are required");
  const setName = arg("set", "farm-buildings");
  const entries = SETS[setName];
  if (entries === undefined) throw new Error(`unknown --set ${setName}; expected one of ${Object.keys(SETS).join(", ")}`);
  const loader = new FBXLoader();
  const parse = async (name) => {
    const buffer = await readFile(join(source, `${name}.fbx`));
    return loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
  };
  /** The one-unit scale of a reference model, measured once per reference. */
  const referenceScales = new Map();
  const scaleOf = async (name) => {
    if (!referenceScales.has(name)) referenceScales.set(name, normalize(await parse(name)).scale);
    return referenceScales.get(name);
  };
  const report = [];

  for (const entry of entries) {
    const root = await parse(entry.source);
    const stats = normalize(root, entry.scaleFrom === undefined ? undefined : await scaleOf(entry.scaleFrom));
    const glb = await exportGlb(MERGED_SETS.has(setName) ? mergeToVertexColors(stats.root, entry.clump, entry.tint, entry.turn) : stats.root);
    const target = join(out, `${entry.id}.glb`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, glb);
    report.push({
      id: entry.id,
      source: `${entry.source}.fbx`,
      triangles: stats.triangles,
      bytes: glb.length,
      metres: Number(Math.max(stats.size.x, stats.size.y, stats.size.z).toFixed(3))
    });
    console.log(
      `${entry.id.padEnd(22)} ${String(stats.triangles).padStart(6)} tris  ${String(Math.round(glb.length / 1024)).padStart(5)} kB`
    );
  }

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

await main();
