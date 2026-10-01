import { tileToWorld, worldFrame, type FarmLayout } from "./layout";
import { GROUND_SURFACE_Y, terrainHeightAt, type TerrainShape } from "./terrain-height";
import { ROAD_WIDTH_TILES, type Road, type RoadKind } from "./world-config";

/**
 * Roads, as pure geometry.
 *
 * A road is authored as a handful of tile coordinates - the waypoints somebody would actually think
 * of - and turned here into a smooth, terrain-following centreline in world metres. The renderer
 * extrudes that centreline into a ribbon and nothing else; collision does not read roads at all,
 * because a road is ground like any other ground.
 *
 * Deterministic by construction: a spline through fixed points, sampled a fixed number of times, so
 * the same road is the same shape on every client and after every refresh.
 */

/**
 * One point on a road's centreline, in world metres, already lifted onto the terrain.
 *
 * The sample carries the *join* as well as the position. A ribbon built by asking each sample for its
 * own tangent gets a normal that turns abruptly at a corner, and the two edges then disagree about
 * where the road is: that is where the wobble, the flares and the folded edges of the V12.2 road came
 * from. `normalX`/`normalZ` is the mitred bisector of the two tangents that meet here, and `miter` is
 * how far out that bisector has to reach to keep the edges the same distance from the centre - which
 * is the one number that has to be limited, or a sharp turn produces a spike.
 */
export interface RoadSample {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  /** Unit vector across the road at this sample, from the mitred join. */
  readonly normalX: number;
  readonly normalZ: number;
  /**
   * How far along the bisector the edge sits, as a multiple of the half-width.
   *
   * 1 on a straight run; larger at a corner, and clamped at `MITER_LIMIT` so a hairpin bezels instead
   * of growing a spike.
   */
  readonly miter: number;
  /** Distance travelled along the centreline from the first sample, in world metres. */
  readonly distance: number;
}

/** A road as the world model carries it: geometry and class, never behaviour. */
export interface RoadSpec {
  readonly id: string;
  readonly kind: RoadKind;
  /** Full width of the drawn road, in world metres. */
  readonly widthWorld: number;
  readonly samples: readonly RoadSample[];
}

/**
 * How far apart the centreline's samples are, in world metres.
 *
 * Uniform *by arc length*, not by spline parameter. Sampling a spline at even `t` puts samples far
 * apart on a straight run and close together in a bend, so the ribbon's triangles are uneven and its
 * edge reads as wobbling even when the centreline is smooth - which is precisely what the V12.2
 * screenshots showed. A fixed step makes every triangle along the road the same length.
 */
export const ROAD_SAMPLE_SPACING_WORLD = 0.6;
/** How finely the spline is walked *before* the arc-length resample. Cheap, and only done once. */
const SPLINE_SAMPLES_PER_SEGMENT = 32;
/**
 * The longest a mitre may reach, as a multiple of the half-width.
 *
 * At a turn of angle θ the mitre has to reach `half / cos(θ/2)`; at 90 degrees that is 1.41 half-widths
 * and at 140 degrees it is 2.9. The brief's range is 1.5-2.0, and anything past this limit is bevelled
 * by simply stopping the reach short - the road keeps its width and loses the spike.
 */
const MITER_LIMIT = 1.8;
/**
 * A road is lifted this far above the ground it follows.
 *
 * The ground is drawn as a coarse mesh and a road is placed on the *analytic* height, so between two
 * of the ground mesh's rings the drawn surface sits a centimetre or two above where the curve says it
 * is - and a road lifted by less than that disappears into the grass in patches, which is the "road
 * swallowed by a hill" the estate view kept showing.
 *
 * V12.2 raised this to sixteen centimetres to stop the ground poking through near the shore, and paid
 * for it with a visible kerb. V12.4 puts it back down to three and takes the depth problem to the
 * material instead: every road surface is polygon-offset, so it wins the depth test against ground
 * that is a few centimetres above the curve, and the road sits *in* the field rather than on it. The
 * value is asserted by a test so it cannot quietly climb again.
 */
export const ROAD_LIFT_WORLD = 0.03;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Resamples a polyline through a Catmull-Rom spline.
 *
 * The end segments duplicate their neighbour so the curve starts and ends exactly on the authored
 * waypoints rather than overshooting them - which is what keeps a road ending on the harbour quay
 * instead of in the sea.
 */
export function splineThrough(
  points: readonly { readonly worldX: number; readonly worldZ: number }[],
  samplesPerSegment: number = SPLINE_SAMPLES_PER_SEGMENT
): readonly { readonly worldX: number; readonly worldZ: number }[] {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  if (points.length === 1) return [{ worldX: first.worldX, worldZ: first.worldZ }];

  const result: { worldX: number; worldZ: number }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? first;
    const p1 = points[index] ?? first;
    const p2 = points[index + 1] ?? last;
    const p3 = points[index + 2] ?? last;
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      result.push({
        worldX: catmullRom(p0.worldX, p1.worldX, p2.worldX, p3.worldX, t),
        worldZ: catmullRom(p0.worldZ, p1.worldZ, p2.worldZ, p3.worldZ, t)
      });
    }
  }
  result.push({ worldX: last.worldX, worldZ: last.worldZ });
  return result;
}

/**
 * Walks a polyline at a fixed step, by arc length.
 *
 * The curve that comes out of the spline has samples wherever the spline put them; this puts them
 * where the *road* needs them - the same distance apart all the way along - which is what makes a
 * constant-width ribbon look like one.
 */
export function resampleByDistance(
  points: readonly { readonly worldX: number; readonly worldZ: number }[],
  step: number
): readonly { readonly worldX: number; readonly worldZ: number }[] {
  const first = points[0];
  if (first === undefined) return [];
  if (points.length === 1 || step <= 0) return [{ worldX: first.worldX, worldZ: first.worldZ }];

  const result: { worldX: number; worldZ: number }[] = [{ worldX: first.worldX, worldZ: first.worldZ }];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const segmentX = current.worldX - previous.worldX;
    const segmentZ = current.worldZ - previous.worldZ;
    const length = Math.hypot(segmentX, segmentZ);
    if (length === 0) continue;
    let travelled = carry;
    while (travelled + step <= length) {
      travelled += step;
      const t = travelled / length;
      result.push({
        worldX: previous.worldX + segmentX * t,
        worldZ: previous.worldZ + segmentZ * t
      });
    }
    carry = travelled - length;
  }
  // The last authored point is always a sample, so a road ends exactly where it was told to.
  const last = points[points.length - 1];
  const tail = result[result.length - 1];
  if (last !== undefined && tail !== undefined && Math.hypot(last.worldX - tail.worldX, last.worldZ - tail.worldZ) > 0.001) {
    result.push({ worldX: last.worldX, worldZ: last.worldZ });
  }
  return result;
}

/**
 * The mitred normal at every point of a centreline.
 *
 * Three cases, and the third is the one that matters:
 *
 * * a straight run has a normal perpendicular to its tangent and a mitre of exactly 1;
 * * the first and last samples use their own segment's tangent, so a road *ends square to itself*
 *   rather than being cut along a world axis - which is the "diagonal chopped end" the brief names;
 * * a join takes the bisector of the two tangents and reaches `1 / cos(θ/2)` along it, clamped so a
 *   very sharp turn bevels instead of spiking.
 */
export function mitredNormals(
  points: readonly { readonly worldX: number; readonly worldZ: number }[]
): readonly { readonly normalX: number; readonly normalZ: number; readonly miter: number; readonly distance: number }[] {
  const count = points.length;
  const normals: { normalX: number; normalZ: number; miter: number; distance: number }[] = [];
  if (count === 0) return normals;

  const tangents: { readonly x: number; readonly z: number }[] = [];
  let distance = 0;
  for (let index = 0; index < count; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (current === undefined) continue;
    // One tangent per *join*: forward for the first, backward for the last, centred in between.
    const from = previous ?? current;
    const to = next ?? current;
    const dx = to.worldX - from.worldX;
    const dz = to.worldZ - from.worldZ;
    const length = Math.hypot(dx, dz);
    tangents.push(length === 0 ? { x: 1, z: 0 } : { x: dx / length, z: dz / length });
    if (index > 0 && previous !== undefined) {
      distance += Math.hypot(current.worldX - previous.worldX, current.worldZ - previous.worldZ);
    }
    const tangent = tangents[tangents.length - 1];
    if (tangent === undefined) continue;
    // The normal is the tangent turned a quarter turn in the ground plane.
    normals.push({ normalX: -tangent.z, normalZ: tangent.x, miter: 1, distance });
  }

  for (let index = 0; index < normals.length; index += 1) {
    const previous = normals[index - 1];
    const current = normals[index];
    const next = normals[index + 1];
    if (current === undefined) continue;
    if (previous === undefined || next === undefined) continue;
    const bisectorX = previous.normalX + next.normalX;
    const bisectorZ = previous.normalZ + next.normalZ;
    const length = Math.hypot(bisectorX, bisectorZ);
    if (length < 1e-6) continue;
    const unitX = bisectorX / length;
    const unitZ = bisectorZ / length;
    // How far the bisector has to reach for the edge to stay half a width from the centreline.
    const cosHalf = unitX * previous.normalX + unitZ * previous.normalZ;
    const miter = cosHalf <= 1e-3 ? MITER_LIMIT : Math.min(MITER_LIMIT, 1 / cosHalf);
    normals[index] = { normalX: unitX, normalZ: unitZ, miter, distance: current.distance };
  }
  return normals;
}

/**
 * Builds one road's centreline in world metres.
 *
 * The height comes from the same `terrainHeightAt` the ground mesh is built from, so a road climbs a
 * hill it crosses rather than cutting through it or floating over it.
 */
export function buildRoadSpec(road: Road, layout: FarmLayout, terrain: TerrainShape): RoadSpec {
  const frame = worldFrame(layout.pitch);
  const waypoints = road.points.map((point) => tileToWorld(point, frame));
  const centreline = resampleByDistance(splineThrough(waypoints), ROAD_SAMPLE_SPACING_WORLD);
  const joins = mitredNormals(centreline);
  const samples: RoadSample[] = centreline.map((point, index) => {
    const join = joins[index];
    return {
      worldX: point.worldX,
      worldY: GROUND_SURFACE_Y + terrainHeightAt(point.worldX, point.worldZ, terrain) + ROAD_LIFT_WORLD,
      worldZ: point.worldZ,
      normalX: join?.normalX ?? 0,
      normalZ: join?.normalZ ?? 1,
      miter: join?.miter ?? 1,
      distance: join?.distance ?? 0
    };
  });
  return {
    id: road.id,
    kind: road.kind,
    widthWorld: ROAD_WIDTH_TILES[road.kind] * layout.pitch,
    samples
  };
}
