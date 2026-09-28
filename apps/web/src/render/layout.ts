/**
 * Pure geometry for the 3D farm view.
 *
 * The renderer consumes only this layout, never contract DTOs, so scene geometry can be reasoned
 * about and tested without a WebGL context. Tile coordinates stay server-owned: this module only
 * converts authoritative coordinates into world positions and never invents land of its own.
 */

export const DEFAULT_TILE_SIZE = 1;
export const DEFAULT_TILE_GAP = 0.08;
export const MIN_TILE_SIZE = 0.05;
export const MAX_TILE_SIZE = 100;
export const MAX_TILE_GAP = 100;

/** An authoritative tile coordinate, as returned by `GET /farms/:farmId/tiles`. */
export interface TileCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface TilePlacement {
  readonly tileX: number;
  readonly tileY: number;
  readonly worldX: number;
  readonly worldZ: number;
}

export interface FarmLayout {
  readonly tileSize: number;
  readonly tileGap: number;
  readonly columns: number;
  readonly rows: number;
  /** Extent of the tile area, excluding any ground margin the renderer adds around it. */
  readonly tileAreaWidth: number;
  readonly tileAreaDepth: number;
  readonly placements: readonly TilePlacement[];
}

export interface FarmLayoutOptions {
  readonly tileSize?: number;
  readonly tileGap?: number;
}

function finiteInRange(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function assertCoordinate(tile: TileCoordinate): void {
  if (!Number.isSafeInteger(tile.x) || tile.x < 0 || !Number.isSafeInteger(tile.y) || tile.y < 0) {
    throw new RangeError("tile coordinates must be non-negative safe integers");
  }
}

/**
 * Lays the unlocked tiles out as a grid centred on the world origin.
 *
 * Tiles are emitted in row-then-column order, and a coordinate that appears twice collapses into a
 * single placement. Both properties keep the scene graph deterministic for a given farm, so
 * re-rendering a farm cannot stack overlapping meshes or reshuffle them frame to frame.
 *
 * An empty farm yields no placements and zero extents rather than an invented tile; deciding how
 * much empty ground to show is the renderer's business, not this function's.
 */
export function layoutFarmTiles(
  tiles: readonly TileCoordinate[],
  options: FarmLayoutOptions = {}
): FarmLayout {
  const tileSize = finiteInRange(options.tileSize ?? DEFAULT_TILE_SIZE, "tileSize", MIN_TILE_SIZE, MAX_TILE_SIZE);
  const tileGap = finiteInRange(options.tileGap ?? DEFAULT_TILE_GAP, "tileGap", 0, MAX_TILE_GAP);
  const pitch = tileSize + tileGap;

  const unique = new Map<string, TileCoordinate>();
  for (const tile of tiles) {
    assertCoordinate(tile);
    unique.set(`${String(tile.x)},${String(tile.y)}`, { x: tile.x, y: tile.y });
  }
  const ordered = [...unique.values()].sort((left, right) => left.y - right.y || left.x - right.x);

  const columns = ordered.reduce((max, tile) => Math.max(max, tile.x), -1) + 1;
  const rows = ordered.reduce((max, tile) => Math.max(max, tile.y), -1) + 1;
  const placements = ordered.map((tile) => ({
    tileX: tile.x,
    tileY: tile.y,
    worldX: (tile.x - (columns - 1) / 2) * pitch,
    worldZ: (tile.y - (rows - 1) / 2) * pitch
  }));

  return {
    tileSize,
    tileGap,
    columns,
    rows,
    tileAreaWidth: columns === 0 ? 0 : columns * pitch - tileGap,
    tileAreaDepth: rows === 0 ? 0 : rows * pitch - tileGap,
    placements
  };
}
