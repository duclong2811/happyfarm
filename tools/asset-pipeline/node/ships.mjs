/**
 * Ships, in the look of old Vietnamese boats and war junks.
 *
 * The references are the boats of the Vietnamese coast and the warships of the old courts, studied
 * for their shapes, not copied from any drawing:
 *
 * - a long hull whose sheer sweeps up at both ends, with a broad, high stern and a narrow bow;
 * - **mắt thuyền**, the eyes painted on either side of the bow, so the boat sees its way;
 * - **buồm cánh dơi**, the battened "bat-wing" lug sail, dyed brown, its panels bulging between
 *   bamboo battens and its yard rising aft;
 * - the **mui**, an arched roof of woven bamboo over the deck;
 * - **cờ đuôi nheo**, swallow-tailed pennants at the mastheads;
 * - on the warships, a black lacquered hull with a vermilion band, rows of oars, bronze guns, and on
 *   the greatest one a castle at the stern and a dragon at the prow (**lâu thuyền**, **thuyền rồng**).
 *
 * Pirates are the **tàu Ô** of the old chronicles, the "black ships": near-black hulls, dark tattered
 * sails, black pennants and eyes ringed in red.
 *
 * Every ship faces +z (bow) and is built in metres, keel at y = 0 amidships. The waterline is about
 * 0.04 x the hull's length above the keel; the renderer sinks a ship by that much.
 */

import { beam, facingQuad, facingTriangle, lowPolyBlob, part, sheetQuad, sheetTriangle, taperedBox, taperedCylinder } from "./glb.mjs";

/** Colours, sRGB. They follow the art bible's warm palette, darkened where lacquer would be. */
const SHIP_PALETTE = {
  lacquer: 0x2c2522,
  hullWood: 0x4a3426,
  rowboatWood: 0x7a5232,
  deckWood: 0x9a6a3c,
  vermilion: 0xa83a2a,
  gold: 0xd9a441,
  sail: 0xb5653a,
  bamboo: 0xcfae72,
  eyeWhite: 0xf3ead8,
  ink: 0x231c18,
  pirateHull: 0x1f1b1a,
  pirateBand: 0x7a2a22,
  pirateDeck: 0x4f3a2a,
  pirateSail: 0x3a3431,
  pirateIron: 0x6a6460,
  pirateBone: 0xd8cdb4
};

/** The waterline above the keel, as a share of hull length. The renderer uses the same number. */
export const SHIP_DRAFT_SHARE = 0.04;

// --- curves -------------------------------------------------------------------------------------

/** A smooth curve through `[t, value]` keys (cubic Hermite with central-difference slopes). */
function spline(keys) {
  const slopes = keys.map((_, index) => {
    const before = keys[Math.max(0, index - 1)];
    const after = keys[Math.min(keys.length - 1, index + 1)];
    return (after[1] - before[1]) / (after[0] - before[0]);
  });
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let index = 1; index < keys.length; index += 1) {
      const [t1, v1] = keys[index];
      if (t > t1 && index < keys.length - 1) continue;
      const [t0, v0] = keys[index - 1];
      const h = t1 - t0;
      const s = Math.min(1, Math.max(0, (t - t0) / h));
      const s2 = s * s;
      const s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * slopes[index - 1] + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * slopes[index];
    }
    return keys[keys.length - 1][1];
  };
}

function smoothstep(edge, value) {
  const s = Math.min(1, Math.max(0, value / edge));
  return s * s * (3 - 2 * s);
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

// --- the hull -----------------------------------------------------------------------------------

/**
 * A hull's lines: half-beam, sheer (gunwale height), keel and deck height along `t`, which runs from
 * 0 at the stern to 1 at the bow.
 */
function hullLines({ length, halfBeam, sheer, keel, deck, wall, band, stations, endFade = 0.07 }) {
  return { length, halfBeam: spline(halfBeam), sheer: spline(sheer), keel: spline(keel), deck: spline(deck), wall, band, stations, endFade };
}

/** One cross-section: the starboard outline from the gunwale down to the keel, and the deck inside. */
function section(lines, t) {
  const z = (t - 0.5) * lines.length;
  const b = Math.max(lines.halfBeam(t), 0.02);
  const s = lines.sheer(t);
  const k = lines.keel(t);
  const depth = s - k;
  // At the very ends the bulwark closes: the deck meets the gunwale, so the hull can be capped.
  const open = smoothstep(lines.endFade, t) * smoothstep(lines.endFade, 1 - t);
  const wall = Math.min(lines.wall, b * 0.45) * open;
  const deckY = s - (s - Math.min(lines.deck(t), s - 0.02)) * open;
  const bandDepth = Math.min(lines.band, depth * 0.3);
  const outer = [
    [b, s],
    [bandDepth > 0 ? b * 0.99 : b, s - bandDepth],
    [b * 0.95, s - depth * 0.55],
    [b * 0.68, s - depth * 0.88],
    [0, k]
  ];
  return { z, b, s, k, depth, wall, deckY, outer };
}

/** The hull: lacquered sides, a coloured band and cap rail, bulwarks and a deck, capped at both ends. */
function hull(parts, lines) {
  const { stations } = lines;
  for (let index = 0; index < stations.length - 1; index += 1) {
    const a = section(lines, stations[index]);
    const b = section(lines, stations[index + 1]);
    for (const side of [1, -1]) {
      const at = (sec, [x, y]) => [x * side, y, sec.z];
      for (let row = 0; row < 4; row += 1) {
        const corners = [at(a, a.outer[row]), at(a, a.outer[row + 1]), at(b, b.outer[row + 1]), at(b, b.outer[row])];
        const centre = scale(corners.reduce(add), 0.25);
        const middle = (a.s + a.k) / 2;
        facingQuad(row === 0 ? parts.band : parts.hull, ...corners, [centre[0], centre[1] - middle, 0]);
      }
      // Cap rail across the top of the bulwark, then the bulwark's inner face down to the deck.
      const outerA = [a.b * side, a.s, a.z];
      const outerB = [b.b * side, b.s, b.z];
      const innerA = [(a.b - a.wall) * side, a.s, a.z];
      const innerB = [(b.b - b.wall) * side, b.s, b.z];
      facingQuad(parts.band, outerA, outerB, innerB, innerA, [0, 1, 0]);
      facingQuad(parts.deck, innerA, innerB, [(b.b - b.wall) * side, b.deckY, b.z], [(a.b - a.wall) * side, a.deckY, a.z], [-side, 0, 0]);
    }
    facingQuad(
      parts.deck,
      [a.b - a.wall, a.deckY, a.z],
      [b.b - b.wall, b.deckY, b.z],
      [-(b.b - b.wall), b.deckY, b.z],
      [-(a.b - a.wall), a.deckY, a.z],
      [0, 1, 0]
    );
  }
  // The transom and the stem: each end's outline, fanned from its middle.
  for (const [t, facing] of [[stations[0], -1], [stations[stations.length - 1], 1]]) {
    const end = section(lines, t);
    const ring = [...end.outer.map(([x, y]) => [x, y, end.z]), ...end.outer.slice(0, -1).reverse().map(([x, y]) => [-x, y, end.z])];
    const centre = [0, (end.s + end.k) / 2, end.z];
    for (let index = 0; index < ring.length - 1; index += 1) facingTriangle(parts.hull, centre, ring[index], ring[index + 1], [0, 0, facing]);
    facingTriangle(parts.hull, centre, ring[ring.length - 1], ring[0], [0, 0, facing]);
  }
}

/** A point on the hull's outside: `share` 0 at the gunwale to 1 at the keel, on `side` (+1 starboard). */
function hullPoint(lines, t, share, side) {
  const sec = section(lines, Math.min(1, Math.max(0, t)));
  const y = sec.s - share * sec.depth;
  for (let index = 0; index < sec.outer.length - 1; index += 1) {
    const [x0, y0] = sec.outer[index];
    const [x1, y1] = sec.outer[index + 1];
    if (y <= y0 + 1e-9 && y >= y1 - 1e-9) {
      const along = y0 === y1 ? 0 : (y0 - y) / (y0 - y1);
      return [(x0 + (x1 - x0) * along) * side, y, sec.z];
    }
  }
  return [sec.outer[0][0] * side, sec.s, sec.z];
}

/** The hull's local frame at a point: forward along the planks, up the side, and out. */
function hullFrame(lines, t, share, side) {
  const point = hullPoint(lines, t, share, side);
  const forward = unit(subtract(hullPoint(lines, t + 0.01, share, side), hullPoint(lines, t - 0.01, share, side)));
  const upward = unit(subtract(hullPoint(lines, t, share - 0.05, side), hullPoint(lines, t, share + 0.05, side)));
  let normal = unit(cross(upward, forward));
  if (normal[0] * side < 0) normal = scale(normal, -1);
  return { point, forward, upward, normal };
}

/**
 * Mắt thuyền: an almond eye on each side of the bow, laid onto the hull's curve, its pupil looking
 * ahead. `size` is the eye's half-length in metres.
 */
function bowEyes(white, pupil, lines, { t, share, size }) {
  for (const side of [1, -1]) {
    const sec = section(lines, t);
    const onHull = (along, up, lift) => {
      const frame = hullFrame(lines, t + along / lines.length, share - up / sec.depth, side);
      return add(frame.point, scale(frame.normal, lift));
    };
    const lift = size * 0.05;
    const ring = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const sin = Math.sin(angle);
      ring.push(onHull(Math.cos(angle) * size, sin * size * 0.42 * (0.55 + 0.45 * Math.abs(sin)), lift));
    }
    const outward = hullFrame(lines, t, share, side).normal;
    const centre = onHull(0, 0, lift);
    for (let index = 0; index < 10; index += 1) facingTriangle(white, centre, ring[index], ring[(index + 1) % 10], outward);
    const iris = [];
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      iris.push(onHull(size * 0.22 + Math.cos(angle) * size * 0.3, -size * 0.02 + Math.sin(angle) * size * 0.3, lift * 2));
    }
    const irisCentre = onHull(size * 0.22, -size * 0.02, lift * 2);
    for (let index = 0; index < 6; index += 1) facingTriangle(pupil, irisCentre, iris[index], iris[(index + 1) % 6], outward);
  }
}

/** Guns run out through the band: a short barrel on each side at each `t`. */
function guns(target, lines, positions, { share = 0.14, length = 0.7, bore = 0.2 }) {
  for (const t of positions) {
    for (const side of [1, -1]) {
      const frame = hullFrame(lines, t, share, side);
      const out = unit([frame.normal[0], 0, frame.normal[2]]);
      beam(target, add(frame.point, scale(out, -0.15)), add(frame.point, scale(out, length)), bore);
    }
  }
}

/** Oars: from inside the bulwark, out and down to the water, swept a little aft. */
function oars(target, lines, positions, { reach, thickness, sweep = 0.5 }) {
  const water = lines.length * SHIP_DRAFT_SHARE * 0.9;
  for (const t of positions) {
    const sec = section(lines, t);
    for (const side of [1, -1]) {
      const from = [(sec.b - sec.wall * 2) * side, sec.s + 0.06, sec.z];
      const to = [(sec.b + reach) * side, water, sec.z - sweep];
      beam(target, from, to, thickness, { caps: false });
      // The blade: a flat paddle at the wet end.
      const blade = unit(subtract(to, from));
      const back = subtract(to, scale(blade, reach * 0.35));
      const wide = [0, 0, thickness * 2.2];
      sheetQuad(target, add(back, wide), add(to, wide), subtract(to, wide), subtract(back, wide));
    }
  }
}

// --- rigging ------------------------------------------------------------------------------------

/**
 * Buồm cánh dơi: a battened lug sail. The panels bulge between straight battens, the leech scallops
 * out between batten ends like a bat's wing, and the battens fan so the yard rises aft.
 *
 * `at` is where the boom meets the mast. The sail is turned `yaw` radians off the centreline (as if
 * sheeted for a reach) and leans with its mast by `lean` metres per metre of height.
 */
function battenedSail(cloth, battens, at, { height, foot, head, luff = 0.28, panels = 5, yaw = 0.35, rise = 1.2, camber = 0.3, scallop = 0.3, lean = 0, tattered = false, batten = 0.09 }) {
  const aft = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const across = [Math.cos(yaw), 0, Math.sin(yaw)];
  const world = (u, v, bulge = 0) => add(add(add(at, scale(aft, u)), [0, v, lean * v]), scale(across, bulge));
  const lines = [];
  for (let index = 0; index <= panels; index += 1) {
    const share = index / panels;
    const width = foot + (head - foot) * share ** 0.8;
    const v = height * share;
    lines.push({
      luff: [-width * luff, v],
      leech: [width * (1 - luff), v + rise * share ** 1.4],
      width
    });
  }
  for (let index = 0; index < panels; index += 1) {
    const below = lines[index];
    const above = lines[index + 1];
    const width = (below.width + above.width) / 2;
    const notch = tattered && index % 2 === 1 ? -0.45 : 1;
    const tip = [(below.leech[0] + above.leech[0]) / 2 + width * scallop * 0.35 * notch, (below.leech[1] + above.leech[1]) / 2];
    const centre = [
      (below.luff[0] + below.leech[0] + above.luff[0] + above.leech[0]) / 4,
      (below.luff[1] + below.leech[1] + above.luff[1] + above.leech[1]) / 4
    ];
    const ring = [below.luff, below.leech, tip, above.leech, above.luff].map(([u, v]) => world(u, v));
    const middle = world(centre[0], centre[1], width * camber * 0.25);
    for (let corner = 0; corner < ring.length; corner += 1) sheetTriangle(cloth, middle, ring[corner], ring[(corner + 1) % ring.length]);
  }
  lines.forEach((line, index) => {
    const thick = index === 0 || index === panels ? batten * 1.6 : batten;
    beam(battens, world(line.luff[0] - 0.08, line.luff[1]), world(line.leech[0] + 0.08, line.leech[1]), thick, { caps: false });
  });
  return world(lines[panels].luff[0], lines[panels].luff[1]);
}

/** A mast standing on the deck at `z`, leaning `lean` metres forward per metre of height. */
function mast(target, { y, z, height, radius, lean = 0 }) {
  taperedCylinder(target, { x: 0, y, z }, { bottomRadius: radius, topRadius: radius * 0.55, height, segments: 6, leanZ: lean * height });
  return [0, y + height, z + lean * height];
}

/** Cờ đuôi nheo: a swallow-tailed pennant streaming aft from `top`. */
function pennant(target, top, { length, height, wave = 0.12 }) {
  const point = (u, v) => [Math.sin(u * Math.PI * 1.5) * wave * length * u, top[1] - v * height, top[2] - u * length];
  const hoistTop = [top[0], top[1], top[2]];
  const hoistBottom = [top[0], top[1] - height, top[2]];
  const upperTip = point(1, 0.05);
  const notch = point(0.7, 0.5);
  const lowerTip = point(1, 0.95);
  sheetTriangle(target, hoistTop, hoistBottom, notch);
  sheetTriangle(target, hoistTop, notch, upperTip);
  sheetTriangle(target, hoistBottom, lowerTip, notch);
}

/** A mui: an arched roof of woven bamboo over the deck, open at both ends, with darker ribs. */
function mui(roof, ribs, { y, z0, z1, halfWidth, height, segments = 6, ribCount = 3 }) {
  const arc = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI;
    arc.push([Math.cos(angle) * halfWidth, y + Math.sin(angle) * height]);
  }
  for (let index = 0; index < segments; index += 1) {
    const [xa, ya] = arc[index];
    const [xb, yb] = arc[index + 1];
    sheetQuad(roof, [xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]);
  }
  for (let rib = 0; rib < ribCount; rib += 1) {
    const z = z0 + ((rib + 0.5) / ribCount) * (z1 - z0);
    for (let index = 0; index < segments; index += 1) {
      const [xa, ya] = arc[index];
      const [xb, yb] = arc[index + 1];
      const lift = (x, yy) => [x * 1.04, y + (yy - y) * 1.04];
      const [pa, qa] = lift(xa, ya);
      const [pb, qb] = lift(xb, yb);
      facingQuad(ribs, [pa, qa, z - 0.05], [pb, qb, z - 0.05], [pb, qb, z + 0.05], [pa, qa, z + 0.05], [(pa + pb) / 2, (qa + qb) / 2 - y, 0]);
    }
  }
}

/**
 * A roof with up-swept eaves and ridge, the curve of temple and palace roofs: two concave slopes
 * along z, the corners lifted by `sweep`. Seen from below as well, so both faces are kept.
 */
function sweptRoof(roof, ridgeTrim, { y, z, width, depth, height, sweep, segments = 4 }) {
  const halfDepth = depth / 2;
  const lift = (along) => sweep * (Math.abs(along) / halfDepth) ** 2;
  const slopePoint = (side, across, along) => {
    // across: 0 at the eave, 1 at the ridge, sagging in between.
    const eaveY = y + lift(along);
    const ridgeY = y + height + lift(along) * 0.7;
    const sag = Math.sin(across * Math.PI) * height * 0.12;
    return [side * (width / 2) * (1 - across), eaveY + (ridgeY - eaveY) * across - sag, z + along];
  };
  for (const side of [1, -1]) {
    for (let index = 0; index < segments; index += 1) {
      const a = -halfDepth + (index / segments) * depth;
      const b = -halfDepth + ((index + 1) / segments) * depth;
      for (const [c0, c1] of [[0, 0.5], [0.5, 1]]) {
        sheetQuad(roof, slopePoint(side, c0, a), slopePoint(side, c0, b), slopePoint(side, c1, b), slopePoint(side, c1, a));
      }
    }
  }
  for (const along of [-halfDepth, halfDepth]) {
    const left = [slopePoint(-1, 0, along), slopePoint(-1, 0.5, along)];
    const right = [slopePoint(1, 0, along), slopePoint(1, 0.5, along)];
    const ridge = slopePoint(1, 1, along);
    sheetTriangle(roof, left[0], right[0], ridge);
    sheetTriangle(roof, left[0], ridge, left[1]);
    sheetTriangle(roof, right[0], right[1], ridge);
  }
  // A gilded ridge beam whose ends curl up like a dragon's tail.
  const front = slopePoint(1, 1, halfDepth);
  const back = slopePoint(1, 1, -halfDepth);
  beam(ridgeTrim, back, front, 0.16);
  beam(ridgeTrim, front, add(front, [0, sweep * 0.9, 0.35]), 0.14);
  beam(ridgeTrim, back, add(back, [0, sweep * 0.9, -0.35]), 0.14);
  for (const side of [1, -1]) {
    for (const along of [-halfDepth, halfDepth]) {
      const corner = slopePoint(side, 0, along);
      beam(ridgeTrim, corner, add(corner, [side * 0.12, sweep * 0.55, Math.sign(along) * 0.25]), 0.1);
    }
  }
}

/** A gilded dragon head and neck rising from the stem: the prow of a thuyền rồng. */
function dragonHead(gold, eye, { y, z }) {
  taperedCylinder(gold, { x: 0, y: y - 0.3, z: z - 0.4 }, { bottomRadius: 0.32, topRadius: 0.24, height: 1.5, segments: 6, leanZ: 0.75 });
  lowPolyBlob(gold, { x: 0, y: y + 0.85, z: z + 0.45 }, { radiusX: 0.38, radiusY: 0.3, radiusZ: 0.5, segments: 6, rings: 3 });
  taperedBox(gold, { x: 0, y: y + 1.05, z: z + 1.05 }, { width: 0.42, depth: 0.7, height: 0.3, topScale: 0.7 });
  taperedBox(gold, { x: 0, y: y + 0.82, z: z + 0.95 }, { width: 0.32, depth: 0.6, height: 0.14, topScale: 0.8 });
  for (const side of [1, -1]) {
    beam(gold, [side * 0.16, y + 1.35, z + 0.4], [side * 0.34, y + 2.0, z - 0.35], 0.09);
    beam(gold, [side * 0.18, y + 1.0, z + 1.35], [side * 0.55, y + 0.75, z + 1.7], 0.05);
    sheetTriangle(gold, [0, y + 1.25, z + 0.2], [side * 0.05, y + 1.75, z - 0.25], [0, y + 1.1, z - 0.5]);
    eyeDot(eye, [side * 0.33, y + 1.18, z + 0.7], side);
  }
}

/** A small round eye on a carved head, facing out to `side`. */
function eyeDot(target, at, side) {
  const ring = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    ring.push([at[0], at[1] + Math.sin(angle) * 0.09, at[2] + Math.cos(angle) * 0.09]);
  }
  for (let index = 0; index < 5; index += 1) facingTriangle(target, at, ring[index], ring[(index + 1) % 5], [side, 0, 0]);
}

/** A tail of gilded scrolls curling up from the stern post. */
function sternCurl(gold, { y, z }) {
  const points = [
    [0, y - 0.2, z + 0.2],
    [0, y + 0.6, z - 0.25],
    [0, y + 1.3, z - 0.2],
    [0, y + 1.65, z + 0.25],
    [0, y + 1.45, z + 0.6]
  ];
  for (let index = 0; index < points.length - 1; index += 1) beam(gold, points[index], points[index + 1], 0.22 - index * 0.03);
}

/** A stern rudder: a post and a broad blade hung behind the transom. */
function rudder(target, lines, { width, drop }) {
  const stern = section(lines, 0);
  const top = [0, stern.s - 0.1, stern.z - 0.15];
  const bottom = [0, stern.k - drop, stern.z - 0.25];
  beam(target, top, [0, stern.s + 0.6, stern.z - 0.05], 0.14);
  const blade = [bottom, add(bottom, [0, 0, -width]), [0, stern.k + (stern.s - stern.k) * 0.45, stern.z - 0.15 - width * 0.8], [0, stern.k + (stern.s - stern.k) * 0.5, stern.z - 0.15]];
  sheetQuad(target, ...blade);
}

/** Positions spread evenly from `from` to `to`, `count` of them. */
function spread(from, to, count) {
  if (count === 1) return [(from + to) / 2];
  return Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));
}

// --- the ships ----------------------------------------------------------------------------------

/** Ghe: a small rowing boat with a bamboo mui, a sculling oar at the stern, and bow eyes. */
export function buildShipRowboat() {
  const parts = {
    hull: part("hull", SHIP_PALETTE.rowboatWood),
    band: part("rail", SHIP_PALETTE.vermilion),
    deck: part("deck", SHIP_PALETTE.deckWood),
    roof: part("mui", SHIP_PALETTE.bamboo),
    white: part("eye", SHIP_PALETTE.eyeWhite),
    ink: part("ink", SHIP_PALETTE.ink)
  };
  const lines = hullLines({
    length: 4.6,
    halfBeam: [[0, 0.42], [0.12, 0.62], [0.45, 0.8], [0.75, 0.68], [0.93, 0.32], [1, 0.1]],
    sheer: [[0, 1.05], [0.15, 0.74], [0.45, 0.6], [0.8, 0.72], [0.95, 1.08], [1, 1.28]],
    keel: [[0, 0.32], [0.15, 0.06], [0.4, 0], [0.75, 0.03], [0.92, 0.3], [1, 0.62]],
    deck: [[0, 0.62], [0.5, 0.4], [1, 0.6]],
    wall: 0.05,
    band: 0,
    stations: [0, 0.04, 0.1, 0.2, 0.32, 0.45, 0.58, 0.7, 0.8, 0.88, 0.95, 1],
    endFade: 0.09
  });
  hull(parts, lines);
  mui(parts.roof, parts.ink, { y: 0.55, z0: -1.0, z1: 0.45, halfWidth: 0.72, height: 0.62 });
  bowEyes(parts.white, parts.ink, lines, { t: 0.87, share: 0.32, size: 0.17 });
  // The sculling oar over the stern, and a pair of rowing oars amidships.
  beam(parts.deck, [0.15, 1.25, -1.7], [0.3, 0.16, -2.6], 0.07);
  oars(parts.deck, lines, [0.66], { reach: 0.7, thickness: 0.06, sweep: 0.35 });
  return Object.values(parts);
}

/** The parts every bigger ship shares, in its own colours. */
function shipParts(colours) {
  return {
    hull: part("hull", colours.hull),
    band: part("band", colours.band),
    deck: part("deck", colours.deck),
    sail: part("sail", colours.sail),
    metal: part("metal", colours.metal),
    white: part("eye", colours.white)
  };
}

const NAVY = { hull: SHIP_PALETTE.lacquer, band: SHIP_PALETTE.vermilion, deck: SHIP_PALETTE.deckWood, sail: SHIP_PALETTE.sail, metal: SHIP_PALETTE.bamboo, white: SHIP_PALETTE.eyeWhite };
const PIRATES = { hull: SHIP_PALETTE.pirateHull, band: SHIP_PALETTE.pirateBand, deck: SHIP_PALETTE.pirateDeck, sail: SHIP_PALETTE.pirateSail, metal: SHIP_PALETTE.pirateIron, white: SHIP_PALETTE.pirateBone };

/**
 * A junk: hull, eyes, masts with battened sails and pennants, and whatever the class adds. Each
 * `rig` entry is one mast: `t` along the hull, the sail's size, and the mast's forward lean.
 */
function junk(parts, lines, { rig, eye, pirate = false, pennantPart, pupilPart }) {
  hull(parts, lines);
  bowEyes(parts.white, pupilPart, lines, eye);
  for (const entry of rig) {
    const sec = section(lines, entry.t);
    const top = mast(parts.deck, { y: sec.deckY - 0.05, z: sec.z, height: entry.mast, radius: entry.radius ?? 0.14, lean: entry.lean ?? 0 });
    const boomY = sec.s + (entry.boom ?? 0.5);
    battenedSail(parts.sail, parts.deck, [0, boomY, sec.z + (entry.lean ?? 0) * (boomY - sec.deckY)], {
      height: entry.height,
      foot: entry.foot,
      head: entry.head,
      panels: entry.panels ?? 5,
      rise: entry.rise ?? entry.height * 0.22,
      lean: entry.lean ?? 0,
      tattered: pirate,
      yaw: entry.yaw ?? (pirate ? 0.62 : 0.55)
    });
    pennant(pennantPart, top, { length: entry.mast * 0.2, height: entry.mast * 0.055 });
  }
}

/** Ghe bầu: a round-bellied coaster with one great bat-wing sail, a small mui aft and two guns. */
export function buildShipSloop() {
  const parts = shipParts({ ...NAVY, hull: SHIP_PALETTE.hullWood });
  const lines = hullLines({
    length: 10,
    halfBeam: [[0, 0.95], [0.1, 1.35], [0.4, 1.75], [0.7, 1.55], [0.9, 0.8], [1, 0.2]],
    sheer: [[0, 2.1], [0.12, 1.65], [0.45, 1.4], [0.8, 1.6], [0.95, 2.0], [1, 2.3]],
    keel: [[0, 0.75], [0.12, 0.15], [0.35, 0], [0.75, 0.05], [0.92, 0.55], [1, 1.25]],
    deck: [[0, 1.65], [0.5, 1.05], [1, 1.6]],
    wall: 0.1,
    band: 0.3,
    stations: [0, 0.03, 0.08, 0.16, 0.26, 0.37, 0.48, 0.59, 0.7, 0.8, 0.88, 0.94, 0.98, 1]
  });
  junk(parts, lines, {
    rig: [{ t: 0.6, mast: 8.2, height: 5.6, foot: 3.8, head: 5.2, radius: 0.16 }],
    eye: { t: 0.885, share: 0.36, size: 0.38 },
    pennantPart: parts.band,
    pupilPart: parts.hull
  });
  mui(parts.metal, parts.deck, { y: 1.35, z0: -3.5, z1: -1.9, halfWidth: 1.2, height: 0.95, ribCount: 2 });
  guns(parts.metal, lines, [0.42], { length: 0.55, bore: 0.18 });
  rudder(parts.deck, lines, { width: 0.7, drop: 0.2 });
  return Object.values(parts);
}

/** Thuyền chiến: a black war junk with a vermilion band, two sails, a mui aft, oars and six guns. */
export function buildShipBrig() {
  const parts = shipParts(NAVY);
  const lines = hullLines({
    length: 13,
    halfBeam: [[0, 1.25], [0.1, 1.6], [0.4, 1.95], [0.72, 1.8], [0.9, 0.95], [1, 0.22]],
    sheer: [[0, 2.9], [0.1, 2.2], [0.45, 1.8], [0.8, 2.05], [0.95, 2.6], [1, 3.0]],
    keel: [[0, 0.95], [0.12, 0.2], [0.35, 0], [0.75, 0.05], [0.92, 0.7], [1, 1.55]],
    deck: [[0, 2.25], [0.5, 1.35], [1, 2.05]],
    wall: 0.12,
    band: 0.38,
    stations: [0, 0.03, 0.08, 0.16, 0.26, 0.37, 0.48, 0.59, 0.7, 0.8, 0.88, 0.94, 0.98, 1]
  });
  junk(parts, lines, {
    rig: [
      { t: 0.53, mast: 10, height: 6.6, foot: 4.2, head: 5.8, radius: 0.18 },
      { t: 0.82, mast: 7.2, height: 4.6, foot: 2.8, head: 3.9, lean: 0.08 }
    ],
    eye: { t: 0.89, share: 0.36, size: 0.46 },
    pennantPart: parts.band,
    pupilPart: parts.hull
  });
  mui(parts.metal, parts.deck, { y: 1.75, z0: -5.3, z1: -2.6, halfWidth: 1.45, height: 1.25 });
  oars(parts.deck, lines, spread(0.36, 0.66, 5), { reach: 1.7, thickness: 0.09 });
  guns(parts.metal, lines, [0.24, 0.3, 0.75], { length: 0.65, bore: 0.2 });
  rudder(parts.deck, lines, { width: 0.9, drop: 0.3 });
  return Object.values(parts);
}

/** Lâu thuyền rồng: the flagship, with a stern castle, a dragon prow, three sails, oars and bronze guns. */
export function buildShipFrigate() {
  const parts = shipParts({ ...NAVY, metal: SHIP_PALETTE.gold });
  const lines = hullLines({
    length: 16,
    halfBeam: [[0, 1.6], [0.1, 2.0], [0.4, 2.4], [0.72, 2.2], [0.9, 1.2], [1, 0.26]],
    sheer: [[0, 3.5], [0.1, 2.8], [0.45, 2.25], [0.8, 2.5], [0.95, 3.0], [1, 3.3]],
    keel: [[0, 1.2], [0.12, 0.25], [0.35, 0], [0.75, 0.06], [0.92, 0.85], [1, 1.85]],
    deck: [[0, 2.85], [0.5, 1.7], [1, 2.45]],
    wall: 0.14,
    band: 0.45,
    stations: [0, 0.03, 0.08, 0.15, 0.23, 0.32, 0.42, 0.52, 0.62, 0.72, 0.8, 0.87, 0.93, 0.97, 1]
  });
  junk(parts, lines, {
    rig: [
      { t: 0.34, mast: 8.6, height: 5.0, foot: 3.0, head: 4.2 },
      { t: 0.55, mast: 12, height: 7.6, foot: 4.8, head: 6.6, radius: 0.22 },
      { t: 0.8, mast: 8.4, height: 5.2, foot: 3.2, head: 4.4, lean: 0.1 }
    ],
    eye: { t: 0.87, share: 0.38, size: 0.68 },
    pennantPart: parts.band,
    pupilPart: parts.hull
  });
  // The castle: vermilion walls on dark posts, under a swept roof of royal yellow tiles with a vermilion
  // ridge. Its floor sits below the lowest deck it spans, so it never floats over the slope.
  const castleBase = Math.min(section(lines, 0.08).deckY, section(lines, 0.26).deckY) - 0.2;
  const castleTop = section(lines, 0.15).deckY + 1.8;
  taperedBox(parts.band, { x: 0, y: castleBase, z: -5.6 }, { width: 3.0, depth: 3.4, height: castleTop - castleBase, topScale: 0.95 });
  for (const x of [-1.52, 1.52]) {
    for (const z of [-7.32, -3.88]) beam(parts.hull, [x, castleBase, z], [x * 0.96, castleTop + 0.05, z + (z < -5.6 ? 0.08 : -0.08)], 0.2);
  }
  sweptRoof(parts.metal, parts.band, { y: castleTop, z: -5.6, width: 4.0, depth: 4.4, height: 1.45, sweep: 0.8 });
  const bow = section(lines, 1);
  dragonHead(parts.metal, parts.white, { y: bow.s, z: bow.z });
  sternCurl(parts.metal, { y: section(lines, 0).s, z: section(lines, 0).z });
  oars(parts.deck, lines, spread(0.38, 0.7, 6), { reach: 2.0, thickness: 0.1 });
  guns(parts.metal, lines, [0.22, 0.28, 0.76], { length: 0.75, bore: 0.24 });
  rudder(parts.deck, lines, { width: 1.1, drop: 0.35 });
  return Object.values(parts);
}

/** Tàu Ô (small): a lean black cutter with one ragged sail and a gun a side. */
export function buildPirateCutter() {
  const parts = shipParts(PIRATES);
  const lines = hullLines({
    length: 9,
    halfBeam: [[0, 0.8], [0.1, 1.1], [0.4, 1.4], [0.72, 1.25], [0.9, 0.66], [1, 0.16]],
    sheer: [[0, 1.95], [0.12, 1.5], [0.45, 1.25], [0.8, 1.45], [0.95, 1.85], [1, 2.2]],
    keel: [[0, 0.7], [0.12, 0.12], [0.35, 0], [0.75, 0.04], [0.92, 0.5], [1, 1.15]],
    deck: [[0, 1.5], [0.5, 0.92], [1, 1.45]],
    wall: 0.1,
    band: 0.26,
    stations: [0, 0.03, 0.08, 0.16, 0.26, 0.37, 0.48, 0.59, 0.7, 0.8, 0.88, 0.94, 0.98, 1]
  });
  junk(parts, lines, {
    rig: [{ t: 0.58, mast: 7.4, height: 5.0, foot: 3.2, head: 4.4, radius: 0.15 }],
    eye: { t: 0.88, share: 0.34, size: 0.36 },
    pirate: true,
    pennantPart: parts.hull,
    pupilPart: parts.band
  });
  guns(parts.metal, lines, [0.4], { length: 0.55, bore: 0.18 });
  rudder(parts.deck, lines, { width: 0.6, drop: 0.2 });
  return Object.values(parts);
}

/** Tàu Ô (raider): two ragged sails, oars and three guns a side. */
export function buildPirateRaider() {
  const parts = shipParts(PIRATES);
  const lines = hullLines({
    length: 12,
    halfBeam: [[0, 1.1], [0.1, 1.45], [0.4, 1.8], [0.72, 1.65], [0.9, 0.86], [1, 0.2]],
    sheer: [[0, 2.6], [0.1, 2.0], [0.45, 1.65], [0.8, 1.9], [0.95, 2.4], [1, 2.8]],
    keel: [[0, 0.9], [0.12, 0.18], [0.35, 0], [0.75, 0.05], [0.92, 0.65], [1, 1.45]],
    deck: [[0, 2.05], [0.5, 1.22], [1, 1.9]],
    wall: 0.12,
    band: 0.34,
    stations: [0, 0.03, 0.08, 0.16, 0.26, 0.37, 0.48, 0.59, 0.7, 0.8, 0.88, 0.94, 0.98, 1]
  });
  junk(parts, lines, {
    rig: [
      { t: 0.5, mast: 9.2, height: 6.0, foot: 3.8, head: 5.2, radius: 0.17 },
      { t: 0.8, mast: 6.6, height: 4.2, foot: 2.6, head: 3.6, lean: 0.08 }
    ],
    eye: { t: 0.885, share: 0.35, size: 0.44 },
    pirate: true,
    pennantPart: parts.hull,
    pupilPart: parts.band
  });
  oars(parts.deck, lines, spread(0.34, 0.64, 4), { reach: 1.6, thickness: 0.09 });
  guns(parts.metal, lines, [0.22, 0.28, 0.74], { length: 0.6, bore: 0.2 });
  rudder(parts.deck, lines, { width: 0.85, drop: 0.3 });
  return Object.values(parts);
}

/** Tàu Ô (corsair): the pirate flagship, with a dark deckhouse aft, three ragged sails and many guns. */
export function buildPirateCorsair() {
  const parts = shipParts(PIRATES);
  const lines = hullLines({
    length: 15,
    halfBeam: [[0, 1.5], [0.1, 1.9], [0.4, 2.25], [0.72, 2.05], [0.9, 1.1], [1, 0.24]],
    sheer: [[0, 3.3], [0.1, 2.6], [0.45, 2.1], [0.8, 2.35], [0.95, 2.85], [1, 3.2]],
    keel: [[0, 1.1], [0.12, 0.22], [0.35, 0], [0.75, 0.06], [0.92, 0.8], [1, 1.75]],
    deck: [[0, 2.7], [0.5, 1.58], [1, 2.3]],
    wall: 0.13,
    band: 0.42,
    stations: [0, 0.03, 0.08, 0.15, 0.23, 0.32, 0.42, 0.52, 0.62, 0.72, 0.8, 0.87, 0.93, 0.97, 1]
  });
  junk(parts, lines, {
    rig: [
      { t: 0.34, mast: 8.2, height: 4.8, foot: 2.9, head: 4.0 },
      { t: 0.55, mast: 11.2, height: 7.0, foot: 4.5, head: 6.2, radius: 0.2 },
      { t: 0.8, mast: 7.8, height: 4.8, foot: 3.0, head: 4.1, lean: 0.1 }
    ],
    eye: { t: 0.875, share: 0.37, size: 0.52 },
    pirate: true,
    pennantPart: parts.hull,
    pupilPart: parts.band
  });
  const house = section(lines, 0.15);
  taperedBox(parts.deck, { x: 0, y: house.deckY - 0.1, z: -5.3 }, { width: 2.8, depth: 3.0, height: 1.6, topScale: 0.92 });
  taperedBox(parts.hull, { x: 0, y: house.deckY + 1.45, z: -5.3 }, { width: 3.3, depth: 3.5, height: 0.35, topScale: 0.75 });
  oars(parts.deck, lines, spread(0.38, 0.68, 5), { reach: 1.9, thickness: 0.1 });
  guns(parts.metal, lines, [0.22, 0.28, 0.72, 0.78], { length: 0.7, bore: 0.22 });
  rudder(parts.deck, lines, { width: 1.0, drop: 0.35 });
  return Object.values(parts);
}
