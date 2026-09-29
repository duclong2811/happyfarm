/**
 * The models this repository generates: data plus one builder each.
 *
 * A spec states where the file ships, the envelope it must satisfy, and what it may cost; a builder
 * only describes geometry. `generate-models.mjs` normalises every build into its envelope, and
 * `validate.mjs` re-measures the shipped file against the same numbers, so a spec cannot drift from
 * the artifact it describes.
 *
 * Colours come from the palette in `docs/HAPPYFARM_ART_BIBLE.md`, which mirrors
 * `apps/web/src/render/materials.ts`.
 */

import {
  fruit,
  fruitCluster,
  gableRoof,
  leafBlade,
  lowPolyBlob,
  part,
  seededRandom,
  softBox,
  taperedBox,
  taperedCylinder
} from "./glb.mjs";

const PALETTE = {
  carrot: 0xe0803c,
  carrotTop: 0x4f9b3f,
  wheatStalk: 0xc8a94a,
  wheatGrain: 0xe4cd72,
  cornStalk: 0x5d9c46,
  cornLeaf: 0x6fb054,
  cornCob: 0xe8c34a,
  stone: 0x9aa3ab,
  barnWall: 0xd1574a,
  barnRoof: 0x8d3f38,
  wood: 0xa9763f,
  trim: 0xf3e3c8,
  playerBody: 0x3f6fd8,
  playerLegs: 0x39435c,
  playerSkin: 0xf1c7a1,
  playerHat: 0xd9a441,
  playerHair: 0x6b4a2f
};

/** Leaves fanning out of a crop top: the cheapest way to read "leafy" from above. */
function leafFan(target, { x = 0, y, z = 0 }, { count, length, width, spread, tilt, droop, seed }) {
  const random = seededRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const yaw = (index / count) * Math.PI * 2 + random() * spread;
    const wobble = 0.85 + random() * 0.3;
    leafBlade(
      target,
      { x, y: y + random() * 0.04, z },
      { length: length * wobble, width, yaw, tilt: tilt * (0.8 + random() * 0.4), droop }
    );
  }
}

function buildCarrot() {
  const root = part("root", PALETTE.carrot);
  taperedCylinder(root, { x: 0, y: 0.02, z: 0 }, { bottomRadius: 0.035, topRadius: 0.15, height: 0.62, segments: 8 });
  lowPolyBlob(root, { x: 0, y: 0.6, z: 0 }, { radiusX: 0.15, radiusY: 0.1, radiusZ: 0.15, segments: 8, rings: 2 });

  const tops = part("tops", PALETTE.carrotTop);
  leafFan(tops, { y: 0.66 }, { count: 5, length: 0.34, width: 0.055, spread: 0.5, tilt: 0.7, droop: 0.5, seed: 11 });
  leafFan(tops, { y: 0.62 }, { count: 3, length: 0.22, width: 0.045, spread: 0.8, tilt: 1, droop: 0.6, seed: 12 });
  return [root, tops];
}

function buildWheat() {
  const stalk = part("stalk", PALETTE.wheatStalk);
  taperedCylinder(stalk, { x: 0, y: 0, z: 0 }, { bottomRadius: 0.028, topRadius: 0.018, height: 0.82, segments: 6 });
  taperedCylinder(stalk, { x: -0.07, y: 0, z: 0.05 }, { bottomRadius: 0.024, topRadius: 0.016, height: 0.74, segments: 6, leanX: -0.06, leanZ: 0.03 });

  const grain = part("grain", PALETTE.wheatGrain);
  fruitCluster(grain, { x: 0, y: 0.86, z: 0 }, { count: 5, radius: 0.045, spread: 0.07, seed: 21 });
  fruitCluster(grain, { x: -0.13, y: 0.76, z: 0.08 }, { count: 3, radius: 0.04, spread: 0.05, seed: 22 });

  const leaf = part("leaf", PALETTE.carrotTop);
  leafFan(leaf, { y: 0.2 }, { count: 2, length: 0.3, width: 0.04, spread: 0.7, tilt: 1.05, droop: 0.5, seed: 24 });
  return [stalk, grain, leaf];
}

function buildCorn() {
  const stalk = part("stalk", PALETTE.cornStalk);
  taperedCylinder(stalk, { x: 0, y: 0, z: 0 }, { bottomRadius: 0.055, topRadius: 0.03, height: 0.9, segments: 7 });

  const leaves = part("leaf", PALETTE.cornLeaf);
  leafFan(leaves, { y: 0.12 }, { count: 4, length: 0.56, width: 0.075, spread: 0.5, tilt: 0.55, droop: 0.75, seed: 31 });
  leafFan(leaves, { y: 0.4 }, { count: 4, length: 0.46, width: 0.06, spread: 0.6, tilt: 0.8, droop: 0.7, seed: 32 });

  const cob = part("cob", PALETTE.cornCob);
  fruit(cob, { x: 0.14, y: 0.5, z: 0.07 }, 0.075);
  fruit(cob, { x: -0.13, y: 0.62, z: -0.06 }, 0.065);
  return [stalk, leaves, cob];
}

function buildFarmer() {
  const legs = part("legs", PALETTE.playerLegs);
  taperedCylinder(legs, { x: -0.09, y: 0.1, z: 0 }, { bottomRadius: 0.06, topRadius: 0.07, height: 0.5, segments: 6 });
  taperedCylinder(legs, { x: 0.09, y: 0.1, z: 0 }, { bottomRadius: 0.06, topRadius: 0.07, height: 0.5, segments: 6 });
  softBox(legs, { x: -0.09, y: 0, z: 0.03 }, { width: 0.15, depth: 0.22, height: 0.1 });
  softBox(legs, { x: 0.09, y: 0, z: 0.03 }, { width: 0.15, depth: 0.22, height: 0.1 });

  const torso = part("torso", PALETTE.playerBody);
  taperedBox(torso, { x: 0, y: 0.56, z: 0 }, { width: 0.42, depth: 0.28, height: 0.5, topScale: 0.86 });
  taperedCylinder(torso, { x: -0.26, y: 0.62, z: 0 }, { bottomRadius: 0.055, topRadius: 0.05, height: 0.36, segments: 6, leanX: -0.03 });
  taperedCylinder(torso, { x: 0.26, y: 0.62, z: 0 }, { bottomRadius: 0.055, topRadius: 0.05, height: 0.36, segments: 6, leanX: 0.03 });

  const skin = part("skin", PALETTE.playerSkin);
  lowPolyBlob(skin, { x: -0.3, y: 0.96, z: 0 }, { radiusX: 0.055, radiusY: 0.055, radiusZ: 0.055, segments: 6, rings: 2 });
  lowPolyBlob(skin, { x: 0.3, y: 0.96, z: 0 }, { radiusX: 0.055, radiusY: 0.055, radiusZ: 0.055, segments: 6, rings: 2 });
  lowPolyBlob(skin, { x: 0, y: 1.26, z: 0 }, { radiusX: 0.15, radiusY: 0.15, radiusZ: 0.15, segments: 8, rings: 3 });
  softBox(skin, { x: 0, y: 1.2, z: 0.14 }, { width: 0.08, depth: 0.06, height: 0.06 });

  const hat = part("hat", PALETTE.playerHat);
  taperedCylinder(hat, { x: 0, y: 1.35, z: 0 }, { bottomRadius: 0.26, topRadius: 0.24, height: 0.04, segments: 8 });
  taperedCylinder(hat, { x: 0, y: 1.39, z: 0 }, { bottomRadius: 0.15, topRadius: 0.13, height: 0.14, segments: 8 });

  const hair = part("hair", PALETTE.playerHair);
  lowPolyBlob(hair, { x: 0, y: 1.3, z: -0.02 }, { radiusX: 0.155, radiusY: 0.12, radiusZ: 0.155, segments: 8, rings: 2 });
  return [legs, torso, skin, hat, hair];
}

function buildBarn() {
  const stone = part("stone", PALETTE.stone);
  taperedBox(stone, { x: 0, y: 0, z: 0 }, { width: 3, depth: 2.4, height: 0.24, topScale: 0.97 });
  taperedCylinder(stone, { x: 1.05, y: 1.5, z: -0.5 }, { bottomRadius: 0.13, topRadius: 0.11, height: 0.7, segments: 6 });

  const wall = part("wall", PALETTE.barnWall);
  taperedBox(wall, { x: 0, y: 0.24, z: 0 }, { width: 2.8, depth: 2.2, height: 1.5, topScale: 0.96 });

  const roof = part("roof", PALETTE.barnRoof);
  gableRoof(roof, { x: 0, y: 1.74, z: 0 }, { width: 2.8, depth: 2.2, height: 0.95, overhang: 0.18, thickness: 0.12 });
  taperedCylinder(roof, { x: 1.2, y: 1.6, z: -0.5 }, { bottomRadius: 0.52, topRadius: 0.04, height: 0.66, segments: 8 });

  const wood = part("wood", PALETTE.wood);
  softBox(wood, { x: 0, y: 0.24, z: 1.1 }, { width: 0.9, depth: 0.12, height: 1.05 });
  softBox(wood, { x: 0, y: 0.24, z: 1.14 }, { width: 0.06, depth: 0.06, height: 1.05 });

  const trim = part("trim", PALETTE.trim);
  softBox(trim, { x: 0.85, y: 1.05, z: 1.09 }, { width: 0.44, depth: 0.1, height: 0.4 });
  softBox(trim, { x: -0.85, y: 1.05, z: 1.09 }, { width: 0.44, depth: 0.1, height: 0.4 });
  softBox(trim, { x: -1.4, y: 1.05, z: 0 }, { width: 0.1, depth: 0.44, height: 0.4 });
  softBox(trim, { x: 0, y: 1.6, z: 0 }, { width: 2.9, depth: 2.3, height: 0.14 });
  return [stone, wall, roof, wood, trim];
}

/**
 * Every generated model.
 *
 * `envelope` is what the artifact test asserts: base on `y = 0`, height exactly as stated, nothing
 * past `halfFootprint` on x or z. `budget` is the ceiling from the art bible.
 */
export const MODEL_SPECS = [
  {
    id: "crop_carrot",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildCarrot
  },
  {
    id: "crop_wheat",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildWheat
  },
  {
    id: "crop_corn",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildCorn
  },
  {
    id: "character_farmer",
    kind: "character",
    directory: "apps/web/src/assets/models/characters",
    envelope: { height: 1.6, halfFootprint: 0.38 },
    budget: { triangles: 1200, materials: 6, bytes: 40000 },
    build: buildFarmer
  },
  {
    id: "building_barn",
    kind: "building",
    directory: "apps/web/src/assets/models/buildings",
    envelope: { height: 2.7, halfFootprint: 1.75 },
    budget: { triangles: 1500, materials: 6, bytes: 40000 },
    build: buildBarn
  }
];
