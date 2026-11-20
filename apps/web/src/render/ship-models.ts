import { Box3, Color, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";

/**
 * The ship models (`tools/asset-pipeline/node/ships.mjs`): which one a ship class or a pirate draws
 * with, and how a loaded model is fitted to the length a scene wants.
 *
 * Presentation only. A model is shared through the model library, so a fitted copy shares its
 * geometry: whoever drops one must not dispose that geometry (`SHARED_SHIP_GEOMETRY`).
 */

/** The waterline above the keel, as a share of the model's overall length (hull built at 0.04). */
export const SHIP_DRAFT_SHARE = 0.036;

/** Marks a node whose geometry belongs to the model library, not to the scene holding it. */
export const SHARED_SHIP_GEOMETRY = "sharedShipGeometry";

const MODEL_BY_CLASS: Readonly<Record<string, string>> = {
  ship_class_rowboat: "ship_rowboat",
  ship_class_sloop: "ship_sloop",
  ship_class_brig: "ship_brig",
  ship_class_frigate: "ship_frigate",
  // The fleet's new classes (docs/design/FLEET.md, F1).
  ship_class_line_boat: "ship_line_boat",
  ship_class_net_boat: "ship_net_boat",
  ship_class_trawler: "ship_trawler",
  ship_class_coaster: "ship_coaster",
  ship_class_junk: "ship_junk",
  ship_class_cargo_junk: "ship_cargo_junk",
  ship_class_great_junk: "ship_great_junk",
  ship_class_dragon: "ship_dragon"
};

const MODEL_BY_TIER = ["ship_rowboat", "ship_sloop", "ship_brig", "ship_frigate"] as const;

const PIRATE_MODELS = new Set(["pirate_cutter", "pirate_raider", "pirate_corsair", "monster_thuong_luong"]);

/**
 * How deep a sea monster lies, as a share of its length: deeper than a ship, so the coils between its
 * humps are under the water and only the humps, the tail and the raised head show.
 */
export const MONSTER_DRAFT_SHARE = 0.062;

/** The model for a ship class id, a pirate id or a sea monster id; null for anything without one. */
export function shipModelId(id: string): string | null {
  return MODEL_BY_CLASS[id] ?? (PIRATE_MODELS.has(id) ? id : null);
}

/** How deep a model lies in the water, as a share of its length. */
export function draftShareFor(modelId: string): number {
  return modelId.startsWith("monster_") ? MONSTER_DRAFT_SHARE : SHIP_DRAFT_SHARE;
}

/** The model for a ship tier (1 rowboat .. 4 frigate); higher tiers draw as the largest model. */
export function shipModelForTier(tier: number): string {
  const index = Math.min(MODEL_BY_TIER.length, Math.max(1, Math.floor(tier))) - 1;
  return MODEL_BY_TIER[index] ?? MODEL_BY_TIER[0];
}

/** Lengths along the model's own axis, so a scene can fit it without measuring a rotated copy. */
function lengthOf(model: Object3D): number {
  const box = new Box3().setFromObject(model);
  return Math.max(0.001, box.max.z - box.min.z);
}

/**
 * A copy of a loaded ship model, `length` long overall, bow toward +x, sunk to its waterline.
 *
 * `tint`, when given, replaces each material with an unlit-by-fog copy pulled `amount` of the way to
 * the haze colour, the way the horizon draws distant things. Those materials belong to the caller.
 */
export function fitShipModel(source: Object3D, length: number, tint?: { readonly haze: number; readonly amount: number }, draftShare: number = SHIP_DRAFT_SHARE): Group {
  const model = source.clone(true);
  const scale = length / lengthOf(source);
  model.scale.setScalar(scale);
  model.rotation.y = Math.PI / 2;
  model.position.y = -draftShare * length;
  const hazed = new Map<Material, Material>();
  model.traverse((node) => {
    node.userData[SHARED_SHIP_GEOMETRY] = true;
    node.raycast = () => undefined;
    if (tint === undefined || !(node instanceof Mesh)) return;
    const original = node.material as Material & { color?: Color };
    let copy = hazed.get(original);
    if (copy === undefined) {
      const colour = original.color instanceof Color ? original.color.clone() : new Color(0x808080);
      copy = new MeshLambertMaterial({ color: colour.lerp(new Color(tint.haze), tint.amount), fog: false });
      hazed.set(original, copy);
    }
    node.material = copy;
  });
  const holder = new Group();
  holder.add(model);
  return holder;
}
