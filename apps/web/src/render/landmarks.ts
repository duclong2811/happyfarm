import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import type { SharedAssets } from "./materials";
import { GROUND_SURFACE_Y } from "./terrain-height";
import type { PlacedLandmark } from "./world-config";
import { BUILDING_MODELS } from "./building-model-urls";
import { BUILDINGS, variantFor } from "./buildings";

/**
 * The structures that give the island somewhere to look.
 *
 * Every landmark is assembled from the geometry and materials the rest of the world already shares -
 * a box, a cylinder, a cone - so adding one costs no download and no new texture, and each is built
 * inside its own group so it can be moved, rotated, or replaced by a real GLB later without the
 * placement, the collision circle, or the camera noticing.
 *
 * Nothing here is gameplay. A landmark unlocks nothing, stores nothing, and prices nothing; the
 * collision circle it may carry is the only thing the rest of the game reads, and it comes from
 * `LANDMARKS` in the world config rather than from this file.
 */

interface Piece {
  readonly material: Material;
  readonly geometry: BufferGeometry;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  /** Rotation about Y, for the pieces that need to face a different way than their parent. */
  readonly rotationY?: number;
  /** Rotation about Z, for a sloping awning or a leaning sail. */
  readonly rotationZ?: number;
  readonly rotationX?: number;
}

function piece(spec: Piece): Mesh {
  const mesh = new Mesh(spec.geometry, spec.material);
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.scale.set(spec.scaleX, spec.scaleY, spec.scaleZ);
  if (spec.rotationY !== undefined) mesh.rotation.y = spec.rotationY;
  if (spec.rotationZ !== undefined) mesh.rotation.z = spec.rotationZ;
  if (spec.rotationX !== undefined) mesh.rotation.x = spec.rotationX;
  return mesh;
}

/** A cottage: plaster walls, a tiled roof, a stone chimney, and a timber door. */
function buildFarmhouse(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.plaster, geometry: assets.box, x: 0, y: 0.95, z: 0, scaleX: 3.1, scaleY: 1.9, scaleZ: 2.5 }));
  group.add(
    piece({ material: assets.roofTile, geometry: assets.roof, x: 0, y: 2.42, z: 0, scaleX: 2.35, scaleY: 1.05, scaleZ: 1.95, rotationY: Math.PI / 4 })
  );
  group.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: 0.62, z: 1.27, scaleX: 0.72, scaleY: 1.24, scaleZ: 0.1 }));
  group.add(piece({ material: assets.plaster, geometry: assets.box, x: 1.05, y: 1.2, z: 1.27, scaleX: 0.56, scaleY: 0.5, scaleZ: 0.08 }));
  group.add(piece({ material: assets.plaster, geometry: assets.box, x: -1.05, y: 1.2, z: 1.27, scaleX: 0.56, scaleY: 0.5, scaleZ: 0.08 }));
  group.add(piece({ material: assets.stone, geometry: assets.box, x: 1.05, y: 3.0, z: -0.5, scaleX: 0.42, scaleY: 1.5, scaleZ: 0.42 }));
  // A garden wall, so the cottage reads as part of a working yard rather than as a lone box.
  group.add(piece({ material: assets.stone, geometry: assets.box, x: -1.9, y: 0.26, z: 1.3, scaleX: 1.7, scaleY: 0.52, scaleZ: 0.24 }));
  return group;
}

/** A windmill: a stepped tower with four sails on a hub. Decorative, and stationary on purpose. */
function buildWindmill(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.stone, geometry: assets.cylinder, x: 0, y: 0.85, z: 0, scaleX: 0.95, scaleY: 1.7, scaleZ: 0.95 }));
  group.add(piece({ material: assets.stone, geometry: assets.cylinder, x: 0, y: 2.25, z: 0, scaleX: 0.72, scaleY: 1.2, scaleZ: 0.72 }));
  group.add(piece({ material: assets.timber, geometry: assets.cylinder, x: 0, y: 3.2, z: 0, scaleX: 0.78, scaleY: 0.7, scaleZ: 0.78 }));
  group.add(piece({ material: assets.roofTile, geometry: assets.cone, x: 0, y: 3.85, z: 0, scaleX: 0.92, scaleY: 0.8, scaleZ: 0.92 }));
  group.add(piece({ material: assets.timber, geometry: assets.cylinder, x: 0, y: 3.3, z: 0.72, scaleX: 0.12, scaleY: 0.4, scaleZ: 0.12, rotationX: Math.PI / 2 }));
  // Four sails on the hub, offset so the mill never looks like a cross.
  const sailCount = 4;
  for (let index = 0; index < sailCount; index += 1) {
    const angle = (index / sailCount) * Math.PI * 2 + Math.PI / 8;
    group.add(
      piece({
        material: assets.millBlade,
        geometry: assets.box,
        x: Math.cos(angle) * 1.15,
        y: 3.3 + Math.sin(angle) * 1.15,
        z: 0.86,
        scaleX: 0.22,
        scaleY: 2.1,
        scaleZ: 0.06,
        rotationZ: angle
      })
    );
  }
  group.add(piece({ material: assets.timber, geometry: assets.sphere, x: 0, y: 3.3, z: 0.9, scaleX: 0.16, scaleY: 0.16, scaleZ: 0.16 }));
  return group;
}

/** A well: a stone kerb, a dark water disc, two posts, and a little roof over them. */
function buildWell(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.stone, geometry: assets.cylinder, x: 0, y: 0.3, z: 0, scaleX: 0.72, scaleY: 0.6, scaleZ: 0.72 }));
  group.add(piece({ material: assets.waterDeep, geometry: assets.circle, x: 0, y: 0.58, z: 0, scaleX: 0.58, scaleY: 0.58, scaleZ: 1, rotationX: -Math.PI / 2 }));
  for (const side of [-1, 1]) {
    group.add(piece({ material: assets.timber, geometry: assets.box, x: side * 0.62, y: 1.0, z: 0, scaleX: 0.12, scaleY: 1.4, scaleZ: 0.12 }));
  }
  group.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: 1.65, z: 0, scaleX: 1.5, scaleY: 0.1, scaleZ: 1.1 }));
  group.add(
    piece({ material: assets.roofTile, geometry: assets.roof, x: 0, y: 2.0, z: 0, scaleX: 1.15, scaleY: 0.55, scaleZ: 0.85, rotationY: Math.PI / 4 })
  );
  group.add(piece({ material: assets.stakeWood, geometry: assets.cylinder, x: 0, y: 1.35, z: 0, scaleX: 0.09, scaleY: 0.5, scaleZ: 0.09, rotationZ: Math.PI / 2 }));
  return group;
}

/** A market stall: four posts, a striped awning, a counter, and a couple of crates of produce. */
function buildMarketStall(assets: SharedAssets): Group {
  const group = new Group();
  for (const x of [-0.85, 0.85]) {
    for (const z of [-0.55, 0.55]) {
      group.add(piece({ material: assets.timber, geometry: assets.box, x, y: 0.7, z, scaleX: 0.1, scaleY: 1.4, scaleZ: 0.1 }));
    }
  }
  group.add(piece({ material: assets.canvas, geometry: assets.box, x: 0, y: 1.52, z: 0, scaleX: 2.15, scaleY: 1.2, scaleZ: 0.08, rotationX: -0.32 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0, y: 0.82, z: 0.2, scaleX: 1.9, scaleY: 0.12, scaleZ: 0.9 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: -0.5, y: 1.0, z: 0.1, scaleX: 0.42, scaleY: 0.28, scaleZ: 0.42 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0.45, y: 0.98, z: 0.18, scaleX: 0.38, scaleY: 0.24, scaleZ: 0.38 }));
  // A couple of produce heaps on the counter, in two of the flower colours so the stall has colour
  // without a texture of its own.
  group.add(
    piece({ material: assets.flowers[0] ?? assets.millBlade, geometry: assets.sphere, x: -0.5, y: 1.12, z: 0.1, scaleX: 0.17, scaleY: 0.13, scaleZ: 0.17 })
  );
  group.add(
    piece({ material: assets.flowers[1] ?? assets.millBlade, geometry: assets.sphere, x: 0.45, y: 1.12, z: 0.18, scaleX: 0.15, scaleY: 0.12, scaleZ: 0.15 })
  );
  return group;
}

/** A storage shed: a long timber box with a tiled roof, a door, and a hay bale beside it. */
function buildStorageShed(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: 0.85, z: 0, scaleX: 2.9, scaleY: 1.7, scaleZ: 1.9 }));
  group.add(
    piece({ material: assets.roofTile, geometry: assets.roof, x: 0, y: 2.25, z: 0, scaleX: 2.15, scaleY: 1.0, scaleZ: 1.5, rotationY: Math.PI / 4 })
  );
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0, y: 0.52, z: 0.96, scaleX: 0.9, scaleY: 1.04, scaleZ: 0.1 }));
  group.add(piece({ material: assets.stone, geometry: assets.box, x: 1.85, y: 0.4, z: 0.4, scaleX: 1.0, scaleY: 0.8, scaleZ: 0.8, rotationY: 0.25 }));
  return group;
}

/**
 * The fishery's store: the shed the quay works out of.
 *
 * The pier itself is *not* here. It is derived from the harbour's own geometry in `terrain.ts`, so
 * its deck starts on the beach and ends over water wherever the coastline is, and this building is
 * only the store that stands at the landward end of it, among the crates and the barrels.
 */
function buildHarbor(assets: SharedAssets): Group {
  const group = new Group();
  // The store stands a few metres *behind* the yard it serves: the landmark is placed on the yard,
  // and the boats, the crates and the deck are in front of it, between the store and the water.
  const store = new Group();
  store.position.z = -3.4;
  store.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: 1.0, z: 0, scaleX: 4.2, scaleY: 2.0, scaleZ: 2.6 }));
  store.add(
    piece({ material: assets.roofTile, geometry: assets.roof, x: 0, y: 2.5, z: 0, scaleX: 3.1, scaleY: 1.0, scaleZ: 2.0, rotationY: Math.PI / 4 })
  );
  store.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0, y: 0.62, z: 1.32, scaleX: 1.3, scaleY: 1.24, scaleZ: 0.12 }));
  // Nets drying on the wall, a barrel, and a crate: the small furniture of a working store.
  for (const x of [-1.7, 1.7]) {
    store.add(piece({ material: assets.canvas, geometry: assets.box, x, y: 1.3, z: 1.34, scaleX: 1.1, scaleY: 0.9, scaleZ: 0.06 }));
  }
  store.add(piece({ material: assets.timber, geometry: assets.cylinder, x: -2.6, y: 0.42, z: 0.6, scaleX: 0.4, scaleY: 0.84, scaleZ: 0.4 }));
  store.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 2.5, y: 0.34, z: 0.7, scaleX: 0.68, scaleY: 0.68, scaleZ: 0.68, rotationY: 0.3 }));
  group.add(store);
  return group;
}

/** The coop: a small hut on legs with a run, the one building the pasture needs to read as a farm. */
function buildCoop(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0, y: 0.5, z: 0, scaleX: 1.5, scaleY: 1.0, scaleZ: 1.2 }));
  group.add(
    piece({ material: assets.roofTile, geometry: assets.roof, x: 0, y: 1.25, z: 0, scaleX: 1.1, scaleY: 0.5, scaleZ: 0.9, rotationY: Math.PI / 4 })
  );
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 0.5, y: 0.45, z: 0.65, scaleX: 0.4, scaleY: 0.5, scaleZ: 0.08 }));
  return group;
}

/** The silo: a tall cylinder with a domed cap, standing beside the barn. */
function buildSilo(assets: SharedAssets): Group {
  const group = new Group();
  group.add(piece({ material: assets.plaster, geometry: assets.cylinder, x: 0, y: 1.3, z: 0, scaleX: 0.85, scaleY: 2.6, scaleZ: 0.85 }));
  group.add(piece({ material: assets.roofTile, geometry: assets.cone, x: 0, y: 2.75, z: 0, scaleX: 0.95, scaleY: 0.7, scaleZ: 0.95 }));
  group.add(piece({ material: assets.stone, geometry: assets.cylinder, x: 0, y: 0.15, z: 0, scaleX: 1.0, scaleY: 0.3, scaleZ: 1.0 }));
  return group;
}

/**
 * An open barn: the agricultural district's working shelter.
 *
 * Four posts and a low-pitched roof with only one wall, so what it shelters is visible from the
 * estate camera - a hay bale, a crate, and a cart under cover. A hay barn is the one building that
 * says "this is a farm" from five hundred metres up, and it is also the anchor the fields at the
 * heartland's northern edge need so they are not just ground beside a fence.
 */
function buildOpenBarn(assets: SharedAssets): Group {
  const group = new Group();
  const postHeight = 2.2;
  for (const x of [-1.9, -0.65, 0.65, 1.9]) {
    for (const z of [-1.15, 1.15]) {
      group.add(piece({ material: assets.timber, geometry: assets.box, x, y: postHeight / 2, z, scaleX: 0.16, scaleY: postHeight, scaleZ: 0.16 }));
    }
  }
  // The back wall only: the other three sides stay open, which is the whole point of the building.
  group.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: 1.0, z: -1.2, scaleX: 4.1, scaleY: 2.0, scaleZ: 0.14 }));
  // A shallow gable, drawn as two slabs rather than a cone: an open barn's roof is a plane.
  for (const side of [-1, 1]) {
    group.add(
      piece({
        material: assets.barnRoof,
        geometry: assets.box,
        x: 0,
        y: postHeight + 0.36,
        z: side * 0.62,
        scaleX: 4.5,
        scaleY: 0.12,
        scaleZ: 1.5,
        rotationX: side * 0.3
      })
    );
  }
  group.add(piece({ material: assets.timber, geometry: assets.box, x: 0, y: postHeight + 0.62, z: 0, scaleX: 0.16, scaleY: 0.16, scaleZ: 2.2 }));
  // Hay, a crate, and a cart under the roof: the shelter is furnished, not empty.
  group.add(piece({ material: assets.millBlade, geometry: assets.cylinder, x: -1.1, y: 0.42, z: 0.15, scaleX: 0.62, scaleY: 0.84, scaleZ: 0.62, rotationZ: Math.PI / 2 }));
  group.add(piece({ material: assets.millBlade, geometry: assets.cylinder, x: -1.1, y: 0.42, z: 0.95, scaleX: 0.62, scaleY: 0.84, scaleZ: 0.62, rotationZ: Math.PI / 2 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 1.2, y: 0.34, z: 0.3, scaleX: 0.66, scaleY: 0.66, scaleZ: 0.66 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 1.2, y: 0.98, z: 0.3, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5, rotationY: 0.4 }));
  group.add(piece({ material: assets.stakeWood, geometry: assets.box, x: 1.15, y: 0.55, z: -0.75, scaleX: 0.9, scaleY: 0.16, scaleZ: 1.5 }));
  for (const z of [-1.4, -0.1]) {
    group.add(piece({ material: assets.timber, geometry: assets.cylinder, x: 1.15, y: 0.28, z, scaleX: 0.3, scaleY: 0.56, scaleZ: 0.3, rotationZ: Math.PI / 2 }));
  }
  return group;
}

const BUILDERS: Readonly<Record<PlacedLandmark["kind"], (assets: SharedAssets) => Group>> = {
  FARMHOUSE: buildFarmhouse,
  WINDMILL: buildWindmill,
  WELL: buildWell,
  MARKET_STALL: buildMarketStall,
  STORAGE_SHED: buildStorageShed,
  HARBOR: buildHarbor,
  SILO: buildSilo,
  OPEN_BARN: buildOpenBarn,
  COOP: buildCoop
};

/**
 * Draws every landmark the world config places.
 *
 * The group is positioned on the ground (`worldY` is 0 on the plateau the landmarks all stand on)
 * and rotated by the config, so a landmark's own geometry never has to know where it is.
 */
export function buildLandmarks(
  group: Group,
  assets: SharedAssets,
  landmarks: readonly PlacedLandmark[],
  getModel: (id: string) => Object3D | undefined = () => undefined
): void {
  for (const landmark of landmarks) {
    // A real model when the tier has one and it has loaded, the primitive otherwise. The fallback is
    // kept on purpose: a building that has not arrived yet shows its primitive rather than a hole, and
    // the swap happens by itself when the model lands.
    const definition = BUILDINGS.find((building) => building.id === landmark.id);
    const variant = definition === undefined ? null : variantFor(definition);
    const entry = variant?.modelId == null ? undefined : BUILDING_MODELS.get(variant.modelId);
    const model = entry === undefined ? undefined : getModel(entry.id);

    let node: Group;
    if (model !== undefined && entry !== undefined) {
      node = new Group();
      const clone = model.clone(true);
      // The model is normalized to one world unit across its largest dimension, so this is the
      // building's real size in metres.
      clone.scale.setScalar(entry.sizeWorld);
      node.add(clone);
    } else {
      node = BUILDERS[landmark.kind](assets);
      // A primitive has to hold its own at estate zoom too, where the whole island is on screen. The
      // harbour is the exception: its geometry already spans the quay, the pier and the yard.
      node.scale.setScalar(landmark.kind === "HARBOR" ? 1 : 1.7);
    }
    // Stands on the ground rather than at the tile slabs' own base level.
    node.position.set(landmark.worldX, GROUND_SURFACE_Y, landmark.worldZ);
    node.rotation.y = landmark.rotationY;
    node.traverse((child) => {
      child.castShadow = true;
    });
    group.add(node);
  }
}
