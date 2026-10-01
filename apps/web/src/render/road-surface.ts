import type { RoadSpec } from "./roads";
import type { RoadKind } from "./world-config";

/**
 * Road surfaces, as plain arrays of numbers.
 *
 * Three surfaces, three ideas:
 *
 * * a **ribbon**, the smooth bed a dirt road or a path is;
 * * **plates**, the cobbles a stone road is made of - one small quad per stone, jittered in position,
 *   size and tone, all batched into a single geometry so a thousand stones are one draw call;
 * * a **disc** per junction, so two roads meeting is a paved place rather than a cross-shaped seam.
 *
 * Everything is deterministic: no clock, no `Math.random`, no per-frame work. The same world draws
 * the same stones on every client and after every refresh, which is also what lets a test look at
 * the numbers.
 */

/** One ready-to-upload surface: positions, triangle indices, and optional per-vertex tint. */
export interface SurfaceData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Multipliers the material colour is tinted by, or null for a flat surface. */
  readonly colors: Float32Array | null;
}

/** A place two or more roads meet, in world metres: what the junction disc is drawn around. */
export interface JunctionSpec {
  readonly id: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  /** Radius of the paved area, in world metres. */
  readonly radiusWorld: number;
  /** The class of the most important road through it. */
  readonly kind: RoadKind;
}

/** How long one cobble plate is, along the road, in world metres. */
const PLATE_LENGTH_WORLD = 0.62;
/** How wide one cobble plate is, across the road, in world metres. */
const PLATE_WIDTH_WORLD = 0.56;
/**
 * The paint on a road.
 *
 * A single flat colour reads as a strip of tape. These multipliers are applied per vertex and are
 * small on purpose: enough that a stone road looks laid rather than printed, not so much that the
 * road becomes a chequerboard.
 */
const TONE_MIN = 0.9;
const TONE_RANGE = 0.16;

/**
 * How many vertices the ribbon has across its width, and where they sit.
 *
 * Nine, from one edge to the other through the centre, and the positions are not evenly spaced: they
 * mark the bands a real dirt road is made of, so each one can carry its own tone. A two-vertex strip
 * is a painted ribbon; these nine are what let the surface read as
 *
 * ```text
 * edge | dusty | compacted | rut | centre | rut | compacted | dusty | edge
 * ```
 *
 * Nine columns over the whole network is a few thousand vertices, in geometry that is built once.
 */
const RIBBON_COLUMNS: readonly number[] = [-1, -0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78, 1];

/**
 * The tone multiplier across the road: dusty at the edge, compacted where the wheels have not been,
 * worn *very slightly* darker where they have, and a shade lighter down the crown.
 *
 * The ruts are deliberately shallow - three per cent either way. A rut painted as a dark stripe is the
 * single thing that turns a dirt road back into a graphic, and the brief asks for tracks you notice at
 * a walk and not from the estate camera.
 */
function dirtProfile(across: number): number {
  const distance = Math.abs(across);
  // Centre crown, where the camber carries the water off.
  if (distance < 0.15) return 1.05;
  // The wheel ruts, either side of the crown. Deep enough to read at a walk, shallow enough that the
  // road is still one surface rather than two painted stripes.
  if (distance < 0.45) return 0.94;
  // Compacted dirt the wheels missed, a shade lighter than the ruts.
  if (distance < 0.7) return 1.01;
  // The dusty shoulder of the surface, where traffic does not reach.
  if (distance < 0.92) return 0.98;
  // The very edge, against the grass.
  return 0.9;
}

/**
 * How much the *outer* edge of a road may wander, as a fraction of its half-width.
 *
 * The navigation shape stays exactly what `RoadSpec.widthWorld` says. This is the renderer's own
 * cosmetic hand-drawn edge: a slow wave along the road, five per cent of half a width either way -
 * a couple of centimetres on the island's road. It is a function of the distance travelled and the
 * side, so it is the same on every client and after every refresh, and it has no high frequency in it,
 * which is what keeps the edge organic instead of noisy.
 */
export const ROAD_EDGE_WAVE = 0.05;

/** The cosmetic edge multiplier at a point along the road, per side. */
export function roadEdgeWave(distanceWorld: number, side: number): number {
  const slow = Math.sin(distanceWorld * 0.21 + side * 1.7);
  const slower = Math.sin(distanceWorld * 0.083 + side * 4.1);
  return 1 + ROAD_EDGE_WAVE * (slow * 0.6 + slower * 0.4);
}

/**
 * The tone across a road's shoulder.
 *
 * Darkest at the outside, where the trodden ground meets unbroken grass, and lighter towards the road
 * it borders. The centre of this ribbon is under the road and never seen, which is why the profile
 * only has to be right at the fringe.
 */
export function shoulderProfile(across: number): number {
  // Kept *below* the field: trodden ground is duller and a little darker than the grass it interrupts,
  // so the band reads as wear. Lifting the inner edge above 1.0 put a pale halo around the road, which
  // is the "brown ribbon with an outline" the V12.4 pass exists to remove.
  return 0.72 + 0.22 * (1 - Math.abs(across));
}
/** Fraction of the outermost plates dropped, so grass shows through the edge of a stone road. */
const EDGE_GAP_CHANCE = 0.07;
/** Fraction of roadside stones skipped, so the verge does not read as a generated line. */
const ROADSIDE_SKIP_CHANCE = 0.42;
/** Distance between roadside stones along a secondary road, in world metres. */
const ROADSIDE_SPACING_WORLD = 2.3;

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function toSurface(positions: number[], indices: number[], colors: number[] | null): SurfaceData {
  if (positions.length === 0) {
    return {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      colors: colors === null ? null : new Float32Array(0)
    };
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors: colors === null ? null : new Float32Array(colors)
  };
}

/**
 * The ribbon for a set of roads of one class.
 *
 * Only roads whose kind is in `kinds` are drawn, so the renderer can put the secondary and the path
 * surfaces on two materials without a second geometry pass. The two ends are pushed half a width
 * past the last waypoint, so a road tucks *under* the junction it meets instead of stopping short of
 * it with a rectangle visible.
 */
export function ribbonSurface(
  roads: readonly RoadSpec[],
  kinds: readonly RoadKind[],
  heightAt?: (worldX: number, worldZ: number) => number,
  /**
   * The tone across the ribbon. The road's own surface uses `dirtProfile`; the shoulder it lies in is
   * passed a different one, because a shoulder is not a narrower road - it is the *trodden grass* the
   * road was cut through, and it has to be dark against the field and light against the road.
   */
  profile: (across: number) => number = dirtProfile
): SurfaceData {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (const road of roads) {
    if (!kinds.includes(road.kind)) continue;
    const samples = road.samples;
    const count = samples.length;
    if (count < 2) continue;
    const base = positions.length / 3;
    const half = road.widthWorld / 2;
    for (let index = 0; index < count; index += 1) {
      const sample = samples[index];
      if (sample === undefined) continue;
      /**
       * The offset comes from the centreline's own mitred normal, never from this sample's neighbours.
       *
       * That is the whole difference between a road and a wobble: the width is `half * miter` on both
       * sides of the same bisector, so it cannot vary along the route however the spline bends, and it
       * cannot disagree between the two edges.
       */
      const offsetX = sample.normalX * half * sample.miter;
      const offsetZ = sample.normalZ * half * sample.miter;
      for (const column of RIBBON_COLUMNS) {
        // The outermost band is the only one that wanders: the road's *shape* is what the navigation
        // grid and the clearance rule measure, and only its drawn edge is allowed to look hand-cut.
        const wobble = Math.abs(column) === 1 ? roadEdgeWave(sample.distance, column) : 1;
        const worldX = sample.worldX + offsetX * column * wobble;
        const worldZ = sample.worldZ + offsetZ * column * wobble;
        positions.push(worldX, heightAt === undefined ? sample.worldY : heightAt(worldX, worldZ), worldZ);
      }
    }
    const columns = RIBBON_COLUMNS.length;
    for (let index = 0; index < count - 1; index += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const near = base + index * columns + column;
        const nearNext = near + 1;
        const far = near + columns;
        const farNext = far + 1;
        // Wound so the strip's normal is up. The columns run from `-normal` to `+normal`, which is the
        // opposite order to the two-vertex strip this replaced - so the winding is the opposite too,
        // and getting it wrong is invisible in the data and obvious on screen (a culled road).
        indices.push(near, nearNext, farNext);
        indices.push(near, farNext, far);
      }
    }
    for (let index = 0; index < count; index += 1) {
      for (const column of RIBBON_COLUMNS) {
        const tone = (TONE_MIN + hash(base + index * columns + column) * TONE_RANGE) * profile(column);
        colors.push(tone, tone, tone);
      }
    }
  }
  return toSurface(positions, indices, colors);
}

/**
 * The cobbles of a stone road.
 *
 * The centreline is walked in fixed steps and, at each step, the full width is filled with one row of
 * plates. Every plate is nudged, turned and tinted by a hash of its own coordinates, so the grid the
 * loop implies is never visible, and the two outermost columns lose an occasional plate so the road
 * has a soft, grass-intruded edge rather than a ruled one.
 */
export function stonePlateSurface(
  roads: readonly RoadSpec[],
  heightAt?: (worldX: number, worldZ: number) => number
): SurfaceData {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const seed = 0x9e3f;

  for (const road of roads) {
    if (road.kind !== "PRIMARY") continue;
    const columns = Math.max(3, Math.round(road.widthWorld / PLATE_WIDTH_WORLD));
    const columnWidth = road.widthWorld / columns;
    for (let index = 0; index < road.samples.length - 1; index += 1) {
      const sample = road.samples[index];
      const next = road.samples[index + 1];
      if (sample === undefined || next === undefined) continue;
      const stepX = next.worldX - sample.worldX;
      const stepZ = next.worldZ - sample.worldZ;
      const stepLength = Math.hypot(stepX, stepZ);
      if (stepLength === 0) continue;
      const alongX = stepX / stepLength;
      const alongZ = stepZ / stepLength;
      // The normal points across the road, which is the direction the columns run.
      const acrossX = -alongZ;
      const acrossZ = alongX;
      const rows = Math.max(1, Math.round(stepLength / PLATE_LENGTH_WORLD));
      for (let row = 0; row < rows; row += 1) {
        const t = (row + 0.5) / rows;
        const centreX = sample.worldX + stepX * t;
          const centreY = sample.worldY + (next.worldY - sample.worldY) * t;
        const centreZ = sample.worldZ + stepZ * t;
        for (let column = 0; column < columns; column += 1) {
          const cell = row * columns + column;
          const cellSeed = seed + hash(index * 131 + cell) * 977;
          const edge = column === 0 || column === columns - 1;
          if (edge && hash(cellSeed + 7.7) < EDGE_GAP_CHANCE) continue;
          const offset = (column - (columns - 1) / 2) * columnWidth;
          const jitterAcross = (hash(cellSeed + 1.3) - 0.5) * columnWidth * 0.34;
          const jitterAlong = (hash(cellSeed + 2.9) - 0.5) * PLATE_LENGTH_WORLD * 0.5;
          const tone = TONE_MIN + hash(cellSeed + 4.1) * TONE_RANGE;
          // Plates almost touch: the road is a laid surface with mortar-wide joints, not a scatter of
          // tiles with the bedding showing between them.
          const halfAlong = PLATE_LENGTH_WORLD * 0.47 * (0.88 + hash(cellSeed + 5.3) * 0.24);
          const halfAcross = columnWidth * 0.47 * (0.88 + hash(cellSeed + 6.1) * 0.24);
          const x = centreX + acrossX * (offset + jitterAcross) + alongX * jitterAlong;
          const z = centreZ + acrossZ * (offset + jitterAcross) + alongZ * jitterAlong;
          // Every plate is laid a little out of square with the row it came out of. Without this the
          // columns are visible as a grid, however much the sizes and tones vary; with it the road
          // reads as stones somebody set by hand.
          const spin = (hash(cellSeed + 8.9) - 0.5) * 0.24;
          const spinCos = Math.cos(spin);
          const spinSin = Math.sin(spin);
          const longX = alongX * spinCos + acrossX * spinSin;
          const longZ = alongZ * spinCos + acrossZ * spinSin;
          const wideX = -alongX * spinSin + acrossX * spinCos;
          const wideZ = -alongZ * spinSin + acrossZ * spinCos;
          const base = positions.length / 3;
          const corners: readonly (readonly [number, number])[] = [
            [longX * halfAlong + wideX * halfAcross, longZ * halfAlong + wideZ * halfAcross],
            [longX * halfAlong - wideX * halfAcross, longZ * halfAlong - wideZ * halfAcross],
            [-longX * halfAlong - wideX * halfAcross, -longZ * halfAlong - wideZ * halfAcross],
            [-longX * halfAlong + wideX * halfAcross, -longZ * halfAlong + wideZ * halfAcross]
          ];
          for (const [cornerX, cornerZ] of corners) {
            const cornerWorldX = x + cornerX;
            const cornerWorldZ = z + cornerZ;
            positions.push(
              cornerWorldX,
              heightAt === undefined ? centreY : heightAt(cornerWorldX, cornerWorldZ),
              cornerWorldZ
            );
            colors.push(tone, tone, tone);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return toSurface(positions, indices, colors);
}

/**
 * The paved disc at a junction.
 *
 * A cross-shaped seam is what a network of ribbons produces if it is simply overlapped, so each
 * shared stop gets one irregular disc of its own surface class: the roads run into it, and it reads
 * as the place they were built to meet. The radius wobbles per vertex, which is what keeps it from
 * looking like a manhole cover.
 */
export function junctionSurface(junctions: readonly JunctionSpec[]): SurfaceData {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  /**
   * More segments and a gentler wobble than the first pass used.
   *
   * A junction disc is laid *over* the ribbon ends that run into it, so any irregularity in its
   * outline shows as a frayed seam where the two surfaces meet - which is exactly what the V12.2
   * close-up caught at the harbour. Sixteen segments with a fourteen per cent wobble read as a
   * torn edge from a few metres away; twenty-four with six do not, and cost nothing.
   */
  const segments = 24;
  for (const [junctionIndex, junction] of junctions.entries()) {
    const base = positions.length / 3;
    positions.push(junction.worldX, junction.worldY, junction.worldZ);
    colors.push(1, 1, 1);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const wobble = 0.94 + hash(junctionIndex * 31 + segment) * 0.12;
      const radius = junction.radiusWorld * wobble;
      positions.push(
        junction.worldX + Math.cos(angle) * radius,
        junction.worldY,
        junction.worldZ + Math.sin(angle) * radius
      );
      const tone = TONE_MIN + hash(junctionIndex * 17 + segment + 3.5) * TONE_RANGE;
      colors.push(tone, tone, tone);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const current = base + 1 + segment;
      const next = base + 1 + ((segment + 1) % segments);
      indices.push(base, current, next);
    }
  }
  return toSurface(positions, indices, colors);
}

/** One roadside stone: where it stands, how big it is, and which way it is turned. */
export interface RoadsideStone {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly scale: number;
  readonly rotationY: number;
  readonly tone: number;
}

/**
 * The stones the verge of a dirt road collects.
 *
 * One every couple of metres, alternating sides, and skipped often enough that the line is broken.
 * They are what separates "a brown stripe" from "a track somebody drives", with no per-stone mesh:
 * the caller instances them.
 */
export function roadsideStones(roads: readonly RoadSpec[]): RoadsideStone[] {
  const stones: RoadsideStone[] = [];
  for (const road of roads) {
    if (road.kind !== "SECONDARY") continue;
    let travelled = 0;
    let side = 1;
    let index = 0;
    for (let sampleIndex = 1; sampleIndex < road.samples.length; sampleIndex += 1) {
      const previous = road.samples[sampleIndex - 1];
      const sample = road.samples[sampleIndex];
      if (previous === undefined || sample === undefined) continue;
      const stepX = sample.worldX - previous.worldX;
      const stepZ = sample.worldZ - previous.worldZ;
      const stepLength = Math.hypot(stepX, stepZ);
      if (stepLength === 0) continue;
      travelled += stepLength;
      if (travelled < ROADSIDE_SPACING_WORLD) continue;
      travelled = 0;
      index += 1;
      if (hash(index * 3.7 + road.id.length) < ROADSIDE_SKIP_CHANCE) continue;
      side = -side;
      const alongX = stepX / stepLength;
      const alongZ = stepZ / stepLength;
      const normalX = -alongZ;
      const normalZ = alongX;
      const distance = road.widthWorld / 2 + 0.34 + hash(index * 5.1) * 0.34;
      stones.push({
        worldX: sample.worldX + normalX * distance * side + alongX * 0.2,
        worldY: sample.worldY,
        worldZ: sample.worldZ + normalZ * distance * side + alongZ * 0.2,
        scale: 0.16 + hash(index * 7.3 + road.id.length) * 0.2,
        rotationY: hash(index * 11.9) * Math.PI * 2,
        tone: TONE_MIN + hash(index * 13.1 + road.id.length) * TONE_RANGE
      });
    }
  }
  return stones;
}
