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

/** One point on a road's centreline, in world metres, already lifted onto the terrain. */
export interface RoadSample {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
}

/** A road as the world model carries it: geometry and class, never behaviour. */
export interface RoadSpec {
  readonly id: string;
  readonly kind: RoadKind;
  /** Full width of the drawn road, in world metres. */
  readonly widthWorld: number;
  readonly samples: readonly RoadSample[];
}

/** How many points a spline segment is sampled into. Higher is smoother and costs more vertices. */
/**
 * How finely a spline segment is walked.
 *
 * Raised in V12.2 from 11. A ribbon's inner edge folds whenever the corner's radius is smaller than
 * the road's half-width, and at eleven samples a bend could turn far enough between two samples to
 * cross itself - the hole the harbour close-up showed. The geometry is static and built once, so the
 * extra samples cost nothing at runtime and buy a road that does not tear at its corners.
 */
const SAMPLES_PER_SEGMENT = 18;
/**
 * A road is lifted this far above the ground it follows.
 *
 * The ground is drawn as a coarse mesh and a road is placed on the *analytic* height, so between two
 * of the ground mesh's rings the drawn surface sits a centimetre or two above where the curve says it
 * is - and a road lifted by less than that disappears into the grass in patches, which is the "road
 * swallowed by a hill" the estate view kept showing.
 *
 * Raised again in V12.2, from five centimetres to sixteen. Five was enough on the inland relief but not
 * where the road runs down to the harbour: the shore fade is the steepest thing the terrain does, and
 * between two rings of the ground mesh the drawn surface can stand well above the analytic curve the
 * road is placed on. The result was green wedges cutting through the road near the quay, which the QA
 * pass caught and a lift experiment confirmed.
 */
export const ROAD_LIFT_WORLD = 0.16;

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
  samplesPerSegment: number = SAMPLES_PER_SEGMENT
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
 * Builds one road's centreline in world metres.
 *
 * The height comes from the same `terrainHeightAt` the ground mesh is built from, so a road climbs a
 * hill it crosses rather than cutting through it or floating over it.
 */
export function buildRoadSpec(road: Road, layout: FarmLayout, terrain: TerrainShape): RoadSpec {
  const frame = worldFrame(layout.pitch);
  const waypoints = road.points.map((point) => tileToWorld(point, frame));
  const samples = splineThrough(waypoints).map((point) => ({
    worldX: point.worldX,
    worldY: GROUND_SURFACE_Y + terrainHeightAt(point.worldX, point.worldZ, terrain) + ROAD_LIFT_WORLD,
    worldZ: point.worldZ
  }));
  return {
    id: road.id,
    kind: road.kind,
    widthWorld: ROAD_WIDTH_TILES[road.kind] * layout.pitch,
    samples
  };
}
