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
  /**
   * The island's one authored landmark, or nothing on an island that has none.
   *
   * Optional so an empty or test world can be a shape with no landmark in it, and so the volcano is
   * a *term in the height function* rather than a mesh: the terrain mesh, the roads, the scenery and
   * the camera's ground clamp all read the same function, which is what stops a tree from floating
   * over the crater rim.
   */
  readonly volcano?: VolcanoShape;
}

/**
 * The volcano, as a profile rather than a model.
 *
 * A cone is the wrong shape for a volcano: it has no crater, it looks procedural, and every silhouette
 * from every bearing is the same. This describes the four things a volcano actually has - a broad
 * base, flanks that steepen as they climb, a raised rim, and a floor below it - plus enough asymmetry
 * that the footprint is not a circle and the summit is not a point.
 */
export interface VolcanoShape {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  /** Where the flanks reach the surrounding land. Everything outside is ordinary terrain. */
  readonly baseRadiusWorld: number;
  /** Height of the crater rim above the flat ground, in world units. */
  readonly heightWorld: number;
  /** The rim's radius as a fraction of the base: inside it is the crater. */
  readonly rimRadiusFraction: number;
  /** How far the crater floor sits below the rim, as a fraction of the height. */
  readonly craterDepthFraction: number;
  /** Radial wobble, so the footprint is an outline rather than a circle. */
  readonly lobes: readonly IslandLobe[];
  /** How much higher one side of the cone stands, as a fraction of the height. */
  readonly tilt: number;
  /** The bearing the cone leans towards, in radians about Y. */
  readonly tiltDirection: number;
  /**
   * The fraction of the base radius inside which the flanks are "the steep part".
   *
   * Not a rendering number: it is the line a road, a building, or a future trail is checked against,
   * so "do not build on the steep ground" is one shared answer rather than an eyeballed one.
   */
  readonly steepRadiusFraction: number;
}

/** Which band of a volcano a point falls in, or null when it is not on the volcano at all. */
export type VolcanoZone = "CORE" | "SLOPE" | "FOOTHILL";

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
export function islandOutlineScale(angle: number, island: { readonly lobes: readonly IslandLobe[] }): number {
  let scale = 1;
  for (const lobe of island.lobes) {
    scale += lobe.amplitude * Math.sin(lobe.harmonic * angle + lobe.phase);
  }
  // A lobe stack can only shape a coastline if it stays a closed, non-self-intersecting curve.
  return Math.min(1.3, Math.max(0.7, scale));
}

/**
 * How far a point is from a volcano's centre, as a fraction of the base radius at its own bearing.
 *
 * 0 at the summit, 1 where the flanks meet ordinary ground. The lobes make that fraction depend on
 * the bearing, which is what turns a circle into a footprint - and why the same function answers both
 * "how high is the ground here" and "which band of the volcano is this cell in".
 */
export function volcanoRadiusFraction(
  worldX: number,
  worldZ: number,
  volcano: VolcanoShape
): number {
  const dx = worldX - volcano.centerWorldX;
  const dz = worldZ - volcano.centerWorldZ;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return 0;
  const bearing = Math.atan2(dz, dx);
  return distance / (volcano.baseRadiusWorld * islandOutlineScale(bearing, volcano));
}

/**
 * How high a volcano's own ground stands at a point, in world units above the flat ground.
 *
 * Three pieces, joined without a seam:
 *
 * * **the flanks**, from the base inwards: a concave curve, so the skirt is broad and the climb gets
 *   steeper as it rises - the profile that reads as a mountain rather than as a bump;
 * * **the rim**, where the two halves meet at full height;
 * * **the crater**, a bowl below the rim that is deepest at its centre.
 *
 * The whole thing is tilted by one asymmetric term, so the summit is off-centre and no two bearings
 * give the same silhouette.
 */
export function volcanoHeightAt(worldX: number, worldZ: number, volcano: VolcanoShape): number {
  const fraction = volcanoRadiusFraction(worldX, worldZ, volcano);
  if (fraction >= 1) return 0;
  const rim = volcano.rimRadiusFraction;
  const bearing = Math.atan2(worldZ - volcano.centerWorldZ, worldX - volcano.centerWorldX);
  // One side of the cone stands a little higher than the other, and the summit therefore leans.
  const lean = 1 + volcano.tilt * Math.cos(bearing - volcano.tiltDirection);
  /**
   * The lip: a narrow band of extra height exactly at the rim.
   *
   * Without it the rim is simply where the flank stops rising and the crater begins, and from any
   * distance the summit reads as a rounded top. A raised edge is what makes the bowl a bowl - it is
   * the silhouette a viewer recognises - and it costs one gaussian.
   */
  const lip = 1 + 0.09 * Math.exp(-Math.pow((fraction - rim) / 0.07, 2));
  if (fraction >= rim) {
    const climb = (1 - fraction) / (1 - rim);
    // A gentler curve than the first pass used: at 1.7 the flanks stayed almost flat for most of
    // their length and then stood up at the rim, which read as a mesa with a wall around it. At 1.35
    // the slope is continuous, so the mountain is a mountain and the rim is its top rather than its
    // edge.
    return volcano.heightWorld * lean * lip * Math.pow(climb, 1.35);
  }
  const inside = fraction / rim;
  const bowl = 1 - volcano.craterDepthFraction * (1 - inside * inside);
  return volcano.heightWorld * lean * lip * bowl;
}

/** Which band of the volcano a point falls in, or null when it is not on the volcano. */
export function volcanoZoneAt(worldX: number, worldZ: number, volcano: VolcanoShape): VolcanoZone | null {
  const fraction = volcanoRadiusFraction(worldX, worldZ, volcano);
  if (fraction >= 1) return null;
  if (fraction < volcano.rimRadiusFraction) return "CORE";
  return fraction < volcano.steepRadiusFraction ? "SLOPE" : "FOOTHILL";
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
 * Five things combine, and each has a job:
 *
 *   * a smooth, small-amplitude wave field, so the land is never a plane - *gently* rolling rather
 *     than hilly, because the brief for the player-built island is that most of it must read as
 *     usable ground;
 *   * a faint upland bias, so one side of the island is a little higher than the other without
 *     becoming a ridge;
 *   * the volcano, the island's one landmark, which is the only thing here allowed to be tall;
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
  const rolling = shape.reliefWorld * local;
  const volcano = shape.volcano === undefined ? 0 : volcanoHeightAt(worldX, worldZ, shape.volcano);
  const height = (rolling + volcano) * shoreFade * flatMask(worldX, worldZ, shape.flatAreas);
  return height <= FLAT_EPSILON_WORLD ? 0 : height;
}
