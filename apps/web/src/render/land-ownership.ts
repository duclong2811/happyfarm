import { cellKey, type WorldCell, type WorldCellMap } from "./world-cell";
import type { TileCoordinate } from "./layout";

/**
 * Who owns which ground, and which ground could come next.
 *
 * The island gives the player a small piece of land and a way to grow it. This module is that idea
 * as data: the map is cut into fixed parcels, the parcels the player already owns are read from the
 * authoritative tiles, and the parcels next to them become the eligible ones.
 *
 * Three rules make it trustworthy:
 *
 * * **It is not authority.** Ownership here is a projection of the land the *server* said the player
 *   owns (`farm_tiles`). Nothing in this file can grant land, price it, or take a payment; a purchase
 *   is still the plot catalogue's business, and this only says which parcel a purchase would be for.
 * * **It is derived, not authored.** Parcels are cut on a fixed grid from the cell map, so they are
 *   the same on every client and after every refresh, and no hand-written block table can drift out
 *   of step with the island.
 * * **The rules are about ground, not about scenery.** A parcel is purchasable when it is developable
 *   land, next to what the player already has, and not protected - never because a district says so.
 *
 * Deliberately *not* here: prices, levels, currency, and the purchase command. The brief for this
 * pass asks for the foundation only, and a half-built economy is worse than none.
 */

/**
 * How many cells on a side one purchasable parcel has.
 *
 * Four, so a parcel is sixteen cells: small enough that a purchase is a decision about *where* rather
 * than about whether, large enough that a player is not buying ground a tile at a time. The starter
 * square is three parcels by three.
 */
export const EXPANSION_PARCEL_CELLS = 4;

/** Why a parcel may not be bought, or null when nothing protects it. */
export type ProtectedReason =
  | "VOLCANO"
  | "VILLAGE"
  | "HARBOUR"
  | "WATER"
  | "BARREN";

/** One parcel of ground, in cell coordinates. */
export interface ExpansionBlock {
  /**
   * The parcel's stable identity: its position on the parcel grid.
   *
   * A name derived from the grid rather than from an index in a list, so the id of the parcel at a
   * given place is the same on every client, in every session, and after the island changes.
   */
  readonly id: string;
  /** The cells the parcel covers, row by row. */
  readonly cells: readonly TileCoordinate[];
  readonly center: TileCoordinate;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** The parcel grid coordinates the id is built from. */
  readonly gridX: number;
  readonly gridY: number;
}

/** What the player may do with one parcel. */
export interface ExpansionBlockState {
  readonly block: ExpansionBlock;
  readonly owned: boolean;
  /** Developable land that is not protected. */
  readonly developable: boolean;
  readonly protectedReason: ProtectedReason | null;
  /** Next to ground the player already owns, so a purchase would not be an island of its own. */
  readonly adjacentToOwned: boolean;
  /** Ready to be bought: developable, unprotected, adjacent, and not already the player's. */
  readonly eligible: boolean;
}

export interface LandOwnership {
  readonly parcelSize: number;
  readonly blocks: readonly ExpansionBlockState[];
  /** Every cell the server says the player owns, as `x,y` keys. */
  readonly ownedCells: ReadonlySet<string>;
  readonly ownedBlocks: readonly string[];
  readonly eligibleBlocks: readonly string[];
  readonly ownedCellCount: number;
  /** Every cell on the island that is developable land, whatever its ownership. */
  readonly developableCellCount: number;
}

export interface LandOwnershipInput {
  readonly cells: WorldCellMap;
  /** The land the server says the player owns, in cell coordinates. */
  readonly ownedTiles: readonly TileCoordinate[];
  readonly parcelSize?: number;
}

function parcelId(gridX: number, gridY: number): string {
  return `parcel_${String(gridX)}_${String(gridY)}`;
}

/**
 * Whether the island keeps this cell for itself.
 *
 * Read off the cell's own answers rather than from a coordinate list: the crater is protected because
 * it carries no capability, the village because it is civic ground, the harbour because it is shore,
 * and open water because nothing may be built on it.
 */
function protectionOf(cell: WorldCell): ProtectedReason | null {
  if (cell.terrain === "VOLCANO" && cell.zone === "VOLCANO_CORE") return "VOLCANO";
  if (cell.terrain === "WATER") return "WATER";
  if (cell.terrain === "SHORE") return "HARBOUR";
  if (cell.terrain === "BLOCKED" || cell.occupancy === "BUILDING") return "VILLAGE";
  if (cell.zone === "CIVIC") return "VILLAGE";
  return null;
}

/**
 * Whether a cell is land the player could develop.
 *
 * `BUILD` is the capability that says a parcel can *become* something: a cell that can hold a
 * building, a road, and a crop is developable, and the volcano's flanks - which carry `WALK` and
 * nothing else - are not.
 */
function isDevelopable(cell: WorldCell): boolean {
  return cell.capabilities.includes("BUILD") && cell.capabilities.includes("FARM");
}

/** Cuts the island into parcels and answers what the player owns and what comes next. */
export function buildLandOwnership(input: LandOwnershipInput): LandOwnership {
  const parcelSize = input.parcelSize ?? EXPANSION_PARCEL_CELLS;
  if (!Number.isInteger(parcelSize) || parcelSize < 1) {
    throw new Error(`parcel size must be a positive whole number of cells: ${String(parcelSize)}`);
  }

  const ownedCells = new Set(input.ownedTiles.map((tile) => cellKey(tile.x, tile.y)));
  const blocks = new Map<string, ExpansionBlockState>();
  let developableCellCount = 0;

  for (const cell of input.cells.cells.values()) {
    if (isDevelopable(cell)) developableCellCount += 1;
    const gridX = Math.floor(cell.x / parcelSize);
    const gridY = Math.floor(cell.z / parcelSize);
    const id = parcelId(gridX, gridY);
    let state = blocks.get(id);
    if (state === undefined) {
      const minX = gridX * parcelSize;
      const minY = gridY * parcelSize;
      const cells: TileCoordinate[] = [];
      for (let y = minY; y < minY + parcelSize; y += 1) {
        for (let x = minX; x < minX + parcelSize; x += 1) cells.push({ x, y });
      }
      state = {
        block: {
          id,
          cells,
          center: { x: minX + (parcelSize - 1) / 2, y: minY + (parcelSize - 1) / 2 },
          minX,
          maxX: minX + parcelSize - 1,
          minY,
          maxY: minY + parcelSize - 1,
          gridX,
          gridY
        },
        owned: false,
        developable: false,
        protectedReason: null,
        adjacentToOwned: false,
        eligible: false
      };
      blocks.set(id, state);
    }

    const reason = protectionOf(cell);
    const owned = ownedCells.has(cellKey(cell.x, cell.z));
    // A parcel takes the *strongest* fact any of its cells carries. One crater cell makes the whole
    // parcel the volcano's, which is the rule that keeps a purchase from nibbling at the rim.
    const merged: ExpansionBlockState = {
      block: state.block,
      owned: state.owned || owned,
      developable: state.developable || isDevelopable(cell),
      protectedReason: state.protectedReason ?? reason,
      adjacentToOwned: state.adjacentToOwned,
      eligible: state.eligible
    };
    blocks.set(id, merged);
  }

  // Adjacency: a parcel touches the player's ground when it is one step away, including diagonally,
  // from a parcel the player owns. Computed after the first pass so the order of cells cannot matter.
  const ownedBlocks = new Set<string>();
  for (const state of blocks.values()) {
    if (state.owned) ownedBlocks.add(state.block.id);
  }
  const adjacent = new Set<string>();
  for (const state of blocks.values()) {
    if (state.owned) continue;
    if (isAdjacent(state.block, ownedBlocks)) adjacent.add(state.block.id);
  }

  const resolved: ExpansionBlockState[] = [...blocks.values()]
    .map((state) => {
      const adjacentToOwned = adjacent.has(state.block.id);
      const eligible =
        !state.owned && state.developable && state.protectedReason === null && adjacentToOwned;
      return { ...state, adjacentToOwned, eligible };
    })
    .sort((left, right) => left.block.id.localeCompare(right.block.id));

  return {
    parcelSize,
    blocks: resolved,
    ownedCells,
    ownedBlocks: resolved.filter((state) => state.owned).map((state) => state.block.id),
    eligibleBlocks: resolved.filter((state) => state.eligible).map((state) => state.block.id),
    ownedCellCount: ownedCells.size,
    developableCellCount
  };
}

/** Whether a parcel is one step from any of the given parcels, diagonals included. */
function isAdjacent(block: ExpansionBlock, otherIds: ReadonlySet<string>): boolean {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      if (otherIds.has(parcelId(block.gridX + dx, block.gridY + dy))) return true;
    }
  }
  return false;
}

/**
 * The share of the island's developable land the player owns, 0..1.
 *
 * Reported rather than enforced: the number is what a design review looks at, and nothing in the
 * client may change it, because how much land a player starts with is the server's plot catalogue.
 */
export function ownedShare(ownership: LandOwnership): number {
  if (ownership.developableCellCount === 0) return 0;
  return ownership.ownedCellCount / ownership.developableCellCount;
}
