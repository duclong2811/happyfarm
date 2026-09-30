/**
 * The island's outline and its elevation, as pure functions of a world position.
 *
 * Three separate ideas live here, and keeping them apart is what makes the world both natural-looking
 * and safe to play on:
 *
 * 1. `islandRadiusAt` describes *where the land ends*. The island is a superellipse - a rectangle
 *    with rounded corners rather than an ellipse - modulated by three low-frequency radial lobes, so
 *    it has bays and headlands instead of a mathematical outline. The same curve is drawn and walked.
 *
 * 2. `terrainHeightAt` describes *how high the land is*. It is exactly zero on every area the farm
 *    works - the reserved field, the pond, the settlement - and exactly zero at the waterline, and it
 *    swells between them, higher toward the upland and lower toward the coast.
 *
 * 3. `GROUND_SURFACE_Y` is the world height of the flat ground everything stands on, so a prop is
 *    placed against the same surface the ground mesh is built from.
 *
 * All of it is deterministic closed-form arithmetic: no clock, no randomness, no state. The playable
 * tile grid never samples any of it, so elevation is scenery rather than a rule.
 */

/** One low-frequency lobe of the island's outline. */
export interface IslandLobe {
  /** 1 is a single offset, 2 stretches two opposite coasts, 3 makes a triangle, 5 an irregular bay. */
  readonly harmonic: number;
  /** Peak displacement as a fraction of the base radius. Kept small: this is a coastline, not a star. */
  readonly amplitude: number;
  readonly phase: number;
}

/** The island's outline: a modulated superellipse centred on the visual bounds' centre. */
export interface IslandShape {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfWidthWorld: number;
  readonly halfDepthWorld: number;
  /** Superellipse exponent. 2 is an ellipse; higher values square the shape off. */
  readonly exponent: number;
  /** The lobes that turn the base shape into a coastline. */
  readonly lobes: readonly IslandLobe[];
}

/**
 * A rectangle of ground the terrain holds flat, with a soft edge.
 *
 * The reserved field is one; the pond, the settlement square, and the harbour are others. Water has
 * to sit level or it drains downhill, a building has to sit level or it stands on one corner, and the
 * farm has to sit level or a plot bought at the edge would be on a slope.
 */
export interface FlatArea {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfWidthWorld: number;
  readonly halfDepthWorld: number;
  /** Distance past the rectangle over which the ground returns to its natural height. */
  readonly featherWorld: number;
}

/**
 * A broad directional rise: the island's upland.
 *
 * `normalX`/`normalZ` point toward the high side in normalised island space, so one band is enough to
 * make an orchard side and a coast side - which is what gives the map a lowland, a midland, and an
 * upland without a single cliff.
 */
export interface UplandBias {
  readonly normalX: number;
  readonly normalZ: number;
  /** How much of the relief this band adds on its high side. */
  readonly weight: number;
}

/** The island's outline plus the shape of the ground inside it. */
export interface TerrainShape extends IslandShape {
  /** Height of the tallest hill above the flat ground, in world units. */
  readonly reliefWorld: number;
  /** Every rectangle the terrain holds level. */
  readonly flatAreas: readonly FlatArea[];
  /** The broad rises that make a lowland and an upland. */
  readonly uplands: readonly UplandBias[];
}

/**
 * World height of the flat ground surface the props stand on.
 *
 * The tile slabs start at `y = 0` and are a little over 9 cm thick, so the grass they sit on has to
 * be just under them. Everything placed on open ground - scenery, landmarks, roads - is offset by
 * this, which is what keeps a tree on a hill from being planted through the hillside.
 */
export const GROUND_SURFACE_Y = -0.04;

/** Ground flatter than this is treated as level, so a plateau and a beach do not shimmer. */
const FLAT_EPSILON_WORLD = 0.015;

/** The outline's displacement at a polar angle, as a fraction of the base radius. */
export function islandOutlineScale(angle: number, island: IslandShape): number {
  let scale = 1;
  for (const lobe of island.lobes) {
    scale += lobe.amplitude * Math.sin(lobe.harmonic * angle + lobe.phase);
  }
  // A lobe stack can only shape a coastline if it stays a closed, non-self-intersecting curve.
  return Math.min(1.3, Math.max(0.7, scale));
}

/** The base superellipse's own radius for a normalised coordinate: 1 on the unmodulated outline. */
function superellipseRadius(normalisedX: number, normalisedZ: number, exponent: number): number {
  return Math.pow(Math.pow(Math.abs(normalisedX), exponent) + Math.pow(Math.abs(normalisedZ), exponent), 1 / exponent);
}

/**
 * How far a point is from the island's centre, measured in shore units.
 *
 * 0 at the centre, 1 exactly on the shoreline, above 1 once past it. Because the shoreline is the
 * superellipse scaled by `islandOutlineScale`, the same value describes the drawn shore, the walkable
 * shore, and the beach - they cannot drift apart.
 */
export function islandRadiusAt(worldX: number, worldZ: number, island: IslandShape): number {
  const nx = (worldX - island.centerWorldX) / island.halfWidthWorld;
  const nz = (worldZ - island.centerWorldZ) / island.halfDepthWorld;
  if (nx === 0 && nz === 0) return 0;
  const radius = superellipseRadius(nx, nz, island.exponent);
  return radius / islandOutlineScale(Math.atan2(nz, nx), island);
}

/**
 * A point on the shoreline, in world metres.
 *
 * The superellipse's own parametrisation, displaced radially by the outline scale at that point's own
 * polar angle - which is what makes `islandRadiusAt` return exactly 1 for every point this returns.
 */
export function islandRimPoint(
  parameter: number,
  island: IslandShape
): { readonly worldX: number; readonly worldZ: number } {
  const power = 2 / island.exponent;
  const cos = Math.cos(parameter);
  const sin = Math.sin(parameter);
  const baseX = Math.sign(cos) * Math.pow(Math.abs(cos), power);
  const baseZ = Math.sign(sin) * Math.pow(Math.abs(sin), power);
  const scale = islandOutlineScale(Math.atan2(baseZ, baseX), island);
  return {
    worldX: island.centerWorldX + baseX * scale * island.halfWidthWorld,
    worldZ: island.centerWorldZ + baseZ * scale * island.halfDepthWorld
  };
}

/**
 * How much of the natural elevation survives at a point: 0 inside every flat area, 1 outside all of
 * them, smooth in between. The most-restrictive area wins, so overlapping areas cannot add up.
 */
export function flatMask(worldX: number, worldZ: number, areas: readonly FlatArea[]): number {
  let mask = 1;
  for (const area of areas) {
    const feather = area.featherWorld;
    if (feather <= 0) continue;
    const dx = Math.max(0, Math.abs(worldX - area.centerWorldX) - area.halfWidthWorld) / feather;
    const dz = Math.max(0, Math.abs(worldZ - area.centerWorldZ) - area.halfDepthWorld) / feather;
    const t = Math.min(1, Math.hypot(dx, dz));
    mask = Math.min(mask, t * t * (3 - 2 * t));
  }
  return mask;
}

/** How high this point sits between the island's lowland and its upland, as a multiplier near 1. */
export function uplandOffset(worldX: number, worldZ: number, shape: TerrainShape): number {
  const nx = (worldX - shape.centerWorldX) / shape.halfWidthWorld;
  const nz = (worldZ - shape.centerWorldZ) / shape.halfDepthWorld;
  let offset = 0;
  for (const band of shape.uplands) {
    const along = (nx * band.normalX + nz * band.normalZ) * 0.5 + 0.5;
    const t = Math.min(1, Math.max(0, along));
    offset += band.weight * t * t;
  }
  return offset;
}

/**
 * How high the ground stands at a world position, in world units above the flat ground.
 *
 * Four things multiply together, and each has a job:
 *
 *   * a smooth wave field, so the land is never a plane;
 *   * the upland offset, so one side of the island is genuinely higher than the other;
 *   * the flat mask, so the farm, the pond, and the settlement are exactly level;
 *   * a shore fade, so the land meets the water at zero height and the beach is level.
 */
export function terrainHeightAt(worldX: number, worldZ: number, shape: TerrainShape): number {
  const radius = islandRadiusAt(worldX, worldZ, shape);
  // Fade to nothing before the waterline: the last of the island is beach, not hillside.
  const shoreFade = 1 - Math.min(1, Math.max(0, (radius - 0.72) / 0.26));
  if (shoreFade <= 0) return 0;

  const wave =
    0.5 +
    0.28 * Math.sin(worldX * 0.13 + 1.7) * Math.cos(worldZ * 0.11 - 0.9) +
    0.18 * Math.sin((worldX - worldZ) * 0.07 + 0.4) +
    0.1 * Math.sin(worldX * 0.31 - 0.6);
  const local = Math.min(1.3, Math.max(0.12, wave + uplandOffset(worldX, worldZ, shape)));
  const height = shape.reliefWorld * local * shoreFade * flatMask(worldX, worldZ, shape.flatAreas);
  return height <= FLAT_EPSILON_WORLD ? 0 : height;
}
