/**
 * Which server-owned farm lists a refresh has to re-read.
 *
 * The client keeps four lists of farm rows - tiles, crops, trees and built objects - and it used to
 * re-read all four after every action. That is a handful of small reads for a crop, but each one is
 * a full-list D1 query, and the two largest (`farm_tiles`, `farm_constructions`) were 86% of the
 * staging database's rows-read in the V16.2.1A audit. Re-reading a list an action cannot have
 * changed buys nothing and costs a farm-wide scan.
 *
 * So a refresh names the lists it needs instead of defaulting to everything:
 *
 * - An action reads only the lists it can move. A harvest reads crops; it cannot touch the tiles
 *   (harvest never updates `farm_tiles`), the trees, or the built objects.
 * - The 5-second growth timer reads crops and trees only - the two lists whose rows age on the
 *   server's clock - and never the tiles or the built objects, which change only when the player acts.
 * - Opening a farm, or pressing Refresh, still reads all four: that is the one moment the page has
 *   no prior state to trust.
 *
 * This is a read-scope decision, not a gameplay one: every mutation and every maturity check is
 * still the server's, and every list that changes is still re-read from it.
 */

/** One boolean per list the farm page holds. `true` means "re-read this from the server". */
export interface FarmRefreshScope {
  readonly tiles: boolean;
  readonly crops: boolean;
  readonly trees: boolean;
  readonly constructions: boolean;
}

/** Opening a farm, or the manual Refresh control: trust nothing the page already had. */
export const FULL_FARM_REFRESH: FarmRefreshScope = {
  tiles: true,
  crops: true,
  trees: true,
  constructions: true
};

/**
 * The growth timer's read.
 *
 * Crops and production trees mature on the server's clock, so those two lists are the only ones a
 * timer has any reason to re-read. Tiles and built objects change only through a player action, and
 * every such action already refreshes them.
 */
export const GROWTH_REFRESH: FarmRefreshScope = {
  tiles: false,
  crops: true,
  trees: true,
  constructions: false
};

/** The farm mutations whose response the page re-reads a list for. */
export type FarmAction =
  | "PLANT_CROP"
  | "HARVEST_CROP"
  | "UPROOT_CROP"
  | "PLANT_TREE"
  | "HARVEST_TREE"
  | "REMOVE_TREE";

/**
 * What each action can change, read from the persistence layer rather than guessed.
 *
 * `farm_tiles` rows are only ever *inserted* - planting or building on a natural cell that has no
 * row yet - so only the two plant actions re-read the tiles. Building and editing update the
 * construction list from their own response, so no farming action needs `constructions` at all.
 */
const ACTION_SCOPES: Readonly<Record<FarmAction, FarmRefreshScope>> = {
  PLANT_CROP: { tiles: true, crops: true, trees: false, constructions: false },
  HARVEST_CROP: { tiles: false, crops: true, trees: false, constructions: false },
  UPROOT_CROP: { tiles: false, crops: true, trees: false, constructions: false },
  PLANT_TREE: { tiles: true, crops: false, trees: true, constructions: false },
  HARVEST_TREE: { tiles: false, crops: false, trees: true, constructions: false },
  REMOVE_TREE: { tiles: false, crops: false, trees: true, constructions: false }
};

/** The lists to re-read after one farm action. */
export function farmRefreshScopeFor(action: FarmAction): FarmRefreshScope {
  return ACTION_SCOPES[action];
}

/** How many list reads a scope performs - the number this module exists to keep small. */
export function farmRefreshReadCount(scope: FarmRefreshScope): number {
  return (scope.tiles ? 1 : 0) + (scope.crops ? 1 : 0) + (scope.trees ? 1 : 0) +
    (scope.constructions ? 1 : 0);
}
