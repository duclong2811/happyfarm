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
import { add, archedSpan, branch, disc, eaveBand, faceDisc, hipRoof, horn, icoBlob, lathe, lerp, pinnateFrond, ridgeDressing, tileCourses, VIET_PALETTE as C } from "./viet.mjs";

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
    for (const z of [1.7, 0.4, -0.9]) taperedCylinder(post, { x, y: 0.42, z }, { bottomRadius: 0.12, topRadius: 0.1, height: 1.85, segments: 6 });
  }
  beam(post, [-3.0, 2.27, 1.7], [3.0, 2.27, 1.7], 0.16);
  const roof = hipRoof(tile, { y: 2.2, width: 7.4, depth: 5.4, height: 2.2, ridge: 4.6, sag: 0.16, lift: 0.5, segments: 4 });
  tileCourses(tileDark, roof, { courses: 12, thickness: 0.05 });
  ridgeDressing(tileDark, roof, { thickness: 0.26, curl: 0.7, tips: 0.6, tipOut: 0.3 });
  // Lưỡng long chầu nguyệt: the moon at the ridge's middle between two rising curls.
  faceDisc(gold, { y: 4.85, z: 0.04 }, { radius: 0.24, segments: 12 });
  for (const side of [-1, 1]) horn(gold, [side * 1.2, 4.45, 0], { out: [-side, 0], length: 0.75, rise: 0.4, thickness: 0.12, hook: 0.2 });
  return [stone, timber, post, tile, tileDark, gold];
}

/**
 * Gác chuông, "chồng diêm": two tiers of roof, one above the other. Red columns carry the lower roof;
 * above it a short open storey hangs the bronze bell, under a smaller roof with swept corners.
 */
export function buildBellTower() {
  const stone = part("viet_stone", C.slab);
  const lacquer = part("viet_lacquer", C.lacquer);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const bronze = part("viet_bronze", R.bronze);
  softBox(stone, { y: 0 }, { width: 2.3, depth: 2.3, height: 0.3 });
  softBox(stone, { y: 0, z: 1.3 }, { width: 0.8, depth: 0.3, height: 0.15 });
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.72, 0.72]) taperedCylinder(lacquer, { x, y: 0.3, z }, { bottomRadius: 0.09, topRadius: 0.08, height: 1.95, segments: 7 });
  }
  for (const z of [-0.72, 0.72]) beam(lacquer, [-0.8, 2.2, z], [0.8, 2.2, z], 0.1);
  for (const x of [-0.72, 0.72]) beam(lacquer, [x, 2.2, -0.8], [x, 2.2, 0.8], 0.1);
  const lower = hipRoof(tile, { y: 2.0, width: 2.7, depth: 2.7, height: 0.55, ridge: 1.3, sag: 0.12, lift: 0.26, segments: 3 });
  tileCourses(tileDark, lower, { courses: 5, thickness: 0.035 });
  ridgeDressing(tileDark, lower, { thickness: 0.08, curl: 0, tips: 0.28, tipOut: 0.12, hips: true });
  // The upper storey: four short posts on the lower roof's crown, a rail, and the bell between them.
  softBox(lacquer, { y: 2.5 }, { width: 1.3, depth: 1.3, height: 0.08 });
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) beam(lacquer, [x, 2.58, z], [x, 3.35, z], 0.08);
  }
  for (const z of [-0.5, 0.5]) beam(lacquer, [-0.55, 2.8, z], [0.55, 2.8, z], 0.04, { caps: false });
  for (const x of [-0.5, 0.5]) beam(lacquer, [x, 2.8, -0.55], [x, 2.8, 0.55], 0.04, { caps: false });
  beam(lacquer, [-0.55, 3.3, 0], [0.55, 3.3, 0], 0.07);
  lathe(bronze, [[0.27, 2.62], [0.26, 2.7], [0.21, 3.0], [0.18, 3.12], [0.05, 3.17]], { segments: 10 });
  beam(bronze, [0, 3.17, 0], [0, 3.3, 0], 0.05);
  const upper = hipRoof(tile, { y: 3.35, width: 1.9, depth: 1.9, height: 0.8, ridge: 0.45, sag: 0.16, lift: 0.3, segments: 3 });
  tileCourses(tileDark, upper, { courses: 4, thickness: 0.035 });
  ridgeDressing(tileDark, upper, { thickness: 0.1, curl: 0.24, tips: 0.32, tipOut: 0.12 });
  return [stone, lacquer, tile, tileDark, bronze];
}

/**
 * Cầu ngói: a wooden bridge with a tiled roof, across its own pond - a gently arched deck on wooden
 * piers, posts on the deck carrying the roof, a low rail to lean on between them.
 */
export function buildTiledBridge() {
  const stone = part("viet_stone", 0xb9b3a2);
  const water = part("viet_water", C.water);
  const timber = part("viet_timber", C.timber);
  const post = part("viet_timber_dark", C.timberDark);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  disc(water, { y: 0.05 }, { radiusX: 2.4, radiusZ: 1.45, segments: 16 });
  const random = seededRandom(23);
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    if (Math.abs(Math.cos(angle)) > 0.9) continue;
    const r = 0.26 + random() * 0.08;
    icoBlob(stone, { x: Math.cos(angle) * 2.48, y: 0.04, z: Math.sin(angle) * 1.52 }, { radiusX: r, radiusY: r * 0.5, radiusZ: r * 0.8, jitter: 0.18, seed: index });
  }
  // Stone abutments on either bank.
  for (const side of [-1, 1]) softBox(stone, { x: side * 2.55 }, { width: 0.6, depth: 1.5, height: 0.38 });
  // The deck: a closed box section arched over the water.
  const deckY = (x) => 0.38 + 0.28 * Math.cos((x / 2.55) * (Math.PI / 2));
  const half = 0.62;
  const steps = 8;
  for (let index = 0; index < steps; index += 1) {
    const x0 = -2.55 + (index / steps) * 5.1;
    const x1 = -2.55 + ((index + 1) / steps) * 5.1;
    const a = deckY(x0);
    const b = deckY(x1);
    facingQuad(timber, [x0, a, half], [x1, b, half], [x1, b, -half], [x0, a, -half], [0, 1, 0]);
    facingQuad(post, [x0, a - 0.14, half], [x1, b - 0.14, half], [x1, b, half], [x0, a, half], [0, 0, 1]);
    facingQuad(post, [x0, a - 0.14, -half], [x1, b - 0.14, -half], [x1, b, -half], [x0, a, -half], [0, 0, -1]);
    facingQuad(post, [x0, a - 0.14, half], [x1, b - 0.14, half], [x1, b - 0.14, -half], [x0, a - 0.14, -half], [0, -1, 0]);
  }
  // Wooden piers in the water under the deck.
  for (const x of [-1.2, 0, 1.2]) {
    for (const z of [0.45, -0.45]) beam(post, [x, 0, z], [x, deckY(x) - 0.12, z], 0.13);
  }
  // Posts on the deck carrying the roof, plates along their tops, and the rail between them.
  const postXs = [-2.1, -1.05, 0, 1.05, 2.1];
  for (const x of postXs) {
    for (const z of [0.56, -0.56]) beam(post, [x, deckY(x), z], [x, 1.95, z], 0.1);
  }
  for (const z of [0.56, -0.56]) {
    beam(post, [-2.25, 1.95, z], [2.25, 1.95, z], 0.11);
    for (let index = 0; index + 1 < postXs.length; index += 1) {
      const xa = postXs[index] ?? 0;
      const xb = postXs[index + 1] ?? 0;
      beam(timber, [xa, deckY(xa) + 0.48, z], [xb, deckY(xb) + 0.48, z], 0.07, { caps: false });
    }
  }
  const roof = hipRoof(tile, { y: 1.95, width: 5.0, depth: 1.75, height: 0.7, ridge: 3.8, sag: 0.12, lift: 0.22 });
  tileCourses(tileDark, roof, { courses: 9, thickness: 0.035 });
  ridgeDressing(tileDark, roof, { thickness: 0.12, curl: 0.32, tips: 0.26, tipOut: 0.12 });
  return [stone, water, timber, post, tile, tileDark];
}

/** Cây gạo: a tall straight trunk, branches in level tiers, red flowers thick on them before the leaves. */
export function buildGaoTree() {
  const bark = part("viet_bark", 0x7a6a58);
  const flowers = part("viet_gao_red", R.gaoRed);
  const leaf = part("viet_leaf", C.leaf);
  const random = seededRandom(51);
  taperedCylinder(bark, { y: 0 }, { bottomRadius: 0.32, topRadius: 0.14, height: 5.6, segments: 7 });
  for (let root = 0; root < 4; root += 1) {
    const angle = (root / 4) * Math.PI * 2 + 0.4;
    beam(bark, [Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6], [Math.cos(angle) * 0.1, 0.7, Math.sin(angle) * 0.1], 0.2);
  }
  for (const [y, reach, count] of [[2.7, 1.7, 4], [3.6, 1.35, 4], [4.5, 0.95, 3], [5.25, 0.55, 3]]) {
    for (let limb = 0; limb < count; limb += 1) {
      const angle = (limb / count) * Math.PI * 2 + y;
      const tip = [Math.cos(angle) * reach, y + 0.3, Math.sin(angle) * reach];
      branch(bark, [[0, y, 0], [tip[0] * 0.55, y + 0.08, tip[2] * 0.55], tip], { from: 0.1, to: 0.05 });
      icoBlob(flowers, { x: tip[0], y: tip[1] + 0.05, z: tip[2] }, { radiusX: 0.32, radiusY: 0.24, jitter: 0.2, seed: Math.floor(random() * 1000) });
      if (limb % 2 === 1) icoBlob(flowers, { x: tip[0] * 0.6, y: y + 0.18, z: tip[2] * 0.6 }, { radiusX: 0.18, radiusY: 0.14, jitter: 0.2, seed: Math.floor(random() * 1000) });
      if (limb % 2 === 0) leafBlade(leaf, { x: tip[0] * 0.8, y: y + 0.2, z: tip[2] * 0.8 }, { length: 0.3, width: 0.1, yaw: angle, tilt: 0.3, droop: -0.2 });
    }
  }
  icoBlob(flowers, { x: 0, y: 5.75, z: 0 }, { radiusX: 0.34, radiusY: 0.26, jitter: 0.2, seed: 9 });
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
  for (let bay = 0; bay < 5; bay += 1) {
    const x = -1.52 + bay * 0.76;
    softBox(post, { x, y: 0.42, z: 0.96 }, { width: 0.62, depth: 0.04, height: bay === 0 || bay === 4 ? 1.0 : 1.5 });
    for (const row of [0.62, 1.12]) softBox(timber, { x, y: 0.42 + row, z: 0.99 }, { width: 0.5, depth: 0.02, height: 0.05 });
  }
  for (const x of [-1.9, -1.14, -0.38, 0.38, 1.14, 1.9]) {
    taperedCylinder(post, { x, y: 0.35, z: 1.42 }, { bottomRadius: 0.09, topRadius: 0.08, height: 1.8, segments: 6 });
  }
  beam(post, [-2.1, 2.15, 1.42], [2.1, 2.15, 1.42], 0.14);
  const roof = hipRoof(tile, { y: 2.1, width: 4.9, depth: 3.9, height: 1.7, ridge: 2.6, sag: 0.1, lift: 0.16 });
  tileCourses(tileDark, roof, { courses: 11 });
  ridgeDressing(tileDark, roof, { thickness: 0.18, curl: 0.32, tips: 0.24, tipOut: 0.14 });
  // Gilt ornaments at the ridge's middle: the dragon pair of a Huế roof, drawn as two rising curls.
  for (const side of [-1, 1]) horn(gold, [side * 0.75, 3.82, 0], { out: [-side, 0], length: 0.5, rise: 0.3, thickness: 0.1, hook: 0.2 });
  lathe(gold, [[0.1, 3.82], [0.14, 3.92], [0.06, 4.18]], { segments: 8 });
  return [stone, timber, post, tile, tileDark, gold];
}

/** Cổng tam quan: three arches under three roofs, the middle one taller, a board over it. */
export function buildTamQuanGate() {
  const brick = part("viet_moss", 0x9aa37a);
  const lime = part("viet_lime", 0xe7dcc0);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const lacquer = part("viet_lacquer", C.lacquer);
  const gold = part("viet_gold", C.gold);
  const depth = 0.9;
  // Four piers, the middle two taller (the trụ biểu rule), lime-washed over a moss-dark foot.
  for (const x of [-2.25, -1.0, 1.0, 2.25]) {
    const outer = Math.abs(x) > 2;
    softBox(lime, { x }, { width: 0.5, depth, height: outer ? 1.9 : 2.75 });
    softBox(brick, { x }, { width: 0.54, depth: depth + 0.04, height: 0.32 });
    softBox(lime, { x, y: outer ? 1.9 : 2.75 }, { width: 0.6, depth: depth + 0.1, height: 0.08 });
  }
  archedSpan(lime, { x0: -0.75, x1: 0.75, spring: 1.6, top: 2.75, z0: -depth / 2, z1: depth / 2 });
  for (const side of [-1, 1]) archedSpan(lime, { x0: side > 0 ? 1.25 : -2.0, x1: side > 0 ? 2.0 : -1.25, spring: 1.15, top: 1.9, z0: -depth / 2, z1: depth / 2 });
  softBox(lime, { y: 2.75 }, { width: 2.5, depth, height: 0.55 });
  softBox(gold, { y: 2.8, z: depth / 2 + 0.01 }, { width: 1.2, depth: 0.05, height: 0.42 });
  softBox(lacquer, { y: 2.84, z: depth / 2 + 0.04 }, { width: 1.08, depth: 0.04, height: 0.34 });
  const centre = hipRoof(tile, { y: 3.3, width: 3.0, depth: 1.5, height: 0.7, ridge: 1.9, sag: 0.14, lift: 0.26, segments: 3 });
  tileCourses(tileDark, centre, { courses: 6, thickness: 0.035 });
  ridgeDressing(tileDark, centre, { thickness: 0.12, curl: 0.32, tips: 0.28, tipOut: 0.12 });
  for (const side of [-1, 1]) {
    const roof = hipRoof(tile, { x: side * 1.65, y: 1.98, width: 1.6, depth: 1.3, height: 0.48, ridge: 0.8, sag: 0.12, lift: 0.18, segments: 3 });
    ridgeDressing(tileDark, roof, { thickness: 0.09, curl: 0, tips: 0.2, tipOut: 0.1, hips: false });
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

/** Cây dừa: a curving trunk leaning out, a crown of long feather fronds, a cluster of green coconuts. */
export function buildCoconutPalm() {
  const trunk = part("viet_palm_trunk", R.coconutTrunk);
  const frond = part("viet_leaf_light", C.leafLight);
  const nut = part("viet_coconut", R.coconut);
  const points = [];
  for (let index = 0; index <= 6; index += 1) {
    const t = index / 6;
    points.push([0.9 * t * t, 5.0 * t, 0.15 * t]);
  }
  for (let index = 0; index + 1 < points.length; index += 1) beam(trunk, points[index], points[index + 1], lerp(0.26, 0.16, index / 5), { caps: index === points.length - 2 });
  const top = points[points.length - 1];
  for (let index = 0; index < 9; index += 1) {
    pinnateFrond(frond, frond, top, { yaw: (index / 9) * Math.PI * 2, length: 2.2, rise: index % 2 === 0 ? 0.55 : 0.25, droop: 1.0, pairs: 8, leafletLength: 0.62, leafletWidth: 0.06, thickness: 0.05 });
  }
  for (let index = 0; index < 5; index += 1) {
    const a = index * 1.3;
    icoBlob(nut, { x: top[0] + Math.cos(a) * 0.17, y: top[1] - 0.3, z: top[2] + Math.sin(a) * 0.17 }, { radiusX: 0.14, jitter: 0.06, seed: index });
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

/** Cầu khỉ: a bamboo pole to walk on, on crossed legs, a handrail at hip height, over its own muddy canal. */
export function buildMonkeyBridge() {
  const water = part("viet_water", C.water);
  const bank = part("viet_mud", R.mud);
  const bamboo = part("viet_bamboo", C.bamboo);
  const green = part("viet_bamboo_green", C.bambooGreen);
  channel(water, bank, { length: 1.6, width: 1.6, bankWidth: 1.2, bankHeight: 0.1 });
  // Two poles side by side to walk on, running across the canal along z, from bank to bank.
  for (const x of [-0.05, 0.05]) beam(bamboo, [x, 0.95, -1.95], [x, 0.95, 1.95], 0.1);
  for (const z of [-1.35, 0, 1.35]) {
    beam(green, [-0.45, 0, z], [0.1, 1.0, z], 0.08);
    beam(green, [0.45, 0, z], [-0.1, 1.0, z], 0.08);
  }
  // The handrail: one bamboo on its own posts, at a walker's hip.
  beam(bamboo, [0.3, 1.5, -1.85], [0.3, 1.5, 1.85], 0.07);
  for (const z of [-1.85, -0.6, 0.6, 1.85]) beam(green, [0.3, 0.92, z], [0.3, 1.53, z], 0.06);
  for (const z of [-1.95, 1.95]) beam(green, [0, 0, z], [0, 0.95, z], 0.09);
  return [water, bank, bamboo, green];
}

/** Xuồng ba lá: a slim flat-bottomed boat on the bank, raised at both ends, an oar along it, a nón lá on the seat. */
export function buildSampan() {
  const wood = part("viet_timber", C.timber);
  const dark = part("viet_timber_dark", C.timberDark);
  const hat = part("viet_hat", R.hat);
  const length = 3.2;
  const stations = 8;
  const width = (t) => 0.44 * Math.sin(Math.PI * t) ** 0.75;
  const sheer = (t) => 0.4 + 0.22 * (2 * t - 1) ** 4;
  const x = (t) => -length / 2 + t * length;
  // Three planks: two sides flaring out from a flat bottom, all of them seen from inside as well.
  for (let index = 0; index < stations; index += 1) {
    const t0 = index / stations;
    const t1 = (index + 1) / stations;
    for (const side of [-1, 1]) {
      const g0 = [x(t0), sheer(t0), side * width(t0)];
      const g1 = [x(t1), sheer(t1), side * width(t1)];
      const c0 = [x(t0), 0.05, side * width(t0) * 0.62];
      const c1 = [x(t1), 0.05, side * width(t1) * 0.62];
      sheetQuad(wood, c0, c1, g1, g0);
      beam(dark, g0, g1, 0.045, { caps: false });
    }
    sheetQuad(dark, [x(t0), 0.05, -width(t0) * 0.62], [x(t1), 0.05, -width(t1) * 0.62], [x(t1), 0.05, width(t1) * 0.62], [x(t0), 0.05, width(t0) * 0.62]);
  }
  for (const t of [0.32, 0.62]) beam(dark, [x(t), 0.3, -width(t) * 0.9], [x(t), 0.3, width(t) * 0.9], 0.06);
  beam(dark, [-1.1, 0.38, 0.14], [1.05, 0.42, 0.24], 0.045);
  facingQuad(dark, [0.95, 0.41, 0.2], [1.3, 0.43, 0.27], [1.3, 0.43, 0.39], [0.95, 0.41, 0.32], [0, 1, 0]);
  // The nón lá, resting on the forward seat.
  lathe(hat, [[0.24, 0.33], [0.2, 0.36], [0.0, 0.5]], { x: x(0.62), segments: 12 });
  return [wood, dark, hat];
}

/** Dừa nước: feather fronds rising straight out of the mud and arching over, a brown fruit head at their foot. */
export function buildNipaPalm() {
  const frond = part("viet_leaf", C.leaf);
  const fruit = part("viet_nipa_fruit", 0x6e4a2c);
  for (let index = 0; index < 8; index += 1) {
    const yaw = (index / 8) * Math.PI * 2 + (index % 2) * 0.2;
    pinnateFrond(frond, frond, [0, 0, 0], { yaw, length: 3.0, rise: 1.32 - (index % 3) * 0.1, droop: 0.32, pairs: 8, leafletLength: 0.55, leafletWidth: 0.05, thickness: 0.05, hang: 0.2 });
  }
  icoBlob(fruit, { x: 0.25, y: 0.16, z: 0.15 }, { radiusX: 0.2, radiusY: 0.18, jitter: 0.15, seed: 4 });
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

/**
 * Nhà rông: a hall on stilts under a towering thatched roof. Its front and back slopes are giant
 * trapezoids, wider at the top than at the eaves, so each gable end leans out like an axe blade; the
 * thatch is laid in bands, and the ridge ends rise in horns.
 */
export function buildNhaRong() {
  const post = part("viet_timber_dark", C.timberDark);
  const floor = part("viet_timber", C.timber);
  const thatch = part("viet_straw", C.straw);
  const thatchDark = part("viet_straw_dark", C.strawDark);
  const wall = part("viet_bamboo", C.bamboo);
  const lacquer = part("viet_lacquer", C.lacquer);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) {
    for (const z of [-1.4, 0, 1.4]) taperedCylinder(post, { x, y: 0, z }, { bottomRadius: 0.14, topRadius: 0.12, height: 1.6, segments: 6 });
  }
  softBox(floor, { y: 1.6 }, { width: 4.4, depth: 3.6, height: 0.16 });
  softBox(wall, { y: 1.76 }, { width: 3.9, depth: 3.0, height: 0.95 });
  softBox(post, { y: 1.76, z: 1.51 }, { width: 0.7, depth: 0.03, height: 0.85 });
  for (let seam = 0; seam < 9; seam += 1) softBox(thatchDark, { x: -1.8 + seam * 0.45, y: 1.76, z: 1.505 }, { width: 0.03, depth: 0.02, height: 0.95 });
  const eaveY = 2.55;
  const ridgeY = 8.6;
  const eaveHalf = 2.4;
  const ridgeHalf = 3.2;
  const depthHalf = 2.25;
  const eave = (side, front) => [side * eaveHalf, eaveY, front * depthHalf];
  const ridge = (side) => [side * ridgeHalf, ridgeY, 0];
  const onFace = (front, u, v) => {
    const e = [lerp(-eaveHalf, eaveHalf, u), eaveY, front * depthHalf];
    const r = [lerp(-ridgeHalf, ridgeHalf, u), ridgeY, 0];
    return [lerp(e[0], r[0], v), lerp(e[1], r[1], v), lerp(e[2], r[2], v)];
  };
  for (const front of [1, -1]) {
    // The slope in three bands, the lowest the darkest where rain darkens the thatch.
    for (const [v0, v1, target] of [[0, 0.33, thatchDark], [0.33, 0.66, thatch], [0.66, 1, thatch]]) {
      sheetQuad(target, onFace(front, 0, v0), onFace(front, 1, v0), onFace(front, 1, v1), onFace(front, 0, v1));
    }
    // A thick eave roll, and the band lines across the slope.
    beam(thatchDark, add(eave(-1, front), [0, -0.05, front * 0.05]), add(eave(1, front), [0, -0.05, front * 0.05]), 0.24);
    for (const v of [0.33, 0.66]) beam(thatchDark, add(onFace(front, 0, v), [0, 0, front * 0.04]), add(onFace(front, 1, v), [0, 0, front * 0.04]), 0.09, { caps: false });
  }
  for (const side of [-1, 1]) {
    sheetQuad(thatch, eave(side, 1), eave(side, -1), add(ridge(side), [0, -0.01, -0.01]), ridge(side));
    // Woven lattice at the top of the gable, the mark of a nhà rông.
    for (const k of [0.25, 0.45]) {
      const a = [side * lerp(eaveHalf, ridgeHalf, 1 - k), lerp(eaveY, ridgeY, 1 - k), depthHalf * k];
      const b = [side * lerp(eaveHalf, ridgeHalf, 1 - k), lerp(eaveY, ridgeY, 1 - k), -depthHalf * k];
      beam(lacquer, add(a, [side * 0.06, 0, 0]), add(b, [side * 0.06, 0, 0]), 0.06, { caps: false });
    }
  }
  beam(thatchDark, ridge(-1), ridge(1), 0.26);
  for (const side of [-1, 1]) horn(lacquer, ridge(side), { out: [side, 0], length: 0.5, rise: 0.9, thickness: 0.14, hook: 0.6 });
  // The stair to the door: a notched log, and a carved post beside it.
  beam(post, [0, 0, 2.6], [0, 1.6, 1.82], 0.24);
  for (let notch = 1; notch < 4; notch += 1) {
    const t = notch / 4;
    softBox(floor, { y: 1.6 * t - 0.03, z: lerp(2.6, 1.82, t) }, { width: 0.32, depth: 0.12, height: 0.05 });
  }
  beam(lacquer, [0.5, 0, 2.45], [0.5, 2.4, 2.45], 0.11);
  return [post, floor, thatch, thatchDark, wall, lacquer];
}

/** Cây nêu: a tall bamboo pole with a leafy crown and a hoop, a cross bar hung with a bronze khánh and red and gold charms. */
export function buildCayNeu() {
  const bamboo = part("viet_bamboo_green", C.bambooGreen);
  const leaf = part("viet_leaf_light", C.leafLight);
  const red = part("viet_lantern_red", C.lanternRed);
  const gold = part("viet_gold", C.gold);
  for (let joint = 0; joint < 6; joint += 1) {
    const y0 = joint * 0.95;
    beam(bamboo, [0, y0, 0], [0, y0 + 0.95, 0], lerp(0.13, 0.07, joint / 5), { caps: false });
    beam(gold, [0, y0 + 0.93, 0], [0, y0 + 0.97, 0], lerp(0.15, 0.085, joint / 5), { caps: false });
  }
  for (let blade = 0; blade < 7; blade += 1) leafBlade(leaf, { x: 0, y: 5.7, z: 0 }, { length: 0.7, width: 0.13, yaw: blade * 0.9, tilt: 0.8, droop: -0.45 });
  // A hoop of bamboo under the crown.
  for (let index = 0; index < 8; index += 1) {
    const a0 = (index / 8) * Math.PI * 2;
    const a1 = ((index + 1) / 8) * Math.PI * 2;
    beam(bamboo, [Math.cos(a0) * 0.32, 5.25, Math.sin(a0) * 0.32], [Math.cos(a1) * 0.32, 5.25, Math.sin(a1) * 0.32], 0.035, { caps: false });
  }
  beam(bamboo, [-0.7, 4.85, 0], [0.7, 4.85, 0], 0.05);
  for (const [x, colour] of [[-0.6, red], [-0.3, gold], [0.3, gold], [0.6, red]]) {
    beam(gold, [x, 4.85, 0], [x, 4.45, 0], 0.015, { caps: false });
    icoBlob(colour, { x, y: 4.33, z: 0 }, { radiusX: 0.1, radiusY: 0.14, jitter: 0.05, seed: Math.round(x * 10) });
  }
  // The khánh: a bronze chime plate hung at the middle.
  beam(gold, [0, 4.85, 0], [0, 4.62, 0], 0.015, { caps: false });
  faceDisc(gold, { y: 4.45, z: 0.03 }, { radius: 0.18, segments: 10 });
  facingQuad(red, [0, 5.15, 0], [0.62, 5.08, 0], [0.62, 4.98, 0], [0, 4.95, 0], [0, 0, 1]);
  facingQuad(red, [0, 5.15, 0], [0.62, 5.08, 0], [0.62, 4.98, 0], [0, 4.95, 0], [0, 0, -1]);
  softBox(gold, { y: 0 }, { width: 0.36, depth: 0.36, height: 0.14 });
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

/** Cây cà phê: an upright bush of glossy dark leaves, clusters of red cherries along its branches. */
export function buildCoffeeShrub() {
  const leaf = part("viet_leaf_deep", C.leafDeep);
  const leafLight = part("viet_leaf", C.leaf);
  const cherry = part("viet_coffee_red", R.coffeeRed);
  const stem = part("viet_bark", 0x5e4634);
  const random = seededRandom(61);
  beam(stem, [0, 0, 0], [0, 0.45, 0], 0.07);
  const puffs = [[0, 1.2, 0, 0.32], [0.3, 0.95, 0.12, 0.3], [-0.28, 0.98, -0.08, 0.31], [0.04, 0.85, -0.32, 0.28], [-0.08, 0.82, 0.32, 0.28], [0.25, 0.62, -0.18, 0.26], [-0.22, 0.6, 0.18, 0.26], [0.02, 1.45, 0.02, 0.22]];
  puffs.forEach(([x, y, z, r], index) => {
    icoBlob(index % 3 === 0 ? leafLight : leaf, { x, y, z }, { radiusX: r, radiusY: r * 0.85, detail: index < 3 ? 1 : 0, jitter: 0.15, seed: index + 2 });
  });
  for (let cluster = 0; cluster < 9; cluster += 1) {
    const angle = random() * Math.PI * 2;
    const r = 0.38 + random() * 0.12;
    const y = 0.55 + random() * 0.75;
    for (let berry = 0; berry < 3; berry += 1) {
      icoBlob(cherry, { x: Math.cos(angle) * r + berry * 0.05, y: y - berry * 0.04, z: Math.sin(angle) * r }, { radiusX: 0.045, jitter: 0.05, seed: cluster * 3 + berry });
    }
  }
  return [leaf, leafLight, cherry, stem];
}

/** Dã quỳ: a tall rounded bush of the highlands' wild sunflower, its big yellow daisies held all over the top. */
export function buildWildSunflower() {
  const leaf = part("viet_leaf", C.leaf);
  const leafDeep = part("viet_leaf_deep", C.leafDeep);
  const petal = part("viet_sunflower", R.sunflower);
  const heart = part("viet_bark", 0x8a5a24);
  const random = seededRandom(71);
  // The bush: small leafy puffs piled into a rounded mound, darker inside.
  for (let index = 0; index < 11; index += 1) {
    const a = (index / 11) * Math.PI * 2 + random() * 0.4;
    const r = index < 4 ? 0.12 : 0.32 + random() * 0.12;
    const y = index < 4 ? 0.85 + random() * 0.15 : 0.35 + random() * 0.35;
    icoBlob(index % 3 === 0 ? leafDeep : leaf, { x: Math.cos(a) * r, y, z: Math.sin(a) * r }, { radiusX: 0.24 + random() * 0.06, radiusY: 0.22, jitter: 0.15, seed: index });
  }
  // The daisies: eight broad petals round a domed brown heart, facing up and a little outward.
  for (let flower = 0; flower < 9; flower += 1) {
    const a = (flower / 9) * Math.PI * 2 + random() * 0.4;
    const r = flower === 0 ? 0 : 0.2 + random() * 0.24;
    const at = [Math.cos(a) * r, 1.05 + random() * 0.25 - r * 0.3, Math.sin(a) * r];
    const tilt = r * 0.8;
    const up = [Math.cos(a) * tilt, 1, Math.sin(a) * tilt];
    for (let p = 0; p < 8; p += 1) {
      const pa = (p / 8) * Math.PI * 2;
      const point = (angle, radius, drop) => add(at, [Math.cos(angle) * radius, drop + (Math.cos(angle) * up[0] + Math.sin(angle) * up[2]) * radius * 0.6, Math.sin(angle) * radius]);
      const a0 = point(pa - 0.28, 0.05, 0.01);
      const a1 = point(pa + 0.28, 0.05, 0.01);
      const b1 = point(pa + 0.16, 0.2, -0.01);
      const b0 = point(pa - 0.16, 0.2, -0.01);
      sheetQuad(petal, a0, a1, b1, b0);
    }
    icoBlob(heart, { x: at[0], y: at[1] + 0.02, z: at[2] }, { radiusX: 0.07, radiusY: 0.045, jitter: 0.05, seed: flower });
  }
  return [leaf, leafDeep, petal, heart];
}

// --- Tây Bắc ---------------------------------------------------------------------------------------

/**
 * Cọn nước: a bamboo water wheel turning in its stream. Two rims on spokes round a hub, paddles between
 * the rims for the current to push, bamboo tubes lashed at the rim to lift the water, the axle on two
 * log A-frames, and the trough the tubes empty into running off to the bank.
 */
export function buildWaterWheel() {
  const water = part("viet_water", C.water);
  const bank = part("viet_stone", C.slab);
  const bamboo = part("viet_bamboo", C.bamboo);
  const green = part("viet_bamboo_green", C.bambooGreen);
  const frame = part("viet_timber_dark", C.timberDark);
  channel(water, bank, { length: 3.2, width: 1.0, bankWidth: 0.5, bankHeight: 0.18 });
  const cy = 1.3;
  const radius = 1.2;
  const count = 16;
  const rimAt = (k, z, r = radius) => {
    const a = (k / count) * Math.PI * 2;
    return [Math.cos(a) * r, cy + Math.sin(a) * r, z];
  };
  for (const z of [-0.2, 0.2]) {
    for (let k = 0; k < count; k += 1) beam(bamboo, rimAt(k, z), rimAt(k + 1, z), 0.06, { caps: false });
    for (let k = 0; k < count; k += 2) beam(green, [0, cy, z], rimAt(k, z, radius - 0.03), 0.045, { caps: false });
  }
  beam(frame, [0, cy, -0.32], [0, cy, 0.32], 0.2);
  for (let k = 0; k < count; k += 1) {
    // A paddle between the rims, standing out from the wheel.
    const a = (k / count) * Math.PI * 2;
    const inner = [Math.cos(a) * (radius - 0.02), cy + Math.sin(a) * (radius - 0.02)];
    const outer = [Math.cos(a) * (radius + 0.2), cy + Math.sin(a) * (radius + 0.2)];
    sheetQuad(bamboo, [inner[0], inner[1], -0.2], [outer[0], outer[1], -0.2], [outer[0], outer[1], 0.2], [inner[0], inner[1], 0.2]);
    if (k % 2 === 0) {
      // A tube lashed along the rim, tilted, to scoop and lift the water.
      const ahead = (k + 0.7) / count * Math.PI * 2;
      beam(green, [Math.cos(a) * (radius + 0.06), cy + Math.sin(a) * (radius + 0.06), 0.26], [Math.cos(ahead) * (radius + 0.12), cy + Math.sin(ahead) * (radius + 0.12), 0.34], 0.07);
    }
  }
  for (const z of [-0.45, 0.45]) {
    beam(frame, [-0.55, 0, z], [0, cy + 0.05, z], 0.12);
    beam(frame, [0.55, 0, z], [0, cy + 0.05, z], 0.12);
    beam(frame, [-0.3, 0.6, z], [0.3, 0.6, z], 0.08);
  }
  beam(frame, [0, cy, -0.45], [0, cy, 0.45], 0.1);
  // The trough: a split bamboo on a post, from beside the wheel's top across to the bank.
  beam(green, [0.15, 2.45, 0.45], [1.7, 1.7, 0.95], 0.14);
  beam(frame, [1.7, 0, 0.95], [1.7, 1.66, 0.95], 0.08);
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
  // The lifts of the rammed earth, each pour a band.
  for (const y of [0.62, 1.02, 1.42]) softBox(earthDark, { y, z: 1.27 }, { width: 3.54, depth: 0.04, height: 0.035 });
  softBox(timber, { y: 0.22, z: 1.29 }, { width: 0.75, depth: 0.06, height: 1.3 });
  for (const x of [-1.1, 1.1]) softBox(ink, { x, y: 1.1, z: 1.29 }, { width: 0.32, depth: 0.04, height: 0.32 });
  const roof = hipRoof(tile, { y: 2.08, width: 4.3, depth: 3.3, height: 1.15, ridge: 2.8, sag: 0.06, lift: 0.05 });
  tileCourses(tileDark, roof, { courses: 12, thickness: 0.05 });
  ridgeDressing(tileDark, roof, { thickness: 0.16, curl: 0.12 });
  for (const x of [-1.6, -0.9, 0.9, 1.6]) beam(timber, [x, 0, 1.9], [x, 0.7, 1.9], 0.07);
  for (const side of [-1, 1]) beam(timber, [side * 1.6, 0.55, 1.9], [side * 0.9, 0.55, 1.9], 0.05);
  return [earth, earthDark, timber, tile, tileDark, ink];
}

/** Tam giác mạch: a low clump of buckwheat - red stems among heart-shaped leaves, a haze of small pink and white flowers over it. */
export function buildBuckwheat() {
  const stem = part("viet_buckwheat_stem", R.buckwheatStem);
  const flower = part("viet_buckwheat_pink", R.buckwheatPink);
  const pale = part("viet_buckwheat_pale", 0xf6dbe9);
  const leaf = part("viet_leaf", C.leaf);
  const random = seededRandom(83);
  for (let index = 0; index < 5; index += 1) {
    const a = (index / 5) * Math.PI * 2;
    icoBlob(leaf, { x: Math.cos(a) * 0.22, y: 0.16, z: Math.sin(a) * 0.22 }, { radiusX: 0.24, radiusY: 0.17, jitter: 0.2, seed: index + 2 });
  }
  // Many small sprays at many heights, so the flowers read as a haze over the leaves.
  for (let index = 0; index < 30; index += 1) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * 0.45;
    const top = [Math.cos(a) * r, 0.22 + random() * 0.3, Math.sin(a) * r];
    if (index % 3 === 0) beam(stem, [top[0] * 0.7, 0.1, top[2] * 0.7], top, 0.014, { caps: false });
    icoBlob(index % 3 === 0 ? pale : flower, { x: top[0], y: top[1] + 0.02, z: top[2] }, { radiusX: 0.045, radiusY: 0.035, jitter: 0.35, seed: index + 20 });
  }
  return [stem, flower, pale, leaf];
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
