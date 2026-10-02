/**
 * The tile coordinate, as the shared world data speaks it.
 *
 * Structural rather than imported: the client's layout module and the server's repositories each have
 * their own view of a tile, and a plain `{ x, y }` is the shape all of them already satisfy. Keeping
 * the definition here means the shared world data depends on nothing.
 */
export interface TileCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface TileBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}
