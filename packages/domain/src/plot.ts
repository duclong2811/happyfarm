import { DomainError } from "./errors";
import { plotIdForIndex, type CurrencyDefinitionId, type FarmId, type PlotId } from "./ids";
import { createFarmTile, MAX_TILE_X, MAX_TILE_Y, type FarmTile, type TileCoordinate } from "./tile";

/**
 * Side length of the square of SOIL tiles one plot adds, matching the starter square.
 *
 * Twelve: a plot is one cohort of land, and a cohort has to be worth the gold the catalogue charges
 * for it. Scaling the cohort with the starter square rather than changing how the ring is counted is
 * what keeps this file's geometry, the renderer's mirror of it, and `farm_tiles` agreeing about
 * which coordinate a plot index occupies.
 */
export const PLOT_TILE_SIZE = 12;

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
 * A plot counts as owned when every one of its tiles exists. V14.5.2 removed the idea that a tile row
 * is a licence to use the ground, but the legacy plot purchase still records land this way, so a
 * partially written plot reads as not bought: the fail-closed direction. It cannot be bought again,
 * since the missing rows would collide with the rows
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

/**
 * The convenience premium, in per cent, a single-cell purchase pays over the enclosing plot's own
 * per-cell price.
 *
 * Bulk land stays the better deal - 144 cells for one plot price - and buying one cell at a time is
 * flexible but somewhat dearer, exactly the trade the brief asks for. One number, in the domain, so
 * the API and any future UI quote agree without a second constant.
 */
export const SINGLE_CELL_PREMIUM_PERCENT = 25;

/**
 * Every reason one cell may be, or not be, for sale.
 *
 * The one canonical list. `judgeLandCell` in `@happy-farm/application` returns exactly these values,
 * the wire contract's enum is pinned to this list by a contract test, and the web's display map is
 * exhaustive over the contract type - so a reason cannot be added on one side of the wire and
 * silently fail the other side's parser. `NOT_ADJACENT` was removed in V14.5.1B with the adjacency
 * requirement; it must never come back.
 */
export const LAND_CELL_REASONS = [
  "ELIGIBLE",
  "ALREADY_OWNED",
  "NOT_SELLABLE",
  "NOT_DEVELOPABLE",
  "LEVEL_REQUIRED"
] as const;

/** Why a cell is, or is not, for sale. The element type of `LAND_CELL_REASONS`. */
export type LandCellReason = (typeof LAND_CELL_REASONS)[number];

/** The rectangle one plot cohort covers, in tile coordinates. */
export interface PlotBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The square one plot cohort occupies. Derived from `plotOrigin`, never authored twice. */
export function plotBounds(plotIndex: number): PlotBounds {
  const origin = plotOrigin(plotIndex);
  return {
    minX: origin.x,
    maxX: origin.x + PLOT_TILE_SIZE - 1,
    minY: origin.y,
    maxY: origin.y + PLOT_TILE_SIZE - 1
  };
}

/**
 * The plot whose cohort square contains a tile, or null.
 *
 * The starter square is ring 0 and is never for sale, so a tile there answers null. Coordinates are
 * non-negative throughout the farm's expansion geometry, which is what makes the ring arithmetic
 * exact rather than a search: ring `r` holds the plots from `(r-1)(r+1)+1` through `r(r+2)`.
 */
export function plotIndexContaining(coordinate: TileCoordinate): number | null {
  const ring = Math.max(
    Math.floor(coordinate.x / PLOT_TILE_SIZE),
    Math.floor(coordinate.y / PLOT_TILE_SIZE)
  );
  if (ring < 1) return null;
  const first = (ring - 1) * (ring + 1) + 1;
  const last = ring * (ring + 2);
  for (let plotIndex = first; plotIndex <= last; plotIndex += 1) {
    const bounds = plotBounds(plotIndex);
    if (
      coordinate.x >= bounds.minX &&
      coordinate.x <= bounds.maxX &&
      coordinate.y >= bounds.minY &&
      coordinate.y <= bounds.maxY
    ) {
      return plotIndex;
    }
  }
  return null;
}

/**
 * What one cell costs when bought alone.
 *
 * Deterministic integer arithmetic: the enclosing plot's per-cell price, plus the convenience
 * premium, floored, and never below one gold. A price no plot can be built from is refused rather
 * than turned into a free cell.
 */
export function singleCellPrice(plotPrice: number): number {
  if (!Number.isSafeInteger(plotPrice) || plotPrice <= 0) {
    throw new DomainError("INVALID_PLOT", "Plot price is invalid");
  }
  // Divide before multiplying: the per-cell price is a fraction of a gold at the cheap end, and
  // scaling the plot total up front could overflow a safe integer for a pathological catalogue.
  const withPremium = (plotPrice / PLOT_TILE_COUNT) * ((100 + SINGLE_CELL_PREMIUM_PERCENT) / 100);
  return Math.max(1, Math.floor(withPremium));
}

