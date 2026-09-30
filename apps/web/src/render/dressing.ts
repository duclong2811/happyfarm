import {
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Group,
  type Object3D
} from "three";
import type { PlacedCompositionProp } from "./composition";

/**
 * Draws the island's set dressing.
 *
 * The props arrive already placed - the preset authored them, the world model turned them into world
 * metres - so this module has exactly one job: turn a list of `(model, transform)` into as few draw
 * calls as a browser can be asked for. One bucket per model and one `InstancedMesh` per mesh inside
 * it, which is the same rule the scenery pass follows, so sixty barrels, crates and benches cost the
 * scene a handful of draws rather than sixty.
 *
 * A model that has not loaded yet is skipped rather than replaced with a placeholder. That is the one
 * place this differs from scenery, and it is deliberate: a tree drawn as a primitive is a tree, but a
 * market stall drawn as a cone is a bug the eye reads as art direction. The layer is rebuilt as each
 * model lands, so the yard fills in over the first second and is never wrong.
 */
export function buildCompositionProps(
  group: Group,
  props: readonly PlacedCompositionProp[],
  getModel: (assetId: string) => Object3D | undefined
): void {
  const buckets = new Map<string, PlacedCompositionProp[]>();
  for (const prop of props) {
    const bucket = buckets.get(prop.assetId);
    if (bucket === undefined) buckets.set(prop.assetId, [prop]);
    else bucket.push(prop);
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);

  for (const [assetId, placements] of buckets) {
    const model = getModel(assetId);
    if (model === undefined) continue;
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const instanced = new InstancedMesh(child.geometry, child.material, placements.length);
      placements.forEach((placement, index) => {
        position.set(placement.worldX, placement.worldY, placement.worldZ);
        scale.setScalar(placement.sizeWorld);
        rotation.setFromAxisAngle(up, placement.rotationY);
        matrix.compose(position, rotation, scale);
        // The instance places the model's root; the mesh's own world matrix puts it where it sits
        // inside that model, so a multi-part prop keeps the shape it was imported with.
        matrix.multiply(child.matrixWorld);
        instanced.setMatrixAt(index, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = true;
      instanced.receiveShadow = false;
      instanced.computeBoundingSphere();
      group.add(instanced);
    });
  }
}
