/**
 * Làng Việt: houses, village pieces, fences and trees in the look of the Vietnamese countryside.
 *
 * The references are the village itself, studied for its shapes rather than copied from any drawing
 * or game:
 *
 * - **nhà tranh vách đất**, the thatched cottage with earth walls and a deep, soft hipped roof;
 * - **nhà ba gian**, the three-bay house of the northern delta: a stone plinth, a veranda of wooden
 *   columns, three doors, and a tiled roof whose ridge ends and corners curl up;
 * - **nhà sàn**, the stilt house of the hills, raised on posts with a ladder to the door;
 * - **cổng làng**, the village gate: brick piers, a round arch, a name board and a small tiled roof;
 * - **miếu**, a small shrine with red columns and a roof whose corners sweep up (**đầu đao**), a
 *   moon on the ridge between two curls;
 * - **giếng làng**, the round brick well; **chum** jars; the straw stack round its pole (**cây
 *   rơm**); the stone mortar (**cối đá**) and its pestle; the bamboo daybed (**chõng tre**);
 * - Hội An's silk lanterns, on a post and on a string;
 * - the potted tree (**cây cảnh**), the miniature mountain in its basin (**hòn non bộ**), the lotus
 *   pond (**ao sen**) and the screen wall (**bình phong**);
 * - fences of woven bamboo and of patterned breeze-block (**gạch hoa gió**);
 * - the banyan (**cây đa**), a bamboo clump (**khóm tre**), the areca palm (**cây cau**), the banana
 *   (**cây chuối**), and the two Tết blossoms: yellow **mai** and pink **đào**.
 *
 * Every piece is built in metres, standing on y = 0, its front (door, face, opening) toward +z. The
 * generator scales each one so its largest side is one unit; the client's manifest
 * (`apps/web/src/render/viet-model-urls.ts`) says how many metres that side is drawn at.
 */

import { beam, facingQuad, facingTriangle, leafBlade, lowPolyBlob, part, seededRandom, sheetQuad, sheetTriangle, softBox, taperedBox, taperedCylinder } from "./glb.mjs";

/** Colours, sRGB, from the art bible's warm palette and the village's own materials. */
export const VIET_PALETTE = {
  straw: 0xd0a95e,
  strawDark: 0xa07c3e,
  mud: 0xc59a6a,
  lime: 0xead08e,
  plaster: 0xf2e6d0,
  tile: 0xb0533f,
  tileDark: 0x7d3a30,
  timber: 0x8a6240,
  timberDark: 0x5a3f2a,
  lacquer: 0xb03a2a,
  gold: 0xe0aa3e,
  brick: 0xb65a3e,
  stone: 0xa5a89e,
  slab: 0xbab4a4,
  bamboo: 0xd4b474,
  bambooGreen: 0x8fae4f,
  leaf: 0x4f9d45,
  leafLight: 0x79bd4f,
  leafDeep: 0x3c7f4a,
  water: 0x3f97cf,
  clay: 0x9a5a35,
  glaze: 0x5b3a28,
  porcelain: 0xeef0ee,
  cobalt: 0x2f5e9e,
  lanternRed: 0xd8402e,
  lanternYellow: 0xf2b33a,
  lotus: 0xf29abb,
  mai: 0xf8d02a,
  dao: 0xf6a2c2,
  ink: 0x3a2a20
};
const C = VIET_PALETTE;

// --- small vector helpers ------------------------------------------------------------------------

export const lerp = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// --- shapes ----------------------------------------------------------------------------------------

/**
 * A solid of revolution round a vertical axis: a jar, a lantern, a well, a straw stack.
 *
 * `profile` is a list of `[radius, y]` from bottom to top. Each band faces away from the profile's
 * own inside, so a profile that turns back down (a mortar's bowl, a well's shaft) is lit from the
 * hollow it encloses.
 */
export function lathe(target, profile, { x = 0, z = 0, segments = 10, capBottom = true, capTop = true, phase = 0 } = {}) {
  const angles = Array.from({ length: segments }, (_, index) => phase + (index / segments) * Math.PI * 2);
  const ring = ([radius, y]) => angles.map((angle) => [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]);
  const rings = profile.map(ring);
  for (let band = 0; band + 1 < profile.length; band += 1) {
    const [r0, y0] = profile[band];
    const [r1, y1] = profile[band + 1];
    // The outward normal of the profile segment, in the (radius, y) plane.
    const nr = y1 - y0;
    const ny = -(r1 - r0);
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const mid = (angles[index] + angles[index] + (Math.PI * 2) / segments) / 2;
      const outward = [Math.cos(mid) * nr, ny, Math.sin(mid) * nr];
      facingQuad(target, rings[band][index], rings[band][next], rings[band + 1][next], rings[band + 1][index], outward);
    }
  }
  const fan = (row, y, down) => {
    const centre = [x, y, z];
    for (let index = 0; index < segments; index += 1) {
      facingTriangle(target, row[index], row[(index + 1) % segments], centre, [0, down ? -1 : 1, 0]);
    }
  };
  if (capBottom && profile[0][0] > 0) fan(rings[0], profile[0][1], true);
  const last = profile.length - 1;
  if (capTop && profile[last][0] > 0) fan(rings[last], profile[last][1], false);
}

/** A flat disc facing +y: water in a well or a pond, a lily pad, a tray. */
export function disc(target, { x = 0, y, z = 0 }, { radiusX, radiusZ = radiusX, segments = 12, phase = 0 }) {
  const centre = [x, y, z];
  for (let index = 0; index < segments; index += 1) {
    const a0 = phase + (index / segments) * Math.PI * 2;
    const a1 = phase + ((index + 1) / segments) * Math.PI * 2;
    facingTriangle(target, [x + Math.cos(a0) * radiusX, y, z + Math.sin(a0) * radiusZ], [x + Math.cos(a1) * radiusX, y, z + Math.sin(a1) * radiusZ], centre, [0, 1, 0]);
  }
}

/** A disc standing upright, facing +z: a moon ornament, a name board's medallion. */
export function faceDisc(target, { x = 0, y, z }, { radius, segments = 12 }) {
  const centre = [x, y, z];
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    facingTriangle(target, [x + Math.cos(a0) * radius, y + Math.sin(a0) * radius, z], [x + Math.cos(a1) * radius, y + Math.sin(a1) * radius, z], centre, [0, 0, 1]);
  }
}

/**
 * A hipped roof with its ridge along x: four slopes that sag a little between eave and ridge (the
 * soft line of a thatch or a tiled roof) and corners that lift by `lift` (the đầu đao of a shrine,
 * the gentle curl of a village roof). Seen from below as well, so both faces are kept.
 *
 * Returns the points a builder dresses: the ridge's two ends and the four eave corners.
 */
export function hipRoof(roof, { x = 0, y, z = 0, width, depth, height, ridge, sag = 0.08, lift = 0, segments = 4 }) {
  const hw = width / 2;
  const hd = depth / 2;
  const hr = ridge / 2;
  const faces = [
    { eave: [[-hw, hd], [hw, hd]], top: [[-hr, 0], [hr, 0]] },
    { eave: [[hw, -hd], [-hw, -hd]], top: [[hr, 0], [-hr, 0]] },
    { eave: [[hw, hd], [hw, -hd]], top: [[hr, 0], [hr, 0]] },
    { eave: [[-hw, -hd], [-hw, hd]], top: [[-hr, 0], [-hr, 0]] }
  ];
  const point = (face, u, v) => {
    const ex = lerp(face.eave[0][0], face.eave[1][0], u);
    const ez = lerp(face.eave[0][1], face.eave[1][1], u);
    const rx = lerp(face.top[0][0], face.top[1][0], u);
    const rz = lerp(face.top[0][1], face.top[1][1], u);
    const corner = Math.abs(u - 0.5) * 2;
    const py = y + height * v - sag * height * Math.sin(Math.PI * v) + lift * corner ** 3 * (1 - v) ** 2;
    return [x + lerp(ex, rx, v), py, z + lerp(ez, rz, v)];
  };
  for (const face of faces) {
    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < segments; j += 1) {
        const u0 = i / segments;
        const u1 = (i + 1) / segments;
        const v0 = j / segments;
        const v1 = (j + 1) / segments;
        sheetQuad(roof, point(face, u0, v0), point(face, u1, v0), point(face, u1, v1), point(face, u0, v1));
      }
    }
  }
  return {
    centre: [x, y, z],
    ridgeLeft: [x - hr, y + height, z],
    ridgeRight: [x + hr, y + height, z],
    corners: [
      [x - hw, y + lift, z + hd],
      [x + hw, y + lift, z + hd],
      [x + hw, y + lift, z - hd],
      [x - hw, y + lift, z - hd]
    ],
    /** The eave line of a face, for a fascia: the roof's own points along its lower edge. */
    eave: (faceIndex, u) => point(faces[faceIndex], u, 0),
    /** Any point of a face: u along the eave, v from eave (0) to ridge (1). Faces 0 and 1 are front and back. */
    surface: (faceIndex, u, v) => point(faces[faceIndex], u, v)
  };
}

/**
 * A curved horn swept from `from`: out along the horizontal direction `out`, rising faster as it goes,
 * tapering to a point. With `hook` above 1 the tip turns back over its own base, the curl of a ridge
 * end; below 1 it is the up-swept blade of a roof corner (đầu đao).
 */
export function horn(target, from, { out, length, rise, thickness, hook = 0.3, segments = 3 }) {
  const size = Math.hypot(out[0], out[1]) || 1;
  const ox = out[0] / size;
  const oz = out[1] / size;
  const at = (t) => {
    const reach = length * (t - hook * t * t * t);
    return [from[0] + ox * reach, from[1] + rise * t * t, from[2] + oz * reach];
  };
  let previous = from;
  for (let index = 1; index <= segments; index += 1) {
    const next = at(index / segments);
    beam(target, previous, next, thickness * lerp(1, 0.35, (index - 1) / segments), { caps: index === segments });
    previous = next;
  }
}

/** Tile courses down the front and back slopes, laid on the roof's own curve rather than across it. */
export function tileCourses(target, roof, { courses, thickness = 0.045, steps = 2, lift = 0.03 }) {
  for (let course = 1; course < courses; course += 1) {
    const u = course / courses;
    for (const face of [0, 1]) {
      let previous = add(roof.surface(face, u, 0), [0, lift, 0]);
      for (let step = 1; step <= steps; step += 1) {
        const next = add(roof.surface(face, u, step / steps), [0, lift, 0]);
        beam(target, previous, next, thickness, { caps: false });
        previous = next;
      }
    }
  }
}

/** The thick edge of a thatch: a band hanging under every eave. */
export function eaveBand(target, roofShape, { thickness, segments = 4 }) {
  for (let face = 0; face < 4; face += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = roofShape.eave(face, i / segments);
      const b = roofShape.eave(face, (i + 1) / segments);
      sheetQuad(target, a, b, add(b, [0, -thickness, 0]), add(a, [0, -thickness, 0]));
    }
  }
}

/** The ridge and its dressing: a beam along the top, ends that curl up, and corner tips. */
export function ridgeDressing(target, roofShape, { thickness, curl, tips = 0, tipOut = 0.25, hips = true }) {
  const { ridgeLeft, ridgeRight, corners, centre, surface } = roofShape;
  // The ridge (bờ nóc), and at each end a curl that rises and turns back over it (đầu kìm).
  beam(target, ridgeLeft, ridgeRight, thickness);
  if (curl > 0) {
    horn(target, ridgeLeft, { out: [-1, 0], length: curl * 0.55, rise: curl, thickness: thickness * 0.95, hook: 1.7 });
    horn(target, ridgeRight, { out: [1, 0], length: curl * 0.55, rise: curl, thickness: thickness * 0.95, hook: 1.7 });
  }
  // The hip ridges (bờ dải), laid along the roof's own hip lines from the ridge down to each corner.
  if (hips && surface !== undefined) {
    for (const [face, u] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      let previous = surface(face, u, 1);
      for (let step = 2; step >= 0; step -= 1) {
        const next = add(surface(face, u, step / 3), [0, thickness * 0.2, 0]);
        beam(target, previous, next, thickness * 0.7, { caps: false });
        previous = next;
      }
    }
  }
  // The corners sweep up past the eave in a blade (đầu đao), continuing the hip outward.
  if (tips > 0) {
    for (const corner of corners) {
      const out = [corner[0] - centre[0], corner[2] - centre[2]];
      horn(target, corner, { out, length: tipOut + tips * 0.5, rise: tips, thickness: thickness * 0.85, hook: 0.25 });
    }
  }
}

/**
 * A wall pierced by a round arch, front at z1 and back at z0: the arch springs at `spring` between
 * x0 and x1, and the wall above it reaches `top`.
 */
export function archedSpan(target, { x0, x1, spring, top, z0, z1, segments = 8 }) {
  const cx = (x0 + x1) / 2;
  const radius = (x1 - x0) / 2;
  for (let index = 0; index < segments; index += 1) {
    const a0 = Math.PI - (index / segments) * Math.PI;
    const a1 = Math.PI - ((index + 1) / segments) * Math.PI;
    const p0 = [cx + Math.cos(a0) * radius, spring + Math.sin(a0) * radius];
    const p1 = [cx + Math.cos(a1) * radius, spring + Math.sin(a1) * radius];
    facingQuad(target, [p0[0], p0[1], z1], [p1[0], p1[1], z1], [p1[0], top, z1], [p0[0], top, z1], [0, 0, 1]);
    facingQuad(target, [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], top, z0], [p0[0], top, z0], [0, 0, -1]);
    const mid = (a0 + a1) / 2;
    facingQuad(target, [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], [-Math.cos(mid), -Math.sin(mid), 0]);
  }
}

/** A Hội An silk lantern: a ribbed gourd with wooden caps and a tassel, hanging from `top`. */
export function lantern(silk, wood, { x, y, z }, { size = 1 }) {
  const s = size;
  const top = y;
  taperedCylinder(wood, { x, y: top - 0.05 * s, z }, { bottomRadius: 0.07 * s, topRadius: 0.05 * s, height: 0.05 * s, segments: 6 });
  lathe(
    silk,
    [
      [0.06 * s, top - 0.47 * s],
      [0.15 * s, top - 0.4 * s],
      [0.2 * s, top - 0.28 * s],
      [0.19 * s, top - 0.18 * s],
      [0.13 * s, top - 0.08 * s],
      [0.06 * s, top - 0.05 * s]
    ],
    { x, z, segments: 8 }
  );
  taperedCylinder(wood, { x, y: top - 0.52 * s, z }, { bottomRadius: 0.05 * s, topRadius: 0.07 * s, height: 0.05 * s, segments: 6 });
  beam(silk, [x, top - 0.52 * s, z], [x, top - 0.68 * s, z], 0.035 * s);
}

/** A cluster of blossoms: tiny faceted flowers round a point, plus a soft mass so it reads at range. */
export function blossom(flowers, { x, y, z }, { radius, count, seed, mass = true }) {
  const random = seededRandom(seed);
  if (mass) {
    // A cloud of three round puffs, so a branch-end reads as blossom rather than as a block.
    for (let puff = 0; puff < 3; puff += 1) {
      const a = (puff / 3) * Math.PI * 2 + random();
      const r = radius * (0.42 + random() * 0.12);
      lowPolyBlob(flowers, { x: x + Math.cos(a) * radius * 0.35, y: y - r * 0.9 + (puff === 0 ? radius * 0.18 : 0), z: z + Math.sin(a) * radius * 0.35 }, { radiusX: r, radiusY: r * 0.85, radiusZ: r, segments: 7, rings: 3 });
    }
  }
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const lean = random() * Math.PI * 0.5;
    const r = radius * (0.75 + random() * 0.35);
    const at = [x + Math.cos(angle) * Math.sin(lean) * r, y + Math.cos(lean) * r * 0.6, z + Math.sin(angle) * Math.sin(lean) * r];
    const size = radius * 0.16;
    // A five-point star, flat-faced to the sky: the cheapest shape that reads as a flower.
    const centre = add(at, [0, size * 0.25, 0]);
    for (let petal = 0; petal < 5; petal += 1) {
      const a0 = (petal / 5) * Math.PI * 2 + angle;
      const a1 = ((petal + 0.5) / 5) * Math.PI * 2 + angle;
      facingTriangle(flowers, centre, add(at, [Math.cos(a0) * size, 0, Math.sin(a0) * size]), add(at, [Math.cos(a1) * size * 0.45, 0, Math.sin(a1) * size * 0.45]), [0, 1, 0]);
      facingTriangle(flowers, centre, add(at, [Math.cos(a1) * size * 0.45, 0, Math.sin(a1) * size * 0.45]), add(at, [Math.cos(a0 + (Math.PI * 2) / 5) * size, 0, Math.sin(a0 + (Math.PI * 2) / 5) * size]), [0, 1, 0]);
    }
  }
}

// Note: glb.mjs's `leafBlade` lifts the tip for a positive `droop`; this pack passes a negative one
// wherever a leaf should arch over and hang (banana, areca, bamboo).

/** A branch as a chain of beams through `points`, thinning toward its tip. */
export function branch(target, points, { from, to }) {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const t = index / Math.max(1, points.length - 2);
    beam(target, points[index], points[index + 1], lerp(from, to, t), { caps: false });
  }
}

// --- foliage -----------------------------------------------------------------------------------

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTICES = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0], [0, -1, ICO_T], [0, 1, ICO_T],
  [0, -1, -ICO_T], [0, 1, -ICO_T], [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1]
].map(([a, b, c]) => {
  const size = Math.hypot(a, b, c);
  return [a / size, b / size, c / size];
});
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
];

/**
 * A rounded, faceted puff: an icosahedron (once subdivided with `detail: 1`), its points nudged in
 * and out a little so no two puffs are alike. The chunky flat-shaded clump stylised foliage is made
 * of - rounder than a ringed blob, so a crown reads as leaves and a blossom as a cloud, not a box.
 * The nudge is a function of the point itself, so faces that share a point stay joined.
 */
export function icoBlob(target, { x = 0, y = 0, z = 0 }, { radiusX, radiusY = radiusX, radiusZ = radiusX, detail = 0, jitter = 0.12, seed = 1 }) {
  let triangles = ICO_FACES.map(([a, b, c]) => [ICO_VERTICES[a], ICO_VERTICES[b], ICO_VERTICES[c]]);
  if (detail > 0) {
    const mid = (p, q) => {
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const size = Math.hypot(m[0], m[1], m[2]);
      return [m[0] / size, m[1] / size, m[2] / size];
    };
    triangles = triangles.flatMap(([p, q, r]) => {
      const pq = mid(p, q);
      const qr = mid(q, r);
      const rp = mid(r, p);
      return [[p, pq, rp], [pq, q, qr], [rp, qr, r], [pq, qr, rp]];
    });
  }
  const nudge = (v) => {
    const h = Math.sin(v[0] * 12.9898 + v[1] * 78.233 + v[2] * 37.719 + seed * 4.1) * 43758.5453;
    return 1 + ((h - Math.floor(h)) - 0.5) * 2 * jitter;
  };
  const place = (v) => {
    const k = nudge(v);
    return [x + v[0] * radiusX * k, y + v[1] * radiusY * k, z + v[2] * radiusZ * k];
  };
  for (const [p, q, r] of triangles) {
    const outward = [(p[0] + q[0] + r[0]) * radiusX, (p[1] + q[1] + r[1]) * radiusY, (p[2] + q[2] + r[2]) * radiusZ];
    facingTriangle(target, place(p), place(q), place(r), outward);
  }
}

/** A point along a leaf's midrib: out along `yaw`, rising at `rise` radians, bending down by `droop`. */
function midrib(base, { yaw, length, rise, droop }, s) {
  const reach = length * s * Math.cos(rise);
  return [base[0] + Math.cos(yaw) * reach, base[1] + length * s * Math.sin(rise) - droop * length * s * s, base[2] + Math.sin(yaw) * reach];
}

/**
 * A pinnate frond, the leaf of a palm: a curving midrib with leaflets in pairs down both sides,
 * shortening toward the tip. `rise` is how steeply it leaves the crown, `droop` how far it bends over.
 */
export function pinnateFrond(rachis, leaflets, base, { yaw, length, rise, droop, pairs = 8, leafletLength, leafletWidth = 0.06, thickness = 0.04, hang = 0.35 }) {
  const shape = { yaw, length, rise, droop };
  const steps = 4;
  let previous = base;
  for (let step = 1; step <= steps; step += 1) {
    const next = midrib(base, shape, step / steps);
    beam(rachis, previous, next, thickness * lerp(1, 0.4, step / steps), { caps: false });
    previous = next;
  }
  for (let pair = 0; pair < pairs; pair += 1) {
    const s = 0.12 + (pair / pairs) * 0.86;
    const at = midrib(base, shape, s);
    const ahead = midrib(base, shape, Math.min(1, s + 0.02));
    const tangent = [ahead[0] - at[0], ahead[1] - at[1], ahead[2] - at[2]];
    const size = Math.hypot(tangent[0], tangent[1], tangent[2]) || 1;
    const t = [tangent[0] / size, tangent[1] / size, tangent[2] / size];
    const side = [-t[2], 0, t[0]];
    const sideSize = Math.hypot(side[0], side[2]) || 1;
    const length2 = leafletLength * (1 - 0.55 * s);
    for (const sign of [-1, 1]) {
      const tip = [
        at[0] + (side[0] / sideSize) * sign * length2 + t[0] * length2 * 0.45,
        at[1] - length2 * hang + t[1] * length2 * 0.45,
        at[2] + (side[2] / sideSize) * sign * length2 + t[2] * length2 * 0.45
      ];
      sheetTriangle(leaflets, add(at, [-t[0] * leafletWidth, -t[1] * leafletWidth, -t[2] * leafletWidth]), add(at, [t[0] * leafletWidth, t[1] * leafletWidth, t[2] * leafletWidth]), tip);
    }
  }
}

/**
 * A broad paddle leaf, the banana's: a stalk, then a long blade either side of a midrib, folded a
 * little into a shallow V and widest past its middle.
 */
export function paddleLeaf(blade, stalk, base, { yaw, length, width, rise, droop, segments = 6, fold = 0.18, stalkShare = 0.14 }) {
  const shape = { yaw, length, rise, droop };
  const start = midrib(base, shape, stalkShare);
  beam(stalk, base, start, 0.07, { caps: false });
  let previous = null;
  for (let step = 0; step <= segments; step += 1) {
    const s = stalkShare + (step / segments) * (1 - stalkShare);
    const at = midrib(base, shape, s);
    const ahead = midrib(base, shape, Math.min(1, s + 0.02));
    const tx = ahead[0] - at[0];
    const tz = ahead[2] - at[2];
    const size = Math.hypot(tx, tz) || 1;
    const side = [-tz / size, 0, tx / size];
    const w = width * Math.sin(Math.PI * Math.min(1, (step / segments) * 0.92 + 0.08)) ** 0.7;
    const left = [at[0] + side[0] * w, at[1] - fold * w, at[2] + side[2] * w];
    const right = [at[0] - side[0] * w, at[1] - fold * w, at[2] - side[2] * w];
    if (previous !== null) {
      sheetQuad(blade, previous.left, left, at, previous.at);
      sheetQuad(blade, previous.at, at, right, previous.right);
    }
    previous = { at, left, right };
  }
}

// --- houses ----------------------------------------------------------------------------------------

/** Nhà tranh vách đất: earth walls, a plank door, barred windows, a deep thatch in layers down to low eaves. */
export function buildThatchCottage() {
  const mud = part("viet_mud", C.mud);
  const straw = part("viet_straw", C.straw);
  const strawDark = part("viet_straw_dark", C.strawDark);
  const timber = part("viet_timber", C.timber);
  const bamboo = part("viet_bamboo", C.bamboo);
  const ink = part("viet_ink", C.ink);
  softBox(mud, { y: 0 }, { width: 2.9, depth: 2.4, height: 0.14 });
  taperedBox(mud, { y: 0.14 }, { width: 2.5, depth: 1.95, height: 1.3, topScale: 0.97 });
  // The door, in the middle of the front, and two windows barred with bamboo.
  softBox(timber, { y: 0.14, z: 0.98 }, { width: 0.62, depth: 0.06, height: 1.05 });
  softBox(ink, { y: 0.2, z: 1.0 }, { width: 0.04, depth: 0.04, height: 0.95 });
  for (const side of [-1, 1]) {
    softBox(ink, { x: side * 0.82, y: 0.62, z: 0.97 }, { width: 0.5, depth: 0.04, height: 0.4 });
    for (let bar = 0; bar < 4; bar += 1) {
      softBox(bamboo, { x: side * 0.82 - 0.18 + bar * 0.12, y: 0.62, z: 1.0 }, { width: 0.04, depth: 0.04, height: 0.4 });
    }
  }
  // Two bamboo posts under the front eave: a porch to sit out of the rain.
  for (const side of [-1, 1]) beam(bamboo, [side * 1.2, 0.14, 1.38], [side * 1.2, 1.25, 1.38], 0.1);
  // The thatch comes down low and thick: a deep eave roll, and the courses of rice straw marked across it.
  const roof = hipRoof(straw, { y: 1.3, width: 3.5, depth: 3.1, height: 1.55, ridge: 1.4, sag: 0.03, lift: 0.03 });
  eaveBand(strawDark, roof, { thickness: 0.26 });
  for (const v of [0.4, 0.72]) {
    for (let face = 0; face < 4; face += 1) {
      for (let step = 0; step < 4; step += 1) {
        beam(strawDark, add(roof.surface(face, step / 4, v), [0, 0.015, 0]), add(roof.surface(face, (step + 1) / 4, v), [0, 0.015, 0]), 0.035, { caps: false });
      }
    }
  }
  // The ridge capped with a roll of straw.
  beam(strawDark, add(roof.ridgeLeft, [-0.1, 0.02, 0]), add(roof.ridgeRight, [0.1, 0.02, 0]), 0.17);
  return [mud, straw, strawDark, timber, bamboo, ink];
}

/** Nhà ba gian: a stone plinth, a veranda of four columns, three doors, a curled tiled roof. */
export function buildTiledHouse() {
  const stone = part("viet_stone", C.slab);
  const lime = part("viet_lime", C.lime);
  const timber = part("viet_timber", C.timber);
  const timberDark = part("viet_timber_dark", C.timberDark);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  softBox(stone, { y: 0 }, { width: 4.3, depth: 3.1, height: 0.3 });
  softBox(stone, { y: 0, z: 1.68 }, { width: 1.3, depth: 0.28, height: 0.15 });
  softBox(lime, { y: 0.3, z: -0.25 }, { width: 3.7, depth: 2.05, height: 1.85 });
  // The three bays: a wide panelled door in the middle, lattice doors either side.
  softBox(timberDark, { y: 0.3, z: 0.79 }, { width: 1.0, depth: 0.06, height: 1.5 });
  for (const leaf of [-0.25, 0.25]) softBox(timber, { x: leaf, y: 0.36, z: 0.83 }, { width: 0.42, depth: 0.04, height: 1.38 });
  for (const side of [-1, 1]) {
    softBox(timberDark, { x: side * 1.22, y: 0.3, z: 0.79 }, { width: 0.9, depth: 0.06, height: 1.4 });
    for (let bar = 0; bar < 6; bar += 1) softBox(timber, { x: side * 1.22 - 0.36 + bar * 0.145, y: 0.42, z: 0.83 }, { width: 0.05, depth: 0.03, height: 1.2 });
    softBox(timber, { x: side * 1.22, y: 1.02, z: 0.84 }, { width: 0.86, depth: 0.03, height: 0.05 });
  }
  for (const x of [-1.75, -0.6, 0.6, 1.75]) {
    taperedCylinder(timberDark, { x, y: 0.3, z: 1.28 }, { bottomRadius: 0.1, topRadius: 0.085, height: 1.75, segments: 7 });
    taperedCylinder(stone, { x, y: 0.3, z: 1.28 }, { bottomRadius: 0.15, topRadius: 0.13, height: 0.08, segments: 7 });
  }
  beam(timberDark, [-2.0, 2.06, 1.28], [2.0, 2.06, 1.28], 0.14);
  const roof = hipRoof(tile, { y: 2.08, width: 4.7, depth: 3.5, height: 1.45, ridge: 2.9, sag: 0.12, lift: 0.22 });
  tileCourses(tileDark, roof, { courses: 11 });
  ridgeDressing(tileDark, roof, { thickness: 0.2, curl: 0.42, tips: 0.32, tipOut: 0.18 });
  return [stone, lime, timber, timberDark, tile, tileDark];
}

/** Nhà sàn: a plank house raised on posts, a ladder to its door, a steep thatched roof. */
export function buildStiltHouse() {
  const post = part("viet_timber_dark", C.timberDark);
  const timber = part("viet_timber", C.timber);
  const straw = part("viet_straw", C.straw);
  const strawDark = part("viet_straw_dark", C.strawDark);
  const ink = part("viet_ink", C.ink);
  for (const x of [-1.2, 0, 1.2]) {
    for (const z of [-1.0, 0, 1.0]) taperedCylinder(post, { x, y: 0, z }, { bottomRadius: 0.11, topRadius: 0.09, height: 1.15, segments: 6 });
  }
  softBox(timber, { y: 1.15, z: 0.15 }, { width: 3.0, depth: 2.6, height: 0.12 });
  softBox(timber, { y: 1.27 }, { width: 2.6, depth: 2.1, height: 1.3 });
  // Plank seams on the front wall, a door and a window.
  for (let seam = 0; seam < 7; seam += 1) softBox(post, { x: -1.2 + seam * 0.4, y: 1.27, z: 1.06 }, { width: 0.03, depth: 0.03, height: 1.3 });
  softBox(ink, { x: -0.35, y: 1.27, z: 1.07 }, { width: 0.6, depth: 0.04, height: 1.0 });
  softBox(ink, { x: 0.75, y: 1.65, z: 1.07 }, { width: 0.55, depth: 0.04, height: 0.4 });
  // A railing along the front of the platform, and the ladder up to it.
  beam(post, [0.1, 1.6, 1.42], [1.5, 1.6, 1.42], 0.06);
  for (const x of [0.1, 0.8, 1.5]) beam(post, [x, 1.27, 1.42], [x, 1.6, 1.42], 0.06);
  for (const side of [-1, 1]) beam(post, [-0.35 + side * 0.24, 0, 2.15], [-0.35 + side * 0.24, 1.27, 1.42], 0.07);
  for (let rung = 1; rung < 5; rung += 1) {
    const t = rung / 5;
    beam(post, [-0.59, 1.27 * t, lerp(2.15, 1.42, t)], [-0.11, 1.27 * t, lerp(2.15, 1.42, t)], 0.05);
  }
  const roof = hipRoof(straw, { y: 2.5, width: 3.4, depth: 2.9, height: 1.75, ridge: 2.0, sag: 0.06, lift: 0.05 });
  eaveBand(strawDark, roof, { thickness: 0.18 });
  ridgeDressing(strawDark, roof, { thickness: 0.2, curl: 0.3 });
  return [post, timber, straw, strawDark, ink];
}

// --- village pieces --------------------------------------------------------------------------------

/**
 * Cổng làng, "thượng gia hạ môn": a lime-washed masonry gate, mossy at its foot, a round arch below
 * and a small tiled house above it with the village's name board; a trụ biểu pillar either side,
 * taller than the wing walls that join them, each crowned with a lantern cap.
 */
export function buildVillageGate() {
  const lime = part("viet_lime", 0xe7dcc0);
  const moss = part("viet_moss", 0x9aa37a);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const lacquer = part("viet_lacquer", C.lacquer);
  const gold = part("viet_gold", C.gold);
  const depth = 1.0;
  // The gate body: two piers and the arch between them, a moss course along the foot.
  for (const side of [-1, 1]) {
    softBox(lime, { x: side * 0.98 }, { width: 0.66, depth, height: 2.25 });
    softBox(moss, { x: side * 0.98, y: 0 }, { width: 0.7, depth: depth + 0.04, height: 0.32 });
  }
  archedSpan(lime, { x0: -0.65, x1: 0.65, spring: 1.3, top: 2.25, z0: -depth / 2, z1: depth / 2 });
  softBox(lime, { y: 2.25 }, { width: 2.7, depth: depth + 0.12, height: 0.12 });
  // The little house above the arch, its name board on the front.
  softBox(lime, { y: 2.37 }, { width: 1.9, depth: 0.85, height: 0.62 });
  softBox(gold, { y: 2.42, z: 0.44 }, { width: 1.1, depth: 0.04, height: 0.44 });
  softBox(lacquer, { y: 2.46, z: 0.47 }, { width: 0.98, depth: 0.03, height: 0.36 });
  const roof = hipRoof(tile, { y: 2.95, width: 2.8, depth: 1.6, height: 0.72, ridge: 1.6, sag: 0.14, lift: 0.26 });
  tileCourses(tileDark, roof, { courses: 8, thickness: 0.04 });
  ridgeDressing(tileDark, roof, { thickness: 0.13, curl: 0.34, tips: 0.3, tipOut: 0.12 });
  faceDisc(gold, { y: 3.85, z: 0.02 }, { radius: 0.12, segments: 10 });
  // Wing walls with a tiled coping, and the trụ biểu at their ends.
  for (const side of [-1, 1]) {
    softBox(lime, { x: side * 1.65 }, { width: 0.7, depth: 0.32, height: 1.25 });
    softBox(moss, { x: side * 1.65 }, { width: 0.72, depth: 0.34, height: 0.25 });
    taperedBox(tile, { x: side * 1.65, y: 1.25 }, { width: 0.8, depth: 0.46, height: 0.14, topScale: 0.45 });
    const x = side * 2.15;
    softBox(moss, { x }, { width: 0.42, depth: 0.42, height: 0.3 });
    taperedBox(lime, { x, y: 0.3 }, { width: 0.36, depth: 0.36, height: 2.6, topScale: 0.88 });
    softBox(lime, { x, y: 2.9 }, { width: 0.44, depth: 0.44, height: 0.08 });
    // The lantern cap: a little open box, a roof, a knob on top.
    softBox(lacquer, { x, y: 2.98 }, { width: 0.3, depth: 0.3, height: 0.3 });
    taperedBox(tile, { x, y: 3.28 }, { width: 0.5, depth: 0.5, height: 0.16, topScale: 0.3 });
    lathe(gold, [[0.06, 3.44], [0.08, 3.5], [0.02, 3.66]], { x, segments: 6 });
  }
  return [lime, moss, tile, tileDark, lacquer, gold];
}

/** Miếu: a stepped stone base, red columns, a roof with swept corners and a moon on the ridge. */
export function buildShrine() {
  const stone = part("viet_stone", C.slab);
  const lime = part("viet_lime", C.lime);
  const lacquer = part("viet_lacquer", C.lacquer);
  const tile = part("viet_tile", C.tile);
  const tileDark = part("viet_tile_dark", C.tileDark);
  const gold = part("viet_gold", C.gold);
  softBox(stone, { y: 0 }, { width: 2.0, depth: 2.0, height: 0.18 });
  softBox(stone, { y: 0.18 }, { width: 1.65, depth: 1.65, height: 0.16 });
  softBox(lime, { y: 0.34, z: -0.12 }, { width: 1.2, depth: 1.0, height: 1.0 });
  softBox(tileDark, { y: 0.34, z: 0.39 }, { width: 0.5, depth: 0.04, height: 0.72 });
  for (const x of [-0.62, 0.62]) {
    for (const z of [0.6, -0.6]) taperedCylinder(lacquer, { x, y: 0.34, z }, { bottomRadius: 0.07, topRadius: 0.06, height: 1.08, segments: 7 });
  }
  softBox(lacquer, { y: 1.34, z: 0.6 }, { width: 1.4, depth: 0.08, height: 0.1 });
  const roof = hipRoof(tile, { y: 1.42, width: 2.1, depth: 2.0, height: 0.78, ridge: 0.8, sag: 0.18, lift: 0.3 });
  tileCourses(tileDark, roof, { courses: 7, thickness: 0.035 });
  ridgeDressing(tileDark, roof, { thickness: 0.1, curl: 0.3, tips: 0.34, tipOut: 0.14 });
  // Lưỡng long chầu nguyệt, simplified: a moon on the ridge between two curls.
  faceDisc(gold, { y: 2.42, z: 0.02 }, { radius: 0.12, segments: 10 });
  // An incense urn on the step.
  lathe(gold, [[0.06, 0.34], [0.13, 0.4], [0.14, 0.5], [0.11, 0.56], [0.13, 0.6]], { z: 0.68, segments: 8 });
  return [stone, lime, lacquer, tile, tileDark, gold];
}

/** Giếng làng: a round brick well on a stone apron, still water inside, a wooden bucket on the rim. */
export function buildVillageWell() {
  const slab = part("viet_stone", C.slab);
  const brick = part("viet_brick", C.brick);
  const water = part("viet_water", C.water);
  const timber = part("viet_timber", C.timber);
  const moss = part("viet_moss", C.leafDeep);
  softBox(slab, { y: 0 }, { width: 2.0, depth: 2.0, height: 0.1 });
  lathe(brick, [[0.66, 0.1], [0.66, 0.72], [0.52, 0.72], [0.52, 0.42]], { segments: 14, capBottom: false, capTop: false });
  disc(water, { y: 0.42 }, { radiusX: 0.52, segments: 14 });
  // A darker coping course and moss at its foot.
  lathe(slab, [[0.69, 0.72], [0.69, 0.8], [0.5, 0.8], [0.5, 0.72]], { segments: 14, capBottom: false, capTop: false });
  for (let tuft = 0; tuft < 6; tuft += 1) {
    const angle = tuft * 1.1 + 0.4;
    lowPolyBlob(moss, { x: Math.cos(angle) * 0.7, y: 0.08, z: Math.sin(angle) * 0.7 }, { radiusX: 0.12, radiusY: 0.05, radiusZ: 0.1, segments: 5, rings: 2 });
  }
  // The bucket (gàu) and its bamboo pole, resting against the rim.
  lathe(timber, [[0.12, 0.8], [0.15, 1.02], [0.14, 1.04]], { x: 0.52, z: 0.42, segments: 8 });
  beam(timber, [0.52, 1.0, 0.42], [0.95, 2.1, 0.75], 0.05);
  return [slab, brick, water, timber, moss];
}

/** Chum vại: three earthen jars with wooden lids, the biggest glazed dark at the shoulder. */
export function buildJars() {
  const clay = part("viet_clay", C.clay);
  const glaze = part("viet_glaze", C.glaze);
  const timber = part("viet_timber", C.timber);
  const jar = (target, x, z, s) => {
    lathe(target, [[0.17 * s, 0], [0.3 * s, 0.14 * s], [0.36 * s, 0.38 * s], [0.31 * s, 0.6 * s], [0.2 * s, 0.7 * s], [0.22 * s, 0.75 * s]], { x, z, segments: 12, capTop: false });
    disc(timber, { x, y: 0.755 * s, z }, { radiusX: 0.24 * s, segments: 10 });
  };
  jar(glaze, -0.22, -0.12, 1.15);
  jar(clay, 0.33, 0.1, 0.85);
  jar(clay, -0.12, 0.38, 0.62);
  return [clay, glaze, timber];
}

/** Cây rơm: straw stacked round a bamboo pole, swelling then tapering to a capped top. */
export function buildStrawStack() {
  const straw = part("viet_straw", C.straw);
  const strawDark = part("viet_straw_dark", C.strawDark);
  const bamboo = part("viet_bamboo", C.bamboo);
  lathe(straw, [[0.5, 0], [0.62, 0.35], [0.64, 0.8], [0.5, 1.25], [0.24, 1.58], [0.06, 1.7]], { segments: 10, phase: 0.2 });
  lathe(strawDark, [[0.66, 0.78], [0.68, 0.84], [0.62, 0.9]], { segments: 10, phase: 0.2, capBottom: false, capTop: false });
  lathe(strawDark, [[0.18, 1.6], [0.22, 1.66], [0.05, 1.86]], { segments: 8, capBottom: false });
  beam(bamboo, [0, 1.6, 0], [0, 2.2, 0], 0.07);
  // Loose straw at its foot.
  for (let wisp = 0; wisp < 5; wisp += 1) {
    const angle = wisp * 1.3;
    beam(straw, [Math.cos(angle) * 0.55, 0.02, Math.sin(angle) * 0.55], [Math.cos(angle + 0.3) * 0.85, 0.02, Math.sin(angle + 0.3) * 0.85], 0.05);
  }
  return [straw, strawDark, bamboo];
}

/** Cối đá: a stone mortar with its wooden pestle, and a woven winnowing tray (nia) beside it. */
export function buildRiceMortar() {
  const stone = part("viet_stone", C.stone);
  const timber = part("viet_timber", C.timber);
  const bamboo = part("viet_bamboo", C.bamboo);
  lathe(stone, [[0.28, 0], [0.33, 0.3], [0.31, 0.44], [0.22, 0.44], [0.17, 0.22], [0.0, 0.2]], { segments: 10, capTop: false });
  beam(timber, [0.05, 0.25, 0.02], [-0.18, 1.25, -0.12], 0.08);
  lathe(bamboo, [[0.0, 0.02], [0.42, 0.04], [0.46, 0.1]], { x: 0.62, z: 0.25, segments: 12, capBottom: false, capTop: false });
  lathe(bamboo, [[0.46, 0.1], [0.44, 0.02], [0.0, 0.0]], { x: 0.62, z: 0.25, segments: 12, capBottom: false, capTop: false });
  return [stone, timber, bamboo];
}

/** Chõng tre: a low bamboo daybed of slats, with a tea tray on it. */
export function buildBambooDaybed() {
  const bamboo = part("viet_bamboo", C.bamboo);
  const bambooGreen = part("viet_bamboo_green", C.bambooGreen);
  const porcelain = part("viet_porcelain", C.porcelain);
  const timber = part("viet_timber", C.timber);
  for (const x of [-0.8, 0.8]) {
    for (const z of [-0.36, 0.36]) beam(bambooGreen, [x, 0, z], [x, 0.45, z], 0.07);
  }
  for (const z of [-0.4, 0.4]) beam(bambooGreen, [-0.9, 0.42, z], [0.9, 0.42, z], 0.07);
  for (const x of [-0.85, 0.85]) beam(bambooGreen, [x, 0.42, -0.4], [x, 0.42, 0.4], 0.07);
  for (let slat = 0; slat < 9; slat += 1) beam(bamboo, [-0.9, 0.47, -0.36 + slat * 0.09], [0.9, 0.47, -0.36 + slat * 0.09], 0.05);
  softBox(timber, { x: 0.3, y: 0.5, z: 0 }, { width: 0.42, depth: 0.32, height: 0.04 });
  lathe(porcelain, [[0.06, 0.54], [0.09, 0.6], [0.07, 0.66], [0.02, 0.68]], { x: 0.25, segments: 8 });
  beam(porcelain, [0.33, 0.6, 0], [0.4, 0.66, 0], 0.025);
  for (const [x, z] of [[0.43, 0.1], [0.43, -0.08], [0.17, 0.11]]) lathe(porcelain, [[0.025, 0.54], [0.035, 0.58]], { x, z, segments: 6 });
  return [bamboo, bambooGreen, porcelain, timber];
}

/** Cột đèn lồng: a wooden post with a cross arm, a red and a yellow Hội An lantern hanging from it. */
export function buildLanternPost() {
  const wood = part("viet_timber_dark", C.timberDark);
  const red = part("viet_lantern_red", C.lanternRed);
  const yellow = part("viet_lantern_yellow", C.lanternYellow);
  const stone = part("viet_stone", C.slab);
  softBox(stone, { y: 0 }, { width: 0.4, depth: 0.4, height: 0.14 });
  taperedCylinder(wood, { y: 0.14 }, { bottomRadius: 0.07, topRadius: 0.055, height: 2.2, segments: 6 });
  beam(wood, [-0.55, 2.15, 0], [0.55, 2.15, 0], 0.07);
  beam(wood, [0, 1.95, 0], [-0.3, 2.15, 0], 0.05);
  beam(wood, [0, 1.95, 0], [0.3, 2.15, 0], 0.05);
  for (const [x, silk] of [[-0.48, red], [0.48, yellow]]) {
    beam(wood, [x, 2.15, 0], [x, 2.02, 0], 0.02);
    lantern(silk, wood, { x, y: 2.02, z: 0 }, { size: 1 });
  }
  return [wood, red, yellow, stone];
}

/** Dây đèn lồng: two posts and a sagging line of lanterns, red, yellow and pink. */
export function buildLanternString() {
  const wood = part("viet_timber_dark", C.timberDark);
  const red = part("viet_lantern_red", C.lanternRed);
  const yellow = part("viet_lantern_yellow", C.lanternYellow);
  const pink = part("viet_lantern_pink", C.lotus);
  for (const x of [-1.5, 1.5]) taperedCylinder(wood, { x, y: 0 }, { bottomRadius: 0.07, topRadius: 0.055, height: 2.35, segments: 6 });
  const count = 5;
  let previous = [-1.5, 2.3, 0];
  for (let index = 0; index <= count + 1; index += 1) {
    const t = index / (count + 1);
    const x = lerp(-1.5, 1.5, t);
    const y = 2.3 - Math.sin(Math.PI * t) * 0.35;
    const point = [x, y, 0];
    if (index > 0) beam(wood, previous, point, 0.02, { caps: false });
    previous = point;
    if (index > 0 && index <= count) lantern([red, yellow, pink][index % 3], wood, { x, y, z: 0 }, { size: 0.8 });
  }
  return [wood, red, yellow, pink];
}

/** Cây cảnh: a round blue-and-white glazed pot on little feet, a twisting trunk, cloud-pruned pads. */
export function buildBonsai() {
  const porcelain = part("viet_porcelain", C.porcelain);
  const cobalt = part("viet_cobalt", C.cobalt);
  const trunk = part("viet_timber_dark", C.timberDark);
  const leaf = part("viet_leaf", C.leafDeep);
  const leafLight = part("viet_leaf_light", C.leaf);
  lathe(porcelain, [[0.22, 0.05], [0.3, 0.12], [0.33, 0.24], [0.3, 0.33], [0.34, 0.36]], { segments: 14 });
  for (const [y0, y1] of [[0.14, 0.18], [0.27, 0.3]]) lathe(cobalt, [[0.315, y0], [0.32, y1]], { segments: 14, capBottom: false, capTop: false });
  lathe(cobalt, [[0.34, 0.36], [0.35, 0.39], [0.3, 0.39]], { segments: 14, capBottom: false });
  for (let foot = 0; foot < 3; foot += 1) {
    const a = (foot / 3) * Math.PI * 2;
    softBox(cobalt, { x: Math.cos(a) * 0.2, z: Math.sin(a) * 0.2 }, { width: 0.07, depth: 0.07, height: 0.06 });
  }
  branch(trunk, [[0, 0.38, 0], [0.1, 0.55, 0.03], [-0.06, 0.74, 0], [0.05, 0.92, -0.02], [-0.03, 1.06, 0]], { from: 0.12, to: 0.05 });
  beam(trunk, [-0.06, 0.74, 0], [-0.32, 0.84, 0.06], 0.05, { caps: false });
  beam(trunk, [0.05, 0.92, -0.02], [0.3, 0.98, -0.05], 0.045, { caps: false });
  const pads = [[-0.34, 0.86, 0.06, 0.2, leaf], [0.31, 1.0, -0.05, 0.18, leafLight], [-0.03, 1.1, 0, 0.21, leaf], [0.12, 0.72, 0.08, 0.14, leafLight]];
  pads.forEach(([x, y, z, r, target], index) => {
    icoBlob(target, { x, y, z }, { radiusX: r, radiusY: r * 0.42, radiusZ: r * 0.85, detail: 1, jitter: 0.1, seed: index + 3 });
  });
  return [porcelain, cobalt, trunk, leaf, leafLight];
}

/** Hòn non bộ: craggy limestone spires in a basin of water, moss on their ledges, a pagoda and a little bridge. */
export function buildRockery() {
  const basin = part("viet_stone", C.slab);
  const rock = part("viet_rock", 0x9b9c94);
  const water = part("viet_water", C.water);
  const moss = part("viet_leaf", C.leaf);
  const tile = part("viet_tile", C.tile);
  lathe(basin, [[0.9, 0], [0.98, 0.3], [0.88, 0.3], [0.85, 0.22]], { segments: 12, phase: 0.26, capTop: false });
  disc(water, { y: 0.22 }, { radiusX: 0.86, segments: 12, phase: 0.26 });
  const random = seededRandom(31);
  // Karst spires: tall, narrow and uneven, leaning a little, like the peaks of Hạ Long in miniature.
  const spires = [[-0.12, -0.12, 1.55, 0.34], [0.3, -0.18, 1.05, 0.26], [-0.45, 0.12, 0.8, 0.22], [0.08, 0.3, 0.55, 0.2], [0.42, 0.22, 0.42, 0.16]];
  for (const [x, z, height, r] of spires) {
    const lean = (random() - 0.5) * 0.15;
    const profile = [[r, 0.18], [r * (0.95 + random() * 0.2), height * 0.25], [r * (0.6 + random() * 0.25), height * 0.5], [r * (0.55 + random() * 0.2), height * 0.7], [r * 0.3, height * 0.88], [0.02, height]];
    lathe(rock, profile.map(([pr, py]) => [pr, py]), { x: x + lean, z, segments: 6, phase: random() * 3 });
    icoBlob(moss, { x: x + lean + r * 0.3, y: height * 0.62, z: z + r * 0.2 }, { radiusX: r * 0.42, radiusY: r * 0.22, radiusZ: r * 0.36, jitter: 0.2, seed: Math.floor(random() * 100) });
  }
  // A pagoda on a ledge: three little roofs stacked.
  for (let tier = 0; tier < 3; tier += 1) {
    const s = 1 - tier * 0.22;
    softBox(tile, { x: 0.3, y: 0.98 + tier * 0.1, z: -0.02 }, { width: 0.07 * s, depth: 0.07 * s, height: 0.05 });
    taperedBox(tile, { x: 0.3, y: 1.03 + tier * 0.1, z: -0.02 }, { width: 0.16 * s, depth: 0.16 * s, height: 0.04, topScale: 0.3 });
  }
  // A little arched bridge across the water at the foot of the peaks.
  for (let step = 0; step < 4; step += 1) {
    const x0 = -0.62 + step * 0.12;
    const x1 = x0 + 0.12;
    const y = (x) => 0.25 + 0.08 * Math.sin(((x + 0.62) / 0.48) * Math.PI);
    facingQuad(tile, [x0, y(x0), 0.58], [x1, y(x1), 0.58], [x1, y(x1), 0.5], [x0, y(x0), 0.5], [0, 1, 0]);
  }
  return [basin, rock, water, moss, tile];
}

/** Ao sen: a pond rimmed with rounded stones, broad lily pads, open pink lotus and buds. */
export function buildLotusPond() {
  const stone = part("viet_stone", 0xb9b3a2);
  const water = part("viet_water", C.water);
  const pad = part("viet_leaf", C.leaf);
  const lotus = part("viet_lotus", C.lotus);
  const gold = part("viet_gold", C.gold);
  disc(water, { y: 0.05 }, { radiusX: 1.35, radiusZ: 1.15, segments: 16 });
  const random = seededRandom(7);
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + random() * 0.1;
    const r = 0.22 + random() * 0.08;
    icoBlob(stone, { x: Math.cos(angle) * 1.42, y: 0.04, z: Math.sin(angle) * 1.22 }, { radiusX: r, radiusY: r * 0.48, radiusZ: r * 0.8, jitter: 0.18, seed: index });
  }
  const pads = [[-0.62, 0.3], [0.52, -0.42], [0.12, 0.58], [-0.2, -0.52], [0.78, 0.22], [-0.86, -0.18], [0.32, 0.06], [-0.35, 0.02], [0.62, 0.62]];
  for (const [x, z] of pads) disc(pad, { x, y: 0.08 }, { radiusX: 0.3 + random() * 0.1, segments: 10, phase: random() * 3 });
  // Open flowers: an outer and an inner ring of petals round a golden seed head; buds on stems.
  for (const [x, z, h] of [[-0.5, 0.25, 0.42], [0.45, -0.32, 0.36], [0.28, 0.15, 0.5]]) {
    beam(pad, [x, 0.06, z], [x, h, z], 0.035, { caps: false });
    taperedCylinder(gold, { x, y: h, z }, { bottomRadius: 0.05, topRadius: 0.07, height: 0.06, segments: 6 });
    for (let petal = 0; petal < 10; petal += 1) {
      const outer = petal % 2 === 0;
      leafBlade(lotus, { x, y: h, z }, { length: outer ? 0.3 : 0.22, width: 0.1, yaw: (petal / 10) * Math.PI * 2, tilt: outer ? 0.55 : 1.05, droop: 0.2 });
    }
  }
  for (const [x, z, h] of [[0.1, 0.62, 0.55], [-0.28, -0.42, 0.48], [0.7, -0.05, 0.4]]) {
    beam(pad, [x, 0.06, z], [x, h, z], 0.03, { caps: false });
    icoBlob(lotus, { x, y: h + 0.06, z }, { radiusX: 0.06, radiusY: 0.11, radiusZ: 0.06, jitter: 0.05 });
  }
  return [stone, water, pad, lotus, gold];
}

/** Bình phong: a screen wall on a plinth, a gold moon in a red frame, a small tiled cap. */
export function buildScreenWall() {
  const stone = part("viet_stone", C.slab);
  const lime = part("viet_lime", C.lime);
  const lacquer = part("viet_lacquer", C.lacquer);
  const gold = part("viet_gold", C.gold);
  const tile = part("viet_tile", C.tile);
  softBox(stone, { y: 0 }, { width: 2.0, depth: 0.5, height: 0.25 });
  softBox(lime, { y: 0.25 }, { width: 1.8, depth: 0.32, height: 1.25 });
  for (const side of [-1, 1]) softBox(lime, { x: side * 0.95, y: 0.25 }, { width: 0.24, depth: 0.4, height: 1.45 });
  for (const face of [1, -1]) {
    const z = face * 0.17;
    softBox(lacquer, { y: 0.45, z }, { width: 1.2, depth: 0.02, height: 0.85 });
    faceDisc(gold, { y: 0.875, z: z + face * 0.015 }, { radius: 0.27, segments: 14 });
  }
  const roof = hipRoof(tile, { y: 1.5, width: 2.25, depth: 0.62, height: 0.3, ridge: 1.6, sag: 0.1, lift: 0.1, segments: 3 });
  ridgeDressing(tile, roof, { thickness: 0.08, curl: 0.16 });
  return [stone, lime, lacquer, gold, tile];
}

/** Hàng rào tre: two posts, two rails and a lattice of split bamboo between them. */
export function buildBambooFence() {
  const post = part("viet_bamboo_green", C.bambooGreen);
  const slat = part("viet_bamboo", C.bamboo);
  const half = 0.54;
  for (const x of [-half, half]) {
    beam(post, [x, 0, 0], [x, 1.0, 0], 0.08);
    taperedCylinder(post, { x, y: 1.0, z: 0 }, { bottomRadius: 0.05, topRadius: 0.0, height: 0.08, segments: 5 });
  }
  for (const y of [0.25, 0.8]) beam(post, [-half, y, 0], [half, y, 0], 0.06);
  for (let index = 0; index < 5; index += 1) {
    const x = -half + 0.1 + index * 0.22;
    beam(slat, [x - 0.12, 0.08, 0.04], [x + 0.12, 0.95, 0.04], 0.035);
    beam(slat, [x + 0.12, 0.08, -0.04], [x - 0.12, 0.95, -0.04], 0.035);
  }
  return [post, slat];
}

/** Tường rào gạch hoa: a brick footing, lime pillars with caps, a breeze-block lattice under a tiled coping. */
export function buildBreezeBlockFence() {
  const brick = part("viet_brick", C.brick);
  const lime = part("viet_lime", C.lime);
  const tile = part("viet_tile", C.tile);
  const half = 0.54;
  softBox(brick, { y: 0 }, { width: 2 * half, depth: 0.24, height: 0.3 });
  softBox(lime, { y: 0.3 }, { width: 2 * half, depth: 0.27, height: 0.04 });
  for (const x of [-half + 0.1, half - 0.1]) {
    softBox(lime, { x, y: 0 }, { width: 0.2, depth: 0.28, height: 1.06 });
    softBox(lime, { x, y: 1.06 }, { width: 0.26, depth: 0.34, height: 0.06 });
    taperedBox(tile, { x, y: 1.12 }, { width: 0.26, depth: 0.34, height: 0.08, topScale: 0.4 });
  }
  // The lattice: a frame, and in every block a diamond inside a square - the read of a gạch hoa gió.
  const x0 = -half + 0.2;
  const x1 = half - 0.2;
  const y0 = 0.34;
  const y1 = 0.92;
  const columns = 3;
  const rows = 3;
  for (let column = 0; column <= columns; column += 1) beam(lime, [lerp(x0, x1, column / columns), y0, 0], [lerp(x0, x1, column / columns), y1, 0], 0.05);
  for (let row = 0; row <= rows; row += 1) beam(lime, [x0, lerp(y0, y1, row / rows), 0], [x1, lerp(y0, y1, row / rows), 0], 0.05);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const a = [lerp(x0, x1, column / columns), lerp(y0, y1, row / rows), 0];
      const b = [lerp(x0, x1, (column + 1) / columns), lerp(y0, y1, (row + 1) / rows), 0];
      const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
      beam(lime, [centre[0], a[1], 0], [b[0], centre[1], 0], 0.035, { caps: false });
      beam(lime, [b[0], centre[1], 0], [centre[0], b[1], 0], 0.035, { caps: false });
      beam(lime, [centre[0], b[1], 0], [a[0], centre[1], 0], 0.035, { caps: false });
      beam(lime, [a[0], centre[1], 0], [centre[0], a[1], 0], 0.035, { caps: false });
    }
  }
  softBox(lime, { y: 0.92 }, { width: 2 * half - 0.4, depth: 0.22, height: 0.05 });
  taperedBox(tile, { y: 0.97 }, { width: 2 * half - 0.36, depth: 0.3, height: 0.09, topScale: 0.45 });
  return [brick, lime, tile];
}

// --- trees -----------------------------------------------------------------------------------------

/** Cây đa: a thick buttressed trunk of fused stems, spreading limbs, a broad crown, roots hanging to the ground. */
export function buildBanyan() {
  const bark = part("viet_bark", 0x6e5640);
  const leaf = part("viet_leaf", C.leafDeep);
  const leafLight = part("viet_leaf_light", C.leaf);
  const random = seededRandom(5);
  // Three stems twisted together into one trunk, flaring into buttress roots at the foot.
  for (const [dx, dz] of [[0.18, 0], [-0.12, 0.15], [-0.08, -0.17]]) {
    taperedCylinder(bark, { x: dx, y: 0 }, { bottomRadius: 0.36, topRadius: 0.2, height: 2.3, segments: 7, leanX: -dx * 0.6, leanZ: -dz * 0.6 });
  }
  for (let root = 0; root < 6; root += 1) {
    const angle = (root / 6) * Math.PI * 2 + 0.3;
    beam(bark, [Math.cos(angle) * 1.0, 0, Math.sin(angle) * 1.0], [Math.cos(angle) * 0.25, 0.85, Math.sin(angle) * 0.25], 0.22);
  }
  const limbs = [[1.9, 3.0, 0.4], [-1.8, 3.1, -0.5], [0.3, 3.2, 1.8], [-0.4, 3.2, -1.8], [1.2, 3.4, -1.1], [-1.1, 3.3, 1.1]];
  for (const [x, y, z] of limbs) branch(bark, [[0, 2.0, 0], [x * 0.5, y - 0.4, z * 0.5], [x * 0.85, y - 0.1, z * 0.85]], { from: 0.22, to: 0.12 });
  // The crown: a broad, low dome of puffs, lighter on top where the sun falls.
  const crown = [];
  for (let ring = 0; ring < 3; ring += 1) {
    const count = [1, 6, 9][ring] ?? 1;
    const reach = [0, 1.25, 2.1][ring] ?? 0;
    for (let index = 0; index < count; index += 1) {
      const a = (index / count) * Math.PI * 2 + ring * 0.4 + random() * 0.3;
      crown.push([Math.cos(a) * reach, 3.85 - ring * 0.35 + random() * 0.2, Math.sin(a) * reach * 0.92, [1.25, 1.0, 0.85][ring] ?? 0.85]);
    }
  }
  crown.forEach(([x, y, z, r], index) => {
    // The inner crown is rounder (it is what the eye lands on); the outer ring is simpler.
    icoBlob(y > 3.6 ? leafLight : leaf, { x, y, z }, { radiusX: r, radiusY: r * 0.62, radiusZ: r, detail: index < 7 ? 1 : 0, jitter: 0.14, seed: index + 11 });
  });
  // Aerial roots: strands hanging from the limbs, the longest reaching the ground and thickening there.
  for (let strand = 0; strand < 12; strand += 1) {
    const angle = (strand / 12) * Math.PI * 2 + random() * 0.3;
    const r = 1.0 + random() * 1.0;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const bottom = strand % 3 === 0 ? 0 : 0.6 + random() * 1.2;
    beam(bark, [x, 3.0, z], [x * 1.03, bottom, z * 1.03], strand % 3 === 0 ? 0.1 : 0.05, { caps: false });
  }
  return [bark, leaf, leafLight];
}

/** Khóm tre: a clump of tall jointed culms leaning out, feathery leaves toward their tops. */
export function buildBambooClump() {
  const culm = part("viet_bamboo_green", C.bambooGreen);
  const node = part("viet_bamboo", C.bamboo);
  const leaf = part("viet_leaf_light", C.leafLight);
  const random = seededRandom(13);
  const stems = 7;
  for (let stem = 0; stem < stems; stem += 1) {
    const angle = (stem / stems) * Math.PI * 2 + random() * 0.4;
    const baseR = 0.12 + random() * 0.14;
    const lean = 0.18 + random() * 0.22;
    const height = 3.4 + random() * 1.0;
    const base = [Math.cos(angle) * baseR, 0, Math.sin(angle) * baseR];
    const top = [base[0] + Math.cos(angle) * lean * height, height, base[2] + Math.sin(angle) * lean * height];
    const joints = 5;
    let previous = base;
    for (let joint = 1; joint <= joints; joint += 1) {
      const t = joint / joints;
      const point = [lerp(base[0], top[0], t * t), lerp(0, height, t), lerp(base[2], top[2], t * t)];
      beam(culm, previous, point, lerp(0.075, 0.04, t), { caps: false });
      if (joint % 2 === 1) beam(node, point, add(point, [0, 0.03, 0]), lerp(0.095, 0.055, t), { caps: false });
      if (joint >= 3) {
        for (let blade = 0; blade < 3; blade += 1) {
          leafBlade(leaf, { x: point[0], y: point[1], z: point[2] }, { length: 0.58, width: 0.1, yaw: angle + (blade - 1) * 1.0 + random() * 0.6, tilt: 0.25, droop: -0.55 });
        }
      }
      if (joint === joints) {
        for (let blade = 0; blade < 4; blade += 1) {
          leafBlade(leaf, { x: point[0], y: point[1], z: point[2] }, { length: 0.5, width: 0.09, yaw: (blade / 4) * Math.PI * 2 + angle, tilt: 0.6, droop: -0.4 });
        }
      }
      previous = point;
    }
  }
  return [culm, node, leaf];
}

/** Cây cau: a slender ringed trunk and a crown of arching feather fronds, a bunch of green nuts below it. */
export function buildArecaPalm() {
  const trunk = part("viet_palm_trunk", 0x9a9278);
  const ring = part("viet_palm_ring", 0x7c745e);
  const frond = part("viet_leaf", C.leaf);
  const nut = part("viet_leaf_deep", C.leafDeep);
  const height = 4.4;
  const lean = 0.2;
  const top = [lean, height, 0];
  beam(trunk, [0, 0, 0], top, 0.15);
  for (let r = 1; r < 10; r += 1) {
    const t = r / 10;
    const at = [lean * t, height * t, 0];
    beam(ring, at, add(at, [0, 0.03, 0]), 0.175, { caps: false });
  }
  // The crownshaft: the smooth green sheath under the fronds.
  taperedCylinder(nut, { x: lean, y: height - 0.05, z: 0 }, { bottomRadius: 0.1, topRadius: 0.08, height: 0.6, segments: 7 });
  for (let index = 0; index < 8; index += 1) {
    const yaw = (index / 8) * Math.PI * 2 + 0.2;
    pinnateFrond(frond, frond, [lean, height + 0.55, 0], { yaw, length: 1.7, rise: index % 2 === 0 ? 0.75 : 0.45, droop: 0.95, pairs: 8, leafletLength: 0.5, leafletWidth: 0.05, thickness: 0.05 });
  }
  pinnateFrond(frond, frond, [lean, height + 0.6, 0], { yaw: 0.9, length: 1.1, rise: 1.35, droop: 0.4, pairs: 6, leafletLength: 0.32, thickness: 0.04 });
  for (let bunch = 0; bunch < 7; bunch += 1) {
    const a = bunch * 0.9;
    icoBlob(nut, { x: lean + 0.16 + Math.cos(a) * 0.08, y: height - 0.3 - (bunch % 3) * 0.08, z: Math.sin(a) * 0.08 }, { radiusX: 0.055, jitter: 0.05, seed: bunch });
  }
  return [trunk, ring, frond, nut];
}

/** Cây chuối: a fleshy stem, broad paddle leaves rising and arching over, a purple bud and a hand of bananas. */
export function buildBananaPlant() {
  const stem = part("viet_banana_stem", 0x9cbc5a);
  const leaf = part("viet_leaf_light", C.leafLight);
  const bud = part("viet_banana_bud", 0x7a2f4a);
  const fruit = part("viet_banana_fruit", 0xb9cf4e);
  taperedCylinder(stem, { y: 0 }, { bottomRadius: 0.17, topRadius: 0.11, height: 1.8, segments: 7 });
  taperedCylinder(stem, { x: 0.42, y: 0, z: 0.25 }, { bottomRadius: 0.11, topRadius: 0.08, height: 0.75, segments: 6 });
  const top = [0, 1.75, 0];
  for (let index = 0; index < 7; index += 1) {
    const yaw = (index / 7) * Math.PI * 2 + 0.3;
    paddleLeaf(leaf, stem, top, { yaw, length: 2.2, width: 0.38, rise: 1.0 - (index % 3) * 0.16, droop: 1.0 - (index % 3) * 0.1, segments: 5 });
  }
  paddleLeaf(leaf, stem, top, { yaw: 2.0, length: 1.4, width: 0.22, rise: 1.4, droop: 0.3, segments: 4 });
  for (let index = 0; index < 3; index += 1) paddleLeaf(leaf, stem, [0.42, 0.72, 0.25], { yaw: index * 2.1, length: 0.7, width: 0.14, rise: 1.0, droop: 0.6, segments: 3 });
  // The flower stalk bending out and down, a hand of green bananas and the purple bud at its end.
  branch(stem, [[0, 1.75, 0], [0.32, 1.65, 0.08], [0.45, 1.35, 0.12]], { from: 0.06, to: 0.045 });
  for (let hand = 0; hand < 8; hand += 1) {
    const a = hand * 0.8;
    beam(fruit, [0.38, 1.6 - (hand % 2) * 0.1, 0.1], [0.38 + Math.cos(a) * 0.15, 1.68 - (hand % 2) * 0.1, 0.1 + Math.sin(a) * 0.15], 0.05);
  }
  icoBlob(bud, { x: 0.47, y: 1.22, z: 0.13 }, { radiusX: 0.08, radiusY: 0.15, radiusZ: 0.08, jitter: 0.04 });
  return [stem, leaf, bud, fruit];
}

/**
 * A flowering tree for Tết: a gnarled trunk, thin branches reaching out and up, and blossom along them
 * in small clouds - an airy crown of flowers, not a ball - with a few new leaves.
 */
function blossomTree(colour, name, seed) {
  const bark = part("viet_bark", 0x5e4634);
  const flowers = part(name, colour);
  const leaf = part("viet_leaf", C.leaf);
  const random = seededRandom(seed);
  branch(bark, [[0, 0, 0], [0.12, 0.45, 0.04], [-0.05, 0.85, 0], [0.05, 1.15, -0.05]], { from: 0.16, to: 0.1 });
  const limbs = [
    [[0.05, 1.15, -0.05], [0.45, 1.45, 0.1], [0.85, 1.6, 0.22], [1.05, 1.85, 0.25]],
    [[0.05, 1.15, -0.05], [-0.4, 1.5, -0.1], [-0.78, 1.7, 0.02], [-0.95, 2.0, 0.08]],
    [[-0.05, 0.85, 0], [-0.38, 1.1, 0.35], [-0.58, 1.35, 0.62]],
    [[0.05, 1.15, -0.05], [0.1, 1.7, -0.4], [0.02, 2.1, -0.58]],
    [[0.12, 0.45, 0.04], [0.45, 0.85, -0.3], [0.7, 1.15, -0.5]],
    [[0.05, 1.15, -0.05], [0.0, 1.75, 0.25], [0.12, 2.15, 0.38]]
  ];
  for (const limb of limbs) {
    branch(bark, limb, { from: 0.07, to: 0.03 });
    // Blossom clouds along the outer half of each branch, biggest at its tip.
    for (let index = 1; index < limb.length; index += 1) {
      const point = limb[index];
      const size = index === limb.length - 1 ? 0.26 : 0.17;
      for (let puff = 0; puff < (index === limb.length - 1 ? 3 : 2); puff += 1) {
        icoBlob(flowers, { x: point[0] + (random() - 0.5) * size * 1.4, y: point[1] + (random() - 0.2) * size, z: point[2] + (random() - 0.5) * size * 1.4 }, { radiusX: size * (0.6 + random() * 0.3), jitter: 0.18, seed: Math.floor(random() * 1000) });
      }
    }
    const mid = limb[1];
    leafBlade(leaf, { x: mid[0], y: mid[1], z: mid[2] }, { length: 0.16, width: 0.06, yaw: random() * 6, tilt: 0.4, droop: 0.3 });
  }
  return [bark, flowers, leaf];
}

/** Cây mai: the southern Tết tree, yellow five-petalled blossom. */
export function buildMaiTree() {
  return blossomTree(C.mai, "viet_mai", 41);
}

/** Cây đào: the northern Tết tree, pink blossom. */
export function buildDaoTree() {
  return blossomTree(C.dao, "viet_dao", 43);
}

/**
 * The pack, in the order the shop shows it. `metres` is the largest side as built, which the client
 * manifest repeats as the size the model is drawn at.
 */
export const VIET_BUILDERS = [
  { id: "viet_house_thatch", build: buildThatchCottage, family: "building" },
  { id: "viet_house_tiled", build: buildTiledHouse, family: "building" },
  { id: "viet_house_stilt", build: buildStiltHouse, family: "building" },
  { id: "viet_village_gate", build: buildVillageGate, family: "building" },
  { id: "viet_shrine", build: buildShrine, family: "building" },
  { id: "viet_well", build: buildVillageWell, family: "piece" },
  { id: "viet_jars", build: buildJars, family: "piece" },
  { id: "viet_straw_stack", build: buildStrawStack, family: "piece" },
  { id: "viet_rice_mortar", build: buildRiceMortar, family: "piece" },
  { id: "viet_bamboo_daybed", build: buildBambooDaybed, family: "piece" },
  { id: "viet_lantern_post", build: buildLanternPost, family: "piece" },
  { id: "viet_lantern_string", build: buildLanternString, family: "piece" },
  { id: "viet_bonsai", build: buildBonsai, family: "piece" },
  { id: "viet_rockery", build: buildRockery, family: "piece" },
  { id: "viet_lotus_pond", build: buildLotusPond, family: "piece" },
  { id: "viet_screen_wall", build: buildScreenWall, family: "piece" },
  { id: "viet_fence_bamboo", build: buildBambooFence, family: "piece" },
  { id: "viet_fence_breeze", build: buildBreezeBlockFence, family: "piece" },
  // The village banyan is a landmark, budgeted like a house.
  { id: "viet_tree_banyan", build: buildBanyan, family: "building" },
  { id: "viet_bamboo_clump", build: buildBambooClump, family: "tree" },
  { id: "viet_tree_areca", build: buildArecaPalm, family: "tree" },
  { id: "viet_tree_banana", build: buildBananaPlant, family: "tree" },
  { id: "viet_tree_mai", build: buildMaiTree, family: "tree" },
  { id: "viet_tree_dao", build: buildDaoTree, family: "tree" }
];
