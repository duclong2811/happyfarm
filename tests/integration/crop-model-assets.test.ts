import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CROP_MODEL_IDS } from "../../apps/web/src/render/assets";

/**
 * Validates the shipped `.glb` artifacts rather than the code that loads them.
 *
 * A model is art, so it arrives in this repository as a binary nobody reads at review time. These
 * checks are the review: they parse the container, recompute the vertex bounds from the binary
 * chunk, and hold every model to the authoring contract the renderer scales against. A model that
 * violates the contract would otherwise fail silently in a browser, as a crop that floats, sinks,
 * or overhangs its tile.
 *
 * The contract, also stated in `apps/web/tools/generate-placeholder-models.mjs`:
 *   - one world unit tall, base on y = 0, footprint inside a 1 x 1 square centred on the origin
 *   - non-indexed triangle soup, POSITION and NORMAL only
 */

const MODEL_DIRECTORY = fileURLToPath(new URL("../../apps/web/src/assets/models/", import.meta.url));

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const CHUNK_HEADER_BYTES = 8;
const TRIANGLES = 4;

const COMPONENTS_PER_TYPE: Readonly<Record<string, number | undefined>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4
};
const COMPONENT_BYTES: Readonly<Record<number, number | undefined>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};

const FLOAT_VEC3_BYTES = 12;
const CANONICAL_HEIGHT = 1;
const MAX_HALF_FOOTPRINT = 0.5;
const CONTRACT_PRECISION = 3;
const BOUNDS_PRECISION = 6;
const MIN_TRIANGLES = 8;

type Vec3 = readonly [number, number, number];

interface GlbAccessor {
  readonly bufferView: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

interface GlbBufferView {
  readonly buffer: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

interface GlbPrimitive {
  readonly attributes: Readonly<Record<string, number | undefined>>;
  readonly mode?: number;
}

interface GlbDocument {
  readonly asset: Readonly<Record<string, unknown>>;
  readonly accessors: readonly GlbAccessor[];
  readonly bufferViews: readonly GlbBufferView[];
  readonly buffers: readonly { readonly byteLength: number }[];
  readonly meshes: readonly { readonly primitives: readonly GlbPrimitive[] }[];
}

interface ParsedModel {
  readonly document: GlbDocument;
  /** A view over the BIN chunk alone, so accessor offsets stay chunk-relative. */
  readonly binary: DataView;
}

function component(vector: readonly number[], axis: number): number {
  const value = vector[axis];
  if (value === undefined) throw new Error(`vector is missing component ${String(axis)}`);
  return value;
}

/** Parses the container by hand so the test does not depend on the loader it is validating. */
function parseGlb(fileName: string): ParsedModel {
  // Plain Uint8Array and DataView rather than Node's Buffer helpers: the Buffer these tests
  // typecheck against is the minimal one the Worker runtime declares, which has neither.
  const bytes = new Uint8Array(readFileSync(`${MODEL_DIRECTORY}${fileName}`));
  const file = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  expect(file.getUint32(0, true), `${fileName} magic`).toBe(GLB_MAGIC);
  expect(file.getUint32(4, true), `${fileName} container version`).toBe(GLB_VERSION);
  expect(file.getUint32(8, true), `${fileName} declared length`).toBe(bytes.byteLength);

  const jsonLength = file.getUint32(12, true);
  expect(file.getUint32(16, true), `${fileName} first chunk holds JSON`).toBe(CHUNK_JSON);
  expect(jsonLength % 4, `${fileName} JSON chunk alignment`).toBe(0);

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  const binaryHeader = jsonEnd;
  const binaryLength = file.getUint32(binaryHeader, true);
  expect(file.getUint32(binaryHeader + 4, true), `${fileName} second chunk holds BIN`).toBe(CHUNK_BIN);
  expect(binaryLength % 4, `${fileName} BIN chunk alignment`).toBe(0);
  expect(binaryHeader + CHUNK_HEADER_BYTES + binaryLength, `${fileName} chunks cover the file`).toBe(
    bytes.byteLength
  );

  return {
    document: JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))) as GlbDocument,
    binary: new DataView(
      bytes.buffer,
      bytes.byteOffset + binaryHeader + CHUNK_HEADER_BYTES,
      binaryLength
    )
  };
}

function accessorBytes(accessor: GlbAccessor): number {
  const components = COMPONENTS_PER_TYPE[accessor.type];
  const bytes = COMPONENT_BYTES[accessor.componentType];
  expect(components, `${accessor.type} is a known accessor type`).toBeDefined();
  expect(bytes, `component type ${String(accessor.componentType)} is known`).toBeDefined();
  return accessor.count * (components ?? 0) * (bytes ?? 0);
}

/** Reads a VEC3 float accessor out of the binary chunk. */
function readVec3(model: ParsedModel, accessor: GlbAccessor): Vec3[] {
  const view = model.document.bufferViews[accessor.bufferView];
  if (view === undefined) throw new Error("accessor points at a missing buffer view");
  const vertices: Vec3[] = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = view.byteOffset + index * FLOAT_VEC3_BYTES;
    vertices.push([
      model.binary.getFloat32(offset, true),
      model.binary.getFloat32(offset + 4, true),
      model.binary.getFloat32(offset + 8, true)
    ]);
  }
  return vertices;
}

/** Component-wise fold of a vertex list; `seed` and `pick` decide whether it keeps minima or maxima. */
function foldVertices(
  vertices: readonly Vec3[],
  seed: number,
  pick: (left: number, right: number) => number
): Vec3 {
  let x = seed;
  let y = seed;
  let z = seed;
  for (const vertex of vertices) {
    x = pick(x, component(vertex, 0));
    y = pick(y, component(vertex, 1));
    z = pick(z, component(vertex, 2));
  }
  return [x, y, z];
}

function positionAccessors(document: GlbDocument): GlbAccessor[] {
  const found: GlbAccessor[] = [];
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      const index = primitive.attributes.POSITION;
      if (index === undefined) continue;
      const accessor = document.accessors[index];
      if (accessor !== undefined) found.push(accessor);
    }
  }
  return found;
}

function normalAccessors(document: GlbDocument): GlbAccessor[] {
  const found: GlbAccessor[] = [];
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      const index = primitive.attributes.NORMAL;
      if (index === undefined) continue;
      const accessor = document.accessors[index];
      if (accessor !== undefined) found.push(accessor);
    }
  }
  return found;
}

describe("shipped crop models", () => {
  it("ships exactly one model per declared crop id, and no orphans", () => {
    const shipped = readdirSync(MODEL_DIRECTORY)
      .filter((name) => name.endsWith(".glb"))
      .sort();
    const declared = [...CROP_MODEL_IDS].map((id) => `${id}.glb`).sort();
    expect(shipped).toEqual(declared);
  });

  for (const modelId of CROP_MODEL_IDS) {
    describe(modelId, () => {
      const model = parseGlb(`${modelId}.glb`);

      it("declares glTF 2.0 and draws every primitive as triangles with positions and normals", () => {
        expect(model.document.asset.version).toBe("2.0");
        const primitives = model.document.meshes.flatMap((mesh) => mesh.primitives);
        expect(primitives.length).toBeGreaterThan(0);
        for (const primitive of primitives) {
          expect(primitive.attributes.POSITION).toBeDefined();
          expect(primitive.attributes.NORMAL).toBeDefined();
          expect(primitive.mode ?? TRIANGLES).toBe(TRIANGLES);
        }
      });

      it("keeps every accessor inside a buffer view that fits the buffer", () => {
        const bufferLength = model.document.buffers[0]?.byteLength ?? 0;
        expect(bufferLength).toBeGreaterThan(0);
        expect(model.binary.byteLength).toBeGreaterThanOrEqual(bufferLength);

        const ranges = model.document.bufferViews.map((view) => {
          expect(view.buffer, "one buffer only").toBe(0);
          expect(view.byteOffset % 4, "buffer views are four-byte aligned").toBe(0);
          expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(bufferLength);
          return { start: view.byteOffset, end: view.byteOffset + view.byteLength };
        });
        ranges.sort((left, right) => left.start - right.start);
        for (let index = 1; index < ranges.length; index += 1) {
          expect(ranges[index]?.start, "buffer views do not overlap").toBeGreaterThanOrEqual(
            ranges[index - 1]?.end ?? Number.POSITIVE_INFINITY
          );
        }

        for (const accessor of model.document.accessors) {
          const view = model.document.bufferViews[accessor.bufferView];
          expect(view, "every accessor has a buffer view").toBeDefined();
          expect(accessorBytes(accessor)).toBe(view?.byteLength);
        }
      });

      it("stands on the ground, is one unit tall, and fits inside its tile", () => {
        const accessors = positionAccessors(model.document);
        expect(accessors.length).toBeGreaterThan(0);

        const minimums: Vec3[] = [];
        const maximums: Vec3[] = [];
        let triangles = 0;

        for (const accessor of accessors) {
          expect(accessor.count % 3, "positions form whole triangles").toBe(0);
          triangles += accessor.count / 3;
          const vertices = readVec3(model, accessor);
          minimums.push(foldVertices(vertices, Number.POSITIVE_INFINITY, Math.min));
          maximums.push(foldVertices(vertices, Number.NEGATIVE_INFINITY, Math.max));
        }

        const min = foldVertices(minimums, Number.POSITIVE_INFINITY, Math.min);
        const max = foldVertices(maximums, Number.NEGATIVE_INFINITY, Math.max);
        expect(triangles).toBeGreaterThanOrEqual(MIN_TRIANGLES);

        expect(component(min, 1), "base sits on the ground").toBeCloseTo(0, CONTRACT_PRECISION);
        expect(component(max, 1) - component(min, 1), "height is one world unit").toBeCloseTo(
          CANONICAL_HEIGHT,
          CONTRACT_PRECISION
        );
        for (const axis of [0, 2]) {
          expect(Math.abs(component(min, axis))).toBeLessThanOrEqual(MAX_HALF_FOOTPRINT);
          expect(Math.abs(component(max, axis))).toBeLessThanOrEqual(MAX_HALF_FOOTPRINT);
        }
      });

      it("declares the position bounds glTF requires, and they match the vertices it ships", () => {
        for (const accessor of positionAccessors(model.document)) {
          const vertices = readVec3(model, accessor);
          const min = foldVertices(vertices, Number.POSITIVE_INFINITY, Math.min);
          const max = foldVertices(vertices, Number.NEGATIVE_INFINITY, Math.max);
          expect(accessor.min, "positions declare a minimum").toBeDefined();
          expect(accessor.max, "positions declare a maximum").toBeDefined();
          for (let axis = 0; axis < 3; axis += 1) {
            expect(accessor.min?.[axis]).toBeCloseTo(component(min, axis), BOUNDS_PRECISION);
            expect(accessor.max?.[axis]).toBeCloseTo(component(max, axis), BOUNDS_PRECISION);
          }
        }
      });

      it("ships unit-length normals so the placeholder is lit rather than black", () => {
        const accessors = normalAccessors(model.document);
        expect(accessors.length).toBeGreaterThan(0);
        for (const accessor of accessors) {
          for (const normal of readVec3(model, accessor)) {
            expect(Math.hypot(component(normal, 0), component(normal, 1), component(normal, 2))).toBeCloseTo(
              1,
              CONTRACT_PRECISION
            );
          }
        }
      });
    });
  }
});
