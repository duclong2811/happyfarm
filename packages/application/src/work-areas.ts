import {
  DomainError,
  HOME_ISLAND_ZONE_KIND,
  assertWorkAreaVersion,
  homeIslandZoneId,
  normalizeWorkAreaCells,
  normalizeWorkAreaName,
  parseWorkAreaKind,
  renameWorkArea,
  retargetWorkAreaCells,
  workAreaGroundSupports,
  type FarmId,
  type TileCoordinate,
  type WorkArea,
  type WorkAreaCell,
  type WorkAreaId,
  type WorkAreaKind
} from "@happy-farm/domain";
import { ApplicationError, type ApplicationErrorCode } from "./errors";
import type {
  ActorContext,
  Clock,
  FarmMemberRepository,
  FarmRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  PayloadFingerprint,
  WorkAreaGroundLookup,
  WorkAreaIdGenerator,
  WorkAreaRepository
} from "./ports";

/**
 * Player-named work areas.
 *
 * A work area is orchestration metadata: a name, a kind, and an explicit set of cells the player
 * wants worked. It is not ownership, not a land-use decision and not occupancy, so none of these use
 * cases touches land, gold, inventory, crops, trees, buildings or nodes. Creating an area costs
 * nothing, reserves nothing, and starts nothing - it only says *where* a future Job may operate.
 *
 * Every command derives its authority from the authenticated actor: the farm comes from the route,
 * the role from `farm_members`, and the zone from the farm itself. A client never sends an owner, a
 * role, a zone or a version it is trusted to be right about - it sends a name, a kind, cells and (for
 * an edit) the version it read.
 */

/** The idempotency operation a create is filed under, so a retried create cannot make two areas. */
export const CREATE_WORK_AREA_OPERATION = "CREATE_WORK_AREA";

export interface WorkAreaSummaryView {
  readonly workAreaId: string;
  readonly farmId: string;
  readonly kind: WorkAreaKind;
  readonly displayName: string;
  readonly cellCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkAreaView {
  readonly workAreaId: string;
  readonly farmId: string;
  readonly kind: WorkAreaKind;
  readonly displayName: string;
  readonly cells: readonly WorkAreaCell[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function summarize(area: WorkArea, cellCount: number): WorkAreaSummaryView {
  return {
    workAreaId: area.id,
    farmId: area.farmId,
    kind: area.kind,
    displayName: area.displayName,
    cellCount,
    version: area.version,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt
  };
}

function detail(area: WorkArea, cells: readonly WorkAreaCell[]): WorkAreaView {
  return {
    workAreaId: area.id,
    farmId: area.farmId,
    kind: area.kind,
    displayName: area.displayName,
    cells,
    version: area.version,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt
  };
}

/**
 * Runs a domain rule and re-labels its failure for the wire.
 *
 * A stale-version refusal stays `CONFLICT_STALE_STATE` (it is the same fact whichever rule noticed
 * it); every other domain refusal is given the use case's own code so the client can show a specific
 * message instead of a generic invalid-input.
 */
function mapDomain<T>(fallback: ApplicationErrorCode, run: () => T): T {
  try {
    return run();
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      const code: ApplicationErrorCode =
        error.code === "CONFLICT_STALE_STATE"
          ? "CONFLICT_STALE_STATE"
          : error.code === "WORK_AREA_TOO_MANY_CELLS"
            ? "WORK_AREA_TOO_MANY_CELLS"
            : fallback;
      throw new ApplicationError(code, error.message);
    }
    throw error;
  }
}

function normalizeName(raw: string): string {
  return mapDomain("WORK_AREA_NAME_INVALID", () => normalizeWorkAreaName(raw));
}

function normalizeKind(raw: string): WorkAreaKind {
  return mapDomain("INVALID_INPUT", () => parseWorkAreaKind(raw));
}

function normalizeCells(cells: readonly TileCoordinate[]): readonly WorkAreaCell[] {
  const normalized = mapDomain("WORK_AREA_CELL_INVALID", () => normalizeWorkAreaCells(cells));
  if (normalized.length === 0) {
    // An area with no cells names nothing. The editor always has at least the one cell the player
    // tapped, so an empty set is a malformed command rather than a legal empty area.
    throw new ApplicationError("WORK_AREA_CELL_INVALID", "A work area must hold at least one cell");
  }
  return normalized;
}

function assertKindFitsCells(
  kind: WorkAreaKind,
  cells: readonly WorkAreaCell[],
  ground: WorkAreaGroundLookup
): void {
  for (const cell of cells) {
    if (!workAreaGroundSupports(kind, ground.capabilitiesAt(cell))) {
      // The refusal names no cell contents back to the client; it says only that some cell is wrong.
      throw new ApplicationError(
        "WORK_AREA_CELL_INVALID",
        "A work area cell cannot be worked for this kind of area"
      );
    }
  }
}

interface WorkAreaDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly workAreas: WorkAreaRepository;
}

/** The farm exists, and the actor is a member of it. Reading is open to every role. */
async function requireMember(
  dependencies: WorkAreaDependencies,
  farmId: FarmId,
  actor: ActorContext
): Promise<void> {
  if ((await dependencies.farms.findById(farmId)) === null) {
    throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  }
  if ((await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId)) === null) {
    throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
  }
}

/**
 * The farm exists, and the actor owns it.
 *
 * Work-area membership is planned HOME ISLAND editing, and Home Island editing is OWNER-only today
 * (the same rule the land and construction routes use). EDITOR and HELPER are a later product
 * decision and are deliberately not pre-granted here.
 */
async function requireOwner(
  dependencies: WorkAreaDependencies,
  farmId: FarmId,
  actor: ActorContext
): Promise<void> {
  if ((await dependencies.farms.findById(farmId)) === null) {
    throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  }
  const membership = await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
  if (membership?.role !== "OWNER") {
    throw new ApplicationError("NOT_AUTHORIZED", "Editing work areas is not allowed on this farm");
  }
}

/**
 * One area, as this farm's row.
 *
 * A wrong farm answers exactly like a missing area - `WORK_AREA_NOT_FOUND` - so knowing an id is
 * never a way to learn that somebody else's area exists, and is never an authorization.
 */
async function loadArea(
  dependencies: WorkAreaDependencies,
  farmId: FarmId,
  workAreaId: WorkAreaId
): Promise<WorkArea> {
  const area = await dependencies.workAreas.findById(workAreaId);
  if (area === null || area.farmId !== farmId) {
    throw new ApplicationError("WORK_AREA_NOT_FOUND", "Work area was not found");
  }
  return area;
}

function replay(dependencies: WorkAreaDependencies, record: IdempotencyRecord, fingerprint: string): WorkAreaView {
  if (record.payloadFingerprint !== fingerprint) {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
  }
  try {
    return JSON.parse(record.responseJson) as WorkAreaView;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
}

/** Every work area of one farm, names and sizes only - one bounded read, no membership. */
export class ListWorkAreas {
  constructor(private readonly dependencies: WorkAreaDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly WorkAreaSummaryView[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireMember(this.dependencies, farmId, actor);
    const entries = await this.dependencies.workAreas.listByFarm(farmId);
    return entries.map((entry) => summarize(entry.area, entry.cellCount));
  }
}

/** One work area with its member cells - the editor's load, and nothing a list performs. */
export class GetWorkArea {
  constructor(private readonly dependencies: WorkAreaDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, workAreaId: WorkAreaId): Promise<WorkAreaView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireMember(this.dependencies, farmId, actor);
    const area = await loadArea(this.dependencies, farmId, workAreaId);
    const cells = await this.dependencies.workAreas.listCells(area.id);
    return detail(area, cells);
  }
}

export interface CreateWorkAreaCommand {
  readonly requestId: string;
  readonly kind: string;
  readonly name: string;
  readonly cells: readonly TileCoordinate[];
}

export interface CreateWorkAreaDependencies extends WorkAreaDependencies {
  readonly ground: WorkAreaGroundLookup;
  readonly idempotency: IdempotencyRepository;
  readonly ids: WorkAreaIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

/**
 * Names a new area.
 *
 * No gold, no inventory, no land, no tile rows: the cells may be natural ground the farm has never
 * written a `farm_tiles` row for, and they still belong to the area. The only durable effect is one
 * area row, its cells, and the receipt that makes a retried create a no-op.
 */
export class CreateWorkArea {
  constructor(private readonly dependencies: CreateWorkAreaDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: CreateWorkAreaCommand
  ): Promise<WorkAreaView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwner(this.dependencies, farmId, actor);
    const kind = normalizeKind(command.kind);
    const displayName = normalizeName(command.name);
    const cells = normalizeCells(command.cells);
    assertKindFitsCells(kind, cells, this.dependencies.ground);

    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([farmId, kind, displayName, cells.map((cell) => [cell.x, cell.y])])
    );
    const existing = await this.dependencies.idempotency.find(
      actor.playerId,
      CREATE_WORK_AREA_OPERATION,
      command.requestId
    );
    if (existing !== null) return replay(this.dependencies, existing, fingerprint);

    const now = this.dependencies.clock.now();
    const area: WorkArea = {
      id: this.dependencies.ids.newWorkAreaId(),
      farmId,
      zoneKind: HOME_ISLAND_ZONE_KIND,
      zoneId: homeIslandZoneId(farmId),
      kind,
      displayName,
      version: 1,
      createdByPlayerId: actor.playerId,
      createdAt: now,
      updatedAt: now
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: CREATE_WORK_AREA_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: area.id,
      responseJson: JSON.stringify(detail(area, cells)),
      status: "COMPLETED",
      createdAt: now
    };
    await this.dependencies.workAreas.createAtomically(area, cells, record);
    return detail(area, cells);
  }
}

export interface RenameWorkAreaCommand {
  readonly requestId: string;
  readonly name: string;
  readonly expectedVersion: number;
}

/** Renames an area, refusing an edit made against a version that has already moved. */
export class RenameWorkArea {
  constructor(private readonly dependencies: WorkAreaDependencies & { readonly clock: Clock }) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    workAreaId: WorkAreaId,
    command: RenameWorkAreaCommand
  ): Promise<WorkAreaView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwner(this.dependencies, farmId, actor);
    const area = await loadArea(this.dependencies, farmId, workAreaId);
    mapDomain("CONFLICT_STALE_STATE", () => { assertWorkAreaVersion(area, command.expectedVersion); });
    const displayName = normalizeName(command.name);
    const renamed = renameWorkArea(area, displayName, this.dependencies.clock.now());
    const applied = await this.dependencies.workAreas.renameAtomically(renamed, command.expectedVersion);
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Work area changed since it was read");
    const cells = await this.dependencies.workAreas.listCells(area.id);
    return detail(renamed, cells);
  }
}

export interface ReplaceWorkAreaCellsCommand {
  readonly requestId: string;
  readonly cells: readonly TileCoordinate[];
  readonly expectedVersion: number;
}

/**
 * Replaces an area's membership with the set the editor drew.
 *
 * Replace, not patch: the client sends the whole set, so a lost response cannot leave a half-applied
 * edit, and the version guard means two editors cannot interleave into a set neither of them drew.
 */
export class ReplaceWorkAreaCells {
  constructor(
    private readonly dependencies: WorkAreaDependencies & {
      readonly ground: WorkAreaGroundLookup;
      readonly clock: Clock;
    }
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    workAreaId: WorkAreaId,
    command: ReplaceWorkAreaCellsCommand
  ): Promise<WorkAreaView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwner(this.dependencies, farmId, actor);
    const area = await loadArea(this.dependencies, farmId, workAreaId);
    mapDomain("CONFLICT_STALE_STATE", () => { assertWorkAreaVersion(area, command.expectedVersion); });
    const cells = normalizeCells(command.cells);
    assertKindFitsCells(area.kind, cells, this.dependencies.ground);
    const retargeted = retargetWorkAreaCells(area, this.dependencies.clock.now());
    const applied = await this.dependencies.workAreas.replaceCellsAtomically(
      retargeted,
      cells,
      command.expectedVersion
    );
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Work area changed since it was read");
    return detail(retargeted, cells);
  }
}

export interface DeleteWorkAreaCommand {
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface DeleteWorkAreaResult {
  readonly workAreaId: string;
}

/**
 * Deletes an area and its member cells.
 *
 * Nothing references a work area yet, so nothing can block the delete. When Jobs exist, the same
 * command grows one rule - refuse while an active Job names the area - and until then the version
 * guard is the whole concurrency story.
 */
export class DeleteWorkArea {
  constructor(
    private readonly dependencies: WorkAreaDependencies & {
      /**
       * How many jobs name this area.
       *
       * A function rather than the job repository itself, so the other four work-area use cases do
       * not have to know that jobs exist: only the delete has a reason to ask.
       */
      readonly jobReferences: (id: WorkAreaId) => Promise<number>;
    }
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    workAreaId: WorkAreaId,
    command: DeleteWorkAreaCommand
  ): Promise<DeleteWorkAreaResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwner(this.dependencies, farmId, actor);
    const area = await loadArea(this.dependencies, farmId, workAreaId);
    mapDomain("CONFLICT_STALE_STATE", () => { assertWorkAreaVersion(area, command.expectedVersion); });
    // A job's area is its `WHERE?`. Deleting the area would either orphan the job or silently delete
    // it, so the refusal is explicit and the player is told which step comes first.
    if ((await this.dependencies.jobReferences(area.id)) > 0) {
      throw new ApplicationError("WORK_AREA_IN_USE", "This area is assigned to a job. Remove the job first.");
    }
    const applied = await this.dependencies.workAreas.deleteAtomically(area.id, command.expectedVersion);
    if (!applied) throw new ApplicationError("CONFLICT_STALE_STATE", "Work area changed since it was read");
    return { workAreaId: area.id };
  }
}
