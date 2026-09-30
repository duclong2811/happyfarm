import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D
} from "three";
import { tileToWorld, worldFrame, type FarmLayout } from "./layout";
import type { SharedAssets } from "./materials";
import {
  districtOutlineScale,
  type FarmWorld,
  type LockedPlotSquare,
  type MeadowSpec,
  type PondSpec,
  type RoadSpec
} from "./world";
import { GROUND_SURFACE_Y, islandRadiusAt, islandRimPoint, terrainHeightAt, type TerrainShape } from "./terrain-height";
import {
  DISTRICTS,
  FENCE_THICKNESS_WORLD,
  TERRAIN_SHAPE,
  fenceGeometry,
  type FenceGeometry
} from "./world-config";
import { buildLandmarks } from "./landmarks";
import { buildScenery } from "./scenery";

/**
 * The static world's geometry: the island and its elevation, the beach and the shallows, the field's
 * apron, the meadow patches, the fence, the pond, the barn, the landmarks, and the treatment of the
 * land the farm has not bought yet.
 *
 * Everything here is a projection of `FarmWorld`, which is itself derived from server land plus the
 * static world config. Nothing decides which land is unlocked: a locked square is drawn only where the
 * server's plot catalogue says the farm does not own it yet.
 */

/** Placeholder slab thickness. Real tile art replaces this rather than describing it. */
export const TILE_THICKNESS = 0.09;

const APRON_TOP_Y = -0.01;
/**
 * Top of the darker soil bed that sits under the whole reserved field.
 *
 * The tile slabs stand on it and the gaps between them show it, so the pitch between tiles reads as
 * a furrow line rather than as a seam between two floating boxes. It is a hair under the slabs' own
 * base, so it never pokes through them.
 */
const FIELD_BED_TOP_Y = -0.004;
const FENCE_HEIGHT = 0.62;
/** The generated barn is authored with its base on y = 0; the ground under the yard is a hair lower. */
const BARN_FEET_Y = -0.02;
/** Top of the island's ground surface where it is flat: level with the old grass slab. */
const ISLAND_TOP_Y = GROUND_SURFACE_Y;
/** How far the beach reaches past the ground surface, in world metres. */
const BEACH_MARGIN_WORLD = 0.6;
/** How much of a patch's own height it is lifted by, so it does not fight the ground it lies on. */
const PATCH_LIFT_WORLD = 0.02;
/** Rings and sectors of the island's ground mesh. Enough for a smooth shoreline, one draw call. */
const ISLAND_RINGS = 14;
const ISLAND_SECTORS = 96;

function box(assets: SharedAssets, material: Material, width: number, height: number, depth: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(assets.box, material);
  mesh.scale.set(width, height, depth);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * A radial ground surface whose outline is `rimAt` and whose elevation is `heightAt`.
 *
 * One geometry builder serves the island (a superellipse) and every meadow patch (an ellipse), so the
 * two cannot disagree about what the ground does: both sample the same `terrainHeightAt` the props
 * are placed against. Vertex colours come from `colorAt`, which is how the island gets its drier
 * hilltops without a second material.
 */
function radialSurface(options: {
  readonly rings: number;
  readonly sectors: number;
  readonly rimAt: (angle: number) => { readonly x: number; readonly z: number };
  readonly translate: (x: number, z: number) => { readonly worldX: number; readonly worldZ: number };
  readonly heightAt: (worldX: number, worldZ: number) => number;
  readonly colorAt?: (worldX: number, worldZ: number, height: number) => Color;
}): BufferGeometry {
  const { rings, sectors } = options;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  function push(angle: number, radiusFraction: number): number {
    const rim = options.rimAt(angle);
    const world = options.translate(rim.x * radiusFraction, rim.z * radiusFraction);
    const height = options.heightAt(world.worldX, world.worldZ);
    positions.push(world.worldX, height, world.worldZ);
    const color = options.colorAt?.(world.worldX, world.worldZ, height);
    if (color !== undefined) colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  }

  // Ring 0 is the single centre vertex; every later ring carries `sectors` vertices.
  const centre = options.translate(0, 0);
  positions.push(centre.worldX, options.heightAt(centre.worldX, centre.worldZ), centre.worldZ);
  const centreColor = options.colorAt?.(centre.worldX, centre.worldZ, options.heightAt(centre.worldX, centre.worldZ));
  if (centreColor !== undefined) colors.push(centreColor.r, centreColor.g, centreColor.b);

  for (let ring = 1; ring <= rings; ring += 1) {
    const fraction = ring / rings;
    for (let sector = 0; sector < sectors; sector += 1) {
      push((sector / sectors) * Math.PI * 2, fraction);
    }
  }

  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    // Wound so the outward normal is up: centre, next, current.
    indices.push(0, 1 + next, 1 + sector);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * sectors;
    const outer = 1 + ring * sectors;
    for (let sector = 0; sector < sectors; sector += 1) {
      const next = (sector + 1) % sectors;
      indices.push(inner + sector, outer + next, outer + sector);
      indices.push(inner + sector, inner + next, outer + next);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  if (colors.length === positions.length) {
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flat-topped prism whose plan is `rimAt`, for the island's beach and the skirt under its edge.
 *
 * A scaled cylinder would be a circle, and the island is not one; building it from the same outline
 * the collision world tests is what keeps the visible beach on the walkable shore.
 */
function prismGeometry(options: {
  readonly sectors: number;
  readonly rimAt: (angle: number) => { readonly x: number; readonly z: number };
  readonly translate: (x: number, z: number) => { readonly worldX: number; readonly worldZ: number };
  readonly topY: number;
  readonly bottomY: number;
}): BufferGeometry {
  const { sectors, topY, bottomY } = options;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let sector = 0; sector < sectors; sector += 1) {
    const rim = options.rimAt((sector / sectors) * Math.PI * 2);
    const world = options.translate(rim.x, rim.z);
    positions.push(world.worldX, topY, world.worldZ);
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    const rim = options.rimAt((sector / sectors) * Math.PI * 2);
    const world = options.translate(rim.x, rim.z);
    positions.push(world.worldX, bottomY, world.worldZ);
  }

  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    const top = sector;
    const topNext = next;
    const bottom = sectors + sector;
    const bottomNext = sectors + next;
    // Top cap: a fan from the first rim vertex, wound so the normal points up.
    if (sector >= 1 && sector < sectors - 1) indices.push(0, next, top);
    // Side wall, wound outward.
    indices.push(top, bottomNext, bottom);
    indices.push(top, topNext, bottomNext);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flat band between two scales of one outline: the wet sand at the waterline.
 *
 * The island's beach is a solid prism and its ground is a surface; this is the thin third piece in
 * between, and it has to be a ring rather than a disc or it would paint over the whole island.
 */
function rimBandGeometry(options: {
  readonly sectors: number;
  readonly rimAt: (angle: number) => { readonly x: number; readonly z: number };
  readonly translate: (x: number, z: number) => { readonly worldX: number; readonly worldZ: number };
  readonly innerScale: number;
  readonly outerScale: number;
  readonly y: number;
}): BufferGeometry {
  const { sectors, innerScale, outerScale, y } = options;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const scale of [innerScale, outerScale]) {
    for (let sector = 0; sector < sectors; sector += 1) {
      const rim = options.rimAt((sector / sectors) * Math.PI * 2);
      const world = options.translate(rim.x * scale, rim.z * scale);
      positions.push(world.worldX, y, world.worldZ);
    }
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    const inner = sector;
    const innerNext = next;
    const outer = sectors + sector;
    const outerNext = sectors + next;
    indices.push(inner, outerNext, outer);
    indices.push(inner, innerNext, outerNext);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The island's outline at `angle`, relative to its centre. */
function islandRim(terrain: TerrainShape): (angle: number) => { readonly x: number; readonly z: number } {
  const rim = (angle: number): { readonly x: number; readonly z: number } => {
    const point = islandRimPoint(angle, terrain);
    return { x: point.worldX - terrain.centerWorldX, z: point.worldZ - terrain.centerWorldZ };
  };
  return rim;
}

/**
 * The island's ground palette.
 *
 * Three greens and one sand, and the *shore* is what the sand is for. An earlier version blended
 * toward the sand colour by height, which sounded reasonable and was not: almost every point on the
 * island is above the first metre, so the higher two thirds of the island came out the colour of a
 * beach and the estate view read as a dune with a field painted on it. Distance to the waterline is
 * what the sand should follow, and it is a value this module already has.
 */
const GROUND_GREEN = new Color(0x74bd58);
const HILL_GREEN = new Color(0x86c15f);
const SHORE_SAND = new Color(0xd9c795);
function islandGroundGeometry(terrain: TerrainShape): BufferGeometry {
  const relief = Math.max(terrain.reliefWorld, 0.001);
  return radialSurface({
    rings: ISLAND_RINGS,
    sectors: ISLAND_SECTORS,
    rimAt: islandRim(terrain),
    translate: (x, z) => ({ worldX: terrain.centerWorldX + x, worldZ: terrain.centerWorldZ + z }),
    heightAt: (worldX, worldZ) => ISLAND_TOP_Y + terrainHeightAt(worldX, worldZ, terrain),
    colorAt: (worldX, worldZ, height) => {
      const rise = height / relief;
      // Hills read as drier grass, not as sand: a third of the way toward the hill green at the very
      // top of the relief, and never further.
      const colour = GROUND_GREEN.clone().lerp(HILL_GREEN, Math.min(1, Math.max(0, rise)) * 0.35);
      // Sand in the last of the island, measured along the same outline the beach is built from.
      const shore = Math.min(1, Math.max(0, (islandRadiusAt(worldX, worldZ, terrain) - 0.9) / 0.1));
      return colour.lerp(SHORE_SAND, shore * 0.6);
    }
  });
}

function islandBeachGeometry(terrain: TerrainShape, marginWorld: number, topY: number, bottomY: number): BufferGeometry {
  const expand = 1 + marginWorld / Math.max(terrain.halfWidthWorld, 0.001);
  return prismGeometry({
    sectors: ISLAND_SECTORS,
    rimAt: islandRim(terrain),
    translate: (x, z) => ({ worldX: terrain.centerWorldX + x * expand, worldZ: terrain.centerWorldZ + z * expand }),
    topY,
    bottomY
  });
}

/**
 * The island: a shallow sea, a beach, a skirt, and the displaced ground surface on top.
 *
 * The elevation lives entirely in the surface. The beach and the skirt are prisms built from the same
 * outline, so the silhouette is solid from the side and the waterline follows the shape the collision
 * world uses rather than a circle that only approximates it.
 */
function addIsland(group: Group, assets: SharedAssets, world: FarmWorld): void {
  const terrain = world.terrain;

  const water = new Mesh(assets.circle, assets.waterDeep);
  water.rotation.x = -Math.PI / 2;
  water.scale.set(world.islandHalfWidthWorld * 3.6, world.islandHalfDepthWorld * 3.6, 1);
  water.position.set(terrain.centerWorldX, -0.62, terrain.centerWorldZ);
  group.add(water);

  const beach = new Mesh(islandBeachGeometry(terrain, BEACH_MARGIN_WORLD, ISLAND_TOP_Y - 0.18, -0.82), assets.sand);
  group.add(beach);

  const skirt = new Mesh(islandBeachGeometry(terrain, 0, ISLAND_TOP_Y - 0.005, -0.5), assets.grass);
  group.add(skirt);

  const ground = new Mesh(islandGroundGeometry(terrain), assets.terrainGrass);
  ground.receiveShadow = true;
  group.add(ground);

  // A darker band a little inside the waterline: the wet sand the tide leaves behind.
  const wetRim = new Mesh(
    rimBandGeometry({
      sectors: ISLAND_SECTORS,
      rimAt: islandRim(terrain),
      translate: (x, z) => ({ worldX: terrain.centerWorldX + x, worldZ: terrain.centerWorldZ + z }),
      innerScale: 0.955,
      outerScale: 1,
      y: ISLAND_TOP_Y + 0.006
    }),
    assets.wetSand
  );
  group.add(wetRim);
}

/**
 * The dirt apron under the field, and the darker bed under the tiles themselves.
 *
 * Placed where the fence is, not at the world origin: the apron wraps the plots the catalogue can
 * hand out, which is the middle of `FENCE.bounds`, not the middle of the starter plot. Taking the
 * centre from the same derived geometry as the fence is what keeps them from drifting apart.
 */
function addFieldGround(group: Group, assets: SharedAssets, world: FarmWorld): void {
  if (world.apron !== null) {
    // Top at the apron level, thick enough to stand proud of the grass on every side.
    group.add(
      box(assets, assets.dirt, world.apron.widthWorld, 0.3, world.apron.depthWorld, world.apron.worldX, APRON_TOP_Y - 0.15, world.apron.worldZ)
    );
  }
  if (world.bed !== null) {
    group.add(
      box(assets, assets.dirtDark, world.bed.widthWorld, 0.02, world.bed.depthWorld, world.bed.worldX, FIELD_BED_TOP_Y - 0.01, world.bed.worldZ)
    );
  }
}

/**
 * The road network, as ribbons on the ground.
 *
 * Each road arrives already resampled into a terrain-following centreline, so all this has to do is
 * offset every sample by half the road's width and stitch the offsets into a strip. Roads are the
 * map's explanation - the primary road is the way to the harbour, the secondary roads are the ways to
 * work - which is why they are drawn as one continuous surface rather than as a set of decals.
 */
function roadGeometry(roads: readonly RoadSpec[]): { readonly major: BufferGeometry; readonly minor: BufferGeometry } {
  const majorPositions: number[] = [];
  const majorIndices: number[] = [];
  const minorPositions: number[] = [];
  const minorIndices: number[] = [];

  for (const road of roads) {
    const positions = road.kind === "PATH" ? minorPositions : majorPositions;
    const indices = road.kind === "PATH" ? minorIndices : majorIndices;
    const half = road.widthWorld / 2;
    const base = positions.length / 3;
    const count = road.samples.length;
    for (let index = 0; index < count; index += 1) {
      const sample = road.samples[index];
      const previous = road.samples[index - 1] ?? sample;
      const next = road.samples[index + 1] ?? sample;
      if (sample === undefined || previous === undefined || next === undefined) continue;
      const tangentX = next.worldX - previous.worldX;
      const tangentZ = next.worldZ - previous.worldZ;
      const length = Math.hypot(tangentX, tangentZ);
      // A zero-length step would put both edges on the centreline and collapse the strip.
      const normalX = length === 0 ? 0 : -tangentZ / length;
      const normalZ = length === 0 ? 1 : tangentX / length;
      positions.push(sample.worldX + normalX * half, sample.worldY, sample.worldZ + normalZ * half);
      positions.push(sample.worldX - normalX * half, sample.worldY, sample.worldZ - normalZ * half);
    }
    for (let index = 0; index < count - 1; index += 1) {
      const left = base + index * 2;
      const right = left + 1;
      const nextLeft = left + 2;
      const nextRight = left + 3;
      // Wound so the strip's normal is up: left, next right, right / left, next left, next right.
      indices.push(left, nextRight, right);
      indices.push(left, nextLeft, nextRight);
    }
  }

  return {
    major: ribbonGeometry(majorPositions, majorIndices),
    minor: ribbonGeometry(minorPositions, minorIndices)
  };
}

function ribbonGeometry(positions: readonly number[], indices: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex([...indices]);
  geometry.computeVertexNormals();
  return geometry;
}

function addRoads(group: Group, assets: SharedAssets, world: FarmWorld): void {
  if (world.roads.length === 0) return;
  const { major, minor } = roadGeometry(world.roads);
  const majorMesh = new Mesh(major, assets.road);
  majorMesh.receiveShadow = true;
  group.add(majorMesh);
  if (world.roads.some((road) => road.kind === "PATH")) {
    const minorMesh = new Mesh(minor, assets.roadMinor);
    minorMesh.receiveShadow = true;
    group.add(minorMesh);
  } else {
    minor.dispose();
  }
}

/**
 * The largest scale at which a whole ground patch still stands on the island.
 *
 * A district or a meadow is drawn as a blob centred where its function is, and a blob near the coast
 * reaches past the waterline - where the ground mesh has already faded to nothing, so the patch hangs
 * over the sea as a floating sheet of colour. Shrinking the whole patch is the fix, rather than
 * dragging its rim vertices inland one at a time: a per-vertex clamp leaves the outline smooth where
 * the patch was inside the shore and ragged where it was not, which reads as a rendering fault rather
 * than as an edge. The test uses the same `islandRadiusAt` the coastline, the beach, and collision
 * use, so a patch that passes here cannot be over water.
 */
function inlandScale(
  centerWorldX: number,
  centerWorldZ: number,
  radiusWorldX: number,
  radiusWorldZ: number,
  terrain: TerrainShape,
  inside = 0.985
): number {
  for (let scale = 1; scale >= 0.32; scale -= 0.04) {
    let allInland = true;
    for (let sector = 0; sector < 24; sector += 1) {
      const angle = (sector / 24) * Math.PI * 2;
      const worldX = centerWorldX + Math.cos(angle) * radiusWorldX * scale;
      const worldZ = centerWorldZ + Math.sin(angle) * radiusWorldZ * scale;
      if (islandRadiusAt(worldX, worldZ, terrain) > inside) {
        allInland = false;
        break;
      }
    }
    if (allInland) return scale;
  }
  return 0.32;
}

/** The material a terrain patch is drawn in. Colour only; nothing reads it back. */
function meadowMaterial(assets: SharedAssets, kind: MeadowSpec["kind"]): MeshStandardMaterial {
  switch (kind) {
    case "MEADOW":
      return assets.meadow;
    case "DIRT":
      // Muted earth rather than the apron's working brown: this is ground nobody has touched, and it
      // must not read as a second dirt road.
      return assets.bareEarth;
    case "SAND":
      return assets.sand;
  }
}

/**
 * Terrain variation outside the field: meadow, bare earth, and shore.
 *
 * Each patch is a disc of the same displaced ground the island is made of, lifted a hair so it paints
 * over the grass. Because it follows the elevation instead of sitting flat on top of it, a patch that
 * spans a slope hugs the slope - which is what stops the outer ring from looking painted on.
 */
function addMeadows(group: Group, assets: SharedAssets, world: FarmWorld): void {
  const terrain = world.terrain;
  for (const patch of world.meadows) {
    const scale = inlandScale(patch.worldX, patch.worldZ, patch.radiusWorldX, patch.radiusWorldZ, terrain);
    const geometry = radialSurface({
      rings: 4,
      sectors: 28,
      rimAt: (angle) => {
        const local = {
          x: Math.cos(angle) * patch.radiusWorldX * scale,
          z: Math.sin(angle) * patch.radiusWorldZ * scale
        };
        const cos = Math.cos(patch.rotationY);
        const sin = Math.sin(patch.rotationY);
        return { x: local.x * cos - local.z * sin, z: local.x * sin + local.z * cos };
      },
      translate: (x, z) => ({ worldX: patch.worldX + x, worldZ: patch.worldZ + z }),
      heightAt: (worldX, worldZ) => ISLAND_TOP_Y + terrainHeightAt(worldX, worldZ, terrain) + PATCH_LIFT_WORLD
    });
    const mesh = new Mesh(geometry, meadowMaterial(assets, patch.kind));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * The pond: a sandy bank with water standing inside it.
 *
 * The order of the layers is the whole job. The bank is a solid disc whose top face is the ring of
 * sand around the water, so the water has to be drawn *above* it - the alpha drew the rim as a
 * cylinder that reached higher than the water disc, which is why the pond read as a bare patch of
 * sand. The terrain holds this ground level, so none of these heights depend on the hills around it.
 */
function addPond(group: Group, assets: SharedAssets, pond: PondSpec): void {
  // A pond with an outline of its own rather than a scaled circle: the lobed rim is the same trick the
  // district patches use, and it is the difference between a pond and a blue sticker on the grass.
  //
  // Two low harmonics and a finer mesh, because a lake's edge is a curve and not a scallop: the first
  // version reused the district outline, whose three- and five-lobed terms turn a bank this size into
  // a starburst.
  const lobe = (angle: number, scale: number): { readonly x: number; readonly z: number } => {
    const shape = 1 + 0.08 * Math.sin(2 * angle + 1.7) + 0.05 * Math.sin(3 * angle - 0.4);
    return {
      x: Math.cos(angle) * pond.radiusWorldX * scale * shape,
      z: Math.sin(angle) * pond.radiusWorldZ * scale * shape
    };
  };
  const around = (scale: number, lift: number, rings: number): BufferGeometry =>
    radialSurface({
      rings,
      sectors: 48,
      rimAt: (angle) => lobe(angle, scale),
      translate: (x, z) => ({ worldX: pond.worldX + x, worldZ: pond.worldZ + z }),
      heightAt: () => ISLAND_TOP_Y + lift
    });

  const bank = new Mesh(around(1.3, -0.02, 2), assets.sand);
  bank.receiveShadow = true;
  group.add(bank);

  const shallow = new Mesh(around(1.06, 0.016, 2), assets.wetSand);
  group.add(shallow);

  const water = new Mesh(around(1, 0.022, 2), assets.water);
  group.add(water);

  const deep = new Mesh(around(0.6, 0.026, 2), assets.waterDeep);
  group.add(deep);

  // Reeds at the water's edge and one small wooden platform, so the pond reads as a place the island
  // uses rather than as water that happens to be there.
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2 + 0.3;
    const reed = new Mesh(assets.cone, assets.foliage);
    const edge = lobe(angle, 1.14);
    reed.position.set(pond.worldX + edge.x, ISLAND_TOP_Y + 0.16, pond.worldZ + edge.z);
    reed.scale.set(0.12, 0.34, 0.12);
    reed.rotation.z = (index % 3 - 1) * 0.12;
    group.add(reed);
  }
  const platform = new Mesh(assets.box, assets.stakeWood);
  const mooring = lobe(Math.PI * 0.25, 1.02);
  platform.position.set(pond.worldX + mooring.x, ISLAND_TOP_Y + 0.05, pond.worldZ + mooring.z);
  platform.scale.set(0.9, 0.1, 0.9);
  platform.rotation.y = Math.PI * 0.2;
  group.add(platform);

  for (let index = 0; index < 3; index += 1) {
    const pad = new Mesh(assets.circle, assets.foliage);
    pad.rotation.x = -Math.PI / 2;
    const angle = (index / 3) * Math.PI * 2;
    pad.scale.set(0.28, 0.2, 1);
    pad.position.set(
      pond.worldX + Math.cos(angle) * pond.radiusWorldX * 0.45,
      ISLAND_TOP_Y + 0.03,
      pond.worldZ + Math.sin(angle) * pond.radiusWorldZ * 0.45
    );
    group.add(pad);
  }
}

/**
 * The fishery's cages: floating frames with a net, in the bay outside the harbour.
 *
 * They are placed from the island's outline, so "in water" is true by construction rather than by
 * hand-picked coordinates that the next coastline change would invalidate. The water's own level is
 * what they float on, so nothing hovers and nothing sinks.
 */
function addAquaculture(
  group: Group,
  assets: SharedAssets,
  cages: FarmWorld["aquaculture"]
): void {
  const waterline = -0.56;
  for (const [index, cage] of cages.entries()) {
    const holder = new Group();
    holder.position.set(cage.worldX, waterline, cage.worldZ);
    holder.rotation.y = index % 2 === 0 ? 0 : Math.PI / 2;
    const size = cage.radiusWorld;

    // The net: a translucent square just under the surface, so the cage reads as a cage.
    const net = new Mesh(assets.box, assets.water);
    net.scale.set(size * 1.7, 0.06, size * 1.7);
    net.position.y = -0.06;
    holder.add(net);

    // Four floats and four railings, which is the whole structure a cage needs to be legible.
    for (const x of [-size / 2, size / 2]) {
      for (const z of [-size / 2, size / 2]) {
        const float = new Mesh(assets.sphere, assets.millBlade);
        float.position.set(x, 0.12, z);
        float.scale.setScalar(0.22);
        holder.add(float);
      }
    }
    for (const offset of [-size / 2, size / 2]) {
      holder.add(rail(assets, 0, offset, size, true));
      holder.add(rail(assets, offset, 0, size, false));
    }
    group.add(holder);
  }
}

/** One side of a cage's railing: a single floating beam. */
function rail(assets: SharedAssets, x: number, z: number, size: number, alongX: boolean): Mesh {
  const beam = new Mesh(assets.box, assets.stakeWood);
  beam.position.set(x, 0.16, z);
  beam.scale.set(alongX ? size : 0.1, 0.1, alongX ? 0.1 : size);
  return beam;
}

/**
 * The settlement's square.
 *
 * A compact, slightly irregular paved surface with a grass edge, not a stone slab: the buildings face
 * onto it, the streets arrive at its corners, and the material is the road's palette in a different
 * surface - which is what makes the town read as a place rather than as buildings that happen to be
 * near each other. Its outline is lobed from its own id, so no edge of it is a straight line.
 */
function addPlaza(group: Group, assets: SharedAssets, plaza: FarmWorld["plaza"]): void {
  const lobe = (angle: number, scale: number): { readonly x: number; readonly z: number } => {
    const shape = districtOutlineScale(angle, 2.4);
    const local = {
      x: Math.cos(angle) * plaza.radiusWorldX * scale * shape,
      z: Math.sin(angle) * plaza.radiusWorldZ * scale * shape
    };
    const cos = Math.cos(plaza.rotationY);
    const sin = Math.sin(plaza.rotationY);
    return { x: local.x * cos - local.z * sin, z: local.x * sin + local.z * cos };
  };
  const pavement = (scale: number, lift: number, material: MeshStandardMaterial): Mesh => {
    const mesh = new Mesh(
      radialSurface({
        rings: 3,
        sectors: 30,
        rimAt: (angle) => lobe(angle, scale),
        translate: (x, z) => ({ worldX: plaza.worldX + x, worldZ: plaza.worldZ + z }),
        heightAt: () => ISLAND_TOP_Y + lift
      }),
      material
    );
    mesh.receiveShadow = true;
    return mesh;
  };

  group.add(pavement(1.16, -0.015, assets.pasture));
  group.add(pavement(1, -0.006, assets.plaza));

  // A couple of crates and a bench around the square, which is what a market square actually has
  // lying about on it. Nothing here is a rule: the market stall, the well and the farmhouse are the
  // landmarks, and this is the floor they stand on.
  for (const [index, angle] of [0.4, 2.5, 4.4].entries()) {
    const edge = lobe(angle, 0.86);
    const crate = box(assets, assets.stakeWood, 0.5, 0.5, 0.5, plaza.worldX + edge.x, ISLAND_TOP_Y + 0.25, plaza.worldZ + edge.z);
    crate.rotation.y = angle + index;
    crate.castShadow = true;
    group.add(crate);
  }
  for (const side of [-1, 1]) {
    const seat = box(
      assets,
      assets.timber,
      1.5,
      0.12,
      0.4,
      plaza.worldX + plaza.radiusWorldX * 0.55 * side,
      ISLAND_TOP_Y + 0.34,
      plaza.worldZ + plaza.radiusWorldZ * 0.5
    );
    seat.rotation.y = plaza.rotationY;
    seat.castShadow = true;
    group.add(seat);
    for (const end of [-0.6, 0.6]) {
      group.add(
        box(
          assets,
          assets.timber,
          0.12,
          0.34,
          0.3,
          plaza.worldX + plaza.radiusWorldX * 0.55 * side + end,
          ISLAND_TOP_Y + 0.17,
          plaza.worldZ + plaza.radiusWorldZ * 0.5
        )
      );
    }
  }
}

/**
 * The harbour: a quay that begins on land, crosses the shoreline, and ends over the water.
 *
 * The order is the order a working quay actually has - road, yard, store, dock, boat, cages, sea -
 * and every part of it is derived from `HARBOUR` rather than hand-placed, so the deck starts at the
 * beach and ends over water wherever the coastline moves to. The deck is planks on piles rather than
 * a slab, because a slab over water is the single clearest sign that a harbour is scenery.
 */
function addHarbour(group: Group, assets: SharedAssets, harbour: FarmWorld["harbour"], layout: FarmLayout): void {
  const cos = Math.cos(harbour.rotationY);
  const sin = Math.sin(harbour.rotationY);
  const pier = new Group();
  pier.position.set(harbour.worldX, ISLAND_TOP_Y, harbour.worldZ);
  // Local +z is the bearing the deck runs on, so the whole structure can be built in its own frame.
  pier.rotation.y = harbour.rotationY;

  const deckWidth = harbour.deckWidthWorld;
  const plankCount = Math.max(4, Math.round((harbour.lengthWorld / layout.pitch) * 1.6));
  const waterlineY = -0.62;
  const deckY = 0.34;
  for (let index = 0; index < plankCount; index += 1) {
    const along = ((index + 0.5) / plankCount) * harbour.lengthWorld;
    const plank = box(assets, assets.stakeWood, deckWidth, 0.1, layout.pitch * 0.52, 0, deckY, along);
    plank.castShadow = true;
    pier.add(plank);
  }
  // Piles, in pairs, reaching from under the deck to below the waterline: the deck stands on
  // something, and the something is visible from the side.
  const pileCount = Math.max(2, Math.round(harbour.lengthWorld / (layout.pitch * 1.8)));
  for (let index = 0; index <= pileCount; index += 1) {
    const along = (index / pileCount) * harbour.lengthWorld;
    for (const side of [-deckWidth * 0.42, deckWidth * 0.42]) {
      const pile = new Mesh(assets.cylinder, assets.timber);
      pile.position.set(side, waterlineY + 0.2, along);
      pile.scale.set(0.11, 1.7, 0.11);
      pile.castShadow = true;
      pier.add(pile);
    }
  }
  // The head: a wider working platform at the far end, where a boat ties up.
  const head = box(assets, assets.stakeWood, deckWidth * 1.7, 0.12, layout.pitch * 1.5, 0, deckY - 0.01, harbour.lengthWorld);
  head.castShadow = true;
  pier.add(head);
  for (const side of [-deckWidth * 0.7, deckWidth * 0.7]) {
    const post = new Mesh(assets.cylinder, assets.timber);
    post.position.set(side, deckY + 0.45, harbour.lengthWorld + layout.pitch * 0.6);
    post.scale.set(0.16, 0.9, 0.16);
    post.castShadow = true;
    pier.add(post);
  }
  // A rail along one side of the head, and a bollard at the corner.
  const railBeam = box(assets, assets.stakeWood, 0.09, 0.09, layout.pitch * 1.4, -deckWidth * 0.7, deckY + 0.5, harbour.lengthWorld);
  railBeam.castShadow = true;
  pier.add(railBeam);
  // A ramp where the deck meets the beach, so the pier does not simply stop in the air.
  const ramp = box(assets, assets.stakeWood, deckWidth, 0.1, layout.pitch * 1.2, 0, deckY - 0.22, -layout.pitch * 0.5);
  ramp.rotation.x = -0.24;
  ramp.castShadow = true;
  pier.add(ramp);

  // A boat alongside the head: a hull, a thwart and a pair of oars. There is no boat asset and no
  // licence to fetch one, so this is a stylized primitive standing in for a fishing boat - and it is
  // built here, behind the same function, so a real model replaces one shape rather than a layout.
  const boat = new Group();
  boat.position.set(deckWidth * 1.35, waterlineY + 0.14, harbour.lengthWorld - layout.pitch * 0.2);
  boat.rotation.y = 0.14;
  const hull = new Mesh(assets.box, assets.stakeWood);
  hull.scale.set(1.0, 0.24, 2.1);
  hull.castShadow = true;
  boat.add(hull);
  const bow = new Mesh(assets.box, assets.stakeWood);
  bow.position.set(0, 0.06, 1.15);
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(0.72, 0.2, 0.72);
  bow.castShadow = true;
  boat.add(bow);
  const thwart = box(assets, assets.timber, 0.9, 0.08, 0.22, 0, 0.2, -0.2);
  boat.add(thwart);
  for (const side of [-0.4, 0.4]) {
    const oar = box(assets, assets.timber, 0.06, 0.06, 1.6, side, 0.24, 0);
    oar.rotation.x = 0.12;
    boat.add(oar);
  }
  pier.add(boat);
  group.add(pier);

  // The yard behind the quay: packed ground, crates, and barrels, between the road and the deck.
  const yard = new Mesh(assets.circle, assets.bareEarth);
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(harbour.yardWorldX, ISLAND_TOP_Y + 0.01, harbour.yardWorldZ);
  yard.scale.set(layout.pitch * 5.5, layout.pitch * 4.2, 1);
  yard.rotation.z = harbour.rotationY;
  yard.receiveShadow = true;
  group.add(yard);

  for (const [index, offset] of [-2.4, -1.2, 0.2].entries()) {
    const crate = box(
      assets,
      assets.stakeWood,
      0.62,
      0.62,
      0.62,
      harbour.yardWorldX + cos * offset + sin * index * 0.4,
      ISLAND_TOP_Y + 0.31,
      harbour.yardWorldZ + sin * offset - cos * index * 0.4
    );
    crate.rotation.y = harbour.rotationY + index * 0.3;
    crate.castShadow = true;
    group.add(crate);
  }
  for (const offset of [-2.9, -2.1]) {
    const barrel = new Mesh(assets.cylinder, assets.timber);
    barrel.position.set(
      harbour.yardWorldX + cos * offset - sin * 1.6,
      ISLAND_TOP_Y + 0.34,
      harbour.yardWorldZ + sin * offset + cos * 1.6
    );
    barrel.scale.set(0.34, 0.68, 0.34);
    barrel.castShadow = true;
    group.add(barrel);
  }
}

/**
 * The timber yard at the end of the haul road.
 *
 * A clearing of churned ground with cut timber stacked on it: logs laid in a pyramid, a stack of
 * sawn planks, and stumps. It is what turns a stand of straight rows into *managed* woodland - the
 * rows say somebody planted it, and the yard says somebody is working it.
 */
function addLoggingYard(group: Group, assets: SharedAssets, yard: NonNullable<FarmWorld["loggingYard"]>, layout: FarmLayout): void {
  const clearing = new Mesh(assets.circle, assets.bareEarth);
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(yard.worldX, GROUND_SURFACE_Y + 0.02, yard.worldZ);
  clearing.scale.set(yard.radiusWorld, yard.radiusWorld * 0.8, 1);
  clearing.rotation.z = yard.rotationY;
  clearing.receiveShadow = true;
  group.add(clearing);

  const cos = Math.cos(yard.rotationY);
  const sin = Math.sin(yard.rotationY);
  const logLength = layout.pitch * 2.6;
  // Three courses of logs, each course one log narrower: a pile, not a row.
  for (let course = 0; course < 3; course += 1) {
    const count = 4 - course;
    for (let index = 0; index < count; index += 1) {
      const across = (index - (count - 1) / 2) * 0.36;
      const log = new Mesh(assets.cylinder, assets.timber);
      log.position.set(
        yard.worldX - sin * across,
        GROUND_SURFACE_Y + 0.18 + course * 0.3,
        yard.worldZ + cos * across
      );
      log.rotation.z = Math.PI / 2;
      log.rotation.y = -yard.rotationY;
      log.scale.set(0.16, logLength, 0.16);
      log.castShadow = true;
      group.add(log);
    }
  }
  // A stack of sawn planks beside the pile, and two stumps left where the stand was felled.
  for (let index = 0; index < 4; index += 1) {
    const plank = box(
      assets,
      assets.stakeWood,
      logLength * 0.9,
      0.09,
      0.5,
      yard.worldX + cos * 1.9 - sin * 0.4,
      GROUND_SURFACE_Y + 0.06 + index * 0.1,
      yard.worldZ + sin * 1.9 + cos * 0.4,
      );
    plank.rotation.y = -yard.rotationY + 0.06 * index;
    plank.castShadow = true;
    group.add(plank);
  }
  for (const offset of [-1.6, -0.9]) {
    const stump = new Mesh(assets.cylinder, assets.timber);
    stump.position.set(yard.worldX + cos * offset + sin * 1.2, GROUND_SURFACE_Y + 0.14, yard.worldZ + sin * offset - cos * 1.2);
    stump.scale.set(0.24, 0.3, 0.24);
    stump.castShadow = true;
    group.add(stump);
  }
}

/**
 * The barn.
 *
 * The generated model is the barn; the primitives below are the fallback while it loads or if it
 * cannot be loaded at all, which is the same convention the crop and scenery models already follow.
 * The model is cloned, never re-fetched, and its footprint is presentation only: the yard's collision
 * is the canonical `STATIC_OBSTACLES` circle in `world-config.ts`.
 */
function addBarn(
  group: Group,
  assets: SharedAssets,
  world: FarmWorld,
  model: Object3D | undefined,
  modelScale: number
): void {
  if (world.barn === null) return;
  if (model !== undefined) {
    const barn = model.clone(true);
    barn.scale.setScalar(modelScale);
    barn.position.set(world.barn.worldX, BARN_FEET_Y, world.barn.worldZ);
    barn.rotation.y = world.barn.rotationY;
    barn.traverse((child) => {
      child.castShadow = true;
    });
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
  barn.traverse((child) => {
    child.castShadow = true;
  });

  group.add(barn);
}

/**
 * The fence: posts and rails along every segment the world config derives.
 *
 * There are no gate numbers here. A gap exists because `fenceGeometry` cut it out of the side, so the
 * drawing cannot disagree with what the player can walk through.
 */
function addFence(group: Group, assets: SharedAssets, fence: FenceGeometry, postSpacing: number): void {
  // A continuous fence around the whole reserve draws the gameplay square as a hard outline, which at
  // estate zoom is the single clearest sign that the world is a grid underneath. The fence is drawn
  // as *sections* with gaps between them instead: a farm boundary that a hedge, a gate, or a field
  // entrance interrupts - which is what a farm boundary actually looks like.
  let sectionIndex = 0;
  for (const segment of fence.segments) {
    const horizontal = segment.side === "SOUTH" || segment.side === "NORTH";
    const from = horizontal ? segment.minWorldX : segment.minWorldZ;
    const to = horizontal ? segment.maxWorldX : segment.maxWorldZ;
    const line = horizontal
      ? (segment.minWorldZ + segment.maxWorldZ) / 2
      : (segment.minWorldX + segment.maxWorldX) / 2;
    const length = to - from;
    if (length <= 0) continue;
    sectionIndex += 1;
    // Deterministic, and different on every side: the gaps must not line up into a rhythm either.
    const covered = 0.5 + 0.22 * Math.sin(sectionIndex * 2.3);
    const start = from + (to - from) * (sectionIndex % 2 === 0 ? 0.06 : 0.3);
    const sectionTo = Math.min(to, start + (to - from) * covered);
    const middle = (start + sectionTo) / 2;
    const sectionLength = sectionTo - start;

    for (const height of [0.28, 0.46]) {
      const rail = horizontal
        ? box(assets, assets.wood, sectionLength, 0.07, FENCE_THICKNESS_WORLD, middle, height, line)
        : box(assets, assets.wood, FENCE_THICKNESS_WORLD, 0.07, sectionLength, line, height, middle);
      rail.castShadow = true;
      group.add(rail);
    }

    // Posts every pitch, plus one at each end, so a gate is framed by two posts.
    const spacings = Math.max(1, Math.round(sectionLength / postSpacing));
    for (let index = 0; index <= spacings; index += 1) {
      const at = start + (sectionLength * index) / spacings;
      const post = box(assets, assets.wood, 0.1, FENCE_HEIGHT, 0.1, horizontal ? at : line, FENCE_HEIGHT / 2, horizontal ? line : at);
      post.castShadow = true;
      group.add(post);
    }
  }
}

/** A survey stake: a short post with a lighter cap, marking one point on the land's edge. */
function addStake(group: Group, assets: SharedAssets, worldX: number, worldY: number, worldZ: number): void {
  const post = box(assets, assets.stakeWood, 0.09, 0.5, 0.09, worldX, worldY + 0.25, worldZ);
  post.castShadow = true;
  group.add(post);
  // A weathered cap rather than a bright one: a line of white dots along the field's edge read as
  // marker posts in a tutorial, not as a farm boundary.
  const cap = box(assets, assets.dirt, 0.11, 0.08, 0.11, worldX, worldY + 0.5, worldZ);
  cap.castShadow = true;
  group.add(cap);
}

/** A signboard: a post and a plank, the readable "this land is not yours yet" marker. */
function addSignpost(group: Group, assets: SharedAssets, plot: LockedPlotSquare, layout: FarmLayout): void {
  const position = tileToWorld({ x: plot.minX - 0.5, y: plot.minY - 0.5 }, worldFrame(layout.pitch));
  const worldX = position.worldX;
  const worldZ = position.worldZ;
  const post = box(assets, assets.stakeWood, 0.12, 1.25, 0.12, worldX, 0.62, worldZ);
  post.castShadow = true;
  group.add(post);
  const board = box(assets, assets.stakeWood, 0.95, 0.4, 0.08, worldX, 1.12, worldZ);
  board.rotation.y = -0.22;
  board.castShadow = true;
  group.add(board);
  const band = box(assets, assets.millBlade, 0.78, 0.08, 0.1, worldX, 1.0, worldZ);
  band.rotation.y = -0.22;
  band.castShadow = true;
  group.add(band);
}

/** How far apart a field's furrow ridges stand, in tiles. */
const FURROW_SPACING_TILES = 0.68;
/**
 * One ridge of turned earth, as drawn: low and wide.
 *
 * The first version was narrow and tall, and the sun caught it like a plank: a field of them read as
 * boards laid on the grass rather than as ground that had been ploughed. Flatter ridges hold the
 * same rhythm without the highlight.
 */
const FURROW_RIDGE_WIDTH_WORLD = 0.26;
const FURROW_RIDGE_HEIGHT_WORLD = 0.025;
/** How wide the grass verge around a field parcel is, in world metres. */
const FIELD_VERGE_WORLD = 0.9;

/**
 * The agricultural reserve, drawn as a working farm rather than as a row of test squares.
 *
 * This is the district the island is *for*, so it gets the most care and the least noise: a handful
 * of parcels of different sizes worked in two directions, each with a grass headland around it, a
 * fallow parcel beside the working ones, and a hard standing where the machines will stand. The
 * furrows are the part that has to work at a distance *and* up close - a ridge every two thirds of a
 * metre reads as ploughing when the camera is on the field, and the rhythm of them is what makes a
 * brown rectangle read as a field when the camera is on the whole island - so they are drawn as one
 * instanced mesh for the entire reserve rather than as a mesh per furrow.
 */
function addFieldBlocks(group: Group, assets: SharedAssets, world: FarmWorld, layout: FarmLayout): void {
  const ridges: { readonly x: number; readonly y: number; readonly z: number; readonly rotationY: number; readonly length: number }[] = [];

  for (const block of world.fieldBlocks) {
    const cultivated = block.kind === "CULTIVATED";
    const surface = block.kind === "YARD" ? assets.plaza : cultivated ? assets.dirt : assets.bareEarth;

    // The headland first, a touch wider and lower than the parcel it surrounds, so two fields are
    // separated by ground rather than by a seam and the field has the grass margin a field has.
    const verge = box(
      assets,
      assets.grass,
      block.widthWorld + FIELD_VERGE_WORLD * 2,
      0.16,
      block.depthWorld + FIELD_VERGE_WORLD * 2,
      block.worldX,
      APRON_TOP_Y - 0.16,
      block.worldZ
    );
    verge.receiveShadow = true;
    group.add(verge);

    const soil = box(
      assets,
      surface,
      block.widthWorld,
      block.kind === "YARD" ? 0.12 : 0.22,
      block.depthWorld,
      block.worldX,
      block.kind === "YARD" ? APRON_TOP_Y - 0.06 : APRON_TOP_Y - 0.11,
      block.worldZ
    );
    soil.receiveShadow = true;
    group.add(soil);

    // Fallow ground and a hard standing have no ploughing on them, which is what makes them read as
    // *not being worked this season* rather than as another field.
    if (!cultivated) continue;

    const cos = Math.cos(block.rotationY);
    const sin = Math.sin(block.rotationY);
    const halfAlong = (Math.abs(cos) * block.widthWorld + Math.abs(sin) * block.depthWorld) / 2;
    const halfAcross = (Math.abs(sin) * block.widthWorld + Math.abs(cos) * block.depthWorld) / 2;
    const spacing = FURROW_SPACING_TILES * layout.pitch;
    const count = Math.max(3, Math.floor((halfAcross * 2) / spacing));
    for (let index = 0; index < count; index += 1) {
      const across = -halfAcross + ((index + 0.5) * halfAcross * 2) / count;
      ridges.push({
        x: block.worldX - sin * across,
        y: APRON_TOP_Y + FURROW_RIDGE_HEIGHT_WORLD / 2,
        z: block.worldZ + cos * across,
        rotationY: -block.rotationY,
        length: halfAlong * 2 - FIELD_VERGE_WORLD * 0.3
      });
    }
  }

  if (ridges.length === 0) return;
  const mesh = new InstancedMesh(assets.box, assets.dirtDark, ridges.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  ridges.forEach((ridge, index) => {
    position.set(ridge.x, ridge.y, ridge.z);
    scale.set(ridge.length, FURROW_RIDGE_HEIGHT_WORLD, FURROW_RIDGE_WIDTH_WORLD);
    rotation.setFromAxisAngle(up, ridge.rotationY);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

/**
 * The land the farm has not bought yet.
 *
 * The alpha drew it as a grey slab under a translucent fog rectangle with a gold padlock floating over
 * it, which read as a missing asset rather than as land. The replacement keeps what the slab was for -
 * "this ring is next, and it is not yours" - and drops what it was: rough grass instead of grey, wild
 * growth standing on it, a stake line along the edge the farm owns, and one wooden sign per plot.
 * Nothing here is a rule; the price, the level, and the purchase still come from the server.
 */
function addLockedLand(group: Group, assets: SharedAssets, world: FarmWorld, layout: FarmLayout): void {
  // The agricultural reserve's own fields first: they are the ground the place is made of, and the
  // apron paints over the parcel the moment its land is bought.
  addFieldBlocks(group, assets, world, layout);

  for (const plot of world.lockedPlots) {
    addSignpost(group, assets, plot, layout);
  }

  for (const stake of world.lockedBoundary) {
    addStake(group, assets, stake.worldX, stake.worldY, stake.worldZ);
  }
}

/**
 * The row beds under the orchard and the managed woodland.
 *
 * A row of trees is not legible as a row unless the ground says so: at estate zoom a handful of trees
 * on grass is a thicket, however regular the lattice they stand on. A shallow bed of bare earth under
 * each row is what turns the same trees into an orchard or a stand of planted timber — and it is also
 * the difference between them: the orchard gets wide beds on generous spacing, the managed woodland
 * narrower beds on tighter rows, which is exactly the distinction the plan asks a viewer to make.
 *
 * Static, because neither district is land the catalogue can sell.
 */
function addProductionRowBeds(group: Group, assets: SharedAssets, layout: FarmLayout): void {
  const frame = worldFrame(layout.pitch);
  const terrain = TERRAIN_SHAPE;
  for (const district of DISTRICTS) {
    if (district.kind !== "ORCHARD" && district.kind !== "FORESTRY") continue;
    const spacingTiles = district.rowSpacingTiles ?? 4.2;
    const bedWidthTiles = district.rowBedWidthTiles ?? 1.5;
    const rows = Math.max(2, Math.floor((district.radiusY * 1.6) / spacingTiles));
    const cos = Math.cos(district.rotationY);
    const sin = Math.sin(district.rotationY);
    for (let index = 0; index < rows; index += 1) {
      const offsetTiles = (index - (rows - 1) / 2) * spacingTiles;
      // The bed runs the length of the *ellipse* at its own row, not the length of the district: a
      // bed that overran the row it belongs to would put a strip of bare earth in the grass beside
      // the orchard, which is exactly the sort of thing that makes a planted district look printed.
      const fraction = Math.min(1, Math.abs(offsetTiles) / district.radiusY);
      const halfLengthTiles = district.radiusX * Math.sqrt(Math.max(0, 1 - fraction * fraction)) * 0.94;
      if (halfLengthTiles < 1) continue;
      const position = tileToWorld(
        { x: district.center.x - sin * offsetTiles, y: district.center.y + cos * offsetTiles },
        frame
      );
      // The bed follows the ground it is on. A flat slab under a row that climbs a shoulder is a slab
      // buried in the hillside at one end and floating above it at the other - and the whole point of
      // the bed is that the row *reads* as a row from the estate camera.
      const samples = Math.max(4, Math.round(halfLengthTiles * 2));
      const positions: number[] = [];
      const indices: number[] = [];
      for (let sample = 0; sample <= samples; sample += 1) {
        const along = (sample / samples) * halfLengthTiles * 2 - halfLengthTiles;
        const worldX = position.worldX + cos * along * layout.pitch;
        const worldZ = position.worldZ + sin * along * layout.pitch;
        const y = GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, terrain) + 0.02;
        positions.push(worldX - sin * (bedWidthTiles * layout.pitch) / 2, y, worldZ + cos * (bedWidthTiles * layout.pitch) / 2);
        positions.push(worldX + sin * (bedWidthTiles * layout.pitch) / 2, y, worldZ - cos * (bedWidthTiles * layout.pitch) / 2);
      }
      for (let sample = 0; sample < samples; sample += 1) {
        const left = sample * 2;
        const right = left + 1;
        indices.push(left, right + 2, right);
        indices.push(left, left + 2, right + 2);
      }
      // A fruit orchard's rows are *mown lanes* between the trees, not strips of bare earth: an
      // orchard reads as an orchard by its rows, and painting the rows the colour of a road is what
      // made the first version of this pass look like a hillside with tracks dragged across it. The
      // managed wood keeps the bare earth, because a working stand is worked.
      const bed = new Mesh(
        ribbonGeometry(positions, indices),
        district.kind === "ORCHARD" ? assets.meadow : assets.bareEarth
      );
      bed.receiveShadow = true;
      group.add(bed);
    }
  }
}

export function buildTerrain(
  group: Group,
  assets: SharedAssets,
  world: FarmWorld,
  layout: FarmLayout,
  barnModel?: Object3D,
  getBuildingModel: (id: string) => Object3D | undefined = () => undefined
): void {
  // The fence is derived from the world config and the tile pitch, exactly as the player's collision
  // is: one description, drawn here, walked around there.
  const fence = fenceGeometry(layout.pitch);
  addIsland(group, assets, world);
  addMeadows(group, assets, world);
  addProductionRowBeds(group, assets, layout);
  addPlaza(group, assets, world.plaza);
  if (world.loggingYard !== null) addLoggingYard(group, assets, world.loggingYard, layout);
  addRoads(group, assets, world);
  addFence(group, assets, fence, layout.pitch);
  if (world.pond !== null) addPond(group, assets, world.pond);
  addHarbour(group, assets, world.harbour, layout);
  addAquaculture(group, assets, world.aquaculture);
  // The curated barn is normalized to one world unit, so it is drawn at its own size; the generated
  // placeholder is already authored at the right scale.
  const curatedBarn = getBuildingModel("farm.barn.t2");
  addBarn(group, assets, world, curatedBarn ?? barnModel, curatedBarn === undefined ? 1 : 6.4);
  buildLandmarks(group, assets, world.landmarks, getBuildingModel);
}

/**
 * The locked-land overlay: the ring of plots the farm does not own yet.
 *
 * Kept out of `buildTerrain` because it is a projection of progression rather than of the static
 * world: buying a plot changes this layer and must leave the island untouched.
 */
export function buildLockedPlotOverlay(
  group: Group,
  assets: SharedAssets,
  world: FarmWorld,
  layout: FarmLayout,
  getModel: (id: string) => Object3D | undefined = () => undefined
): void {
  addFieldGround(group, assets, world);
  addLockedLand(group, assets, world, layout);
  buildScenery(group, assets, world.lockedScenery, getModel);
}
