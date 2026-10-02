/**
 * Which actions need estate precision, and where the estate camera should look when they pull the
 * player out of character view.
 *
 * The product rule is one sentence: **character view is for movement and interaction, estate view is
 * for precise work.** Planting a seed on one cell, putting a barn on four, moving or turning what is
 * already standing - all of that is cell-based editing, and the estate camera is the only one of the
 * two that can see a cell, its neighbours, and the ownership wash at the same time.
 *
 * So when the player asks for one of these while in character view, the game does not answer "not
 * available" - it changes viewpoint and takes the camera to the thing they were working on. This
 * module decides *where* that is, as a pure function, so the answer is a test rather than a rule
 * buried in a click handler.
 */

export type PrecisionActionKind =
  | "PLANT"
  | "BUILD"
  | "MOVE_OBJECT"
  | "ROTATE_OBJECT"
  | "RESTORE_OBJECT";

export interface CellCoordinate {
  readonly x: number;
  readonly y: number;
}

/** Where the estate camera should be aimed when a precision action takes over. */
export type PrecisionFocus =
  | { readonly kind: "PLAYER" }
  | { readonly kind: "CELL"; readonly cell: CellCoordinate };

export interface PrecisionFocusInput {
  /** The cell the player had selected, if any. */
  readonly selected: CellCoordinate | null;
  /**
   * Where the object being edited stands, for the actions that have one.
   *
   * A distinct input from `selected` because moving a barn is about the barn: the selection may have
   * moved on since the player picked it up, and aiming at the object's own anchor is what makes the
   * transition land on the thing they are holding.
   */
  readonly anchor: CellCoordinate | null;
}

/**
 * The focus a precision action wants.
 *
 * Plant and build are about a *cell* - the one the player chose, or the one the game already had in
 * hand; the object actions are about the object. Anything without a place falls back to the player,
 * which is always somewhere sensible to look.
 */
export function precisionFocusFor(
  kind: PrecisionActionKind,
  input: PrecisionFocusInput
): PrecisionFocus {
  if (kind === "MOVE_OBJECT" || kind === "ROTATE_OBJECT" || kind === "RESTORE_OBJECT") {
    return input.anchor === null ? fallbackFocus(input) : { kind: "CELL", cell: input.anchor };
  }
  return fallbackFocus(input);
}

function fallbackFocus(input: PrecisionFocusInput): PrecisionFocus {
  return input.selected === null
    ? { kind: "PLAYER" }
    : { kind: "CELL", cell: input.selected };
}

/**
 * Which precision actions the Build panel and the planting control stand for.
 *
 * One mapping rather than a literal spelled out per call site, so a new cell-based panel has one
 * place to be declared and nothing else has to learn the rule.
 */
export function precisionActionForPanel(panel: "build" | "plant"): PrecisionActionKind {
  return panel === "build" ? "BUILD" : "PLANT";
}

/**
 * Whether a tap on the ground should open the contextual surface.
 *
 * Estate view selects anything a player points at, because selecting *is* the interaction there. In
 * character view the ground is mostly a place to walk, so a tap only opens the surface when the cell
 * actually offers something - the player's own soil to plant, a crop or a tree to inspect. Everywhere
 * else the tap is ignored and the joystick keeps the screen to itself, which is what keeps character
 * view clean without disabling interaction.
 */
export function groundTapOpensContext(input: {
  readonly mode: "ESTATE" | "CHARACTER";
  readonly hasContextAction: boolean;
}): boolean {
  return input.mode === "ESTATE" || input.hasContextAction;
}
