import { tileToWorld, worldFrame, type FarmLayout } from "./layout";
import { GROUND_SURFACE_Y, terrainHeightAt, type TerrainShape } from "./terrain-height";
import { ROAD_WIDTH_TILES, type Road, type RoadKind } from "./world-config";

/**
 * Roads, as pure geometry.
 *
 * A road is authored as a handful of tile coordinates - the waypoints somebody would actually think
 * of - and turned here into a terrain-following centreline in world metres. The renderer extrudes
 * that centreline into a ribbon and nothing else; collision does not read roads at all, because a
 * road is ground like any other ground.
 *
 * The alignment is *surveyed*, not grown. A road the island built is a straight run, a corner, and
 * another straight run: the authored segment between two waypoints is drawn as the straight line it
 * is, and only an interior waypoint - a corner - is rounded, by a fillet whose radius is a multiple
 * of the road's own width. That is the whole shape rule, and it is what stops a road from acquiring
 * a bend nobody asked for. A Catmull-Rom spline through unevenly spaced waypoints does exactly that:
 * it begins turning a whole segment before the corner and finishes a segment after it, which spreads
 * one deliberate turn into the long S the V13.1 pass exists to remove.
 *
 * Deterministic by construction: straight segments and circular fillets through fixed points,
 * walked at a fixed step, so the same road is the same shape on every client and after every
 * refresh.
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
 * Uniform *by arc length* rather than by whatever parameter produced the alignment: a fixed step
 * makes every triangle along the road the same length, so the ribbon's two edges stay in step
 * through a fillet instead of bunching up inside the bend.
 */
export const ROAD_SAMPLE_SPACING_WORLD = 0.6;
/**
 * How far a corner is rounded, as a multiple of the road's full width.
 *
 * Three widths, so the fillet reaches six half-widths from the corner's own centre: about six metres
 * on the island's dirt road, which is a bend a cart takes without slowing, and proportionally tighter
 * on a footpath. A *multiple* rather than a fixed distance, so a wide stone road does not turn as
 * sharply as a track.
 */
const ROAD_CORNER_RADIUS_WIDTHS = 3;
/** How finely a fillet's arc is walked *before* the arc-length resample. Cheap, and done once. */
const CORNER_SAMPLES_PER_METRE = 2;
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

/** How close two authored waypoints have to be to count as the same one, in world metres. */
const WAYPOINT_EPSILON_WORLD = 0.001;

/**
 * An alignment through the authored waypoints: straight runs, joined by circular fillets.
 *
 * Every authored segment is drawn straight, exactly as it was written down. An interior waypoint is
 * a *corner*, and a corner is rounded with a fillet of the requested radius - the arc is tangent to
 * both legs, so the road arrives at it and leaves it without a kink, and the run on either side of
 * the arc is as straight as the author wrote it.
 *
 * The fillet's tangent length is capped at just under half of the shorter of the two legs it joins,
 * and the radius shrinks with it. That is what keeps a hairpin in a short lane from eating the whole
 * segment: the corner that is left is as round as the ground allows and the legs stay.
 *
 * A ring - `village_street` around the square is one - is authored with its last waypoint repeating
 * its first. That is detected, the duplicated point is dropped, and the seam is filleted like every
 * other corner instead of becoming a kink at the one place the author could not see it.
 */
export function alignmentThrough(
  points: readonly { readonly worldX: number; readonly worldZ: number }[],
  cornerRadiusWorld: number = 0
): readonly { readonly worldX: number; readonly worldZ: number }[] {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  if (points.length === 1) return [{ worldX: first.worldX, worldZ: first.worldZ }];

  const ring = points.length > 2 && Math.hypot(last.worldX - first.worldX, last.worldZ - first.worldZ) <= WAYPOINT_EPSILON_WORLD;
  const vertices = ring ? points.slice(0, -1) : points;
  const count = vertices.length;
  if (count < 3 || cornerRadiusWorld <= 0) return points.map((point) => ({ ...point }));

  const result: { worldX: number; worldZ: number }[] = [];
  if (!ring) {
    const head = vertices[0];
    if (head === undefined) return [];
    result.push({ worldX: head.worldX, worldZ: head.worldZ });
  }

  const firstCorner = ring ? 0 : 1;
  const lastCorner = ring ? count - 1 : count - 2;
  for (let index = firstCorner; index <= lastCorner; index += 1) {
    const previous = vertices[(index - 1 + count) % count];
    const vertex = vertices[index];
    const next = vertices[(index + 1) % count];
    if (previous === undefined || vertex === undefined || next === undefined) continue;

    const legAX = previous.worldX - vertex.worldX;
    const legAZ = previous.worldZ - vertex.worldZ;
    const legBX = next.worldX - vertex.worldX;
    const legBZ = next.worldZ - vertex.worldZ;
    const legALength = Math.hypot(legAX, legAZ);
    const legBLength = Math.hypot(legBX, legBZ);
    if (legALength < WAYPOINT_EPSILON_WORLD || legBLength < WAYPOINT_EPSILON_WORLD) continue;

    const ax = legAX / legALength;
    const az = legAZ / legALength;
    const bx = legBX / legBLength;
    const bz = legBZ / legBLength;
    // The angle at the corner, between the two legs. Pi is a straight run through, 0 a hairpin.
    const interior = Math.acos(Math.min(1, Math.max(-1, ax * bx + az * bz)));
    // A corner the road drives straight through needs no fillet, and a spike would be a folded ribbon.
    if (interior > Math.PI - 1e-3) {
      result.push({ worldX: vertex.worldX, worldZ: vertex.worldZ });
      continue;
    }

    let radius = cornerRadiusWorld;
    let tangent = radius / Math.tan(interior / 2);
    const longestTangent = Math.min(legALength, legBLength) * 0.48;
    if (tangent > longestTangent) {
      tangent = longestTangent;
      radius = tangent * Math.tan(interior / 2);
    }
    // The arc starts and ends exactly here, on the two legs, at the fillet's tangent points.
    const enterX = vertex.worldX + ax * tangent;
    const enterZ = vertex.worldZ + az * tangent;
    const leaveX = vertex.worldX + bx * tangent;
    const leaveZ = vertex.worldZ + bz * tangent;

    const bisectorX = ax + bx;
    const bisectorZ = az + bz;
    const bisectorLength = Math.hypot(bisectorX, bisectorZ);
    if (bisectorLength < 1e-6) {
      result.push({ worldX: vertex.worldX, worldZ: vertex.worldZ });
      continue;
    }
    // The centre sits on the bisector at the distance that puts it `radius` from both legs.
    const centreDistance = radius / Math.sin(interior / 2);
    const centreX = vertex.worldX + (bisectorX / bisectorLength) * centreDistance;
    const centreZ = vertex.worldZ + (bisectorZ / bisectorLength) * centreDistance;

    const enterAngle = Math.atan2(enterZ - centreZ, enterX - centreX);
    // Sweep the short way round; the turn itself decides the sign, so the arc bulges outward from
    // the corner rather than cutting across the inside of it.
    const turn = Math.PI - interior;
    const cross = ax * bz - az * bx;
    const sweep = (cross > 0 ? -1 : 1) * turn;
    const steps = Math.max(2, Math.ceil(radius * Math.abs(sweep) * CORNER_SAMPLES_PER_METRE));
    for (let step = 0; step < steps; step += 1) {
      const angle = enterAngle + sweep * (step / steps);
      result.push({
        worldX: centreX + Math.cos(angle) * radius,
        worldZ: centreZ + Math.sin(angle) * radius
      });
    }
    // The fillet ends exactly on the second leg, so the straight run after it starts where the arc
    // does rather than a rounding error away from it.
    result.push({ worldX: leaveX, worldZ: leaveZ });
  }

  if (ring) {
    const head = result[0];
    if (head !== undefined) result.push({ worldX: head.worldX, worldZ: head.worldZ });
  } else {
    const tail = vertices[count - 1];
    if (tail !== undefined) result.push({ worldX: tail.worldX, worldZ: tail.worldZ });
  }
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
    // Never below 1: on a straight run the bisector *is* the normal, and one sample's worth of
    // floating-point error must not narrow the road at that join.
    const miter = cosHalf <= 1e-3 ? MITER_LIMIT : Math.max(1, Math.min(MITER_LIMIT, 1 / cosHalf));
    normals[index] = { normalX: unitX, normalZ: unitZ, miter, distance: current.distance };
  }
  return normals;
}

/**
 * Builds one road's centreline in world metres.
 *
 * The height comes from the same `terrainHeightAt` the ground mesh is built from, so a road climbs a
 * hill it crosses rather than cutting through it or floating over it.
 *
 * The width comes first, because the corner radius is a multiple of it: the alignment is surveyed at
 * the size of road it will be drawn as, then walked at a fixed step.
 */
export function buildRoadSpec(road: Road, layout: FarmLayout, terrain: TerrainShape): RoadSpec {
  const frame = worldFrame(layout.pitch);
  const widthWorld = ROAD_WIDTH_TILES[road.kind] * layout.pitch;
  const waypoints = road.points.map((point) => tileToWorld(point, frame));
  const alignment = alignmentThrough(waypoints, widthWorld * ROAD_CORNER_RADIUS_WIDTHS);
  const centreline = resampleByDistance(alignment, ROAD_SAMPLE_SPACING_WORLD);
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
    widthWorld,
    samples
  };
}
