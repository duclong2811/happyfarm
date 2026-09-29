import type { SceneTile } from "../render/view-model";
import {
  fenceGeometry,
  ISLAND_HALF_DEPTH_WORLD,
  ISLAND_HALF_WIDTH_WORLD,
  STATIC_OBSTACLES,
  type FenceSegment
} from "../render/world-config";
import { PLAYER_RADIUS, type CollisionWorld } from "./controller";

/**
 * What a walking character can and cannot stand on.
 *
 * The world is static and the farm's rows are authoritative, so the two are combined here into the
 * one thing the controller asks about: a signed depth at a point. The result is a plain value with
 * no three, no DOM, and no network, which is why movement can be tested without a canvas.
 *
 * Four sources block a step:
 *
 * 1. The island shore, which the character stays inside.
 * 2. The static obstacles the world config already declares: the pond and the farmhouse yard.
 * 3. The fence, from the same `fenceGeometry` the renderer draws. A drawn gate is a walkable gate.
 * 4. The farm's own rows: a crop or a tree blocks a circle at its centre, and terrain that is not
 *    soil or grass (water today) blocks its whole tile.
 *
 * Everything else is open ground, so the paths, the apron, and the grass between plots are walkable
 * without the client inventing a second map. Nothing here asks who owns a tile or whether a farming
 * action would be allowed on it: walking is presentation, planting is authority, and the two must not
 * be confused. Locked land is not in this list at all, so a character may walk over land the farm has
 * not bought; the only farm rows consulted are the ones that physically occupy ground.
 *
 * Nothing here is authority. The server neither receives nor trusts a position: this only decides
 * where the local avatar is drawn.
 */

/** Half of the drawn 1 x 1 tile slab, so the blocked footprint is the tile the player can see. */
const TILE_BLOCK_HALF_EXTENT_WORLD = 0.5;

/**
 * How wide a planted thing blocks, as a circle at the tile's centre.
 *
 * Not the whole tile: one planted row would then be a solid wall, and no one could walk down their
 * own field. At the shipped 1.08 tile pitch a row of crops leaves a gap the player (radius 0.28) can
 * pass through, while a row of trees does not - which is the difference between a crop and a tree.
 * Placeholder art draws a little wider than these circles; the real models in the art phase get to
 * define their footprint, and only these two numbers would follow it.
 */
const CROP_BLOCK_RADIUS_WORLD = 0.22;
const TREE_BLOCK_RADIUS_WORLD = 0.34;

/**
 * Depth at the island shore: negative well inland, zero on the shore, positive once the player
 * circle hangs over the water.
 *
 * Because the gradient points outward, a character already at the edge may step inland but never
 * further out: the controller's "overlapping may escape, never sink" rule keeps the avatar on the
 * island without a separate clamp.
 */
function islandDepth(x: number, z: number): number {
  const normalisedX = x / ISLAND_HALF_WIDTH_WORLD;
  const normalisedZ = z / ISLAND_HALF_DEPTH_WORLD;
  const radius = Math.hypot(normalisedX, normalisedZ);
  const gradient = Math.hypot(normalisedX / ISLAND_HALF_WIDTH_WORLD, normalisedZ / ISLAND_HALF_DEPTH_WORLD);
  if (gradient === 0) return PLAYER_RADIUS - Math.min(ISLAND_HALF_WIDTH_WORLD, ISLAND_HALF_DEPTH_WORLD);
  // The ellipse's own signed distance, approximated along its normal, keeps the shore smooth
  // instead of stair-stepping with whole tiles.
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

/** Depth of a fence segment, expressed as the rectangle the renderer draws for it. */
function fenceDepth(x: number, z: number, segment: FenceSegment): number {
  return boxDepth(
    x,
    z,
    (segment.minWorldX + segment.maxWorldX) / 2,
    (segment.minWorldZ + segment.maxWorldZ) / 2,
    (segment.maxWorldX - segment.minWorldX) / 2,
    (segment.maxWorldZ - segment.minWorldZ) / 2
  );
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

/** What one farm row contributes to the world: occupancy as circles, terrain as whole tiles. */
function farmBlocks(tiles: readonly SceneTile[]): { readonly circles: readonly BlockCircle[]; readonly boxes: readonly BlockBox[] } {
  const circles: BlockCircle[] = [];
  const boxes: BlockBox[] = [];
  for (const tile of tiles) {
    if (tile.tree !== null) {
      circles.push({ centerWorldX: tile.worldX, centerWorldZ: tile.worldZ, radiusWorld: TREE_BLOCK_RADIUS_WORLD });
    } else if (tile.crop !== null) {
      circles.push({ centerWorldX: tile.worldX, centerWorldZ: tile.worldZ, radiusWorld: CROP_BLOCK_RADIUS_WORLD });
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
 * alone. The dynamic half is whatever the farm currently has in the ground, so a crop that appears
 * under the character starts blocking the next step and a crop that is harvested stops blocking it.
 */
export function createPlayerCollisionWorld(tiles: readonly SceneTile[]): CollisionWorld {
  const fence = fenceGeometry().segments;
  const farm = farmBlocks(tiles);

  return {
    depth(x: number, z: number): number {
      let depth = islandDepth(x, z);
      for (const obstacle of STATIC_OBSTACLES) {
        depth = Math.max(depth, circleDepth(x, z, obstacle.centerWorldX, obstacle.centerWorldZ, obstacle.radiusWorld));
      }
      for (const segment of fence) {
        depth = Math.max(depth, fenceDepth(x, z, segment));
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
    }
  };
}
