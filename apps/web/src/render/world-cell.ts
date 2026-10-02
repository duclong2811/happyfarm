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

/**
 * What the ground is made of.
 *
 * `BLOCKED` is a cell a walker cannot enter at all. `VOLCANO` is the island's one landmark: its
 * flanks and its crater, which the ground itself classifies so that no caller has to know where the
 * mountain is to know that nothing may be farmed on it.
 */
export type CellTerrain = "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";

/** What the land is *for*. */
export type CellZone =
  | "NONE"
  | "AGRICULTURE"
  | "AQUACULTURE"
  | "FORESTRY"
  | "MINING"
  | "CIVIC"
  | "WILDERNESS"
  /** The volcano's bands, in order: the crater floor, the steep flanks, the forested foothill. */
  | "VOLCANO_CORE"
  | "VOLCANO_SLOPE"
  | "VOLCANO_FOOTHILL";

/** What is standing on the cell right now. */
export type CellOccupancy = "EMPTY" | "BUILDING" | "SCENERY" | "RESOURCE" | "PRODUCTION";

/** What could be worked *out of* the cell, if the matching system existed. */
export type CellProductionCapability = "NONE" | "CROP" | "AQUACULTURE" | "TIMBER" | "MINING";

/**
 * What a cell may be *used for*.
 *
 * This is the new direction's whole land-use idea, in one type. The island does not decide that a
 * patch of ground is an orchard, a field, or a wood: the ground says what it *can* support, and the
 * player's own ownership plus the objects they place decide what it actually becomes. A district is
 * landscape - it changes what grows there and how the place reads - and it never appears in this list.
 *
 * The set is deliberately small, and the same words are used by the build catalogue in
 * `packages/game-data`, so a placeable object names the capability it needs and a cell either has it
 * or does not.
 */
export type CellCapability =
  | "WALK"
  | "BUILD"
  | "FARM"
  | "FORESTRY"
  | "LIVESTOCK"
  | "ROAD"
  | "DECORATION"
  | "AQUACULTURE"
  | "DOCK"
  /**
   * Ground that could be worked for stone one day.
   *
   * Only the volcano's steep flanks carry it, and nothing acts on it yet: the brief for this pass is
   * explicit that mining is a hook, not a system. It exists so that "the mountain is not wasted land"
   * is a fact about the map rather than a note somebody has to remember.
   */
  | "MINING";

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
  /**
   * Whether the *server* says the farm owns this cell.
   *
   * Not "inside the rectangle the catalogue could sell one day" - an existing farm-tile row, which is
   * the same answer planting gets and the same answer the placement command is checked against. The
   * difference matters: a preview that calls a cell owned when the farm has no row for it teaches the
   * player that a placement is legal and then has the server refuse it.
   */
  readonly owned: boolean;
  /**
   * Whether this is water shallow enough to work from - the shelf a moored asset needs.
   *
   * A fact about the island's shape, not a zone: the harbour's own approach is excluded, because a
   * cage moored across the pier is a cage nobody can sail past.
   */
  readonly shallowWater: boolean;
  /**
   * Whether the island keeps this cell for itself.
   *
   * Reserved civic ground, a plot a later building is being held for, and the furnished clearings the
   * composition layer dresses. A player may not build over them; this says "not yours to change",
   * never "not the right industry".
   */
  readonly reserved: boolean;
  readonly walkable: boolean;
  readonly buildable: boolean;
  readonly occupancy: CellOccupancy;
  readonly productionCapability: CellProductionCapability;
  /**
   * What this ground may be used for, whatever a landscape district happens to be drawn over it.
   *
   * Independent of `productionCapability`, which stays the *narrower* "what the server could grant
   * today" answer. A cell can be FARM-capable without being plantable: the reservation still decides
   * which ground the plot catalogue can sell, and this decides which uses the ground could carry.
   */
  readonly capabilities: readonly CellCapability[];
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
  if (terrain === "BLOCKED" || terrain === "VOLCANO") return "NONE";
  if (terrain === "WATER") return zone === "AQUACULTURE" ? "AQUACULTURE" : "NONE";
  // Everything below is dry land: a shore cell is beach, and a beach is not a field.
  if (terrain === "SHORE") return "NONE";
  // Dry land's own answer, and deliberately *not* the zone's: every district in the config used to be
  // able to hand a cell a production capability, and that is exactly the "the island already decided
  // what this land is for" rule this pass removes. Whether any particular cell may actually be
  // planted is the plot catalogue's reservation, which the caller applies; this only says the ground
  // would take a crop.
  // A zone that only water carries, or civic ground, is not a place a crop grows.
  if (zone === "CIVIC" || zone === "AQUACULTURE") return "NONE";
  return "CROP";
}

/**
 * What a piece of ground may be used for, from the ground alone.
 *
 * The one rule the whole player-built island rests on, and it is total: every combination of terrain
 * and landscape zone has an answer here rather than a caller deciding for itself. Two properties are
 * the point of it:
 *
 * * **It is not the district.** An orchard's blob and open countryside give the same answer for the
 *   same ground, because the district is scenery. Land use belongs to the player, and this is the
 *   permission the player's placement is checked against.
 * * **It is not the reservation.** FARM is a capability of any dry cell. Whether a *particular* cell
 *   may be planted is the reservation and the server's business, exactly as before.
 *
 * Order is stable, and the set is small: callers compare it, and a test pins the vocabulary.
 */
export function cellCapabilitiesFor(terrain: CellTerrain, zone: CellZone): readonly CellCapability[] {
  switch (terrain) {
    case "BLOCKED":
      // A building already stands here. Nothing else may be placed, and nothing may be walked into.
      return [];
    case "VOLCANO":
      switch (zone) {
        case "VOLCANO_CORE":
          // The crater: bare stone, no way in, and no way across. It is the one piece of the island
          // that is nobody's land and nobody's route.
          return [];
        case "VOLCANO_SLOPE":
          // The steep ground a walker may cross and a quarry could one day be cut into. No building,
          // no farm, no road.
          return ["WALK", "MINING"];
        default:
          // The foothill the volcano rises out of: ordinary land with a wood on it, minus the ground
          // a farm or a building would want. It is the ring a later expansion pass may reach into.
          return ["WALK", "FORESTRY", "DECORATION"];
      }
    case "WATER":
      // Open water is not a place to build: only planned water carries fish cages, and only a shore
      // cell may meet it with a dock.
      return zone === "AQUACULTURE" ? ["AQUACULTURE"] : [];
    case "SHORE":
      // The beach is walkable, and it is the one ground a dock may stand on - which is what makes
      // "land meets water" the dock's own rule rather than a rectangle somebody authored.
      return ["WALK", "DOCK"];
    case "LAND":
      return ["WALK", "BUILD", "FARM", "FORESTRY", "LIVESTOCK", "ROAD", "DECORATION"];
  }
}

/** Whether a cell carries a capability. The reader for every placement check. */
export function cellHasCapability(cell: WorldCell, capability: CellCapability): boolean {
  return cell.capabilities.includes(capability);
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
