import type {
  CellBounds,
  ConstructionId,
  ConstructionInstance,
  Farm,
  FarmId,
  FarmMember,
  FarmRole,
  FarmTile,
  CropInstance,
  CropInstanceId,
  CurrencyDefinitionId,
  EconomyLedgerEntry,
  EconomyMutation,
  EconomyTransactionId,
  InventoryAddition,
  InventoryItem,
  InventoryMutation,
  InventoryRemoval,
  ItemDefinitionId,
  Player,
  PlayerId,
  PlayerProgression,
  PlayerStatus,
  TerrainType,
  TileState,
  TreeInstance,
  TreeInstanceId,
  FishingAction,
  FishingActionId,
  FishingStockState,
  ResourceAction,
  ResourceActionId,
  ResourceNodeState,
  ResourceVerb,
  QuarterTurns,
  XpAward,
  Wallet,
  WarehouseState,
  WorkArea,
  WorkAreaCell,
  WorkAreaId,
  Actor,
  ActorCargoItem,
  ActorId,
  ActorJob,
  AutoAnchor,
  AutoTravelState,
  JobId
  ,ProductionSourceSnapshot
} from "@happy-farm/domain";
import {
  MAX_AUTO_FUNDING_ITEMS,
  parseConstructionId,
  parseCropDefinitionId,
  parseCropInstanceId,
  parseCurrencyDefinitionId,
  parseEconomyReferenceId,
  parseEconomyTransactionId,
  parseFarmId,
  parseFishingActionId,
  parseItemDefinitionId,
  parsePlayerId,
  parseResourceActionId,
  parseTreeInstanceId,
  parseTreeDefinitionId,
  parseWorkAreaId,
  parseActorId,
  parseAutoAnchorKind,
  parseJobId,
  MAX_CARGO_CAPACITY,
  NO_AUTO_TRAVEL,
  PLOT_TILE_COUNT,
  PLOT_TILE_SIZE
} from "@happy-farm/domain";
import type {
  AutoFundingItem,
  AutoFundingSaleLeg,
  ConstructionPlacement,
  ConstructionRepository,
  ConstructionRelocation,
  ConstructionRemoval,
  WarehouseRepository,
  WarehouseUpgrade,
  ConstructionSeed,
  CropInstanceRepository,
  FarmExpansionRepository,
  FishingActionRepository,
  FishingSettlementRepository,
  ResourceActionRepository,
  ResourceNodeStateRepository,
  ResourceSettlementRepository,
  FarmMemberRepository,
  HomeIslandZoneResolver,
  FarmRepository,
  FarmTileRepository,
  PlayerRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  TreeHarvestBatchReceiptRepository,
  CropHarvestBatchReceiptRepository,
  PlantBatchReceiptRepository,
  HarvestSettlementRepository,
  InventoryRepository,
  EconomyLedgerRepository,
  EconomyMutationRepository,
  EconomySettlementRepository,
  ProgressionRepository,
  StarterGrant,
  StarterGrantRepository,
  TilePlan,
  TreeHarvestSettlementRepository,
  TreeInstanceRepository,
  WalletRepository,
  ActorJobRepository,
  ActorRepository,
  AutoTravelRepository,
  CargoGrant,
  CargoLoad,
  CargoPurchase,
  CargoRemoval,
  CargoRepository,
  CargoUnload,
  JobOrderEntry,
  WorkAreaListEntry,
  WorkAreaRepository
  ,ProductionAssignmentRepository
  ,ProductionSourceRepository
  ,OrchardProductionBindingRepository
  ,ResourceProductionBindingRepository
  ,FishingSpotStateRepository
  ,WildFisheryProductionBindingRepository
  ,AquaculturePondRepository
  ,AquaculturePondState
  ,ForestryConstructionStateRepository
  ,ForestryConstructionState
  ,NeighborRepository
  ,NeighborSnapshot
  ,NeighborVisitRecord
} from "@happy-farm/application";
import { ApplicationError, MAX_LAND_CELLS_PER_REQUEST } from "@happy-farm/application";
import { reconcileNeighborNpc, reconcileRecurringNeighborNpc } from "@happy-farm/domain";
import { homeIslandZoneRef } from "@happy-farm/contracts";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "./d1-types";
import { executeD1AtomicAutoPlant, executeD1AtomicBatch, type D1AtomicBatchComponent } from "./d1-atomic-batch";

interface ProductionAssignmentRow {
  id: string;
  farm_id: string;
  actor_id: string;
  actor_job_id: string;
  work_area_id: string | null;
  source_id: string;
  enabled: number;
  settlement_cursor: string;
  production_remainder: number;
  blocked_reason: "WAREHOUSE_FULL" | "SOURCE_DEPLETED" | "DISABLED" | "NOT_READY" | null;
  version: number;
  execution_mode: "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
}

interface ProductionSourceRow {
  id: string;
  farm_id: string;
  kind: string;
  output_item_definition_id: string;
  rate_per_hour: number;
  remaining_stock: number | null;
  enabled: number;
  version: number;
}

function booleanColumn(value: number, field: string): boolean {
  if (value !== 0 && value !== 1) throw new ApplicationError("INVALID_INPUT", `Invalid ${field} value`);
  return value === 1;
}

function productionMode(value: string): "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION" {
  if (value === "LEGACY_ACTION_AUTO" || value === "RATE_PRODUCTION") return value;
  throw new ApplicationError("INVALID_INPUT", "Invalid production execution mode");
}

/** Reads the assignment and its authoritative execution mode from the linked Work Assignment. */
export class D1ProductionAssignmentRepository implements ProductionAssignmentRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByFarmAndId(farmId: FarmId, assignmentId: string) {
    const row = await this.db.prepare(
      `SELECT p.id, p.farm_id, p.actor_id, p.actor_job_id, p.work_area_id, p.source_id, p.enabled,
              p.settlement_cursor, p.production_remainder, p.blocked_reason, p.version,
              j.execution_mode
         FROM production_assignments AS p
         JOIN actor_jobs AS j ON j.id = p.actor_job_id AND j.farm_id = p.farm_id
        WHERE p.farm_id = ? AND p.id = ?`
    ).bind(farmId, assignmentId).first<ProductionAssignmentRow>();
    if (row === null) return null;
    return {
      id: row.id,
      farmId: parseFarmId(row.farm_id),
      actorId: parseActorId(row.actor_id),
      actorJobId: parseJobId(row.actor_job_id),
      workAreaId: row.work_area_id === null ? null : parseWorkAreaId(row.work_area_id),
      sourceId: row.source_id,
      enabled: booleanColumn(row.enabled, "assignment enabled"),
      settlementCursor: row.settlement_cursor,
      productionRemainder: row.production_remainder,
      ...(row.blocked_reason === null ? {} : { blockedReason: row.blocked_reason }),
      version: row.version,
      executionMode: productionMode(row.execution_mode)
    };
  }

  async listByFarm(farmId: FarmId) {
    const rows = await this.db.prepare(
      `SELECT p.id, p.farm_id, p.actor_id, p.actor_job_id, p.work_area_id, p.source_id, p.enabled,
              p.settlement_cursor, p.production_remainder, p.blocked_reason, p.version,
              j.execution_mode
         FROM production_assignments p
         JOIN actor_jobs j ON j.id = p.actor_job_id AND j.farm_id = p.farm_id
        WHERE p.farm_id = ? ORDER BY p.id`
    ).bind(farmId).all<ProductionAssignmentRow>();
    return rows.results.map((row) => ({
      id: row.id, farmId: parseFarmId(row.farm_id), actorId: parseActorId(row.actor_id), actorJobId: parseJobId(row.actor_job_id),
      workAreaId: row.work_area_id === null ? null : parseWorkAreaId(row.work_area_id), sourceId: row.source_id,
      enabled: booleanColumn(row.enabled, "assignment enabled"), settlementCursor: row.settlement_cursor,
      productionRemainder: row.production_remainder,
      ...(row.blocked_reason === null ? {} : { blockedReason: row.blocked_reason }), version: row.version,
      executionMode: productionMode(row.execution_mode)
    }));
  }
}

export class D1NeighborRepository implements NeighborRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ensure(farmId: FarmId, now: string): Promise<void> {
    const islandId = `neighbor_island_${farmId}`;
    const npcId = `neighbor_npc_${farmId}`;
    const readyAt = new Date(Date.parse(now) + 60_000).toISOString();
    const statements = [
      this.db.prepare("INSERT OR IGNORE INTO neighbor_islands (id, home_farm_id, world_center_x, world_center_z, dock_x, dock_z, npc_x, npc_z, created_at, updated_at) VALUES (?, ?, 112, 0, 101, 0, 116, 0, ?, ?)").bind(islandId, farmId, now, now),
      this.db.prepare("INSERT OR IGNORE INTO neighbor_npc_states (island_id, npc_id, display_name_key, phase, planted_at, ready_at, stock_quantity, construction_level, next_milestone_at, version, last_reconciled_at, created_at, updated_at) VALUES (?, ?, 'neighbor.npc.mina', 'GROWING', ?, ?, 0, 0, NULL, 1, ?, ?, ?)").bind(islandId, npcId, now, readyAt, now, now, now),
      this.db.prepare("INSERT OR IGNORE INTO neighbor_visits (player_id, farm_id, current_place, version, updated_at) SELECT owner_player_id, id, 'HOME_ISLAND', 1, ? FROM farms WHERE id = ?").bind(now, farmId)
    ];
    const archipelago = [
      { slot: "MOC", id: islandId, seed: 3701, x: 112, z: 0, dockX: 101, dockZ: 0, npcX: 116, npcZ: 0 },
      { slot: "KIM", id: `neighbor_island_${farmId}_kim`, seed: 3702, x: -112, z: 0, dockX: -101, dockZ: 0, npcX: -116, npcZ: 0 },
      { slot: "THUY", id: `neighbor_island_${farmId}_thuy`, seed: 3703, x: 0, z: 112, dockX: 0, dockZ: 101, npcX: 4, npcZ: 116 }
    ] as const;
    await this.db.batch([...statements, ...archipelago.flatMap((island) => [
      this.db.prepare("INSERT OR IGNORE INTO neighbor_archipelago_islands (id, home_farm_id, slot, seed, template_version, world_center_x, world_center_z, dock_x, dock_z, npc_x, npc_z, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)").bind(island.id, farmId, island.slot, island.seed, island.x, island.z, island.dockX, island.dockZ, island.npcX, island.npcZ, now, now),
      this.db.prepare("INSERT OR IGNORE INTO neighbor_archipelago_npc_states (island_id, npc_id, display_name_key, phase, cycle, stock_quantity, next_action_at, last_settled_at, version, created_at, updated_at) VALUES (?, ?, ?, 'PREPARING', 0, 0, ?, ?, 1, ?, ?)").bind(island.id, `neighbor_npc_${farmId}_${island.slot.toLowerCase()}`, `neighbor.npc.${island.slot.toLowerCase()}`, new Date(Date.parse(now) + 10_000).toISOString(), now, now, now)
    ])]);
  }

  async reconcile(farmId: FarmId, now: string): Promise<void> {
    const row = await this.db.prepare("SELECT phase, planted_at, ready_at, stock_quantity, construction_level, next_milestone_at, version, last_reconciled_at FROM neighbor_npc_states WHERE island_id = ?").bind(`neighbor_island_${farmId}`).first<{
      phase: "GROWING" | "STOCKED" | "BUILT"; planted_at: string; ready_at: string; stock_quantity: number; construction_level: number; next_milestone_at: string | null; version: number; last_reconciled_at: string;
    }>();
    if (row === null) return;
    const next = reconcileNeighborNpc({ phase: row.phase, plantedAt: row.planted_at, readyAt: row.ready_at, stockQuantity: row.stock_quantity, constructionLevel: row.construction_level, nextMilestoneAt: row.next_milestone_at, version: row.version, lastReconciledAt: row.last_reconciled_at }, now);
    if (next.changed) await this.db.prepare("UPDATE neighbor_npc_states SET phase = ?, stock_quantity = ?, construction_level = ?, next_milestone_at = ?, version = ?, last_reconciled_at = ?, updated_at = ? WHERE island_id = ? AND version = ?").bind(next.phase, next.stockQuantity, next.constructionLevel, next.nextMilestoneAt, next.version, next.lastReconciledAt, now, `neighbor_island_${farmId}`, row.version).run();
    const rows = await this.db.prepare("SELECT island_id, phase, cycle, stock_quantity, next_action_at, last_settled_at, version FROM neighbor_archipelago_npc_states WHERE island_id IN (SELECT id FROM neighbor_archipelago_islands WHERE home_farm_id = ?)").bind(farmId).all<{ island_id: string; phase: "PREPARING" | "WORKING" | "WAITING" | "STOCKED"; cycle: number; stock_quantity: number; next_action_at: string; last_settled_at: string; version: number }>();
    for (const item of rows.results) {
      const nextCycle = reconcileRecurringNeighborNpc({ phase: item.phase, cycle: item.cycle, stockQuantity: item.stock_quantity, nextActionAt: item.next_action_at, lastSettledAt: item.last_settled_at, version: item.version }, now);
      if (nextCycle.version === item.version) continue;
      await this.db.prepare("UPDATE neighbor_archipelago_npc_states SET phase = ?, cycle = ?, stock_quantity = ?, next_action_at = ?, last_settled_at = ?, version = ?, updated_at = ? WHERE island_id = ? AND version = ?").bind(nextCycle.phase, nextCycle.cycle, nextCycle.stockQuantity, nextCycle.nextActionAt, nextCycle.lastSettledAt, nextCycle.version, now, item.island_id, item.version).run();
    }
  }

  async visit(farmId: FarmId, playerId: PlayerId): Promise<NeighborVisitRecord> {
    const row = await this.db.prepare("SELECT player_id, farm_id, current_place, current_island_id, version FROM neighbor_visits WHERE farm_id = ? AND player_id = ?").bind(farmId, playerId).first<{ player_id: string; farm_id: string; current_place: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; current_island_id: string | null; version: number }>();
    if (row === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Neighbour visit was not initialized");
    return { playerId: parsePlayerId(row.player_id), farmId: parseFarmId(row.farm_id), currentPlace: row.current_place, currentIslandId: row.current_island_id, version: row.version };
  }

  async snapshot(farmId: FarmId, playerId: PlayerId): Promise<NeighborSnapshot> {
    const island = await this.db.prepare("SELECT id, home_farm_id, world_center_x, world_center_z, dock_x, dock_z, npc_x, npc_z FROM neighbor_islands WHERE home_farm_id = ?").bind(farmId).first<{ id: string; home_farm_id: string; world_center_x: number; world_center_z: number; dock_x: number; dock_z: number; npc_x: number; npc_z: number }>();
    const npc = await this.db.prepare("SELECT island_id, npc_id, display_name_key, phase, planted_at, ready_at, stock_quantity, construction_level, next_milestone_at, version, last_reconciled_at FROM neighbor_npc_states WHERE island_id = ?").bind(`neighbor_island_${farmId}`).first<{ island_id: string; npc_id: string; display_name_key: string; phase: "GROWING" | "STOCKED" | "BUILT"; planted_at: string; ready_at: string; stock_quantity: number; construction_level: number; next_milestone_at: string | null; version: number; last_reconciled_at: string }>();
    if (island === null || npc === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Neighbour island was not initialized");
    const archipelago = await this.db.prepare("SELECT id, home_farm_id, slot, seed, template_version, world_center_x, world_center_z, dock_x, dock_z, npc_x, npc_z FROM neighbor_archipelago_islands WHERE home_farm_id = ? ORDER BY slot").bind(farmId).all<{ id: string; home_farm_id: string; slot: "MOC" | "KIM" | "THUY"; seed: number; template_version: number; world_center_x: number; world_center_z: number; dock_x: number; dock_z: number; npc_x: number; npc_z: number }>();
    const archNpcs = await this.db.prepare("SELECT s.island_id, s.npc_id, s.display_name_key, s.phase, s.cycle, s.stock_quantity, s.next_action_at, s.last_settled_at, s.version, i.slot FROM neighbor_archipelago_npc_states s JOIN neighbor_archipelago_islands i ON i.id = s.island_id WHERE i.home_farm_id = ? ORDER BY i.slot").bind(farmId).all<{ island_id: string; npc_id: string; display_name_key: string; phase: "PREPARING" | "WORKING" | "WAITING" | "STOCKED"; cycle: number; stock_quantity: number; next_action_at: string; last_settled_at: string; version: number; slot: "MOC" | "KIM" | "THUY" }>();
    return {
      island: { id: island.id, farmId: parseFarmId(island.home_farm_id), centerX: island.world_center_x, centerZ: island.world_center_z, dockX: island.dock_x, dockZ: island.dock_z, npcX: island.npc_x, npcZ: island.npc_z },
      npc: { islandId: npc.island_id, npcId: npc.npc_id, displayNameKey: npc.display_name_key, phase: npc.phase, plantedAt: npc.planted_at, readyAt: npc.ready_at, stockQuantity: npc.stock_quantity, constructionLevel: npc.construction_level, nextMilestoneAt: npc.next_milestone_at, version: npc.version, lastReconciledAt: npc.last_reconciled_at },
      visit: await this.visit(farmId, playerId),
      islands: archipelago.results.map((item) => ({ id: item.id, farmId: parseFarmId(item.home_farm_id), centerX: item.world_center_x, centerZ: item.world_center_z, dockX: item.dock_x, dockZ: item.dock_z, npcX: item.npc_x, npcZ: item.npc_z, slot: item.slot, seed: item.seed, templateVersion: item.template_version })),
      npcs: archNpcs.results.map((item) => ({ islandId: item.island_id, npcId: item.npc_id, displayNameKey: item.display_name_key, phase: item.phase === "STOCKED" ? "STOCKED" : "GROWING", plantedAt: item.last_settled_at, readyAt: item.next_action_at, stockQuantity: item.stock_quantity, constructionLevel: item.cycle, nextMilestoneAt: item.next_action_at, lastReconciledAt: item.last_settled_at, version: item.version, slot: item.slot, jobKey: `neighbor.job.${item.phase.toLowerCase()}`, cycle: item.cycle, nextActionAt: item.next_action_at }))
    };
  }

  async findTravelReplay(playerId: PlayerId, requestId: string, fingerprint: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT fingerprint FROM neighbor_travel_receipts WHERE player_id = ? AND request_id = ?").bind(playerId, requestId).first<{ fingerprint: string }>();
    if (row === null) return false;
    if (row.fingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was reused with different input");
    return true;
  }

  async travelAtomically(farmId: FarmId, playerId: PlayerId, current: NeighborVisitRecord, input: { requestId: string; expectedVersion: number; destination: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; islandId?: string | undefined }, now: string): Promise<void> {
    const fingerprint = JSON.stringify({ destination: input.destination, islandId: input.islandId ?? null, expectedVersion: input.expectedVersion });
    const statements = [
      this.db.prepare("UPDATE neighbor_visits SET current_place = ?, current_island_id = ?, version = version + 1, updated_at = ? WHERE farm_id = ? AND player_id = ? AND version = ?").bind(input.destination, input.destination === "HOME_ISLAND" ? null : (input.islandId ?? `neighbor_island_${farmId}`), now, farmId, playerId, current.version),
      this.db.prepare("INSERT INTO neighbor_travel_receipts (player_id, request_id, fingerprint, response_json, created_at) SELECT ?, ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM neighbor_visits WHERE farm_id = ? AND player_id = ? AND current_place = ? AND version = ?)").bind(playerId, input.requestId, fingerprint, now, farmId, playerId, input.destination, current.version + 1)
    ];
    const results = await this.db.batch(statements);
    if ((results[1]?.meta.changes ?? 0) !== 1) throw new ApplicationError("CONFLICT_STALE_STATE", "Neighbour travel lost a race");
  }
}

/** Reads only persisted source state; settlement remains exclusively in the atomic service. */
export class D1ProductionSourceRepository implements ProductionSourceRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByFarmAndId(farmId: FarmId, sourceId: string): Promise<ProductionSourceSnapshot | null> {
    const row = await this.db.prepare(
      `SELECT id, farm_id, kind, output_item_definition_id, rate_per_hour,
              remaining_stock, enabled, version
         FROM production_sources
        WHERE farm_id = ? AND id = ?`
    ).bind(farmId, sourceId).first<ProductionSourceRow>();
    if (row === null) return null;
    if (row.kind !== "RENEWABLE" && row.kind !== "FINITE") {
      throw new ApplicationError("INVALID_INPUT", "Invalid production source kind");
    }
    if (row.kind === "RENEWABLE" && row.remaining_stock !== null) {
      throw new ApplicationError("INVALID_INPUT", "Renewable production source has finite stock");
    }
    if (row.kind === "FINITE" && row.remaining_stock === null) {
      throw new ApplicationError("INVALID_INPUT", "Finite production source has no stock");
    }
    const kind = row.kind === "RENEWABLE" ? "RENEWABLE" : "FINITE";
    return {
      id: row.id,
      farmId: parseFarmId(row.farm_id),
      kind,
      outputItemDefinitionId: row.output_item_definition_id,
      ratePerHour: row.rate_per_hour,
      remainingStock: row.remaining_stock,
      enabled: booleanColumn(row.enabled, "source enabled"),
      version: row.version
    };
  }
}

/** Creates the Orchard economic identity with deterministic ids and one D1 batch. */
export class D1OrchardProductionBindingRepository implements OrchardProductionBindingRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ensureAtomically(input: Parameters<OrchardProductionBindingRepository["ensureAtomically"]>[0]) {
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO production_sources
          (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version, created_at, updated_at)
         VALUES (?, ?, 'RENEWABLE', ?, ?, NULL, 1, 1, ?, ?)`
      ).bind(input.sourceId, input.farmId, "item_apple", input.ratePerHour, input.activatedAt, input.activatedAt),
      this.db.prepare(
        `INSERT OR IGNORE INTO production_assignments
          (id, farm_id, actor_id, actor_job_id, work_area_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, 1, ?, ?)`
      ).bind(input.assignmentId, input.farmId, input.actorId, input.actorJobId, input.workAreaId, input.sourceId, input.activatedAt, input.activatedAt, input.activatedAt)
    ]);
    const row = await this.db.prepare(
      `SELECT p.id AS assignment_id, p.source_id, p.farm_id, p.actor_job_id,
              s.rate_per_hour, p.settlement_cursor, p.version,
              s.kind, s.output_item_definition_id, s.farm_id AS source_farm_id
         FROM production_assignments p
         JOIN production_sources s ON s.id = p.source_id
        WHERE p.actor_job_id = ? AND p.farm_id = ?`
    ).bind(input.actorJobId, input.farmId).first<{
      assignment_id: string; source_id: string; farm_id: string; actor_job_id: string;
      rate_per_hour: number; settlement_cursor: string; version: number;
      kind: string; output_item_definition_id: string; source_farm_id: string;
    }>();
    if (row === null || row.kind !== "RENEWABLE" || row.output_item_definition_id !== "item_apple" || row.source_farm_id !== input.farmId || row.farm_id !== input.farmId || row.source_id !== input.sourceId) {
      throw new ApplicationError("INTERNAL_ERROR", "Apple Orchard production binding is inconsistent");
    }
    return {
      assignmentId: row.assignment_id, sourceId: row.source_id, farmId: parseFarmId(row.farm_id),
      actorJobId: parseJobId(row.actor_job_id), ratePerHour: row.rate_per_hour,
      settlementCursor: row.settlement_cursor, version: row.version
    };
  }
}

/** Creates a Forestry or Mining production identity without adding a second stock table. */
export class D1ResourceProductionBindingRepository implements ResourceProductionBindingRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ensureAtomically(input: Parameters<ResourceProductionBindingRepository["ensureAtomically"]>[0]) {
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO production_sources
          (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version, created_at, updated_at)
         VALUES (?, ?, 'RENEWABLE', ?, ?, NULL, 1, 1, ?, ?)`
      ).bind(input.sourceId, input.farmId, input.outputItemDefinitionId, input.ratePerHour, input.activatedAt, input.activatedAt),
      this.db.prepare(
        `INSERT OR IGNORE INTO production_assignments
          (id, farm_id, actor_id, actor_job_id, work_area_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, 1, ?, ?)`
      ).bind(input.assignmentId, input.farmId, input.actorId, input.actorJobId, input.workAreaId, input.sourceId, input.activatedAt, input.activatedAt, input.activatedAt)
    ]);
    const row = await this.db.prepare(
      `SELECT p.id AS assignment_id, p.source_id, p.farm_id, p.actor_job_id,
              s.rate_per_hour, p.settlement_cursor, p.version,
              s.kind, s.output_item_definition_id, s.farm_id AS source_farm_id
         FROM production_assignments p
         JOIN production_sources s ON s.id = p.source_id
        WHERE p.actor_job_id = ? AND p.farm_id = ?`
    ).bind(input.actorJobId, input.farmId).first<{
      assignment_id: string; source_id: string; farm_id: string; actor_job_id: string;
      rate_per_hour: number; settlement_cursor: string; version: number;
      kind: string; output_item_definition_id: string; source_farm_id: string;
    }>();
    const familyPrefix = `production_source_${input.sourceFamily.toLowerCase()}_`;
    if (row === null || row.kind !== "RENEWABLE" || row.output_item_definition_id !== input.outputItemDefinitionId
      || !row.source_id.startsWith(familyPrefix) || row.source_farm_id !== input.farmId
      || row.farm_id !== input.farmId || row.source_id !== input.sourceId) {
      throw new ApplicationError("INTERNAL_ERROR", "Resource production binding is inconsistent");
    }
    return {
      assignmentId: row.assignment_id, sourceId: row.source_id, farmId: parseFarmId(row.farm_id),
      actorJobId: parseJobId(row.actor_job_id), ratePerHour: row.rate_per_hour,
      settlementCursor: row.settlement_cursor, version: row.version
    };
  }
}

export class D1WildFisheryProductionBindingRepository implements WildFisheryProductionBindingRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async ensureAtomically(input: Parameters<WildFisheryProductionBindingRepository["ensureAtomically"]>[0]) {
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO production_sources
          (id, farm_id, kind, output_item_definition_id, rate_per_hour, remaining_stock, enabled, version, created_at, updated_at)
         VALUES (?, ?, 'FINITE', ?, ?, ?, 1, 1, ?, ?)`
      ).bind(input.sourceId, input.farmId, input.outputItemDefinitionId, input.ratePerHour, input.initialStock, input.activatedAt, input.activatedAt),
      this.db.prepare(
        `INSERT OR IGNORE INTO production_assignments
          (id, farm_id, actor_id, actor_job_id, work_area_id, source_id, enabled, settlement_cursor, production_remainder, blocked_reason, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, 1, ?, ?)`
      ).bind(input.assignmentId, input.farmId, input.actorId, input.actorJobId, input.workAreaId, input.sourceId, input.activatedAt, input.activatedAt, input.activatedAt)
    ]);
    const row = await this.db.prepare(
      `SELECT p.id AS assignment_id, p.source_id, p.farm_id, p.actor_job_id,
              s.rate_per_hour, p.settlement_cursor, p.version,
              s.kind, s.output_item_definition_id, s.farm_id AS source_farm_id
         FROM production_assignments p
         JOIN production_sources s ON s.id = p.source_id
        WHERE p.actor_job_id = ? AND p.farm_id = ?`
    ).bind(input.actorJobId, input.farmId).first<{
      assignment_id: string; source_id: string; farm_id: string; actor_job_id: string;
      rate_per_hour: number; settlement_cursor: string; version: number;
      kind: string; output_item_definition_id: string; source_farm_id: string;
    }>();
    if (row === null || row.kind !== "FINITE" || row.output_item_definition_id !== input.outputItemDefinitionId
      || !row.source_id.startsWith("production_source_fishery_") || row.source_farm_id !== input.farmId
      || row.farm_id !== input.farmId || row.source_id !== input.sourceId) {
      throw new ApplicationError("INTERNAL_ERROR", "Wild fishery production binding is inconsistent");
    }
    return {
      assignmentId: row.assignment_id, sourceId: row.source_id, farmId: parseFarmId(row.farm_id),
      actorJobId: parseJobId(row.actor_job_id), ratePerHour: row.rate_per_hour,
      settlementCursor: row.settlement_cursor, version: row.version
    };
  }
}

interface PlayerRow {
  id: string;
  auth_issuer: string;
  auth_subject: string;
  display_name: string;
  status: PlayerStatus;
  created_at: string;
  updated_at: string;
}

interface FarmRow {
  id: string;
  owner_player_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  starter_world_version: number;
}

interface FarmMemberRow {
  farm_id: string;
  player_id: string;
  role: FarmRole;
  created_at: string;
}

interface FarmTileRow {
  farm_id: string;
  x: number;
  y: number;
  terrain_type: TerrainType;
  tile_state: TileState;
  version: number;
  updated_at: string;
}

interface CropInstanceRow {
  id: string;
  farm_id: string;
  tile_x: number;
  tile_y: number;
  crop_definition_id: string;
  planted_by_player_id: string;
  planted_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface IdempotencyRow {
  actor_player_id: string;
  operation: string;
  request_id: string;
  payload_fingerprint: string;
  resource_id: string;
  response_json: string;
  status: "COMPLETED";
  created_at: string;
}

interface InventoryItemRow {
  player_id: string;
  item_definition_id: string;
  quantity: number;
  updated_at: string;
  version: number;
}

interface WalletRow {
  player_id: string;
  currency_id: string;
  balance: number;
  version: number;
  updated_at: string;
}

interface EconomyLedgerRow {
  id: string;
  player_id: string;
  currency_id: string;
  delta: number;
  balance_before: number;
  balance_after: number;
  expected_wallet_version: number;
  reason: EconomyLedgerEntry["reason"];
  reference_type: EconomyLedgerEntry["referenceType"];
  reference_id: string;
  request_id: string;
  created_at: string;
}

function mapCrop(row: CropInstanceRow): CropInstance {
  return {
    id: parseCropInstanceId(row.id),
    farmId: parseFarmId(row.farm_id),
    tileX: row.tile_x,
    tileY: row.tile_y,
    cropDefinitionId: parseCropDefinitionId(row.crop_definition_id),
    plantedByPlayerId: parsePlayerId(row.planted_by_player_id),
    plantedAt: row.planted_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class D1PlayerRepository implements PlayerRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: PlayerId): Promise<Player | null> {
    const row = await this.db
      .prepare(
        "SELECT id, auth_issuer, auth_subject, display_name, status, created_at, updated_at FROM players WHERE id = ?"
      )
      .bind(id)
      .first<PlayerRow>();
    return row === null
      ? null
      : {
          id: parsePlayerId(row.id),
          authIssuer: row.auth_issuer,
          authSubject: row.auth_subject,
          displayName: row.display_name,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
  }
}

/**
 * The Island Warehouse's persistence: the capacity row, the used-capacity aggregate, and the one
 * atomic upgrade.
 *
 * `upgradeAtomically` writes the ledger row (which the ledger triggers validate against the wallet and
 * apply to it), the materials consumed, the tier and capacity change, and the receipt - all in one
 * batch. The warehouse update is guarded by the tier and version the caller read, and the receipt is
 * written only if the resulting state exists, so two racing upgrades cannot both win and the cap can
 * never rise without being paid for.
 */
export class D1WarehouseRepository implements WarehouseRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId): Promise<WarehouseState | null> {
    const row = await this.db
      .prepare(
        "SELECT tier, capacity, version, (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = warehouse.owner_player_id) AS used FROM home_island_warehouses AS warehouse WHERE owner_player_id = ?"
      )
      .bind(playerId)
      .first<{ tier: number; capacity: number; version: number; used: number }>();
    if (row === null) return null;
    return { tier: row.tier, capacity: row.capacity, version: row.version, used: row.used };
  }

  async usedCapacity(playerId: PlayerId): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(SUM(quantity), 0) AS used FROM inventory_items WHERE player_id = ?")
      .bind(playerId)
      .first<{ used: number }>();
    return row?.used ?? 0;
  }

  async upgradeAtomically(upgrade: WarehouseUpgrade, idempotency: IdempotencyRecord): Promise<void> {
    if (
      upgrade.playerId !== idempotency.actorPlayerId ||
      upgrade.economy.playerId !== upgrade.playerId ||
      upgrade.economy.reason !== "WAREHOUSE_UPGRADE"
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Warehouse upgrade ownership does not match");
    }
    if (upgrade.expectedInventory.length !== upgrade.removals.length) {
      throw new ApplicationError("INVALID_INPUT", "Warehouse upgrade materials do not match");
    }

    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
        .bind(upgrade.economy.playerId, upgrade.economy.currencyDefinitionId, upgrade.createdAt, upgrade.createdAt),
      this.db
        .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          upgrade.economy.transactionId,
          upgrade.economy.playerId,
          upgrade.economy.currencyDefinitionId,
          upgrade.economy.delta,
          upgrade.economy.balanceBefore,
          upgrade.economy.balanceAfter,
          upgrade.economy.expectedWalletVersion,
          upgrade.economy.reason,
          upgrade.economy.referenceType,
          upgrade.economy.referenceId,
          upgrade.economy.requestId,
          upgrade.economy.createdAt
        ),
      ...upgrade.removals.map((removal, index) => {
        const expected = upgrade.expectedInventory[index];
        return this.db
          .prepare(
            "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
          )
          .bind(
            removal.quantity,
            removal.timestamp,
            removal.playerId,
            removal.itemDefinitionId,
            expected?.quantity ?? -1,
            expected?.version ?? -1,
            removal.quantity
          );
      }),
      this.db
        .prepare(
          "INSERT INTO home_island_warehouses (owner_player_id, zone_kind, zone_id, tier, capacity, version, last_upgrade_transaction_id, created_at, updated_at) VALUES (?, 'HOME_ISLAND', NULL, ?, ?, 1, ?, ?, ?) ON CONFLICT(owner_player_id) DO UPDATE SET tier = excluded.tier, capacity = excluded.capacity, version = home_island_warehouses.version + 1, last_upgrade_transaction_id = excluded.last_upgrade_transaction_id, updated_at = excluded.updated_at WHERE home_island_warehouses.tier = ? AND home_island_warehouses.version = ?"
        )
        .bind(
          upgrade.playerId,
          upgrade.toTier,
          upgrade.capacity,
          // The marker is this transaction's own ledger id: the receipt below requires it back, so a
          // racing upgrade whose step was refused cannot borrow the winner's tier and version.
          upgrade.economy.transactionId,
          upgrade.createdAt,
          upgrade.createdAt,
          upgrade.expectedFromTier,
          upgrade.expectedVersion
        ),
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) AND EXISTS (SELECT 1 FROM home_island_warehouses WHERE owner_player_id = ? AND tier = ? AND version = ? AND last_upgrade_transaction_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          upgrade.economy.playerId,
          upgrade.economy.currencyDefinitionId,
          upgrade.economy.balanceAfter,
          upgrade.economy.expectedWalletVersion + 1,
          upgrade.economy.transactionId,
          upgrade.economy.playerId,
          upgrade.playerId,
          upgrade.toTier,
          upgrade.expectedVersion + 1,
          upgrade.economy.transactionId,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ];

    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic warehouse upgrade failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("economy conflict") || error.message.includes("idempotency_keys.actor_player_id"))
      ) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Warehouse or economy state changed concurrently");
      }
      throw error;
    }
  }
}

export class D1FarmRepository implements FarmRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async createWithOwner(
    farm: Farm,
    ownerMembership: FarmMember,
    initialTiles: readonly FarmTile[]
  ): Promise<void> {
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(farm.id, farm.ownerPlayerId, farm.name, farm.createdAt, farm.updatedAt),
      this.db
        .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, ?, ?)")
        .bind(
          ownerMembership.farmId,
          ownerMembership.playerId,
          ownerMembership.role,
          ownerMembership.createdAt
        ),
      ...initialTiles.map((tile) =>
        this.db
          .prepare(
            "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      )
    ];
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic farm creation failed");
    }
  }

  async findById(id: FarmId): Promise<Farm | null> {
    const row = await this.db
      .prepare("SELECT id, owner_player_id, name, created_at, updated_at FROM farms WHERE id = ?")
      .bind(id)
      .first<FarmRow>();
    return row === null
      ? null
      : {
          id: parseFarmId(row.id),
          ownerPlayerId: parsePlayerId(row.owner_player_id),
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
  }

  /**
   * The farm a player owns.
   *
   * `0014` makes this at most one row per player, so no ordering is needed; the LIMIT is there to say
   * so rather than to pick a favourite.
   */
  async findByOwner(playerId: PlayerId): Promise<Farm | null> {
    const row = await this.db
      .prepare(
        "SELECT id, owner_player_id, name, created_at, updated_at FROM farms WHERE owner_player_id = ? LIMIT 1"
      )
      .bind(playerId)
      .first<FarmRow>();
    return row === null
      ? null
      : {
          id: parseFarmId(row.id),
          ownerPlayerId: parsePlayerId(row.owner_player_id),
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
  }

  /**
   * What seeding needs to know about a farm, and nothing else.
   *
   * Its own read rather than a field on `Farm`: the version is bookkeeping for the one pass that
   * seeds a farm, and every other use case would be carrying a number it never reads. A missing row
   * answers null, which the seeder treats as "nothing to seed".
   */
  async starterWorldState(farmId: FarmId): Promise<{ readonly ownerPlayerId: PlayerId; readonly version: number } | null> {
    const row = await this.db
      .prepare("SELECT owner_player_id, starter_world_version FROM farms WHERE id = ?")
      .bind(farmId)
      .first<{ owner_player_id: string; starter_world_version: number }>();
    return row === null
      ? null
      : { ownerPlayerId: parsePlayerId(row.owner_player_id), version: row.starter_world_version };
  }
}

export class D1FarmMemberRepository implements FarmMemberRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null> {
    const row = await this.db
      .prepare("SELECT farm_id, player_id, role, created_at FROM farm_members WHERE farm_id = ? AND player_id = ?")
      .bind(farmId, playerId)
      .first<FarmMemberRow>();
    return row === null
      ? null
      : {
          farmId: parseFarmId(row.farm_id),
          playerId: parsePlayerId(row.player_id),
          role: row.role,
          createdAt: row.created_at
        };
  }
}

function mapFarmTile(row: FarmTileRow): FarmTile {
  return {
    farmId: parseFarmId(row.farm_id),
    x: row.x,
    y: row.y,
    terrainType: row.terrain_type,
    state: row.tile_state,
    version: row.version,
    updatedAt: row.updated_at
  };
}

export class D1FarmTileRepository implements FarmTileRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async insert(tile: FarmTile): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      .run();
  }

  async find(farmId: FarmId, x: number, y: number): Promise<FarmTile | null> {
    const row = await this.db
      .prepare(
        "SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?"
      )
      .bind(farmId, x, y)
      .first<FarmTileRow>();
    return row === null ? null : mapFarmTile(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly FarmTile[]> {
    const result = await this.db
      .prepare(
        "SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at FROM farm_tiles WHERE farm_id = ? ORDER BY y, x"
      )
      .bind(farmId)
      .all<FarmTileRow>();
    return result.results.map(mapFarmTile);
  }

  async updateVersion(tile: FarmTile, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE farm_tiles SET tile_state = ?, version = version + 1, updated_at = ? WHERE farm_id = ? AND x = ? AND y = ? AND version = ?"
      )
      .bind(tile.state, tile.updatedAt, tile.farmId, tile.x, tile.y, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }
}

export class D1CropRepository implements CropInstanceRepository, IdempotencyRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: CropInstanceId): Promise<CropInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE id = ?"
      )
      .bind(id)
      .first<CropInstanceRow>();
    return row === null ? null : mapCrop(row);
  }

  async findAtTile(farmId: FarmId, x: number, y: number): Promise<CropInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE farm_id = ? AND tile_x = ? AND tile_y = ?"
      )
      .bind(farmId, x, y)
      .first<CropInstanceRow>();
    return row === null ? null : mapCrop(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly CropInstance[]> {
    const result = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE farm_id = ? ORDER BY tile_y, tile_x"
      )
      .bind(farmId)
      .all<CropInstanceRow>();
    return result.results.map(mapCrop);
  }

  async find(actorPlayerId: PlayerId, operation: string, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = ? AND request_id = ?"
      )
      .bind(actorPlayerId, operation, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }

  async plantAtomically(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (seedRemoval.playerId !== expectedInventory.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Seed removal ownership does not match");
    }
    const seedAfterQuantity = expectedInventory.quantity - seedRemoval.quantity;
    const seedAfterVersion = expectedInventory.version + 1;
    const statements: D1PreparedStatementLike[] = [];
    if (tile.kind === "CREATE") {
      // Free natural Home Island land (V14.5.2): the tile row is written with the planting, so the
      // crop's foreign key and the tile-state checks hold. No money, no ledger row, no ownership
      // concept - IGNORE because a concurrent plant of the same fresh cell may have written it first.
      statements.push(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(tile.tile.farmId, tile.tile.x, tile.tile.y, tile.tile.terrainType, tile.tile.state, tile.tile.version, tile.tile.updatedAt)
      );
    }
    statements.push(
      // Spends the seed first, guarded on the exact quantity and version the caller read. SQLite
      // cannot fail an UPDATE that matches no rows, so a lost race shows up in the final idempotency
      // statement below, which is what actually aborts the batch.
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          seedRemoval.quantity,
          seedRemoval.timestamp,
          seedRemoval.playerId,
          seedRemoval.itemDefinitionId,
          expectedInventory.quantity,
          expectedInventory.version,
          seedRemoval.quantity
        ),
      this.cropInsertStatement(crop, tile),
      // The receipt commits only when the crop row exists *and* the seed row is exactly where this
      // settlement left it. Either half missing aborts the whole batch, so a failure after the crop
      // insert cannot leave a planted crop that was never paid for.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crop.id, crop.farmId, crop.version,
          seedRemoval.playerId, seedRemoval.itemDefinitionId, seedAfterQuantity, seedAfterVersion,
          idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
          idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
          idempotency.responseJson, idempotency.createdAt
        )
    );
    await executeD1AtomicBatch(this.db, [{
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic crop planting failed");
        }
        return undefined;
      }
    }]);
  }

  /**
   * The same planting, paid for out of the actor's cargo.
   *
   * Identical in every respect except the container the seed leaves: the same free-natural-land tile
   * insert, the same crop insert guarded on the tile the caller read, and the same receipt that only
   * commits when the crop exists *and* the seed row is exactly where this settlement left it. An
   * emptied cargo stack is deleted rather than left behind at zero, so cargo can always be unloaded
   * without a zero-quantity stack in the way.
   */
  async plantFromCargoAtomically(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: CargoRemoval,
    expectedCargo: ActorCargoItem,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    await executeD1AtomicBatch(this.db, [this.preparePlantFromCargoSettlement(crop, tile, seedRemoval, expectedCargo, idempotency)]);
  }

  /** Composes the real cargo-funded Plant component with a trusted Auto component in one batch. */
  async plantFromCargoWithAutoAtomically(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: CargoRemoval,
    expectedCargo: ActorCargoItem,
    idempotency: IdempotencyRecord,
    auto: D1AtomicBatchComponent<void>
  ): Promise<void> {
    await executeD1AtomicAutoPlant(
      this.db,
      this.preparePlantFromCargoSettlement(crop, tile, seedRemoval, expectedCargo, idempotency, { deferReceipt: true }),
      auto
    );
  }

  /**
   * Prepares the authoritative cargo-funded Plant mutation without executing it. This is a trusted
   * Worker-side capability: callers receive a component, never SQL, and may compose it with another
   * server-owned component in the same D1 batch.
   */
  preparePlantFromCargoSettlement(
    crop: CropInstance,
    tile: TilePlan,
    seedRemoval: CargoRemoval,
    expectedCargo: ActorCargoItem,
    idempotency: IdempotencyRecord,
    options: { readonly deferReceipt?: boolean } = {}
  ): D1AtomicBatchComponent<void> {
    if (seedRemoval.actorId !== expectedCargo.actorId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Cargo seed removal ownership does not match");
    }
    const seedAfterQuantity = expectedCargo.quantity - seedRemoval.quantity;
    const seedAfterVersion = expectedCargo.version + 1;
    const statements: D1PreparedStatementLike[] = [];
    if (tile.kind === "CREATE") {
      statements.push(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(tile.tile.farmId, tile.tile.x, tile.tile.y, tile.tile.terrainType, tile.tile.state, tile.tile.version, tile.tile.updatedAt)
      );
    }
    statements.push(
      // Claim this exact cargo revision with this settlement's durable identity. A losing contender
      // cannot borrow the winner's post-state because every later statement is scoped to this marker.
      this.db
        .prepare(
          "UPDATE actors SET cargo_transfer_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)"
        )
        .bind(
          idempotency.requestId,
          seedRemoval.actorId,
          seedRemoval.actorId,
          seedRemoval.itemDefinitionId,
          expectedCargo.quantity,
          expectedCargo.version
        ),
      // Spends the carried seed first, guarded on the exact quantity and version the caller read - the
      // same shape the warehouse path uses, against the other container. A cargo row can never hold
      // zero (the table's own check says so), so the last unit deletes the stack rather than leaving an
      // empty one behind: a zero-quantity stack would make the next unload a zero-value transfer.
      seedAfterQuantity === 0
        ? this.db
            .prepare(
              "DELETE FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)"
            )
            .bind(seedRemoval.actorId, seedRemoval.itemDefinitionId, expectedCargo.quantity, expectedCargo.version, seedRemoval.actorId, idempotency.requestId)
        : this.db
            .prepare(
              "UPDATE actor_cargo_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ? AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)"
            )
            .bind(
              seedRemoval.quantity,
              seedRemoval.timestamp,
              seedRemoval.actorId,
              seedRemoval.itemDefinitionId,
              expectedCargo.quantity,
              expectedCargo.version,
              seedRemoval.quantity,
              seedRemoval.actorId,
              idempotency.requestId
            ),
      // The container's own version moves with every mutation, so a concurrent cargo reader learns it
      // is stale rather than acting on a container that no longer exists.
      this.db.prepare("UPDATE actors SET cargo_version = cargo_version + 1 WHERE id = ? AND cargo_transfer_id = ?").bind(seedRemoval.actorId, idempotency.requestId),
      this.cropInsertStatement(crop, tile),
    );
    if (!options.deferReceipt) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) AND (EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) OR ? = 0) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            crop.id, crop.farmId, crop.version,
            seedRemoval.actorId, seedRemoval.itemDefinitionId, seedAfterQuantity, seedAfterVersion, seedAfterQuantity,
            idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
            idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId, idempotency.responseJson, idempotency.createdAt
          )
      );
    }
    return {
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic crop planting failed");
        }
        return undefined;
      }
    };
  }

  /**
   * The crop insert, guarded on the tile the plant expected.
   *
   * `EXISTING` keeps the original version predicate: the row must still be exactly what the caller
   * read. `CREATE` accepts the row the settlement just wrote (or one a concurrent plant wrote first)
   * as long as it is still empty soil.
   */
  private cropInsertStatement(crop: CropInstance, tile: TilePlan): D1PreparedStatementLike {
    const columns =
      "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ? AND terrain_type = 'SOIL' AND tile_state = 'IDLE'";
    const values: unknown[] = [
      crop.id,
      crop.farmId,
      crop.tileX,
      crop.tileY,
      crop.cropDefinitionId,
      crop.plantedByPlayerId,
      crop.plantedAt,
      crop.version,
      crop.createdAt,
      crop.updatedAt,
      crop.farmId,
      crop.tileX,
      crop.tileY
    ];
    if (tile.kind === "CREATE") return this.db.prepare(columns).bind(...values);
    return this.db.prepare(`${columns} AND version = ?`).bind(...values, tile.version);
  }

  async removeAtomically(
    crop: CropInstance,
    expectedCropVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const results = await this.db.batch([
      // Claim the exact crop revision before deleting it. Checking only that the crop is absent
      // after DELETE would let a second request whose DELETE matched zero rows also commit a
      // successful receipt. Since a D1 batch is one transaction, a later DELETE failure rolls this
      // receipt back with the batch.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crop.id,
          crop.farmId,
          expectedCropVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        ),
      this.db
        .prepare("DELETE FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?")
        .bind(crop.id, crop.farmId, expectedCropVersion)
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic crop removal failed");
    }
  }
}

/**
 * The one-time starter package receipt.
 *
 * The insert is the whole command: `starter_grant_apply` credits the seed stack, creates the wallet,
 * and appends the ledger row in the same statement, and the receipt's primary key on
 * `(player, grant key)` is what makes the package happen once. A second call -- a repeated
 * onboarding pass, a second farm, a replayed sign-in, a retried request, a racing pair -- matches the
 * existing row and reports `changes = 0`, so nothing is credited and no error is raised.
 *
 * There is deliberately no read-then-write here: the conflict is resolved by the primary key inside
 * one statement, so concurrent callers cannot both observe an empty receipt.
 */
export class D1StarterGrantRepository implements StarterGrantRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async grantStarterPackageAtomically(grant: StarterGrant): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO starter_grants (player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount, transaction_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"
        )
        .bind(
          grant.playerId,
          grant.grantKey,
          grant.itemDefinitionId,
          grant.itemQuantity,
          grant.currencyDefinitionId,
          grant.goldAmount,
          grant.transactionId,
          grant.requestId,
          grant.timestamp
        )
    ]);
    const result = results[0];
    if (result === undefined || !result.success) {
      throw new Error("Atomic starter package grant failed");
    }
    return (result.meta.changes ?? 0) === 1;
  }
}

export class D1InventoryRepository implements InventoryRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId, itemDefinitionId: ItemDefinitionId): Promise<InventoryItem | null> {
    const row = await this.db
      .prepare("SELECT player_id, item_definition_id, quantity, updated_at, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .bind(playerId, itemDefinitionId)
      .first<InventoryItemRow>();
    return row === null ? null : mapInventoryItem(row);
  }

  async listByPlayer(playerId: PlayerId): Promise<readonly InventoryItem[]> {
    const rows = await this.db
      .prepare("SELECT player_id, item_definition_id, quantity, updated_at, version FROM inventory_items WHERE player_id = ? ORDER BY item_definition_id")
      .bind(playerId)
      .all<InventoryItemRow>();
    return rows.results.map(mapInventoryItem);
  }
}

export class D1WalletRepository implements WalletRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId, currencyDefinitionId: CurrencyDefinitionId): Promise<Wallet | null> {
    const row = await this.db
      .prepare("SELECT player_id, currency_id, balance, version, updated_at FROM wallets WHERE player_id = ? AND currency_id = ?")
      .bind(playerId, currencyDefinitionId)
      .first<WalletRow>();
    return row === null ? null : mapWallet(row);
  }

  async listByPlayer(playerId: PlayerId): Promise<readonly Wallet[]> {
    const rows = await this.db
      .prepare("SELECT player_id, currency_id, balance, version, updated_at FROM wallets WHERE player_id = ? ORDER BY currency_id")
      .bind(playerId)
      .all<WalletRow>();
    return rows.results.map(mapWallet);
  }
}

function mapWallet(row: WalletRow): Wallet {
  return {
    playerId: parsePlayerId(row.player_id),
    currencyDefinitionId: parseCurrencyDefinitionId(row.currency_id),
    balance: row.balance,
    version: row.version,
    updatedAt: row.updated_at
  };
}

export class D1EconomyLedgerRepository implements EconomyLedgerRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByTransactionId(transactionId: EconomyTransactionId): Promise<EconomyLedgerEntry | null> {
    const row = await this.db
      .prepare("SELECT id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at FROM economy_ledger WHERE id = ?")
      .bind(transactionId)
      .first<EconomyLedgerRow>();
    return row === null ? null : mapLedger(row);
  }

  async listByPlayer(playerId: PlayerId, limit: number): Promise<readonly EconomyLedgerEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new ApplicationError("INVALID_INPUT", "Ledger query limit is invalid");
    }
    const rows = await this.db
      .prepare("SELECT id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at FROM economy_ledger WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .bind(playerId, limit)
      .all<EconomyLedgerRow>();
    return rows.results.map(mapLedger);
  }
}

export class D1EconomyMutationRepository implements EconomyMutationRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async applyAtomically(mutation: EconomyMutation): Promise<void> {
    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(mutation.playerId, mutation.currencyDefinitionId, mutation.createdAt, mutation.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            mutation.transactionId,
            mutation.playerId,
            mutation.currencyDefinitionId,
            mutation.delta,
            mutation.balanceBefore,
            mutation.balanceAfter,
            mutation.expectedWalletVersion,
            mutation.reason,
            mutation.referenceType,
            mutation.referenceId,
            mutation.requestId,
            mutation.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic economy mutation failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("economy conflict")) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Wallet changed concurrently");
      }
      throw error;
    }
  }
}

export class D1ConstructionRepository implements ConstructionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  private async hasForestryLifecycleTable(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'forestry_construction_states'")
      .first<{ readonly name: string }>();
    return row !== null;
  }

  /**
   * Building something: the money, the row, and the receipt, all or nothing.
   *
   * The wallet movement is not written by this class - `economy_ledger`'s own triggers move it, so a
   * construction charge travels the same path a shop purchase does and cannot skip the ledger. The
   * construction insert brings its own database-level rules with it: the cells must be free and must
   * not hold a crop or a tree. V14.5.2 writes the footprint's missing `farm_tiles` rows first - the
   * natural Home Island is the player's land, so a fresh cell costs nothing and the rows exist only so
   * the crop/construction cross-occupancy rules keep working. The receipt is written last and only if
   * the wallet and the construction it names both exist at the balances this batch produced, so a
   * half-applied placement cannot leave a receipt behind.
   */
  async placeAtomically(
    placement: ConstructionPlacement,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const { construction, economy } = placement;
    if (
      economy.playerId !== idempotency.actorPlayerId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.source !== "PLAYER_PLACED" ||
      construction.state !== "ACTIVE" ||
      economy.reason !== "CONSTRUCTION" ||
      economy.referenceId !== construction.id
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction settlement ownership does not match");
    }
    try {
      const hasForestryLifecycle = await this.hasForestryLifecycleTable();
      const statements: D1PreparedStatementLike[] = [
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),

        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.transactionId,
            economy.playerId,
            economy.currencyDefinitionId,
            economy.delta,
            economy.balanceBefore,
            economy.balanceAfter,
            economy.expectedWalletVersion,
            economy.reason,
            economy.referenceType,
            economy.referenceId,
            economy.requestId,
            economy.createdAt
          ),
        // Free natural-land rows the footprint needs and the farm does not have yet (V14.5.2). They
        // are written before the construction so the trigger that counts the footprint's cells sees
        // them; IGNORE because a cell may already have been given a row by a concurrent action.
        ...placement.tiles.map((tile) =>
          this.db
            .prepare(
              "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
        ),
        this.db
          .prepare("INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            construction.id,
            construction.farmId,
            construction.entryId,
            construction.category,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.state,
            construction.ownerPlayerId,
            construction.source,
            construction.placementKey,
            construction.paidAmount,
            construction.costAmount,
            construction.costCurrencyDefinitionId,
            construction.createdAt,
            construction.updatedAt,
            construction.storedAt,
            construction.version
          ),
        ...(construction.entryId === "place_fish_cage"
          ? [
              this.db
                .prepare(
                  "INSERT INTO aquaculture_pond_states (construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at) VALUES (?, ?, NULL, NULL, NULL, 0, ?)"
                )
                .bind(construction.id, construction.farmId, construction.createdAt)
            ]
          : []),
        ...(hasForestryLifecycle && isForestryConstructionEntryId(construction.entryId)
          ? [
              this.db
                .prepare(
                  "INSERT OR IGNORE INTO forestry_construction_states (construction_id, farm_id, entry_id, last_chopped_at, regeneration_at, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, 1, ?, ?)"
                )
                .bind(construction.id, construction.farmId, construction.entryId, construction.createdAt, construction.updatedAt)
            ]
          : []),
        this.db
          .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND owner_player_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.playerId,
            economy.currencyDefinitionId,
            economy.balanceAfter,
            economy.expectedWalletVersion + 1,
            construction.id,
            construction.farmId,
            construction.ownerPlayerId,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ];
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic construction placement failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("economy conflict") ||
          error.message.includes("construction cells") ||
          error.message.includes("idempotency_keys.actor_player_id"))
      ) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  async findById(id: ConstructionId): Promise<ConstructionInstance | null> {
    const row = await this.db
      .prepare("SELECT * FROM farm_constructions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    return row === null ? null : toConstructionInstance(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly ConstructionInstance[]> {
    const rows = await this.db
      .prepare("SELECT * FROM farm_constructions WHERE farm_id = ? ORDER BY created_at, id")
      .bind(farmId)
      .all<Record<string, unknown>>();
    return rows.results.map(toConstructionInstance);
  }

  async listBounds(farmId: FarmId): Promise<readonly CellBounds[]> {
    const rows = await this.db
      // Only objects *standing* on the farm block ground. A stored object is held, not placed, which
      // is what lets a mill go into storage and something else take its cells.
      .prepare("SELECT min_x, max_x, min_y, max_y FROM farm_constructions WHERE farm_id = ? AND state = 'ACTIVE'")
      .bind(farmId)
      .all<Record<string, unknown>>();
    return rows.results.map((row) => ({
      minX: Number(row.min_x),
      maxX: Number(row.max_x),
      minY: Number(row.min_y),
      maxY: Number(row.max_y)
    }));
  }

  /**
   * Moving or turning one object: the new rectangle, and the receipt that says it happened.
   *
   * The update is guarded by the version the use case read, so a stale move writes nothing at all.
   * The database's own triggers do the rest: the destination must be owned, must not overlap another
   * construction (the object's own row is excluded by its id), and must not hold a crop or a tree.
   * The receipt is written only if the row it names carries the timestamp this batch produced, which
   * is what makes "the receipt exists" and "the move happened" the same fact.
   */
  async relocateAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void> {
    const { construction, expectedVersion } = relocation;
    if (
      construction.id !== idempotency.resourceId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.version !== expectedVersion + 1
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction relocation ownership does not match");
    }
    try {
      const statements: D1PreparedStatementLike[] = [
        // Free natural-land rows the destination needs (V14.5.2), written before the move so the
        // destination-cell trigger sees them.
        ...relocation.tiles.map((tile) =>
          this.db
            .prepare(
              "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
        ),
        this.db
          .prepare(
            "UPDATE farm_constructions SET anchor_x = ?, anchor_y = ?, rotation = ?, footprint_width = ?, footprint_depth = ?, min_x = ?, max_x = ?, min_y = ?, max_y = ?, cell_count = ?, updated_at = ?, version = version + 1 WHERE id = ? AND farm_id = ? AND version = ?"
          )
          .bind(
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.updatedAt,
            construction.id,
            construction.farmId,
            expectedVersion
          ),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND updated_at = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.updatedAt,
            construction.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ];
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic construction relocation failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && /construction cells|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("CONSTRUCTION_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  /**
   * Taking one object down, with its refund if its asset returns one.
   *
   * The delete is guarded by the version, exactly as a move is. The refund travels through
   * `economy_ledger`'s own triggers, so the wallet moves the same way every other payment does; the
   * receipt then points at that ledger row, and the ledger row is only written if the refund matched
   * the balance the use case read.
   */
  async removeAtomically(removal: ConstructionRemoval, idempotency: IdempotencyRecord): Promise<void> {
    const { farmId, constructionId, expectedVersion, refund } = removal;
    if (refund !== null && (refund.playerId !== idempotency.actorPlayerId || refund.reason !== "CONSTRUCTION_REFUND")) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction refund ownership does not match");
    }
    if (refund === null && idempotency.resourceId !== constructionId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction removal receipt does not match");
    }
    const deleteRow = this.db
      .prepare("DELETE FROM farm_constructions WHERE id = ? AND farm_id = ? AND version = ?")
      .bind(constructionId, farmId, expectedVersion);
    // The receipt is the last word: it is written only if the effect it claims is visible in this
    // same batch - the object gone, and, when the asset returns money, the refund in the ledger.
    const receipt =
      refund === null
        ? this.db
            .prepare(
              "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN NOT EXISTS (SELECT 1 FROM farm_constructions WHERE id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              constructionId,
              idempotency.actorPlayerId,
              idempotency.operation,
              idempotency.requestId,
              idempotency.payloadFingerprint,
              idempotency.status,
              idempotency.resourceId,
              idempotency.responseJson,
              idempotency.createdAt
            )
        : this.db
            .prepare(
              "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ? AND reason = 'CONSTRUCTION_REFUND' AND reference_id = ?) AND NOT EXISTS (SELECT 1 FROM farm_constructions WHERE id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              refund.transactionId,
              idempotency.actorPlayerId,
              constructionId,
              constructionId,
              idempotency.actorPlayerId,
              idempotency.operation,
              idempotency.requestId,
              idempotency.payloadFingerprint,
              idempotency.status,
              idempotency.resourceId,
              idempotency.responseJson,
              idempotency.createdAt
            );
    const statements =
      refund === null
        ? [deleteRow, receipt]
        : [
            this.db
              .prepare(
                "INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)"
              )
              .bind(refund.playerId, refund.currencyDefinitionId, refund.createdAt, refund.createdAt),
            this.db
              .prepare(
                "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              )
              .bind(
                refund.transactionId,
                refund.playerId,
                refund.currencyDefinitionId,
                refund.delta,
                refund.balanceBefore,
                refund.balanceAfter,
                refund.expectedWalletVersion,
                refund.reason,
                refund.referenceType,
                refund.referenceId,
                refund.requestId,
                refund.createdAt
              ),
            deleteRow,
            receipt
          ];
    try {
      const results = await this.db.batch(statements);
      if (results.some((result) => !result.success)) throw new Error("Atomic construction removal failed");
    } catch (error: unknown) {
      if (error instanceof Error && /economy conflict|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  /**
   * The starter arrangement, written once.
   *
   * The version stamp and the rows are one batch, and the rows are only written by the pass that
   * actually moved the version - `WHERE starter_world_version = ?` on the insert, with the expected
   * version the *new* one. A second caller finds the farm already stamped, its inserts select nothing,
   * and it reports zero. The unique `(farm, placement_key)` index is the second lock on the same door.
   */
  async seedAtomically(seed: ConstructionSeed): Promise<number> {
    if (seed.constructions.length === 0) return 0;
    const hasForestryLifecycle = await this.hasForestryLifecycleTable();
    const statements = [
      this.db
        .prepare(
          "UPDATE farms SET starter_world_version = ?, updated_at = ? WHERE id = ? AND starter_world_version < ?"
        )
        .bind(seed.version, seed.seededAt, seed.farmId, seed.version)
    ];
    const constructionStatementIndexes: number[] = [];
    let created = 0;
    for (const construction of seed.constructions) {
      if (construction.source !== "STARTER" || construction.placementKey === null) {
        throw new ApplicationError("INTERNAL_ERROR", "A starter row must carry its placement key");
      }
      constructionStatementIndexes.push(statements.length);
      statements.push(
        this.db
          .prepare(
            "INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT starter_world_version FROM farms WHERE id = ?) = ?"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.entryId,
            construction.category,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.state,
            construction.ownerPlayerId,
            construction.source,
            construction.placementKey,
            construction.paidAmount,
            construction.costAmount,
            construction.costCurrencyDefinitionId,
            construction.createdAt,
            construction.updatedAt,
            construction.storedAt,
            construction.version,
            seed.farmId,
            seed.version
          )
      );
      if (hasForestryLifecycle && isForestryConstructionEntryId(construction.entryId)) {
        statements.push(
          this.db
            .prepare(
              "INSERT OR IGNORE INTO forestry_construction_states (construction_id, farm_id, entry_id, last_chopped_at, regeneration_at, version, created_at, updated_at) SELECT ?, ?, ?, NULL, NULL, 1, ?, ? WHERE EXISTS (SELECT 1 FROM farm_constructions WHERE id = ?)"
            )
            .bind(construction.id, construction.farmId, construction.entryId, construction.createdAt, construction.updatedAt, construction.id)
        );
      }
    }
    const results = await this.db.batch(statements);
    // The first statement is the version stamp: if it changed nothing, this pass lost the race and
    // created nothing, whatever the insert results say.
    if ((results[0]?.meta.changes ?? 0) === 0) return 0;
    created = constructionStatementIndexes.reduce((total, index) => total + (results[index]?.meta.changes ?? 0), 0);
    return created;
  }

  /**
   * Moving one object between the world and storage.
   *
   * One statement for both directions: the state, the moment it changed, and - on the way back out -
   * the ground it is returning to. The version predicate is the same one every other edit uses, so a
   * stale store or restore writes nothing, and the guarded receipt makes "the receipt exists" and
   * "the object moved" the same fact.
   */
  async setStoredAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void> {
    const { construction, expectedVersion } = relocation;
    if (
      construction.id !== idempotency.resourceId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.version !== expectedVersion + 1
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction storage ownership does not match");
    }
    try {
      const statements: D1PreparedStatementLike[] = [
        // A restore onto fresh natural land writes its rows; storing writes none (`tiles` is empty).
        ...relocation.tiles.map((tile) =>
          this.db
            .prepare(
              "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
        ),
        this.db
          .prepare(
            "UPDATE farm_constructions SET state = ?, anchor_x = ?, anchor_y = ?, rotation = ?, footprint_width = ?, footprint_depth = ?, min_x = ?, max_x = ?, min_y = ?, max_y = ?, cell_count = ?, stored_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND farm_id = ? AND version = ?"
          )
          .bind(
            construction.state,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.storedAt,
            construction.updatedAt,
            construction.id,
            construction.farmId,
            expectedVersion
          ),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND updated_at = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.updatedAt,
            construction.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ];
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic construction storage change failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && /construction cells|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("CONSTRUCTION_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }
}

function isForestryConstructionEntryId(entryId: string): boolean {
  return entryId === "world.tree_broad" || entryId === "world.tree_pine" || entryId === "place_tree_broad" || entryId === "place_tree_pine";
}

interface ForestryConstructionStateRow {
  readonly construction_id: string;
  readonly farm_id: string;
  readonly entry_id: string;
  readonly last_chopped_at: string | null;
  readonly regeneration_at: string | null;
  readonly version: number;
}

function toForestryConstructionState(row: ForestryConstructionStateRow): ForestryConstructionState {
  return {
    constructionId: parseConstructionId(row.construction_id),
    farmId: parseFarmId(row.farm_id),
    entryId: row.entry_id,
    lastChoppedAt: row.last_chopped_at,
    regenerationAt: row.regeneration_at,
    version: row.version
  };
}

/** Persistent CHOP state for construction-backed trees. */
export class D1ForestryConstructionStateRepository implements ForestryConstructionStateRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  private async available(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'forestry_construction_states'")
      .first<{ readonly name: string }>();
    return row !== null;
  }

  async listByFarm(farmId: FarmId): Promise<readonly ForestryConstructionState[]> {
    if (!(await this.available())) return [];
    const rows = await this.db
      .prepare("SELECT construction_id, farm_id, entry_id, last_chopped_at, regeneration_at, version FROM forestry_construction_states WHERE farm_id = ? ORDER BY construction_id")
      .bind(farmId)
      .all<ForestryConstructionStateRow>();
    return rows.results.map(toForestryConstructionState);
  }

  async findByConstruction(farmId: FarmId, constructionId: ConstructionId): Promise<ForestryConstructionState | null> {
    if (!(await this.available())) return null;
    const row = await this.db
      .prepare("SELECT construction_id, farm_id, entry_id, last_chopped_at, regeneration_at, version FROM forestry_construction_states WHERE farm_id = ? AND construction_id = ?")
      .bind(farmId, constructionId)
      .first<ForestryConstructionStateRow>();
    return row === null ? null : toForestryConstructionState(row);
  }

  async settleChopAtomically(
    state: ForestryConstructionState,
    nextState: ForestryConstructionState,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (state.constructionId !== idempotency.resourceId || addition.playerId !== idempotency.actorPlayerId || award.playerId !== idempotency.actorPlayerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Forestry settlement ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare("UPDATE forestry_construction_states SET last_chopped_at = ?, regeneration_at = ?, version = version + 1, updated_at = ? WHERE construction_id = ? AND farm_id = ? AND version = ? AND (regeneration_at IS NULL OR regeneration_at <= ?)")
          .bind(nextState.lastChoppedAt, nextState.regenerationAt, addition.timestamp, state.constructionId, state.farmId, state.version, addition.timestamp),
        this.db
          .prepare("INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)")
          .bind(award.playerId, award.timestamp, award.timestamp),
        this.db
          .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM forestry_construction_states WHERE construction_id = ? AND farm_id = ? AND version = ? AND regeneration_at = ?) AND EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) AND COALESCE((SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?), 0) <= ? - ? THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
          .bind(state.constructionId, state.farmId, nextState.version, nextState.regenerationAt, award.playerId, award.xpBefore, award.expectedProgressionVersion, addition.playerId, addition.itemDefinitionId, addition.maxQuantity, addition.quantity, idempotency.actorPlayerId, idempotency.operation, idempotency.requestId, idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId, idempotency.responseJson, idempotency.createdAt),
        this.db
          .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = inventory_items.quantity + excluded.quantity, updated_at = excluded.updated_at, version = inventory_items.version + 1")
          .bind(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.timestamp),
        this.db
          .prepare("UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?")
          .bind(award.levelAfter, award.xpAfter, award.timestamp, award.playerId, award.xpBefore, award.expectedProgressionVersion)
      ]);
      if (results.length !== 5 || results.some((result) => !result.success)) throw new Error("Atomic forestry settlement failed");
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("NOT NULL constraint failed: idempotency_keys") || error.message.includes("forestry_construction_states"))) {
        throw new ApplicationError("FORESTRY_CONSTRUCTION_CONFLICT", "Forestry state changed concurrently");
      }
      throw error;
    }
  }
}

/** One persisted construction, as the domain reads it back. */
function toConstructionInstance(row: Record<string, unknown>): ConstructionInstance {
  // Read as values rather than coerced: a null placement key and a null stored_at are meaningful
  // (a bought object has no placement, a standing one is not stored), and `String(null)` would turn
  // either into the word "null".
  const placementKey = row.placement_key;
  const storedAt = row.stored_at;
  return {
    id: parseConstructionId(String(row.id)),
    farmId: parseFarmId(String(row.farm_id)),
    entryId: String(row.catalogue_entry_id),
    category: String(row.category),
    anchorX: Number(row.anchor_x),
    anchorY: Number(row.anchor_y),
    rotation: Number(row.rotation) as QuarterTurns,
    footprint: { widthCells: Number(row.footprint_width), depthCells: Number(row.footprint_depth) },
    bounds: {
      minX: Number(row.min_x),
      maxX: Number(row.max_x),
      minY: Number(row.min_y),
      maxY: Number(row.max_y)
    },
    state: String(row.state) === "STORED" ? "STORED" : "ACTIVE",
    ownerPlayerId: parsePlayerId(String(row.owner_player_id)),
    source: String(row.source) === "STARTER" ? "STARTER" : "PLAYER_PLACED",
    placementKey: typeof placementKey === "string" ? placementKey : null,
    paidAmount: Number(row.paid_amount),
    costAmount: Number(row.cost_amount),
    costCurrencyDefinitionId: String(row.cost_currency_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    storedAt: typeof storedAt === "string" ? storedAt : null,
    version: Number(row.version)
  };
}

export class D1EconomySettlementRepository implements EconomySettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleShopAtomically(
    economy: EconomyMutation,
    inventory: InventoryMutation,
    expectedInventory: InventoryItem | null,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== inventory.playerId || economy.playerId !== idempotency.actorPlayerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    const expectedQuantity = expectedInventory?.quantity ?? 0;
    const expectedVersion = expectedInventory?.version ?? 0;
    const afterQuantity = inventory.kind === "ADD"
      ? expectedQuantity + inventory.quantity
      : expectedQuantity - inventory.quantity;
    const afterVersion = expectedVersion + 1;
    const inventoryStatement = inventory.kind === "ADD"
      ? expectedInventory === null
        ? this.db
            .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ?)")
            .bind(inventory.playerId, inventory.itemDefinitionId, inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId)
        : this.db
            .prepare("UPDATE inventory_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity <= ? - ?")
            .bind(inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId, expectedQuantity, expectedVersion, inventory.maxQuantity, inventory.quantity)
      : this.db
          .prepare("UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?")
          .bind(inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId, expectedQuantity, expectedVersion, inventory.quantity);

    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
        inventoryStatement,
        this.db
          .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1,
            economy.transactionId, economy.playerId,
            inventory.playerId, inventory.itemDefinitionId, afterQuantity, afterVersion,
            idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
            idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
            idempotency.responseJson, idempotency.createdAt
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic shop settlement failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error &&
          (error.message.includes("economy conflict") || error.message.includes("idempotency_keys.actor_player_id"))) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
      }
      throw error;
    }
  }

  /**
   * A purchase whose goods are taken rather than stored.
   *
   * The economy half is byte-for-byte the ordinary buy: the same wallet seed, the same ledger row
   * (with the same `SHOP_BUY` reason and `SHOP_ENTRY` reference), the same receipt condition. Only the
   * item lands in the actor's cargo instead of the warehouse - which is why this needs no new ledger
   * reason, no second economy, and no new table. The cargo capacity trigger is the authority on
   * whether it fits.
   */
  async settleSupplyIntoCargoAtomically(
    economy: EconomyMutation,
    purchase: CargoPurchase,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== idempotency.actorPlayerId || economy.reason !== "SHOP_BUY") {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    const afterQuantity = purchase.expectedQuantity + purchase.quantity;
    const afterVersion = purchase.expectedVersion + 1;
    const walletSettled =
      "EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?)";
    const walletArgs = [
      economy.playerId,
      economy.currencyDefinitionId,
      economy.balanceAfter,
      economy.expectedWalletVersion + 1
    ] as const;
    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.transactionId,
            economy.playerId,
            economy.currencyDefinitionId,
            economy.delta,
            economy.balanceBefore,
            economy.balanceAfter,
            economy.expectedWalletVersion,
            economy.reason,
            economy.referenceType,
            economy.referenceId,
            economy.requestId,
            economy.createdAt
          ),
        // The container's own version moves with every cargo mutation, purchases included - otherwise a
        // client could keep presenting a version that no longer describes what the actor is carrying.
        this.db
          .prepare("UPDATE actors SET cargo_version = cargo_version + 1 WHERE id = ?")
          .bind(purchase.actorId),
        // Growth on an existing stack, then the first acquisition, each scoped to the wallet state
        // this same batch produced - so a purchase that did not settle cannot move an item.
        this.db
          .prepare(
            `UPDATE actor_cargo_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND ${walletSettled}`
          )
          .bind(
            purchase.quantity,
            purchase.timestamp,
            purchase.actorId,
            purchase.itemDefinitionId,
            purchase.expectedQuantity,
            purchase.expectedVersion,
            ...walletArgs
          ),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) SELECT ?, ?, ?, 1, ? WHERE ${walletSettled} AND NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?)`
          )
          .bind(
            purchase.actorId,
            purchase.itemDefinitionId,
            purchase.quantity,
            purchase.timestamp,
            ...walletArgs,
            purchase.actorId,
            purchase.itemDefinitionId
          ),
        this.db
          .prepare(
            `INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${walletSettled} AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) AND EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            ...walletArgs,
            economy.transactionId,
            economy.playerId,
            purchase.actorId,
            purchase.itemDefinitionId,
            afterQuantity,
            afterVersion,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 6 || results.some((result) => !result.success)) {
        throw new Error("Atomic supply purchase failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("cargo_full")) {
        throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
      }
      if (error instanceof Error &&
          (error.message.includes("economy conflict") || error.message.includes("idempotency_keys.actor_player_id"))) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
      }
      throw error;
    }
  }

  prepareAutoSupplyPurchase(
    economy: EconomyMutation,
    purchase: CargoPurchase,
    transitionId: string
  ): D1AtomicBatchComponent<void> {
    if (economy.reason !== "SHOP_BUY") throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    const walletSettled = "EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?)";
    const walletArgs = [economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1] as const;
    const statements = [
      this.db.prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)").bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
      this.db.prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
      this.db.prepare("UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?").bind(transitionId, purchase.actorId, purchase.expectedCargoVersion),
      this.db.prepare(`UPDATE actor_cargo_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND ${walletSettled}`).bind(purchase.quantity, purchase.timestamp, purchase.actorId, purchase.itemDefinitionId, purchase.expectedQuantity, purchase.expectedVersion, ...walletArgs),
      this.db.prepare(`INSERT OR IGNORE INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) SELECT ?, ?, ?, 1, ? WHERE ${walletSettled} AND NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?)`).bind(purchase.actorId, purchase.itemDefinitionId, purchase.quantity, purchase.timestamp, ...walletArgs, purchase.actorId, purchase.itemDefinitionId)
    ];
    return { statements, verify: (results) => {
      if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto supply purchase failed");
    } };
  }

  /**
   * The emergency-funded purchase, as one composable component.
   *
   * The whitelist sales come first - each one is an inventory subtraction guarded on exactly the row
   * the caller read, plus its own `SHOP_SELL` ledger row (whose trigger moves the wallet) - and the
   * purchase follows as the ordinary `SHOP_BUY` row plus the cargo grant this actor claims. Every
   * statement is scoped to the transition's own marker or to the state its predecessor just wrote, so
   * a stale caller can subtract nothing and buy nothing.
   */
  prepareAutoFundingPurchase(
    saleLegs: readonly AutoFundingSaleLeg[],
    economy: EconomyMutation,
    purchase: CargoPurchase,
    transitionId: string
  ): D1AtomicBatchComponent<void> {
    if (economy.reason !== "SHOP_BUY") throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    if (saleLegs.length === 0) throw new ApplicationError("INVALID_FUNDING", "A funded purchase needs a sale");
    const timestamp = purchase.timestamp;
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
        .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt)
    ];
    const saleStateChecks: string[] = [];
    const saleStateArgs: unknown[] = [];
    for (const leg of saleLegs) {
      statements.push(
        this.db
          .prepare(
            "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
          )
          .bind(leg.quantity, timestamp, economy.playerId, leg.itemDefinitionId, leg.expectedInventoryQuantity, leg.expectedInventoryVersion, leg.quantity),
        this.db
          .prepare(
            "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'SHOP_SELL', 'SHOP_ENTRY', ?, ?, ?)"
          )
          .bind(
            leg.transactionId,
            economy.playerId,
            economy.currencyDefinitionId,
            leg.quantity * leg.unitPrice,
            leg.balanceBefore,
            leg.balanceAfter,
            leg.expectedWalletVersion,
            leg.shopEntryId,
            leg.requestId,
            timestamp
          )
      );
      saleStateChecks.push("EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)");
      saleStateArgs.push(economy.playerId, leg.itemDefinitionId, leg.inventoryAfterQuantity, leg.expectedInventoryVersion + 1);
      saleStateChecks.push("EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?)");
      saleStateArgs.push(leg.transactionId, economy.playerId);
    }
    // The purchase: the authoritative ledger debit (its trigger moves the wallet), then this actor's
    // cargo claim, all scoped to the state the sales just wrote.
    statements.push(
      this.db
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
      this.db
        .prepare("UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?")
        .bind(transitionId, purchase.actorId, purchase.expectedCargoVersion)
    );
    const provenance = [
      "EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?)",
      "EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?)",
      "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)",
      ...saleStateChecks
    ].join(" AND ");
    const provenanceArgs: unknown[] = [
      economy.playerId,
      economy.currencyDefinitionId,
      economy.balanceAfter,
      economy.expectedWalletVersion + 1,
      economy.transactionId,
      economy.playerId,
      purchase.actorId,
      transitionId,
      ...saleStateArgs
    ];
    statements.push(
      this.db
        .prepare(
          `UPDATE actor_cargo_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND ${provenance}`
        )
        .bind(purchase.quantity, timestamp, purchase.actorId, purchase.itemDefinitionId, purchase.expectedQuantity, purchase.expectedVersion, ...provenanceArgs),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) SELECT ?, ?, ?, 1, ? WHERE ${provenance} AND NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?)`
        )
        .bind(purchase.actorId, purchase.itemDefinitionId, purchase.quantity, timestamp, ...provenanceArgs, purchase.actorId, purchase.itemDefinitionId)
    );
    return {
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic Auto funding purchase failed");
        }
      }
    };
  }
}

export class D1FarmExpansionRepository implements FarmExpansionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  /**
   * Buys a chosen set of cells: the wallet movement, its ledger row, the new tile rows, and the
   * receipt, in one batch.
   *
   * Unlike a plot purchase the cohort is not a fixed square, so the geometry check is "distinct,
   * bounded, one farm" rather than "exactly 144 cells". The primary key on `farm_tiles` is what makes
   * a racing purchase of the same cell fail closed - the batch is refused and nothing is charged.
   */
  async buyLandCellsAtomically(
    economy: EconomyMutation,
    tiles: readonly FarmTile[],
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== idempotency.actorPlayerId || economy.reason !== "FARM_EXPANSION") {
      throw new ApplicationError("NOT_AUTHORIZED", "Land purchase settlement ownership does not match");
    }
    if (
      tiles.length === 0 ||
      tiles.length > MAX_LAND_CELLS_PER_REQUEST ||
      tiles.some((tile) => tile.farmId !== tiles[0]?.farmId || tile.terrainType !== "SOIL" || tile.version !== 1)
    ) {
      throw new ApplicationError("INVALID_INPUT", "Land cell cohort is invalid");
    }
    if (new Set(tiles.map((tile) => `${String(tile.x)},${String(tile.y)}`)).size !== tiles.length) {
      throw new ApplicationError("INVALID_INPUT", "Land cell cohort has duplicates");
    }

    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
        .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
      this.db
        .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
      ...tiles.map((tile) =>
        this.db
          .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      ),
      this.db
        .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1,
          economy.transactionId, economy.playerId,
          idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
          idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
          idempotency.responseJson, idempotency.createdAt
        )
    ];
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic land cell purchase failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("economy conflict") ||
          error.message.includes("UNIQUE constraint failed: farm_tiles") ||
          error.message.includes("idempotency_keys.actor_player_id"))
      ) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Farm or economy state changed concurrently");
      }
      throw error;
    }
  }

  async expandFarmAtomically(
    economy: EconomyMutation,
    tiles: readonly FarmTile[],
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== idempotency.actorPlayerId || economy.reason !== "FARM_EXPANSION") {
      throw new ApplicationError("NOT_AUTHORIZED", "Expansion settlement ownership does not match");
    }
    if (tiles.length !== PLOT_TILE_COUNT || tiles.some((tile) => tile.farmId !== tiles[0]?.farmId)) {
      throw new ApplicationError("INVALID_INPUT", "Expansion tile cohort is invalid");
    }
    const xs = tiles.map((tile) => tile.x);
    const ys = tiles.map((tile) => tile.y);
    if (new Set(xs).size !== PLOT_TILE_SIZE || new Set(ys).size !== PLOT_TILE_SIZE) {
      throw new ApplicationError("INVALID_INPUT", "Expansion tile geometry is invalid");
    }

    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
        .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
      this.db
        .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
      ...tiles.map((tile) =>
        this.db
          .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      ),
      this.db
        .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1,
          economy.transactionId, economy.playerId,
          idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
          idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
          idempotency.responseJson, idempotency.createdAt
        )
    ];
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic farm expansion failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("economy conflict") || error.message.includes("UNIQUE constraint failed: farm_tiles") || error.message.includes("idempotency_keys.actor_player_id"))) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Farm or economy state changed concurrently");
      }
      throw error;
    }
  }
}

export class D1HarvestSettlementRepository implements HarvestSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleHarvestAtomically(
    crop: CropInstance,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    await this.executeHarvestSettlement(
      crop,
      {
        destination: "WAREHOUSE",
        itemDefinitionId: addition.itemDefinitionId,
        quantity: addition.quantity,
        maxQuantity: addition.maxQuantity,
        timestamp: addition.timestamp
      },
      award,
      idempotency
    );
  }

  /**
   * The same settlement, with the reward landing in the actor's cargo.
   *
   * `maxQuantity` is the cargo container's own ceiling, and the real authority on whether the reward
   * fits is the cargo capacity trigger firing on the row the settlement's trigger writes. A harvest
   * that would overflow aborts the whole batch, so the crop stays in the ground and nothing is lost.
   */
  async settleHarvestIntoCargoAtomically(
    crop: CropInstance,
    grant: CargoGrant,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    await this.executeHarvestSettlement(
      crop,
      {
        destination: "CARGO",
        itemDefinitionId: grant.itemDefinitionId,
        quantity: grant.quantity,
        maxQuantity: MAX_CARGO_CAPACITY,
        timestamp: grant.timestamp
      },
      award,
      idempotency
    );
  }

  /**
   * One harvest settlement, whatever its destination, as a composable component.
   *
   * The four statements never change shape: the settlement row (whose own triggers validate the crop,
   * check the destination's capacity and move the goods), the progression seed, the pre-award guard,
   * and the award itself. The destination is a field on the first statement and nothing else, which is
   * what keeps "Auto yields exactly what manual yields" true by construction.
   *
   * `claim` is the Auto container claim: when present it is the batch's first statement, so the actor's
   * cargo container is claimed by this transition before anything else writes to it. A host that does
   * not pass it gets byte-for-byte the manual settlement.
   */
  prepareHarvestSettlement(
    crop: CropInstance,
    harvest: {
      readonly destination: "WAREHOUSE" | "CARGO";
      readonly itemDefinitionId: ItemDefinitionId;
      readonly quantity: number;
      readonly maxQuantity: number;
      readonly timestamp: string;
    },
    award: XpAward,
    idempotency: IdempotencyRecord,
    claim?: { readonly transitionId: string; readonly actorId: ActorId; readonly expectedContainerVersion: number }
  ): D1AtomicBatchComponent<void> {
    const statements: D1PreparedStatementLike[] = [];
    if (claim !== undefined) {
      statements.push(
        // The container claim, written with *this* transition's own id: every later statement that
        // moves the carried stack can be scoped to the marker, and the semantic receipt can prove the
        // claim happened rather than merely that a version changed.
        this.db
          .prepare(
            "UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?"
          )
          .bind(claim.transitionId, claim.actorId, claim.expectedContainerVersion)
      );
    }
    statements.push(
        this.db
          .prepare(
            "INSERT INTO harvest_settlements (actor_player_id, operation, request_id, farm_id, crop_instance_id, crop_version, crop_definition_id, item_definition_id, quantity, max_quantity, created_at, destination) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            award.playerId,
            idempotency.operation,
            idempotency.requestId,
            crop.farmId,
            crop.id,
            crop.version,
            crop.cropDefinitionId,
            harvest.itemDefinitionId,
            harvest.quantity,
            harvest.maxQuantity,
            harvest.timestamp,
            harvest.destination
          ),
        // Seeds the row for a player who has never earned experience, exactly as the wallet path
        // seeds a wallet, so one guarded update serves the first award and every later one alike.
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        // Tests the state the caller read *before* the award is applied, and the award is applied
        // after it. The pre-award state is the unambiguous choice: `xp` and `progression_version`
        // only ever increase, so a caller whose read has been overtaken can never match the current
        // row, while an after-state check cannot tell such a caller apart from one whose own award
        // already landed Ã¢â‚¬â€ both predict the same `xp` and the same next version.
        //
        // SQLite cannot fail an `UPDATE` that matches no rows, so the guard is the `CASE` below:
        // it yields NULL when the row is not where the caller left it. The database then reports
        // whichever constraint it reaches first, because a NULL actor matches no settlement in the
        // harvest idempotency trigger and aborts there, before any NOT NULL check would.
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        // Applies the award against the very state the guard just matched. Both statements test the
        // same predicate inside one transaction, so they cannot disagree about which revision the
        // caller read.
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
    );
    return {
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic harvest settlement failed");
        }
      }
    };
  }

  /** The manual boundaries: one component, one batch, the same mapping a failed settlement always had. */
  private async executeHarvestSettlement(
    crop: CropInstance,
    harvest: {
      readonly destination: "WAREHOUSE" | "CARGO";
      readonly itemDefinitionId: ItemDefinitionId;
      readonly quantity: number;
      readonly maxQuantity: number;
      readonly timestamp: string;
    },
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    try {
      await executeD1AtomicBatch(this.db, [this.prepareHarvestSettlement(crop, harvest, award, idempotency)]);
    } catch (error: unknown) {
      // Three messages mean the same thing: the guard did not match, so the caller read progression
      // before another award moved it. The caller re-reads and retries.
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys") ||
          error.message.includes("completed harvest idempotency requires settlement"))
      ) {
        throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
      }
      throw error;
    }
  }

  /**
   * The Auto harvest into cargo, as one composable component.
   *
   * The reward, its ceiling and the settlement row are the ones the manual cargo harvest already uses;
   * the extra statement is the container claim, which is what lets the Auto receipt prove that *this*
   * transition moved the goods rather than merely that some transfer did.
   */
  prepareHarvestIntoCargoAutoSettlement(
    crop: CropInstance,
    grant: CargoGrant,
    award: XpAward,
    idempotency: IdempotencyRecord,
    claim: { readonly transitionId: string; readonly expectedContainerVersion: number }
  ): D1AtomicBatchComponent<void> {
    if (award.playerId !== idempotency.actorPlayerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    return this.prepareHarvestSettlement(
      crop,
      {
        destination: "CARGO",
        itemDefinitionId: grant.itemDefinitionId,
        quantity: grant.quantity,
        maxQuantity: MAX_CARGO_CAPACITY,
        timestamp: grant.timestamp
      },
      award,
      idempotency,
      { transitionId: claim.transitionId, actorId: grant.actorId, expectedContainerVersion: claim.expectedContainerVersion }
    );
  }
}

interface PlayerProgressionRow {
  player_id: string;
  level: number;
  xp: number;
  progression_version: number;
  created_at: string;
  updated_at: string;
}

function mapPlayerProgression(row: PlayerProgressionRow): PlayerProgression {
  return {
    playerId: parsePlayerId(row.player_id),
    level: row.level,
    xp: row.xp,
    progressionVersion: row.progression_version,
    updatedAt: row.updated_at
  };
}

export class D1ProgressionRepository implements ProgressionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId): Promise<PlayerProgression | null> {
    const row = await this.db
      .prepare(
        "SELECT player_id, level, xp, progression_version, created_at, updated_at FROM player_progression WHERE player_id = ?"
      )
      .bind(playerId)
      .first<PlayerProgressionRow>();
    return row === null ? null : mapPlayerProgression(row);
  }
}

function mapInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    playerId: parsePlayerId(row.player_id),
    itemDefinitionId: parseItemDefinitionId(row.item_definition_id),
    quantity: row.quantity,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function mapLedger(row: EconomyLedgerRow): EconomyLedgerEntry {
  return {
    transactionId: parseEconomyTransactionId(row.id),
    playerId: parsePlayerId(row.player_id),
    currencyDefinitionId: parseCurrencyDefinitionId(row.currency_id),
    delta: row.delta,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    expectedWalletVersion: row.expected_wallet_version,
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: parseEconomyReferenceId(row.reference_id),
    requestId: row.request_id,
    createdAt: row.created_at
  };
}

/**
 * Reads stored command receipts.
 *
 * Every command path looks a receipt up by (actor, operation, request id). The tree commands have no
 * other use for a crop repository, so this names the one query they need instead of borrowing a
 * crop-named class to reach a table the two features share.
 */
export class D1IdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(actorPlayerId: PlayerId, operation: string, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = ? AND request_id = ?"
      )
      .bind(actorPlayerId, operation, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }
}

/** Stores only the bounded area-command receipt; every tree payout still uses its own settlement row. */
export class D1TreeHarvestBatchReceiptRepository implements TreeHarvestBatchReceiptRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = 'HARVEST_TREE_AREA_GROUP' AND request_id = ?"
      )
      .bind(actorPlayerId, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }

  async save(record: IdempotencyRecord): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        record.actorPlayerId,
        record.operation,
        record.requestId,
        record.payloadFingerprint,
        record.status,
        record.resourceId,
        record.responseJson,
        record.createdAt
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }
}

/** Stores bounded planting receipts while each cell remains settled by PlantCrop/PlantTree. */
export class D1PlantBatchReceiptRepository implements PlantBatchReceiptRepository {
  constructor(private readonly db: D1DatabaseLike, private readonly operation: "PLANT_CROP_AREA_GROUP" | "PLANT_TREE_AREA_GROUP") {}

  async find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare("SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = ? AND request_id = ?")
      .bind(actorPlayerId, this.operation, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }

  async save(record: IdempotencyRecord): Promise<boolean> {
    const result = await this.db
      .prepare("INSERT OR IGNORE INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(record.actorPlayerId, record.operation, record.requestId, record.payloadFingerprint, record.status, record.resourceId, record.responseJson, record.createdAt)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }
}

/** Stores only the bounded crop area-command receipt; each crop payout uses HarvestCrop's settlement. */
export class D1CropHarvestBatchReceiptRepository implements CropHarvestBatchReceiptRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(actorPlayerId: PlayerId, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = 'HARVEST_CROP_AREA_GROUP' AND request_id = ?"
      )
      .bind(actorPlayerId, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }

  async save(record: IdempotencyRecord): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        record.actorPlayerId,
        record.operation,
        record.requestId,
        record.payloadFingerprint,
        record.status,
        record.resourceId,
        record.responseJson,
        record.createdAt
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }
}

interface AquaculturePondStateRow {
  construction_id: string;
  farm_id: string;
  item_definition_id: string | null;
  stocked_at: string | null;
  ready_at: string | null;
  version: number;
}

interface AquaculturePondCohortRow {
  cohort_id: string;
  item_definition_id: string;
  quantity: number;
  stocked_at: string;
  ready_at: string;
}

async function mapAquaculturePondState(db: D1DatabaseLike, row: AquaculturePondStateRow): Promise<AquaculturePondState> {
  const cohorts = await db.prepare("SELECT cohort_id, item_definition_id, quantity, stocked_at, ready_at FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY ready_at, cohort_id").bind(row.construction_id).all<AquaculturePondCohortRow>();
  return {
    constructionId: parseConstructionId(row.construction_id),
    farmId: parseFarmId(row.farm_id),
    itemDefinitionId: row.item_definition_id === null ? null : parseItemDefinitionId(row.item_definition_id),
    stockedAt: row.stocked_at,
    readyAt: row.ready_at,
    version: row.version,
    cohorts: cohorts.results.map((cohort) => ({ cohortId: cohort.cohort_id, itemDefinitionId: parseItemDefinitionId(cohort.item_definition_id), quantity: cohort.quantity, stockedAt: cohort.stocked_at, readyAt: cohort.ready_at }))
  };
}

/** The persisted lifecycle state beside, and never inside, the reusable construction row. */
export class D1AquaculturePondRepository implements AquaculturePondRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByFarm(farmId: FarmId): Promise<readonly AquaculturePondState[]> {
    const rows = await this.db
      .prepare(
        "SELECT construction_id, farm_id, item_definition_id, stocked_at, ready_at, version FROM aquaculture_pond_states WHERE farm_id = ? ORDER BY construction_id LIMIT 256"
      )
      .bind(farmId)
      .all<AquaculturePondStateRow>();
    return Promise.all(rows.results.map((row) => mapAquaculturePondState(this.db, row)));
  }

  async findByConstruction(farmId: FarmId, constructionId: ConstructionId): Promise<AquaculturePondState | null> {
    const row = await this.db
      .prepare(
        "SELECT construction_id, farm_id, item_definition_id, stocked_at, ready_at, version FROM aquaculture_pond_states WHERE farm_id = ? AND construction_id = ?"
      )
      .bind(farmId, constructionId)
      .first<AquaculturePondStateRow>();
    return row === null ? null : mapAquaculturePondState(this.db, row);
  }

  async stockAtomically(input: Parameters<AquaculturePondRepository["stockAtomically"]>[0]): Promise<void> {
    const { state, farmId, itemDefinitionId, stockedAt, readyAt, cohortId, quantity, expectedInventory, removal, idempotency } = input;
    if (
      removal.playerId !== expectedInventory.playerId ||
      removal.itemDefinitionId !== expectedInventory.itemDefinitionId ||
      expectedInventory.quantity < removal.quantity
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Aquaculture stocking ownership does not match");
    }
    const expectedVersion = state?.version ?? 0;
    const nextVersion = expectedVersion + 1;
    const expectedAfterQuantity = expectedInventory.quantity - removal.quantity;
    const expectedAfterInventoryVersion = expectedInventory.version + 1;
    const headerStatement = state === null
      ? this.db.prepare("INSERT INTO aquaculture_pond_states (construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(idempotency.resourceId, farmId, itemDefinitionId, stockedAt, readyAt, stockedAt)
      : this.db.prepare("UPDATE aquaculture_pond_states SET item_definition_id = (SELECT item_definition_id FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), stocked_at = (SELECT stocked_at FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), ready_at = (SELECT ready_at FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), version = version + 1, updated_at = ? WHERE construction_id = ? AND farm_id = ? AND version = ?").bind(idempotency.resourceId, idempotency.resourceId, idempotency.resourceId, stockedAt, idempotency.resourceId, farmId, expectedVersion);
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          removal.quantity,
          removal.timestamp,
          removal.playerId,
          removal.itemDefinitionId,
          expectedInventory.quantity,
          expectedInventory.version,
          removal.quantity
        ),
      this.db
        .prepare(
          "INSERT INTO aquaculture_pond_cohorts (construction_id, cohort_id, farm_id, item_definition_id, quantity, stocked_at, ready_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(idempotency.resourceId, cohortId, farmId, itemDefinitionId, quantity, stockedAt, readyAt, stockedAt),
      headerStatement,
      this.db
        .prepare(
          `INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at)
           VALUES (
             CASE WHEN EXISTS (
               SELECT 1 FROM aquaculture_pond_states
               WHERE construction_id = ? AND farm_id = ? AND version = ?
             ) AND EXISTS (
               SELECT 1 FROM aquaculture_pond_cohorts
               WHERE construction_id = ? AND cohort_id = ? AND quantity = ?
             ) AND EXISTS (
               SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?
             ) THEN ? ELSE NULL END,
             ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          idempotency.resourceId,
          farmId,
          nextVersion,
          idempotency.resourceId,
          cohortId,
          quantity,
          expectedInventory.playerId,
          expectedInventory.itemDefinitionId,
          expectedAfterQuantity,
          expectedAfterInventoryVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ]);
    if (results.length !== 4 || results.some((result) => !result.success) || results.some((result) => (result.meta.changes ?? 0) !== 1)) {
      throw new Error("Atomic aquaculture stocking failed");
    }
  }

  async settleAtomically(input: Parameters<AquaculturePondRepository["settleAtomically"]>[0]): Promise<void> {
    const { state, addition, expectedInventory, operation, allocations, idempotency } = input;
    if (addition.playerId !== idempotency.actorPlayerId || operation !== idempotency.operation) throw new ApplicationError("NOT_AUTHORIZED", "Aquaculture settlement ownership does not match");
    const expectedAfterQuantity = (expectedInventory?.quantity ?? 0) + addition.quantity;
    const expectedAfterInventoryVersion = (expectedInventory?.version ?? 0) + 1;
    const cohortStatements = allocations.map((allocation) => {
      const cohort = state.cohorts.find((candidate) => candidate.cohortId === allocation.cohortId);
      if (cohort === undefined || allocation.quantity > cohort.quantity) throw new ApplicationError("AQUACULTURE_CONFLICT", "Aquaculture cohort changed concurrently");
      return allocation.quantity === cohort.quantity
        ? this.db.prepare("DELETE FROM aquaculture_pond_cohorts WHERE construction_id = ? AND cohort_id = ? AND quantity = ?").bind(state.constructionId, allocation.cohortId, allocation.quantity)
        : this.db.prepare("UPDATE aquaculture_pond_cohorts SET quantity = quantity - ? WHERE construction_id = ? AND cohort_id = ? AND quantity >= ?").bind(allocation.quantity, state.constructionId, allocation.cohortId, allocation.quantity);
    });
    const statements = [
      this.db.prepare("INSERT INTO aquaculture_pond_settlements (actor_player_id, operation, request_id, farm_id, construction_id, pond_version, item_definition_id, quantity, max_quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(idempotency.actorPlayerId, operation, idempotency.requestId, state.farmId, state.constructionId, state.version, addition.itemDefinitionId, addition.quantity, addition.maxQuantity, addition.timestamp),
      ...cohortStatements,
      this.db.prepare(`UPDATE aquaculture_pond_states SET item_definition_id = (SELECT item_definition_id FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), stocked_at = (SELECT stocked_at FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), ready_at = (SELECT ready_at FROM aquaculture_pond_cohorts WHERE construction_id = ? ORDER BY stocked_at, cohort_id LIMIT 1), version = version + 1, updated_at = ? WHERE construction_id = ? AND farm_id = ? AND version = ?`).bind(state.constructionId, state.constructionId, state.constructionId, addition.timestamp, state.constructionId, state.farmId, state.version),
      this.db.prepare(`INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM aquaculture_pond_settlements WHERE actor_player_id = ? AND operation = ? AND request_id = ?) AND EXISTS (SELECT 1 FROM aquaculture_pond_states WHERE construction_id = ? AND farm_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)`).bind(idempotency.actorPlayerId, operation, idempotency.requestId, state.constructionId, state.farmId, state.version + 1, addition.playerId, addition.itemDefinitionId, expectedAfterQuantity, expectedAfterInventoryVersion, idempotency.actorPlayerId, operation, idempotency.requestId, idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId, idempotency.responseJson, idempotency.createdAt)
    ];
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success) || results.some((result) => (result.meta.changes ?? 0) !== 1)) throw new Error("Atomic aquaculture settlement failed");
  }
}

interface TreeInstanceRow {
  id: string;
  farm_id: string;
  tile_x: number;
  tile_y: number;
  tree_definition_id: string;
  planted_by_player_id: string;
  planted_at: string;
  last_harvested_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  storage_state?: "ACTIVE" | "STORED";
  rotation?: number;
  stored_at?: string | null;
  stored_remaining_seconds?: number | null;
}

function mapTree(row: TreeInstanceRow): TreeInstance {
  return {
    id: parseTreeInstanceId(row.id),
    farmId: parseFarmId(row.farm_id),
    tileX: row.tile_x,
    tileY: row.tile_y,
    treeDefinitionId: parseTreeDefinitionId(row.tree_definition_id),
    plantedByPlayerId: parsePlayerId(row.planted_by_player_id),
    plantedAt: row.planted_at,
    lastHarvestedAt: row.last_harvested_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storageState: row.storage_state === "STORED" ? "STORED" : "ACTIVE",
    rotation: row.rotation === 1 || row.rotation === 2 || row.rotation === 3 ? row.rotation : 0,
    storedAt: row.stored_at ?? null,
    storedRemainingSeconds: row.stored_remaining_seconds ?? null
  };
}

/**
 * Trees: one row per planted tree, plus the two settlements that create and end it.
 *
 * The SELECT list is spelled out rather than `*` so a column added later cannot silently reach a
 * domain object, and every read filters by farm so a caller cannot reach another farm's tree through
 * a shared instance id.
 */
export class D1TreeRepository implements TreeInstanceRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  private readonly currentSelect =
    "SELECT id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at, storage_state, rotation, stored_at, stored_remaining_seconds FROM tree_instances";
  private readonly legacySelect =
    "SELECT id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at FROM tree_instances";

  async findById(id: TreeInstanceId): Promise<TreeInstance | null> {
    let row: TreeInstanceRow | null;
    try {
      row = await this.db.prepare(`${this.currentSelect} WHERE id = ?`).bind(id).first<TreeInstanceRow>();
    } catch {
      row = await this.db.prepare(`${this.legacySelect} WHERE id = ?`).bind(id).first<TreeInstanceRow>();
    }
    return row === null ? null : mapTree(row);
  }

  async findAtTile(farmId: FarmId, x: number, y: number): Promise<TreeInstance | null> {
    let row: TreeInstanceRow | null;
    try {
      row = await this.db
        .prepare(`${this.currentSelect} WHERE farm_id = ? AND tile_x = ? AND tile_y = ? AND storage_state = 'ACTIVE'`)
        .bind(farmId, x, y)
        .first<TreeInstanceRow>();
    } catch {
      row = await this.db.prepare(`${this.legacySelect} WHERE farm_id = ? AND tile_x = ? AND tile_y = ?`).bind(farmId, x, y).first<TreeInstanceRow>();
    }
    return row === null ? null : mapTree(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly TreeInstance[]> {
    let result: { results: TreeInstanceRow[] };
    try {
      result = await this.db
        .prepare(`${this.currentSelect} WHERE farm_id = ? ORDER BY storage_state, tile_y, tile_x`)
        .bind(farmId)
        .all<TreeInstanceRow>();
    } catch {
      result = await this.db.prepare(`${this.legacySelect} WHERE farm_id = ? ORDER BY tile_y, tile_x`).bind(farmId).all<TreeInstanceRow>();
    }
    return result.results.map(mapTree);
  }

  async plantAtomically(
    tree: TreeInstance,
    tile: TilePlan,
    saplingRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (saplingRemoval.playerId !== expectedInventory.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Sapling removal ownership does not match");
    }
    const saplingAfterQuantity = expectedInventory.quantity - saplingRemoval.quantity;
    const saplingAfterVersion = expectedInventory.version + 1;
    const statements: D1PreparedStatementLike[] = [];
    if (tile.kind === "CREATE") {
      // Free natural Home Island land (V14.5.2): the row is written with the planting.
      statements.push(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(tile.tile.farmId, tile.tile.x, tile.tile.y, tile.tile.terrainType, tile.tile.state, tile.tile.version, tile.tile.updatedAt)
      );
    }
    statements.push(
      // Spends the sapling first, guarded on the exact quantity and version the caller read. SQLite
      // cannot fail an UPDATE that matches no rows, so a lost race shows up in the final idempotency
      // statement below, which is what actually aborts the batch.
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          saplingRemoval.quantity,
          saplingRemoval.timestamp,
          saplingRemoval.playerId,
          saplingRemoval.itemDefinitionId,
          expectedInventory.quantity,
          expectedInventory.version,
          saplingRemoval.quantity
        ),
      // The tile row is the ground the plant stands on, and the SELECT is the guard that it is still
      // empty soil at the revision the caller read (or the row this settlement just wrote).
      this.treeInsertStatement(tree, tile),
      // The receipt commits only when the tree exists *and* the sapling is exactly where this
      // settlement left it, so a failure after the insert cannot leave a planted tree that was never
      // paid for.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          tree.id,
          tree.farmId,
          tree.version,
          saplingRemoval.playerId,
          saplingRemoval.itemDefinitionId,
          saplingAfterQuantity,
          saplingAfterVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    );
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic tree planting failed");
    }
  }

  /** The tree insert, guarded on the tile the plant expected. See `cropInsertStatement`. */
  private treeInsertStatement(tree: TreeInstance, tile: TilePlan): D1PreparedStatementLike {
    const columns =
      "INSERT INTO tree_instances (id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ? FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ? AND terrain_type = 'SOIL' AND tile_state = 'IDLE'";
    const values: unknown[] = [
      tree.id,
      tree.farmId,
      tree.tileX,
      tree.tileY,
      tree.treeDefinitionId,
      tree.plantedByPlayerId,
      tree.plantedAt,
      tree.version,
      tree.createdAt,
      tree.updatedAt,
      tree.farmId,
      tree.tileX,
      tree.tileY
    ];
    if (tile.kind === "CREATE") return this.db.prepare(columns).bind(...values);
    return this.db.prepare(`${columns} AND version = ?`).bind(...values, tile.version);
  }

  async removeAtomically(
    tree: TreeInstance,
    expectedTreeVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const results = await this.db.batch([
      // Claim the exact revision before deleting it. Checking only that the tree is absent after
      // DELETE would let a second request whose DELETE matched zero rows also commit a successful
      // receipt. Since a D1 batch is one transaction, a later DELETE failure rolls this receipt back
      // with the batch.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          tree.id,
          tree.farmId,
          expectedTreeVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        ),
      this.db
        .prepare("DELETE FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?")
        .bind(tree.id, tree.farmId, expectedTreeVersion)
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic tree removal failed");
    }
  }

  async manageAtomically(
    tree: TreeInstance,
    expectedTreeVersion: number,
    tile: TilePlan | null,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const statements: D1PreparedStatementLike[] = [];
    if (tile?.kind === "CREATE") {
      statements.push(
        this.db.prepare(
          "INSERT OR IGNORE INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(tile.tile.farmId, tile.tile.x, tile.tile.y, tile.tile.terrainType, tile.tile.state, tile.tile.version, tile.tile.updatedAt)
      );
    }
    const tileGuard = tile === null
      ? { sql: "", values: [] as unknown[] }
      : {
          sql: " AND EXISTS (SELECT 1 FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ? AND terrain_type = 'SOIL' AND tile_state = 'IDLE' AND version = ?)",
          values: [tree.farmId, tree.tileX, tree.tileY, tile.kind === "CREATE" ? tile.tile.version : tile.version]
        };
    statements.push(
      this.db.prepare(
        `UPDATE tree_instances SET tile_x = ?, tile_y = ?, tree_definition_id = ?, planted_at = ?, last_harvested_at = ?, storage_state = ?, rotation = ?, stored_at = ?, stored_remaining_seconds = ?, version = ?, updated_at = ? WHERE id = ? AND farm_id = ? AND version = ?${tileGuard.sql}`
      ).bind(
        tree.tileX, tree.tileY, tree.treeDefinitionId, tree.plantedAt, tree.lastHarvestedAt, tree.storageState,
        tree.rotation, tree.storedAt, tree.storedRemainingSeconds, tree.version, tree.updatedAt,
        tree.id, tree.farmId, expectedTreeVersion, ...tileGuard.values
      ),
      this.db.prepare(
        "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        tree.id, tree.farmId, tree.version, idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
        idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId, idempotency.responseJson, idempotency.createdAt
      )
    );
    const results = await this.db.batch(statements);
    const mutation = results[results.length - 2];
    const receipt = results[results.length - 1];
    if (mutation === undefined || receipt === undefined || !mutation.success || !receipt.success || (mutation.meta.changes ?? 0) !== 1 || (receipt.meta.changes ?? 0) !== 1) {
      throw new Error("Atomic tree management failed");
    }
  }
}

/**
 * The one write boundary for harvesting a tree's cycle.
 *
 * The same four statements as a crop harvest, with one substitution: the settlement's apply trigger
 * advances the tree's harvest anchor and revision instead of deleting the crop. The guard still tests
 * the progression state the caller read, so a lost race aborts the whole batch and the use case
 * re-reads rather than paying twice.
 */
export class D1TreeHarvestSettlementRepository implements TreeHarvestSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleTreeHarvestAtomically(
    tree: TreeInstance,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO tree_harvest_settlements (actor_player_id, operation, request_id, farm_id, tree_instance_id, tree_version, tree_definition_id, item_definition_id, quantity, max_quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            addition.playerId,
            idempotency.operation,
            idempotency.requestId,
            tree.farmId,
            tree.id,
            tree.version,
            tree.treeDefinitionId,
            addition.itemDefinitionId,
            addition.quantity,
            addition.maxQuantity,
            addition.timestamp
          ),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        // Tests the state the caller read *before* the award is applied, exactly as the crop harvest
        // does. SQLite cannot fail an UPDATE that matches no rows, so this CASE is the guard: it
        // yields NULL when the row moved, and the receipt's NOT NULL then aborts the batch.
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic tree harvest settlement failed");
      }
    } catch (error: unknown) {
      // The messages the crop harvest classifies, plus the tree cycle's own two: the receipt trigger
      // fires when the guard yielded NULL, and the monotonic progression trigger fires when the
      // caller's award would move a row that has already moved. Anything else is a genuine internal
      // failure and is rethrown so it surfaces as one instead of being disguised as a conflict.
      if (error instanceof Error && error.message.includes("warehouse_full")) {
        throw new ApplicationError("WAREHOUSE_FULL", "The warehouse does not have enough space");
      }
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys") ||
          error.message.includes("completed tree harvest idempotency requires settlement"))
      ) {
        throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
      }
      throw error;
    }
  }
}

export class D1FishingSpotStateRepository implements FishingSpotStateRepository {
  constructor(private readonly db: D1DatabaseLike) {}
  private available = true;

  isAvailable(): boolean { return this.available; }

  async listByZone(zoneKind: string, zoneId: string): Promise<readonly FishingStockState[]> {
    try {
      const rows = await this.db.prepare(
        "SELECT zone_kind, zone_id, spot_id, stock, last_regenerated_at, version FROM fishing_spot_states WHERE zone_kind = ? AND zone_id = ? ORDER BY spot_id"
      ).bind(zoneKind, zoneId).all<{
        zone_kind: string; zone_id: string; spot_id: string; stock: number; last_regenerated_at: string; version: number;
      }>();
      return rows.results.map((row) => ({
        zoneKind: row.zone_kind, zoneId: row.zone_id, spotId: row.spot_id, stock: row.stock,
        lastRegeneratedAt: row.last_regenerated_at, version: row.version
      }));
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("no such table: fishing_spot_states")) {
        this.available = false;
        return [];
      }
      throw error;
    }
  }
}

interface FishingActionRow {
  action_id: string;
  actor_player_id: string;
  zone_kind: string;
  zone_id: string;
  spot_id: string;
  table_id: string;
  status: string;
  started_at: string;
  ready_at: string;
  settled_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function toFishingAction(row: FishingActionRow): FishingAction {
  return {
    actionId: parseFishingActionId(row.action_id),
    actorPlayerId: parsePlayerId(row.actor_player_id),
    zoneKind: row.zone_kind,
    zoneId: row.zone_id,
    spotId: row.spot_id,
    tableId: row.table_id,
    status: row.status as FishingAction["status"],
    startedAt: row.started_at,
    readyAt: row.ready_at,
    settledAt: row.settled_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const FISHING_ACTION_COLUMNS =
  "action_id, actor_player_id, zone_kind, zone_id, spot_id, table_id, status, started_at, ready_at, settled_at, version, created_at, updated_at";

/**
 * The actor's home island, as a zone.
 *
 * One farm is one `HOME_ISLAND` zone today, and the derivation lives in the contracts package; this
 * adapter is the only place the two meet. A future shared fishing ground resolves a different zone
 * through a different adapter, and the fishing use case does not change.
 */
export class D1HomeIslandZoneResolver implements HomeIslandZoneResolver {
  constructor(private readonly farms: FarmRepository) {}

  async resolveForPlayer(
    actorPlayerId: PlayerId
  ): Promise<{ readonly kind: string; readonly id: string } | null> {
    const farm = await this.farms.findByOwner(actorPlayerId);
    if (farm === null) return null;
    const zone = homeIslandZoneRef(farm.id);
    return { kind: zone.kind, id: zone.zoneId };
  }
}

/**
 * The fishing action store: one durable row per attempt.
 *
 * Reading is a primary-key lookup or the actor's single active row (the partial unique index makes
 * that a point query). Starting is one batch of two statements - the action and the receipt that
 * claims it - so a receipt can never exist without the attempt it describes.
 */
export class D1FishingActionRepository implements FishingActionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async pinRoll(action: FishingAction, draw: () => number): Promise<number> {
    const read = (): Promise<{ reward_roll: number | null } | null> => this.db
      .prepare("SELECT reward_roll FROM fishing_actions WHERE action_id = ? AND actor_player_id = ?")
      .bind(action.actionId, action.actorPlayerId).first<{ reward_roll: number | null }>();
    const stored = await read();
    if (stored?.reward_roll !== null && stored?.reward_roll !== undefined) return stored.reward_roll;
    const roll = draw();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("Invalid server reward roll");
    await this.db.prepare("UPDATE fishing_actions SET reward_roll = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ? AND reward_roll IS NULL")
      .bind(roll, action.actionId, action.actorPlayerId, action.version).run();
    const pinned = await read();
    if (pinned?.reward_roll === null || pinned?.reward_roll === undefined) {
      throw new ApplicationError("FISHING_ACTION_NOT_ACTIVE", "Fishing action has already finished");
    }
    return pinned.reward_roll;
  }

  async findById(actionId: FishingActionId): Promise<FishingAction | null> {
    const row = await this.db
      .prepare(`SELECT ${FISHING_ACTION_COLUMNS} FROM fishing_actions WHERE action_id = ?`)
      .bind(actionId)
      .first<FishingActionRow>();
    return row === null ? null : toFishingAction(row);
  }

  async findActiveByActor(actorPlayerId: PlayerId): Promise<FishingAction | null> {
    const row = await this.db
      .prepare(
        `SELECT ${FISHING_ACTION_COLUMNS} FROM fishing_actions WHERE actor_player_id = ? AND status = 'ACTIVE' LIMIT 1`
      )
      .bind(actorPlayerId)
      .first<FishingActionRow>();
    return row === null ? null : toFishingAction(row);
  }

  async create(action: FishingAction, idempotency: IdempotencyRecord): Promise<void> {
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO fishing_actions (action_id, actor_player_id, zone_kind, zone_id, spot_id, table_id, status, started_at, ready_at, settled_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.zoneKind,
            action.zoneId,
            action.spotId,
            action.tableId,
            action.status,
            action.startedAt,
            action.readyAt,
            action.settledAt,
            action.version,
            action.createdAt,
            action.updatedAt
          ),
        // The receipt commits only if the attempt it claims is actually live, and the unique partial
        // index on the actor is what stops two concurrent starts from both being live.
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM fishing_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE') THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic fishing start failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("UNIQUE constraint failed: fishing_actions") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys"))
      ) {
        throw new ApplicationError("FISHING_ALREADY_ACTIVE", "A fishing attempt is already in progress");
      }
      throw error;
    }
  }
}

/**
 * The one write boundary for settling or giving up a fishing attempt.
 *
 * Both settle and cancel move the same row with the same guard, so the interesting part is what the
 * receipt depends on. For a settle that is: the action actually transitioned to `SETTLED` at the
 * version the caller expected, the experience row is still where the caller read it, and the catch
 * fits in the stack. If any of those is false the receipt's actor evaluates to NULL and the batch
 * aborts, so the fish, the experience and the transition are all-or-nothing - exactly the crop and
 * tree harvest's shape, one table lighter.
 */
export class D1FishingSettlementRepository implements FishingSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleFishingAtomically(
    action: FishingAction,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord,
    stockConsumption?: Parameters<FishingSettlementRepository["settleFishingAtomically"]>[4]
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    const expectedVersion = action.version - 1;
    try {
      const stockGuard = stockConsumption === undefined
        ? "1 = 1"
        : stockConsumption.expectedVersion === null
          ? "NOT EXISTS (SELECT 1 FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ?)"
          : "EXISTS (SELECT 1 FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ? AND version = ? AND stock = ? AND last_regenerated_at = ?)";
      const statements: D1PreparedStatementLike[] = [
        this.db
          .prepare(
            "UPDATE fishing_actions SET status = 'SETTLED', settled_at = ?, version = version + 1, updated_at = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ?"
          )
          .bind(action.settledAt, action.updatedAt, action.actionId, action.actorPlayerId, expectedVersion),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        this.db
          .prepare(
            `INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM fishing_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'SETTLED' AND version = ? AND settled_at = ?) AND EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) AND COALESCE((SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?), 0) <= ? - ? AND ${stockGuard} THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?) `
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.version,
            action.settledAt,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            addition.playerId,
            addition.itemDefinitionId,
            addition.maxQuantity,
            addition.quantity,
            ...(stockConsumption === undefined ? [] : stockConsumption.expectedVersion === null
              ? [stockConsumption.zoneId, stockConsumption.spotId]
              : [stockConsumption.zoneId, stockConsumption.spotId, stockConsumption.expectedVersion, stockConsumption.expectedStock, stockConsumption.expectedLastRegeneratedAt]),
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        this.db
          .prepare(
            "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = inventory_items.quantity + excluded.quantity, updated_at = excluded.updated_at, version = inventory_items.version + 1"
          )
          .bind(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.timestamp),
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
      ];
      if (stockConsumption !== undefined) {
        statements.push(
          this.db.prepare(
            `INSERT INTO fishing_spot_states (zone_kind, zone_id, spot_id, stock, last_regenerated_at, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(zone_id, spot_id) DO UPDATE SET stock = excluded.stock, last_regenerated_at = excluded.last_regenerated_at, version = fishing_spot_states.version + 1, updated_at = excluded.updated_at`
          ).bind(
            stockConsumption.zoneKind, stockConsumption.zoneId, stockConsumption.spotId,
            stockConsumption.stock, stockConsumption.lastRegeneratedAt, stockConsumption.nextVersion,
            stockConsumption.lastRegeneratedAt, stockConsumption.lastRegeneratedAt
          )
        );
      }
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic fishing settlement failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys"))
      ) {
        throw new ApplicationError("FISHING_CONFLICT", "Fishing settlement changed concurrently");
      }
      throw error;
    }
  }

  async cancelFishingAtomically(action: FishingAction, idempotency: IdempotencyRecord): Promise<void> {
    const expectedVersion = action.version - 1;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "UPDATE fishing_actions SET status = 'CANCELLED', version = version + 1, updated_at = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ?"
          )
          .bind(action.updatedAt, action.actionId, action.actorPlayerId, expectedVersion),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM fishing_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'CANCELLED' AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic fishing cancel failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("FISHING_CONFLICT", "Fishing action changed concurrently");
      }
      throw error;
    }
  }
}

interface ResourceNodeStateRow {
  zone_kind: string;
  zone_id: string;
  node_id: string;
  available_at: string;
  depleted_at: string;
  version: number;
}

interface ResourceActionRow {
  action_id: string;
  actor_player_id: string;
  zone_kind: string;
  zone_id: string;
  node_id: string;
  definition_id: string;
  verb: string;
  status: string;
  started_at: string;
  ready_at: string;
  settled_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function toResourceNodeState(row: ResourceNodeStateRow): ResourceNodeState {
  return {
    zoneKind: row.zone_kind,
    zoneId: row.zone_id,
    nodeId: row.node_id,
    availableAt: row.available_at,
    depletedAt: row.depleted_at,
    version: row.version
  };
}

function toResourceAction(row: ResourceActionRow): ResourceAction {
  return {
    actionId: parseResourceActionId(row.action_id),
    actorPlayerId: parsePlayerId(row.actor_player_id),
    zoneKind: row.zone_kind,
    zoneId: row.zone_id,
    nodeId: row.node_id,
    definitionId: row.definition_id,
    verb: row.verb as ResourceVerb,
    status: row.status as ResourceAction["status"],
    startedAt: row.started_at,
    readyAt: row.ready_at,
    settledAt: row.settled_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const RESOURCE_ACTION_COLUMNS =
  "action_id, actor_player_id, zone_kind, zone_id, node_id, definition_id, verb, status, started_at, ready_at, settled_at, version, created_at, updated_at";

/**
 * One zone's resource-node availability.
 *
 * A node with no row has never been gathered, which is available - so the read is a bounded range scan
 * of `(zone_id, ...)` and the answer for a fresh island is simply "nothing is depleted".
 */
export class D1ResourceNodeStateRepository implements ResourceNodeStateRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByZone(zoneId: string): Promise<readonly ResourceNodeState[]> {
    const result = await this.db
      .prepare(
        "SELECT zone_kind, zone_id, node_id, available_at, depleted_at, version FROM resource_node_states WHERE zone_id = ?"
      )
      .bind(zoneId)
      .all<ResourceNodeStateRow>();
    return result.results.map(toResourceNodeState);
  }

  async find(zoneId: string, nodeId: string): Promise<ResourceNodeState | null> {
    const row = await this.db
      .prepare(
        "SELECT zone_kind, zone_id, node_id, available_at, depleted_at, version FROM resource_node_states WHERE zone_id = ? AND node_id = ?"
      )
      .bind(zoneId, nodeId)
      .first<ResourceNodeStateRow>();
    return row === null ? null : toResourceNodeState(row);
  }
}

/**
 * Gather attempts: one durable row each, exactly as fishing's actions are.
 *
 * The verb travels with the action, so forestry's CHOP reuses this table and the settlement below
 * without a schema change.
 */
export class D1ResourceActionRepository implements ResourceActionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async pinRolls(action: ResourceAction, draw: () => number): Promise<readonly [number, number]> {
    type Rolls = { reward_roll: number | null; quantity_roll: number | null };
    const read = (): Promise<Rolls | null> => this.db
      .prepare("SELECT reward_roll, quantity_roll FROM resource_actions WHERE action_id = ? AND actor_player_id = ?")
      .bind(action.actionId, action.actorPlayerId).first<Rolls>();
    const stored = await read();
    if (stored !== null && stored.reward_roll !== null && stored.quantity_roll !== null) {
      return [stored.reward_roll, stored.quantity_roll];
    }
    const selection = draw();
    const quantity = draw();
    if ([selection, quantity].some((roll) => !Number.isFinite(roll) || roll < 0 || roll >= 1)) {
      throw new Error("Invalid server reward roll");
    }
    await this.db.prepare("UPDATE resource_actions SET reward_roll = ?, quantity_roll = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ? AND reward_roll IS NULL AND quantity_roll IS NULL")
      .bind(selection, quantity, action.actionId, action.actorPlayerId, action.version).run();
    const pinned = await read();
    if (pinned === null || pinned.reward_roll === null || pinned.quantity_roll === null) {
      throw new ApplicationError("RESOURCE_ACTION_NOT_ACTIVE", "Resource action has already finished");
    }
    return [pinned.reward_roll, pinned.quantity_roll];
  }

  async findById(actionId: ResourceActionId): Promise<ResourceAction | null> {
    const row = await this.db
      .prepare(`SELECT ${RESOURCE_ACTION_COLUMNS} FROM resource_actions WHERE action_id = ?`)
      .bind(actionId)
      .first<ResourceActionRow>();
    return row === null ? null : toResourceAction(row);
  }

  async findActiveByActor(actorPlayerId: PlayerId): Promise<ResourceAction | null> {
    const row = await this.db
      .prepare(
        `SELECT ${RESOURCE_ACTION_COLUMNS} FROM resource_actions WHERE actor_player_id = ? AND status = 'ACTIVE' LIMIT 1`
      )
      .bind(actorPlayerId)
      .first<ResourceActionRow>();
    return row === null ? null : toResourceAction(row);
  }

  async create(action: ResourceAction, idempotency: IdempotencyRecord): Promise<void> {
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO resource_actions (action_id, actor_player_id, zone_kind, zone_id, node_id, definition_id, verb, status, started_at, ready_at, settled_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.zoneKind,
            action.zoneId,
            action.nodeId,
            action.definitionId,
            action.verb,
            action.status,
            action.startedAt,
            action.readyAt,
            action.settledAt,
            action.version,
            action.createdAt,
            action.updatedAt
          ),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM resource_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE') THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic resource start failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("UNIQUE constraint failed: resource_actions") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys"))
      ) {
        throw new ApplicationError("RESOURCE_ALREADY_ACTIVE", "A gather is already in progress");
      }
      throw error;
    }
  }
}

/**
 * The one write boundary for settling or giving up a gather.
 *
 * Six statements in one batch, and the last four all hinge on the same guard: the action must actually
 * have moved to SETTLED at the revision the caller expected, the node must still have been available
 * when the batch ran (so two attempts can only deplete it once), the experience row must be where the
 * caller read it, and the stack must have room. If any of those is false the receipt's actor evaluates
 * to NULL and the whole batch aborts - the material, the experience, the depletion and the
 * regeneration clock are all-or-nothing.
 */
export class D1ResourceSettlementRepository implements ResourceSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleResourceAtomically(
    action: ResourceAction,
    addition: InventoryAddition,
    award: XpAward,
    nodeState: ResourceNodeState,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    const expectedVersion = action.version - 1;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "UPDATE resource_actions SET status = 'SETTLED', settled_at = ?, version = version + 1, updated_at = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ?"
          )
          .bind(action.settledAt, action.updatedAt, action.actionId, action.actorPlayerId, expectedVersion),
        // The node's availability is written here, and only here: a gather that never settles never
        // depletes anything.
        this.db
          .prepare(
            "INSERT INTO resource_node_states (zone_kind, zone_id, node_id, available_at, depleted_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(zone_id, node_id) DO UPDATE SET available_at = excluded.available_at, depleted_at = excluded.depleted_at, version = resource_node_states.version + 1, updated_at = excluded.updated_at"
          )
          .bind(
            nodeState.zoneKind,
            nodeState.zoneId,
            nodeState.nodeId,
            nodeState.availableAt,
            nodeState.depletedAt,
            nodeState.version,
            award.timestamp,
            award.timestamp
          ),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM resource_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'SETTLED' AND version = ? AND settled_at = ?) AND EXISTS (SELECT 1 FROM resource_node_states WHERE zone_id = ? AND node_id = ? AND available_at = ?) AND EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) AND COALESCE((SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?), 0) <= ? - ? THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.version,
            action.settledAt,
            nodeState.zoneId,
            nodeState.nodeId,
            nodeState.availableAt,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            addition.playerId,
            addition.itemDefinitionId,
            addition.maxQuantity,
            addition.quantity,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        this.db
          .prepare(
            "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = inventory_items.quantity + excluded.quantity, updated_at = excluded.updated_at, version = inventory_items.version + 1"
          )
          .bind(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.timestamp),
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
      ]);
      if (results.length !== 6 || results.some((result) => !result.success)) {
        throw new Error("Atomic resource settlement failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys"))
      ) {
        throw new ApplicationError("RESOURCE_CONFLICT", "Resource settlement changed concurrently");
      }
      throw error;
    }
  }

  async cancelResourceAtomically(action: ResourceAction, idempotency: IdempotencyRecord): Promise<void> {
    const expectedVersion = action.version - 1;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "UPDATE resource_actions SET status = 'CANCELLED', version = version + 1, updated_at = ? WHERE action_id = ? AND actor_player_id = ? AND status = 'ACTIVE' AND version = ?"
          )
          .bind(action.updatedAt, action.actionId, action.actorPlayerId, expectedVersion),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM resource_actions WHERE action_id = ? AND actor_player_id = ? AND status = 'CANCELLED' AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            action.actionId,
            action.actorPlayerId,
            action.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic resource cancel failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("RESOURCE_CONFLICT", "Resource action changed concurrently");
      }
      throw error;
    }
  }
}

interface WorkAreaRow {
  readonly id: string;
  readonly farm_id: string;
  readonly zone_kind: string;
  readonly zone_id: string;
  readonly kind: string;
  readonly display_name: string;
  readonly version: number;
  readonly created_by_player_id: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const WORK_AREA_COLUMNS =
  "id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at";

function toWorkArea(row: WorkAreaRow): WorkArea {
  return {
    id: parseWorkAreaId(row.id),
    farmId: parseFarmId(row.farm_id),
    zoneKind: row.zone_kind,
    zoneId: row.zone_id,
    kind: row.kind as WorkArea["kind"],
    displayName: row.display_name,
    version: row.version,
    createdByPlayerId: parsePlayerId(row.created_by_player_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Work-area persistence: one farm's named areas, and one area's cells.
 *
 * Nothing here is read by the farm page's ordinary loads - a work-area read happens when the
 * management panel is opened or a mutation answers - so this store never appears in the growth poll
 * or any idle traffic. Both list reads are bounded to the farm's or the area's own rows, and the
 * membership read is served by `idx_work_area_cells_area_yx`, an index-only scan in the query's own
 * order.
 *
 * Creates and membership replacements write their rows and the receipt that claims them in one batch,
 * so a receipt can never exist without the work it describes. Rename and delete use the version the
 * caller read as the guard, which is what stops two editors from interleaving into a state neither of
 * them asked for.
 */
export class D1WorkAreaRepository implements WorkAreaRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByFarm(farmId: FarmId): Promise<readonly WorkAreaListEntry[]> {
    // One bounded statement: the farm's own areas, with each area's cell count. The join walks the
    // area rows first (idx_work_areas_farm) and probes the cell primary key per area, so the read is
    // proportional to this farm's areas and cells, never to the table.
    const result = await this.db
      .prepare(
        `SELECT ${WORK_AREA_COLUMNS.split(", ").map((column) => `area.${column}`).join(", ")}, COUNT(cell.x) AS cell_count
           FROM work_areas AS area
           LEFT JOIN work_area_cells AS cell ON cell.work_area_id = area.id
          WHERE area.farm_id = ?
          GROUP BY area.id
          ORDER BY area.created_at, area.id`
      )
      .bind(farmId)
      .all<WorkAreaRow & { readonly cell_count: number }>();
    return result.results.map((row) => ({ area: toWorkArea(row), cellCount: row.cell_count }));
  }

  async findById(id: WorkAreaId): Promise<WorkArea | null> {
    const row = await this.db
      .prepare(`SELECT ${WORK_AREA_COLUMNS} FROM work_areas WHERE id = ?`)
      .bind(id)
      .first<WorkAreaRow>();
    return row === null ? null : toWorkArea(row);
  }

  async listCells(id: WorkAreaId): Promise<readonly WorkAreaCell[]> {
    const result = await this.db
      .prepare("SELECT x, y FROM work_area_cells WHERE work_area_id = ? ORDER BY y, x")
      .bind(id)
      .all<{ readonly x: number; readonly y: number }>();
    return result.results.map((row) => ({ x: row.x, y: row.y }));
  }

  async createAtomically(area: WorkArea, cells: readonly WorkAreaCell[], idempotency: IdempotencyRecord): Promise<void> {
    if (area.id !== idempotency.resourceId || area.createdByPlayerId !== idempotency.actorPlayerId) {
      // The receipt must claim the row this transaction writes and the actor who wrote it, or a caller
      // could file one player's area under another's request.
      throw new ApplicationError("NOT_AUTHORIZED", "Work area receipt does not match the area");
    }
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare(
          "INSERT INTO work_areas (id, farm_id, zone_kind, zone_id, kind, display_name, version, created_by_player_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          area.id,
          area.farmId,
          area.zoneKind,
          area.zoneId,
          area.kind,
          area.displayName,
          area.version,
          area.createdByPlayerId,
          area.createdAt,
          area.updatedAt
        ),
      ...cells.map((cell) =>
        this.db
          .prepare("INSERT INTO work_area_cells (work_area_id, x, y) VALUES (?, ?, ?)")
          .bind(area.id, cell.x, cell.y)
      ),
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM work_areas WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          area.id,
          area.farmId,
          area.version,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ];
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic work area create failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("WORK_AREA_NOT_FOUND", "Work area was not created");
      }
      throw error;
    }
  }

  async renameAtomically(area: WorkArea, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE work_areas SET display_name = ?, version = ?, updated_at = ? WHERE id = ? AND farm_id = ? AND version = ?"
      )
      .bind(area.displayName, area.version, area.updatedAt, area.id, area.farmId, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }

  async replaceCellsAtomically(
    area: WorkArea,
    cells: readonly WorkAreaCell[],
    expectedVersion: number
  ): Promise<boolean> {
    // The version guard runs *first*, in its own statement, and the delete/insert only proceed when it
    // moved the row. A racing editor whose guard fails writes neither half.
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("UPDATE work_areas SET version = ?, updated_at = ? WHERE id = ? AND farm_id = ? AND version = ?")
        .bind(area.version, area.updatedAt, area.id, area.farmId, expectedVersion),
      this.db
        .prepare(
          "DELETE FROM work_area_cells WHERE work_area_id = ? AND EXISTS (SELECT 1 FROM work_areas WHERE id = ? AND version = ?)"
        )
        .bind(area.id, area.id, area.version),
      ...cells.map((cell) =>
        this.db
          .prepare(
            "INSERT INTO work_area_cells (work_area_id, x, y) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM work_areas WHERE id = ? AND version = ?)"
          )
          .bind(area.id, cell.x, cell.y, area.id, area.version)
      )
    ];
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic work area membership replace failed");
    }
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async deleteAtomically(id: WorkAreaId, expectedVersion: number): Promise<boolean> {
    /**
     * The version guard is its own statement, and the delete is scoped to the version the guard moved.
     *
     * This is not stylistic. D1 reports a statement's changed-row count *including rows removed by
     * `ON DELETE CASCADE`*, so a single `DELETE ... WHERE id = ? AND version = ?` answers "2 changes"
     * for an area with one cell and "4" for an area with three - and a caller comparing that to 1
     * decides the delete failed while the row is already gone. The staging smoke caught exactly that:
     * a 409 to the client and an area that had in fact been removed.
     *
     * The guard UPDATE cascades to nothing, so its count is exactly 0 or 1, and the delete can only
     * match the version the guard just wrote - a racing editor whose guard failed deletes nothing.
     */
    const results = await this.db.batch([
      this.db
        // The row is deleted in the next statement, so its `updated_at` is never read; bumping only
        // the version keeps this a pure guard with nothing to cascade.
        .prepare("UPDATE work_areas SET version = version + 1 WHERE id = ? AND version = ?")
        .bind(id, expectedVersion),
      this.db
        .prepare("DELETE FROM work_areas WHERE id = ? AND version = ?")
        .bind(id, expectedVersion + 1)
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic work area delete failed");
    }
    return (results[0]?.meta.changes ?? 0) === 1;
  }
}

interface ActorRow {
  readonly id: string;
  readonly owner_player_id: string;
  readonly kind: string;
  readonly control_mode: string;
  readonly zone_kind: string;
  readonly zone_id: string;
  readonly cargo_capacity: number;
  readonly cargo_version: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const ACTOR_COLUMNS =
  "id, owner_player_id, kind, control_mode, zone_kind, zone_id, cargo_capacity, cargo_version, version, created_at, updated_at";

function toActor(row: ActorRow): Actor {
  return {
    id: parseActorId(row.id),
    ownerPlayerId: parsePlayerId(row.owner_player_id),
    kind: row.kind as Actor["kind"],
    controlMode: row.control_mode as Actor["controlMode"],
    zoneKind: row.zone_kind,
    zoneId: row.zone_id,
    cargoCapacity: row.cargo_capacity,
    cargoVersion: row.cargo_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interface ActorJobRow {
  readonly id: string;
  readonly actor_id: string;
  readonly farm_id: string;
  readonly work_area_id: string;
  readonly kind: string;
  readonly target_definition_id: string;
  readonly execution_mode: "LEGACY_ACTION_AUTO" | "RATE_PRODUCTION";
  readonly priority: number;
  readonly enabled: number;
  readonly auto_purchase_supplies: number;
  readonly auto_funding_enabled: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const ACTOR_JOB_COLUMNS =
  "id, actor_id, farm_id, work_area_id, kind, target_definition_id, execution_mode, priority, enabled, auto_purchase_supplies, auto_funding_enabled, version, created_at, updated_at";

function toActorJob(row: ActorJobRow): ActorJob {
  return {
    id: parseJobId(row.id),
    actorId: parseActorId(row.actor_id),
    farmId: parseFarmId(row.farm_id),
    workAreaId: parseWorkAreaId(row.work_area_id),
    kind: row.kind as ActorJob["kind"],
    targetDefinitionId: row.target_definition_id,
    executionMode: productionMode(row.execution_mode),
    priority: row.priority,
    enabled: row.enabled === 1,
    autoPurchaseSupplies: row.auto_purchase_supplies === 1,
    autoFundingEnabled: row.auto_funding_enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * The entities that can perform jobs.
 *
 * One actor row per player today - their Main Character - created lazily so an existing save gains it
 * without anyone recreating a farm. `ensureMainCharacter` is idempotent by construction rather than by
 * a check: the insert ignores the conflict the database's partial unique index raises, and the row is
 * then read back, so two tabs, a refresh, a re-login and two simultaneous bootstraps all end with the
 * same actor and no duplicate can be written even by a race.
 */
export class D1ActorRepository implements ActorRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findMainCharacter(ownerPlayerId: PlayerId): Promise<Actor | null> {
    const row = await this.db
      .prepare(
        `SELECT ${ACTOR_COLUMNS} FROM actors WHERE owner_player_id = ? AND kind = 'MAIN_CHARACTER' LIMIT 1`
      )
      .bind(ownerPlayerId)
      .first<ActorRow>();
    return row === null ? null : toActor(row);
  }

  async ensureMainCharacter(actor: Actor): Promise<Actor> {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO actors (id, owner_player_id, kind, control_mode, zone_kind, zone_id, cargo_capacity, cargo_version, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        actor.id,
        actor.ownerPlayerId,
        actor.kind,
        actor.controlMode,
        actor.zoneKind,
        actor.zoneId,
        actor.cargoCapacity,
        actor.cargoVersion,
        actor.version,
        actor.createdAt,
        actor.updatedAt
      )
      .run();
    const stored = await this.findMainCharacter(actor.ownerPlayerId);
    if (stored === null) throw new Error("Main Character row was not created");
    return stored;
  }

  async findById(id: ActorId): Promise<Actor | null> {
    const row = await this.db
      .prepare(`SELECT ${ACTOR_COLUMNS} FROM actors WHERE id = ?`)
      .bind(id)
      .first<ActorRow>();
    return row === null ? null : toActor(row);
  }

  async setControlModeAtomically(actor: Actor, expectedVersion: number): Promise<boolean> {
    // Control is a version-guarded setting on the same actor: two tabs toggling Auto at once converge
    // on one outcome, and nothing else in the row - cargo included - is touched.
    const result = await this.db
      .prepare("UPDATE actors SET control_mode = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? AND (? <> 'AUTO_CONTROLLED' OR (NOT EXISTS (SELECT 1 FROM resource_actions WHERE actor_player_id = owner_player_id AND status = 'ACTIVE') AND NOT EXISTS (SELECT 1 FROM fishing_actions WHERE actor_player_id = owner_player_id AND status = 'ACTIVE')))" )
      .bind(actor.controlMode, actor.version, actor.updatedAt, actor.id, expectedVersion, actor.controlMode)
      .run();
    return result.success && result.meta.changes === 1;
  }
}

interface AutoTravelRow {
  readonly anchor_kind: string | null;
  readonly anchor_x: number | null;
  readonly anchor_y: number | null;
  readonly travel_kind: string | null;
  readonly travel_x: number | null;
  readonly travel_y: number | null;
  readonly travel_arrives_at: string | null;
  readonly version: number;
  readonly simulation_at: string | null;
  readonly lease_until: string | null;
  readonly lease_issued_at: string | null;
}

// `*` keeps the D2 executor readable against pre-0027 local fixtures; the row is still a primary-key
// lookup and production schemas expose simulation_at after the additive migration.
const AUTO_TRAVEL_COLUMNS = "*";

function toAnchor(kind: string | null, x: number | null, y: number | null): AutoAnchor | null {
  if (kind === null) return null;
  const parsed = parseAutoAnchorKind(kind);
  return { kind: parsed, x, y };
}

function toAutoTravel(row: AutoTravelRow): AutoTravelState {
  return {
    anchor: toAnchor(row.anchor_kind, row.anchor_x, row.anchor_y),
    travelTo: toAnchor(row.travel_kind, row.travel_x, row.travel_y),
    arrivesAt: row.travel_arrives_at,
    version: row.version,
    simulationAt: row.simulation_at,
    leaseUntil: row.lease_until,
    leaseIssuedAt: row.lease_issued_at
  };
}

/**
 * Where one Auto-driven actor is, one row per actor.
 *
 * A read is a primary-key lookup and a write is one upsert guarded on the version the caller read, so
 * the two writers that can race on one actor - an arrival and a departure - cannot overwrite each
 * other. Nothing here is a position: it is the anchor a walk ended at, and the anchor a walk is
 * heading to with the time it lands. No frame, no path, no waypoint.
 */
export class D1AutoTravelRepository implements AutoTravelRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(actorId: ActorId): Promise<AutoTravelState> {
    const row = await this.db
      .prepare(`SELECT ${AUTO_TRAVEL_COLUMNS} FROM actor_auto_state WHERE actor_id = ?`)
      .bind(actorId)
      .first<AutoTravelRow>();
    return row === null ? NO_AUTO_TRAVEL : toAutoTravel(row);
  }

  /**
   * Prepares the Auto half of an economic Plant transition.  It deliberately returns statements
   * only: the caller composes this component with the crop repository's prepared Plant component.
   * The final receipt insert is the SQL-level stale guard, so a zero-row state update cannot commit
   * a cargo/crop mutation and be noticed only after D1 has committed.
   */
  prepareAutoPlantGuardAndAdvance(input: {
    readonly actorId: ActorId;
    readonly actorPlayerId: PlayerId;
    readonly expectedVersion: number;
    readonly nextVersion: number;
    readonly expectedSimulationAt: string | null;
    readonly eventTime: string;
    readonly updatedAt: string;
    readonly transitionId: string;
    readonly payloadFingerprint: string;
    readonly responseJson: string;
    readonly cropId: string;
    readonly cropFarmId: string;
    readonly cropVersion: number;
    readonly itemDefinitionId: string;
    readonly expectedCargoVersion: number;
    readonly seedAfterQuantity: number;
  }): D1AtomicBatchComponent<void> {
    const statements = [
      this.db
        .prepare(
          "UPDATE actor_auto_state SET version = ?, updated_at = ?, simulation_at = ? WHERE actor_id = ? AND version = ? AND (simulation_at IS ? OR simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')"
        )
        .bind(
          input.nextVersion,
          input.updatedAt,
          input.eventTime,
          input.actorId,
          input.expectedVersion,
          input.expectedSimulationAt,
          input.expectedSimulationAt,
          input.actorId,
          input.actorPlayerId
        ),
      // INSERTing NULL into the NOT NULL actor_player_id column aborts the transaction when the
      // guarded update did not advance exactly the expected row.  The receipt is also the durable
      // semantic replay key; a duplicate transition id fails the same batch on the primary key.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?) AND EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) AND (EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) OR ? = 0) THEN ? ELSE NULL END, 'AUTO_PLANT', ?, ?, 'COMPLETED', ?, ?, ?)"
        )
        .bind(
          input.actorId,
          input.nextVersion,
          input.eventTime,
          input.actorId,
          input.transitionId,
          input.cropId,
          input.cropFarmId,
          input.cropVersion,
          input.actorId,
          input.itemDefinitionId,
          input.seedAfterQuantity,
          input.expectedCargoVersion + 1,
          input.seedAfterQuantity,
          input.actorPlayerId,
          input.transitionId,
          input.payloadFingerprint,
          input.transitionId,
          input.responseJson,
          input.updatedAt
        )
    ];
    return {
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic Auto Plant guard failed");
        }
        return undefined;
      }
    };
  }

  prepareAutoLoadGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly playerId: PlayerId; readonly itemDefinitionId: ItemDefinitionId;
    readonly inventoryAfterQuantity: number; readonly inventoryAfterVersion: number;
    readonly cargoAfterQuantity: number; readonly cargoAfterVersion: number;
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'WAREHOUSE', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')").bind(input.actorId, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId),
      this.db.prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?) AND (EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) OR ? = 0 AND NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ?)) AND EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, 'AUTO_LOAD_INPUT', ?, ?, 'COMPLETED', ?, ?, ?)").bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.playerId, input.itemDefinitionId, input.inventoryAfterQuantity, input.inventoryAfterVersion, input.inventoryAfterQuantity, input.playerId, input.itemDefinitionId, input.actorId, input.itemDefinitionId, input.cargoAfterQuantity, input.cargoAfterVersion, input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.transitionId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto LOAD guard failed"); } };
  }

  prepareAutoPurchaseGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly currencyDefinitionId: CurrencyDefinitionId; readonly walletAfterBalance: number; readonly walletAfterVersion: number;
    readonly transactionId: EconomyTransactionId; readonly itemDefinitionId: ItemDefinitionId;
    readonly cargoAfterQuantity: number; readonly cargoAfterVersion: number;
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'MARKET', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')").bind(input.actorId, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId),
      this.db.prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?) AND EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) AND EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, 'AUTO_PURCHASE_INPUT', ?, ?, 'COMPLETED', ?, ?, ?)").bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.actorPlayerId, input.currencyDefinitionId, input.walletAfterBalance, input.walletAfterVersion, input.transactionId, input.actorPlayerId, input.actorId, input.itemDefinitionId, input.cargoAfterQuantity, input.cargoAfterVersion, input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.transitionId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto PURCHASE guard failed"); } };
  }

  /**
   * The Auto timeline half of one harvest: advance the actor, and write the semantic receipt that
   * proves the harvest's economic post-state.
   *
   * The receipt's `CASE` is the batch-failing guard. It observes the crop *gone*, the carried stack at
   * exactly the quantity and version the harvest's trigger wrote, the experience at exactly the award's
   * after-state, the container claimed by this transition, and the Auto state at the version and
   * `simulation_at` this same batch just wrote. Anything else leaves the receipt NULL, which the
   * column's NOT NULL refuses before the transaction commits.
   */
  prepareAutoHarvestGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly cropInstanceId: CropInstanceId; readonly playerId: PlayerId;
    readonly cellX: number; readonly cellY: number;
    readonly itemDefinitionId: ItemDefinitionId; readonly cargoAfterQuantity: number; readonly cargoAfterVersion: number;
    readonly progressionAfterXp: number; readonly progressionAfterVersion: number;
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const postState = [
      "EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?)",
      "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)",
      "NOT EXISTS (SELECT 1 FROM crop_instances WHERE id = ?)",
      "EXISTS (SELECT 1 FROM harvest_settlements WHERE actor_player_id = ? AND operation = 'HARVEST_CROP' AND request_id = ?)",
      "EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)",
      "EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?)"
    ].join(" AND ");
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'CELL', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')").bind(input.actorId, input.cellX, input.cellY, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId),
      this.db.prepare(`INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${postState} THEN ? ELSE NULL END, 'AUTO_HARVEST', ?, ?, 'COMPLETED', ?, ?, ?)`).bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.cropInstanceId, input.playerId, input.transitionId, input.actorId, input.itemDefinitionId, input.cargoAfterQuantity, input.cargoAfterVersion, input.playerId, input.progressionAfterXp, input.progressionAfterVersion, input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.cropInstanceId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto HARVEST guard failed"); } };
  }

  /**
   * Composes one continuous Mining beat with the actor timeline and cargo. There is intentionally no
   * resource-node state mutation here: `resource_ore` is a durable work anchor, while the actor's
   * auto-state version and cargo marker are the replay/concurrency boundary.
   */
  prepareAutoMineGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly nodeId: string; readonly nodeX: number; readonly nodeY: number; readonly itemDefinitionId: ItemDefinitionId;
    readonly expectedCargoVersion: number; readonly grantQuantity: number; readonly cargoAfterQuantity: number; readonly cargoAfterVersion: number;
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const postState = [
      "EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?)",
      "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)",
      "EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)"
    ].join(" AND ");
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'CELL', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED') AND (actor_auto_state.lease_until IS NULL OR actor_auto_state.lease_until >= ?)").bind(input.actorId, input.nodeX, input.nodeY, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId, input.eventTime),
      this.db.prepare("UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ? AND EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?)").bind(input.transitionId, input.actorId, input.expectedCargoVersion, input.actorId, nextVersion, input.eventTime),
      this.db.prepare("INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(actor_id, item_definition_id) DO UPDATE SET quantity = actor_cargo_items.quantity + excluded.quantity, version = actor_cargo_items.version + 1, updated_at = excluded.updated_at WHERE EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)").bind(input.actorId, input.itemDefinitionId, input.grantQuantity, input.updatedAt, input.actorId, input.transitionId),
      this.db.prepare(`INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${postState} THEN ? ELSE NULL END, 'AUTO_MINE', ?, ?, 'COMPLETED', ?, ?, ?)`).bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.actorId, input.itemDefinitionId, input.cargoAfterQuantity, input.cargoAfterVersion, input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.nodeId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto MINE guard failed"); } };
  }

  /**
   * The Auto timeline half of one delivery: advance the actor, and write the semantic receipt that
   * proves the whole all-or-nothing transfer landed.
   *
   * The guard observes the container marker this transfer wrote, *no* cargo rows left on the actor, the
   * Auto state at the exact version and `simulation_at` written here, and every transferred stack
   * present in the warehouse. A stale container therefore leaves the receipt NULL and the batch
   * commits nothing, so the cargo is still on the actor and the warehouse is untouched.
   */
  prepareAutoUnloadGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly additions: readonly { readonly itemDefinitionId: ItemDefinitionId; readonly quantity: number }[];
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const inventoryChecks = input.additions
      .map(() => "EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity >= ?)")
      .join(" AND ");
    const postState = [
      "EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?)",
      "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)",
      "NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ?)",
      ...(inventoryChecks.length === 0 ? [] : [inventoryChecks])
    ].join(" AND ");
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'WAREHOUSE', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')").bind(input.actorId, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId),
      this.db.prepare(`INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${postState} THEN ? ELSE NULL END, 'AUTO_UNLOAD', ?, ?, 'COMPLETED', ?, ?, ?)`).bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.actorId, ...input.additions.flatMap((addition) => [input.actorPlayerId, addition.itemDefinitionId, addition.quantity]), input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.actorId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto UNLOAD guard failed"); } };
  }

  /**
   * The Auto timeline half of one funded purchase.
   *
   * The semantic receipt's `CASE` is the batch-failing guard: it observes the Auto state this batch
   * wrote, the container claimed by this transition, the wallet at the exact final balance and
   * version, the purchase's own ledger row, every whitelist sale's ledger row and every sold stack at
   * its exact after-quantity, and the cargo the purchase granted. Anything else leaves the receipt
   * NULL and rolls the whole liquidation back.
   */
  prepareAutoFundingGuardAndAdvance(input: {
    readonly actorId: ActorId; readonly actorPlayerId: PlayerId; readonly expectedVersion: number;
    readonly expectedSimulationAt: string | null; readonly eventTime: string; readonly updatedAt: string;
    readonly transitionId: string; readonly payloadFingerprint: string; readonly responseJson: string;
    readonly playerId: PlayerId; readonly currencyDefinitionId: CurrencyDefinitionId;
    readonly walletAfterBalance: number; readonly walletAfterVersion: number; readonly transactionId: EconomyTransactionId;
    readonly itemDefinitionId: ItemDefinitionId; readonly cargoAfterQuantity: number; readonly cargoAfterVersion: number;
    readonly saleStateChecks: readonly string[]; readonly saleStateArgs: readonly unknown[];
  }): D1AtomicBatchComponent<void> {
    const nextVersion = input.expectedVersion + 1;
    const postState = [
      "EXISTS (SELECT 1 FROM actor_auto_state WHERE actor_id = ? AND version = ? AND simulation_at = ?)",
      "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)",
      "EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?)",
      "EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?)",
      "EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?)",
      ...input.saleStateChecks
    ].join(" AND ");
    const statements = [
      this.db.prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at) VALUES (?, 'MARKET', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at WHERE actor_auto_state.version = ? AND (actor_auto_state.simulation_at IS ? OR actor_auto_state.simulation_at = ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND owner_player_id = ? AND control_mode = 'AUTO_CONTROLLED')").bind(input.actorId, nextVersion, input.updatedAt, input.eventTime, input.expectedVersion, input.expectedSimulationAt, input.expectedSimulationAt, input.actorId, input.actorPlayerId),
      this.db.prepare(`INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${postState} THEN ? ELSE NULL END, 'AUTO_FUND_AND_PURCHASE_INPUT', ?, ?, 'COMPLETED', ?, ?, ?)`).bind(input.actorId, nextVersion, input.eventTime, input.actorId, input.transitionId, input.playerId, input.currencyDefinitionId, input.walletAfterBalance, input.walletAfterVersion, input.transactionId, input.playerId, input.actorId, input.itemDefinitionId, input.cargoAfterQuantity, input.cargoAfterVersion, ...input.saleStateArgs, input.actorPlayerId, input.transitionId, input.payloadFingerprint, input.actorId, input.responseJson, input.updatedAt)
    ];
    return { statements, verify: (results) => { if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto FUND guard failed"); } };
  }

  async saveAtomically(
    actorId: ActorId,
    expectedVersion: number,
    next: AutoTravelState,
    updatedAt: string
  ): Promise<boolean> {
    const values = [actorId, next.anchor?.kind ?? null, next.anchor?.x ?? null, next.anchor?.y ?? null, next.travelTo?.kind ?? null, next.travelTo?.x ?? null, next.travelTo?.y ?? null, next.arrivesAt, next.version, updatedAt, next.simulationAt ?? null, next.leaseUntil ?? null, next.leaseIssuedAt ?? null, expectedVersion] as const;
    let result;
    try {
      result = await this.db
        .prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at, simulation_at, lease_until, lease_issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, travel_kind = excluded.travel_kind, travel_x = excluded.travel_x, travel_y = excluded.travel_y, travel_arrives_at = excluded.travel_arrives_at, version = excluded.version, updated_at = excluded.updated_at, simulation_at = excluded.simulation_at, lease_until = excluded.lease_until, lease_issued_at = excluded.lease_issued_at WHERE actor_auto_state.version = ?")
        .bind(...values)
        .run();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("simulation_at")) throw error;
      result = await this.db
        .prepare("INSERT INTO actor_auto_state (actor_id, anchor_kind, anchor_x, anchor_y, travel_kind, travel_x, travel_y, travel_arrives_at, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(actor_id) DO UPDATE SET anchor_kind = excluded.anchor_kind, anchor_x = excluded.anchor_x, anchor_y = excluded.anchor_y, travel_kind = excluded.travel_kind, travel_x = excluded.travel_x, travel_y = excluded.travel_y, travel_arrives_at = excluded.travel_arrives_at, version = excluded.version, updated_at = excluded.updated_at WHERE actor_auto_state.version = ?")
        .bind(...values.slice(0, 10), expectedVersion)
        .run();
    }
    return result.success && result.meta.changes === 1;
  }

  async renewLeaseAtomically(actorId: ActorId, now: string, leaseUntil: string): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE actor_auto_state SET lease_until = ?, lease_issued_at = ?, updated_at = ? WHERE actor_id = ? AND (lease_until IS NULL OR lease_until >= ?) AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND control_mode = 'AUTO_CONTROLLED')")
      .bind(leaseUntil, now, now, actorId, now, actorId)
      .run();
    return result.success && result.meta.changes === 1;
  }
}

/**
 * The configured jobs of one actor.
 *
 * Every read is bounded to one actor's or one area's own rows, and the ordered list is served by
 * `idx_actor_jobs_actor_priority`, so the future executor's question - "this actor's jobs, in order" -
 * is an index walk rather than a sort and never a scan of the table.
 */
export class D1ActorJobRepository implements ActorJobRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByActor(actorId: ActorId): Promise<readonly ActorJob[]> {
    const result = await this.db
      .prepare(`SELECT ${ACTOR_JOB_COLUMNS} FROM actor_jobs WHERE actor_id = ? ORDER BY priority, id`)
      .bind(actorId)
      .all<ActorJobRow>();
    return result.results.map(toActorJob);
  }

  async listByFarm(farmId: FarmId): Promise<readonly ActorJob[]> {
    const result = await this.db.prepare(`SELECT ${ACTOR_JOB_COLUMNS} FROM actor_jobs WHERE farm_id = ? ORDER BY id`).bind(farmId).all<ActorJobRow>();
    return result.results.map(toActorJob);
  }

  async findById(id: JobId): Promise<ActorJob | null> {
    const row = await this.db
      .prepare(`SELECT ${ACTOR_JOB_COLUMNS} FROM actor_jobs WHERE id = ?`)
      .bind(id)
      .first<ActorJobRow>();
    return row === null ? null : toActorJob(row);
  }

  async countByWorkArea(workAreaId: WorkAreaId): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM actor_jobs WHERE work_area_id = ?")
      .bind(workAreaId)
      .first<{ readonly n: number }>();
    return row?.n ?? 0;
  }

  async createAtomically(job: ActorJob, idempotency: IdempotencyRecord): Promise<void> {
    if (job.id !== idempotency.resourceId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Job receipt does not match the job");
    }
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare(
          "INSERT INTO actor_jobs (id, actor_id, farm_id, work_area_id, kind, target_definition_id, execution_mode, priority, enabled, auto_purchase_supplies, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          job.id,
          job.actorId,
          job.farmId,
          job.workAreaId,
          job.kind,
          job.targetDefinitionId,
          job.executionMode ?? "LEGACY_ACTION_AUTO",
          job.priority,
          job.enabled ? 1 : 0,
          job.autoPurchaseSupplies ? 1 : 0,
          job.version,
          job.createdAt,
          job.updatedAt
        ),
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM actor_jobs WHERE id = ? AND actor_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          job.id,
          job.actorId,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ];
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic job create failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("JOB_NOT_FOUND", "Job was not created");
      }
      throw error;
    }
  }

  async updateTargetAtomically(job: ActorJob, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE actor_jobs SET target_definition_id = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?"
      )
      .bind(job.targetDefinitionId, job.version, job.updatedAt, job.id, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }

  async setEnabledAtomically(job: ActorJob, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE actor_jobs SET enabled = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
      .bind(job.enabled ? 1 : 0, job.version, job.updatedAt, job.id, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }

  async reorderAtomically(
    actorId: ActorId,
    expectedActorVersion: number,
    ordered: readonly JobOrderEntry[],
    updatedAt: string
  ): Promise<boolean> {
    // The actor's version is the guard, so two tabs reordering at once cannot interleave; the loser's
    // guard changes nothing and every priority write is scoped to the version the guard just wrote.
    const nextVersion = expectedActorVersion + 1;
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("UPDATE actors SET version = ?, updated_at = ? WHERE id = ? AND version = ?")
        .bind(nextVersion, updatedAt, actorId, expectedActorVersion),
      ...ordered.map((entry) =>
        this.db
          .prepare(
            "UPDATE actor_jobs SET priority = ?, version = version + 1, updated_at = ? WHERE id = ? AND actor_id = ? AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND version = ?)"
          )
          .bind(entry.priority, entry.updatedAt, entry.id, actorId, actorId, nextVersion)
      )
    ];
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic job reorder failed");
    }
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async deleteAtomically(actorId: ActorId, id: JobId, expectedVersion: number): Promise<boolean> {
    // Nothing references a job, so the delete reports exactly 0 or 1 changes - unlike the work-area
    // delete, whose cascade D1 folds into the count. If a later slice adds a child table, this moves to
    // the same guard-update-then-delete shape the work area uses.
    //
    // The renumber runs in the same transaction and is idempotent: it sets each survivor's priority to
    // one more than the number of jobs ahead of it, so the actor's priorities are 1..N again whatever
    // the delete removed. It touches no version, so a refused (stale) delete changes nothing a later
    // request can observe.
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM actor_jobs WHERE id = ? AND version = ?").bind(id, expectedVersion),
      this.db
        .prepare(
          "UPDATE actor_jobs SET priority = (SELECT COUNT(*) FROM actor_jobs AS earlier WHERE earlier.actor_id = actor_jobs.actor_id AND (earlier.priority < actor_jobs.priority OR (earlier.priority = actor_jobs.priority AND earlier.id < actor_jobs.id))) + 1 WHERE actor_id = ?"
        )
        .bind(actorId)
    ]);
    const removed = results[0];
    if (removed === undefined || !removed.success) throw new Error("Atomic job delete failed");
    return (removed.meta.changes ?? 0) === 1;
  }

  async setAutoPurchaseAtomically(job: ActorJob, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE actor_jobs SET auto_purchase_supplies = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?"
      )
      .bind(job.autoPurchaseSupplies ? 1 : 0, job.version, job.updatedAt, job.id, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }

  async listFundingItems(jobId: JobId): Promise<readonly AutoFundingItem[]> {
    const rows = await this.db
      .prepare("SELECT item_definition_id, priority FROM auto_funding_items WHERE job_id = ? ORDER BY priority")
      .bind(jobId)
      .all<{ readonly item_definition_id: string; readonly priority: number }>();
    return rows.results.map((row) => ({ itemDefinitionId: row.item_definition_id, priority: row.priority }));
  }

  async setFundingAtomically(job: ActorJob, items: readonly string[], expectedVersion: number): Promise<boolean> {
    if (items.length > MAX_AUTO_FUNDING_ITEMS) {
      throw new ApplicationError("INVALID_FUNDING", "Too many funding items");
    }
    const nextVersion = expectedVersion + 1;
    // The flag and the list move together: every list statement is scoped to the version the flag
    // write just produced, so a losing caller leaves both untouched.
    const ownsJob = "EXISTS (SELECT 1 FROM actor_jobs WHERE id = ? AND version = ?)";
    const statements: D1PreparedStatementLike[] = [
      this.db
        // Both policies move with this one write: a caller that turns funding on is also, in the same
        // command, stating what Auto Purchase should be - leaving one of them behind is a silent
        // disagreement between what the player asked for and what the row says.
        .prepare("UPDATE actor_jobs SET auto_purchase_supplies = ?, auto_funding_enabled = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
        .bind(job.autoPurchaseSupplies ? 1 : 0, job.autoFundingEnabled ? 1 : 0, job.version, job.updatedAt, job.id, expectedVersion),
      this.db
        .prepare(`DELETE FROM auto_funding_items WHERE job_id = ? AND ${ownsJob}`)
        .bind(job.id, job.id, nextVersion),
      ...items.map((itemDefinitionId, index) =>
        this.db
          .prepare(
            `INSERT INTO auto_funding_items (job_id, item_definition_id, priority, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${ownsJob}`
          )
          .bind(job.id, itemDefinitionId, index + 1, job.updatedAt, job.updatedAt, job.id, nextVersion)
      )
    ];
    const results = await this.db.batch(statements);
    const updated = results[0];
    if (updated === undefined || !updated.success) throw new Error("Atomic funding policy failed");
    return (updated.meta.changes ?? 0) === 1;
  }
}

interface CargoRow {
  readonly actor_id: string;
  readonly item_definition_id: string;
  readonly quantity: number;
  readonly version: number;
  readonly updated_at: string;
}

const CARGO_COLUMNS = "actor_id, item_definition_id, quantity, version, updated_at";

function toCargoItem(row: CargoRow): ActorCargoItem {
  return {
    actorId: parseActorId(row.actor_id),
    itemDefinitionId: parseItemDefinitionId(row.item_definition_id),
    quantity: row.quantity,
    version: row.version,
    updatedAt: row.updated_at
  };
}

/**
 * Actor cargo: one actor's carried goods, and the one transaction that moves them into the warehouse.
 *
 * The capacity guard is the database's, exactly as the warehouse's is, so a grant either fits or the
 * settlement that produced it rolls back. The transfer deletes the cargo and writes the warehouse rows
 * in **one batch** with its receipt, and every statement of it is scoped to the cargo version the
 * caller read - so a stale unload writes nothing at all, and a warehouse that fills up mid-transfer
 * refuses the whole thing rather than half of it.
 */
export class D1CargoRepository implements CargoRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByActor(actorId: ActorId): Promise<readonly ActorCargoItem[]> {
    const result = await this.db
      .prepare(`SELECT ${CARGO_COLUMNS} FROM actor_cargo_items WHERE actor_id = ? ORDER BY item_definition_id`)
      .bind(actorId)
      .all<CargoRow>();
    return result.results.map(toCargoItem);
  }

  async usedCapacity(actorId: ActorId): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(SUM(quantity), 0) AS used FROM actor_cargo_items WHERE actor_id = ?")
      .bind(actorId)
      .first<{ readonly used: number }>();
    return row?.used ?? 0;
  }

  async grantAtomically(grant: CargoGrant): Promise<void> {
    try {
      const results = await this.db.batch([
        // The container's version moves with every mutation, so a caller holding a cargo read learns
        // that it is stale rather than acting on a state that no longer exists.
        this.db.prepare("UPDATE actors SET cargo_version = cargo_version + 1 WHERE id = ?").bind(grant.actorId),
        this.db
          .prepare(
            "INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(actor_id, item_definition_id) DO UPDATE SET quantity = actor_cargo_items.quantity + excluded.quantity, updated_at = excluded.updated_at, version = actor_cargo_items.version + 1"
          )
          .bind(grant.actorId, grant.itemDefinitionId, grant.quantity, grant.timestamp)
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic cargo grant failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("cargo_full")) {
        throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
      }
      throw error;
    }
  }

  /**
   * One all-or-nothing unload, as a composable component.
   *
   * `deferReceipt` leaves out the transfer's own receipt so an Auto transition can write its semantic
   * one in the same batch; the statements that move the goods are identical either way.
   */
  prepareUnloadSettlement(
    unload: CargoUnload,
    idempotency: IdempotencyRecord,
    options: { readonly deferReceipt?: boolean } = {}
  ): D1AtomicBatchComponent<boolean> {
    const requestId = idempotency.requestId;
    // The marker, not the version, is what makes "this transfer" provable. Two transfers that read the
    // same cargo version both compute the same next version, so a loser could satisfy a version-only
    // check written by the winner and pay out a second time; scoping every statement to *this* request
    // id means a loser's clause can never match anything.
    const ownsTransfer = "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)";
    const statements: D1PreparedStatementLike[] = [
      // The guard: the cargo version the caller read, and this request's own marker.
      this.db
        .prepare(
          "UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?"
        )
        .bind(requestId, unload.actorId, unload.expectedCargoVersion),
      ...unload.stacks.map((stack) =>
        this.db
          .prepare(
            `DELETE FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ? AND quantity = ? AND ${ownsTransfer}`
          )
          .bind(unload.actorId, stack.itemDefinitionId, stack.quantity, unload.actorId, requestId)
      ),
      // Two plain statements per stack rather than one upsert: a seeded row, then a scoped growth. The
      // destination's capacity trigger fires on the growth, and the marker scoping means a transfer
      // that did not win writes neither half.
      ...unload.additions.flatMap((addition) => [
        this.db
          .prepare(
            `INSERT OR IGNORE INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) SELECT ?, ?, 0, ?, 1 WHERE ${ownsTransfer}`
          )
          .bind(addition.playerId, addition.itemDefinitionId, addition.timestamp, unload.actorId, requestId),
        this.db
          .prepare(
            `UPDATE inventory_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND ${ownsTransfer}`
          )
          .bind(addition.quantity, addition.timestamp, addition.playerId, addition.itemDefinitionId, unload.actorId, requestId)
      ])
    ];
    if (!options.deferReceipt) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${ownsTransfer} THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            unload.actorId,
            requestId,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      );
    }
    return {
      statements,
      verify: (results) => {
        if (results.length !== statements.length || results.some((result) => !result.success)) {
          throw new Error("Atomic cargo unload failed");
        }
        // The first statement is the marker; exactly one row changed when this transfer won.
        return (results[0]?.meta.changes ?? 0) === 1;
      }
    };
  }

  async unloadAllAtomically(unload: CargoUnload, idempotency: IdempotencyRecord): Promise<boolean> {
    const component = this.prepareUnloadSettlement(unload, idempotency);
    try {
      const [applied] = await executeD1AtomicBatch(this.db, [component]);
      return applied;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("warehouse_full")) {
        throw new ApplicationError("WAREHOUSE_FULL", "The warehouse does not have space for everything carried");
      }
      if (error instanceof Error && error.message.includes("cargo_full")) {
        throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
      }
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
      }
      throw error;
    }
  }

  async loadAllAtomically(load: CargoLoad, idempotency: IdempotencyRecord): Promise<boolean> {
    const requestId = idempotency.requestId;
    const ownsTransfer = "EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)";
    // The warehouse row this load may take from: the exact state the caller read, now at the version
    // this transaction's own subtraction wrote. That is what makes the credit provable - a concurrent
    // sale leaves a different version, so neither the cargo growth nor the first acquisition matches.
    const warehouseTook =
      "EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND version = ?)";
    const afterInventoryVersion = load.expectedInventoryVersion + 1;
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare(
          "UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?"
        )
        .bind(requestId, load.actorId, load.expectedCargoVersion),
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          load.quantity,
          load.timestamp,
          load.playerId,
          load.itemDefinitionId,
          load.expectedInventoryQuantity,
          load.expectedInventoryVersion,
          load.quantity
        ),
      // Growth on an existing stack, then the first acquisition of one that does not exist yet. Two
      // plain statements rather than an upsert, so each is a single, obviously-once write.
      this.db
        .prepare(
          `UPDATE actor_cargo_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND ${warehouseTook}`
        )
        .bind(
          load.quantity,
          load.timestamp,
          load.actorId,
          load.itemDefinitionId,
          load.playerId,
          load.itemDefinitionId,
          afterInventoryVersion
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) SELECT ?, ?, ?, 1, ? WHERE ${warehouseTook} AND NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?)`
        )
        .bind(
          load.actorId,
          load.itemDefinitionId,
          load.quantity,
          load.timestamp,
          load.playerId,
          load.itemDefinitionId,
          afterInventoryVersion,
          load.actorId,
          load.itemDefinitionId
        ),
      // An emptied warehouse row is removed rather than left as a zero, and only by the load that
      // emptied it.
      this.db
        .prepare(
          `DELETE FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = 0 AND ${ownsTransfer}`
        )
        .bind(load.playerId, load.itemDefinitionId, load.actorId, requestId),
      this.db
        .prepare(
          `INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN ${ownsTransfer} THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          load.actorId,
          requestId,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ];
    let results: readonly D1RunResultLike[];
    try {
      results = await this.db.batch(statements);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("cargo_full")) {
        throw new ApplicationError("CARGO_FULL", "The actor cannot carry any more");
      }
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: idempotency_keys")) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Cargo changed since it was read");
      }
      throw error;
    }
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic cargo load failed");
    }
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  prepareAutoLoad(load: CargoLoad, transitionId: string): D1AtomicBatchComponent<void> {
    const warehouseTook = "EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND version = ?)";
    const afterInventoryVersion = load.expectedInventoryVersion + 1;
    const statements = [
      this.db.prepare("UPDATE actors SET cargo_version = cargo_version + 1, cargo_transfer_id = ? WHERE id = ? AND cargo_version = ?").bind(transitionId, load.actorId, load.expectedCargoVersion),
      this.db.prepare("UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?").bind(load.quantity, load.timestamp, load.playerId, load.itemDefinitionId, load.expectedInventoryQuantity, load.expectedInventoryVersion, load.quantity),
      this.db.prepare(`UPDATE actor_cargo_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE actor_id = ? AND item_definition_id = ? AND ${warehouseTook}`).bind(load.quantity, load.timestamp, load.actorId, load.itemDefinitionId, load.playerId, load.itemDefinitionId, afterInventoryVersion),
      this.db.prepare(`INSERT OR IGNORE INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at) SELECT ?, ?, ?, 1, ? WHERE ${warehouseTook} AND NOT EXISTS (SELECT 1 FROM actor_cargo_items WHERE actor_id = ? AND item_definition_id = ?)`).bind(load.actorId, load.itemDefinitionId, load.quantity, load.timestamp, load.playerId, load.itemDefinitionId, afterInventoryVersion, load.actorId, load.itemDefinitionId),
      this.db.prepare("DELETE FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = 0 AND EXISTS (SELECT 1 FROM actors WHERE id = ? AND cargo_transfer_id = ?)").bind(load.playerId, load.itemDefinitionId, load.actorId, transitionId)
    ];
    return { statements, verify: (results) => {
      if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("Atomic Auto cargo load failed");
    } };
  }
}
