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
