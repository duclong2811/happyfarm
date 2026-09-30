/**
 * Imports a curated subset of a CC0 source pack into HappyFarm's production asset folder.
 *
 * The packs ship `.gltf` + external `.bin` + shared 2K PNGs, which cannot be dropped into a browser
 * bundle as they are: a single tree would carry two megabytes of bark normal map, and a `.gltf` that
 * refers to sibling files does not survive Vite's per-file asset handling. This tool turns one source
 * model into one self-contained `.glb`, at a size a web game can ship:
 *
 *   * only base-colour maps are kept - normal, occlusion and emissive maps are dropped, because a
 *     stylized flat-shaded world has nothing to do with a normal map;
 *   * every kept texture is box-filtered down to `--max-texture` pixels, which is the single biggest
 *     saving and has no visible cost at gameplay distance;
 *   * the model is normalized to HappyFarm's model contract: **one world unit tall, base on y = 0**,
 *     so a caller says "this tree is 3.2 metres" instead of carrying a magic scale factor;
 *   * the result is a GLB with its buffer and images embedded, so one file is one asset.
 *
 * It is deliberately dependency-free: the PNG decode/encode below is ~150 lines of Node's own `zlib`
 * rather than a native image library, because an asset import runs a handful of times and a build
 * dependency is not worth carrying for it.
 *
 * Usage:
 *   node tools/asset-pipeline/node/import-cc0.mjs --source <dir with .gltf/.bin/png> --out <dir>
 *
 * The curated list below is the whole curation decision: which models, what they are called in
 * HappyFarm, and how large their textures may be. See `docs/ASSET_LICENSES.md` for provenance.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join, basename } from "node:path";

// ---------------------------------------------------------------------------------------------
// PNG: decode, box-filter down, encode. Enough for 8-bit truecolour images, which is what the
// source packs use; anything else is rejected loudly rather than silently mangled.
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Decodes an 8-bit truecolour PNG into straight RGBA pixels. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG (bitDepth ${String(bitDepth)}, colorType ${String(colorType)})`);
      }
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    raw.copy(current, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = current[index];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`unknown PNG filter ${String(filter)}`);
      }
      current[index] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = current[source];
      pixels[target + 1] = current[source + 1];
      pixels[target + 2] = current[source + 2];
      pixels[target + 3] = channels === 4 ? current[source + 3] : 255;
    }
    current.copy(previous);
  }

  return { width, height, pixels };
}

/** Box-filters an RGBA image down so its longest side is at most `maxSize`. */
function downscale(image, maxSize) {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxSize) return image;
  const scale = maxSize / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * image.width + sx) * 4;
          r += image.pixels[index];
          g += image.pixels[index + 1];
          b += image.pixels[index + 2];
          a += image.pixels[index + 3];
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      pixels[target] = Math.round(r / count);
      pixels[target + 1] = Math.round(g / count);
      pixels[target + 2] = Math.round(b / count);
      pixels[target + 3] = Math.round(a / count);
    }
  }

  return { width, height, pixels };
}

function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------------------------------------
// glTF to GLB.
// ---------------------------------------------------------------------------------------------

/** Which glTF properties name a texture slot that is worth keeping. */
const KEPT_SLOTS = ["baseColorTexture"];
/**
 * Texture slots to drop, and where each one lives.
 *
 * The split matters and was a real bug: `metallicRoughnessTexture` is nested inside
 * `pbrMetallicRoughness` while the rest sit on the material, so a single `delete material[slot]` pass
 * removed three of the four and left the occlusion-roughness-metalness map's *index* behind. That
 * index survived into the exported GLB pointing at a texture that no longer existed, and the model
 * failed to load at all - visible only for a pack that ships ORM maps, which the first two packs did
 * not.
 */
const DROPPED_MATERIAL_SLOTS = ["normalTexture", "occlusionTexture", "emissiveTexture"];
const DROPPED_PBR_SLOTS = ["metallicRoughnessTexture"];

async function convertModel(spec, sourceDir, outDir, textureCache, maxTexture, report, textureDir = null) {
  const gltfPath = join(sourceDir, `${spec.source}.gltf`);
  const gltf = JSON.parse(await readFile(gltfPath, "utf8"));
  const binPath = join(sourceDir, gltf.buffers[0].uri);
  const bin = await readFile(binPath);

  /**
   * Where an image URI actually lives.
   *
   * Some packs keep every `.gltf` in one folder and every shared PNG in another, and the glTF points
   * at the PNG by bare filename. The pack's own layout is authoritative, so the lookup is "beside the
   * model first, then in the pack's texture folder" rather than a copied tree in a temporary
   * directory that nobody can review.
   */
  function resolveImage(uri) {
    const beside = join(sourceDir, uri);
    if (existsSync(beside)) return beside;
    if (textureDir !== null) {
      const inTextureDir = join(textureDir, basename(uri));
      if (existsSync(inTextureDir)) return inTextureDir;
    }
    return beside;
  }

  // Keep only the base-colour images this model actually uses, and remap every reference to them.
  const keptImages = new Map();
  const newImages = [];
  const newTextures = [];
  const textureRemap = new Map();

  for (const material of gltf.materials ?? []) {
    for (const slot of DROPPED_MATERIAL_SLOTS) delete material[slot];
    const pbr = material.pbrMetallicRoughness ?? {};
    for (const slot of DROPPED_PBR_SLOTS) delete pbr[slot];
    // With the ORM map gone, glTF's own default of a fully metallic surface would render the model
    // black in a scene with no environment map. The art direction is flat stylized, so the props are
    // dielectric and rough: the same surface the world's own materials use.
    pbr.metallicFactor = 0;
    if (pbr.roughnessFactor === undefined) pbr.roughnessFactor = 0.9;
    const base = pbr.baseColorTexture;
    const oldTextureIndex = base?.index;
    if (oldTextureIndex === undefined) {
      // No base-colour map: the model's own factors are all it has, which is fine for a stylized prop.
      if (base !== undefined) delete pbr.baseColorTexture;
      material.pbrMetallicRoughness = pbr;
      continue;
    }
    const source = gltf.textures[oldTextureIndex].source;
    const uri = gltf.images[source].uri;
    if (!keptImages.has(uri)) {
      const bytes = await convertTexture(resolveImage(uri), textureCache, maxTexture);
      keptImages.set(uri, { uri, bytes });
    }
    const entry = keptImages.get(uri);
    let newIndex = newImages.findIndex((image) => image.uri === entry.uri);
    if (newIndex === -1) {
      newIndex = newImages.length;
      newImages.push({ uri: entry.uri, bytes: entry.bytes });
    }
    let textureIndex = textureRemap.get(oldTextureIndex);
    if (textureIndex === undefined) {
      textureIndex = newTextures.length;
      newTextures.push({
        source: newIndex,
        ...(gltf.textures[oldTextureIndex].sampler === undefined ? {} : { sampler: 0 })
      });
      textureRemap.set(oldTextureIndex, textureIndex);
    }
    pbr.baseColorTexture = { index: textureIndex };
    // A masked material with a texture is a cutout leaf; without the mask the quad would be solid.
    if (material.alphaMode === undefined) material.alphaMode = "OPAQUE";
    material.pbrMetallicRoughness = pbr;
  }

  // The buffer: the model's own bytes first, then each kept image, four-byte aligned.
  const parts = [bin];
  let offset = bin.length;
  const imageBufferViews = [];
  for (const image of newImages) {
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    imageBufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.bytes.length });
    parts.push(image.bytes);
    offset += image.bytes.length;
  }
  const packed = Buffer.concat(parts);

  gltf.buffers = [{ byteLength: packed.length }];
  gltf.bufferViews = [...(gltf.bufferViews ?? []), ...imageBufferViews];
  gltf.images = newImages.map((image, index) => ({
    bufferView: (gltf.bufferViews.length - newImages.length) + index,
    mimeType: "image/png",
    name: basename(image.uri)
  }));
  gltf.textures = newTextures;
  gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];

  // Normalize to HappyFarm's model contract: **one world unit across its largest dimension**, base on
  // y = 0, centred on X/Z.
  //
  // The largest dimension rather than the height, because half of what a nature pack ships is flat:
  // a flower is a hand's width tall and a metre wide, and dividing by its height would turn it into a
  // six-metre-wide fan. Normalizing by the biggest extent means `scale` is "how big is this thing",
  // which is the question a placement is actually asking.
  const positions = (gltf.meshes ?? [])
    .flatMap((mesh) => mesh.primitives.map((primitive) => gltf.accessors[primitive.attributes.POSITION]))
    .filter((accessor) => accessor?.min !== undefined);
  const minY = Math.min(...positions.map((accessor) => accessor.min[1]));
  const maxY = Math.max(...positions.map((accessor) => accessor.max[1]));
  const extentX = Math.max(...positions.map((accessor) => accessor.max[0])) - Math.min(...positions.map((accessor) => accessor.min[0]));
  const extentY = maxY - minY;
  const extentZ = Math.max(...positions.map((accessor) => accessor.max[2])) - Math.min(...positions.map((accessor) => accessor.min[2]));
  const size = Math.max(extentX, extentY, extentZ, 0.0001);
  const scale = 1 / size;
  const root = gltf.nodes[0] ?? { name: spec.id };
  const rootIndex = gltf.nodes.indexOf(root);
  root.scale = [scale, scale, scale];
  root.translation = [-((Math.min(...positions.map((a) => a.min[0])) + Math.max(...positions.map((a) => a.max[0]))) / 2) * scale, -minY * scale, -((Math.min(...positions.map((a) => a.min[2])) + Math.max(...positions.map((a) => a.max[2]))) / 2) * scale];
  if (!gltf.scenes) gltf.scenes = [{ nodes: [rootIndex] }];

  delete gltf.asset.generator;
  gltf.asset.generator = `HappyFarm asset pipeline (from ${spec.source}.gltf, CC0)`;

  const glb = packGlb(gltf, packed);
  const outPath = join(outDir, spec.category, `${spec.id}.glb`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, glb);

  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== undefined) triangles += gltf.accessors[primitive.indices].count / 3;
    }
  }
  report.push({
    id: spec.id,
    category: spec.category,
    source: spec.source,
    triangles,
    bytes: glb.length,
    textures: [...keptImages.keys()],
    materials: gltf.materials?.length ?? 0
  });
}

async function convertTexture(path, cache, maxTexture) {
  if (cache.has(path)) return cache.get(path);
  const decoded = decodePng(await readFile(path));
  const bytes = encodePng(downscale(decoded, maxTexture));
  cache.set(path, bytes);
  return bytes;
}

function packGlb(json, bin) {
  const jsonText = JSON.stringify(json);
  const jsonBytes = Buffer.from(jsonText, "utf8");
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

// ---------------------------------------------------------------------------------------------
// The curation.
// ---------------------------------------------------------------------------------------------

/**
 * Quaternius Stylized Nature MegaKit, chosen for silhouette variety rather than for count.
 *
 * The pack has 68 models; these are the ones whose shape reads at gameplay distance and whose
 * triangle count is affordable when a hundred of them stand in one forest. The heaviest trees in the
 * pack (the twisted ones, at ten thousand triangles) are deliberately absent.
 */
const NATURE = [
  { id: "tree_broad_1", source: "CommonTree_5", category: "environment" },
  { id: "tree_broad_2", source: "CommonTree_3", category: "environment" },
  { id: "tree_broad_3", source: "CommonTree_4", category: "environment" },
  { id: "tree_broad_4", source: "CommonTree_2", category: "environment" },
  { id: "tree_pine_1", source: "Pine_5", category: "environment" },
  { id: "tree_pine_2", source: "Pine_4", category: "environment" },
  { id: "tree_pine_3", source: "Pine_2", category: "environment" },
  { id: "bush_leafy", source: "Bush_Common", category: "environment" },
  { id: "bush_flowering", source: "Bush_Common_Flowers", category: "environment" },
  { id: "rock_boulder_1", source: "Rock_Medium_1", category: "environment" },
  { id: "rock_boulder_2", source: "Rock_Medium_2", category: "environment" },
  { id: "rock_boulder_3", source: "Rock_Medium_3", category: "environment" },
  { id: "plant_fern", source: "Fern_1", category: "environment" },
  { id: "plant_grass_tall", source: "Grass_Common_Tall", category: "environment" },
  { id: "plant_grass_wispy", source: "Grass_Wispy_Tall", category: "environment" },
  { id: "plant_clover", source: "Clover_2", category: "environment" },
  { id: "flower_group_1", source: "Flower_3_Group", category: "environment" },
  { id: "flower_group_2", source: "Flower_4_Group", category: "environment" }
];

/**
 * Quaternius Medieval Village MegaKit: the pieces that are farm props rather than medieval
 * architecture. No walls, no roofs, no towers - the pack is a modular kit and assembling its
 * buildings is a modelling job of its own, well beyond replacing a prop.
 */
const PROPS = [
  { id: "prop_crate", source: "Prop_Crate", category: "props" },
  { id: "prop_wagon", source: "Prop_Wagon", category: "props" },
  { id: "prop_fence_rail", source: "Prop_WoodenFence_Single", category: "props" },
  { id: "prop_fence_rail_long", source: "Prop_WoodenFence_Extension1", category: "props" }
];

/**
 * Quaternius Fantasy Props MegaKit (Standard, CC0): the working vocabulary of the estate.
 *
 * The pack has ninety-odd models and most of them are interiors - books, candles, potions, tableware
 * - which no estate camera will ever see. What is left is a small set of objects that each say what
 * a place *is*: a barrel and a crate are a yard, a stall is a market, a rope and a bucket are a quay,
 * a log and an axe are a timber yard. Twenty of them, repeated intelligently, dress five
 * compositions; twenty more would be a bundle cost and a busier map.
 */
const FANTASY_PROPS = [
  { id: "prop_barrel", source: "Barrel", category: "props" },
  { id: "prop_barrel_apples", source: "Barrel_Apples", category: "props" },
  { id: "prop_crate_wooden", source: "Crate_Wooden", category: "props" },
  { id: "prop_crate_produce", source: "FarmCrate_Apple", category: "props" },
  { id: "prop_crate_carrot", source: "FarmCrate_Carrot", category: "props" },
  { id: "prop_crate_empty", source: "FarmCrate_Empty", category: "props" },
  { id: "prop_sack", source: "Bag", category: "props" },
  { id: "prop_bucket", source: "Bucket_Wooden_1", category: "props" },
  { id: "prop_bench", source: "Bench", category: "props" },
  { id: "prop_stall", source: "Stall_Empty", category: "props" },
  { id: "prop_stall_cart", source: "Stall_Cart_Empty", category: "props" },
  { id: "prop_rope", source: "Rope_1", category: "props" },
  { id: "prop_lantern", source: "Lantern_Wall", category: "props" },
  { id: "prop_planter", source: "Pot_1", category: "props" },
  { id: "prop_axe", source: "Axe_Bronze", category: "props" },
  { id: "prop_anvil_log", source: "Anvil_Log", category: "props" },
  { id: "prop_workbench", source: "Workbench", category: "props" },
  { id: "prop_chest", source: "Chest_Wood", category: "props" },
  { id: "prop_cage_small", source: "Cage_Small", category: "props" },
  { id: "prop_whetstone", source: "Whetstone", category: "props" }
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const maxTexture = Number(arg("max-texture", "256"));
  const outDir = arg("out", "apps/web/src/assets/models");
  // `--source` is the one-directory form: a pack that ships both families, or a quick run against a
  // single extracted pack. Pointing at a directory is what decides whether its models are converted,
  // so a developer who has one pack does not silently rewrite the provenance of the others.
  const natureDir = arg("nature", arg("source", null));
  const villageDir = arg("village", arg("source", null));
  const fantasyDir = arg("fantasy", null);
  const fantasyTextures = arg("fantasy-textures", null);
  const reportPath = arg("report", "tools/asset-pipeline/node/import-report.json");
  const report = [];
  const textureCache = new Map();

  // A pack that is not pointed at is *skipped*, not reported as missing: the report is the record of
  // what shipped, and a developer converting one pack must not erase the provenance of the rest.
  if (natureDir !== null) {
    for (const spec of NATURE) {
      await convertModel(spec, natureDir, outDir, textureCache, maxTexture, report);
    }
  }
  if (villageDir !== null) {
    for (const spec of PROPS) {
      if (existsSync(join(villageDir, `${spec.source}.gltf`))) {
        await convertModel(spec, villageDir, outDir, textureCache, maxTexture, report);
      } else {
        report.push({ id: spec.id, category: spec.category, source: spec.source, missing: true });
      }
    }
  }
  // Only runs when the pack is pointed at, so a developer without the download still gets the
  // models the repository already ships and a report that says exactly what was skipped.
  if (fantasyDir !== null) {
    for (const spec of FANTASY_PROPS) {
      if (existsSync(join(fantasyDir, `${spec.source}.gltf`))) {
        await convertModel(spec, fantasyDir, outDir, textureCache, maxTexture, report, fantasyTextures);
      } else {
        report.push({ id: spec.id, category: spec.category, source: spec.source, missing: true });
      }
    }
  }

  const previous = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : [];
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of report) byId.set(entry.id, entry);
  const merged = [...byId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));

  await writeFile(reportPath, `${JSON.stringify(merged, null, 2)}\n`);
  const total = merged.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  const triangles = merged.reduce((sum, entry) => sum + (entry.triangles ?? 0), 0);
  console.log(`${merged.length} models, ${(total / 1024 / 1024).toFixed(2)} MB, ${Math.round(triangles)} triangles`);
  for (const entry of report) {
    console.log(`  ${entry.id.padEnd(20)} ${String(Math.round(entry.triangles ?? 0)).padStart(6)} tris  ${String(Math.round((entry.bytes ?? 0) / 1024)).padStart(5)} kB  ${(entry.textures ?? []).join(",")}`);
  }
}

await main();
