import type { WorldCellMap } from "./render/world-cell";
import type { TileCoordinate } from "./render/layout";

/**
 * The client's half of object editing, as decisions rather than as DOM.
 *
 * Everything the panel and the ghost need to know is one of these questions: is the selected row still
 * the server's current one, which actions does the asset allow, what would a removal return, and which
 * cells are the player's. They are pure functions over the state the page already holds, so the
 * answers can be asserted without a browser - which is the point: the live failures this pass fixes
 * were *interaction* failures, and an interaction layer with no tests is where they hide.
 */

/** The part of a catalogue entry that decides what may be done to an instance of it. */
export interface EditableAssetPolicy {
  readonly movable: boolean;
  readonly rotatable: boolean;
  readonly removable: boolean;
}

export interface EditableActions {
  readonly move: boolean;
  readonly rotate: boolean;
  readonly remove: boolean;
}

/**
 * The actions to offer for a selected object.
 *
 * No asset policy means no actions: a row whose catalogue entry the client does not have is a row it
 * cannot describe, and offering a button that guesses would be worse than offering none.
 */
export function editableActions(policy: EditableAssetPolicy | null): EditableActions {
  if (policy === null) return { move: false, rotate: false, remove: false };
  return { move: policy.movable, rotate: policy.rotatable, remove: policy.removable };
}

/** What the asset's policy would return for a removal. The server computes the real number. */
export function refundPreview(price: number, removalRefundRate: number): number {
  const rate = Math.min(1, Math.max(0, removalRefundRate));
  return Math.floor(Math.max(0, price) * rate);
}

/**
 * The row the player has selected, resolved from the list the server last reported.
 *
 * By **id**, never by object reference: every poll replaces the list with fresh objects, so a panel
 * holding an old row would show an old version and then send that version to the server - which would
 * refuse the edit as stale. Resolving by id on every read means the panel always describes the row
 * the server actually has, and a row that has been removed (here or in another tab) simply resolves
 * to nothing, which clears the selection.
 */
export function selectedRow<T extends { readonly constructionId: string }>(
  rows: readonly T[],
  selectedId: string | null
): T | null {
  if (selectedId === null) return null;
  return rows.find((row) => row.constructionId === selectedId) ?? null;
}

/**
 * The cells the player owns, as the cells the ownership mark draws.
 *
 * The server's land, through the map's own `owned` flag - not the reservation the plot catalogue could
 * one day sell. This is what the player never had: a way to see, while placing something, where "here"
 * actually is.
 */
export function ownedCells(cells: WorldCellMap): readonly TileCoordinate[] {
  const owned: TileCoordinate[] = [];
  for (const cell of cells.cells.values()) {
    if (cell.owned) owned.push({ x: cell.x, y: cell.z });
  }
  return owned;
}

/**
 * Whether to draw the ownership mark, and for which cells.
 *
 * Only while the player is *using* the land: placing something, or carrying something to a new cell.
 * Normal play shows no grid and no ownership - the island stays a place rather than a spreadsheet -
 * and a mode that ends takes the mark with it.
 */
export function ownershipOverlayFor(input: {
  readonly placing: boolean;
  readonly moving: boolean;
  readonly cells: WorldCellMap;
}): readonly TileCoordinate[] | null {
  if (!input.placing && !input.moving) return null;
  return ownedCells(input.cells);
}

/**
 * The bounds of the owned parcel, for the developer diagnostic.
 *
 * A human asked why the placement ghost kept saying "you do not own that land yet" and had no way to
 * answer it from the screen; this is that answer, behind `?debug=1` and nowhere else.
 */
export interface OwnedBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly count: number;
}

export function ownedBounds(cells: readonly TileCoordinate[]): OwnedBounds | null {
  if (cells.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minY = Math.min(minY, cell.y);
    maxY = Math.max(maxY, cell.y);
  }
  return { minX, maxX, minY, maxY, count: cells.length };
}
