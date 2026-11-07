import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
  type Material
} from "three";
import type { SceneTile } from "./view-model";

/**
 * The planting grid: a hint at where a seed may go, drawn as one instanced outline per tile.
 *
 * Three rules, and all three matter:
 *
 *  - it is **aligned to the authoritative tiles**, because it is drawn from the same `SceneTile`
 *    descriptors the tile slabs are: one outline per placement, at the placement's own world
 *    position and the layout's own tile size. It cannot drift from the grid the server plants on,
 *    because there is only one grid;
 *  - it is **only the tiles that need it** - the ones the server reported plantable - so it never
 *    becomes a net drawn over the whole island;
 *  - it is **its own group with its own material**, so it is one flag to turn on and one to turn
 *    off, and nothing about it is recomputed per frame.
 *
 * Nothing here is gameplay: no tile is marked, selected, sent, or remembered, and the mode that
 * shows it is a presentation state the client owns.
 */

/** How wide the outline of one tile is, as a fraction of the tile. */
const OUTLINE_WIDTH_FRACTION = 0.13;

/**
 * One tile's outline, as four thin quads in the XZ plane, centred on the origin.
 *
 * Built rather than bought: a ring geometry would be a circle, a line loop would be a hairline that
 * disappears at an angle, and four quads are four triangles each, which is nothing to instance a
 * hundred and forty-four of.
 */
function tileOutlineGeometry(): BufferGeometry {
  const inner = 1 - OUTLINE_WIDTH_FRACTION * 2;
  const half = 0.5;
  const innerHalf = inner / 2;
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
 * Draws the grid for the tiles that need it, and returns the geometry it built so the caller can
 * release it. An empty list leaves the group empty rather than drawing nothing per tile.
 */
export function buildInteractionGrid(
  group: Group,
  tiles: readonly SceneTile[],
  tileSize: number,
  surfaceY: number,
  material: Material
): BufferGeometry | null {
  if (tiles.length === 0) return null;
  const geometry = tileOutlineGeometry();
  const mesh = new InstancedMesh(geometry, material, tiles.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  tiles.forEach((tile, index) => {
    position.set(tile.worldX, surfaceY, tile.worldZ);
    scale.set(tileSize, 1, tileSize);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  group.add(mesh);
  return geometry;
}

/**
 * The tiles the planting hint outlines.
 *
 * Exactly one: the cell the player has selected, and only when the server's own rows say a seed may
 * go there. V14.5.1B replaced "every plantable tile" - which drew the whole owned parcel as a grid
 * and read as a placement boundary - with the candidate the player is actually considering.
 */
export function plantingHintCells(
  tiles: readonly SceneTile[],
  selected: { readonly x: number; readonly y: number } | null
): readonly SceneTile[] {
  if (selected === null) return [];
  return tiles.filter(
    (tile) => tile.plantable && tile.tileX === selected.x && tile.tileY === selected.y
  );
}
