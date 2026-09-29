import { describe, expect, it } from "vitest";
import type { FarmTileDTO } from "@happy-farm/contracts";
import { createPlayerCollisionWorld } from "../../apps/web/src/player/collision";
import { createPlayerState, stepPlayer, type PlayerState } from "../../apps/web/src/player/controller";
import type { InputVector } from "../../apps/web/src/player/input";
import { tileToWorld, worldFrame, type TileCoordinate } from "../../apps/web/src/render/layout";
import type { SceneTile } from "../../apps/web/src/render/view-model";
import {
  FARMHOUSE_WORLD,
  FENCE,
  fenceGeometry,
  isStaticObstacleTile,
  isWaterTile,
  POND_WORLD,
  SPAWN_TILE,
  SPAWN_WORLD,
  STATIC_OBSTACLES,
  type FenceGate,
  type FenceSide
} from "../../apps/web/src/render/world-config";

const frame = worldFrame();
const PITCH = frame.pitch;
const fence = fenceGeometry(PITCH);
const FENCE_SIDES: readonly FenceSide[] = ["SOUTH", "EAST", "NORTH", "WEST"];

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

/** World position of the point on the fence line that a gate opens. */
function gateCenterWorld(gate: FenceGate): { readonly worldX: number; readonly worldZ: number } {
  const center = tileToWorld(
    { x: (FENCE.bounds.minX + FENCE.bounds.maxX) / 2, y: (FENCE.bounds.minY + FENCE.bounds.maxY) / 2 },
    frame
  );
  const alongTile = (gate.from + gate.to) / 2;
  return gate.side === "SOUTH" || gate.side === "NORTH"
    ? {
        worldX: tileToWorld({ x: alongTile, y: 0 }, frame).worldX,
        worldZ: gate.side === "SOUTH" ? center.worldZ + fence.halfDepthWorld : center.worldZ - fence.halfDepthWorld
      }
    : {
        worldX: gate.side === "WEST" ? center.worldX - fence.halfWidthWorld : center.worldX + fence.halfWidthWorld,
        worldZ: tileToWorld({ x: 0, y: alongTile }, frame).worldZ
      };
}

/** A point on the fence line just outside a gate, past the post that frames it. */
function besideGateWorld(gate: FenceGate, distanceWorld: number): { readonly worldX: number; readonly worldZ: number } {
  const center = gateCenterWorld(gate);
  const halfOpening = Math.abs((gate.to - gate.from) / 2) * PITCH;
  const offset = halfOpening + distanceWorld;
  return gate.side === "SOUTH" || gate.side === "NORTH"
    ? { worldX: center.worldX + offset, worldZ: center.worldZ }
    : { worldX: center.worldX, worldZ: center.worldZ + offset };
}

describe("player collision world", () => {
  it("leaves the spawn free on an empty farm and on the starter farm", () => {
    expect(createPlayerCollisionWorld([]).depth(SPAWN_WORLD.worldX, SPAWN_WORLD.worldZ)).toBeLessThanOrEqual(0);
    const starter: SceneTile[] = [];
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) starter.push(sceneTile(x, y));
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
    expect(world.depth(fence.centerWorldX + 60, fence.centerWorldZ)).toBeGreaterThan(0);
    expect(world.depth(fence.centerWorldX - 60, fence.centerWorldZ)).toBeGreaterThan(0);
    expect(world.depth(fence.centerWorldX, fence.centerWorldZ + 60)).toBeGreaterThan(0);
  });

  it("blocks every static obstacle the world config declares", () => {
    const world = createPlayerCollisionWorld([]);
    for (const obstacle of STATIC_OBSTACLES) {
      expect(world.depth(obstacle.centerWorldX, obstacle.centerWorldZ), obstacle.id).toBeGreaterThan(0);
    }
    expect(world.depth(POND_WORLD.worldX, POND_WORLD.worldZ)).toBeGreaterThan(0);
    expect(world.depth(FARMHOUSE_WORLD.worldX, FARMHOUSE_WORLD.worldZ)).toBeGreaterThan(0);
  });

  it("blocks a crop as a circle at the tile centre, not as the whole tile", () => {
    const cropped = sceneTile(4, 3, { occupied: "crop" });
    const world = createPlayerCollisionWorld([cropped]);
    expect(world.depth(cropped.worldX, cropped.worldZ)).toBeGreaterThan(0);
    // Touching the crop is blocked; a step further out is ground the character can stand on again.
    expect(world.depth(cropped.worldX + 0.45, cropped.worldZ)).toBeGreaterThan(0);
    expect(world.depth(cropped.worldX + 0.55, cropped.worldZ)).toBeLessThanOrEqual(0);
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

describe("fence", () => {
  it("derives a closed fence on every side", () => {
    const covered = new Set(fence.segments.map((segment) => segment.side));
    for (const side of FENCE_SIDES) {
      expect(covered.has(side), side).toBe(true);
    }
    for (const segment of fence.segments) {
      expect(segment.maxWorldX, segment.id).toBeGreaterThan(segment.minWorldX);
      expect(segment.maxWorldZ, segment.id).toBeGreaterThan(segment.minWorldZ);
    }
  });

  it("blocks the middle of every segment it draws", () => {
    const world = createPlayerCollisionWorld([]);
    for (const segment of fence.segments) {
      const middleX = (segment.minWorldX + segment.maxWorldX) / 2;
      const middleZ = (segment.minWorldZ + segment.maxWorldZ) / 2;
      expect(world.depth(middleX, middleZ), segment.id).toBeGreaterThan(0);
    }
  });

  it("leaves every configured gate open", () => {
    const world = createPlayerCollisionWorld([]);
    expect(FENCE.gates.length).toBeGreaterThanOrEqual(3);
    for (const gate of FENCE.gates) {
      const center = gateCenterWorld(gate);
      expect(world.depth(center.worldX, center.worldZ), `${gate.side} gate`).toBeLessThanOrEqual(0);
    }
  });

  it("blocks the fence immediately beside every configured gate", () => {
    const world = createPlayerCollisionWorld([]);
    for (const gate of FENCE.gates) {
      const beside = besideGateWorld(gate, 0.3);
      expect(world.depth(beside.worldX, beside.worldZ), `${gate.side} post`).toBeGreaterThan(0);
    }
  });

  it("lets the character walk from the spawn through the south gate into the field", () => {
    // North is -Z. The spawn is south of the fence, in front of the south gate, and this walk ends
    // well inside the field, so the gate is genuinely passable rather than merely "not blocked".
    const reached = walk(SPAWN_WORLD, { x: 0, z: -1 });
    expect(reached.z).toBeLessThan(fence.centerWorldZ + fence.halfDepthWorld - 1);
  });

  it("stops the character at the fence beside that gate", () => {
    const gate = FENCE.gates[0];
    if (gate === undefined) throw new Error("the world config must declare a first gate");
    const beside = besideGateWorld(gate, 0.6);
    const reached = walk({ worldX: beside.worldX, worldZ: SPAWN_WORLD.worldZ }, { x: 0, z: -1 });
    expect(reached.z).toBeGreaterThan(fence.centerWorldZ + fence.halfDepthWorld);
  });
});
