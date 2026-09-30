/**
 * The island's shape and its elevation, as pure functions of a world position.
 *
 * Two separate ideas live here, and keeping them apart is what makes the world both natural-looking
 * and safe to play on:
 *
 * 1. `islandRadiusAt` describes *where the land ends*. The island is a superellipse, not a circle:
 *    at exponent 2 it is an ellipse, and as the exponent rises it becomes a rounded rectangle. The
 *    alpha's ellipse cut the corners off the reserved orchard and farmyard, which is why the barn
 *    stood in the sea. The shore is the one shape the drawn island and the walkable island share.
 *
 * 2. `terrainHeightAt` describes *how high the land is*. It is exactly zero on the plateau the
 *    farm occupies and exactly zero at the shore, and it swells gently in the ring between them.
 *    The playable grid is flat by construction: no tile, crop, tree, or step ever samples this,
 *    so elevation is scenery rather than a rule.
 *
 * Both are deterministic functions with no clock, no randomness, and no state, which is what lets
 * the world be asserted in a unit test and rebuilt identically on every refresh.
 */

/** The island's outline: a superellipse centred on the visual bounds' centre. */
export interface IslandShape {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfWidthWorld: number;
  readonly halfDepthWorld: number;
  /** Superellipse exponent. 2 is an ellipse; 4 is a rounded rectangle with cut corners. */
  readonly exponent: number;
}

/** The island's outline plus the shape of the ground inside it. */
export interface TerrainShape extends IslandShape {
  /**
   * The normalised radius - the value `islandRadiusAt` returns - inside which the ground is level.
   *
   * The farm's apron has to be flat, or a plot bought at the edge would sit on a slope. Everything
   * outside this radius is the rolling ring the player looks at but never farms.
   */
  readonly plateauRadius: number;
  /** Height of the tallest hill above the plateau, in world units. */
  readonly reliefWorld: number;
  /**
   * Ground that is kept level whatever the island does around it.
   *
   * Water has to sit level or it runs down the hill, and a building has to sit level or it stands on
   * one corner. Each area is flat inside its own radius and blends back to the natural height over a
   * feather, so the pond is a pond rather than a puddle at the bottom of a slope.
   */
  readonly levelAreas: readonly LevelArea[];
}

/** A disc of ground the terrain holds at zero elevation, with a soft edge. */
export interface LevelArea {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  /** Radius held exactly level. */
  readonly flatRadiusWorld: number;
  /** Distance past it over which the ground returns to its natural height. */
  readonly blendRadiusWorld: number;
}

/**
 * How far a point is from the island's centre, measured in shore units.
 *
 * 0 at the centre, 1 exactly on the shoreline, above 1 once past it. Because it is a superellipse,
 * the same value describes the drawn shore and the walkable one, so the beach cannot drift away
 * from where the character is allowed to stand.
 */
export function islandRadiusAt(worldX: number, worldZ: number, island: IslandShape): number {
  const nx = Math.abs((worldX - island.centerWorldX) / island.halfWidthWorld);
  const nz = Math.abs((worldZ - island.centerWorldZ) / island.halfDepthWorld);
  const power = island.exponent;
  return Math.pow(Math.pow(nx, power) + Math.pow(nz, power), 1 / power);
}

/**
 * A point on the shoreline at angle `angle`, in world metres.
 *
 * The superellipse's own parametrisation, so a mesh built from these points has exactly the outline
 * `islandRadiusAt` measures: `(cos t)^(2/p)` and `(sin t)^(2/p)`.
 */
export function islandRimPoint(
  angle: number,
  island: IslandShape
): { readonly worldX: number; readonly worldZ: number } {
  const exponent = 2 / island.exponent;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = Math.sign(cos) * Math.pow(Math.abs(cos), exponent);
  const z = Math.sign(sin) * Math.pow(Math.abs(sin), exponent);
  return {
    worldX: island.centerWorldX + x * island.halfWidthWorld,
    worldZ: island.centerWorldZ + z * island.halfDepthWorld
  };
}

/** Ground flatter than this is treated as level, so the plateau and the beach do not shimmer. */
const FLAT_EPSILON_WORLD = 0.015;

/**
 * World height of the flat ground surface the props stand on.
 *
 * The tile slabs start at y = 0 and are a little over 9 cm thick, so the grass they sit on has to be
 * just under them. Everything placed on open ground - scenery, landmarks, the barn - is offset by
 * this, which is what keeps a tree on a hill from being planted through the hillside.
 */
export const GROUND_SURFACE_Y = -0.04;

/**
 * How high the ground stands at a world position, in world units above the flat plateau.
 *
 * The profile is a bell across the ring between the plateau and the shore: flat where the farm is,
 * flat again at the waterline, and highest about halfway between. Two low-frequency waves modulate
 * it, so the ring reads as rolling ground with hollows and crests instead of as a single bank. All
 * of it is a closed-form function of the position, so the hills are identical on every client and
 * after every refresh.
 */
export function terrainHeightAt(worldX: number, worldZ: number, shape: TerrainShape): number {
  const radius = islandRadiusAt(worldX, worldZ, shape);
  const span = 1 - shape.plateauRadius;
  if (span <= 0) return 0;
  const outward = (radius - shape.plateauRadius) / span;
  if (outward <= 0 || outward >= 1) return 0;

  const bell = Math.sin(Math.PI * outward);
  const ridge =
    0.55 +
    0.42 * Math.sin(worldX * 0.21 + 1.7) * Math.cos(worldZ * 0.17 - 0.9) +
    0.26 * Math.sin((worldX - worldZ) * 0.11 + 0.4);
  // Never flat-topped and never a knife edge: the ridge keeps its character without either
  // flattening into a plain or spiking into a mountain.
  const local = Math.min(1.25, Math.max(0.55, ridge));
  const height = shape.reliefWorld * bell * local * levelMask(worldX, worldZ, shape.levelAreas);
  return height <= FLAT_EPSILON_WORLD ? 0 : height;
}

/** How much of the natural elevation survives at a point: 0 inside a level area, 1 outside all of them. */
function levelMask(worldX: number, worldZ: number, areas: readonly LevelArea[]): number {
  let mask = 1;
  for (const area of areas) {
    const distance = Math.hypot(worldX - area.centerWorldX, worldZ - area.centerWorldZ);
    if (distance <= area.flatRadiusWorld) return 0;
    if (area.blendRadiusWorld <= 0) continue;
    const t = Math.min(1, (distance - area.flatRadiusWorld) / area.blendRadiusWorld);
    mask = Math.min(mask, t * t * (3 - 2 * t));
  }
  return mask;
}
