import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material
} from "three";
import type { FarmTileDTO } from "@happy-farm/contracts";

/**
 * Geometry and materials shared by every mesh the world draws.
 *
 * One unit-sized geometry per shape keeps the scene graph small: meshes scale and position the
 * shared shape instead of allocating their own. Everything is owned here and released from one
 * `dispose`, so a torn-down renderer cannot leave GPU buffers behind.
 */
export interface TerrainMaterials {
  readonly SOIL: MeshStandardMaterial;
  readonly GRASS: MeshStandardMaterial;
  readonly WATER: MeshStandardMaterial;
  readonly BLOCKED: MeshStandardMaterial;
  /** Bare, plantable soil: the state the player can plant on. */
  readonly soilEmpty: MeshStandardMaterial;
  /** Soil under a crop. */
  readonly soilOccupied: MeshStandardMaterial;
}

export interface SharedAssets {
  readonly box: BoxGeometry;
  readonly cone: ConeGeometry;
  readonly roof: ConeGeometry;
  readonly cylinder: CylinderGeometry;
  readonly sphere: SphereGeometry;
  readonly torus: TorusGeometry;
  readonly ring: RingGeometry;
  readonly circle: CircleGeometry;
  readonly octa: OctahedronGeometry;
  readonly terrain: TerrainMaterials;
  readonly grass: MeshStandardMaterial;
  /**
   * The island's ground, tinted per vertex.
   *
   * One mesh covers the whole island including its rolling ring, and the vertex colours let the
   * raised ground read slightly paler and drier than the tended field without a second material or a
   * texture. `vertexColors` multiplies the base colour, so the base is white.
   */
  readonly terrainGrass: MeshStandardMaterial;
  /** Lighter, cooler green for the meadow patches that break up the island's single plane. */
  readonly meadow: MeshStandardMaterial;
  readonly sand: MeshStandardMaterial;
  /** The darker, wetter band where the land meets the water. */
  readonly wetSand: MeshStandardMaterial;
  readonly dirt: MeshStandardMaterial;
  readonly dirtDark: MeshStandardMaterial;
  /** Dry, muted earth for meadow patches: bare ground that has not been worked. */
  readonly bareEarth: MeshStandardMaterial;
  /** The road network: packed earth for the roads that matter, a lighter track for the paths. */
  readonly road: MeshStandardMaterial;
  readonly roadMinor: MeshStandardMaterial;
  /** District grounds: the settlement's square, pasture, wetland edge, and forest floor. */
  readonly plaza: MeshStandardMaterial;
  readonly pasture: MeshStandardMaterial;
  readonly wetland: MeshStandardMaterial;
  readonly forestFloor: MeshStandardMaterial;
  readonly water: MeshStandardMaterial;
  readonly waterDeep: MeshStandardMaterial;
  readonly wood: MeshStandardMaterial;
  /** Weathered timber for stakes, signs, and the bridge-free small structures. */
  readonly stakeWood: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
  readonly pine: MeshStandardMaterial;
  readonly rock: MeshStandardMaterial;
  readonly stone: MeshStandardMaterial;
  readonly flowers: readonly MeshStandardMaterial[];
  readonly barnWall: MeshStandardMaterial;
  readonly barnRoof: MeshStandardMaterial;
  readonly barnTrim: MeshStandardMaterial;
  /** Landmark palette: plaster, roof tile, timber, canvas, and mill sails. */
  readonly plaster: MeshStandardMaterial;
  readonly roofTile: MeshStandardMaterial;
  readonly timber: MeshStandardMaterial;
  readonly canvas: MeshStandardMaterial;
  readonly millBlade: MeshStandardMaterial;
  /**
   * Neutral white for meshes that carry their colour per instance.
   *
   * The farm's tile slabs are one `InstancedMesh`; each slab sets its own colour, so the shared
   * material is only a surface description and the geometry stays a single draw call.
   */
  readonly tileSurface: MeshStandardMaterial;
  readonly selection: MeshStandardMaterial;
  readonly hover: MeshStandardMaterial;
  readonly ready: MeshStandardMaterial;
  readonly cropGrowing: MeshStandardMaterial;
  readonly cropMature: MeshStandardMaterial;
  /** Placeholder avatar colours. Art replaces these; nothing reads them back. */
  readonly playerBody: MeshStandardMaterial;
  readonly playerLegs: MeshStandardMaterial;
  readonly playerSkin: MeshStandardMaterial;
  readonly playerHat: MeshStandardMaterial;
  /** The flat marker under the avatar's feet, so the character is findable on a busy field. */
  readonly playerMarker: MeshStandardMaterial;
  dispose(): void;
}

function standard(
  color: number,
  options: {
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
    vertexColors?: boolean;
    roughness?: number;
  } = {}
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.85,
    metalness: 0.02,
    ...(options.vertexColors === undefined ? {} : { vertexColors: options.vertexColors }),
    ...(options.transparent === undefined ? {} : { transparent: options.transparent }),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    ...(options.depthWrite === undefined ? {} : { depthWrite: options.depthWrite })
  });
}

export function createSharedAssets(): SharedAssets {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  function geometry<T extends BufferGeometry>(value: T): T {
    geometries.push(value);
    return value;
  }
  function material(value: MeshStandardMaterial): MeshStandardMaterial {
    materials.push(value);
    return value;
  }

  const terrain: TerrainMaterials = {
    SOIL: material(standard(0xa9805a)),
    GRASS: material(standard(0x6cae52)),
    WATER: material(standard(0x3f93c9)),
    BLOCKED: material(standard(0x6b6f75)),
    soilEmpty: material(standard(0xb98a5a)),
    soilOccupied: material(standard(0x8a6440))
  };

  const flowers = [0xf08fb4, 0xf6d34a, 0xf4f1e4].map((color) => material(standard(color)));

  return {
    box: geometry(new BoxGeometry(1, 1, 1)),
    cone: geometry(new ConeGeometry(1, 1, 10)),
    roof: geometry(new ConeGeometry(1, 1, 4)),
    cylinder: geometry(new CylinderGeometry(1, 1, 1, 12)),
    sphere: geometry(new SphereGeometry(1, 12, 10)),
    torus: geometry(new TorusGeometry(1, 0.24, 8, 18)),
    ring: geometry(new RingGeometry(0.76, 1, 40)),
    circle: geometry(new CircleGeometry(1, 40)),
    octa: geometry(new OctahedronGeometry(1, 0)),
    terrain,
    grass: material(standard(0x7dc35a)),
    terrainGrass: material(standard(0xffffff, { vertexColors: true, roughness: 0.92 })),
    meadow: material(standard(0x8fd06a)),
    sand: material(standard(0xe7d59a)),
    wetSand: material(standard(0xc9b184, { roughness: 0.7 })),
    dirt: material(standard(0xc9a26a)),
    dirtDark: material(standard(0xb0854f)),
    bareEarth: material(standard(0xc4a97b, { roughness: 0.94 })),
    road: material(standard(0xc19a63, { roughness: 0.96 })),
    roadMinor: material(standard(0xccab7c, { roughness: 0.96 })),
    plaza: material(standard(0xcbb894, { roughness: 0.92 })),
    pasture: material(standard(0x8ec663, { roughness: 0.95 })),
    wetland: material(standard(0x6f9f5e, { roughness: 0.95 })),
    forestFloor: material(standard(0x6d8a4a, { roughness: 0.96 })),
    water: material(standard(0x49a7dd, { transparent: true, opacity: 0.86 })),
    waterDeep: material(standard(0x2b7fbf)),
    wood: material(standard(0xa9763f)),
    stakeWood: material(standard(0x8a6440, { roughness: 0.95 })),
    foliage: material(standard(0x4f9d45)),
    pine: material(standard(0x3c7f4a)),
    rock: material(standard(0x9aa3ab)),
    stone: material(standard(0xb4b1a6, { roughness: 0.9 })),
    flowers,
    barnWall: material(standard(0xd1574a)),
    barnRoof: material(standard(0x8d3f38)),
    barnTrim: material(standard(0xf3e3c8)),
    plaster: material(standard(0xf2e6d0)),
    roofTile: material(standard(0xa8503f)),
    timber: material(standard(0x7d5a3c)),
    canvas: material(standard(0xe4585a)),
    millBlade: material(standard(0xe8dcbb)),
    tileSurface: material(standard(0xffffff)),
    selection: material(standard(0x8ef0b0)),
    hover: material(standard(0xfff3a8, { transparent: true, opacity: 0.75 })),
    ready: material(standard(0xffcf3f)),
    cropGrowing: material(standard(0x6fbf7f)),
    cropMature: material(standard(0xe0b64a)),
    playerBody: material(standard(0x3f6fd8)),
    playerLegs: material(standard(0x39435c)),
    playerSkin: material(standard(0xf1c7a1)),
    playerHat: material(standard(0xd9a441)),
    playerMarker: material(standard(0xfdf6d8, { transparent: true, opacity: 0.75, depthWrite: false })),
    dispose(): void {
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
    }
  };
}

/**
 * The colours one tile slab may be drawn in.
 *
 * Four cultivated-soil tones and three under-crop tones, picked per coordinate rather than per
 * material: a field of one flat brown reads as a placeholder, and a field with a slow, deterministic
 * variation reads as ground that was actually worked. The variation is a property of the coordinate,
 * so a tile keeps its shade when the farm grows and two clients see the same field.
 */
const SOIL_TONES: readonly number[] = [0xb28356, 0xbb8c5e];
const SOIL_OCCUPIED_TONES: readonly number[] = [0x7f5a3a, 0x886340];
const GRASS_TONES: readonly number[] = [0x6cae52, 0x74b757];

/** Water and blocked ground are one colour each: they are a state, not a cultivated surface. */
const TILE_FLAT_TONES: Readonly<Record<"WATER" | "BLOCKED", number>> = {
  WATER: 0x3f93c9,
  BLOCKED: 0x6b6f75
};

/**
 * A coordinate's stable index into a palette.
 *
 * Rows alternate and the tone drifts slowly along a row, so a field reads as furrows worked in one
 * direction rather than as a chequerboard of independently coloured squares. It depends only on the
 * coordinate, so a tile's shade never changes with draw order or with how much land the farm owns.
 */
function tileToneIndex(x: number, y: number, length: number): number {
  return (Math.abs(y | 0) + Math.floor(Math.abs(x | 0) / 5)) % length;
}

/**
 * The colour the renderer draws one unlocked tile in.
 *
 * The caller passes the tile's own coordinate so the choice is stable and testable; nothing here
 * reads the server's state, and a tile the server did not return is never drawn at all.
 */
export function tileColorFor(
  terrainType: FarmTileDTO["terrainType"],
  occupied: boolean,
  x: number,
  y: number
): number {
  switch (terrainType) {
    case "SOIL": {
      const tones = occupied ? SOIL_OCCUPIED_TONES : SOIL_TONES;
      return tones[tileToneIndex(x, y, tones.length)] ?? tones[0] ?? 0xb98a5a;
    }
    case "GRASS":
      return GRASS_TONES[tileToneIndex(x, y, GRASS_TONES.length)] ?? 0x6cae52;
    default:
      return TILE_FLAT_TONES[terrainType];
  }
}
