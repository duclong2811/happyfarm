import type { ProductionSettlementResult } from "@happy-farm/domain";
import type { ProductionSettlementPlan } from "@happy-farm/application";
export type { ProductionSettlementPlan } from "@happy-farm/application";
import { executeD1AtomicBatch, type D1AtomicBatchComponent } from "./d1-atomic-batch";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "./d1-types";

export interface ProductionSettlementCommit {
  readonly applied: boolean;
  readonly result: ProductionSettlementResult;
}

/**
 * D1 persistence for an already-calculated Production Rate plan. This class deliberately does no
 * production math and has no Cargo, Wallet, Market, or legacy Auto dependency.
 */
export class D1ProductionRateSettlementService {
  constructor(private readonly db: D1DatabaseLike) {}

  prepare(plan: ProductionSettlementPlan): D1AtomicBatchComponent<ProductionSettlementCommit> {
    const ownsReceipt = "EXISTS (SELECT 1 FROM production_settlement_receipts WHERE assignment_id = ? AND request_id = ?)";
    const inventoryMatches = "(NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ?) OR EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?))";
    const expectedSourceRate = plan.expectedSourceRatePerHour;
    const sourceMatches = plan.finiteSource
      ? `EXISTS (SELECT 1 FROM production_sources WHERE id = ? AND farm_id = ? AND version = ? AND remaining_stock = ?${expectedSourceRate === undefined ? "" : " AND rate_per_hour = ?"})`
      : `EXISTS (SELECT 1 FROM production_sources WHERE id = ? AND farm_id = ? AND version = ?${expectedSourceRate === undefined ? "" : " AND rate_per_hour = ?"})`;
    const nodeDepletions = plan.result.producedQuantity > 0 ? (plan.resourceNodeDepletions ?? []) : [];
    const nodeGuards = nodeDepletions.map((node) => node.expectedVersion === null
      ? "NOT EXISTS (SELECT 1 FROM resource_node_states WHERE zone_id = ? AND node_id = ?)"
      : "EXISTS (SELECT 1 FROM resource_node_states WHERE zone_id = ? AND node_id = ? AND version = ? AND available_at = ?)");
    const fishingSpotConsumptions = plan.result.producedQuantity > 0 ? (plan.fishingSpotConsumptions ?? []) : [];
    const fishingGuards = fishingSpotConsumptions.map((spot) => spot.expectedVersion === null
      ? "NOT EXISTS (SELECT 1 FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ?)"
      : "EXISTS (SELECT 1 FROM fishing_spot_states WHERE zone_id = ? AND spot_id = ? AND version = ? AND stock = ? AND last_regenerated_at = ?)");
    const guard = this.db.prepare(
      `INSERT INTO production_settlement_receipts (assignment_id, request_id, cursor_before, cursor_after, produced_quantity, created_at)
       SELECT CASE WHEN
         EXISTS (SELECT 1 FROM production_assignments WHERE id = ? AND farm_id = ? AND version = ? AND settlement_cursor = ? AND enabled = ? AND source_id = ?)
         AND ${sourceMatches}
         AND EXISTS (SELECT 1 FROM home_island_warehouses WHERE owner_player_id = ? AND version = ? AND capacity = ?)
         AND (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = ?) = ?
         AND ${inventoryMatches}
         ${nodeGuards.length === 0 ? "" : `AND ${nodeGuards.join(" AND ")}`}
         ${fishingGuards.length === 0 ? "" : `AND ${fishingGuards.join(" AND ")}`}
         AND NOT EXISTS (SELECT 1 FROM production_settlement_receipts WHERE assignment_id = ? AND request_id = ?)
       THEN ? ELSE NULL END, ?, ?, ?, ?, ?`
    ).bind(
      plan.assignmentId, plan.farmId, plan.expectedAssignmentVersion, plan.expectedCursor,
      plan.expectedAssignmentEnabled ? 1 : 0, plan.sourceId,
      ...(plan.finiteSource
        ? [plan.sourceId, plan.farmId, plan.expectedSourceVersion, plan.expectedSourceStock, ...(expectedSourceRate === undefined ? [] : [expectedSourceRate])]
        : [plan.sourceId, plan.farmId, plan.expectedSourceVersion, ...(expectedSourceRate === undefined ? [] : [expectedSourceRate])]),
      plan.playerId, plan.expectedWarehouseVersion, plan.warehouseCapacity, plan.playerId, plan.expectedWarehouseUsed,
      plan.playerId, plan.itemDefinitionId, plan.playerId, plan.itemDefinitionId,
      plan.expectedInventoryQuantity, plan.expectedInventoryVersion,
      ...nodeDepletions.flatMap((node) => node.expectedVersion === null
        ? [node.zoneId, node.nodeId]
        : [node.zoneId, node.nodeId, node.expectedVersion, node.expectedAvailableAt]),
      ...fishingSpotConsumptions.flatMap((spot) => spot.expectedVersion === null
        ? [spot.zoneId, spot.spotId]
        : [spot.zoneId, spot.spotId, spot.expectedVersion, spot.expectedStock, spot.expectedLastRegeneratedAt]),
      plan.assignmentId, plan.settlementId,
      plan.assignmentId, plan.settlementId, plan.expectedCursor, plan.result.newCursor,
      plan.result.producedQuantity, plan.settledAt
    );

    const statements: D1PreparedStatementLike[] = [guard];
    if (plan.result.producedQuantity > 0) {
      statements.push(
        this.db.prepare(
          `UPDATE inventory_items SET quantity = quantity + ?, version = version + 1, updated_at = ?
           WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND ${ownsReceipt}`
        ).bind(
          plan.result.producedQuantity, plan.settledAt, plan.playerId, plan.itemDefinitionId,
          plan.expectedInventoryQuantity, plan.expectedInventoryVersion, plan.assignmentId, plan.settlementId
        ),
        this.db.prepare(
          `INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
           SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ?) AND ${ownsReceipt}`
        ).bind(
          plan.playerId, plan.itemDefinitionId, plan.result.producedQuantity, plan.settledAt,
          plan.playerId, plan.itemDefinitionId, plan.assignmentId, plan.settlementId
        )
      );
    }
    const sourceRateChanged = plan.nextSourceRatePerHour !== undefined
      && plan.nextSourceRatePerHour !== expectedSourceRate;
    const nextStock = plan.nextSourceRemainingStock ?? plan.result.newSourceRemainingStock;
    const stockSet = plan.finiteSource && (
      plan.result.sourceConsumed > 0
      || (plan.nextSourceRemainingStock !== undefined && plan.nextSourceRemainingStock !== plan.expectedSourceStock)
    );
    if (stockSet || sourceRateChanged) {
      statements.push(
        this.db.prepare(
          `UPDATE production_sources SET remaining_stock = ${stockSet ? "?" : "remaining_stock"}, rate_per_hour = ${sourceRateChanged ? "?" : "rate_per_hour"}, version = version + 1, updated_at = ?
           WHERE id = ? AND farm_id = ? AND version = ?${plan.finiteSource && stockSet ? " AND remaining_stock = ?" : ""}${expectedSourceRate === undefined ? "" : " AND rate_per_hour = ?"} AND ${ownsReceipt}`
        ).bind(
          ...(stockSet ? [nextStock] : []),
          ...(sourceRateChanged ? [plan.nextSourceRatePerHour] : []),
          plan.settledAt, plan.sourceId, plan.farmId, plan.expectedSourceVersion,
          ...(plan.finiteSource && stockSet ? [plan.expectedSourceStock] : []),
          ...(expectedSourceRate === undefined ? [] : [expectedSourceRate]),
          plan.assignmentId, plan.settlementId
        )
      );
    }
    for (const node of nodeDepletions) {
      statements.push(
        this.db.prepare(
          `INSERT INTO resource_node_states (zone_kind, zone_id, node_id, available_at, depleted_at, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(zone_id, node_id) DO UPDATE SET available_at = excluded.available_at, depleted_at = excluded.depleted_at, version = resource_node_states.version + 1, updated_at = excluded.updated_at`
        ).bind(
          node.zoneKind, node.zoneId, node.nodeId, node.availableAt, node.depletedAt, node.nextVersion,
          node.depletedAt, node.depletedAt
        )
      );
    }
    for (const spot of fishingSpotConsumptions) {
      statements.push(
        this.db.prepare(
          `INSERT INTO fishing_spot_states (zone_kind, zone_id, spot_id, stock, last_regenerated_at, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(zone_id, spot_id) DO UPDATE SET stock = excluded.stock, last_regenerated_at = excluded.last_regenerated_at, version = fishing_spot_states.version + 1, updated_at = excluded.updated_at`
        ).bind(
          spot.zoneKind, spot.zoneId, spot.spotId, spot.stock, spot.lastRegeneratedAt, spot.nextVersion,
          spot.lastRegeneratedAt, spot.lastRegeneratedAt
        )
      );
    }
    statements.push(
      this.db.prepare(
        `UPDATE production_assignments SET settlement_cursor = ?, production_remainder = ?, blocked_reason = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND farm_id = ? AND version = ? AND settlement_cursor = ? AND ${ownsReceipt}`
      ).bind(
        plan.result.newCursor, plan.result.newRemainder, plan.result.blockedReason, plan.settledAt,
        plan.assignmentId, plan.farmId, plan.expectedAssignmentVersion, plan.expectedCursor,
        plan.assignmentId, plan.settlementId
      )
    );

    return {
      statements,
      verify: (results: readonly D1RunResultLike[]) => {
        if (results.length !== statements.length || results.some((entry) => !entry.success)) {
          throw new Error("Production settlement batch failed");
        }
        return { applied: true, result: plan.result };
      }
    };
  }

  async settle(plan: ProductionSettlementPlan): Promise<ProductionSettlementCommit> {
    try {
      const [commit] = await executeD1AtomicBatch(this.db, [this.prepare(plan)]);
      return commit;
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("NOT NULL constraint failed") || error.message.includes("warehouse_full"))) {
        throw new Error("Production settlement stale or warehouse-full conflict");
      }
      throw error;
    }
  }
}
