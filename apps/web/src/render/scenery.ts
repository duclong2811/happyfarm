import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from "three";
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
  instances.forEach((instance, index) => {
    const node = new Group();
    node.position.set(instance.worldX, 0, instance.worldZ);
    node.rotation.y = instance.rotationY;
    const model = models[instance.kind];
    if (model !== undefined) {
      node.add(model.clone(true));
      node.scale.setScalar(instance.scale * MODEL_SCALE[instance.kind]);
      group.add(node);
      return;
    }
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
