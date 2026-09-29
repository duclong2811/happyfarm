/**
 * Geometry helpers and a glTF 2.0 binary writer for HappyFarm's procedural models.
 *
 * Written for reviewability: a model is a list of named parts, each a triangle soup built from the
 * helpers below, and the writer turns that into the narrow GLB subset the repository ships (see
 * `docs/HAPPYFARM_ART_BIBLE.md`, section 7). Rerunning a generator with the same specs reproduces
 * the same bytes.
 *
 * The same file also reads a GLB back, so `validate.mjs` can hold a shipped artifact to the contract
 * without trusting the writer that produced it.
 */

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

/** A part is one material's worth of triangles: one glTF primitive. */
export function part(name, colour) {
  return { name, colour, triangles: [] };
}

function triangle(target, a, b, c) {
  target.triangles.push(a, b, c);
}

function quad(target, a, b, c, d) {
  triangle(target, a, b, c);
  triangle(target, a, c, d);
}

/** Deterministic pseudo-random source: the same seed always yields the same variation. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** An axis-aligned box whose base sits at `y`, centred on `x` and `z`. */
export function softBox(target, { x = 0, y = 0, z = 0 }, { width, depth, height }) {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y;
  const y1 = y + height;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  quad(target, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad(target, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  quad(target, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  quad(target, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  quad(target, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  quad(target, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
}

/**
 * A box tapering from a bottom rectangle to a smaller top one.
 *
 * This is the cheap way this project softens a hard edge: the whole form narrows instead of the
 * silhouette carrying a chamfer a player cannot see at gameplay distance.
 */
export function taperedBox(target, { x = 0, y = 0, z = 0 }, { width, depth, height, topScale = 0.8, topOffsetX = 0, topOffsetZ = 0 }) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const topHalfWidth = halfWidth * topScale;
  const topHalfDepth = halfDepth * topScale;
  const bottom = [[x - halfWidth, y, z - halfDepth], [x + halfWidth, y, z - halfDepth], [x + halfWidth, y, z + halfDepth], [x - halfWidth, y, z + halfDepth]];
  const top = [
    [x + topOffsetX - topHalfWidth, y + height, z + topOffsetZ - topHalfDepth],
    [x + topOffsetX + topHalfWidth, y + height, z + topOffsetZ - topHalfDepth],
    [x + topOffsetX + topHalfWidth, y + height, z + topOffsetZ + topHalfDepth],
    [x + topOffsetX - topHalfWidth, y + height, z + topOffsetZ + topHalfDepth]
  ];
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    quad(target, bottom[index], bottom[next], top[next], top[index]);
  }
  quad(target, top[0], top[1], top[2], top[3]);
  quad(target, bottom[0], bottom[3], bottom[2], bottom[1]);
}

/** A tapered cylinder: trunks, stalks, silos, limbs. `lean` tilts the top ring deterministically. */
export function taperedCylinder(target, { x = 0, y = 0, z = 0 }, { bottomRadius, topRadius, height, segments = 8, leanX = 0, leanZ = 0 }) {
  const ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    ring.push([Math.cos(angle), Math.sin(angle)]);
  }
  const bottom = ring.map(([cos, sin]) => [x + cos * bottomRadius, y, z + sin * bottomRadius]);
  const top = ring.map(([cos, sin]) => [x + leanX + cos * topRadius, y + height, z + leanZ + sin * topRadius]);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    quad(target, bottom[index], bottom[next], top[next], top[index]);
  }
  const bottomCentre = [x, y, z];
  const topCentre = [x + leanX, y + height, z + leanZ];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    triangle(target, bottom[next], bottom[index], bottomCentre);
    triangle(target, top[index], top[next], topCentre);
  }
}

/**
 * A low-poly blob: the canopy mass of a tree, a bush, or a stone.
 *
 * Built from latitude rings so the silhouette is round enough to read as foliage while the facets
 * stay flat-shaded and cheap.
 */
export function lowPolyBlob(target, { x = 0, y = 0, z = 0 }, { radiusX, radiusY, radiusZ, segments = 7, rings = 3, squashY = 1 }) {
  const points = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const polar = (ring / rings) * Math.PI;
    const ringRadius = Math.sin(polar);
    const height = Math.cos(polar);
    const row = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      row.push([
        x + Math.cos(angle) * ringRadius * radiusX,
        y + (height * radiusY + radiusY) * squashY,
        z + Math.sin(angle) * ringRadius * radiusZ
      ]);
    }
    points.push(row);
  }
  for (let ring = 0; ring < rings; ring += 1) {
    const below = points[ring];
    const above = points[ring + 1];
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      if (ring === 0) {
        // The top ring is a single point, so this band is a fan of triangles, not quads: a quad
        // against a collapsed ring would ship zero-area triangles with no usable normal.
        triangle(target, above[next], above[index], below[index]);
        continue;
      }
      if (ring === rings - 1) {
        triangle(target, below[index], below[next], above[index]);
        continue;
      }
      triangle(target, above[next], above[index], below[index]);
      triangle(target, above[next], below[index], below[next]);
    }
  }
}

/** A fruit: a small faceted ball, deliberately octahedral so it reads as produce, not as a sphere. */
export function fruit(target, { x, y, z }, radius) {
  const top = [x, y + radius, z];
  const bottom = [x, y - radius, z];
  const ring = [
    [x + radius, y, z],
    [x, y, z + radius],
    [x - radius, y, z],
    [x, y, z - radius]
  ];
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    triangle(target, ring[index], ring[next], top);
    triangle(target, ring[next], ring[index], bottom);
  }
}

/** A cluster of fruit around a canopy point: decorative, never a reward quantity. */
export function fruitCluster(target, { x, y, z }, { count, radius, spread, seed }) {
  const random = seededRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = spread * (0.4 + random() * 0.6);
    fruit(
      target,
      {
        x: x + Math.cos(angle) * distance,
        y: y + (random() - 0.5) * spread * 0.8,
        z: z + Math.sin(angle) * distance
      },
      radius * (0.8 + random() * 0.35)
    );
  }
}

/**
 * A leaf blade: a folded ribbon, the cheapest shape that still reads as a leaf from above.
 *
 * `yaw` and `tilt` are in radians; the blade grows out of `x, y, z` and along its own axis.
 */
export function leafBlade(target, { x, y, z }, { length, width, yaw, tilt, droop = 0.25 }) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const point = (along, side, drop) => {
    const localX = side;
    const localY = along * sinTilt - drop * cosTilt;
    const localZ = along * cosTilt + drop * sinTilt;
    return [x + localX * cos - localZ * sin, y + localY, z + localX * sin + localZ * cos];
  };
  const base = point(0, 0, 0);
  const left = point(length * 0.45, -width, 0);
  const right = point(length * 0.45, width, 0);
  const tip = point(length, 0, -length * droop);
  triangle(target, base, left, tip);
  triangle(target, base, tip, right);
  triangle(target, base, tip, left);
  triangle(target, base, right, tip);
}

/** A gable roof: two slopes and two gable ends, with an overhang past the walls. */
export function gableRoof(target, { x = 0, y = 0, z = 0 }, { width, depth, height, overhang = 0.12, thickness = 0.1 }) {
  const halfWidth = width / 2 + overhang;
  const halfDepth = depth / 2 + overhang;
  const ridgeY = y + height;
  const eaveY = y;
  const ridgeFront = [x, ridgeY, z + halfDepth];
  const ridgeBack = [x, ridgeY, z - halfDepth];
  const eaveLeftFront = [x - halfWidth, eaveY, z + halfDepth];
  const eaveRightFront = [x + halfWidth, eaveY, z + halfDepth];
  const eaveLeftBack = [x - halfWidth, eaveY, z - halfDepth];
  const eaveRightBack = [x + halfWidth, eaveY, z - halfDepth];
  // Two slopes, each closed into a slab so the roof reads as a solid from below as well.
  const slab = (a, b, c, d) => {
    quad(target, a, b, c, d);
    quad(target, [a[0], a[1] - thickness, a[2]], [b[0], b[1] - thickness, b[2]], [c[0], c[1] - thickness, c[2]], [d[0], d[1] - thickness, d[2]]);
  };
  slab(eaveLeftFront, ridgeFront, eaveRightFront, [x, eaveY - thickness * 0.2, z + halfDepth]);
  slab(eaveRightBack, ridgeBack, eaveLeftBack, [x, eaveY - thickness * 0.2, z - halfDepth]);
  quad(target, eaveLeftFront, eaveLeftBack, ridgeBack, ridgeFront);
  quad(target, eaveRightBack, eaveRightFront, ridgeFront, ridgeBack);
}

/** sRGB to linear, the space glTF baseColorFactor is defined in. */
function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearColour(hex) {
  return [srgbToLinear((hex >> 16) & 0xff), srgbToLinear((hex >> 8) & 0xff), srgbToLinear(hex & 0xff), 1];
}

function padToFour(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

/** Flat-shaded accessors: one normal per vertex, taken from its own triangle's face. */
function buildAccessors(parts) {
  const accessors = [];
  const bufferViews = [];
  const chunks = [];
  let offset = 0;

  for (const current of parts) {
    // Degenerate triangles carry no area and therefore no usable normal; a model that ships one is
    // a model the renderer would light as black. Dropping them here makes that impossible.
    current.triangles = current.triangles.filter((_, index, all) => {
      if (index % 3 !== 0) return true;
      const a = all[index];
      const b = all[index + 1];
      const c = all[index + 2];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ];
      return Math.hypot(cross[0], cross[1], cross[2]) > 1e-9;
    });
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

/** Builds one GLB from named parts. */
export function buildGlb(id, parts) {
  const { accessors, bufferViews, binary, triangles } = buildAccessors(parts);

  const json = {
    asset: { version: "2.0", generator: "happy-farm procedural asset pipeline" },
    scene: 0,
    scenes: [{ name: id, nodes: [0] }],
    nodes: [{ name: id, mesh: 0 }],
    meshes: [
      {
        name: id,
        primitives: parts.map((current, index) => ({
          attributes: { POSITION: index * 2, NORMAL: index * 2 + 1 },
          material: index,
          mode: 4
        }))
      }
    ],
    materials: parts.map((current) => ({
      name: `${id}_${current.name}`,
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

/** Reads a GLB back and measures it, so validation never trusts the writer. */
export function measureGlb(bytes) {
  const file = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = file.getUint32(0, true);
  const version = file.getUint32(4, true);
  const length = file.getUint32(8, true);
  const jsonLength = file.getUint32(12, true);
  const jsonType = file.getUint32(16, true);
  const jsonStart = 20;
  const binaryHeader = jsonStart + jsonLength;
  const binaryLength = file.getUint32(binaryHeader, true);
  const binaryType = file.getUint32(binaryHeader + 4, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, binaryHeader)));
  const binary = new DataView(bytes.buffer, bytes.byteOffset + binaryHeader + 8, binaryLength);

  let triangles = 0;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      triangles += accessor.count / 3;
      const view = json.bufferViews[accessor.bufferView];
      for (let index = 0; index < accessor.count; index += 1) {
        const offset = view.byteOffset + index * 12;
        for (let axis = 0; axis < 3; axis += 1) {
          const value = binary.getFloat32(offset + axis * 4, true);
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    }
  }

  return {
    magic,
    version,
    declaredLength: length,
    byteLength: bytes.byteLength,
    jsonChunkType: jsonType,
    binaryChunkType: binaryType,
    meshes: (json.meshes ?? []).length,
    primitives: (json.meshes ?? []).reduce((total, mesh) => total + (mesh.primitives ?? []).length, 0),
    materials: (json.materials ?? []).length,
    textures: (json.textures ?? []).length,
    images: (json.images ?? []).length,
    triangles,
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  };
}
