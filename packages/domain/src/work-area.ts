import { DomainError } from "./errors";
import { MAX_TILE_X, MAX_TILE_Y, MIN_TILE_X, MIN_TILE_Y, type TileCoordinate } from "./tile";
import type { FarmId, PlayerId, WorkAreaId } from "./ids";

/**
 * A Work Area: a player-named group of cells the player wants worked.
 *
 * It is orchestration metadata and nothing else. It is **not** land ownership, not a land-use
 * decision, not a placement reservation, and not occupancy: a cell in a work area is still free for
 * any crop, tree, building or node the ordinary rules allow, exactly as if the work area did not
 * exist. `CellCapability` plus the player's own placement still decide what the ground may carry.
 *
 * The model is the V16.2.2 design's (`docs/design/AUTOMATION_LOGISTICS.md` section 7), narrowed to
 * what this slice can honestly implement: a stable id, the farm and zone it stands in, a kind, a
 * player-facing name, a version, and an explicit member-cell set. The durable shape is the explicit
 * cell set; a rectangle is a *selection method* the editor may use, never a stored shape.
 */

/**
 * The kinds a work area may be.
 *
 * Deliberately the same words `CellCapability` already uses on the client (FARM, FORESTRY,
 * LIVESTOCK, MINING, AQUACULTURE, FISHERY) plus ORCHARD, so a kind maps onto a ground capability with no
 * translation table of its own. There is no MIXED kind: an area that is two things at once gives a
 * future Job no deterministic answer for a target, and the design's own warning about ambiguous
 * overlap is best honoured by not inventing the ambiguity in the first place.
 *
 * This is a *stable* set, not a menu of everything coming: LIVESTOCK is structurally stored now
 * (livestock is a V16.3 system) and AQUACULTURE is stored for the fishing/water systems to grow into.
 * No element, specialisation or level restricts which kind a player may make.
 */
export const WORK_AREA_KINDS = ["FARM", "ORCHARD", "FORESTRY", "MINING", "LIVESTOCK", "AQUACULTURE", "FISHERY"] as const;
export type WorkAreaKind = (typeof WORK_AREA_KINDS)[number];

/**
 * The ground capability a work area of each kind needs on every member cell.
 *
 * ORCHARD asks for FARM ground because a production tree grows on the same cell a crop would - the
 * orchard is a *player's* grouping, not a different terrain.
 */
export type WorkAreaGroundCapability = "FARM" | "FORESTRY" | "LIVESTOCK" | "MINING" | "AQUACULTURE" | "FISHERY";

const REQUIRED_GROUND: Readonly<Record<WorkAreaKind, WorkAreaGroundCapability>> = {
  FARM: "FARM",
  ORCHARD: "FARM",
  FORESTRY: "FORESTRY",
  MINING: "MINING",
  LIVESTOCK: "LIVESTOCK",
  AQUACULTURE: "AQUACULTURE",
  FISHERY: "FISHERY"
};

export function requiredGroundCapability(kind: WorkAreaKind): WorkAreaGroundCapability {
  return REQUIRED_GROUND[kind];
}

/**
 * How many cells one work area may hold.
 *
 * A whole starter field is 144 cells and one plot cohort is 144, so 256 comfortably holds the field a
 * player is likely to name while keeping the set a bounded list read. The limit is enforced
 * server-side; the client repeats it only so the editor can grey out an impossible selection.
 */
export const MAX_WORK_AREA_CELLS = 256;

/** The most characters a display name may hold, counted as code points so an emoji is one character. */
export const MAX_WORK_AREA_NAME_LENGTH = 40;

/**
 * The zone a work area of today's game stands in.
 *
 * A location, never a permission - see `docs/design/WORLD_ARCHITECTURE.md` and ADR 0027. It is stored
 * so a future expansion island or shared ground is another zone rather than a redesign, and so a
 * later Job can be scoped by place without inventing a second location model. The vocabulary is the
 * wire's `ZoneKind`; `tests/contracts/work-area-contract.test.ts` pins the two spellings together.
 */
export const HOME_ISLAND_ZONE_KIND = "HOME_ISLAND";
export const HOME_ISLAND_ZONE_PREFIX = "zone_home_island_";

/** The zone id of a farm's home island. Derived from the farm, never accepted from a client. */
export function homeIslandZoneId(farmId: FarmId): string {
  return `${HOME_ISLAND_ZONE_PREFIX}${farmId}`;
}

export interface WorkAreaCell {
  readonly x: number;
  readonly y: number;
}

export interface WorkArea {
  readonly id: WorkAreaId;
  readonly farmId: FarmId;
  /** Where the area stands. Today always the farm's HOME_ISLAND zone; a location, never a permission. */
  readonly zoneKind: string;
  readonly zoneId: string;
  readonly kind: WorkAreaKind;
  readonly displayName: string;
  readonly version: number;
  readonly createdByPlayerId: PlayerId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A stable key for a cell coordinate, for dedupe and Set lookups. */
export function workAreaCellKey(cell: WorkAreaCell): string {
  return `${String(cell.x)},${String(cell.y)}`;
}

export function parseWorkAreaKind(value: string): WorkAreaKind {
  if (!(WORK_AREA_KINDS as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_WORK_AREA", "Work area kind is not recognised");
  }
  return value as WorkAreaKind;
}

/**
 * Characters a name may never contain.
 *
 * Control characters would let a name break a log line or a panel row, and the bidi overrides can
 * make two different names render identically - the classic trick for impersonating another player's
 * area. Every other Unicode character (Vietnamese diacritics, emoji, CJK) is welcome.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what a name must reject
const FORBIDDEN_NAME_CHARACTERS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

/**
 * A display name as it is stored: trimmed, NFC-normalised, non-empty, bounded.
 *
 * Normalisation matters because two byte-different strings can be the same text to a reader, and a
 * name is only ever shown or compared, never used as identity. Length is measured after normalising
 * and in code points, so a 40-character Vietnamese name and a 40-character emoji name both fit.
 */
export function normalizeWorkAreaName(raw: string): string {
  if (typeof raw !== "string") {
    throw new DomainError("INVALID_WORK_AREA", "Work area name must be text");
  }
  const trimmed = raw.trim().normalize("NFC");
  if (trimmed.length === 0) {
    throw new DomainError("INVALID_WORK_AREA", "Work area name cannot be empty");
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(trimmed)) {
    throw new DomainError("INVALID_WORK_AREA", "Work area name contains characters that are not allowed");
  }
  if (Array.from(trimmed).length > MAX_WORK_AREA_NAME_LENGTH) {
    throw new DomainError("INVALID_WORK_AREA", "Work area name is too long");
  }
  return trimmed;
}

/**
 * The member set as it is stored: integers inside the world, de-duplicated, ordered, bounded.
 *
 * Ordering is by y then x so the same selection always produces the same list, which keeps responses
 * and tests deterministic. Duplicates collapse silently - two corner drags over the same cell are a
 * player's imprecision, not an error - but the cap is checked *after* collapsing so a repeated
 * selection cannot be used to smuggle in more cells than allowed.
 */
export function normalizeWorkAreaCells(cells: readonly TileCoordinate[]): readonly WorkAreaCell[] {
  if (!Array.isArray(cells)) {
    throw new DomainError("INVALID_WORK_AREA", "Work area cells must be a list");
  }
  const input: readonly TileCoordinate[] = cells as readonly TileCoordinate[];
  const unique = new Map<string, WorkAreaCell>();
  for (const cell of input) {
    if (
      typeof cell !== "object" ||
      !Number.isInteger(cell.x) ||
      !Number.isInteger(cell.y) ||
      cell.x < MIN_TILE_X ||
      cell.x > MAX_TILE_X ||
      cell.y < MIN_TILE_Y ||
      cell.y > MAX_TILE_Y
    ) {
      throw new DomainError("INVALID_WORK_AREA", "Work area cell coordinates are invalid");
    }
    const normalized: WorkAreaCell = { x: cell.x, y: cell.y };
    unique.set(workAreaCellKey(normalized), normalized);
  }
  if (unique.size > MAX_WORK_AREA_CELLS) {
    throw new DomainError("WORK_AREA_TOO_MANY_CELLS", "Work area holds too many cells");
  }
  return [...unique.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Whether the ground under a cell can carry the kind's work. The editor's and the server's rule. */
export function workAreaGroundSupports(
  kind: WorkAreaKind,
  capabilities: readonly WorkAreaGroundCapability[]
): boolean {
  return capabilities.includes(requiredGroundCapability(kind));
}

/**
 * Whether two work areas of the same kind may share a cell.
 *
 * V1 permits overlap, deliberately. A work area is orchestration metadata, not occupancy, so two
 * honest groupings of the same ground (an orchard that is also the east half of the fruit plan) are
 * not an inconsistency to refuse. Exclusivity would quietly turn membership into a soft land
 * reservation, which the whole free-land model exists to avoid. The UI warns about an overlap; the
 * server stores both. A future Job resolves a shared target deterministically by its own priority.
 */
export const WORK_AREAS_MAY_OVERLAP = true;

/** Refuses an edit made against a version the area has already moved past. */
export function assertWorkAreaVersion(area: Pick<WorkArea, "version">, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || area.version !== expectedVersion) {
    throw new DomainError("CONFLICT_STALE_STATE", "Work area changed since it was read");
  }
}

/** The area after a rename: the name changed, the version moved, nothing else. */
export function renameWorkArea(area: WorkArea, rawName: string, timestamp: string): WorkArea {
  return { ...area, displayName: normalizeWorkAreaName(rawName), version: area.version + 1, updatedAt: timestamp };
}

/** The area after a membership replacement: the version moved, the name and kind did not. */
export function retargetWorkAreaCells(area: WorkArea, timestamp: string): WorkArea {
  return { ...area, version: area.version + 1, updatedAt: timestamp };
}
