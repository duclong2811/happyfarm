/**
 * Imports one character from a CC0 Kenney pack into HappyFarm's production asset folder.
 *
 * The Kenney packs ship their models as GLB with the palette **outside** the model: every character
 * names `Textures/colormap.png` as a sibling file. A `.glb` that refers to a sibling does not survive
 * Vite's per-file asset handling - the built file gets a content hash, so the relative URI the loader
 * would resolve no longer points at anything - which is the same reason the Quaternius packs are
 * converted by `import-cc0.mjs`. This tool does the one thing that needs doing here: **embeds the
 * referenced image into the binary chunk** and rewrites the GLB.
 *
 * What it deliberately does *not* do is normalise the geometry. Every other model in the project is
 * rewritten to "one unit tall, base on y = 0" because it is a static mesh; a character is a **skinned**
 * mesh, and scaling POSITION accessors without also scaling the joints and their inverse bind
 * matrices tears the skin apart. The character's size is instead a *presentation* concern: the client
 * measures the loaded model's bounding box and scales it to the world's character height (see
 * `apps/web/src/render/player-character.ts`), which is also what makes the next character easy to drop
 * in.
 *
 * Usage:
 *   node tools/asset-pipeline/node/import-kenney-character.mjs \
 *     --source "<pack>/Models/GLB format" --model character-male-a.glb \
 *     --out apps/web/src/assets/models/characters/player-farmer.glb \
 *     --report tools/asset-pipeline/node/character-import-report.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { mkdirSync } from "node:fs";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--")) throw new Error(`unexpected argument ${String(key)}`);
    args[key.slice(2)] = argv[index + 1];
  }
  return args;
}

/** Splits a GLB into its JSON and binary chunks. */
function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB: bad magic");
  if (bytes.readUInt32LE(4) !== 2) throw new Error("not a GLB 2.0 file");
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== CHUNK_JSON) throw new Error("the first chunk is not JSON");
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  let offset = 20 + jsonLength;
  let bin = Buffer.alloc(0);
  if (offset + 8 <= bytes.length) {
    const binLength = bytes.readUInt32LE(offset);
    const binType = bytes.readUInt32LE(offset + 4);
    if (binType === CHUNK_BIN) bin = bytes.subarray(offset + 8, offset + 8 + binLength);
  }
  return { json, bin };
}

/** Pads a buffer to a four-byte boundary, the way a GLB chunk must be. */
function padTo4(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

/** Writes a GLB back out: one JSON chunk, one binary chunk. */
function writeGlb(json, bin) {
  const jsonChunk = padTo4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = padTo4(bin, 0x00);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

/** The bounding box of the POSITION accessors, in the model's own units. */
function extentsOf(json) {
  const accessors = json.accessors ?? [];
  const positions = (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives.map((primitive) => accessors[primitive.attributes.POSITION]))
    .filter((accessor) => accessor?.min !== undefined && accessor?.max !== undefined);
  const min = [0, 1, 2].map((axis) => Math.min(...positions.map((accessor) => accessor.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...positions.map((accessor) => accessor.max[axis])));
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
}

function triangleCount(json) {
  const accessors = json.accessors ?? [];
  let indices = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== undefined) indices += accessors[primitive.indices]?.count ?? 0;
    }
  }
  return Math.round(indices / 3);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const model = args.model;
  const out = args.out;
  const report = args.report;
  if (source === undefined || model === undefined || out === undefined) {
    throw new Error("usage: --source <pack dir> --model <file.glb> --out <file.glb> [--report <file.json>]");
  }

  const sourcePath = join(source, model);
  const { json, bin } = readGlb(await readFile(sourcePath));

  // Every image the model names as a sibling is folded into the binary chunk. More than one would be
  // fine, but a pack that changes shape should be noticed rather than silently half-imported.
  const images = json.images ?? [];
  const external = images.filter((image) => typeof image.uri === "string");
  if (external.length === 0) throw new Error(`${model} names no external image to embed`);

  const chunks = [Buffer.from(bin)];
  let byteLength = bin.length;
  for (const image of external) {
    const uri = image.uri;
    if (!uri.toLowerCase().endsWith(".png")) throw new Error(`only PNG images are embedded, got ${uri}`);
    const png = await readFile(join(source, uri));
    // A bufferView must start on a four-byte boundary.
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0));
      byteLength += padding;
    }
    chunks.push(png);
    json.bufferViews = json.bufferViews ?? [];
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: png.length });
    byteLength += png.length;
    delete image.uri;
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = "image/png";
  }
  const embeddedBin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: embeddedBin.length }];

  const bytes = writeGlb(json, embeddedBin);
  mkdirSync(dirname(out), { recursive: true });
  await writeFile(out, bytes);

  // Read the result back: an import that cannot be re-opened is not an import.
  const check = readGlb(bytes);
  const leftovers = (check.json.images ?? []).filter((image) => image.uri !== undefined);
  if (leftovers.length > 0) throw new Error("an external image survived the rewrite");

  const extents = extentsOf(check.json);
  const summary = {
    source: { pack: "Kenney Mini Characters", model, uri: `Models/GLB format/${model}` },
    out: basename(out),
    bytes: bytes.length,
    triangles: triangleCount(check.json),
    materials: check.json.materials?.length ?? 0,
    textures: check.json.textures?.length ?? 0,
    images: (check.json.images ?? []).length,
    meshes: check.json.meshes?.length ?? 0,
    skins: (check.json.skins ?? []).map((skin) => ({ joints: skin.joints.length })),
    animations: (check.json.animations ?? []).map((animation) => animation.name),
    extents: {
      min: extents.min.map((value) => Number(value.toFixed(4))),
      max: extents.max.map((value) => Number(value.toFixed(4))),
      height: Number(extents.size[1].toFixed(4))
    }
  };
  if (report !== undefined) {
    mkdirSync(dirname(report), { recursive: true });
    await writeFile(report, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.stdout.write(
    `wrote ${summary.out}: ${summary.bytes} bytes, ${summary.triangles} triangles, ` +
      `${summary.animations.length} clips, height ${summary.extents.height}\n`
  );
}

await main();
