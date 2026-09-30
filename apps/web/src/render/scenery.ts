import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D
} from "three";
import type { SharedAssets } from "./materials";
import type { SceneryInstance } from "./world";
import { ENVIRONMENT_MODELS, type EnvironmentModelEntry } from "./environment-model-urls";

/**
 * The plants, stones, and props that furnish the island.
 *
 * Instances come from the deterministic world model, which decides *what* stands where and how
 * large; this module decides *which model* draws it, and it is the only place a `.glb` is turned
 * into geometry. Two layers keep that honest:
 *
 *  - a **tier** (HERO or FILLER) that the world model picks per placement, and
 *  - a **roll** in 0..1 that the world model also picks, so a forest is a family of variants rather
 *    than one model repeated - and the same family, in the same order, on every client.
 *
 * Everything with a loaded model is drawn as one `InstancedMesh` per mesh per model, so a hundred
 * trees are a handful of draw calls. A model that has not arrived, or cannot load, falls back to the
 * primitive group for its kind, which is why the world never shows a hole where an asset should be.
 */

export type SceneryKind = SceneryInstance["kind"];
export type SceneryTier = SceneryInstance["tier"];
export type SceneryModels = ReadonlyMap<string, Object3D>;

interface PartSpec {
  readonly material: Material;
  readonly geometry: BufferGeometry;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
}

/**
 * The model a placement draws, or null when its tier has nothing that fits.
 *
 * Pure, so the mix a forest will actually show can be asserted in a unit test: same kind, same tier,
 * same roll, same model, on every client and after every refresh.
 */
export function environmentModelFor(
  kind: SceneryKind,
  tier: SceneryTier,
  roll: number
): EnvironmentModelEntry | null {
  const tierModels = ENVIRONMENT_MODELS[kind][tier];
  if (tierModels.length === 0) return null;
  const index = Math.min(tierModels.length - 1, Math.max(0, Math.floor(roll * tierModels.length)));
  return tierModels[index] ?? null;
}

function part(spec: PartSpec): Mesh {
  const mesh = new Mesh(spec.geometry, spec.material);
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.scale.set(spec.scaleX, spec.scaleY, spec.scaleZ);
  return mesh;
}

function addTree(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.wood, geometry: assets.cylinder, x: 0, y: 0.3, z: 0, scaleX: 0.09, scaleY: 0.6, scaleZ: 0.09 }));
  group.add(part({ material: assets.foliage, geometry: assets.sphere, x: 0, y: 0.86, z: 0, scaleX: 0.5, scaleY: 0.56, scaleZ: 0.5 }));
  group.add(part({ material: assets.foliage, geometry: assets.sphere, x: 0.26, y: 0.62, z: 0.14, scaleX: 0.32, scaleY: 0.34, scaleZ: 0.32 }));
  group.add(part({ material: assets.foliage, geometry: assets.sphere, x: -0.24, y: 0.66, z: -0.12, scaleX: 0.3, scaleY: 0.32, scaleZ: 0.3 }));
}

function addPine(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.wood, geometry: assets.cylinder, x: 0, y: 0.26, z: 0, scaleX: 0.08, scaleY: 0.52, scaleZ: 0.08 }));
  group.add(part({ material: assets.pine, geometry: assets.cone, x: 0, y: 0.55, z: 0, scaleX: 0.42, scaleY: 0.6, scaleZ: 0.42 }));
  group.add(part({ material: assets.pine, geometry: assets.cone, x: 0, y: 0.95, z: 0, scaleX: 0.3, scaleY: 0.55, scaleZ: 0.3 }));
  group.add(part({ material: assets.pine, geometry: assets.cone, x: 0, y: 1.3, z: 0, scaleX: 0.18, scaleY: 0.45, scaleZ: 0.18 }));
}

function addBush(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.foliage, geometry: assets.sphere, x: 0, y: 0.26, z: 0, scaleX: 0.4, scaleY: 0.32, scaleZ: 0.4 }));
  group.add(part({ material: assets.pine, geometry: assets.sphere, x: 0.24, y: 0.2, z: 0.1, scaleX: 0.26, scaleY: 0.22, scaleZ: 0.26 }));
}

function addRock(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.rock, geometry: assets.octa, x: 0, y: 0.2, z: 0, scaleX: 0.36, scaleY: 0.3, scaleZ: 0.36 }));
  group.add(part({ material: assets.rock, geometry: assets.octa, x: 0.26, y: 0.12, z: 0.16, scaleX: 0.18, scaleY: 0.16, scaleZ: 0.18 }));
}

function addFlower(group: Group, assets: SharedAssets, variant: number): void {
  const head = assets.flowers[variant % assets.flowers.length] ?? assets.flowers[0];
  if (head === undefined) return;
  group.add(part({ material: assets.pine, geometry: assets.cylinder, x: 0, y: 0.14, z: 0, scaleX: 0.02, scaleY: 0.28, scaleZ: 0.02 }));
  group.add(part({ material: head, geometry: assets.sphere, x: 0, y: 0.31, z: 0, scaleX: 0.11, scaleY: 0.09, scaleZ: 0.11 }));
}

function addPlant(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.foliage, geometry: assets.cone, x: 0, y: 0.16, z: 0, scaleX: 0.16, scaleY: 0.32, scaleZ: 0.16 }));
  group.add(part({ material: assets.pine, geometry: assets.cone, x: 0.14, y: 0.1, z: 0.08, scaleX: 0.1, scaleY: 0.2, scaleZ: 0.1 }));
}

function addProp(group: Group, assets: SharedAssets): void {
  group.add(part({ material: assets.stakeWood, geometry: assets.box, x: 0, y: 0.22, z: 0, scaleX: 0.42, scaleY: 0.42, scaleZ: 0.42 }));
}

function addPrimitive(group: Group, assets: SharedAssets, kind: SceneryKind, index: number): void {
  switch (kind) {
    case "tree":
      addTree(group, assets);
      return;
    case "pine":
      addPine(group, assets);
      return;
    case "bush":
      addBush(group, assets);
      return;
    case "rock":
      addRock(group, assets);
      return;
    case "flower":
      addFlower(group, assets, index);
      return;
    case "plant":
      addPlant(group, assets);
      return;
    case "prop":
      addProp(group, assets);
      return;
  }
}

/** The unit vector every scenery instance is rotated about. */
const UP = new Vector3(0, 1, 0);

/**
 * Draws every instance of one model as instances of it.
 *
 * Each mesh inside the model becomes its own `InstancedMesh`, carrying the model's own node transform
 * in every instance matrix, so a multi-part GLB keeps its shape without being merged or rebuilt. The
 * geometry and material stay the model's, which means the renderer can still dispose them exactly once
 * when the model itself goes away.
 */
function addInstancedModel(
  group: Group,
  model: Object3D,
  instances: readonly SceneryInstance[],
  unitScale: number
): void {
  model.updateMatrixWorld(true);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();

  model.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const instanced = new InstancedMesh(child.geometry, child.material, instances.length);
    instances.forEach((instance, index) => {
      const size = instance.scale * unitScale;
      position.set(instance.worldX, instance.worldY, instance.worldZ);
      scale.set(size, size, size);
      rotation.setFromAxisAngle(UP, instance.rotationY);
      matrix.compose(position, rotation, scale);
      // The instance places the model's root; the mesh's own world matrix puts it where it sits
      // inside that model.
      matrix.multiply(child.matrixWorld);
      instanced.setMatrixAt(index, matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.receiveShadow = false;
    // The bounding sphere has to account for the instance matrices, or the whole group would be
    // culled as soon as the model's own origin left the frustum.
    instanced.computeBoundingSphere();
    group.add(instanced);
  });
}

export function buildScenery(
  group: Group,
  assets: SharedAssets,
  instances: readonly SceneryInstance[],
  getModel: (id: string) => Object3D | undefined
): void {
  // One bucket per model: a hundred trees of one variant are one instanced draw per mesh, and the
  // primitive fallback is only built for placements whose model is not loaded yet.
  const buckets = new Map<string, { readonly model: Object3D; readonly unitScale: number; readonly instances: SceneryInstance[] }>();
  const missing: SceneryInstance[] = [];

  instances.forEach((instance) => {
    const entry = environmentModelFor(instance.kind, instance.tier, instance.variantRoll);
    const model = entry === null ? undefined : getModel(entry.id);
    if (entry === null || model === undefined) {
      missing.push(instance);
      return;
    }
    const bucket = buckets.get(entry.id);
    if (bucket === undefined) {
      buckets.set(entry.id, { model, unitScale: entry.unitScale, instances: [instance] });
    } else {
      bucket.instances.push(instance);
    }
  });

  for (const bucket of buckets.values()) {
    if (bucket.instances.length > 0) addInstancedModel(group, bucket.model, bucket.instances, bucket.unitScale);
  }

  missing.forEach((instance, index) => {
    const node = new Group();
    node.position.set(instance.worldX, instance.worldY, instance.worldZ);
    node.rotation.y = instance.rotationY;
    node.scale.setScalar(instance.scale);
    addPrimitive(node, assets, instance.kind, index);
    group.add(node);
  });
}
