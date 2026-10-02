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
  type MeadowSpec,
  type PondSpec
} from "./world";
import {
  junctionSurface,
  ribbonSurface,
  roadsideStones,
  shoulderProfile,
  stonePlateSurface,
  type SurfaceData
} from "./road-surface";
import {
  GROUND_SURFACE_Y,
  islandRadiusAt,
  islandRimPoint,
  terrainHeightAt,
  volcanoHeightAt,
  volcanoRadiusFraction,
  type TerrainShape
} from "./terrain-height";
import { ROAD_LIFT_WORLD } from "./roads";
import { ROAD_SHOULDER_WORLD } from "./world-config";
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
/**
 * How thick a tile slab is.
 *
 * Lowered in V12.1 from 0.09. The player's land is a patch of ground, not a board laid on it, and a
 * nine-centimetre step around twelve tiles of field read as exactly the raised platform the brief
 * removes. Slabs still stand clear of the soil bed - which is what makes a field a field rather than
 * a decal - but the step is now the thickness of a thick tile, not a kerb.
 */
export const TILE_THICKNESS = 0.045;

const APRON_TOP_Y = -0.01;
/**
 * Top of the darker soil bed that sits under the whole reserved field.
 *
 * The tile slabs stand on it and the gaps between them show it, so the pitch between tiles reads as
 * a furrow line rather than as a seam between two floating boxes. It is a hair under the slabs' own
 * base, so it never pokes through them.
 */
const FIELD_BED_TOP_Y = -0.004;
/** Top of the island's ground surface where it is flat: level with the old grass slab. */
const ISLAND_TOP_Y = GROUND_SURFACE_Y;
/** How far the beach reaches past the ground surface, in world metres. */
const BEACH_MARGIN_WORLD = 0.6;
/** How much of a patch's own height it is lifted by, so it does not fight the ground it lies on. */
const PATCH_LIFT_WORLD = 0.02;
/** Rings and sectors of the island's ground mesh. Enough for a smooth shoreline, one draw call. */
/**
 * How finely the island's ground is sampled.
 *
 * Raised in V12.1 from 14 x 96. The island's own relief is low and wide, which 14 rings described
 * perfectly well - but the volcano is a *local* shape, and a crater is the smallest feature on the
 * island. At 14 rings the ring spacing was four metres, so the crater, its rim, and the summit were
 * each sampled by one or two rings and the whole landmark came out as the smooth dome the QA pass
 * caught. These two numbers are the resolution of a *static* mesh built once per world, so the extra
 * few thousand vertices cost nothing per frame; what they buy is a mountain that keeps its shape.
 */
const ISLAND_RINGS = 56;
const ISLAND_SECTORS = 128;

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
/** The island's landmark is stone, not grass: the colour the ground takes as it climbs the volcano. */
const VOLCANIC_ROCK = new Color(0x6d5a50);
/** The crater floor: the same stone, scorched and ash-grey, so the bowl reads as a bowl. */
const CRATER_FLOOR = new Color(0x453a33);
function islandGroundGeometry(terrain: TerrainShape): BufferGeometry {
  const relief = Math.max(terrain.reliefWorld, 0.001);
  const volcano = terrain.volcano;
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
      // The volcano is the one place the ground stops being grass. Its flanks are rock, its crater
      // floor is more so, and the change is a *tint* on the same mesh rather than a second material -
      // which is what keeps the landmark readable from the estate camera without a single extra draw.
      //
      // The tint is gated by *height* as well as by footprint. The first version asked only "is this
      // inside the mountain's outline?", and the answer painted rock on the flat beach where the
      // flank runs into the northern sea - a dark slab along the shore that read as a cliff that was
      // not there. A footprint is not a mountain; ground that has not risen is not its rock.
      if (volcano !== undefined) {
        const fraction = volcanoRadiusFraction(worldX, worldZ, volcano);
        const volcanic = volcanoHeightAt(worldX, worldZ, volcano) / volcano.heightWorld;
        if (fraction < 1 && volcanic > 0.02) {
          const band = fraction < volcano.rimRadiusFraction ? 1 : fraction < volcano.steepRadiusFraction ? 0.75 : 0.3;
          const rocky = band * Math.min(1, volcanic / 0.3);
          colour.lerp(VOLCANIC_ROCK, rocky);
          if (fraction < volcano.rimRadiusFraction * 0.7) colour.lerp(CRATER_FLOOR, 0.7);
        }
      }
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
function addIsland(group: Group, assets: SharedAssets, world: FarmWorld): Mesh {
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
  // Named so the picking pass can find the one mesh a click on open ground lands on.
  ground.name = "island-ground";
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
  return ground;
}

/**
 * The soil under the field the player works, and the furrows across it.
 *
 * The apron hugs the land the farm owns rather than the whole reserve, so the field has a worked
 * margin and the reserve around it stays ground. The furrows are what makes it read as a field
 * instead of a brown rectangle: one ridge along every tile boundary, drawn as a single instanced
 * mesh, at the height the tile slabs' own surface sits at.
 */
function addFieldGround(group: Group, assets: SharedAssets, world: FarmWorld, layout: FarmLayout): void {
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
  // The furrows: one ridge along every tile boundary of the land the farm owns, from the same
  // `inner` bounds the tiles themselves are laid out from, so a bought plot's rows line up with the
  // rows that were already there.
  const owned = world.inner;
  if (owned === null) return;
  const ridges: { readonly worldX: number; readonly worldZ: number; readonly length: number }[] = [];
  const centreX = (owned.minX + owned.maxX + 1) / 2;
  const widthWorld = (owned.maxX - owned.minX + 1) * layout.pitch;
  for (let y = owned.minY; y <= owned.maxY + 1; y += 1) {
    const position = tileToWorld({ x: centreX, y: y - 0.5 }, worldFrame(layout.pitch));
    ridges.push({ worldX: position.worldX, worldZ: position.worldZ, length: widthWorld });
  }
  if (ridges.length === 0) return;
  const mesh = new InstancedMesh(assets.box, assets.dirtDark, ridges.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  ridges.forEach((ridge, index) => {
    position.set(ridge.worldX, TILE_THICKNESS + 0.004, ridge.worldZ);
    scale.set(ridge.length, 0.012, 0.3);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

/** How far each road layer is lifted, so the layers stack instead of fighting. */
const ROAD_SHOULDER_LIFT = -0.006;
/**
 * The three beds sit a hair apart rather than at the same height.
 *
 * Two ribbons of different classes meet wherever a road meets a path - the quay's walkway is a `PATH`
 * and the harbour road is dirt - and drawn at exactly the same height their overlap is a z-fight: a
 * torn, jagged seam that the V12.2 close-up caught near the harbour. A few millimetres of separation
 * is invisible from any camera and makes the winner deterministic.
 */
/**
 * The dirt bed sits *above* the path bed, and that order is deliberate.
 *
 * A farm road and a footpath cross at the village gate, and the two ribbons overlap there. Whichever
 * is higher wins the overlap, and the road should: at the village the pale path wedge over the dirt
 * was the seam the V12.3 QA pass found. Ordering the beds by importance - dirt road, then stone road,
 * then the field paths - makes the crossing read as a path meeting a road.
 */
const ROAD_PATH_LIFT = 0.002;
const ROAD_STONE_BED_LIFT = 0.006;
const ROAD_PLATE_LIFT = 0.012;
const ROAD_JUNCTION_LIFT = 0.016;
const ROAD_DIRT_LIFT = 0.008;
/** The shoulder table lives with the road widths, because scenery clearance reads it too. */
const ROAD_SHOULDER_WIDTHS = ROAD_SHOULDER_WORLD;

/** One mesh from one surface, or nothing when the surface is empty. */
function surfaceMesh(data: SurfaceData, material: Material, lift: number, name: string): Mesh | null {
  if (data.positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  if (data.colors !== null) geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = lift;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The road network, drawn as the hierarchy it is.
 *
 * Seven layers, in the order they are laid: a soft shoulder under everything, three beds - dirt,
 * worn path, and the stone spine's own surface - then the cobbles on top of the stone bed, then a
 * paved disc at each junction, then the stones the verges collect. Roads are the map's explanation,
 * so this is the one place the composition of the island is spelled out in materials rather than in
 * words: grey stone, warm dirt, pale worn ground, and a darker fringe beneath all of them.
 *
 * Generated once per world refresh and read by nothing per frame. Every layer is a single mesh, and
 * the cobbles are batched into one geometry rather than instanced per stone.
 */
function addRoads(group: Group, assets: SharedAssets, world: FarmWorld): void {
  if (world.roads.length === 0) return;

  /** The ground a road follows: the same terrain mesh the island is drawn from, plus the road's lift. */
  const roadHeightAt = (worldX: number, worldZ: number): number =>
    GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, world.terrain) + ROAD_LIFT_WORLD;

  const shoulder = surfaceMesh(
    ribbonSurface(
      world.roads.map((road) => ({ ...road, widthWorld: road.widthWorld + ROAD_SHOULDER_WIDTHS[road.kind] })),
      ["PRIMARY", "SECONDARY", "PATH"],
      roadHeightAt,
      shoulderProfile
    ),
    assets.roadShoulder,
    ROAD_SHOULDER_LIFT,
    "road-shoulder"
  );
  if (shoulder !== null) group.add(shoulder);

  const dirt = surfaceMesh(
    ribbonSurface(world.roads, ["SECONDARY"], roadHeightAt),
    assets.roadDirt,
    ROAD_DIRT_LIFT,
    "road-dirt"
  );
  if (dirt !== null) group.add(dirt);

  const paths = surfaceMesh(
    ribbonSurface(world.roads, ["PATH"], roadHeightAt),
    assets.roadPath,
    ROAD_PATH_LIFT,
    "road-path"
  );
  if (paths !== null) group.add(paths);

  const stoneBed = surfaceMesh(
    ribbonSurface(world.roads, ["PRIMARY"], roadHeightAt),
    assets.roadStoneBed,
    ROAD_STONE_BED_LIFT,
    "road-stone-bed"
  );
  if (stoneBed !== null) group.add(stoneBed);

  const plates = surfaceMesh(
    stonePlateSurface(world.roads, roadHeightAt),
    assets.roadStone,
    ROAD_PLATE_LIFT,
    "road-cobbles"
  );
  if (plates !== null) group.add(plates);

  /**
   * A junction disc is drawn only where the roads meet on open ground.
   *
   * The village square is already a paved place: it has its own surface, and V12.2 made every road
   * that reaches it dirt, so a dirt disc laid over the paving would have painted a brown blot in the
   * middle of the one paved thing on the island. The plaza is the junction, and the square is where
   * the roads stop.
   */
  const outsidePlaza = (worldX: number, worldZ: number, margin: number): boolean => {
    const dx = (worldX - world.plaza.worldX) / (world.plaza.radiusWorldX + margin);
    const dz = (worldZ - world.plaza.worldZ) / (world.plaza.radiusWorldZ + margin);
    return dx * dx + dz * dz > 1;
  };
  const junctionLayers = [
    [
      world.junctions.filter((junction) => junction.kind === "PRIMARY" && outsidePlaza(junction.worldX, junction.worldZ, 0.6)),
      assets.roadStone,
      "road-junction-stone"
    ],
    [
      world.junctions.filter((junction) => junction.kind === "SECONDARY" && outsidePlaza(junction.worldX, junction.worldZ, 0.6)),
      assets.roadDirt,
      "road-junction-dirt"
    ],
    [
      world.junctions.filter((junction) => junction.kind === "PATH" && outsidePlaza(junction.worldX, junction.worldZ, 0.6)),
      assets.roadPath,
      "road-junction-path"
    ]
  ] as const;
  for (const [junctions, asset, name] of junctionLayers) {
    const mesh = surfaceMesh(junctionSurface(junctions), asset, ROAD_JUNCTION_LIFT, name);
    if (mesh !== null) group.add(mesh);
  }

  addRoadsideStones(group, assets, world);
}

/**
 * The stones along a dirt road's verge, as one `InstancedMesh`.
 *
 * A stone is a low-poly octahedron squashed onto the ground and turned to a hash; the whole verge of
 * the network costs one draw call and a few hundred triangles, and the occasional rock is what keeps
 * a dirt road from reading as a painted stripe.
 */
function addRoadsideStones(group: Group, assets: SharedAssets, world: FarmWorld): void {
  const stones = roadsideStones(world.roads);
  if (stones.length === 0) return;
  const mesh = new InstancedMesh(assets.octa, assets.roadsideStone, stones.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const colour = new Color();
  stones.forEach((stone, index) => {
    position.set(stone.worldX, stone.worldY + stone.scale * 0.22, stone.worldZ);
    scale.set(stone.scale, stone.scale * 0.62, stone.scale);
    rotation.setFromAxisAngle(axis, stone.rotationY);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, colour.setRGB(stone.tone, stone.tone, stone.tone));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.name = "road-verge-stones";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
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
      // A patch is small and is often seen from directly above, so its outline is the first thing the
      // eye reads: at 28 sectors the lake's bank was a visible polygon rather than a shore.
      sectors: 48,
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
  /**
   * The deck, laid as planks that *meet*.
   *
   * They used to be spaced at half a pitch, which left a gap between every plank: from a low camera
   * the gaps read as the treads of a staircase climbing out to sea, and the QA pass caught exactly
   * that. A continuous deck with a hairline seam keeps the plank rhythm and removes the stairs.
   */
  const plankCount = Math.max(4, Math.round((harbour.lengthWorld / layout.pitch) * 1.02));
  const waterlineY = -0.62;
  const deckY = 0.34;
  for (let index = 0; index < plankCount; index += 1) {
    const along = ((index + 0.5) / plankCount) * harbour.lengthWorld;
    const plank = box(assets, assets.stakeWood, deckWidth, 0.1, layout.pitch * 0.98, 0, deckY, along);
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

export function buildTerrain(
  group: Group,
  assets: SharedAssets,
  world: FarmWorld,
  layout: FarmLayout
): Object3D {
  const ground = addIsland(group, assets, world);
  addMeadows(group, assets, world);
  addPlaza(group, assets, world.plaza);
  addRoads(group, assets, world);
  if (world.pond !== null) addPond(group, assets, world.pond);
  addHarbour(group, assets, world.harbour, layout);
  // The barn, the authored buildings and the set dressing were drawn here until V13.3.1. They are
  // world objects now - rows the player may move, store or remove - so the construction layer draws
  // them and this one must not, or the island would show two of everything.
  return ground;
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
  addFieldGround(group, assets, world, layout);
  buildScenery(group, assets, world.lockedScenery, getModel);
}
