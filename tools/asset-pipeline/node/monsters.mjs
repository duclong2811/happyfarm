/**
 * Sea monsters. The first is the **thuồng luồng**, the water dragon of Vietnamese folk tales, said to
 * lurk in deep water near villages and drag down boats: a long serpent whose back breaks the surface
 * in three humps, a dragon's head held high on its neck with horns, whiskers and a red mouth, and a
 * red crest along its spine.
 *
 * Built like a ship (`ships.mjs`): in metres, head toward +z. The coils between the humps lie lowest;
 * the renderer sinks the whole model by `SHIP_DRAFT_SHARE` of its length, which puts those coils under
 * the water so only the humps, the tail and the head show.
 */

import { beam, facingQuad, facingTriangle, part, taperedBox } from "./glb.mjs";
import { horn, icoBlob } from "./viet.mjs";

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/**
 * A tube lofted through `points`, its radius from `radii` at each: rings of `sides` points turned to
 * the path, each band facing out. The ends are left open; a head or a tail tip closes them.
 */
function tube(target, points, radii, sides = 7) {
  const rings = points.map((point, index) => {
    const ahead = points[Math.min(points.length - 1, index + 1)];
    const behind = points[Math.max(0, index - 1)];
    const tangent = unit(subtract(ahead, behind));
    const helper = Math.abs(tangent[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const side = unit(cross(tangent, helper));
    const up = unit(cross(side, tangent));
    const radius = radii[index];
    return Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      return add(point, add(scale(side, Math.cos(a) * radius), scale(up, Math.sin(a) * radius)));
    });
  });
  for (let index = 0; index + 1 < rings.length; index += 1) {
    for (let k = 0; k < sides; k += 1) {
      const next = (k + 1) % sides;
      const a = rings[index][k];
      const b = rings[index][next];
      const c = rings[index + 1][next];
      const d = rings[index + 1][k];
      const middle = scale(add(add(a, b), add(c, d)), 0.25);
      const centre = scale(add(points[index], points[index + 1]), 0.5);
      facingQuad(target, a, b, c, d, subtract(middle, centre));
    }
  }
}

/** The thuồng luồng: three humps, a raised dragon head, a forked tail. */
export function buildThuongLuong() {
  const body = part("monster_body", 0x2f6656);
  const crest = part("monster_crest", 0xc8472f);
  const hornPart = part("monster_horn", 0xe9dcbc);
  const eye = part("monster_eye", 0xf4c430);
  const mouth = part("monster_mouth", 0x7a1f1c);
  // The spine: from the tail tip, through three humps whose feet dip under the water, to the neck.
  const spine = [];
  const radii = [];
  const push = (z, y, r) => {
    spine.push([0, y, z]);
    radii.push(r);
  };
  push(-8.2, 0.55, 0.08);
  push(-7.6, 0.1, 0.22);
  const humps = [
    { from: -7.0, to: -4.6, peak: 1.35, r: 0.42 },
    { from: -4.1, to: -1.4, peak: 1.75, r: 0.52 },
    { from: -0.9, to: 1.9, peak: 2.0, r: 0.6 }
  ];
  for (const hump of humps) {
    for (let step = 0; step <= 6; step += 1) {
      const t = step / 6;
      const z = hump.from + (hump.to - hump.from) * t;
      push(z, -0.62 + (hump.peak + 0.62) * Math.sin(Math.PI * t), hump.r * (0.9 + 0.1 * Math.sin(Math.PI * t)));
    }
  }
  // The neck rises out of the water to hold the head high.
  for (const [z, y, r] of [[2.4, -0.4, 0.62], [2.8, 0.6, 0.6], [3.1, 1.6, 0.56], [3.4, 2.5, 0.52], [3.75, 3.1, 0.48]]) push(z, y, r);
  tube(body, spine, radii, 7);
  // The crest: a row of red fins down the spine, standing on the humps.
  for (let index = 2; index < spine.length - 2; index += 2) {
    const point = spine[index];
    if (point[1] < 0.3) continue;
    const r = radii[index];
    const base = add(point, [0, r * 0.85, 0]);
    facingTriangle(crest, add(base, [0, 0, -0.22]), add(base, [0, 0, 0.18]), add(base, [0, 0.55, -0.12]), [1, 0, 0]);
    facingTriangle(crest, add(base, [0, 0, -0.22]), add(base, [0, 0, 0.18]), add(base, [0, 0.55, -0.12]), [-1, 0, 0]);
  }
  // A forked tail fin at the tip.
  for (const side of [-1, 1]) {
    facingTriangle(crest, [0, 0.55, -8.2], [side * 0.7, 1.2, -8.9], [side * 0.15, 0.5, -8.7], [0, 0, -1]);
    facingTriangle(crest, [0, 0.55, -8.2], [side * 0.7, 1.2, -8.9], [side * 0.15, 0.5, -8.7], [0, 0, 1]);
  }
  // The head: a long snout over an open jaw, the mouth red inside.
  const head = [0, 3.15, 4.1];
  taperedBox(body, { x: 0, y: head[1] - 0.1, z: head[2] + 0.15 }, { width: 0.95, depth: 1.25, height: 0.62, topScale: 0.7, topOffsetZ: 0.1 });
  taperedBox(body, { x: 0, y: head[1] + 0.05, z: head[2] + 1.05 }, { width: 0.7, depth: 0.8, height: 0.32, topScale: 0.6, topOffsetZ: 0.12 });
  taperedBox(body, { x: 0, y: head[1] - 0.48, z: head[2] + 0.75 }, { width: 0.6, depth: 1.05, height: 0.2, topScale: 0.75 });
  taperedBox(mouth, { x: 0, y: head[1] - 0.3, z: head[2] + 0.8 }, { width: 0.5, depth: 0.9, height: 0.2, topScale: 0.85 });
  for (const side of [-1, 1]) {
    // Fangs, eyes under heavy brows, horns sweeping back, whiskers trailing.
    facingTriangle(hornPart, [side * 0.2, head[1] - 0.1, head[2] + 1.15], [side * 0.26, head[1] - 0.1, head[2] + 1.0], [side * 0.22, head[1] - 0.38, head[2] + 1.08], [side, 0, 1]);
    icoBlob(eye, { x: side * 0.36, y: head[1] + 0.32, z: head[2] + 0.42 }, { radiusX: 0.11, radiusY: 0.1, radiusZ: 0.09, jitter: 0.02 });
    icoBlob(mouth, { x: side * 0.4, y: head[1] + 0.33, z: head[2] + 0.47 }, { radiusX: 0.05, jitter: 0.02 });
    beam(body, [side * 0.38, head[1] + 0.44, head[2] + 0.3], [side * 0.36, head[1] + 0.48, head[2] + 0.6], 0.09);
    horn(hornPart, [side * 0.25, head[1] + 0.48, head[2] - 0.05], { out: [side * 0.35, -1], length: 1.0, rise: 0.75, thickness: 0.16, hook: 0.35 });
    beam(crest, [side * 0.3, head[1] - 0.05, head[2] + 1.25], [side * 0.9, head[1] - 0.45, head[2] + 0.6], 0.04, { caps: false });
    beam(crest, [side * 0.9, head[1] - 0.45, head[2] + 0.6], [side * 1.25, head[1] - 0.9, head[2] - 0.2], 0.03, { caps: false });
    // A mane of red behind the jaw.
    facingTriangle(crest, [side * 0.42, head[1] - 0.05, head[2] - 0.2], [side * 0.45, head[1] + 0.3, head[2] - 0.35], [side * 0.95, head[1] - 0.15, head[2] - 0.75], [side, 0, 0]);
  }
  return [body, crest, hornPart, eye, mouth];
}

// --- the other four monsters of F3 (docs/design/FLEET.md) ---------------------------------------
//
// Each is built like the serpent: in metres, facing +z, its lowest parts under the waterline the
// renderer gives it (`MONSTER_DRAFT_SHARE` of its length), so only what rises out of the sea shows.

/** A tapering tentacle or limb along `points`, from `thick` at the root to `thin` at the tip. */
function limb(target, points, thick, thin, sides = 6) {
  const radii = points.map((_, index) => thick + (thin - thick) * (index / Math.max(1, points.length - 1)));
  tube(target, points, radii, sides);
}

/** A point `distance` out along `angle` (radians, from +z toward +x), at `y`. */
const around = (angle, distance, y) => [Math.sin(angle) * distance, y, Math.cos(angle) * distance];

/** Bạch tuộc khổng lồ: the giant octopus - a great mantle risen from the sea, eight arms, two raised to strike. */
export function buildBachTuoc() {
  const skin = part("octopus_skin", 0x8a3a6a);
  const pale = part("octopus_pale", 0xe2a2bc);
  const eye = part("monster_eye", 0xf4c430);
  const pupil = part("monster_pupil", 0x1d1416);
  // The mantle, leaning back, and the head below it with its eyes.
  icoBlob(skin, { x: 0, y: 3.2, z: -1.2 }, { radiusX: 2.0, radiusY: 2.6, radiusZ: 2.2, detail: 1, jitter: 0.06, seed: 11 });
  icoBlob(skin, { x: 0, y: 1.3, z: 0.4 }, { radiusX: 2.1, radiusY: 1.5, radiusZ: 1.8, detail: 1, jitter: 0.05, seed: 12 });
  for (const side of [1, -1]) {
    icoBlob(eye, { x: side * 1.25, y: 1.9, z: 1.65 }, { radiusX: 0.55, radiusY: 0.5, radiusZ: 0.45, detail: 0, jitter: 0, seed: 13 });
    icoBlob(pupil, { x: side * 1.4, y: 1.85, z: 2.02 }, { radiusX: 0.18, radiusY: 0.32, radiusZ: 0.12, detail: 0, jitter: 0, seed: 14 });
    // A heavy brow over each eye.
    beam(skin, [side * 0.5, 2.55, 1.6], [side * 1.85, 2.35, 1.35], 0.32);
  }
  // Pale spots on the mantle.
  for (const [x, y, z, r] of [[0.9, 4.2, -0.4, 0.32], [-1.1, 3.6, -0.2, 0.26], [0.2, 5.0, -1.4, 0.24], [-0.6, 4.6, -2.6, 0.28], [1.3, 3.0, -2.2, 0.22]]) {
    icoBlob(pale, { x, y, z }, { radiusX: r, radiusY: r * 0.6, radiusZ: r, detail: 0, jitter: 0, seed: 15 });
  }
  // Eight arms: six sprawling out of the water and curling up at the tips, two reared up in front.
  const angles = [-2.6, -1.9, -1.2, 1.2, 1.9, 2.6];
  angles.forEach((angle, index) => {
    const reach = 5.2 + (index % 2) * 0.8;
    const lift = 1.2 + (index % 3) * 0.5;
    const points = [around(angle, 1.2, 0.4), around(angle, 2.6, -0.5), around(angle, 4.0, 0.1), around(angle, reach, lift), around(angle + 0.25, reach + 0.4, lift + 1.2), around(angle + 0.5, reach - 0.2, lift + 1.7)];
    limb(skin, points, 0.55, 0.1);
  });
  for (const side of [1, -1]) {
    const points = [[side * 0.8, 0.5, 1.4], [side * 1.6, 0.0, 3.0], [side * 1.9, 1.6, 4.4], [side * 1.6, 3.6, 5.0], [side * 1.0, 5.0, 4.4], [side * 0.6, 5.4, 3.4]];
    limb(skin, points, 0.6, 0.12);
    // Suckers along the underside of the raised arms.
    for (const t of [0.25, 0.45, 0.65]) {
      const index = Math.floor(t * (points.length - 1));
      const from = points[index];
      const to = points[index + 1];
      const at = add(from, scale(subtract(to, from), 0.5));
      icoBlob(pale, { x: at[0], y: at[1], z: at[2] + 0.4 }, { radiusX: 0.2, radiusY: 0.2, radiusZ: 0.12, detail: 0, jitter: 0, seed: 16 });
    }
  }
  return [skin, pale, eye, pupil];
}

/** Cua đá khổng lồ: the giant rock crab - a mossy stone carapace, eyes on stalks, two great claws raised. */
export function buildCuaDa() {
  const shell = part("crab_shell", 0x6f6255);
  const moss = part("crab_moss", 0x5c7a3a);
  const claw = part("crab_claw", 0xc0502e);
  const eye = part("monster_pupil", 0x1d1416);
  icoBlob(shell, { x: 0, y: 1.0, z: 0 }, { radiusX: 3.4, radiusY: 1.3, radiusZ: 2.6, detail: 1, jitter: 0.16, seed: 21 });
  // Rocky knobs and moss on the back.
  for (const [x, z, r] of [[-1.4, -0.6, 0.6], [1.2, -0.9, 0.55], [0.1, 0.4, 0.5], [-0.4, -1.6, 0.45], [1.9, 0.5, 0.4]]) {
    icoBlob(shell, { x, y: 2.0, z }, { radiusX: r, radiusY: r * 0.7, radiusZ: r, detail: 0, jitter: 0.2, seed: 22 + x });
  }
  for (const [x, z, r] of [[-0.9, 0.0, 0.7], [0.8, -0.3, 0.6], [-1.8, -1.2, 0.45], [1.5, -1.6, 0.5]]) {
    icoBlob(moss, { x, y: 2.15, z }, { radiusX: r, radiusY: r * 0.35, radiusZ: r * 0.8, detail: 0, jitter: 0.1, seed: 31 + z });
  }
  // Eyes on stalks.
  for (const side of [1, -1]) {
    beam(shell, [side * 0.6, 1.8, 2.1], [side * 0.85, 3.0, 2.5], 0.18);
    icoBlob(eye, { x: side * 0.88, y: 3.15, z: 2.55 }, { radiusX: 0.28, radiusY: 0.28, radiusZ: 0.28, detail: 0, jitter: 0, seed: 41 });
  }
  // Legs: four a side, jointed, stepping down into the water.
  for (const side of [1, -1]) {
    for (const z of [-1.6, -0.6, 0.4, 1.3]) {
      const knee = [side * 4.3, 1.9, z * 1.25];
      beam(shell, [side * 2.8, 1.0, z], knee, 0.26);
      beam(claw, knee, [side * 5.2, -0.6, z * 1.4], 0.18);
    }
  }
  // The claws: an arm up and forward, then a great pincer, its two fingers parted.
  for (const side of [1, -1]) {
    const shoulder = [side * 2.4, 1.3, 1.8];
    const elbow = [side * 3.6, 2.6, 3.0];
    const wrist = [side * 3.3, 3.6, 4.2];
    beam(shell, shoulder, elbow, 0.42);
    beam(claw, elbow, wrist, 0.38);
    icoBlob(claw, { x: wrist[0], y: wrist[1] + 0.3, z: wrist[2] + 0.6 }, { radiusX: 0.9, radiusY: 0.75, radiusZ: 1.2, detail: 1, jitter: 0.05, seed: 51 });
    beam(claw, [wrist[0], wrist[1] + 0.7, wrist[2] + 1.3], [wrist[0] - side * 0.2, wrist[1] + 1.3, wrist[2] + 2.5], 0.3);
    beam(claw, [wrist[0], wrist[1] + 0.1, wrist[2] + 1.3], [wrist[0] - side * 0.1, wrist[1] - 0.3, wrist[2] + 2.4], 0.26);
  }
  return [shell, moss, claw, eye];
}

/** Kình ngư: the leviathan fish - a vast body breaching, jaws open on rows of teeth, red fins and a forked tail. */
export function buildKinhNgu() {
  const back = part("leviathan_back", 0x2c4a63);
  const belly = part("leviathan_belly", 0xd9d2b8);
  const fin = part("leviathan_fin", 0xb03a2e);
  const tooth = part("monster_horn", 0xf3ead8);
  const eye = part("monster_eye", 0xf4c430);
  const mouth = part("monster_mouth", 0x5a1418);
  // The body: lofted from the tail stock to the head, arched as it breaks the surface.
  const spine = [];
  const radii = [];
  for (let step = 0; step <= 10; step += 1) {
    const t = step / 10;
    const z = -7 + 12.5 * t;
    const y = -0.6 + 2.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.6 + 0.4 * t);
    spine.push([0, y, z]);
    radii.push(0.35 + 1.9 * Math.sin(Math.PI * Math.min(0.95, 0.15 + t * 0.85)));
  }
  tube(back, spine, radii, 8);
  // A pale belly strip under the body.
  tube(
    belly,
    spine.map(([x, y, z]) => [x, y - 0.5, z]),
    radii.map((radius) => radius * 0.82),
    6
  );
  const head = spine[spine.length - 1];
  // The jaws: upper and lower, open.
  taperedBox(back, { x: 0, y: head[1] + 0.1, z: head[2] + 0.4 }, { width: 2.6, depth: 2.2, height: 1.1, topScale: 0.7 });
  taperedBox(belly, { x: 0, y: head[1] - 1.5, z: head[2] + 0.6 }, { width: 2.3, depth: 2.4, height: 0.8, topScale: 1.1 });
  taperedBox(mouth, { x: 0, y: head[1] - 0.75, z: head[2] + 0.5 }, { width: 2.0, depth: 1.8, height: 0.85, topScale: 1 });
  for (let k = 0; k < 6; k += 1) {
    const x = -0.85 + (1.7 * k) / 5;
    facingTriangle(tooth, [x - 0.15, head[1] + 0.12, head[2] + 1.45], [x + 0.15, head[1] + 0.12, head[2] + 1.45], [x, head[1] - 0.35, head[2] + 1.5], [0, 0, 1]);
    facingTriangle(tooth, [x - 0.14, head[1] - 0.72, head[2] + 1.75], [x + 0.14, head[1] - 0.72, head[2] + 1.75], [x, head[1] - 0.3, head[2] + 1.7], [0, 0, 1]);
  }
  for (const side of [1, -1]) {
    icoBlob(eye, { x: side * 1.15, y: head[1] + 0.9, z: head[2] + 0.2 }, { radiusX: 0.32, radiusY: 0.32, radiusZ: 0.32, detail: 0, jitter: 0, seed: 61 });
    // Pectoral fins, swept back.
    const root = spine[7];
    facingTriangle(fin, [side * 1.6, root[1] - 0.2, root[2]], [side * 3.6, root[1] - 0.9, root[2] - 1.6], [side * 1.6, root[1] - 0.6, root[2] - 1.4], [side, 0, 0]);
  }
  // A row of red spines along the back.
  for (let step = 2; step <= 8; step += 1) {
    const at = spine[step];
    const height = 0.8 + 0.6 * Math.sin((Math.PI * (step - 2)) / 6);
    facingTriangle(fin, [0, at[1] + radii[step] - 0.1, at[2] + 0.6], [0, at[1] + radii[step] + height, at[2] - 0.3], [0, at[1] + radii[step] - 0.1, at[2] - 0.6], [1, 0, 0]);
  }
  // The forked tail, raised out of the sea.
  const stock = spine[0];
  facingTriangle(fin, [0, stock[1] + 0.2, stock[2]], [0, stock[1] + 3.0, stock[2] - 2.2], [0, stock[1] + 0.9, stock[2] - 0.8], [1, 0, 0]);
  facingTriangle(fin, [0, stock[1] - 0.2, stock[2]], [0, stock[1] - 1.6, stock[2] - 2.4], [0, stock[1] + 0.3, stock[2] - 0.9], [1, 0, 0]);
  return [back, belly, fin, tooth, eye, mouth];
}

/** Sứa lửa: the fire jellyfish - a glowing orange bell above the waves, a burning core and trailing arms. */
export function buildSuaLua() {
  const bell = part("jelly_bell", 0xf07a2a);
  const spot = part("jelly_spot", 0xffd25a);
  const core = part("jelly_core", 0xd8302a);
  const arm = part("jelly_arm", 0xe85a6a);
  // The bell: a dome, its rim frilled, spots across its top.
  icoBlob(bell, { x: 0, y: 4.6, z: 0 }, { radiusX: 3.0, radiusY: 2.1, radiusZ: 3.0, detail: 1, jitter: 0.04, seed: 71 });
  for (let k = 0; k < 12; k += 1) {
    const angle = (k / 12) * Math.PI * 2;
    icoBlob(bell, { x: Math.sin(angle) * 2.8, y: 3.1, z: Math.cos(angle) * 2.8 }, { radiusX: 0.55, radiusY: 0.35, radiusZ: 0.55, detail: 0, jitter: 0.05, seed: 72 + k });
  }
  for (const [angle, distance, y, r] of [[0.3, 1.2, 6.2, 0.42], [2.1, 1.6, 5.9, 0.36], [3.9, 1.4, 6.1, 0.4], [5.2, 2.0, 5.5, 0.32], [1.2, 2.3, 5.4, 0.3], [4.6, 0.6, 6.6, 0.3]]) {
    const at = around(angle, distance, y);
    icoBlob(spot, { x: at[0], y: at[1], z: at[2] }, { radiusX: r, radiusY: r * 0.5, radiusZ: r, detail: 0, jitter: 0, seed: 81 });
  }
  // The burning core, seen through the bell's mouth.
  icoBlob(core, { x: 0, y: 3.2, z: 0 }, { radiusX: 1.5, radiusY: 1.0, radiusZ: 1.5, detail: 0, jitter: 0.1, seed: 91 });
  // Four frilled mouth-arms twisting down to the water, and long thin tentacles trailing behind.
  for (let k = 0; k < 4; k += 1) {
    const angle = (k / 4) * Math.PI * 2 + 0.4;
    const points = [0, 1, 2, 3, 4].map((step) => around(angle + step * 0.35, 0.9 + step * 0.15, 3.0 - step * 0.9));
    limb(arm, points, 0.45, 0.15, 5);
  }
  for (let k = 0; k < 6; k += 1) {
    const x = -2.2 + (4.4 * k) / 5;
    limb(arm, [[x, 3.0, -1.6], [x * 1.1, 1.8, -3.0], [x * 1.2, 0.6, -4.8], [x * 1.3, -0.4, -6.4]], 0.16, 0.06, 4);
  }
  return [bell, spot, core, arm];
}
