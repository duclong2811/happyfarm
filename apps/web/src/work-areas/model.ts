/**
 * The pure half of the work-area editor: selection, naming and the draft set.
 *
 * The durable model is an explicit list of cells. A rectangle is only how a finger picks them, so the
 * conversion from two corners to the cell list lives here, is bounded by the same cap the server
 * enforces, and is testable without a renderer. Nothing here reads a clock, a network or the DOM.
 */

export const WORK_AREA_KINDS = ["FARM", "ORCHARD", "FORESTRY", "MINING", "LIVESTOCK", "AQUACULTURE", "FISHERY"] as const;
export type WorkAreaKind = (typeof WORK_AREA_KINDS)[number];

/** The i18n key of each kind's name. The catalogue is the client's; the *kind* comes from the server. */
export const WORK_AREA_KIND_LABEL_KEYS: Readonly<Record<WorkAreaKind, string>> = {
  FARM: "workArea.kind.farm",
  ORCHARD: "workArea.kind.orchard",
  FORESTRY: "workArea.kind.forestry",
  MINING: "workArea.kind.mining",
  LIVESTOCK: "workArea.kind.livestock",
  AQUACULTURE: "workArea.kind.aquaculture",
  FISHERY: "workArea.kind.fishery"
};

/** Both bounds repeat the domain's; the editor only uses them to stop a selection early. */
export const MAX_WORK_AREA_CELLS = 256;
export const MAX_WORK_AREA_NAME_LENGTH = 40;

export interface WorkAreaCell {
  readonly x: number;
  readonly y: number;
}

/** A stable key for a cell, so the draft can be a `Set` of strings. */
export function cellKey(cell: WorkAreaCell): string {
  return `${String(cell.x)},${String(cell.y)}`;
}

/** The cell a key came from. */
export function cellFromKey(key: string): WorkAreaCell {
  const [x, y] = key.split(",");
  return { x: Number(x), y: Number(y) };
}

/**
 * The cells a two-corner rectangle covers, inclusive of both corners.
 *
 * Bounded: a drag that would cover more than the cap returns the first `max` cells in reading order
 * and reports the overflow, so the editor can tell the player rather than silently dropping the rest.
 */
export function rectangleCells(
  cornerA: WorkAreaCell,
  cornerB: WorkAreaCell,
  max = MAX_WORK_AREA_CELLS
): { readonly cells: readonly WorkAreaCell[]; readonly overflow: number } {
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  const cells: WorkAreaCell[] = [];
  let overflow = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (cells.length >= max) {
        overflow += 1;
        continue;
      }
      cells.push({ x, y });
    }
  }
  return { cells, overflow };
}

/** Adds one cell to the draft, or removes it when it is already there. Never grows past the cap. */
export function toggleDraftCell(
  draft: ReadonlySet<string>,
  cell: WorkAreaCell,
  max = MAX_WORK_AREA_CELLS
): ReadonlySet<string> {
  const next = new Set(draft);
  const key = cellKey(cell);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  if (next.size >= max) return next;
  next.add(key);
  return next;
}

/** Adds many cells at once (a completed rectangle), stopping at the cap. */
export function addDraftCells(
  draft: ReadonlySet<string>,
  cells: readonly WorkAreaCell[],
  max = MAX_WORK_AREA_CELLS
): ReadonlySet<string> {
  const next = new Set(draft);
  for (const cell of cells) {
    if (next.size >= max) break;
    next.add(cellKey(cell));
  }
  return next;
}

/** The draft as the sorted list the server will store, in the same order the server normalises to. */
export function draftCellList(draft: ReadonlySet<string>): readonly WorkAreaCell[] {
  return [...draft]
    .map(cellFromKey)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export type NameProblem = "EMPTY" | "TOO_LONG" | null;

/**
 * The name as the server would store it, plus whether it is worth sending.
 *
 * Trimming and normalising mirror the domain; the editor trims as the player types so the count it
 * shows is the count the server checks. Duplicates are allowed by design, so nothing here compares
 * two areas' names.
 */
export function normalizeNameInput(raw: string): { readonly value: string; readonly problem: NameProblem } {
  const value = raw.trim().normalize("NFC");
  if (value.length === 0) return { value, problem: "EMPTY" };
  if (Array.from(value).length > MAX_WORK_AREA_NAME_LENGTH) return { value, problem: "TOO_LONG" };
  return { value, problem: null };
}

/**
 * A key that changes only when the drawn management list would change.
 *
 * The panel re-renders from this, so a reload that returns the same areas costs no DOM work - the same
 * idea as the farm's presentation signature, for the same reason.
 */
export function workAreaListSignature(
  areas: readonly { readonly workAreaId: string; readonly displayName: string; readonly kind: string; readonly cellCount: number; readonly version: number }[]
): string {
  return areas
    .map((area) => `${area.workAreaId}:${String(area.version)}:${area.displayName}:${area.kind}:${String(area.cellCount)}`)
    .join("|");
}

/**
 * The ground capability each kind needs, in the client's own `CellCapability` vocabulary.
 *
 * The server's `groundCapabilities` is the authority; this is the *preview's* copy of the same rule,
 * and it is deliberately the same words so a cell the map calls farmland is the cell the server
 * accepts. A client that is wrong here shows a cell as selectable and has the save refused - it can
 * never make the server accept ground it would otherwise reject.
 */
export const WORK_AREA_KIND_CAPABILITY: Readonly<Record<WorkAreaKind, string>> = {
  FARM: "FARM",
  ORCHARD: "FARM",
  FORESTRY: "FORESTRY",
  MINING: "MINING",
  LIVESTOCK: "LIVESTOCK",
  AQUACULTURE: "AQUACULTURE",
  FISHERY: "FISHERY"
};

/** Whether the ground under a cell (its own capability set) can be worked for this kind of area. */
export function cellFitsKind(kind: WorkAreaKind, capabilities: readonly string[]): boolean {
  return capabilities.includes(WORK_AREA_KIND_CAPABILITY[kind]);
}

/**
 * How many cells a preview may look at before it gives up.
 *
 * A rectangle drawn across the whole island would be tens of thousands of cells, and the editor must
 * not build an enormous request or paint an enormous overlay from one stray gesture. The scan is
 * bounded; beyond it the preview simply stops growing, which the counter already reports.
 */
export const MAX_WORK_AREA_PREVIEW_SCAN = 4096;

/**
 * A rectangle split into the cells that fit the kind and those that do not.
 *
 * Both lists are bounded: valid cells stop at the membership cap (the editor can never construct a
 * request the server would refuse) and the whole scan stops at `MAX_WORK_AREA_PREVIEW_SCAN`. The
 * invalid cells are returned so the editor can show them quietly as "not workable" rather than
 * silently dropping them.
 */
export function rectanglePreview(
  cornerA: WorkAreaCell,
  cornerB: WorkAreaCell,
  fits: (cell: WorkAreaCell) => boolean,
  max = MAX_WORK_AREA_CELLS
): { readonly valid: readonly WorkAreaCell[]; readonly invalid: readonly WorkAreaCell[] } {
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  const valid: WorkAreaCell[] = [];
  const invalid: WorkAreaCell[] = [];
  let scanned = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (scanned >= MAX_WORK_AREA_PREVIEW_SCAN) return { valid, invalid };
      scanned += 1;
      const cell = { x, y };
      if (fits(cell)) {
        if (valid.length < max) valid.push(cell);
      } else if (invalid.length < 128) {
        // Only enough to show the shape of what was refused; the count is never used for a rule.
        invalid.push(cell);
      }
    }
  }
  return { valid, invalid };
}

/**
 * Whether a click may still add cells to the draft.
 *
 * The editor's own guard against building a request the server would refuse: at the cap a click is a
 * no-op and the panel explains why, rather than sending 257 cells and being told so.
 */
export function draftHasRoom(draft: ReadonlySet<string>, max = MAX_WORK_AREA_CELLS): boolean {
  return draft.size < max;
}

/** The part of the editor a click can change: the draft and the armed first corner. */
export interface DraftEdit {
  readonly draft: ReadonlySet<string>;
  readonly corner: WorkAreaCell | null;
}

export type DraftClickResult =
  | { readonly kind: "REFUSED"; readonly reason: "INVALID" | "CAP"; readonly next: DraftEdit }
  | {
      readonly kind: "APPLIED";
      readonly next: DraftEdit;
      readonly corner: "ARMED" | "CLEARED";
      /** True when a rectangle was cut short by the cap. */
      readonly truncated: boolean;
    };

/**
 * One click, with one deterministic meaning - the editor's whole input rule.
 *
 * 1. A cell already in the draft is **removed**, and any armed corner is dropped: a removal is never
 *    the start of a rectangle.
 * 2. Otherwise, with no corner armed, the cell is **added** and armed as the first corner - but only
 *    if the kind can be worked there and the cap has room; otherwise the click is refused and changes
 *    nothing.
 * 3. Otherwise the click **fills the rectangle** between the armed corner and this cell, adding only
 *    cells that fit the kind and stopping at the cap, and disarms the corner.
 *
 * `fits` is the caller's ground test, so this stays pure and the caller stays the only place that
 * knows what the island is made of.
 */
export function applyDraftClick(
  current: DraftEdit,
  cell: WorkAreaCell,
  fits: boolean,
  max = MAX_WORK_AREA_CELLS
): DraftClickResult {
  if (current.draft.has(cellKey(cell))) {
    return {
      kind: "APPLIED",
      next: { draft: toggleDraftCell(current.draft, cell, max), corner: null },
      corner: "CLEARED",
      truncated: false
    };
  }
  if (current.corner === null) {
    if (!fits) return { kind: "REFUSED", reason: "INVALID", next: current };
    if (!draftHasRoom(current.draft, max)) return { kind: "REFUSED", reason: "CAP", next: current };
    return {
      kind: "APPLIED",
      next: { draft: toggleDraftCell(current.draft, cell, max), corner: { x: cell.x, y: cell.y } },
      corner: "ARMED",
      truncated: false
    };
  }
  const { valid } = rectanglePreview(current.corner, cell, () => fits, max);
  const room = Math.max(0, max - current.draft.size);
  return {
    kind: "APPLIED",
    next: { draft: addDraftCells(current.draft, valid.slice(0, room), max), corner: null },
    corner: "CLEARED",
    truncated: valid.length > room
  };
}

/** What the renderer draws for one editor state: the draft, the rectangle, the refused ground, hover. */
export interface WorkAreaEditScene {
  readonly draft: readonly WorkAreaCell[];
  readonly preview: readonly WorkAreaCell[];
  readonly invalid: readonly WorkAreaCell[];
  readonly hover: WorkAreaCell | null;
  readonly corner: WorkAreaCell | null;
}

/**
 * The scene state for an editor, or null when there is nothing to draw.
 *
 * A rename has nothing to do with the map, and a session with no hover and no corner draws only the
 * draft. The rectangle between the corner and the pointer is expanded here - and only here - so the
 * rectangle never becomes a stored shape.
 */
export function workAreaEditScene(input: {
  readonly mode: "CREATE" | "CELLS" | "RENAME";
  readonly draft: ReadonlySet<string>;
  readonly corner: WorkAreaCell | null;
  readonly hover: WorkAreaCell | null;
  readonly fits: (cell: WorkAreaCell) => boolean;
}): WorkAreaEditScene | null {
  if (input.mode === "RENAME") return null;
  const board: WorkAreaEditScene = {
    draft: draftCellList(input.draft),
    preview: [],
    invalid: [],
    hover: input.hover,
    corner: input.corner
  };
  if (input.corner !== null && input.hover !== null) {
    const split = rectanglePreview(input.corner, input.hover, input.fits);
    return { ...board, preview: split.valid, invalid: split.invalid };
  }
  if (input.hover !== null && !input.fits(input.hover)) {
    // Before a corner is armed, a hover over ground the kind refuses says so quietly.
    return { ...board, invalid: [input.hover] };
  }
  return board;
}
