import { describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { migrationSql } from "../support/migrations";

const BEFORE_NEIGHBOR = [
  "0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql",
  "0005_player_progression.sql", "0006_farm_expansion.sql", "0007_seed_economy.sql", "0008_tree_instances.sql",
  "0009_starter_package.sql", "0010_farm_constructions.sql", "0011_construction_editing.sql", "0012_world_objects.sql",
  "0013_world_objects_v2.sql", "0014_one_farm_per_player.sql", "0015_player_identities.sql", "0016_fishing_actions.sql",
  "0017_resource_nodes.sql", "0018_island_warehouses.sql", "0019_warehouse_upgrade_marker.sql", "0020_action_reward_rolls.sql",
  "0021_farm_read_indexes.sql", "0022_work_areas.sql", "0023_actors_and_jobs.sql", "0024_actor_cargo.sql", "0025_assignment_auto_purchase.sql",
  "0026_auto_execution.sql", "0027_auto_simulation_watermark.sql", "0028_auto_funding.sql", "0029_production_rate_core.sql",
  "0030_wild_fishery_stock.sql", "0031_aquaculture_pond_cycle.sql", "0032_aquaculture_multi_fish.sql", "0033_aquaculture_backfill_empty_ponds.sql",
  "0034_aquaculture_adult_fish_output.sql", "0035_forestry_construction_lifecycle.sql", "0036_tree_management.sql"
].map(migrationSql).join("\n");

describe("neighbor migration", () => {
  it("adds only neighbour tables and preserves an existing farm row", () => {
    const db = new NodeD1Database(BEFORE_NEIGHBOR);
    try {
      db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES ('player_33333333-3333-4333-8333-333333333333', 'issuer', 'subject', 'Legacy', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run();
      db.sqlite.prepare("INSERT INTO farms (id, name, owner_player_id, created_at, updated_at) VALUES ('farm_33333333-3333-4333-8333-333333333333', 'Legacy Farm', 'player_33333333-3333-4333-8333-333333333333', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run();
      db.sqlite.exec(migrationSql("0037_neighbor_island.sql"));
      const farm = db.sqlite.prepare("SELECT name FROM farms WHERE id = 'farm_33333333-3333-4333-8333-333333333333'").get() as { name: string } | undefined;
      const tables = db.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'neighbor_%'").get() as { count: number } | undefined;
      expect(farm?.name).toBe("Legacy Farm");
      expect(tables?.count).toBe(4);
    } finally {
      db.close();
    }
  });
});
