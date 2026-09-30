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

/**
 * Trees, bushes, rocks, and flowers around the field.
 *
 * Instances come from the deterministic world model, so the same farm always grows the same
 * scenery. Each kind is a small group of shared primitives, scaled as one unit.
 */

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

export type SceneryKind = SceneryInstance["kind"];
export type SceneryModels = Readonly<Partial<Record<SceneryKind, Object3D>>>;

/** Authored Kenney sizes normalized to the scale used by the deterministic world model. */
const MODEL_SCALE: Readonly<Record<SceneryKind, number>> = {
  tree: 0.78,
  pine: 0.78,
  bush: 0.72,
  rock: 0.58,
  flower: 0.58
};

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

export function buildScenery(
  group: Group,
  assets: SharedAssets,
  instances: readonly SceneryInstance[],
  models: SceneryModels = {}
): void {
  // A loaded model is drawn as one `InstancedMesh` per mesh it contains: the forest, the rim tree
  // line, and the scrub on locked land all share a single draw call per model part however many
  // copies stand in the world. The primitive groups below are the fallback for a kind whose model has
  // not arrived or cannot be loaded, which is why they stay as ordinary nodes.
  const byKind = new Map<SceneryKind, SceneryInstance[]>();
  for (const instance of instances) {
    const bucket = byKind.get(instance.kind);
    if (bucket === undefined) byKind.set(instance.kind, [instance]);
    else bucket.push(instance);
  }

  for (const [kind, bucket] of byKind) {
    const model = models[kind];
    if (model !== undefined && bucket.length > 0) {
      addInstancedModel(group, model, bucket, MODEL_SCALE[kind]);
    }
  }

  instances.forEach((instance, index) => {
    if (models[instance.kind] !== undefined) return;
    const node = new Group();
    node.position.set(instance.worldX, instance.worldY, instance.worldZ);
    node.rotation.y = instance.rotationY;
    node.scale.setScalar(instance.scale);
    switch (instance.kind) {
      case "tree":
        addTree(node, assets);
        break;
      case "pine":
        addPine(node, assets);
        break;
      case "bush":
        addBush(node, assets);
        break;
      case "rock":
        addRock(node, assets);
        break;
      case "flower":
        addFlower(node, assets, index);
        break;
    }
    group.add(node);
  });
}

/** The unit vector every scenery instance is rotated about. */
const UP = new Vector3(0, 1, 0);

/**
 * Draws every instance of one kind as instances of one loaded model.
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
  modelScale: number
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
      const size = instance.scale * modelScale;
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
