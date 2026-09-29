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
  readonly sand: MeshStandardMaterial;
  readonly dirt: MeshStandardMaterial;
  readonly dirtDark: MeshStandardMaterial;
  readonly water: MeshStandardMaterial;
  readonly waterDeep: MeshStandardMaterial;
  readonly wood: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
  readonly pine: MeshStandardMaterial;
  readonly rock: MeshStandardMaterial;
  readonly flowers: readonly MeshStandardMaterial[];
  readonly barnWall: MeshStandardMaterial;
  readonly barnRoof: MeshStandardMaterial;
  readonly barnTrim: MeshStandardMaterial;
  readonly locked: MeshStandardMaterial;
  readonly lockedFog: MeshStandardMaterial;
  readonly lockMetal: MeshStandardMaterial;
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

function standard(color: number, options: { transparent?: boolean; opacity?: number; depthWrite?: boolean } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.02,
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
    sand: material(standard(0xe7d59a)),
    dirt: material(standard(0xc9a26a)),
    dirtDark: material(standard(0xb0854f)),
    water: material(standard(0x49a7dd, { transparent: true, opacity: 0.86 })),
    waterDeep: material(standard(0x2b7fbf)),
    wood: material(standard(0xa9763f)),
    foliage: material(standard(0x4f9d45)),
    pine: material(standard(0x3c7f4a)),
    rock: material(standard(0x9aa3ab)),
    flowers,
    barnWall: material(standard(0xd1574a)),
    barnRoof: material(standard(0x8d3f38)),
    barnTrim: material(standard(0xf3e3c8)),
    locked: material(standard(0x6f7d70)),
    lockedFog: material(standard(0xe4eee7, { transparent: true, opacity: 0.5, depthWrite: false })),
    lockMetal: material(standard(0xf0c24a)),
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

/** Terrain material the renderer uses for an unlocked tile. */
export function tileMaterial(assets: SharedAssets, terrainType: FarmTileDTO["terrainType"], occupied: boolean): MeshStandardMaterial {
  if (terrainType === "SOIL") return occupied ? assets.terrain.soilOccupied : assets.terrain.soilEmpty;
  return assets.terrain[terrainType];
}
