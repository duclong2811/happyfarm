import { DomainError } from "./errors";
import type { ConstructionId, FarmId, PlayerId } from "./ids";

/**
 * A thing a player has built, and the rules that decide whether they may.
 *
 * One domain object for every buildable thing, deliberately: a barn, a bench, a silo and a dirt road
 * differ in their *definitions*, not in how they occupy ground. A `ConstructionInstance` is therefore
 * an anchor, a rotation, a footprint, and a pointer at the catalogue entry it came from - it never
 * copies the entry's price, level or effects, so a rebalance changes what the shop says without
 * rewriting what a player already built.
 *
 * The rules here are pure and total: given the ground, the entry, and where the player pointed, either
 * every cell accepts it or the caller is told exactly which rule refused.
 */

/** How far something has been turned, in quarter turns: 0, 1, 2 or 3. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** The rectangular area a construction occupies, in cells, inclusive. */
export interface CellBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** What the ground under one cell is, as the placement rules care about it. */
export interface ConstructionCell {
  readonly x: number;
  readonly y: number;
  /** Whether this cell is owned by the farm the player is building on. */
  readonly owned: boolean;
  readonly terrain: "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";
  readonly capabilities: readonly string[];
  /** True when a crop, a tree or another construction already stands here. */
  readonly occupied: boolean;
}

/** The catalogue's own description of what may be built, as the domain needs it. */
export interface ConstructionDefinition {
  readonly entryId: string;
  readonly category: string;
  readonly requiredLevel: number;
  readonly price: number;
  readonly currencyDefinitionId: string;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  /** What the ground has to be able to do, in the cell vocabulary. */
  readonly capability: string;
  readonly rotatable: boolean;
  /** How live the entry's effect is; a preview-only entry may not be built at all. */
  readonly status: "ACTIVE" | "FOUNDATION_ONLY" | "PREVIEW_ONLY";
  /** Whether the entry may only go on land the player owns. */
  readonly requiresOwnership: boolean;
}

export type ConstructionState = "BUILT";

export interface ConstructionInstance {
  readonly id: ConstructionId;
  readonly farmId: FarmId;
  readonly entryId: string;
  readonly category: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly rotation: QuarterTurns;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  readonly bounds: CellBounds;
  readonly state: ConstructionState;
  readonly builtByPlayerId: PlayerId;
  readonly costAmount: number;
  readonly costCurrencyDefinitionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** Why a construction may not go where the player pointed. */
export type ConstructionRefusal =
  | "OUTSIDE_ISLAND"
  | "NOT_OWNED"
  | "WRONG_GROUND"
  | "NEEDS_CAPABILITY"
  | "OCCUPIED"
  | "VOLCANO"
  | "NOT_CONSTRUCTIBLE"
  | "LEVEL_REQUIRED"
  | "INSUFFICIENT_FUNDS";

/** Normalises any integer into one of the four quarter turns. */
export function normaliseQuarterTurns(turns: number): QuarterTurns {
  if (!Number.isInteger(turns)) {
    throw new DomainError("INVALID_ROTATION", "Rotation must be a whole number of quarter turns");
  }
  return (((turns % 4) + 4) % 4) as QuarterTurns;
}

/** The footprint a definition occupies once it has been turned. */
export function rotatedFootprint(
  footprint: { readonly widthCells: number; readonly depthCells: number },
  rotation: QuarterTurns
): { readonly widthCells: number; readonly depthCells: number } {
  return rotation % 2 === 0
    ? { widthCells: footprint.widthCells, depthCells: footprint.depthCells }
    : { widthCells: footprint.depthCells, depthCells: footprint.widthCells };
}

/**
 * The cells a construction anchored here would cover.
 *
 * The anchor is the cell the player pointed at, and the footprint grows outwards from it with the
 * extra cell on the +x/+y side when a side has an even count - the same convention the world's own
 * tile mapping uses, so a preview, a server check and a saved row all name the same ground.
 */
export function constructionBounds(
  anchor: { readonly x: number; readonly y: number },
  footprint: { readonly widthCells: number; readonly depthCells: number }
): CellBounds {
  if (footprint.widthCells < 1 || footprint.depthCells < 1) {
    throw new DomainError("INVALID_FOOTPRINT", "A footprint must cover at least one cell");
  }
  const startX = anchor.x - Math.floor((footprint.widthCells - 1) / 2);
  const startY = anchor.y - Math.floor((footprint.depthCells - 1) / 2);
  return {
    minX: startX,
    maxX: startX + footprint.widthCells - 1,
    minY: startY,
    maxY: startY + footprint.depthCells - 1
  };
}

/** Every cell of a rectangle, in a stable order. */
export function cellsInBounds(bounds: CellBounds): readonly { readonly x: number; readonly y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) cells.push({ x, y });
  }
  return cells;
}

/** Whether two rectangles share at least one cell. */
export function boundsIntersect(left: CellBounds, right: CellBounds): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

export interface PlacementCheck {
  readonly definition: ConstructionDefinition;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  readonly cells: readonly ConstructionCell[];
  /** The cells an existing construction already covers, including this farm's own. */
  readonly occupied: readonly CellBounds[];
  readonly playerLevel: number;
  readonly balance: number;
}

/**
 * Everything that has to be true before a construction may be created.
 *
 * Returns the first refusal rather than throwing so the caller can map it to a stable external code,
 * and so a test can assert the *reason* rather than only that something failed. `null` means the
 * placement is acceptable: the caller still has to win the race at the database.
 */
export function constructionRefusal(check: PlacementCheck): ConstructionRefusal | null {
  const { definition, footprint, cells, occupied } = check;
  if (definition.status === "PREVIEW_ONLY") return "NOT_CONSTRUCTIBLE";
  if (check.playerLevel < definition.requiredLevel) return "LEVEL_REQUIRED";
  if (check.balance < definition.price) return "INSUFFICIENT_FUNDS";
  if (cells.length !== footprint.widthCells * footprint.depthCells) return "OUTSIDE_ISLAND";

  const bounds = boundsOf(cells);
  for (const existing of occupied) {
    if (boundsIntersect(bounds, existing)) return "OCCUPIED";
  }

  for (const cell of cells) {
    // Ownership first: land the farm does not own is "not yours", whatever it happens to be made of.
    if (definition.requiresOwnership && !cell.owned) return "NOT_OWNED";
    if (cell.terrain === "WATER") {
      // Water may only carry something that asks for water capability, which the capability check
      // below still has to pass.
      if (definition.capability !== "AQUACULTURE") return "WRONG_GROUND";
      continue;
    }
    if (cell.terrain === "VOLCANO") return "VOLCANO";
    if (cell.terrain === "BLOCKED") return "OCCUPIED";
    if (cell.terrain !== "LAND" && definition.capability !== "DOCK") return "WRONG_GROUND";
    if (cell.occupied) return "OCCUPIED";
    if (!cell.capabilities.includes(definition.capability)) return "NEEDS_CAPABILITY";
  }
  return null;
}

/** The rectangle a set of cells covers. */
function boundsOf(cells: readonly { readonly x: number; readonly y: number }[]): CellBounds {
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
  return { minX, maxX, minY, maxY };
}

/**
 * Builds the instance a placement creates.
 *
 * The price written here is the definition's own number, supplied by the caller from the authoritative
 * catalogue - never from a request body. It is recorded on the instance for audit, exactly as the
 * ledger records the same amount from the other side of the transaction.
 */
export function createConstructionInstance(input: {
  readonly id: ConstructionId;
  readonly farmId: FarmId;
  readonly definition: ConstructionDefinition;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly rotation: QuarterTurns;
  readonly builtByPlayerId: PlayerId;
  readonly createdAt: string;
}): ConstructionInstance {
  const footprint = rotatedFootprint(input.definition.footprint, input.rotation);
  const bounds = constructionBounds(input.anchor, footprint);
  return {
    id: input.id,
    farmId: input.farmId,
    entryId: input.definition.entryId,
    category: input.definition.category,
    anchorX: input.anchor.x,
    anchorY: input.anchor.y,
    rotation: input.rotation,
    footprint,
    bounds,
    state: "BUILT",
    builtByPlayerId: input.builtByPlayerId,
    costAmount: input.definition.price,
    costCurrencyDefinitionId: input.definition.currencyDefinitionId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    version: 1
  };
}
