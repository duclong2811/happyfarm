import { afterEach, describe, expect, it } from "vitest";
import { migrationSql, allMigrationNames } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";

describe("Aquaculture multi-fish migration", () => {
  let db: NodeD1Database | undefined;
  afterEach(() => db?.close());

  it("backfills one legacy fish without changing its progress or version", () => {
    const beforeCohorts = allMigrationNames().filter((name) => name < "0032_aquaculture_multi_fish.sql").map(migrationSql).join("\n");
    db = new NodeD1Database(beforeCohorts);
    const player = "player_11111111-1111-4111-8111-111111111111";
    const farm = "farm_11111111-1111-4111-8111-111111111111";
    const construction = "construct_11111111-1111-4111-8111-111111111111";
    const t0 = "2026-10-01T00:00:00.000Z";
    const ready = "2026-10-01T01:00:00.000Z";
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Legacy', 'ACTIVE', ?, ?)").run(player, player, t0, t0);
    db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Legacy farm', ?, ?)").run(farm, player, t0, t0);
    db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(farm, player, t0);
    db.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 1, 1, 'WATER', 'IDLE', 1, ?)").run(farm, t0);
    db.sqlite.prepare("INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, 'place_fish_cage', 'AQUACULTURE', 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 'ACTIVE', ?, 'PLAYER_PLACED', NULL, 0, 0, 'currency_gold', ?, ?, NULL, 1)").run(construction, farm, player, t0, t0);
    db.sqlite.prepare("INSERT INTO aquaculture_pond_states (construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at) VALUES (?, ?, 'item_fish_tilapia', ?, ?, 7, ?)").run(construction, farm, t0, ready, t0);

    db.sqlite.exec(migrationSql("0032_aquaculture_multi_fish.sql"));
    expect(db.sqlite.prepare("SELECT construction_id, cohort_id, quantity, stocked_at, ready_at FROM aquaculture_pond_cohorts").get()).toEqual({ construction_id: construction, cohort_id: `cohort_legacy_${construction}`, quantity: 1, stocked_at: t0, ready_at: ready });
    expect(db.sqlite.prepare("SELECT item_definition_id, stocked_at, ready_at, version FROM aquaculture_pond_states WHERE construction_id = ?").get(construction)).toEqual({ item_definition_id: "item_fish_tilapia", stocked_at: t0, ready_at: ready, version: 7 });
  });

  it("backfills only legacy cages with no stock evidence, preserves stored cages, and is repeatable", () => {
    const beforeBackfill = allMigrationNames()
      .filter((name) => name <= "0032_aquaculture_multi_fish.sql")
      .map(migrationSql)
      .join("\n");
    db = new NodeD1Database(beforeBackfill);
    const player = "player_22222222-2222-4222-8222-222222222222";
    const farm = "farm_22222222-2222-4222-8222-222222222222";
    const emptyActive = "construct_22222222-2222-4222-8222-222222222221";
    const emptyStored = "construct_22222222-2222-4222-8222-222222222222";
    const stocked = "construct_22222222-2222-4222-8222-222222222223";
    const historical = "construct_22222222-2222-4222-8222-222222222224";
    const t0 = "2026-10-02T00:00:00.000Z";
    const ready = "2026-10-02T01:00:00.000Z";
    db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'test', ?, 'Legacy', 'ACTIVE', ?, ?)").run(player, player, t0, t0);
    db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Legacy farm', ?, ?)").run(farm, player, t0, t0);
    db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(farm, player, t0);
    let nextX = 1;
    const addConstruction = (id: string, state: "ACTIVE" | "STORED"): void => {
      const x = nextX++;
      db?.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, 1, 'WATER', 'IDLE', 1, ?)").run(farm, x, t0);
      db?.sqlite.prepare("INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, 'place_fish_cage', 'AQUACULTURE', ?, 1, 0, 1, 1, ?, ?, 1, 1, 1, ?, ?, 'PLAYER_PLACED', NULL, 0, 0, 'currency_gold', ?, ?, ?, 1)").run(id, farm, x, x, x, state, player, t0, t0, state === "STORED" ? t0 : null);
    };
    addConstruction(emptyActive, "ACTIVE");
    addConstruction(emptyStored, "STORED");
    addConstruction(stocked, "ACTIVE");
    addConstruction(historical, "ACTIVE");
    db.sqlite.prepare("INSERT INTO aquaculture_pond_states (construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at) VALUES (?, ?, 'item_fish_tilapia', ?, ?, 7, ?)").run(stocked, farm, t0, ready, t0);
    db.sqlite.prepare("INSERT INTO aquaculture_pond_cohorts (construction_id, cohort_id, farm_id, item_definition_id, quantity, stocked_at, ready_at, created_at) VALUES (?, ?, ?, 'item_fish_tilapia', 1, ?, ?, ?)").run(stocked, `cohort_${stocked}`, farm, t0, ready, t0);
    db.sqlite.prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'STOCK_AQUACULTURE_POND', 'legacy_stock_01', ?, 'COMPLETED', ?, '{}', ?)").run(player, "f".repeat(64), historical, t0);

    db.sqlite.exec(migrationSql("0033_aquaculture_backfill_empty_ponds.sql"));
    expect(db.sqlite.prepare("SELECT construction_id, farm_id, item_definition_id, stocked_at, ready_at, version FROM aquaculture_pond_states ORDER BY construction_id").all()).toEqual([
      { construction_id: emptyActive, farm_id: farm, item_definition_id: null, stocked_at: null, ready_at: null, version: 0 },
      { construction_id: emptyStored, farm_id: farm, item_definition_id: null, stocked_at: null, ready_at: null, version: 0 },
      { construction_id: stocked, farm_id: farm, item_definition_id: "item_fish_tilapia", stocked_at: t0, ready_at: ready, version: 7 }
    ]);
    expect(db.sqlite.prepare("SELECT quantity FROM aquaculture_pond_cohorts WHERE construction_id = ?").get(stocked)).toEqual({ quantity: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM aquaculture_pond_states WHERE construction_id = ?").get(historical)).toEqual({ n: 0 });

    db.sqlite.exec(migrationSql("0033_aquaculture_backfill_empty_ponds.sql"));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM aquaculture_pond_states").get()).toEqual({ n: 3 });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps the adult-output trigger migration repeatable", () => {
    db = new NodeD1Database(allMigrationNames().filter((name) => name <= "0033_aquaculture_backfill_empty_ponds.sql").map(migrationSql).join("\n"));

    db.sqlite.exec(migrationSql("0034_aquaculture_adult_fish_output.sql"));
    db.sqlite.exec(migrationSql("0034_aquaculture_adult_fish_output.sql"));

    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('aquaculture_harvest_validate', 'aquaculture_pond_settlement_validate') ORDER BY name").all()).toEqual([
      { name: "aquaculture_harvest_validate" },
      { name: "aquaculture_pond_settlement_validate" },
    ]);
  });
});
