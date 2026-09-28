#!/usr/bin/env node
/**
 * Writes the placeholder crop models as glTF 2.0 binary (.glb) files.
 *
 * The point of committing a generator instead of three unexplained binaries is reviewability: the
 * geometry, the colours, and the authoring contract are all readable here, and rerunning this file
 * reproduces the artifacts byte for byte. Real art replaces these files by name; it does not have to
 * change any code.
 *
 * Authoring contract every shipped model must satisfy, asserted in
 * `tests/integration/crop-model-assets.test.ts`:
 *
 *   - one world unit tall, with the base sitting exactly on y = 0
 *   - footprint inside a 1 x 1 square centred on the origin, so a model cannot overhang its tile
 *   - non-indexed triangle soup, one primitive per material, POSITION and NORMAL only
 *
 * Run with: npm run assets:generate --workspace @happy-farm/web
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "models");

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

// Geometry helpers. Each part collects a triangle soup, so a part needs no index buffer and turns
// into one glTF primitive with two accessors.

function triangle(part, a, b, c) {
  part.triangles.push(a, b, c);
}

function quad(part, a, b, c, d) {
  triangle(part, a, b, c);
  triangle(part, a, c, d);
}

/** An axis-aligned box whose base sits at `y`, centred on `x` and `z` in the other two axes. */
function box(part, { x, y, z }, { width, depth, height }) {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y;
  const y1 = y + height;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  const low = [x0, y0, z0];
  const lowX = [x1, y0, z0];
  const lowXZ = [x1, y0, z1];
  const lowZ = [x0, y0, z1];
  const high = [x0, y1, z0];
  const highX = [x1, y1, z0];
  const highXZ = [x1, y1, z1];
  const highZ = [x0, y1, z1];
  quad(part, lowZ, lowXZ, highXZ, highZ); // +Z
  quad(part, lowX, low, high, highX); // -Z
  quad(part, lowXZ, lowX, highX, highXZ); // +X
  quad(part, low, lowZ, highZ, high); // -X
  quad(part, high, highZ, highXZ, highX); // +Y
  quad(part, low, lowX, lowXZ, lowZ); // -Y
}

/** A cone standing on `baseY` with its tip at `apexY`, so it points up or down between the two. */
function cone(part, { x = 0, z = 0, baseY, apexY, radius, segments = 8 }) {
  const ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    ring.push([x + Math.cos(angle) * radius, baseY, z + Math.sin(angle) * radius]);
  }
  const apex = [x, apexY, z];
  const centre = [x, baseY, z];
  for (let index = 0; index < segments; index += 1) {
    const next = ring[(index + 1) % segments];
    const current = ring[index];
    // Wound so that both the side and the cap face away from the axis.
    triangle(part, next, current, apex);
    triangle(part, current, next, centre);
  }
}

function part(name, colour) {
  return { name, colour, triangles: [] };
}

/** sRGB to linear, which is the space glTF baseColorFactor is defined in. */
function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearColour(hex) {
  return [
    srgbToLinear((hex >> 16) & 0xff),
    srgbToLinear((hex >> 8) & 0xff),
    srgbToLinear(hex & 0xff),
    1
  ];
}

function buildModels() {
  const carrotRoot = part("root", 0xe07a3a);
  cone(carrotRoot, { baseY: 0.7, apexY: 0, radius: 0.15, segments: 8 });
  const carrotTops = part("tops", 0x4f9b3f);
  box(carrotTops, { x: 0, y: 0.62, z: 0 }, { width: 0.05, depth: 0.05, height: 0.38 });
  box(carrotTops, { x: 0.07, y: 0.6, z: 0.03 }, { width: 0.04, depth: 0.04, height: 0.32 });
  box(carrotTops, { x: -0.07, y: 0.6, z: -0.03 }, { width: 0.04, depth: 0.04, height: 0.32 });

  const wheatStalk = part("stalk", 0xc8a94a);
  box(wheatStalk, { x: 0, y: 0, z: 0 }, { width: 0.04, depth: 0.04, height: 0.86 });
  const wheatGrain = part("grain", 0xe4cd72);
  for (let index = 0; index < 6; index += 1) {
    box(
      wheatGrain,
      { x: index % 2 === 0 ? 0.05 : -0.05, y: 0.65 + index * 0.05, z: 0 },
      { width: 0.07, depth: 0.07, height: 0.1 }
    );
  }

  const cornStalk = part("stalk", 0x5d9c46);
  box(cornStalk, { x: 0, y: 0, z: 0 }, { width: 0.07, depth: 0.07, height: 1 });
  box(cornStalk, { x: 0.17, y: 0.42, z: 0 }, { width: 0.3, depth: 0.1, height: 0.02 });
  box(cornStalk, { x: -0.17, y: 0.56, z: 0 }, { width: 0.3, depth: 0.1, height: 0.02 });
  const cornCob = part("cob", 0xe8c34a);
  box(cornCob, { x: 0.09, y: 0.6, z: 0 }, { width: 0.1, depth: 0.1, height: 0.24 });

  return [
    { id: "crop_carrot", parts: [carrotRoot, carrotTops] },
    { id: "crop_wheat", parts: [wheatStalk, wheatGrain] },
    { id: "crop_corn", parts: [cornStalk, cornCob] }
  ];
}

/**
 * Flat-shaded normals: one normal per vertex, taken from its own triangle's face normal, which is
 * what a low-poly placeholder wants and what makes the winding above visible.
 */
function buildAccessors(parts) {
  const accessors = [];
  const bufferViews = [];
  const chunks = [];
  let offset = 0;

  for (const current of parts) {
    const vertexCount = current.triangles.length;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    for (let base = 0; base < vertexCount; base += 3) {
      const a = current.triangles[base];
      const b = current.triangles[base + 1];
      const c = current.triangles[base + 2];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ];
      const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
      for (let corner = 0; corner < 3; corner += 1) {
        const source = current.triangles[base + corner];
        const target = (base + corner) * 3;
        positions[target] = source[0];
        positions[target + 1] = source[1];
        positions[target + 2] = source[2];
        normals[target] = normal[0] / length;
        normals[target + 1] = normal[1] / length;
        normals[target + 2] = normal[2] / length;
      }
    }

    const positionMin = [Infinity, Infinity, Infinity];
    const positionMax = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[index + axis];
        positionMin[axis] = Math.min(positionMin[axis], value);
        positionMax[axis] = Math.max(positionMax[axis], value);
      }
    }

    const positionView = bufferViews.length;
    const positionChunk = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: positionChunk.length, target: ARRAY_BUFFER });
    chunks.push(positionChunk);
    offset += positionChunk.length;
    accessors.push({
      bufferView: positionView,
      componentType: FLOAT,
      count: vertexCount,
      type: "VEC3",
      min: positionMin,
      max: positionMax
    });

    const normalView = bufferViews.length;
    const normalChunk = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: normalChunk.length, target: ARRAY_BUFFER });
    chunks.push(normalChunk);
    offset += normalChunk.length;
    accessors.push({ bufferView: normalView, componentType: FLOAT, count: vertexCount, type: "VEC3" });
  }

  const triangles = parts.reduce((total, current) => total + current.triangles.length / 3, 0);
  return { accessors, bufferViews, binary: Buffer.concat(chunks), triangles };
}

function buildGlb(name, parts) {
  const { accessors, bufferViews, binary, triangles } = buildAccessors(parts);

  const json = {
    asset: { version: "2.0", generator: "happy-farm placeholder model generator" },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: parts.map((current, index) => ({
          attributes: { POSITION: index * 2, NORMAL: index * 2 + 1 },
          material: index,
          mode: 4
        }))
      }
    ],
    materials: parts.map((current) => ({
      name: `${name}_${current.name}`,
      pbrMetallicRoughness: {
        baseColorFactor: linearColour(current.colour),
        metallicFactor: 0,
        roughnessFactor: 0.85
      }
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }]
  };

  const jsonChunk = padToFour(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binaryChunk = padToFour(binary, 0);
  const total = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(CHUNK_BIN, 4);

  return { glb: Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]), triangles };
}

function padToFour(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const model of buildModels()) {
  const { glb, triangles } = buildGlb(model.id, model.parts);
  writeFileSync(join(OUTPUT_DIR, `${model.id}.glb`), glb);
  process.stdout.write(
    `${model.id}.glb  ${glb.length} bytes  ${triangles} triangles  ${model.parts.length} materials\n`
  );
}
