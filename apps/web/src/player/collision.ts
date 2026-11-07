import type { SceneTile } from "../render/view-model";
import {
  ISLAND_HALF_DEPTH_WORLD,
  ISLAND_HALF_WIDTH_WORLD,
  ISLAND_SHAPE,
  STATIC_OBSTACLES,
  type WorldObstacle
} from "../render/world-config";
import { islandRadiusAt } from "../render/terrain-height";
import { PLAYER_RADIUS, type CollisionWorld } from "./controller";

/**
 * What a walking character can and cannot stand on.
 *
 * The world is static and the farm's rows are authoritative, so the two are combined here into the
 * one thing the controller asks about: a signed depth at a point. The result is a plain value with
 * no three, no DOM, and no network, which is why movement can be tested without a canvas.
 *
 * Three sources block a step:
 *
 * 1. The island shore, which the character stays inside.
 * 2. The static obstacles the world config already declares: the pond, the barn, and the landmarks.
 * 3. The farm's own rows: agricultural trees block a small circle at their centre, ordinary annual
 *    crops are passable, and terrain that is not soil or grass blocks its whole tile.
 *
 * Everything else is open ground, so the paths, crop rows, apron, and grass between plots are walkable
 * without the client inventing a second map. Nothing here asks who owns a tile or whether a farming
 * action would be allowed on it: walking is presentation, planting is authority, and the two must not
 * be confused. Locked land is not in this list at all, so a character may walk over land the farm has
 * not bought; the only farm rows consulted are the ones that physically occupy ground.
 *
 * V11 removed the last of these - the fence that used to enclose the reserve. It was the strongest
 * visual statement that the farm was a board sitting on the island, and with the island now one
 * coordinate system the field is farmland, not a walled compound. What a walker is kept out of is
 * what is actually solid: a building, a trunk, the sea.
 *
 * Nothing here is authority. The server neither receives nor trusts a position: this only decides
 * where the local avatar is drawn.
 */

/** Half of the drawn 1 x 1 tile slab, so the blocked footprint is the tile the player can see. */
const TILE_BLOCK_HALF_EXTENT_WORLD = 0.5;

/**
 * How wide a planted thing blocks, as a circle at the tile's centre.
 *
 * Ordinary annual crops have no locomotion footprint. Agricultural trees use a small footprint;
 * orchard-vs-forestry classification remains a later data-driven refinement.
 */
const TREE_BLOCK_RADIUS_WORLD = 0.34;

/**
 * Depth at the island shore: negative well inland, zero on the shore, positive once the player
 * circle hangs over the water.
 *
 * The shore is the same superellipse the drawn island uses, centred on the middle of the visual
 * bounds rather than on the world origin (the middle of the starter square). Those are two different
 * points: a farm grows to the south-east of the square it started on, so a shore centred on the
 * square would cut the southern and eastern land the player is supposed to walk on - and an ellipse
 * instead of a superellipse would cut the orchard and the farmyard off the island entirely.
 *
 * Because the gradient points outward, a character already at the edge may step inland but never
 * further out: the controller's "overlapping may escape, never sink" rule keeps the avatar on the
 * island without a separate clamp.
 */
function islandDepth(x: number, z: number): number {
  const radius = islandRadiusAt(x, z, ISLAND_SHAPE);
  // A numerical gradient keeps the superellipse's true normal, so the shore stays smooth whatever
  // the exponent is and there is no second formula to keep in step with the outline.
  const step = 0.01;
  const gradient = Math.hypot(
    (islandRadiusAt(x + step, z, ISLAND_SHAPE) - islandRadiusAt(x - step, z, ISLAND_SHAPE)) / (2 * step),
    (islandRadiusAt(x, z + step, ISLAND_SHAPE) - islandRadiusAt(x, z - step, ISLAND_SHAPE)) / (2 * step)
  );
  if (gradient === 0) return PLAYER_RADIUS - Math.min(ISLAND_HALF_WIDTH_WORLD, ISLAND_HALF_DEPTH_WORLD);
  // The outline's own signed distance, approximated along its normal, keeps the shore smooth instead
  // of stair-stepping with whole tiles.
  return (radius - 1) / gradient + PLAYER_RADIUS;
}

/** Depth of a circle-vs-circle overlap: positive while the player touches or stands inside it. */
function circleDepth(x: number, z: number, centerWorldX: number, centerWorldZ: number, radiusWorld: number): number {
  return PLAYER_RADIUS + radiusWorld - Math.hypot(x - centerWorldX, z - centerWorldZ);
}

/**
 * Depth of a circle-vs-square overlap, using the box's signed distance so the gradient keeps
 * pointing out of the box even when the player is standing on the tile's centre.
 */
function boxDepth(
  x: number,
  z: number,
  centerWorldX: number,
  centerWorldZ: number,
  halfExtentXWorld: number,
  halfExtentZWorld: number
): number {
  const dx = Math.abs(x - centerWorldX) - halfExtentXWorld;
  const dz = Math.abs(z - centerWorldZ) - halfExtentZWorld;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  const inside = Math.min(Math.max(dx, dz), 0);
  return PLAYER_RADIUS - (outside + inside);
}

interface BlockCircle {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly radiusWorld: number;
}

interface BlockBox {
  readonly centerWorldX: number;
  readonly centerWorldZ: number;
  readonly halfExtentXWorld: number;
  readonly halfExtentZWorld: number;
}

/**
 * The terrain a walker has to climb, as the collision world needs it.
 *
 * Circles describe what stands *on* the island; this describes the island. A shore ledge is not an
 * obstacle - there is nothing there - so without this the character would stroll up a cliff face.
 */
export interface TerrainFollow {
  /** The walkable surface at a world position: the same function the mesh and the props stand on. */
  readonly heightAt: (worldX: number, worldZ: number) => number;
  /** The steepest rise a step may climb, in metres of height per metre travelled. */
  readonly maxSlope: number;
  /** A rise at or below this is always walkable, whatever the ratio: a curb, a small bump. */
  readonly maxStepWorld: number;
  /** Optional signed shore depth for a non-home scene; omitted means the canonical home island. */
  readonly depthAt?: (worldX: number, worldZ: number) => number;
}

/**
 * Whether a step is up a slope nobody could walk.
 *
 * Deliberately a *rise* rule and not a physics one. A small rise is always allowed - a lip in the
 * ground, a kerb by the quay - and a larger one is allowed while it stays within `maxSlope`, so the
 * island's ordinary hills are walkable and its cliffs are not. Descending is never blocked: the brief
 * asks that a character cannot climb an impossible face, not that they can never step down one, and
 * blocking descents would strand anyone who walked out along a ridge.
 */
export function slopeBlocks(
  terrain: TerrainFollow,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
): boolean {
  const run = Math.hypot(toX - fromX, toZ - fromZ);
  if (!Number.isFinite(run) || run <= 0) return false;
  const rise = terrain.heightAt(toX, toZ) - terrain.heightAt(fromX, fromZ);
  if (!Number.isFinite(rise) || rise <= terrain.maxStepWorld) return false;
  return rise > terrain.maxSlope * run;
}

/** What one farm row contributes to the world: occupancy as circles, terrain as whole tiles. */
function farmBlocks(tiles: readonly SceneTile[]): { readonly circles: readonly BlockCircle[]; readonly boxes: readonly BlockBox[] } {
  const circles: BlockCircle[] = [];
  const boxes: BlockBox[] = [];
  for (const tile of tiles) {
    if (tile.tree !== null) {
      circles.push({ centerWorldX: tile.worldX, centerWorldZ: tile.worldZ, radiusWorld: TREE_BLOCK_RADIUS_WORLD });
    }
    if (tile.terrainType !== "SOIL" && tile.terrainType !== "GRASS") {
      boxes.push({
        centerWorldX: tile.worldX,
        centerWorldZ: tile.worldZ,
        halfExtentXWorld: TILE_BLOCK_HALF_EXTENT_WORLD,
        halfExtentZWorld: TILE_BLOCK_HALF_EXTENT_WORLD
      });
    }
  }
  return { circles, boxes };
}

/**
 * The collision world for one frame of farm state.
 *
 * The static half - the shore, the pond, the yard, and the fence - is a function of the world config
 * alone. The dynamic half is whatever solid tree the farm currently has in the ground; crop visuals do
 * not alter locomotion collision.
 */
export function createPlayerCollisionWorld(
  tiles: readonly SceneTile[],
  /**
   * Extra circles to walk around, on top of the world's own static obstacles.
   *
   * The player's own objects: a building is as solid as a landmark, and because it can be moved,
   * stored or removed its circle has to come from its row rather than from a list compiled into the
   * world config. That is what stops a collision circle from staying behind when its barn walks away.
   */
  extraObstacles: readonly WorldObstacle[] = [],
  /**
   * The island's own surface, when the caller has it.
   *
   * Optional, and the world is exactly what it was without it: a caller that only wants "may I stand
   * here" (the selection ghost, a test of the circles) leaves it out, and the walking character hands
   * it in so a cliff is a cliff.
   */
  terrain: TerrainFollow | null = null
): CollisionWorld {
  const farm = farmBlocks(tiles);

  return {
    depth(x: number, z: number): number {
      let depth = terrain?.depthAt?.(x, z) ?? islandDepth(x, z);
      for (const obstacle of [...STATIC_OBSTACLES, ...extraObstacles]) {
        depth = Math.max(depth, circleDepth(x, z, obstacle.centerWorldX, obstacle.centerWorldZ, obstacle.radiusWorld));
      }
      for (const circle of farm.circles) {
        depth = Math.max(depth, circleDepth(x, z, circle.centerWorldX, circle.centerWorldZ, circle.radiusWorld));
      }
      for (const box of farm.boxes) {
        depth = Math.max(
          depth,
          boxDepth(x, z, box.centerWorldX, box.centerWorldZ, box.halfExtentXWorld, box.halfExtentZWorld)
        );
      }
      return depth;
    },
    blocked: (fromX: number, fromZ: number, toX: number, toZ: number): boolean =>
      terrain !== null && slopeBlocks(terrain, fromX, fromZ, toX, toZ)
  };
}
