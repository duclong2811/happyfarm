import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D
} from "three";
import { tileToWorld, worldFrame, type FarmLayout } from "./layout";
import type { SharedAssets } from "./materials";
import {
  districtOutlinePhase,
  districtOutlineScale,
  LOCKED_GROUND_SURFACE_Y,
  type FarmWorld,
  type LockedPlotSquare,
  type MeadowSpec,
  type PondSpec,
  type RoadSpec
} from "./world";
import { GROUND_SURFACE_Y, islandRimPoint, terrainHeightAt, type TerrainShape } from "./terrain-height";
import type { DistrictGround } from "./world-config";
import {
  DISTRICTS,
  FENCE_THICKNESS_WORLD,
  fenceGeometry,
  ISLAND_SHAPE_EXPONENT,
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

/** The greener, cooler ground the farm stands in, and the drier colour its hills fade toward. */
const GROUND_GREEN = new Color(0x74bd58);
const HILL_GREEN = new Color(0x93c26c);
const SHORE_SAND = new Color(0xd9c795);
/** The two greens a plot nobody has claimed cycles between: drier and flatter than tended grass. */
const WILD_GROUND_DARK = new Color(0x759a4a);
const WILD_GROUND_LIGHT = new Color(0x8fb066);

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
      const colour = GROUND_GREEN.clone().lerp(HILL_GREEN, Math.min(1, Math.max(0, rise)) * 0.85);
      // Blend toward sand in the last of the ring, so the grass does not stop in a hard line.
      const shore = Math.min(1, Math.max(0, (rise - 0.02) / 0.06));
      return colour.lerp(SHORE_SAND, shore * 0.55);
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

/** The material a district's ground is tinted with. Colour only; nothing reads it back. */
function districtGroundMaterial(assets: SharedAssets, ground: DistrictGround): MeshStandardMaterial | null {
  switch (ground) {
    case "NONE":
      return null;
    case "PLAZA":
      return assets.plaza;
    case "ORCHARD":
      return assets.bareEarth;
    case "PASTURE":
      return assets.pasture;
    case "WETLAND":
      return assets.wetland;
    case "FOREST_FLOOR":
      return assets.forestFloor;
    case "SAND":
      return assets.sand;
  }
}

/**
 * Each district's ground, as an irregular blob that follows the terrain.
 *
 * The outline is modulated per district, so no district's ground has a straight edge and two
 * districts do not share an identical silhouette. It is a tint under the vegetation, not a boundary:
 * nothing about it blocks, unlocks, or costs anything.
 */
function addDistrictGround(group: Group, assets: SharedAssets, world: FarmWorld): void {
  const terrain = world.terrain;
  for (const district of world.districts) {
    const material = districtGroundMaterial(assets, district.ground);
    if (material === null) continue;
    const phase = districtOutlinePhase(district.id);
    const geometry = radialSurface({
      rings: 4,
      sectors: 34,
      rimAt: (angle) => {
        const scale = districtOutlineScale(angle, phase);
        const local = {
          x: Math.cos(angle) * district.radiusWorldX * scale,
          z: Math.sin(angle) * district.radiusWorldZ * scale
        };
        const cos = Math.cos(district.rotationY);
        const sin = Math.sin(district.rotationY);
        return { x: local.x * cos - local.z * sin, z: local.x * sin + local.z * cos };
      },
      translate: (x, z) => ({ worldX: district.worldX + x, worldZ: district.worldZ + z }),
      heightAt: (worldX, worldZ) => ISLAND_TOP_Y + terrainHeightAt(worldX, worldZ, terrain) + PATCH_LIFT_WORLD
    });
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
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
    const geometry = radialSurface({
      rings: 4,
      sectors: 28,
      rimAt: (angle) => {
        const local = { x: Math.cos(angle) * patch.radiusWorldX, z: Math.sin(angle) * patch.radiusWorldZ };
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
  const lobe = (angle: number, scale: number): { readonly x: number; readonly z: number } => {
    const shape = districtOutlineScale(angle, 1.7);
    return {
      x: Math.cos(angle) * pond.radiusWorldX * scale * shape,
      z: Math.sin(angle) * pond.radiusWorldZ * scale * shape
    };
  };
  const around = (scale: number, lift: number, rings: number): BufferGeometry =>
    radialSurface({
      rings,
      sectors: 34,
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
  // The agricultural fields first, so the plot patches and their scrub sit on top of them: a field
  // block is the ground, and what is drawn over it is what is happening on that ground.
  for (const block of world.fieldBlocks) {
    const soil = box(assets, assets.dirt, block.widthWorld, 0.22, block.depthWorld, block.worldX, APRON_TOP_Y - 0.11, block.worldZ);
    soil.rotation.y = block.rotationY;
    soil.receiveShadow = true;
    group.add(soil);
    // A grass margin around the field, so two blocks are separated by ground rather than by a seam.
    const margin = box(
      assets,
      assets.grass,
      block.widthWorld + 1.6,
      0.16,
      block.depthWorld + 1.6,
      block.worldX,
      APRON_TOP_Y - 0.16,
      block.worldZ
    );
    margin.rotation.y = block.rotationY;
    group.add(margin);
    // Furrows: three thin ridges across the field, which is what makes tilled ground read as tilled
    // ground rather than as a brown rectangle at estate zoom.
    for (let index = 1; index <= 3; index += 1) {
      const across = (index / 4 - 0.5) * block.depthWorld;
      const furrow = box(
        assets,
        assets.dirtDark,
        block.widthWorld * 0.92,
        0.06,
        0.16,
        block.worldX + Math.sin(block.rotationY) * across,
        APRON_TOP_Y + 0.01,
        block.worldZ + Math.cos(block.rotationY) * across
      );
      furrow.rotation.y = block.rotationY;
      group.add(furrow);
    }
  }

  // Every unclaimed plot gets the rough ground; only the ring the catalogue is offering gets the
  // stakes and the sign, because those are what say "this one, next".
  for (const [index, plot] of world.wildPatches.entries()) {
    // A patch of fallow ground rather than a slab, and deliberately *not* the same patch twice: the
    // plot's own index shifts and sizes it, so the ring around the field reads as fields of different
    // ages and sizes rather than as four identical rounded squares in a row - which is what the
    // estate camera made of the even version.
    const jitter = Math.sin(index * 12.9898) * 0.5;
    const scaleX = 0.86 + 0.12 * Math.sin(index * 4.1);
    const scaleZ = 0.86 + 0.12 * Math.cos(index * 3.3);
    const half = (plot.sizeWorld / 2) * 0.92;
    const outline = {
      centerWorldX: plot.centerWorldX,
      centerWorldZ: plot.centerWorldZ,
      halfWidthWorld: half * scaleX,
      halfDepthWorld: half * scaleZ,
      exponent: ISLAND_SHAPE_EXPONENT,
      // Locked plots are rounded squares on purpose: the plot *is* a square, and the stake line and
      // the scrub are what stop it reading as one.
      lobes: []
    };
    const patch = new Mesh(
      radialSurface({
        rings: 3,
        sectors: 32,
        rimAt: (angle) => {
          const rim = islandRimPoint(angle, outline);
          return {
            x: rim.worldX - plot.centerWorldX + jitter,
            z: rim.worldZ - plot.centerWorldZ - jitter
          };
        },
        translate: (x, z) => ({ worldX: plot.centerWorldX + x, worldZ: plot.centerWorldZ + z }),
        heightAt: () => LOCKED_GROUND_SURFACE_Y,
        // Colour varies across the patch beside the surrounding grass: one flat green oval read as a
        // shape rather than as ground, and this is the cheapest way to give it depth.
        colorAt: (worldX, worldZ) => {
          const mix = 0.5 + 0.5 * Math.sin(worldX * 0.53 + 1.3) * Math.cos(worldZ * 0.61 - 0.7);
          return WILD_GROUND_DARK.clone().lerp(WILD_GROUND_LIGHT, mix);
        }
      }),
      // Fallow earth rather than grass: the land beside a working field looks like ground that has
      // been turned over and left, which is also what stops it reading as decoration.
      assets.bareEarth
    );
    patch.receiveShadow = true;
    group.add(patch);
  }

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
  for (const district of DISTRICTS) {
    if (district.kind !== "ORCHARD" && district.kind !== "FORESTRY") continue;
    const spacingTiles = district.kind === "ORCHARD" ? 4.2 : 3.4;
    const bedWidthTiles = district.kind === "ORCHARD" ? 1.5 : 1.1;
    const lengthTiles = district.radiusX * 1.55;
    const rows = Math.max(2, Math.floor((district.radiusY * 1.6) / spacingTiles));
    for (let index = 0; index < rows; index += 1) {
      const offsetTiles = (index - (rows - 1) / 2) * spacingTiles;
      const position = tileToWorld({ x: district.center.x, y: district.center.y + offsetTiles }, frame);
      const bed = box(
        assets,
        assets.bareEarth,
        lengthTiles * layout.pitch,
        0.04,
        bedWidthTiles * layout.pitch,
        position.worldX,
        GROUND_SURFACE_Y + 0.02,
        position.worldZ
      );
      // A local +x tile direction maps to (cos, sin) in tile space, which is -rotationY about Y here.
      bed.rotation.y = -district.rotationY;
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
  addDistrictGround(group, assets, world);
  addProductionRowBeds(group, assets, layout);
  addRoads(group, assets, world);
  addFence(group, assets, fence, layout.pitch);
  if (world.pond !== null) addPond(group, assets, world.pond);
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
