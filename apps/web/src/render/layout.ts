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
  readonly pitch: number;
  /** Tile coordinate the world origin sits on. Set by `frame` so land and scenery share one frame. */
  readonly centerTileX: number;
  readonly centerTileY: number;
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
  /**
   * Tiles the world is framed around. Without it the layout centres on the tiles it was given.
   * Passing the unlocked-plus-locked frame keeps a growing farm, and the scenery around it, from
   * sliding across the screen every time land is bought.
   */
  readonly frame?: TileBounds;
}

/** An inclusive rectangle of tile coordinates. */
export interface TileBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function finiteInRange(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function assertCoordinate(tile: TileCoordinate): void {
  if (!Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y)) {
    throw new RangeError("tile coordinates must be safe integers");
  }
}

function assertBounds(bounds: TileBounds): void {
  for (const edge of [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY]) {
    if (!Number.isSafeInteger(edge)) {
      throw new RangeError("frame coordinates must be safe integers");
    }
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new RangeError("frame must have minX <= maxX and minY <= maxY");
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

  const minX = ordered.reduce((min, tile) => Math.min(min, tile.x), Number.POSITIVE_INFINITY);
  const maxX = ordered.reduce((max, tile) => Math.max(max, tile.x), Number.NEGATIVE_INFINITY);
  const minY = ordered.reduce((min, tile) => Math.min(min, tile.y), Number.POSITIVE_INFINITY);
  const maxY = ordered.reduce((max, tile) => Math.max(max, tile.y), Number.NEGATIVE_INFINITY);
  const columns = ordered.length === 0 ? 0 : maxX - minX + 1;
  const rows = ordered.length === 0 ? 0 : maxY - minY + 1;
  const frame = options.frame;
  if (frame !== undefined) assertBounds(frame);
  const centerTileX = frame === undefined
    ? ordered.length === 0 ? 0 : (minX + maxX) / 2
    : (frame.minX + frame.maxX) / 2;
  const centerTileY = frame === undefined
    ? ordered.length === 0 ? 0 : (minY + maxY) / 2
    : (frame.minY + frame.maxY) / 2;
  const placements = ordered.map((tile) => ({
    tileX: tile.x,
    tileY: tile.y,
    worldX: (tile.x - centerTileX) * pitch,
    worldZ: (tile.y - centerTileY) * pitch
  }));

  return {
    tileSize,
    tileGap,
    pitch,
    centerTileX,
    centerTileY,
    columns,
    rows,
    tileAreaWidth: columns === 0 ? 0 : columns * pitch - tileGap,
    tileAreaDepth: rows === 0 ? 0 : rows * pitch - tileGap,
    placements
  };
}

/** World position of a tile coordinate inside an existing layout's frame. */
export function worldPositionInLayout(
  layout: FarmLayout,
  tile: TileCoordinate
): { readonly worldX: number; readonly worldZ: number } {
  return {
    worldX: (tile.x - layout.centerTileX) * layout.pitch,
    worldZ: (tile.y - layout.centerTileY) * layout.pitch
  };
}
