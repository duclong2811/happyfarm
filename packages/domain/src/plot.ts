import { DomainError } from "./errors";
import { plotIdForIndex, type CurrencyDefinitionId, type FarmId, type PlotId } from "./ids";
import { createFarmTile, MAX_TILE_X, MAX_TILE_Y, type FarmTile, type TileCoordinate } from "./tile";

/** Side length of the square of SOIL tiles one plot adds, matching the starter square. */
export const PLOT_TILE_SIZE = 6;

/** Tiles one plot contributes. A plot is a cohort, not an individual tile. */
export const PLOT_TILE_COUNT = PLOT_TILE_SIZE * PLOT_TILE_SIZE;

/**
 * The deepest plot index whose tiles still fit inside the tile coordinate bounds.
 *
 * Derived from the coordinate bounds rather than chosen, so the geometry can never address a
 * coordinate the rest of the system would reject. Ring `r` extends the farm to a
 * `PLOT_TILE_SIZE * (r + 1)` square, so its farthest coordinate is `PLOT_TILE_SIZE * (r + 1) - 1`.
 * How far a farm may actually grow is a separate, much smaller product decision owned by the plot
 * catalogue in `packages/game-data`.
 */
const MAX_TILE_BOUND = Math.min(MAX_TILE_X, MAX_TILE_Y);
const MAX_PLOT_RING = Math.floor((MAX_TILE_BOUND + 1) / PLOT_TILE_SIZE) - 1;
export const MAX_ADDRESSABLE_PLOT_INDEX = MAX_PLOT_RING * (MAX_PLOT_RING + 2);

/**
 * One purchasable piece of land.
 *
 * `plotIndex` is the layout slot and `id` is its name; `assertPlotDefinition` refuses a pair that
 * disagrees, so a definition cannot describe one slot while naming another. Price and level are
 * authoritative game data and are never client inputs.
 */
export interface PlotDefinition {
  readonly id: PlotId;
  readonly plotIndex: number;
  readonly displayNameKey: string;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly price: number;
  readonly requiredLevel: number;
}

export function assertPlotIndex(plotIndex: number): void {
  if (!Number.isSafeInteger(plotIndex) || plotIndex < 1 || plotIndex > MAX_ADDRESSABLE_PLOT_INDEX) {
    throw new DomainError("INVALID_PLOT", "Plot index is invalid or out of range");
  }
}

export function assertPlotDefinition(definition: PlotDefinition): void {
  assertPlotIndex(definition.plotIndex);
  if (definition.id !== plotIdForIndex(definition.plotIndex)) {
    throw new DomainError("INVALID_PLOT", "Plot definition ID does not match its index");
  }
  if (!Number.isSafeInteger(definition.price) || definition.price <= 0) {
    throw new DomainError("INVALID_PLOT", "Plot price is invalid");
  }
  if (!Number.isSafeInteger(definition.requiredLevel) || definition.requiredLevel < 1) {
    throw new DomainError("INVALID_PLOT", "Plot level requirement is invalid");
  }
}

/**
 * The concentric ring a plot index belongs to. Ring 1 is the first expansion.
 *
 * Ring `r` holds `2r + 1` plots, so the indices through ring `r` are exactly `1..r(r + 2)`.
 * The estimate is corrected by exact integer comparison, which is what keeps the result correct
 * rather than the floating-point square root.
 */
export function plotRing(plotIndex: number): number {
  assertPlotIndex(plotIndex);
  let ring = Math.max(1, Math.floor(Math.sqrt(plotIndex)));
  while (ring * (ring + 2) < plotIndex) ring += 1;
  while (ring > 1 && (ring - 1) * (ring + 1) >= plotIndex) ring -= 1;
  return ring;
}

/**
 * Where a plot's tile square starts.
 *
 * The farm grows as rings around the starter square, so it stays square: ring `r` extends it to
 * `PLOT_TILE_SIZE * (r + 1)` tiles on a side. Within a ring the plots run down the new right column
 * and then left to right along the new bottom row, so buying land walks a clockwise spiral outward
 * from the origin. All coordinates stay non-negative, which is what the renderers assume.
 */
export function plotOrigin(plotIndex: number): TileCoordinate {
  const ring = plotRing(plotIndex);
  const offsetInRing = plotIndex - (ring - 1) * (ring + 1);
  if (offsetInRing <= ring + 1) {
    return { x: PLOT_TILE_SIZE * ring, y: PLOT_TILE_SIZE * (offsetInRing - 1) };
  }
  return { x: PLOT_TILE_SIZE * (offsetInRing - ring - 2), y: PLOT_TILE_SIZE * ring };
}

/** Every coordinate a plot covers, in row-then-column order. */
export function plotTileCoordinates(plotIndex: number): readonly TileCoordinate[] {
  const origin = plotOrigin(plotIndex);
  const coordinates: TileCoordinate[] = [];
  for (let y = 0; y < PLOT_TILE_SIZE; y += 1) {
    for (let x = 0; x < PLOT_TILE_SIZE; x += 1) {
      coordinates.push({ x: origin.x + x, y: origin.y + y });
    }
  }
  return coordinates;
}

/** The tiles a plot purchase adds: fresh SOIL at version 1, exactly like starter land. */
export function plotTiles(farmId: FarmId, plotIndex: number, timestamp: string): readonly FarmTile[] {
  return plotTileCoordinates(plotIndex).map((coordinate) =>
    createFarmTile(farmId, coordinate, "SOIL", timestamp)
  );
}

/**
 * How many plots a farm has fully unlocked, counted from plot 1.
 *
 * A plot is unlocked when every one of its tiles exists, because a tile row *is* unlocked land
 * (`UnlockedLandPolicy`). A partially written plot therefore reads as locked: the fail-closed
 * direction. It cannot be bought again either, since the missing rows would collide with the rows
 * that do exist — a state this code cannot produce, and one that refuses rather than grants.
 */
export function unlockedPlotIndex(tiles: readonly TileCoordinate[]): number {
  const present = new Set(tiles.map((tile) => `${String(tile.x)},${String(tile.y)}`));
  let depth = 0;
  for (let plotIndex = 1; plotIndex <= MAX_ADDRESSABLE_PLOT_INDEX; plotIndex += 1) {
    const complete = plotTileCoordinates(plotIndex).every((coordinate) =>
      present.has(`${String(coordinate.x)},${String(coordinate.y)}`)
    );
    if (!complete) break;
    depth = plotIndex;
  }
  return depth;
}

/**
 * Whether a player at `level` may buy this plot.
 *
 * The same defensive shape as `isCropUnlocked`: a malformed level, or a requirement below the level
 * every player starts at, locks the plot instead of unlocking it. A player who should have been
 * allowed can retry; a player who should not have been cannot un-buy land.
 */
export function isPlotUnlocked(definition: PlotDefinition, level: number): boolean {
  if (!Number.isSafeInteger(level) || !Number.isSafeInteger(definition.requiredLevel)) return false;
  return definition.requiredLevel >= 1 && level >= definition.requiredLevel;
}

