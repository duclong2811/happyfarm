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
 *
 * **Land use is the player's.** A normal owned cell is ground a player may build on, whatever a
 * landscape district happens to be drawn over it: there is no FARM, FORESTRY, BUILD or DECORATION
 * capability to satisfy, and no economic zone to be inside. What remains is the short list of things
 * that are physically or legally true - the ground the asset asks for, whose land it is, what is
 * already standing there, and the ground the island keeps for itself. The *asset* says which terrain
 * it can live on; the cell says what it is.
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
  /**
   * Legacy ownership flag, retained while callers still compute it.
   *
   * V14.5.2 removed its meaning: ownership is not a placement boundary, because the natural Home
   * Island is already the player's to develop. Nothing reads it.
   */
  readonly owned?: boolean;
  readonly terrain: "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";
  /**
   * Whether this water is workable shallows rather than open sea.
   *
   * A moored asset - a fish cage, a jetty - needs water shallow enough to stand in and reach, and the
   * island's shelf is a fact about its shape rather than a zone somebody drew. Dry cells are never
   * shallow.
   */
  readonly shallowWater: boolean;
  /**
   * Whether the island keeps this cell for itself.
   *
   * The crater, the village's own buildings and their reserved ground, the harbour's approach and the
   * island's authored infrastructure are places a player may not build over. This is a *protected
   * area*, not an economic district: it says "not yours to change", never "not the right industry".
   */
  readonly protectedGround: boolean;
  /** True when a crop, a tree or another construction already stands here. */
  readonly occupied: boolean;
}

/**
 * The ground an asset may stand on, as the asset itself declares it.
 *
 * `WATER` is open water, which nothing may use today; `SHALLOW_WATER` is the shelf a moored asset
 * needs. The vocabulary is the physical one, so a future dock, cage or boat declares what it needs
 * instead of the island declaring where it is allowed.
 */
export const CONSTRUCTION_GROUNDS = ["LAND", "SHORE", "SHALLOW_WATER", "WATER"] as const;
export type ConstructionGround = (typeof CONSTRUCTION_GROUNDS)[number];

/** The catalogue's own description of what may be built, as the domain needs it. */
export interface ConstructionDefinition {
  readonly entryId: string;
  readonly category: string;
  readonly requiredLevel: number;
  readonly price: number;
  readonly currencyDefinitionId: string;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  /** Every kind of ground this entry may stand on. At least one; the cell still has to agree. */
  readonly allowedTerrain: readonly ConstructionGround[];
  readonly rotatable: boolean;
  /** Whether the player may pick it up and put it down somewhere else. */
  readonly movable: boolean;
  /**
   * Whether the player may put it into storage instead of destroying it.
   *
   * Storage is the *safe* remodeling action: a valuable object leaves the island and can be placed
   * again without being bought again. It is deliberately a separate policy from removal, because the
   * two mean different things to a player deciding what to do with a mill.
   */
  readonly storable: boolean;
  /** Whether the player may remove it. */
  readonly removable: boolean;
  /** The share of its price a removal returns, 0..1. The server's number, never the client's. */
  readonly removalRefundRate: number;
  /** How live the entry's effect is; a preview-only entry may not be built at all. */
  readonly status: "ACTIVE" | "FOUNDATION_ONLY" | "PREVIEW_ONLY";
  /** Whether the entry may only go on land the player owns. */
  readonly requiresOwnership: boolean;
}

/**
 * Where an object came from.
 *
 * Provenance, and nothing else: it never decides what may be done to an object. A starter tree and a
 * bought tree are edited by the same policy; the only thing the source changes is that a starter
 * object carries the placement key its seeding was idempotent by.
 */
export type ConstructionSource = "STARTER" | "PLAYER_PLACED";

/** Standing on the island, or held in the player's storage. */
export type ConstructionState = "ACTIVE" | "STORED";

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
  /** Who the object belongs to. For a starter object this is the farm's owner, who owns it by fiat. */
  readonly ownerPlayerId: PlayerId;
  readonly source: ConstructionSource;
  /** A starter placement's stable identity, or null for anything a player placed. */
  readonly placementKey: string | null;
  /** What this object actually cost its owner. Refunds are a share of *this*, never of the price. */
  readonly paidAmount: number;
  readonly costAmount: number;
  readonly costCurrencyDefinitionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When it was put into storage, or null while it stands on the island. */
  readonly storedAt: string | null;
  readonly version: number;
}

/** Why a construction may not go where the player pointed. */
export type ConstructionRefusal =
  | "OUTSIDE_ISLAND"
  | "INVALID_TERRAIN"
  | "OCCUPIED"
  | "BLOCKED"
  | "NOT_CONSTRUCTIBLE"
  | "LEVEL_REQUIRED"
  | "INSUFFICIENT_FUNDS"
  /** The object exists and is the actor's; its asset policy forbids this edit. */
  | "NOT_MOVABLE"
  | "NOT_ROTATABLE"
  | "NOT_STORABLE"
  | "NOT_REMOVABLE";

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
 *
 * The anchor may be fractional, and that is the V13.3.1 addition: the island's own objects - a tree
 * the generator grew, an authored building - stand at a world position, not on a grid, and rounding
 * every one of them onto a cell would visibly re-plant the island. The *cells* the object occupies
 * are still whole: the anchor's own cell is the one it stands in, and the footprint grows from there,
 * so ownership, occupancy and the crop/tree checks keep working on the integer grid.
 */
export function constructionBounds(
  anchor: { readonly x: number; readonly y: number },
  footprint: { readonly widthCells: number; readonly depthCells: number }
): CellBounds {
  if (footprint.widthCells < 1 || footprint.depthCells < 1) {
    throw new DomainError("INVALID_FOOTPRINT", "A footprint must cover at least one cell");
  }
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    throw new DomainError("INVALID_FOOTPRINT", "A construction must stand at a finite position");
  }
  const startX = Math.floor(anchor.x) - Math.floor((footprint.widthCells - 1) / 2);
  const startY = Math.floor(anchor.y) - Math.floor((footprint.depthCells - 1) / 2);
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
 * The ground rules, shared by placing, moving and turning.
 *
 * This is deliberately the whole of the "freeform" rule, and it is short: the asset's own terrain,
 * whose land it is, what the island keeps for itself, and what already stands there. Nothing here
 * asks what the land is *for*, because that is the player's decision and not the map's.
 *
 * `ignoreBounds` is the rectangle an object already covers - its own. A move re-checks the ground
 * around the object it is moving, and the object is not an obstacle to itself; every *other*
 * placement still is.
 *
 * Returns the first refusal rather than throwing, so the caller can map it to a stable external code
 * and a test can assert the *reason* rather than only that something failed.
 */
export interface GroundCheck {
  readonly definition: ConstructionDefinition;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  readonly cells: readonly ConstructionCell[];
  readonly occupied: readonly CellBounds[];
  readonly ignoreBounds?: CellBounds;
}

export function groundRefusal(check: GroundCheck): ConstructionRefusal | null {
  const { definition, footprint, cells, occupied, ignoreBounds } = check;
  if (cells.length !== footprint.widthCells * footprint.depthCells) return "OUTSIDE_ISLAND";

  const bounds = boundsOf(cells);
  for (const existing of occupied) {
    if (ignoreBounds !== undefined && sameBounds(existing, ignoreBounds)) continue;
    if (boundsIntersect(bounds, existing)) return "OCCUPIED";
  }

  for (const cell of cells) {
    // Ground the island keeps for itself - the crater, the village's own buildings, the harbour's
    // approach. Different from "somebody built here", which is `OCCUPIED`.
    if (cell.protectedGround || cell.terrain === "VOLCANO" || cell.terrain === "BLOCKED") return "BLOCKED";
    if (cell.occupied) return "OCCUPIED";
    if (!terrainAccepts(definition.allowedTerrain, cell)) return "INVALID_TERRAIN";
  }
  return null;
}

/** Whether an asset that asks for these grounds may stand on this cell. */
export function terrainAccepts(allowed: readonly ConstructionGround[], cell: ConstructionCell): boolean {
  switch (cell.terrain) {
    case "LAND":
      return allowed.includes("LAND");
    case "SHORE":
      return allowed.includes("SHORE");
    case "WATER":
      // A moored asset needs shallows it can be worked from; open water carries nothing today.
      return cell.shallowWater ? allowed.includes("SHALLOW_WATER") : allowed.includes("WATER");
    case "VOLCANO":
    case "BLOCKED":
      // Answered before this is asked: nothing may stand on either.
      return false;
  }
}

/**
 * Everything that has to be true before a construction may be *created*: the ground, and the three
 * things only a new placement has to pay for.
 */
export function constructionRefusal(check: PlacementCheck): ConstructionRefusal | null {
  const { definition, footprint, cells, occupied } = check;
  if (definition.status === "PREVIEW_ONLY") return "NOT_CONSTRUCTIBLE";
  if (check.playerLevel < definition.requiredLevel) return "LEVEL_REQUIRED";
  if (check.balance < definition.price) return "INSUFFICIENT_FUNDS";
  return groundRefusal({ definition, footprint, cells, occupied });
}

/**
 * What a move and a turn are checked against: the same ground rules, without the three questions only
 * a *new* placement has to answer (a move does not re-check the level, and it costs nothing).
 */
export type EditCheck = GroundCheck;

/** The refusals that only a *move* has to answer, on top of the same ground rules. */
export function moveRefusal(check: EditCheck): ConstructionRefusal | null {
  if (!check.definition.movable) return "NOT_MOVABLE";
  return groundRefusal(check);
}

/** The refusals that only a *rotation* has to answer, on top of the same ground rules. */
export function rotationRefusal(check: EditCheck): ConstructionRefusal | null {
  if (!check.definition.rotatable) return "NOT_ROTATABLE";
  return groundRefusal(check);
}

/** Whether a definition may be removed at all. The refund is the caller's other half. */
export function removalRefusal(definition: ConstructionDefinition): ConstructionRefusal | null {
  return definition.removable ? null : "NOT_REMOVABLE";
}

/**
 * What a removal returns to the player, in the currency the object was bought with.
 *
 * The rate is the *asset's* own number, so a decoration may return nothing, a road a quarter of its
 * gravel, and a building half of what it cost in materials. It is a definition, never a constant in
 * the removal path, so rebalancing is a table edit rather than a rewrite.
 */
/**
 * The object, moved and/or turned: the same identity, the same owner, the same ledger history, new
 * ground and one version further on.
 *
 * `version` is what makes a move safe against a second player acting on a stale copy of the row: the
 * repository writes only when the version it read is still the version in the database.
 */
export function moveConstruction(
  instance: ConstructionInstance,
  input: {
    readonly anchor: { readonly x: number; readonly y: number };
    readonly rotation: QuarterTurns;
    readonly footprint: { readonly widthCells: number; readonly depthCells: number };
    readonly updatedAt: string;
  }
): ConstructionInstance {
  return {
    ...instance,
    anchorX: input.anchor.x,
    anchorY: input.anchor.y,
    rotation: input.rotation,
    footprint: input.footprint,
    bounds: constructionBounds(input.anchor, input.footprint),
    updatedAt: input.updatedAt,
    version: instance.version + 1
  };
}

/** Whether two rectangles name the same ground. */
function sameBounds(left: CellBounds, right: CellBounds): boolean {
  return left.minX === right.minX && left.maxX === right.maxX && left.minY === right.minY && left.maxY === right.maxY;
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
  readonly ownerPlayerId: PlayerId;
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
    state: "ACTIVE",
    ownerPlayerId: input.ownerPlayerId,
    source: "PLAYER_PLACED",
    placementKey: null,
    // The catalogue's own price is what the player paid, because placing is what pays it.
    paidAmount: input.definition.price,
    costAmount: input.definition.price,
    costCurrencyDefinitionId: input.definition.currencyDefinitionId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    storedAt: null,
    version: 1
  };
}

/**
 * A starter object: seeded, not placed.
 *
 * Two differences from a placed one, and both are the point of the whole provenance model. It cost
 * its owner **nothing** (`paidAmount` is zero, so no removal can ever mint gold from it), and it
 * carries the stable `placementKey` its seeding is idempotent by. Its *edit* policy is identical to
 * a bought object's, because editability comes from the definition rather than from where a thing
 * came from.
 */
export function createStarterConstructionInstance(input: {
  readonly id: ConstructionId;
  readonly farmId: FarmId;
  readonly definition: ConstructionDefinition;
  readonly placementKey: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly rotation: QuarterTurns;
  readonly ownerPlayerId: PlayerId;
  readonly createdAt: string;
}): ConstructionInstance {
  const footprint = rotatedFootprint(input.definition.footprint, input.rotation);
  return {
    id: input.id,
    farmId: input.farmId,
    entryId: input.definition.entryId,
    category: input.definition.category,
    anchorX: input.anchor.x,
    anchorY: input.anchor.y,
    rotation: input.rotation,
    footprint,
    bounds: constructionBounds(input.anchor, footprint),
    state: "ACTIVE",
    ownerPlayerId: input.ownerPlayerId,
    source: "STARTER",
    placementKey: input.placementKey,
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: input.definition.currencyDefinitionId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    storedAt: null,
    version: 1
  };
}

/**
 * What a removal returns to the player.
 *
 * A share of what the object **actually cost its owner** - never of the catalogue's current price. A
 * starter mill cost nothing, so it returns nothing, however much a new one would cost; that is the
 * P0 invariant that stops "remove the free mill, keep the gold, start another farm".
 */
export function removalRefund(instance: ConstructionInstance, definition: ConstructionDefinition): number {
  const rate = Math.min(1, Math.max(0, definition.removalRefundRate));
  const paid = Math.max(0, Math.min(instance.paidAmount, instance.costAmount));
  return Math.floor(paid * rate);
}

export function storageRefusal(definition: ConstructionDefinition): ConstructionRefusal | null {
  return definition.storable ? null : "NOT_STORABLE";
}

/**
 * The object, put into storage: the same row, the same identity, the same version chain.
 *
 * Storage keeps the row rather than moving it to a second table, which is what makes the duplication
 * exploit impossible: there is one object, and this is its state. The anchor is left where it was so
 * a restore can start from the last place the player had it, and the rectangle stops occupying ground
 * the moment the state says `STORED`.
 */
export function storeConstruction(instance: ConstructionInstance, updatedAt: string): ConstructionInstance {
  return { ...instance, state: "STORED", storedAt: updatedAt, updatedAt, version: instance.version + 1 };
}

/** The object, taken back out of storage at the ground the player chose. */
export function restoreConstruction(
  instance: ConstructionInstance,
  input: {
    readonly anchor: { readonly x: number; readonly y: number };
    readonly rotation: QuarterTurns;
    readonly footprint: { readonly widthCells: number; readonly depthCells: number };
    readonly updatedAt: string;
  }
): ConstructionInstance {
  return {
    ...instance,
    state: "ACTIVE",
    storedAt: null,
    anchorX: input.anchor.x,
    anchorY: input.anchor.y,
    rotation: input.rotation,
    footprint: input.footprint,
    bounds: constructionBounds(input.anchor, input.footprint),
    updatedAt: input.updatedAt,
    version: instance.version + 1
  };
}
