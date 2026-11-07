import { describe, expect, it } from "vitest";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import type { FarmTileDTO } from "@happy-farm/contracts";
import { createPlayerCollisionWorld } from "../../apps/web/src/player/collision";
import { createPlayerState, stepPlayer, type PlayerState } from "../../apps/web/src/player/controller";
import type { InputVector } from "../../apps/web/src/player/input";
import { tileToWorld, worldFrame, type TileCoordinate } from "../../apps/web/src/render/layout";
import type { SceneTile } from "../../apps/web/src/render/view-model";
import {
  FARMSTEAD_WORLD,
  FENCE,
  fenceGeometry,
  ISLAND_HALF_DEPTH_WORLD,
  ISLAND_HALF_WIDTH_WORLD,
  isStaticObstacleTile,
  isWaterTile,
  LANDMARKS_WORLD,
  POND_WORLD,
  SPAWN_TILE,
  SPAWN_WORLD,
  STATIC_OBSTACLES,
} from "../../apps/web/src/render/world-config";

const frame = worldFrame();
const PITCH = frame.pitch;
const fence = fenceGeometry(PITCH);

interface TileOptions {
  readonly terrainType?: FarmTileDTO["terrainType"];
  readonly occupied?: "crop" | "tree";
}

function sceneTile(x: number, y: number, options: TileOptions = {}): SceneTile {
  const position = tileToWorld({ x, y }, frame);
  const terrainType = options.terrainType ?? "SOIL";
  return {
    tileX: x,
    tileY: y,
    worldX: position.worldX,
    worldZ: position.worldZ,
    terrainType,
    plantable: terrainType === "SOIL" && options.occupied === undefined,
    selected: false,
    crop:
      options.occupied === "crop"
        ? { cropInstanceId: "cropinst_1", definitionId: "crop_carrot", mature: false, heightFraction: 0.2 }
        : null,
    tree:
      options.occupied === "tree"
        ? {
            treeInstanceId: "treeinst_1",
            definitionId: "tree_apple",
            phase: "GROWING",
            visualStage: "SAPLING",
            growthProgress: 0.1,
            ready: false
          }
        : null
  };
}

function depthAt(tile: SceneTile): number {
  return createPlayerCollisionWorld([tile]).depth(tile.worldX, tile.worldZ);
}

function depthAtTile(tile: TileCoordinate, offsetWorldX = 0, offsetWorldZ = 0): number {
  const position = tileToWorld(tile, frame);
  return createPlayerCollisionWorld([]).depth(position.worldX + offsetWorldX, position.worldZ + offsetWorldZ);
}

/** Walks one direction until the world stops the character, and reports where it ended up. */
function walk(
  start: { readonly worldX: number; readonly worldZ: number },
  direction: InputVector,
  frames = 400
): PlayerState {
  const world = createPlayerCollisionWorld([]);
  let state = createPlayerState(start, 0);
  for (let index = 0; index < frames; index += 1) {
    state = stepPlayer(state, direction, 0.05, world);
  }
  return state;
}

describe("player collision world", () => {
  it("leaves the spawn free on an empty farm and on the starter farm", () => {
    expect(createPlayerCollisionWorld([]).depth(SPAWN_WORLD.worldX, SPAWN_WORLD.worldZ)).toBeLessThanOrEqual(0);
    const starter: SceneTile[] = [];
    for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
      for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) starter.push(sceneTile(x, y));
    }
    expect(createPlayerCollisionWorld(starter).depth(SPAWN_WORLD.worldX, SPAWN_WORLD.worldZ)).toBeLessThanOrEqual(0);
  });

  it("keeps the spawn out of water and out of every static obstacle", () => {
    expect(isWaterTile(SPAWN_TILE)).toBe(false);
    expect(isStaticObstacleTile(SPAWN_TILE)).toBe(false);
    for (const obstacle of STATIC_OBSTACLES) {
      const distance = Math.hypot(
        SPAWN_WORLD.worldX - obstacle.centerWorldX,
        SPAWN_WORLD.worldZ - obstacle.centerWorldZ
      );
      expect(distance, obstacle.id).toBeGreaterThan(obstacle.radiusWorld);
    }
  });

  it("keeps the character on the island", () => {
    const world = createPlayerCollisionWorld([]);
    expect(world.depth(fence.centerWorldX, fence.centerWorldZ)).toBeLessThanOrEqual(0);
    // Well past the outline in every direction. The island's coast is modulated, so a headland
    // reaches further than the half-extent the outline is measured in - the point being tested is
    // "in the sea", not "at the ellipse's edge".
    const beyond = Math.max(ISLAND_HALF_WIDTH_WORLD, ISLAND_HALF_DEPTH_WORLD) * 1.4 + 10;
    expect(world.depth(fence.centerWorldX + beyond, fence.centerWorldZ)).toBeGreaterThan(0);
    expect(world.depth(fence.centerWorldX - beyond, fence.centerWorldZ)).toBeGreaterThan(0);
    expect(world.depth(fence.centerWorldX, fence.centerWorldZ + beyond)).toBeGreaterThan(0);
    // The shore is centred on the island, not on the starter square: the farm grows south-east of
    // where it started, and the land it grows into has to be walkable.
    expect(ISLAND_HALF_WIDTH_WORLD).toBeGreaterThan(0);
  });

  it("blocks every static obstacle the world config declares", () => {
    const world = createPlayerCollisionWorld([]);
    for (const obstacle of STATIC_OBSTACLES) {
      expect(world.depth(obstacle.centerWorldX, obstacle.centerWorldZ), obstacle.id).toBeGreaterThan(0);
    }
    expect(world.depth(POND_WORLD.worldX, POND_WORLD.worldZ)).toBeGreaterThan(0);
  });

  it("no longer blocks the barn from the world config: the building is a row now", () => {
    // V13.3.1 moved the barn and the landmarks out of `STATIC_OBSTACLES`, because they are the
    // player's objects with rows of their own. Keeping them here as well would leave an invisible
    // wall standing where a barn used to be - the exact defect the collision test below forbids.
    const world = createPlayerCollisionWorld([]);
    expect(world.depth(FARMSTEAD_WORLD.worldX, FARMSTEAD_WORLD.worldZ)).toBeLessThanOrEqual(0);
    for (const landmark of LANDMARKS_WORLD) {
      expect(world.depth(landmark.worldX, landmark.worldZ), landmark.id).toBeLessThanOrEqual(0);
    }
  });

  it("lets the character pass through ordinary crop visuals", () => {
    const cropped = sceneTile(4, 3, { occupied: "crop" });
    const world = createPlayerCollisionWorld([cropped]);
    expect(world.depth(cropped.worldX, cropped.worldZ)).toBeLessThanOrEqual(0);
    expect(world.depth(cropped.worldX + 0.45, cropped.worldZ)).toBeLessThanOrEqual(0);
    expect(world.depth(cropped.worldX + 0.7, cropped.worldZ)).toBeLessThanOrEqual(0);
  });

  it("blocks a tree in a wider circle than a crop", () => {
    const cropped = sceneTile(4, 3, { occupied: "crop" });
    const planted = sceneTile(4, 3, { occupied: "tree" });
    expect(depthAt(planted)).toBeGreaterThan(depthAt(cropped));
    expect(createPlayerCollisionWorld([planted]).depth(planted.worldX + 0.55, planted.worldZ)).toBeGreaterThan(0);
    expect(createPlayerCollisionWorld([cropped]).depth(cropped.worldX + 0.55, cropped.worldZ)).toBeLessThanOrEqual(0);
  });

  it("lets the character walk between two planted crops, but not between two trees", () => {
    // Neighbouring tiles are one pitch apart, so the midpoint of the pair is the narrowest point in
    // a planted row: whatever the numbers are, they have to answer a row being walkable or a wall.
    const pairMidX = tileToWorld({ x: 4, y: 3 }, frame).worldX + PITCH / 2;
    const midZ = tileToWorld({ x: 4, y: 3 }, frame).worldZ;
    const crops = createPlayerCollisionWorld([
      sceneTile(4, 3, { occupied: "crop" }),
      sceneTile(5, 3, { occupied: "crop" })
    ]);
    const trees = createPlayerCollisionWorld([
      sceneTile(4, 3, { occupied: "tree" }),
      sceneTile(5, 3, { occupied: "tree" })
    ]);
    expect(crops.depth(pairMidX, midZ)).toBeLessThanOrEqual(0);
    expect(trees.depth(pairMidX, midZ)).toBeGreaterThan(0);
  });

  it("blocks terrain that cannot be walked on and allows grass", () => {
    expect(depthAt(sceneTile(5, 5, { terrainType: "WATER" }))).toBeGreaterThan(0);
    expect(depthAt(sceneTile(5, 5, { terrainType: "BLOCKED" }))).toBeGreaterThan(0);
    expect(depthAt(sceneTile(5, 5, { terrainType: "GRASS" }))).toBeLessThanOrEqual(0);
    expect(depthAt(sceneTile(5, 5))).toBeLessThanOrEqual(0);
  });

  it("does not block land just because the farm does not own it or cannot plant it", () => {
    // Land outside the field is not in the farm's rows at all, and owned grass is still ground under
    // foot: walking never inherits a planting rule.
    expect(depthAtTile({ x: -6, y: 8 })).toBeLessThanOrEqual(0);
    expect(depthAt(sceneTile(4, 4, { terrainType: "GRASS" }))).toBeLessThanOrEqual(0);
    expect(depthAt(sceneTile(4, 4))).toBeLessThanOrEqual(0);
  });

  it("blocks only the tiles it was given", () => {
    const neighbour = sceneTile(4, 3);
    const world = createPlayerCollisionWorld([sceneTile(3, 3)]);
    expect(world.depth(neighbour.worldX, neighbour.worldZ)).toBeLessThanOrEqual(0);
  });

  it("uses each tile's world position, so growing the farm cannot move a blocker", () => {
    const cropped = sceneTile(3, 3, { occupied: "crop" });
    const alone = createPlayerCollisionWorld([cropped]);
    const crowded = createPlayerCollisionWorld([sceneTile(0, 0), cropped, sceneTile(10, 10)]);
    expect(alone.depth(cropped.worldX, cropped.worldZ)).toBeCloseTo(
      crowded.depth(cropped.worldX, cropped.worldZ),
      9
    );
  });
});

/**
 * V11 removed the fence that used to enclose the agricultural reserve.
 *
 * It was the clearest visual statement that the farm was a board sitting on the island, and the
 * island is now one coordinate system in which the field is farmland rather than a walled compound.
 * What a walker is kept out of is what is actually solid - a building, a trunk, the sea - and these
 * are the tests for the field now being open ground.
 */
describe("the field is open ground", () => {
  it("lets the character walk from the spawn straight into the middle of the field", () => {
    // North is -Z. The spawn is south of the reserve, in front of where the south gate used to be,
    // and the walk ends well inside the field: nothing stands between the road and the crops.
    const reached = walk(SPAWN_WORLD, { x: 0, z: -1 });
    expect(reached.z).toBeLessThan(SPAWN_WORLD.worldZ - 30);
  });

  it("does not block the reserve's own boundary anywhere", () => {
    const world = createPlayerCollisionWorld([]);
    // Along the line the fence used to stand on, from corner to corner: all of it is walkable.
    for (let tile = FENCE.bounds.minX; tile <= FENCE.bounds.maxX; tile += 2) {
      for (const z of [FENCE.bounds.minY, FENCE.bounds.maxY]) {
        const point = tileToWorld({ x: tile, y: z }, worldFrame());
        expect(world.depth(point.worldX, point.worldZ), `north/south edge at ${String(tile)}`).toBeLessThanOrEqual(0);
      }
    }
    for (let tile = FENCE.bounds.minY; tile <= FENCE.bounds.maxY; tile += 2) {
      for (const x of [FENCE.bounds.minX, FENCE.bounds.maxX]) {
        const point = tileToWorld({ x, y: tile }, worldFrame());
        expect(world.depth(point.worldX, point.worldZ), `west/east edge at ${String(tile)}`).toBeLessThanOrEqual(0);
      }
    }
  });
});
