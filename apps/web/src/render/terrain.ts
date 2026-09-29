import { Group, Mesh, type Material, type Object3D } from "three";
import type { FarmLayout } from "./layout";
import type { SharedAssets } from "./materials";
import type { FarmWorld, LockedPlotSquare, PondSpec } from "./world";
import { FENCE_THICKNESS_WORLD, fenceGeometry, type FenceGeometry } from "./world-config";

/**
 * Static world geometry: water, island, dirt apron, path, fence, pond, barn, and the fogged squares
 * of land that is still locked.
 *
 * Everything here is a projection of `FarmWorld`, which is itself derived from server land. Nothing
 * decides which land is unlocked; a locked square is drawn only where the server's plot catalogue
 * says the farm does not own it yet.
 */

/** Placeholder slab thickness. Real tile art replaces this rather than describing it. */
export const TILE_THICKNESS = 0.09;

const APRON_TOP_Y = -0.01;
const FENCE_HEIGHT = 0.62;
/** The generated barn is authored with its base on y = 0; the ground under the yard is a hair lower. */
const BARN_FEET_Y = -0.02;

function box(assets: SharedAssets, material: Material, width: number, height: number, depth: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(assets.box, material);
  mesh.scale.set(width, height, depth);
  mesh.position.set(x, y, z);
  return mesh;
}

function addIsland(group: Group, assets: SharedAssets, world: FarmWorld): void {
  const water = new Mesh(assets.circle, assets.waterDeep);
  water.rotation.x = -Math.PI / 2;
  water.scale.set(world.islandHalfWidthWorld * 3.4, world.islandHalfDepthWorld * 3.4, 1);
  water.position.y = -0.62;
  group.add(water);

  const sand = new Mesh(assets.cylinder, assets.sand);
  sand.scale.set(world.islandHalfWidthWorld + 0.55, 0.3, world.islandHalfDepthWorld + 0.55);
  sand.position.y = -0.37;
  group.add(sand);

  const grass = new Mesh(assets.cylinder, assets.grass);
  grass.scale.set(world.islandHalfWidthWorld, 0.3, world.islandHalfDepthWorld);
  grass.position.y = -0.19;
  group.add(grass);
}

/**
 * The dirt apron under the field.
 *
 * Placed where the fence is, not at the world origin: the apron wraps the plots the catalogue can
 * hand out, which is the middle of `FENCE.bounds`, not the middle of the starter plot. Taking the
 * centre from the same derived geometry as the fence is what keeps them from drifting apart.
 */
function addFieldGround(group: Group, assets: SharedAssets, world: FarmWorld, fence: FenceGeometry): void {
  group.add(
    box(
      assets,
      assets.dirt,
      world.apronWidth,
      0.1,
      world.apronDepth,
      fence.centerWorldX,
      APRON_TOP_Y - 0.05,
      fence.centerWorldZ
    )
  );
  if (world.path !== null) {
    group.add(
      box(assets, assets.dirtDark, world.path.widthWorld, 0.1, world.path.depthWorld, world.path.worldX, APRON_TOP_Y - 0.05, world.path.worldZ)
    );
  }
}

function addPond(group: Group, assets: SharedAssets, pond: PondSpec): void {
  const rim = new Mesh(assets.cylinder, assets.sand);
  rim.scale.set(pond.radiusWorldX + 0.5, 0.16, pond.radiusWorldZ + 0.5);
  rim.position.set(pond.worldX, -0.06, pond.worldZ);
  group.add(rim);

  const water = new Mesh(assets.circle, assets.water);
  water.rotation.x = -Math.PI / 2;
  water.scale.set(pond.radiusWorldX, pond.radiusWorldZ, 1);
  water.position.set(pond.worldX, -0.008, pond.worldZ);
  group.add(water);

  for (let index = 0; index < 3; index += 1) {
    const pad = new Mesh(assets.circle, assets.foliage);
    pad.rotation.x = -Math.PI / 2;
    const angle = (index / 3) * Math.PI * 2;
    pad.scale.set(0.28, 0.2, 1);
    pad.position.set(
      pond.worldX + Math.cos(angle) * pond.radiusWorldX * 0.45,
      0.002,
      pond.worldZ + Math.sin(angle) * pond.radiusWorldZ * 0.45
    );
    group.add(pad);
  }
}

/**
 * The farmhouse/barn.
 *
 * The generated model is the barn; the primitives below are the fallback while it loads or if it
 * cannot be loaded at all, which is the same convention the crop and scenery models already follow.
 * The model is cloned, never re-fetched, and its footprint is presentation only: the yard's
 * collision is the canonical `STATIC_OBSTACLES` circle in `world-config.ts`.
 */
function addBarn(group: Group, assets: SharedAssets, world: FarmWorld, model: Object3D | undefined): void {
  if (world.barn === null) return;
  if (model !== undefined) {
    const barn = model.clone(true);
    barn.position.set(world.barn.worldX, BARN_FEET_Y, world.barn.worldZ);
    barn.rotation.y = world.barn.rotationY;
    group.add(barn);
    return;
  }
  const barn = new Group();
  barn.position.set(world.barn.worldX, -0.04, world.barn.worldZ);
  barn.rotation.y = world.barn.rotationY;

  const body = box(assets, assets.barnWall, 2.6, 1.5, 2, 0, 0.75, 0);
  barn.add(body);
  const roof = new Mesh(assets.roof, assets.barnRoof);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(2.15, 0.95, 1.75);
  roof.position.y = 1.95;
  barn.add(roof);
  barn.add(box(assets, assets.barnTrim, 0.9, 1.05, 0.1, 0, 0.52, 1.02));
  barn.add(box(assets, assets.barnTrim, 0.16, 0.5, 0.08, 0.85, 0.95, 1.02));
  barn.add(box(assets, assets.barnTrim, 0.16, 0.5, 0.08, -0.85, 0.95, 1.02));

  const silo = new Mesh(assets.cylinder, assets.barnTrim);
  silo.scale.set(0.45, 1.7, 0.45);
  silo.position.set(1.55, 0.85, -0.55);
  barn.add(silo);
  const siloRoof = new Mesh(assets.cone, assets.barnRoof);
  siloRoof.scale.set(0.55, 0.6, 0.55);
  siloRoof.position.set(1.55, 2, -0.55);
  barn.add(siloRoof);

  group.add(barn);
}

/**
 * The fence: posts and rails along every segment the world config derives.
 *
 * There are no gate numbers here. A gap exists because `fenceGeometry` cut it out of the side, so
 * the drawing cannot disagree with what the player can walk through.
 */
function addFence(group: Group, assets: SharedAssets, fence: FenceGeometry, postSpacing: number): void {
  for (const segment of fence.segments) {
    const horizontal = segment.side === "SOUTH" || segment.side === "NORTH";
    const from = horizontal ? segment.minWorldX : segment.minWorldZ;
    const to = horizontal ? segment.maxWorldX : segment.maxWorldZ;
    const line = horizontal
      ? (segment.minWorldZ + segment.maxWorldZ) / 2
      : (segment.minWorldX + segment.maxWorldX) / 2;
    const length = to - from;
    if (length <= 0) continue;
    const middle = (from + to) / 2;

    for (const height of [0.28, 0.46]) {
      group.add(
        horizontal
          ? box(assets, assets.wood, length, 0.07, FENCE_THICKNESS_WORLD, middle, height, line)
          : box(assets, assets.wood, FENCE_THICKNESS_WORLD, 0.07, length, line, height, middle)
      );
    }

    // Posts every pitch, plus one at each end, so a gate is framed by two posts.
    const spacings = Math.max(1, Math.round(length / postSpacing));
    for (let index = 0; index <= spacings; index += 1) {
      const at = from + (length * index) / spacings;
      group.add(box(assets, assets.wood, 0.1, FENCE_HEIGHT, 0.1, horizontal ? at : line, FENCE_HEIGHT / 2, horizontal ? line : at));
    }
  }
}

function addLockMarker(group: Group, assets: SharedAssets, plot: LockedPlotSquare): void {
  const y = 0.55;
  const body = box(assets, assets.lockMetal, 0.34, 0.28, 0.14, plot.centerWorldX, y, plot.centerWorldZ);
  group.add(body);
  const shackle = new Mesh(assets.torus, assets.lockMetal);
  shackle.scale.set(0.15, 0.15, 0.15);
  shackle.rotation.y = Math.PI / 2;
  shackle.position.set(plot.centerWorldX, y + 0.2, plot.centerWorldZ);
  group.add(shackle);
}

function addLockedPlots(group: Group, assets: SharedAssets, world: FarmWorld): void {
  for (const plot of world.lockedPlots) {
    group.add(box(assets, assets.locked, plot.sizeWorld, 0.07, plot.sizeWorld, plot.centerWorldX, -0.035, plot.centerWorldZ));
    const fog = box(assets, assets.lockedFog, plot.sizeWorld * 0.97, 0.06, plot.sizeWorld * 0.97, plot.centerWorldX, 0.03, plot.centerWorldZ);
    fog.renderOrder = 2;
    group.add(fog);
    addLockMarker(group, assets, plot);
  }
}

export function buildTerrain(
  group: Group,
  assets: SharedAssets,
  world: FarmWorld,
  layout: FarmLayout,
  barnModel?: Object3D
): void {
  // The fence is derived from the world config and the tile pitch, exactly as the player's collision
  // is: one description, drawn here, walked around there.
  const fence = fenceGeometry(layout.pitch);
  addIsland(group, assets, world);
  addFieldGround(group, assets, world, fence);
  addFence(group, assets, fence, layout.pitch);
  if (world.pond !== null) addPond(group, assets, world.pond);
  addBarn(group, assets, world, barnModel);
}

/**
 * The locked-land overlay: the ring of plots the farm does not own yet.
 *
 * Kept out of `buildTerrain` because it is a projection of progression rather than of the static
 * world: buying a plot changes this layer and must leave the island untouched.
 */
export function buildLockedPlotOverlay(group: Group, assets: SharedAssets, world: FarmWorld): void {
  addLockedPlots(group, assets, world);
}
