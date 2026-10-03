import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
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
  /**
   * The mown lane between two orchard rows.
   *
   * A row of trees is a line; a row of trees standing on a strip of cut grass is a *plantation*. The
   * difference between this and the island's own grass is small on purpose - a lane is mown, not
   * paved - and it is the only thing that makes the rows read from the estate camera.
   */
  readonly mownLane: MeshStandardMaterial;
  readonly sand: MeshStandardMaterial;
  /** The darker, wetter band where the land meets the water. */
  readonly wetSand: MeshStandardMaterial;
  readonly dirt: MeshStandardMaterial;
  readonly dirtDark: MeshStandardMaterial;
  /** Dry, muted earth for meadow patches: bare ground that has not been worked. */
  readonly bareEarth: MeshStandardMaterial;
  /**
   * The road network's three surfaces, plus the trodden ground underneath them all.
   *
   * A stone spine is grey and laid; a dirt road is warm packed earth; a path is paler worn ground;
   * the shoulder is the softer fringe every road sits in, so an edge is a blend rather than a cut.
   * The first three carry vertex colours - the geometry tints each stone and each ribbon vertex a
   * little, and the colour here is what that tint multiplies.
   */
  readonly roadShoulder: MeshStandardMaterial;
  readonly roadStone: MeshStandardMaterial;
  /** The mortar the stone road's plates are laid on: darker, so a joint reads as a joint. */
  readonly roadStoneBed: MeshStandardMaterial;
  readonly roadDirt: MeshStandardMaterial;
  readonly roadPath: MeshStandardMaterial;
  /** The stones a dirt road's verge collects, drawn instanced with a colour per stone. */
  readonly roadsideStone: MeshStandardMaterial;
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
  /**
   * The planting grid: flat colour, no lighting.
   *
   * An interaction overlay is a *mark*, not a surface, so it must not change brightness as the sun
   * moves across it - a standard material would already be pale on one side of the island and dark
   * on the other, which is the difference between a hint and a light show.
   */
  readonly interactionGrid: MeshBasicMaterial;
  /**
   * The cell overlay: the one square a selection draws, the faint hint of its neighbours, and the
   * developer lattice.
   *
   * Flat colour and no lighting, like the planting grid, because a cell overlay is a mark on the
   * ground rather than a surface of it - and quiet, because normal play must never see a grid.
   */
  readonly cellSelection: MeshBasicMaterial;
  readonly cellNeighbour: MeshBasicMaterial;
  readonly cellDebug: MeshBasicMaterial;
  /**
   * The ownership mark: a quiet green wash over the cells the player actually owns.
   *
   * Shown only while something is in hand for placement or a move, so the player can see where "here"
   * is. Quieter than a selection, because it is *context* rather than an answer: a hundred and forty
   * cells of it must not drown the footprint the player is deciding about.
   */
  readonly cellOwned: MeshBasicMaterial;
  readonly cropGrowing: MeshStandardMaterial;
  readonly cropMature: MeshStandardMaterial;
  /** A ready tree's fruit, by orchard species. The canopy is shared art; the fruit says which tree. */
  readonly fruitApple: MeshStandardMaterial;
  readonly fruitOrange: MeshStandardMaterial;
  readonly fruitPeach: MeshStandardMaterial;
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
    /**
     * Pull this surface towards the camera in depth, so it wins against ground it lies on.
     *
     * This is what lets a road sit *in* the terrain rather than on top of it: the ground mesh is drawn
     * from coarse rings and interpolates across them, so the drawn ground can stand a few centimetres
     * above the analytic curve a road follows. Lifting the road is the other way to fix that, and it is
     * the wrong one - it makes a kerb. A depth bias keeps the road where it belongs and still lets it
     * win the depth test.
     */
    polygonOffset?: boolean;
  } = {}
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.85,
    metalness: 0.02,
    ...(options.vertexColors === undefined ? {} : { vertexColors: options.vertexColors }),
    ...(options.transparent === undefined ? {} : { transparent: options.transparent }),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    ...(options.depthWrite === undefined ? {} : { depthWrite: options.depthWrite }),
    ...(options.polygonOffset === undefined
      ? {}
      : { polygonOffset: options.polygonOffset, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  });
}

function flat(
  color: number,
  options: { readonly opacity?: number; readonly depthWrite?: boolean } = {}
): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    ...(options.opacity === undefined ? {} : { transparent: true, opacity: options.opacity }),
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
  function flatMaterial(value: MeshBasicMaterial): MeshBasicMaterial {
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
    mownLane: material(standard(0xa6c86a, { roughness: 0.95 })),
    sand: material(standard(0xe7d59a)),
    wetSand: material(standard(0xc9b184, { roughness: 0.7 })),
    dirt: material(standard(0xc9a26a)),
    dirtDark: material(standard(0xb0854f)),
    bareEarth: material(standard(0xc4a97b, { roughness: 0.94 })),
    // Grey and laid for the spine, warm earth for the working roads, paler worn ground for a track,
    // and one fringe under all of them that reads as *trodden grass* rather than as a dark outline -
    // which is what makes a dirt road sit in a field instead of on it. Every one of them is depth
    // biased, so the road wins against the ground without being lifted into a kerb.
    roadShoulder: material(standard(0x7f8a52, { roughness: 0.98, vertexColors: true, polygonOffset: true })),
    roadStone: material(standard(0x9d998d, { roughness: 0.9, vertexColors: true, polygonOffset: true })),
    roadStoneBed: material(standard(0x817d72, { roughness: 0.94, vertexColors: true, polygonOffset: true })),
    roadDirt: material(standard(0x9c7748, { roughness: 0.97, vertexColors: true, polygonOffset: true })),
    roadPath: material(standard(0xac9068, { roughness: 0.97, vertexColors: true, polygonOffset: true })),
    roadsideStone: material(standard(0x9a958c, { roughness: 0.9 })),
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
    // Pale, low, and quiet: the planting grid is a hint at where a seed may go, not an editor.
    interactionGrid: flatMaterial(flat(0xe8f7d8, { opacity: 0.42, depthWrite: false })),
    // A selection is a soft wash of light on the ground; its neighbours are a hint of one; the debug
    // lattice is drawn in its own colours per cell and only ever on a developer's machine.
    cellSelection: flatMaterial(flat(0xf3f7e4, { opacity: 0.34, depthWrite: false })),
    cellNeighbour: flatMaterial(flat(0xdfe9cf, { opacity: 0.16, depthWrite: false })),
    cellDebug: flatMaterial(flat(0xffffff, { opacity: 0.62, depthWrite: false })),
    cellOwned: flatMaterial(flat(0x86c96a, { opacity: 0.2, depthWrite: false })),
    cropGrowing: material(standard(0x6fbf7f)),
    cropMature: material(standard(0xe0b64a)),
    fruitApple: material(standard(0xd4452f)),
    fruitOrange: material(standard(0xe08a26)),
    fruitPeach: material(standard(0xe98f5a)),
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
// Two tones a shade apart rather than two colours: with the tile seams gone, a wide tonal difference
// between neighbouring tiles is what would put the grid back on screen. The furrows are what carry
// the field's structure now.
const SOIL_TONES: readonly number[] = [0xb4835a, 0xb88a5e];
const SOIL_OCCUPIED_TONES: readonly number[] = [0x7f5a3a, 0x83603f];
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
