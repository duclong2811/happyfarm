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
import {
  buildPirateCorsair,
  buildPirateCutter,
  buildPirateRaider,
  buildShipBrig,
  buildShipFrigate,
  buildShipRowboat,
  buildShipSloop, buildShipLineBoat, buildShipNetBoat, buildShipTrawler, buildShipCoaster, buildShipJunk, buildShipCargoJunk, buildShipGreatJunk, buildShipDragon } from "./ships.mjs";
import { buildBachTuoc, buildCuaDa, buildKinhNgu, buildSuaLua, buildThuongLuong } from "./monsters.mjs";
import { VIET_BUILDERS } from "./viet.mjs";
import { VIET_REGION_BUILDERS } from "./viet-regions.mjs";

const PALETTE = {
  carrot: 0xe0803c,
  carrotTop: 0x4f9b3f,
  wheatStalk: 0xc8a94a,
  wheatGrain: 0xe4cd72,
  cornStalk: 0x5d9c46,
  cornLeaf: 0x6fb054,
  cornCob: 0xe8c34a,
  potatoLeaf: 0x3f7f3a,
  potatoTuber: 0xb98a52,
  tomatoStem: 0x4a7a3a,
  tomatoLeaf: 0x3f8f45,
  tomatoFruit: 0xd0392b,
  strawberryLeaf: 0x3d7f3c,
  strawberryBerry: 0xe0403a,
  cabbageHead: 0xa9d17a,
  cabbageLeaf: 0x5f9c46,
  pumpkinShell: 0xe08a26,
  pumpkinStem: 0x4f7f3a,
  // Fish: a body, a fin, and an eye. Colour is the species' identity at thumbnail size.
  fishTilapiaBody: 0x8fa8b8,
  fishCarpBody: 0xb08a4a,
  fishCatfishBody: 0x5f6b6f,
  fishSardineBody: 0xb9c7d0,
  fishMackerelBody: 0x4f7f8f,
  fishSnapperBody: 0xd0604a,
  fishTunaBody: 0x3f5f8f,
  fishBelly: 0xf1e8d8,
  fishFin: 0x2f4a5f,
  fishEye: 0x1a1f24,
  // Resource nodes: a rock, and the vein that says which material it holds.
  nodeStone: 0x8d9298,
  nodeCopper: 0x8d9298,
  nodeCopperVein: 0xd0703a,
  nodeIron: 0x7f8388,
  nodeIronVein: 0xa8552f,
  nodeCoal: 0x3f4448,
  nodeCoalVein: 0x24282b,
  // Wild forestry trees: a trunk, a canopy, and a stump where the trunk used to be.
  treeWildTrunk: 0x7a5a3a,
  treeWildCanopy: 0x4f9b52,
  treePineTrunk: 0x6b4f36,
  treePineCanopy: 0x2f6b45,
  treeHardwoodTrunk: 0x5f4630,
  treeHardwoodCanopy: 0x3b7a45,
  stumpWood: 0x9a7350,
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

/** Potato: a low leafy mound with a few tubers showing at the base, so it reads as a root crop. */
function buildPotato() {
  const leaves = part("leaf", PALETTE.potatoLeaf);
  lowPolyBlob(leaves, { x: 0, y: 0.3, z: 0 }, { radiusX: 0.26, radiusY: 0.24, radiusZ: 0.26, segments: 8, rings: 3 });
  leafFan(leaves, { y: 0.06 }, { count: 6, length: 0.38, width: 0.07, spread: 0.5, tilt: 0.7, droop: 0.55, seed: 41 });
  leafFan(leaves, { y: 0.2 }, { count: 4, length: 0.28, width: 0.06, spread: 0.7, tilt: 0.95, droop: 0.5, seed: 42 });

  const tuber = part("tuber", PALETTE.potatoTuber);
  fruit(tuber, { x: -0.16, y: 0.07, z: 0.12 }, 0.085);
  fruit(tuber, { x: 0.16, y: 0.07, z: -0.08 }, 0.075);
  fruit(tuber, { x: 0.03, y: 0.06, z: 0.17 }, 0.07);
  return [leaves, tuber];
}

/** Tomato: a staked bush of red fruit, taller and busier than the root crops. */
function buildTomato() {
  const stalk = part("stalk", PALETTE.tomatoStem);
  taperedCylinder(stalk, { x: 0, y: 0, z: 0 }, { bottomRadius: 0.035, topRadius: 0.022, height: 0.86, segments: 6 });

  const leaves = part("leaf", PALETTE.tomatoLeaf);
  leafFan(leaves, { y: 0.18 }, { count: 5, length: 0.34, width: 0.06, spread: 0.55, tilt: 0.6, droop: 0.55, seed: 51 });
  leafFan(leaves, { y: 0.42 }, { count: 4, length: 0.28, width: 0.055, spread: 0.7, tilt: 0.85, droop: 0.5, seed: 52 });

  const tomatoes = part("fruit", PALETTE.tomatoFruit);
  fruitCluster(tomatoes, { x: 0.08, y: 0.5, z: 0.04 }, { count: 5, radius: 0.055, spread: 0.14, seed: 53 });
  fruitCluster(tomatoes, { x: -0.08, y: 0.68, z: -0.03 }, { count: 3, radius: 0.05, spread: 0.1, seed: 54 });
  return [stalk, leaves, tomatoes];
}

/** Strawberry: a low leafy clump with small berries clustered at the ground. */
function buildStrawberry() {
  const leaves = part("leaf", PALETTE.strawberryLeaf);
  lowPolyBlob(leaves, { x: 0, y: 0.26, z: 0 }, { radiusX: 0.22, radiusY: 0.2, radiusZ: 0.22, segments: 8, rings: 3 });
  leafFan(leaves, { y: 0.05 }, { count: 7, length: 0.32, width: 0.07, spread: 0.4, tilt: 0.6, droop: 0.6, seed: 61 });
  leafFan(leaves, { y: 0.16 }, { count: 5, length: 0.24, width: 0.06, spread: 0.6, tilt: 0.9, droop: 0.55, seed: 62 });

  const berry = part("berry", PALETTE.strawberryBerry);
  fruitCluster(berry, { x: -0.12, y: 0.16, z: 0.1 }, { count: 4, radius: 0.05, spread: 0.1, seed: 63 });
  fruitCluster(berry, { x: 0.13, y: 0.14, z: -0.08 }, { count: 3, radius: 0.045, spread: 0.09, seed: 64 });
  return [leaves, berry];
}

/** Cabbage: a single fat head with a skirt of outer leaves, unmistakably a leafy brassica. */
function buildCabbage() {
  const head = part("head", PALETTE.cabbageHead);
  lowPolyBlob(head, { x: 0, y: 0.46, z: 0 }, { radiusX: 0.3, radiusY: 0.42, radiusZ: 0.3, segments: 9, rings: 3 });

  const leaves = part("leaf", PALETTE.cabbageLeaf);
  leafFan(leaves, { y: 0.04 }, { count: 6, length: 0.34, width: 0.09, spread: 0.5, tilt: 0.5, droop: 0.7, seed: 71 });
  leafFan(leaves, { y: 0.18 }, { count: 4, length: 0.26, width: 0.08, spread: 0.7, tilt: 0.85, droop: 0.6, seed: 72 });
  return [head, leaves];
}

/** Pumpkin: a ribbed orange globe with a stubby green stem, the season's big payoff. */
function buildPumpkin() {
  const shell = part("shell", PALETTE.pumpkinShell);
  lowPolyBlob(shell, { x: 0, y: 0.34, z: 0 }, { radiusX: 0.32, radiusY: 0.34, radiusZ: 0.32, segments: 10, rings: 3 });
  lowPolyBlob(shell, { x: 0.16, y: 0.32, z: 0 }, { radiusX: 0.16, radiusY: 0.3, radiusZ: 0.3, segments: 6, rings: 2 });
  lowPolyBlob(shell, { x: -0.16, y: 0.32, z: 0 }, { radiusX: 0.16, radiusY: 0.3, radiusZ: 0.3, segments: 6, rings: 2 });

  const stem = part("stem", PALETTE.pumpkinStem);
  taperedCylinder(stem, { x: 0, y: 0.6, z: 0 }, { bottomRadius: 0.07, topRadius: 0.05, height: 0.22, segments: 6 });
  return [shell, stem];
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
 * A ship is a hull, a rig and its fittings, seen close in a fight: the art bible's ship row
 * (`docs/HAPPYFARM_ART_BIBLE.md`, section 9).
 */
const SHIP_BUDGET = { triangles: 1500, materials: 6, bytes: 110000 };

/**
 * Every generated model.
 *
 * `envelope` is what the artifact test asserts: base on `y = 0`, height exactly as stated, nothing
 * past `halfFootprint` on x or z. `budget` is the ceiling from the art bible.
 */
/**
 * The Làng Việt pack's budgets (docs/HAPPYFARM_ART_BIBLE.md, "Làng Việt"): a house or a monument is
 * seen close and turned about like a ship; a village piece or a tree is smaller and more numerous.
 */
const VILLAGE_BUDGETS = {
  building: { triangles: 1500, materials: 6, bytes: 110000 },
  piece: { triangles: 900, materials: 6, bytes: 70000 },
  tree: { triangles: 900, materials: 6, bytes: 70000 }
};

/**
 * Làng Việt: unit-fitted, so the client's manifest (`render/viet-model-urls.ts`) states each piece's
 * size in metres, the way the imported props and buildings do.
 */
const VILLAGE_SPECS = [...VIET_BUILDERS, ...VIET_REGION_BUILDERS].map(({ id, build, family }) => ({
  id,
  kind: "village",
  directory: "apps/web/src/assets/models/viet",
  fit: "unit",
  envelope: { height: 1, halfFootprint: 0.5 },
  budget: VILLAGE_BUDGETS[family],
  build
}));

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
    id: "crop_potato",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildPotato
  },
  {
    id: "crop_tomato",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildTomato
  },
  {
    id: "crop_strawberry",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildStrawberry
  },
  {
    id: "crop_cabbage",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildCabbage
  },
  {
    id: "crop_pumpkin",
    kind: "crop",
    directory: "apps/web/src/assets/models",
    envelope: { height: 1, halfFootprint: 0.5 },
    budget: { triangles: 400, materials: 4, bytes: 12000 },
    build: buildPumpkin
  },
  // Fish and resource nodes were generated here until 2026-11-15. They are imported CC0 models now
  // (Quaternius Cute Fish and Ultimate Fantasy RTS, via `import-fbx.mjs --set fish|resources`), so
  // the generator must not declare - or overwrite - them. See docs/ASSET_LICENSES.md.
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
  },
  // Ships (docs/design/NAVAL.md): built in metres, bow toward +z, keel at y = 0. The envelope height is
  // each ship's own built height, so the generator writes it at true size; the renderer scales it to the
  // battle's numbers. See `ships.mjs` for the references and `SHIP_DRAFT_SHARE` for the waterline.
  // Ghe: the free rowing boat every dock starts with.
  {
    id: "ship_rowboat",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 1.29, halfFootprint: 2.5 },
    budget: SHIP_BUDGET,
    build: buildShipRowboat
  },
  // Ghe bầu: one bat-wing sail.
  {
    id: "ship_sloop",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 9.27, halfFootprint: 5.5 },
    budget: SHIP_BUDGET,
    build: buildShipSloop
  },
  // Thuyền chiến: the two-masted war junk.
  {
    id: "ship_brig",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 11.35, halfFootprint: 7.1 },
    budget: SHIP_BUDGET,
    build: buildShipBrig
  },
  // Lâu thuyền rồng: castle, dragon prow, three sails.
  {
    id: "ship_frigate",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 13.71, halfFootprint: 9.6 },
    budget: SHIP_BUDGET,
    build: buildShipFrigate
  },
  // The fleet's new classes (docs/design/FLEET.md, F1).
  // Ghe câu: a line-fishing boat, rods out both sides.
  {
    id: "ship_line_boat",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 4.25, halfFootprint: 3.5 },
    budget: SHIP_BUDGET,
    build: buildShipLineBoat
  },
  // Ghe lưới: two sails and a net on deck.
  {
    id: "ship_net_boat",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 6.76, halfFootprint: 4.75 },
    budget: SHIP_BUDGET,
    build: buildShipNetBoat
  },
  // Tàu cá vỏ gỗ: wheelhouse aft, booms hung with squid lamps.
  {
    id: "ship_trawler",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 7.33, halfFootprint: 6.3 },
    budget: SHIP_BUDGET,
    build: buildShipTrawler
  },
  // Ghe bầu: the round-bellied coaster, jars and bales on deck.
  {
    id: "ship_coaster",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 9.05, halfFootprint: 5.8 },
    budget: SHIP_BUDGET,
    build: buildShipCoaster
  },
  // Thuyền mành: two mat sails over a roofed hold.
  {
    id: "ship_junk",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 10.71, halfFootprint: 6.9 },
    budget: SHIP_BUDGET,
    build: buildShipJunk
  },
  // Ghe chài: a broad cargo boat under a long arched roof.
  {
    id: "ship_cargo_junk",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 11.53, halfFootprint: 7.7 },
    budget: SHIP_BUDGET,
    build: buildShipCargoJunk
  },
  // Tàu buôn lớn: three mat sails and a red stern house.
  {
    id: "ship_great_junk",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 13.26, halfFootprint: 9.0 },
    budget: SHIP_BUDGET,
    build: buildShipGreatJunk
  },
  // Chiến hạm rồng: the dragon warship, four sails, gold at every end.
  {
    id: "ship_dragon",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 14.36, halfFootprint: 10.65 },
    budget: SHIP_BUDGET,
    build: buildShipDragon
  },
  // Tàu Ô: the pirates' black ships, smallest first.
  {
    id: "pirate_cutter",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 8.32, halfFootprint: 5.0 },
    budget: SHIP_BUDGET,
    build: buildPirateCutter
  },
  {
    id: "pirate_raider",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 10.41, halfFootprint: 6.6 },
    budget: SHIP_BUDGET,
    build: buildPirateRaider
  },
  {
    id: "pirate_corsair",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 12.78, halfFootprint: 8.2 },
    budget: SHIP_BUDGET,
    build: buildPirateCorsair
  },
  // Sea monsters (monsters.mjs): built like a ship, head toward +z, sunk deeper by the renderer.
  {
    id: "monster_thuong_luong",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 5.37, halfFootprint: 7.3 },
    budget: SHIP_BUDGET,
    build: buildThuongLuong
  },
  // Bạch tuộc khổng lồ: the giant octopus.
  {
    id: "monster_bach_tuoc",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 6.7, halfFootprint: 6.6 },
    budget: SHIP_BUDGET,
    build: buildBachTuoc
  },
  // Cua đá khổng lồ: the giant rock crab.
  {
    id: "monster_cua_da",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 5.67, halfFootprint: 5.3 },
    budget: SHIP_BUDGET,
    build: buildCuaDa
  },
  // Kình ngư: the leviathan fish.
  {
    id: "monster_kinh_ngu",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 6.91, halfFootprint: 8.45 },
    budget: SHIP_BUDGET,
    build: buildKinhNgu
  },
  // Sứa lửa: the fire jellyfish.
  {
    id: "monster_sua_lua",
    kind: "ship",
    directory: "apps/web/src/assets/models/ships",
    envelope: { height: 7.4, halfFootprint: 4.9 },
    budget: SHIP_BUDGET,
    build: buildSuaLua
  },
  // Làng Việt: houses, village pieces, fences and trees (viet.mjs).
  ...VILLAGE_SPECS
];
