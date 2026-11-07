import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Group,
  type MeshBasicMaterial
} from "three";
import type { TileCoordinate } from "./layout";
import { cellKey, type WorldCell, type WorldCellMap } from "./world-cell";
import { localNeighbourhood, type CellSelection } from "./world-cell-selection";

/**
 * The only thing in the island that is allowed to look like a grid.
 *
 * Normal play shows *nothing*: the island is organic, the roads curve, the fields are fields. When a
 * player selects a cell, the island shows exactly one square - the cell they pointed at - lifted onto
 * the ground it lies on, plus at most the eight cells around it as a faint suggestion of neighbours.
 * When a developer turns debug mode on, the same machinery draws the whole lattice, colour-coded by
 * land use, because that is the one audience that needs to see the grid the engine thinks in.
 *
 * `planCellOverlay` is pure and is where the count rule lives, so "normal mode never draws the
 * global grid" is a unit test rather than a promise.
 */

/** How far above the ground a cell overlay floats, so it never z-fights the terrain it lies on. */
export const CELL_OVERLAY_LIFT_WORLD = 0.045;
/**
 * How far above the ground the overlay floats when the cell carries tile slabs.
 *
 * A slab is nine centimetres of ground with a surface of its own, so a square drawn at the terrain's
 * height would simply be *inside* the field it is marking. The lift is the slab's thickness plus the
 * usual clearance, and it is applied only to cells the farm's own tiles cover.
 */
export const CELL_OVERLAY_TILE_LIFT_WORLD = 0.09 + CELL_OVERLAY_LIFT_WORLD;
/**
 * The open sea's own surface.
 *
 * A water cell's ground is under six tenths of a metre of sea, and a square drawn at the terrain's
 * height would hang in the air above it. The aquaculture overlay is the one that has to sit on the
 * water a fish cage floats in.
 */
export const SEA_SURFACE_Y = -0.62;
/** How finely the selected cell's square is subdivided, so it follows a slope instead of cutting it. */
const SELECTION_SUBDIVISIONS = 4;

export interface CellOverlayPlan {
  /** The single selected cell, or null. */
  readonly selection: WorldCell | null;
  /** The selected cell and its immediate neighbours: nine cells at most, and never the whole map. */
  readonly neighbourhood: readonly TileCoordinate[];
  /** Every cell, and only when debug mode is on. */
  readonly debugCells: readonly WorldCell[];
}

/**
 * What to draw, given what is selected and whether debug mode is on.
 *
 * The invariant the brief asks for, expressed as arithmetic: with nothing selected and debug off the
 * plan is empty, so no code path can draw the island's grid in normal play.
 */
export function planCellOverlay(
  map: WorldCellMap,
  selection: CellSelection | null,
  debug: boolean
): CellOverlayPlan {
  if (debug) {
    return { selection: null, neighbourhood: [], debugCells: [...map.cells.values()] };
  }
  if (selection === null) return { selection: null, neighbourhood: [], debugCells: [] };
  const selected = map.cells.get(cellKey(selection.cell.x, selection.cell.y)) ?? null;
  if (selected === null) return { selection: null, neighbourhood: [], debugCells: [] };
  return {
    selection: selected,
    neighbourhood: localNeighbourhood(selection, map).map((cell) => ({ x: cell.x, y: cell.z })),
    debugCells: []
  };
}

/** The colour a debug cell is drawn in, by land use. Colour is a hint; the shape is the outline. */
export function debugColourFor(cell: WorldCell): number {
  switch (cell.productionCapability) {
    case "CROP":
      return 0x8fbf5f;
    case "TIMBER":
      return 0x4f8f5a;
    case "AQUACULTURE":
      return 0x4f8fbf;
    case "MINING":
      return 0xbf9f5f;
    case "NONE":
      switch (cell.terrain) {
        case "WATER":
          return 0x2f6f9f;
        case "SHORE":
          return 0xd9c795;
        case "BLOCKED":
          return 0x8a6f6f;
        // The volcano's own colour, so a debug pass can see the landmark's footprint at a glance.
        case "VOLCANO":
          return 0x7a5a4a;
        case "LAND":
          return 0x6f8f6f;
      }
  }
}

/** A square ring the size of one cell, as four quads: the outline every overlay is built from. */
export function cellOutlineGeometry(): BufferGeometry {
  const half = 0.5;
  const innerHalf = 0.42;
  const positions: number[] = [];
  const indices: number[] = [];
  function quad(x0: number, z0: number, x1: number, z1: number): void {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  quad(-half, -half, half, -innerHalf);
  quad(-half, innerHalf, half, half);
  quad(-half, -innerHalf, -innerHalf, innerHalf);
  quad(innerHalf, -innerHalf, half, innerHalf);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The selected cell, as a soft translucent square that lies on the ground.
 *
 * Subdivided and lifted vertex by vertex onto `terrainHeightAt`, so the square follows a slope rather
 * than slicing through it - which is the difference between "the game is showing me a cell" and "the
 * game is showing me a decal".
 */
export function buildSelectionQuad(
  cell: WorldCell,
  map: WorldCellMap,
  material: MeshBasicMaterial,
  /** The surface the square lies on, lifted enough to clear whatever the cell carries. */
  heightAt: (worldX: number, worldZ: number) => number
): Mesh {
  const pitch = map.frame.pitch;
  const centre = {
    worldX: (cell.x - map.frame.originTileX) * pitch,
    worldZ: (cell.z - map.frame.originTileY) * pitch
  };
  const steps = SELECTION_SUBDIVISIONS;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const worldX = centre.worldX + (column / steps - 0.5) * pitch;
      const worldZ = centre.worldZ + (row / steps - 0.5) * pitch;
      positions.push(worldX, heightAt(worldX, worldZ), worldZ);
    }
  }
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const base = row * (steps + 1) + column;
      indices.push(base, base + steps + 1, base + 1);
      indices.push(base + 1, base + steps + 1, base + steps + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 3;
  return mesh;
}

/** One instanced outline per cell in the plan's neighbourhood, and nothing else. */
export function buildCellOutlines(
  group: Group,
  cells: readonly TileCoordinate[],
  pitch: number,
  material: MeshBasicMaterial,
  heights: (x: number, z: number) => number
): BufferGeometry | null {
  if (cells.length === 0) return null;
  const geometry = cellOutlineGeometry();
  const mesh = new InstancedMesh(geometry, material, cells.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  cells.forEach((cell, index) => {
    const worldX = (cell.x - 5.5) * pitch;
    const worldZ = (cell.y - 5.5) * pitch;
    position.set(worldX, heights(worldX, worldZ), worldZ);
    scale.set(pitch, 1, pitch);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  return geometry;
}

/** The debug lattice: every cell, colour-coded by what the engine thinks it is. */
export function buildDebugGrid(
  group: Group,
  cells: readonly WorldCell[],
  pitch: number,
  material: MeshBasicMaterial,
  heightAt: (worldX: number, worldZ: number) => number
): BufferGeometry | null {
  if (cells.length === 0) return null;
  const geometry = cellOutlineGeometry();
  const mesh = new InstancedMesh(geometry, material, cells.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const colour = new Color();
  cells.forEach((cell, index) => {
    const worldX = (cell.x - 5.5) * pitch;
    const worldZ = (cell.z - 5.5) * pitch;
    position.set(worldX, heightAt(worldX, worldZ), worldZ);
    scale.set(pitch, 1, pitch);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, colour.setHex(debugColourFor(cell)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  return geometry;
}
