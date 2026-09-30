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
 *   node tools/asset-pipeline/node/import-fbx.mjs --source <dir with .fbx> --out <dir> [--report <file>]
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Mesh, Box3, Group, Matrix4, MeshStandardMaterial, Vector3 } from "three";

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

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Places a model on the ground and scales it so its largest dimension is one world unit. */
function normalize(root) {
  // FBX arrives with Phong materials, which the exporter only converts with a warning and which
  // would not match the flat stylized shading of the rest of the world. Each one is replaced by the
  // standard material that keeps its colour and its texture.
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const standard = new MeshStandardMaterial({
      color: material.color ?? 0xffffff,
      ...(material.map === null || material.map === undefined ? {} : { map: material.map }),
      roughness: 0.85,
      metalness: 0.02
    });
    child.material = standard;
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
  const scale = 1 / largest;
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
  const loader = new FBXLoader();
  const report = [];

  for (const entry of CURATED) {
    const path = join(source, `${entry.source}.fbx`);
    const buffer = await readFile(path);
    const root = loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
    const stats = normalize(root);
    const glb = await exportGlb(stats.root);
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
