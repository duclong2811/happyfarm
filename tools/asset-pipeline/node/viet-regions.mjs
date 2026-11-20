/**
 * Vùng miền: the regions of Việt Nam, each with the buildings and plants a traveller would know it by.
 *
 * Studied for their shapes, not copied from any drawing or game:
 *
 * - **Bắc Bộ**, the northern delta: the **đình làng** (communal house) under its great sweeping roof,
 *   the **gác chuông** (bell tower), the **cầu ngói** (tiled-roof bridge) over a pond, and the
 *   **cây gạo** (red silk-cotton tree) that flowers red in spring;
 * - **Trung Bộ**, the centre: the Huế **nhà rường** (timber house), the **cổng tam quan**
 *   (three-entrance gate), a **tháp Chăm** (Cham brick tower), the round **thuyền thúng** basket boat
 *   and the coconut palm;
 * - **Nam Bộ**, the Mekong: the **nhà lá** (nipa house), the **cầu khỉ** (monkey bridge) over a canal,
 *   the **xuồng ba lá** (three-plank boat) with a conical hat on its seat, the **dừa nước** (nipa palm)
 *   and the **chòi lá** (field hut);
 * - **Tây Nguyên**, the highlands: the **nhà rông** (communal house) with its axe-blade roof, the
 *   **cây nêu** (festival pole), a rack of **cồng chiêng** (gongs), coffee and **dã quỳ** (wild sunflower);
 * - **Tây Bắc**, the north-west: the **cọn nước** (bamboo water wheel), the H'Mông **nhà trình tường**
 *   (rammed-earth house) and **tam giác mạch** (buckwheat) in flower.
 *
 * Same conventions as `viet.mjs`: metres, standing on y = 0, front toward +z, unit-fitted by the
 * generator. A piece that needs water (a bridge, a water wheel) carries its own stretch of it, as the
 * lotus pond does, so it stands on ordinary ground.
 */

import { beam, facingQuad, facingTriangle, leafBlade, lowPolyBlob, part, seededRandom, sheetQuad, sheetTriangle, softBox, taperedBox, taperedCylinder } from "./glb.mjs";
import { add, archedSpan, blossom, branch, disc, eaveBand, faceDisc, hipRoof, lathe, lerp, ridgeDressing, VIET_PALETTE as C } from "./viet.mjs";

const R = {
  brickCham: 0xbd6a43,
  brickChamDark: 0x8e4a30,
  tileBrown: 0x8c5a46,
  tileGrey: 0x6c6660,
  tileGreyDark: 0x4c4744,
  earth: 0xc99a62,
  earthDark: 0xa57846,
  nipa: 0xab9a62,
  nipaDark: 0x857546,
  tar: 0x4a3828,
  bronze: 0xa7843e,
  mud: 0x9a7a52,
  coconutTrunk: 0x8f7a5a,
  coconut: 0x6f7f2c,
  gaoRed: 0xd8442e,
  coffeeRed: 0xc0342a,
  buckwheatStem: 0x9a4a5a,
  buckwheatPink: 0xe7a6cf,
  sunflower: 0xf6c61e,
  hat: 0xe6d29a
};

/** A strip of water between two banks, along x: a canal, a stream. */
function channel(water, bank, { length, width, bankWidth = 0.5, bankHeight = 0.12 }) {
  softBox(water, { y: 0.02 }, { width: length, depth: width, height: 0.04 });
  for (const side of [-1, 1]) {
    taperedBox(bank, { z: side * (width / 2 + bankWidth / 2) }, { width: length, depth: bankWidth, height: bankHeight, topScale: 0.85 });
  }
}

/** The tile courses down a hipped roof's front and back: dark ribs from eave to ridge. */
function tileCourses(target, roof, { courses, ridgeHalf, ridgeY, thickness = 0.045 }) {
  for (let course = 1; course < courses; course += 1) {
    const u = course / courses;
    for (const face of [0, 1]) {
      const eave = roof.eave(face, u);
      const ridgeX = lerp(face === 0 ? -ridgeHalf : ridgeHalf, face === 0 ? ridgeHalf : -ridgeHalf, u);
      beam(target, add(eave, [0, 0.03, 0]), [ridgeX, ridgeY, 0], thickness, { caps: false });
    }
  }
}

// --- Bắc Bộ ----------------------------------------------------------------------------------------

/** Đình làng: a long open hall of columns on a stone plinth under a great roof with swept corners. */
export function buildDinh() {
  const stone = part("viet_stone", C.slab);
  const timber = part("viet_timber", C.timber);
  const post = part("viet_timber_dark", C.timberDark);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const gold = part("viet_gold", C.gold);
  softBox(stone, { y: 0 }, { width: 6.4, depth: 4.4, height: 0.42 });
  softBox(stone, { y: 0, z: 2.45 }, { width: 2.0, depth: 0.5, height: 0.2 });
  softBox(timber, { y: 0.42, z: -1.55 }, { width: 5.4, depth: 0.12, height: 1.75 });
  for (const side of [-1, 1]) softBox(timber, { x: side * 2.7, y: 0.42 }, { width: 0.12, depth: 3.1, height: 1.75 });
  for (const x of [-2.6, -1.56, -0.52, 0.52, 1.56, 2.6]) {
    for (const z of [1.7, 0.55, -0.55, -1.5]) taperedCylinder(post, { x, y: 0.42, z }, { bottomRadius: 0.12, topRadius: 0.1, height: 1.85, segments: 8 });
  }
  beam(post, [-3.0, 2.27, 1.7], [3.0, 2.27, 1.7], 0.16);
  const roof = hipRoof(tile, { y: 2.2, width: 7.4, depth: 5.4, height: 2.2, ridge: 4.6, sag: 0.16, lift: 0.6, segments: 4 });
  tileCourses(tileDark, roof, { courses: 13, ridgeHalf: 2.3, ridgeY: 4.4 });
  ridgeDressing(tileDark, roof, { thickness: 0.24, curl: 0.7, tips: 0.6, tipOut: 0.25 });
  // Lưỡng long chầu nguyệt: the moon at the ridge's middle between two rising curls.
  faceDisc(gold, { y: 4.85, z: 0.04 }, { radius: 0.24, segments: 12 });
  for (const side of [-1, 1]) beam(gold, [side * 0.35, 4.45, 0], [side * 1.05, 4.75, 0], 0.12);
  return [stone, timber, post, tile, tileDark, gold];
}

/** Gác chuông: four red columns, a bronze bell, two tiers of curled roof. */
export function buildBellTower() {
  const stone = part("viet_stone", C.slab);
  const lacquer = part("viet_lacquer", C.lacquer);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const bronze = part("viet_bronze", R.bronze);
  softBox(stone, { y: 0 }, { width: 2.1, depth: 2.1, height: 0.3 });
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.7, 0.7]) taperedCylinder(lacquer, { x, y: 0.3, z }, { bottomRadius: 0.08, topRadius: 0.07, height: 2.4, segments: 8 });
  }
  const lower = hipRoof(tile, { y: 1.75, width: 2.3, depth: 2.3, height: 0.42, ridge: 1.3, sag: 0.1, lift: 0.3 });
  ridgeDressing(tileDark, { ...lower, ridgeLeft: [-0.65, 2.17, 0], ridgeRight: [0.65, 2.17, 0] }, { thickness: 0.06, curl: 0, tips: 0.24, tipOut: 0.12 });
  softBox(lacquer, { y: 2.15 }, { width: 1.2, depth: 1.2, height: 0.55 });
  const upper = hipRoof(tile, { y: 2.7, width: 2.0, depth: 2.0, height: 0.75, ridge: 0.5, sag: 0.16, lift: 0.36 });
  ridgeDressing(tileDark, upper, { thickness: 0.09, curl: 0.25, tips: 0.32, tipOut: 0.14 });
  beam(lacquer, [-0.7, 1.65, 0], [0.7, 1.65, 0], 0.09);
  lathe(bronze, [[0.32, 0.85], [0.3, 0.95], [0.24, 1.3], [0.2, 1.45], [0.06, 1.5]], { segments: 10 });
  beam(bronze, [0, 1.5, 0], [0, 1.65, 0], 0.05);
  return [stone, lacquer, tile, tileDark, bronze];
}

/** Cầu ngói: a humped wooden bridge under a tiled roof, across its own pond. */
export function buildTiledBridge() {
  const stone = part("viet_stone", C.slab);
  const water = part("viet_water", C.water);
  const timber = part("viet_timber", C.timber);
  const post = part("viet_timber_dark", C.timberDark);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  disc(water, { y: 0.05 }, { radiusX: 2.6, radiusZ: 1.45, segments: 16 });
  const random = seededRandom(23);
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    lowPolyBlob(stone, { x: Math.cos(angle) * 2.68, y: 0, z: Math.sin(angle) * 1.52 }, { radiusX: 0.3 + random() * 0.08, radiusY: 0.13, radiusZ: 0.22, segments: 6, rings: 2 });
  }
  // The deck humps over the water: planks laid on a curve along x.
  const deckY = (x) => 0.25 + 0.4 * Math.cos((x / 2.6) * (Math.PI / 2));
  const steps = 8;
  for (let index = 0; index < steps; index += 1) {
    const x0 = -2.6 + (index / steps) * 5.2;
    const x1 = -2.6 + ((index + 1) / steps) * 5.2;
    facingQuad(timber, [x0, deckY(x0), 0.6], [x1, deckY(x1), 0.6], [x1, deckY(x1), -0.6], [x0, deckY(x0), -0.6], [0, 1, 0]);
    facingQuad(timber, [x0, deckY(x0) - 0.1, 0.6], [x1, deckY(x1) - 0.1, 0.6], [x1, deckY(x1), 0.6], [x0, deckY(x0), 0.6], [0, 0, 1]);
    facingQuad(timber, [x0, deckY(x0) - 0.1, -0.6], [x1, deckY(x1) - 0.1, -0.6], [x1, deckY(x1), -0.6], [x0, deckY(x0), -0.6], [0, 0, -1]);
  }
  for (const x of [-1.9, -0.65, 0.65, 1.9]) {
    for (const z of [0.55, -0.55]) beam(post, [x, deckY(x), z], [x, deckY(x) + 1.35, z], 0.1);
    for (const z of [0.55, -0.55]) beam(post, [x, deckY(x) - 0.1, z], [x, 0.0, z], 0.12);
  }
  for (const z of [0.55, -0.55]) {
    for (let index = 0; index < steps; index += 1) {
      const x0 = -2.4 + (index / steps) * 4.8;
      const x1 = -2.4 + ((index + 1) / steps) * 4.8;
      beam(post, [x0, deckY(x0) + 0.5, z], [x1, deckY(x1) + 0.5, z], 0.06, { caps: false });
    }
  }
  const roof = hipRoof(tile, { y: 1.95, width: 4.9, depth: 1.75, height: 0.75, ridge: 3.6, sag: 0.14, lift: 0.3 });
  ridgeDressing(tileDark, roof, { thickness: 0.12, curl: 0.35, tips: 0.25, tipOut: 0.12 });
  return [stone, water, timber, post, tile, tileDark];
}

/** Cây gạo: a tall straight trunk, branches in level tiers, red flowers and few leaves. */
export function buildGaoTree() {
  const bark = part("viet_bark", 0x7a6a58);
  const flowers = part("viet_gao_red", R.gaoRed);
  const leaf = part("viet_leaf", C.leaf);
  const random = seededRandom(51);
  taperedCylinder(bark, { y: 0 }, { bottomRadius: 0.32, topRadius: 0.14, height: 5.6, segments: 8 });
  for (let root = 0; root < 4; root += 1) {
    const angle = (root / 4) * Math.PI * 2 + 0.4;
    beam(bark, [Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6], [Math.cos(angle) * 0.1, 0.7, Math.sin(angle) * 0.1], 0.2);
  }
  for (const [y, reach, count] of [[2.6, 1.7, 4], [3.6, 1.4, 4], [4.5, 1.0, 3], [5.3, 0.6, 3]]) {
    for (let limb = 0; limb < count; limb += 1) {
      const angle = (limb / count) * Math.PI * 2 + y;
      const tip = [Math.cos(angle) * reach, y + 0.25, Math.sin(angle) * reach];
      beam(bark, [0, y, 0], tip, 0.09, { caps: false });
      // One round puff of red per branch end: the gạo flowers before its leaves come.
      lowPolyBlob(flowers, { x: tip[0], y: tip[1] - 0.1, z: tip[2] }, { radiusX: 0.3, radiusY: 0.24, radiusZ: 0.3, segments: 6, rings: 3 });
      blossom(flowers, { x: tip[0], y: tip[1] + 0.12, z: tip[2] }, { radius: 0.3, count: 1, seed: Math.floor(random() * 1e6), mass: false });
      if (limb % 2 === 0) leafBlade(leaf, { x: tip[0] * 0.6, y: y + 0.15, z: tip[2] * 0.6 }, { length: 0.3, width: 0.1, yaw: angle, tilt: 0.3, droop: -0.2 });
    }
  }
  lowPolyBlob(flowers, { x: 0, y: 5.55, z: 0 }, { radiusX: 0.32, radiusY: 0.26, radiusZ: 0.32, segments: 6, rings: 3 });
  return [bark, flowers, leaf];
}

// --- Trung Bộ --------------------------------------------------------------------------------------

/** Nhà rường Huế: a timber house on a plinth, carved door panels, a brown tiled roof with gilt ridge. */
export function buildRuongHouse() {
  const stone = part("viet_stone", C.slab);
  const timber = part("viet_timber", C.timber);
  const post = part("viet_timber_dark", C.timberDark);
  const tile = part("viet_tile_brown", R.tileBrown);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const gold = part("viet_gold", C.gold);
  softBox(stone, { y: 0 }, { width: 4.4, depth: 3.3, height: 0.35 });
  softBox(stone, { y: 0, z: 1.82 }, { width: 1.6, depth: 0.36, height: 0.18 });
  softBox(timber, { y: 0.35, z: -0.2 }, { width: 3.8, depth: 2.3, height: 1.8 });
  // Five bays of panelled doors, the middle three opening onto the veranda.
  for (let bay = 0; bay < 5; bay += 1) {
    const x = -1.52 + bay * 0.76;
    softBox(post, { x, y: 0.42, z: 0.96 }, { width: 0.62, depth: 0.04, height: bay === 0 || bay === 4 ? 1.0 : 1.5 });
    for (const row of [0.62, 1.12]) softBox(timber, { x, y: 0.42 + row, z: 0.99 }, { width: 0.5, depth: 0.02, height: 0.05 });
  }
  for (const x of [-1.9, -1.14, -0.38, 0.38, 1.14, 1.9]) {
    taperedCylinder(post, { x, y: 0.35, z: 1.42 }, { bottomRadius: 0.09, topRadius: 0.08, height: 1.8, segments: 8 });
  }
  beam(post, [-2.1, 2.15, 1.42], [2.1, 2.15, 1.42], 0.14);
  const roof = hipRoof(tile, { y: 2.1, width: 4.9, depth: 3.9, height: 1.7, ridge: 2.6, sag: 0.1, lift: 0.18 });
  tileCourses(tileDark, roof, { courses: 11, ridgeHalf: 1.3, ridgeY: 3.8 });
  ridgeDressing(tileDark, roof, { thickness: 0.18, curl: 0.3, tips: 0.22, tipOut: 0.14 });
  // Gilt ornaments at the ridge's ends and middle: the dragons of a Huế roof, drawn as curls.
  for (const side of [-1, 1]) beam(gold, [side * 1.3, 3.85, 0], [side * 1.55, 4.3, 0], 0.11);
  lathe(gold, [[0.1, 3.85], [0.14, 3.95], [0.06, 4.2]], { segments: 8 });
  return [stone, timber, post, tile, tileDark, gold];
}

/** Cổng tam quan: three arches under three roofs, the middle one taller, a board over it. */
export function buildTamQuanGate() {
  const brick = part("viet_brick", C.brick);
  const lime = part("viet_lime", C.lime);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const lacquer = part("viet_lacquer", C.lacquer);
  const gold = part("viet_gold", C.gold);
  const depth = 0.9;
  for (const x of [-2.25, -1.0, 1.0, 2.25]) {
    const outer = Math.abs(x) > 2;
    softBox(brick, { x }, { width: 0.5, depth, height: outer ? 1.9 : 2.75 });
    softBox(lime, { x, y: outer ? 1.9 : 2.75 }, { width: 0.6, depth: depth + 0.1, height: 0.08 });
  }
  archedSpan(lime, { x0: -0.75, x1: 0.75, spring: 1.6, top: 2.75, z0: -depth / 2, z1: depth / 2 });
  for (const side of [-1, 1]) archedSpan(lime, { x0: side > 0 ? 1.25 : -2.0, x1: side > 0 ? 2.0 : -1.25, spring: 1.15, top: 1.9, z0: -depth / 2, z1: depth / 2 });
  softBox(lime, { y: 2.75 }, { width: 2.5, depth, height: 0.55 });
  softBox(gold, { y: 2.8, z: depth / 2 + 0.01 }, { width: 1.2, depth: 0.05, height: 0.42 });
  softBox(lacquer, { y: 2.84, z: depth / 2 + 0.04 }, { width: 1.08, depth: 0.04, height: 0.34 });
  const centre = hipRoof(tile, { y: 3.3, width: 3.0, depth: 1.5, height: 0.7, ridge: 1.9, sag: 0.14, lift: 0.26 });
  ridgeDressing(tileDark, centre, { thickness: 0.12, curl: 0.32, tips: 0.26, tipOut: 0.12 });
  for (const side of [-1, 1]) {
    const roof = hipRoof(tile, { x: side * 1.65, y: 1.98, width: 1.6, depth: 1.3, height: 0.48, ridge: 0.8, sag: 0.12, lift: 0.18 });
    ridgeDressing(tileDark, roof, { thickness: 0.09, curl: 0.18, tips: 0.18, tipOut: 0.1 });
  }
  faceDisc(gold, { y: 4.15, z: 0.03 }, { radius: 0.12, segments: 10 });
  return [brick, lime, tile, tileDark, lacquer, gold];
}

/** Tháp Chăm: a brick tower of stepped tiers, false doors on each face, a lotus-bud top. */
export function buildChamTower() {
  const brick = part("viet_brick_cham", R.brickCham);
  const brickDark = part("viet_brick_cham_dark", R.brickChamDark);
  const stone = part("viet_stone", C.slab);
  const ink = part("viet_ink", C.ink);
  softBox(stone, { y: 0 }, { width: 2.9, depth: 2.9, height: 0.35 });
  taperedBox(brick, { y: 0.35 }, { width: 2.3, depth: 2.3, height: 2.6, topScale: 0.94 });
  // A projecting doorway on the front, false doors on the other three faces.
  softBox(brick, { y: 0.35, z: 1.25 }, { width: 1.0, depth: 0.5, height: 2.3 });
  softBox(ink, { y: 0.35, z: 1.51 }, { width: 0.5, depth: 0.03, height: 1.2 });
  taperedBox(brickDark, { y: 2.65, z: 1.25 }, { width: 1.1, depth: 0.6, height: 0.6, topScale: 0.3 });
  for (const [x, z] of [[1.17, 0], [-1.17, 0], [0, -1.17]]) {
    softBox(brickDark, { x, y: 0.7, z }, { width: x === 0 ? 0.7 : 0.12, depth: x === 0 ? 0.12 : 0.7, height: 1.6 });
  }
  for (const [x, z] of [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) softBox(brickDark, { x, y: 0.35, z }, { width: 0.22, depth: 0.22, height: 2.6 });
  let y = 2.95;
  let size = 2.1;
  for (let tier = 0; tier < 3; tier += 1) {
    softBox(brickDark, { y }, { width: size + 0.15, depth: size + 0.15, height: 0.12 });
    taperedBox(brick, { y: y + 0.12 }, { width: size, depth: size, height: 0.75 - tier * 0.12, topScale: 0.92 });
    for (const [cx, cz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      taperedBox(brickDark, { x: (cx * size) / 2, y: y + 0.12, z: (cz * size) / 2 }, { width: 0.26, depth: 0.26, height: 0.5, topScale: 0.3 });
    }
    y += 0.87 - tier * 0.12;
    size *= 0.72;
  }
  lathe(brick, [[0.35, y], [0.42, y + 0.25], [0.32, y + 0.6], [0.1, y + 0.9], [0.02, y + 1.0]], { segments: 8 });
  return [brick, brickDark, stone, ink];
}

/** Thuyền thúng: a round woven basket boat, tarred dark, an oar across it and a net beside it. */
export function buildBasketBoat() {
  const tar = part("viet_tar", R.tar);
  const bamboo = part("viet_bamboo", C.bamboo);
  const net = part("viet_net", 0x9c8c6a);
  lathe(tar, [[0.0, 0.0], [0.7, 0.04], [0.95, 0.28], [1.0, 0.48]], { segments: 14, capTop: false });
  lathe(tar, [[1.0, 0.48], [0.9, 0.44], [0.68, 0.14], [0.0, 0.1]], { segments: 14, capBottom: false, capTop: false });
  lathe(bamboo, [[1.02, 0.44], [1.04, 0.52], [0.96, 0.52], [0.95, 0.46]], { segments: 14, capBottom: false, capTop: false });
  beam(bamboo, [0, 0.52, -0.95], [0, 0.52, 0.95], 0.07);
  beam(bamboo, [-0.7, 0.55, 0.3], [1.6, 0.25, 0.9], 0.06);
  facingQuad(bamboo, [1.45, 0.29, 0.83], [1.7, 0.22, 0.93], [1.66, 0.04, 1.16], [1.4, 0.1, 1.05], [0, 1, 0.3]);
  lowPolyBlob(net, { x: -1.35, y: 0, z: 0.4 }, { radiusX: 0.38, radiusY: 0.14, radiusZ: 0.3, segments: 7, rings: 3 });
  return [tar, bamboo, net];
}

/** Cây dừa: a curving trunk leaning out, a crown of long fronds, a cluster of green coconuts. */
export function buildCoconutPalm() {
  const trunk = part("viet_palm_trunk", R.coconutTrunk);
  const frond = part("viet_leaf_light", C.leafLight);
  const nut = part("viet_coconut", R.coconut);
  const points = [];
  for (let index = 0; index <= 7; index += 1) {
    const t = index / 7;
    points.push([0.9 * t * t, 5.0 * t, 0.15 * t]);
  }
  for (let index = 0; index + 1 < points.length; index += 1) beam(trunk, points[index], points[index + 1], lerp(0.26, 0.16, index / 6), { caps: index === points.length - 2 });
  const top = points[points.length - 1];
  for (let index = 0; index < 9; index += 1) {
    leafBlade(frond, { x: top[0], y: top[1] + 0.05, z: top[2] }, { length: 2.0, width: 0.3, yaw: (index / 9) * Math.PI * 2, tilt: index % 2 === 0 ? 0.35 : 0.12, droop: -0.85 });
  }
  for (let index = 0; index < 5; index += 1) {
    const a = index * 1.3;
    lowPolyBlob(nut, { x: top[0] + Math.cos(a) * 0.17, y: top[1] - 0.32, z: top[2] + Math.sin(a) * 0.17 }, { radiusX: 0.13, radiusY: 0.13, radiusZ: 0.13, segments: 6, rings: 3 });
  }
  return [trunk, frond, nut];
}

// --- Nam Bộ ----------------------------------------------------------------------------------------

/** Nhà lá: a low house of nipa-leaf walls and thatch, raised a little on posts, a porch in front. */
export function buildNipaHouse() {
  const wall = part("viet_nipa", R.nipa);
  const roofPart = part("viet_nipa_dark", R.nipaDark);
  const post = part("viet_timber_dark", C.timberDark);
  const bamboo = part("viet_bamboo", C.bamboo);
  const ink = part("viet_ink", C.ink);
  for (const x of [-1.3, 0, 1.3]) {
    for (const z of [-1.0, 0.0, 1.0, 1.7]) beam(post, [x, 0, z], [x, 0.45, z], 0.12);
  }
  softBox(bamboo, { y: 0.4, z: 0.35 }, { width: 2.9, depth: 2.9, height: 0.08 });
  softBox(wall, { y: 0.48, z: -0.15 }, { width: 2.6, depth: 1.9, height: 1.35 });
  for (let seam = 0; seam < 9; seam += 1) softBox(roofPart, { x: -1.2 + seam * 0.3, y: 0.48, z: 0.81 }, { width: 0.03, depth: 0.02, height: 1.35 });
  softBox(ink, { y: 0.48, z: 0.82 }, { width: 0.6, depth: 0.03, height: 1.05 });
  softBox(ink, { x: 0.85, y: 0.98, z: 0.82 }, { width: 0.45, depth: 0.03, height: 0.35 });
  for (const x of [-1.3, 1.3]) beam(bamboo, [x, 0.48, 1.7], [x, 1.55, 1.7], 0.08);
  const roof = hipRoof(roofPart, { y: 1.55, z: 0.25, width: 3.4, depth: 3.3, height: 1.4, ridge: 2.2, sag: 0.04, lift: 0.0 });
  eaveBand(wall, roof, { thickness: 0.14 });
  ridgeDressing(post, roof, { thickness: 0.12, curl: 0 });
  return [wall, roofPart, post, bamboo, ink];
}

/** Cầu khỉ: a single bamboo pole on crossed legs, one handrail, over its own muddy canal. */
export function buildMonkeyBridge() {
  const water = part("viet_water", C.water);
  const bank = part("viet_mud", R.mud);
  const bamboo = part("viet_bamboo", C.bamboo);
  const green = part("viet_bamboo_green", C.bambooGreen);
  channel(water, bank, { length: 1.6, width: 1.6, bankWidth: 1.2, bankHeight: 0.1 });
  // The bridge runs across the canal, along z, from bank to bank.
  beam(bamboo, [0, 0.95, -1.9], [0, 0.95, 1.9], 0.09);
  for (const z of [-1.4, 0, 1.4]) {
    beam(green, [-0.4, 0, z], [0.12, 1.0, z], 0.07);
    beam(green, [0.4, 0, z], [-0.12, 1.0, z], 0.07);
  }
  beam(bamboo, [0.32, 1.65, -1.8], [0.32, 1.65, 1.8], 0.06);
  for (const z of [-1.8, -0.6, 0.6, 1.8]) beam(green, [0.32, 0.95, z], [0.32, 1.68, z], 0.05);
  for (const z of [-1.9, 1.9]) beam(green, [0, 0, z], [0, 0.95, z], 0.08);
  return [water, bank, bamboo, green];
}

/** Xuồng ba lá: a slim three-plank boat on the bank, an oar along it and a conical hat on the seat. */
export function buildSampan() {
  const wood = part("viet_timber", C.timber);
  const dark = part("viet_timber_dark", C.timberDark);
  const hat = part("viet_hat", R.hat);
  const length = 3.2;
  const stations = 8;
  const half = (t) => 0.42 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)) ** 0.9);
  const sheer = (t) => 0.38 + 0.18 * (2 * t - 1) ** 4;
  const at = (t, side, up) => [-length / 2 + t * length, up ? sheer(t) : 0.04, side * (up ? half(t) : half(t) * 0.55)];
  for (let index = 0; index < stations; index += 1) {
    const t0 = index / stations;
    const t1 = (index + 1) / stations;
    for (const side of [-1, 1]) {
      facingQuad(wood, at(t0, side, false), at(t1, side, false), at(t1, side, true), at(t0, side, true), [0, 0.2, side]);
      facingQuad(dark, at(t0, side, true), at(t1, side, true), add(at(t1, side, true), [0, -0.06, -side * 0.03]), add(at(t0, side, true), [0, -0.06, -side * 0.03]), [0, 1, 0]);
    }
    facingQuad(wood, at(t0, -1, false), at(t1, -1, false), at(t1, 1, false), at(t0, 1, false), [0, -1, 0]);
    facingQuad(dark, add(at(t0, -1, false), [0, 0.02, 0]), add(at(t1, -1, false), [0, 0.02, 0]), add(at(t1, 1, false), [0, 0.02, 0]), add(at(t0, 1, false), [0, 0.02, 0]), [0, 1, 0]);
  }
  softBox(dark, { x: 0.3, y: 0.22 }, { width: 0.2, depth: 0.7, height: 0.06 });
  beam(dark, [-1.2, 0.3, 0.12], [1.0, 0.36, 0.22], 0.05);
  // The nón lá: a shallow cone resting on the seat.
  lathe(hat, [[0.24, 0.28], [0.0, 0.42]], { x: 0.3, segments: 10 });
  return [wood, dark, hat];
}

/** Dừa nước: long fronds rising straight from the mud in a fan, a brown fruit head at their foot. */
export function buildNipaPalm() {
  const frond = part("viet_leaf", C.leaf);
  const fruit = part("viet_nipa_fruit", 0x6e4a2c);
  for (let index = 0; index < 9; index += 1) {
    const yaw = (index / 9) * Math.PI * 2 + (index % 2) * 0.2;
    leafBlade(frond, { x: 0, y: 0, z: 0 }, { length: 2.6, width: 0.3, yaw, tilt: 1.32 - (index % 3) * 0.12, droop: -0.3 });
  }
  lowPolyBlob(fruit, { x: 0.25, y: 0.1, z: 0.15 }, { radiusX: 0.2, radiusY: 0.18, radiusZ: 0.2, segments: 7, rings: 3 });
  return [frond, fruit];
}

/** Chòi lá: a lookout hut over the paddies, on four bamboo legs, with a thatched A roof and a ladder. */
export function buildFieldHut() {
  const bamboo = part("viet_bamboo", C.bamboo);
  const thatch = part("viet_straw", C.straw);
  const thatchDark = part("viet_straw_dark", C.strawDark);
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.7, 0.7]) beam(bamboo, [x * 1.05, 0, z * 1.05], [x, 2.6, z], 0.09);
  }
  softBox(bamboo, { y: 1.3 }, { width: 1.6, depth: 1.6, height: 0.07 });
  for (const z of [-0.78, 0.78]) beam(bamboo, [-0.78, 1.65, z], [0.78, 1.65, z], 0.05);
  for (const x of [-0.25, 0.25]) beam(bamboo, [x, 0, 1.45], [x, 1.32, 0.82], 0.06);
  for (let rung = 1; rung < 5; rung += 1) {
    const t = rung / 5;
    beam(bamboo, [-0.25, 1.32 * t, lerp(1.45, 0.82, t)], [0.25, 1.32 * t, lerp(1.45, 0.82, t)], 0.04);
  }
  const roof = hipRoof(thatch, { y: 2.45, width: 2.2, depth: 2.1, height: 1.0, ridge: 1.4, sag: 0.04, lift: 0 });
  eaveBand(thatchDark, roof, { thickness: 0.14 });
  ridgeDressing(thatchDark, roof, { thickness: 0.12, curl: 0 });
  return [bamboo, thatch, thatchDark];
}

// --- Tây Nguyên ------------------------------------------------------------------------------------

/** Nhà rông: a hall on stilts under a towering thatched roof shaped like an axe blade. */
export function buildNhaRong() {
  const post = part("viet_timber_dark", C.timberDark);
  const floor = part("viet_timber", C.timber);
  const thatch = part("viet_straw", C.straw);
  const thatchDark = part("viet_straw_dark", C.strawDark);
  const lacquer = part("viet_lacquer", C.lacquer);
  const ink = part("viet_ink", C.ink);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    for (const z of [-1.1, 0, 1.1]) taperedCylinder(post, { x, y: 0, z }, { bottomRadius: 0.13, topRadius: 0.11, height: 1.5, segments: 6 });
  }
  softBox(floor, { y: 1.5 }, { width: 3.5, depth: 2.7, height: 0.14 });
  softBox(floor, { y: 1.64 }, { width: 3.2, depth: 2.3, height: 0.9 });
  softBox(ink, { y: 1.64, z: 1.16 }, { width: 0.6, depth: 0.03, height: 0.8 });
  // The roof: front and back slopes from short eaves up to a ridge longer than the house, so each gable
  // end is a tall blade that leans outward.
  const eaveY = 2.4;
  const ridgeY = 8.2;
  const eaveHalf = 1.9;
  const ridgeHalf = 2.7;
  const depthHalf = 1.65;
  const eave = (side, front) => [side * eaveHalf, eaveY, front * depthHalf];
  const ridge = (side) => [side * ridgeHalf, ridgeY, 0];
  for (const front of [1, -1]) {
    sheetQuad(thatch, eave(-1, front), eave(1, front), ridge(1), ridge(-1));
    sheetQuad(thatchDark, eave(-1, front), eave(1, front), add(eave(1, front), [0, -0.18, front * 0.05]), add(eave(-1, front), [0, -0.18, front * 0.05]));
  }
  for (const side of [-1, 1]) sheetTriangle(thatch, eave(side, 1), eave(side, -1), ridge(side));
  beam(thatchDark, ridge(-1), ridge(1), 0.2);
  for (const side of [-1, 1]) beam(lacquer, ridge(side), add(ridge(side), [side * 0.35, 0.55, 0]), 0.12);
  // The stair to the door: a carved log with notches, and a post beside it.
  beam(post, [0, 0, 2.35], [0, 1.5, 1.38], 0.22);
  for (let notch = 1; notch < 4; notch += 1) {
    const t = notch / 4;
    softBox(floor, { y: 1.5 * t - 0.03, z: lerp(2.35, 1.38, t) }, { width: 0.3, depth: 0.12, height: 0.05 });
  }
  beam(lacquer, [0.45, 0, 2.2], [0.45, 2.3, 2.2], 0.1);
  return [post, floor, thatch, thatchDark, lacquer, ink];
}

/** Cây nêu: a tall bamboo pole with a leafy top, a cross bar hung with bells and red and gold charms. */
export function buildCayNeu() {
  const bamboo = part("viet_bamboo_green", C.bambooGreen);
  const leaf = part("viet_leaf_light", C.leafLight);
  const red = part("viet_lantern_red", C.lanternRed);
  const gold = part("viet_gold", C.gold);
  for (let joint = 0; joint < 6; joint += 1) beam(bamboo, [0, joint * 0.95, 0], [0, (joint + 1) * 0.95, 0], lerp(0.09, 0.05, joint / 5), { caps: false });
  for (let blade = 0; blade < 6; blade += 1) leafBlade(leaf, { x: 0, y: 5.7, z: 0 }, { length: 0.6, width: 0.1, yaw: blade * 1.05, tilt: 0.7, droop: -0.4 });
  beam(bamboo, [-0.55, 5.0, 0], [0.55, 5.0, 0], 0.04);
  for (const [x, colour] of [[-0.5, red], [-0.25, gold], [0, red], [0.25, gold], [0.5, red]]) {
    beam(gold, [x, 5.0, 0], [x, 4.6, 0], 0.012, { caps: false });
    lowPolyBlob(colour, { x, y: 4.45, z: 0 }, { radiusX: 0.07, radiusY: 0.1, radiusZ: 0.07, segments: 6, rings: 3 });
  }
  facingQuad(red, [0, 5.45, 0], [0.5, 5.4, 0], [0.5, 5.15, 0], [0, 5.2, 0], [0, 0, 1]);
  facingQuad(red, [0, 5.45, 0], [0.5, 5.4, 0], [0.5, 5.15, 0], [0, 5.2, 0], [0, 0, -1]);
  softBox(gold, { y: 0 }, { width: 0.3, depth: 0.3, height: 0.12 });
  return [bamboo, leaf, red, gold];
}

/** Giá cồng chiêng: a carved frame hung with five bronze gongs, a mallet against its foot. */
export function buildGongRack() {
  const timber = part("viet_timber_dark", C.timberDark);
  const bronze = part("viet_bronze", R.bronze);
  const boss = part("viet_gold", C.gold);
  for (const x of [-1.2, 1.2]) beam(timber, [x, 0, 0], [x, 1.7, 0], 0.12);
  beam(timber, [-1.4, 1.6, 0], [1.4, 1.6, 0], 0.12);
  for (const x of [-1.4, 1.4]) beam(timber, [x, 1.6, 0], [x * 1.08, 1.8, 0], 0.1);
  for (const x of [-1.2, 1.2]) beam(timber, [x - 0.3, 0, 0], [x + 0.3, 0, 0], 0.12);
  const gongs = [[-0.8, 0.28], [-0.4, 0.23], [0, 0.32], [0.42, 0.25], [0.82, 0.2]];
  for (const [x, r] of gongs) {
    const y = 1.5 - r - 0.08;
    beam(timber, [x, 1.6, 0], [x, y + r, 0], 0.02, { caps: false });
    for (const face of [1, -1]) {
      for (let index = 0; index < 12; index += 1) {
        const a0 = (index / 12) * Math.PI * 2;
        const a1 = ((index + 1) / 12) * Math.PI * 2;
        facingTriangle(bronze, [x, y, face * 0.04], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, face * 0.02], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, face * 0.02], [0, 0, face]);
      }
    }
    lowPolyBlob(boss, { x, y: y - r * 0.2, z: 0.04 }, { radiusX: r * 0.22, radiusY: r * 0.2, radiusZ: r * 0.18, segments: 6, rings: 2 });
  }
  beam(timber, [0.9, 0, 0.35], [1.15, 0.6, 0.3], 0.05);
  lowPolyBlob(bronze, { x: 1.17, y: 0.55, z: 0.3 }, { radiusX: 0.07, radiusY: 0.07, radiusZ: 0.07, segments: 5, rings: 2 });
  return [timber, bronze, boss];
}

/** Cây cà phê: a dense bush of glossy leaves, red cherries along its branches. */
export function buildCoffeeShrub() {
  const leaf = part("viet_leaf_deep", C.leafDeep);
  const cherry = part("viet_coffee_red", R.coffeeRed);
  const stem = part("viet_bark", 0x5e4634);
  const random = seededRandom(61);
  beam(stem, [0, 0, 0], [0, 0.5, 0], 0.08);
  for (const [x, y, z, r] of [[0, 1.05, 0, 0.55], [0.38, 0.75, 0.15, 0.42], [-0.35, 0.8, -0.1, 0.44], [0.05, 0.7, -0.42, 0.4], [-0.1, 0.7, 0.42, 0.4]]) {
    lowPolyBlob(leaf, { x, y: y - r * 0.6, z }, { radiusX: r, radiusY: r * 0.7, radiusZ: r, segments: 7, rings: 3 });
  }
  for (let index = 0; index < 16; index += 1) {
    const angle = random() * Math.PI * 2;
    const r = 0.45 + random() * 0.2;
    lowPolyBlob(cherry, { x: Math.cos(angle) * r, y: 0.45 + random() * 0.7, z: Math.sin(angle) * r }, { radiusX: 0.045, radiusY: 0.045, radiusZ: 0.045, segments: 4, rings: 2 });
  }
  return [leaf, cherry, stem];
}

/** Dã quỳ: a tall bush of the highlands' wild sunflower, big yellow daisies over green leaves. */
export function buildWildSunflower() {
  const leaf = part("viet_leaf", C.leaf);
  const petal = part("viet_sunflower", R.sunflower);
  const heart = part("viet_bark", 0x7a4a24);
  const random = seededRandom(71);
  for (let index = 0; index < 4; index += 1) {
    const a = index * 1.6;
    lowPolyBlob(leaf, { x: Math.cos(a) * 0.3, y: 0.15 + index * 0.1, z: Math.sin(a) * 0.3 }, { radiusX: 0.38, radiusY: 0.3, radiusZ: 0.36, segments: 7, rings: 3 });
  }
  for (let flower = 0; flower < 9; flower += 1) {
    const a = random() * Math.PI * 2;
    const r = 0.2 + random() * 0.45;
    const at = [Math.cos(a) * r, 1.15 + random() * 0.55, Math.sin(a) * r];
    beam(leaf, [at[0] * 0.5, 0.6, at[2] * 0.5], at, 0.025, { caps: false });
    lowPolyBlob(heart, { x: at[0], y: at[1] - 0.03, z: at[2] }, { radiusX: 0.08, radiusY: 0.05, radiusZ: 0.08, segments: 5, rings: 2 });
    for (let p = 0; p < 7; p += 1) {
      const pa = (p / 7) * Math.PI * 2 + a;
      facingTriangle(petal, add(at, [Math.cos(pa - 0.22) * 0.07, 0.02, Math.sin(pa - 0.22) * 0.07]), add(at, [Math.cos(pa) * 0.3, -0.04, Math.sin(pa) * 0.3]), add(at, [Math.cos(pa + 0.22) * 0.07, 0.02, Math.sin(pa + 0.22) * 0.07]), [0, 1, 0]);
    }
  }
  return [leaf, petal, heart];
}

// --- Tây Bắc ---------------------------------------------------------------------------------------

/** Cọn nước: a bamboo water wheel on a log frame, dipping its tubes into a stream. */
export function buildWaterWheel() {
  const water = part("viet_water", C.water);
  const bank = part("viet_stone", C.slab);
  const bamboo = part("viet_bamboo", C.bamboo);
  const green = part("viet_bamboo_green", C.bambooGreen);
  const frame = part("viet_timber_dark", C.timberDark);
  channel(water, bank, { length: 3.2, width: 1.0, bankWidth: 0.5, bankHeight: 0.18 });
  const centre = [0, 1.25, 0];
  const radius = 1.25;
  const spokes = 12;
  for (const z of [-0.18, 0.18]) {
    for (let index = 0; index < spokes; index += 1) {
      const a0 = (index / spokes) * Math.PI * 2;
      const a1 = ((index + 1) / spokes) * Math.PI * 2;
      beam(bamboo, [Math.cos(a0) * radius, centre[1] + Math.sin(a0) * radius, z], [Math.cos(a1) * radius, centre[1] + Math.sin(a1) * radius, z], 0.06, { caps: false });
      if (index % 2 === 0) beam(green, [0, centre[1], z], [Math.cos(a0) * radius, centre[1] + Math.sin(a0) * radius, z], 0.045, { caps: false });
    }
  }
  for (let index = 0; index < spokes; index += 1) {
    const a = (index / spokes) * Math.PI * 2 + 0.1;
    const p = [Math.cos(a) * (radius + 0.02), centre[1] + Math.sin(a) * (radius + 0.02), 0];
    beam(green, add(p, [0, 0, -0.32]), add(p, [0.12, 0.08, 0.32]), 0.08);
  }
  beam(frame, [0, centre[1], -0.75], [0, centre[1], 0.75], 0.1);
  for (const z of [-0.75, 0.75]) {
    beam(frame, [-0.6, 0, z], [0, centre[1], z], 0.12);
    beam(frame, [0.6, 0, z], [0, centre[1], z], 0.12);
  }
  // The trough it pours into, on the bank.
  beam(green, [0.2, 2.35, 0.3], [1.6, 1.8, 0.75], 0.12);
  return [water, bank, bamboo, green, frame];
}

/** Nhà trình tường: thick rammed-earth walls, small windows, a low roof of dark yin-yang tiles. */
export function buildRammedEarthHouse() {
  const earth = part("viet_earth", R.earth);
  const earthDark = part("viet_earth_dark", R.earthDark);
  const timber = part("viet_timber", C.timber);
  const tile = part("viet_tile_grey", R.tileGrey);
  const tileDark = part("viet_tile_grey_dark", R.tileGreyDark);
  const ink = part("viet_ink", C.ink);
  softBox(earthDark, { y: 0 }, { width: 3.9, depth: 2.9, height: 0.22 });
  taperedBox(earth, { y: 0.22 }, { width: 3.6, depth: 2.6, height: 1.9, topScale: 0.97 });
  for (const y of [0.75, 1.35]) softBox(earthDark, { y, z: 1.27 }, { width: 3.52, depth: 0.04, height: 0.04 });
  softBox(timber, { y: 0.22, z: 1.29 }, { width: 0.75, depth: 0.06, height: 1.3 });
  for (const x of [-1.1, 1.1]) softBox(ink, { x, y: 1.1, z: 1.29 }, { width: 0.32, depth: 0.04, height: 0.32 });
  const roof = hipRoof(tile, { y: 2.08, width: 4.3, depth: 3.3, height: 1.15, ridge: 2.8, sag: 0.06, lift: 0.05 });
  tileCourses(tileDark, roof, { courses: 12, ridgeHalf: 1.4, ridgeY: 3.23, thickness: 0.05 });
  ridgeDressing(tileDark, roof, { thickness: 0.16, curl: 0.12 });
  // A short wooden fence before the door.
  for (const x of [-1.6, -0.9, 0.9, 1.6]) beam(timber, [x, 0, 1.9], [x, 0.7, 1.9], 0.07);
  for (const side of [-1, 1]) beam(timber, [side * 1.6, 0.55, 1.9], [side * 0.9, 0.55, 1.9], 0.05);
  return [earth, earthDark, timber, tile, tileDark, ink];
}

/** Tam giác mạch: a clump of buckwheat, red stems and heart leaves under sprays of pink flowers. */
export function buildBuckwheat() {
  const stem = part("viet_buckwheat_stem", R.buckwheatStem);
  const flower = part("viet_buckwheat_pink", R.buckwheatPink);
  const leaf = part("viet_leaf", C.leaf);
  const random = seededRandom(83);
  for (let index = 0; index < 11; index += 1) {
    const a = random() * Math.PI * 2;
    const r = random() * 0.38;
    const top = [Math.cos(a) * r * 1.3, 0.45 + random() * 0.25, Math.sin(a) * r * 1.3];
    beam(stem, [Math.cos(a) * r * 0.5, 0, Math.sin(a) * r * 0.5], top, 0.025, { caps: false });
    lowPolyBlob(flower, { x: top[0], y: top[1] - 0.04, z: top[2] }, { radiusX: 0.07, radiusY: 0.06, radiusZ: 0.07, segments: 5, rings: 2 });
    blossom(flower, { x: top[0], y: top[1] + 0.02, z: top[2] }, { radius: 0.1, count: 2, seed: Math.floor(random() * 1e6), mass: false });
    if (index % 2 === 0) leafBlade(leaf, { x: top[0] * 0.7, y: top[1] * 0.5, z: top[2] * 0.7 }, { length: 0.16, width: 0.08, yaw: a, tilt: 0.3, droop: -0.2 });
  }
  return [stem, flower, leaf];
}

/** The regions, in the shop's order: north to south, then the highlands and the north-west. */
export const VIET_REGION_BUILDERS = [
  { id: "viet_dinh", build: buildDinh, family: "building", region: "viet_bac" },
  { id: "viet_bell_tower", build: buildBellTower, family: "building", region: "viet_bac" },
  { id: "viet_bridge_tiled", build: buildTiledBridge, family: "building", region: "viet_bac" },
  { id: "viet_tree_gao", build: buildGaoTree, family: "tree", region: "viet_bac" },
  { id: "viet_house_ruong", build: buildRuongHouse, family: "building", region: "viet_trung" },
  { id: "viet_gate_tam_quan", build: buildTamQuanGate, family: "building", region: "viet_trung" },
  { id: "viet_cham_tower", build: buildChamTower, family: "building", region: "viet_trung" },
  { id: "viet_basket_boat", build: buildBasketBoat, family: "piece", region: "viet_trung" },
  { id: "viet_tree_coconut", build: buildCoconutPalm, family: "tree", region: "viet_trung" },
  { id: "viet_house_nipa", build: buildNipaHouse, family: "building", region: "viet_nam_bo" },
  { id: "viet_monkey_bridge", build: buildMonkeyBridge, family: "piece", region: "viet_nam_bo" },
  { id: "viet_sampan", build: buildSampan, family: "piece", region: "viet_nam_bo" },
  { id: "viet_nipa_palm", build: buildNipaPalm, family: "tree", region: "viet_nam_bo" },
  { id: "viet_field_hut", build: buildFieldHut, family: "piece", region: "viet_nam_bo" },
  { id: "viet_nha_rong", build: buildNhaRong, family: "building", region: "viet_tay_nguyen" },
  { id: "viet_cay_neu", build: buildCayNeu, family: "piece", region: "viet_tay_nguyen" },
  { id: "viet_gong_rack", build: buildGongRack, family: "piece", region: "viet_tay_nguyen" },
  { id: "viet_coffee_shrub", build: buildCoffeeShrub, family: "tree", region: "viet_tay_nguyen" },
  { id: "viet_wild_sunflower", build: buildWildSunflower, family: "tree", region: "viet_tay_nguyen" },
  { id: "viet_water_wheel", build: buildWaterWheel, family: "piece", region: "viet_tay_bac" },
  { id: "viet_house_rammed", build: buildRammedEarthHouse, family: "building", region: "viet_tay_bac" },
  { id: "viet_buckwheat", build: buildBuckwheat, family: "tree", region: "viet_tay_bac" }
];
