import { tileToWorld, worldFrame, worldToTile, type TileBounds, type TileCoordinate, type WorldFrame } from "./layout";
import type { TerrainShape } from "./terrain-height";

/**
 * The island's one logical coordinate system.
 *
 * Everything in the client that needs to name a piece of ground - what the player selected, where a
 * character is walking, which land may be farmed, which water may one day hold fish cages, which
 * cells a building stands on, where scenery may not go - names a `WorldCell`. Before this module
 * there were four partial answers to the same question (the farm tile, the district blob, the
 * production zone, the interaction grid) and each of them was free to disagree with the others.
 *
 * Three rules make it one system rather than a fifth opinion:
 *
 * 1. **One conversion.** `worldToCell` and `cellToWorld` are the *only* world-position-to-grid
 *    conversions in the client, and they are the existing, tested tile mapping - a cell is a farm
 *    tile, so the two coordinate spaces are the same space rather than two that have to be kept in
 *    step. Nothing anywhere else may divide by a pitch.
 * 2. **Cell size is the tile.** One cell is one world unit of ground on the shipped 1.08 pitch: small
 *    enough that a character can be sent to a cell, large enough that a crop, a tree, a fish cage or
 *    a future building footprint is legible on it, and already the unit the server, the plot
 *    catalogue, the renderer and the player's collision all speak. See ADR 0026.
 * 3. **The grid is data, not drawing.** A cell is never drawn unless the player selected it (or a
 *    developer turned debug mode on). The island stays organic: curved roads, ragged forest edges,
 *    an irregular coast. The grid is how the game *thinks*, not how it looks.
 */

/** What the ground is made of. `BLOCKED` is a cell a walker cannot enter at all. */
export type CellTerrain = "LAND" | "SHORE" | "WATER" | "BLOCKED";

/** What the land is *for*. */
export type CellZone =
  | "NONE"
  | "AGRICULTURE"
  | "AQUACULTURE"
  | "FORESTRY"
  | "MINING"
  | "CIVIC"
  | "WILDERNESS";

/** What is standing on the cell right now. */
export type CellOccupancy = "EMPTY" | "BUILDING" | "SCENERY" | "RESOURCE" | "PRODUCTION";

/** What could be worked *out of* the cell, if the matching system existed. */
export type CellProductionCapability = "NONE" | "CROP" | "AQUACULTURE" | "TIMBER" | "MINING";

/**
 * One cell of the island.
 *
 * A value, not an object with behaviour: the map is rebuilt from server land plus the world config
 * and nothing here reads a clock, a random source, or the network.
 */
export interface WorldCell {
  /** The cell's own coordinate: the same number the farm tile grid and the plot catalogue use. */
  readonly x: number;
  readonly z: number;
  readonly terrain: CellTerrain;
  readonly zone: CellZone;
  readonly walkable: boolean;
  readonly buildable: boolean;
  readonly occupancy: CellOccupancy;
  readonly productionCapability: CellProductionCapability;
  /** The id of the road that crosses this cell, or null. Roads are landscape, not grid lines. */
  readonly road: string | null;
  /**
   * The farm tile this cell stands for, when the cell is inside the land the catalogue can sell.
   *
   * This is the compatibility edge: gameplay still identifies a plantable tile by its coordinates,
   * and the coordinates are the same ones, so the link is an identity rather than a translation. It
   * is `null` outside the reservation, because a cell the server cannot sell is not a farm tile.
   */
  readonly legacyFarmTile: TileCoordinate | null;
}

/** A stable key for a cell coordinate, for Set and Map lookups. */
export function cellKey(x: number, z: number): string {
  return `${String(x)},${String(z)}`;
}

/**
 * The cell a world position falls in.
 *
 * The nearest cell centre, which is what a click on the ground has to resolve to: a player pointing
 * at the middle of a cell must select that cell, not the four it borders.
 */
export function worldToCell(position: { readonly worldX: number; readonly worldZ: number }, frame: WorldFrame = worldFrame()): TileCoordinate {
  return worldToTile(position, frame);
}

/** The world position of a cell's centre. The inverse of `worldToCell`. */
export function cellToWorld(cell: TileCoordinate, frame: WorldFrame = worldFrame()): { readonly worldX: number; readonly worldZ: number } {
  return tileToWorld(cell, frame);
}

export interface WorldCellMap {
  /** The rectangle the map was generated over. Outside it a cell simply does not exist. */
  readonly bounds: TileBounds;
  readonly frame: WorldFrame;
  /** The island's own outline and elevation: what the terrain and every overlay are drawn against. */
  readonly terrain: TerrainShape;
  readonly cells: ReadonlyMap<string, WorldCell>;
  /** Cells that carry each production capability, in a stable order. One list per capability. */
  readonly productionCells: Readonly<Record<Exclude<CellProductionCapability, "NONE">, readonly TileCoordinate[]>>;
  /** Cells a character may be sent to, in a stable order. */
  readonly walkableCells: readonly TileCoordinate[];
}

/** A map with no cells at all: what the renderer holds before the first farm state arrives. */
export const EMPTY_WORLD_CELL_MAP: WorldCellMap = {
  bounds: { minX: 0, maxX: -1, minY: 0, maxY: -1 },
  frame: worldFrame(),
  terrain: {
    centerWorldX: 0,
    centerWorldZ: 0,
    halfWidthWorld: 0,
    halfDepthWorld: 0,
    exponent: 1,
    lobes: [],
    reliefWorld: 0,
    flatAreas: [],
    uplands: []
  },
  cells: new Map(),
  productionCells: { CROP: [], AQUACULTURE: [], TIMBER: [], MINING: [] },
  walkableCells: []
};

/** The cell at a coordinate, or null when the coordinate is not on the map. */
export function worldCellAt(map: WorldCellMap, x: number, z: number): WorldCell | null {
  return map.cells.get(cellKey(x, z)) ?? null;
}

/** The cell at a world position, or null when the position is off the map. */
export function worldCellAtPosition(
  map: WorldCellMap,
  position: { readonly worldX: number; readonly worldZ: number }
): WorldCell | null {
  const cell = worldToCell(position, map.frame);
  return worldCellAt(map, cell.x, cell.y);
}

/**
 * What a piece of ground can produce, given what it is and what it is for.
 *
 * The whole of the land-use rule, in one place, and deliberately *total*: an impossible combination
 * returns `NONE` rather than being handled somewhere else. Water cannot grow a crop; dry land cannot
 * farm a fish; a civic square produces nothing at all.
 */
export function productionCapabilityFor(terrain: CellTerrain, zone: CellZone): CellProductionCapability {
  if (terrain === "BLOCKED") return "NONE";
  if (terrain === "WATER") return zone === "AQUACULTURE" ? "AQUACULTURE" : "NONE";
  // Everything below is dry land: a shore cell is beach, and a beach is not a field.
  if (terrain === "SHORE") return "NONE";
  switch (zone) {
    case "AGRICULTURE":
      return "CROP";
    case "FORESTRY":
      return "TIMBER";
    case "MINING":
      return "MINING";
    case "CIVIC":
    case "WILDERNESS":
    case "AQUACULTURE":
    case "NONE":
      return "NONE";
  }
}

/** Whether a capability and the ground it wants actually agree. The inverse of the rule above. */
export function capabilityFitsTerrain(capability: CellProductionCapability, terrain: CellTerrain): boolean {
  switch (capability) {
    case "NONE":
      return true;
    case "CROP":
    case "TIMBER":
    case "MINING":
      return terrain === "LAND";
    case "AQUACULTURE":
      return terrain === "WATER";
  }
}
