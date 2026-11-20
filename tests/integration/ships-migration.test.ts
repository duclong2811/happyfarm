import { describe, expect, it } from "vitest";
import { allMigrationNames, migrationSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Migration 0047: ships, voyages, and the ledger rebuilt to admit the ship reasons.
 *
 * The rebuild must not lose a ledger row, a trigger, or a word of any trigger that reads the ledger:
 * every trigger that stood before stands after with exactly the same SQL, and the only new one is the
 * ship-build receipt guard.
 */

const SHIP_ID = `ship_${PLAYER_ONE_ID.slice("player_".length)}`;
const FINGERPRINT = "f".repeat(64);

function seedPlayer(db: NodeD1Database): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'sailor', 'Sailor', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 2000, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
}

describe("migration 0047: ships, voyages and the ledger rebuild", () => {
  it("keeps every ledger row and the exact SQL of every trigger, and admits only the ship pairing", () => {
    const before = allMigrationNames().filter((name) => name < "0047");
    const db = new NodeD1Database(before.map((name) => migrationSql(name)).join("\n"));
    try {
      seedPlayer(db);
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_eeeeeeee-eeee-4eee-8eee-000000000001', ?, 'currency_gold', -100, 2000, 1900, 1, 'WAREHOUSE_UPGRADE', 'WAREHOUSE', 'warehouse_11111111-1111-4111-8111-111111111111', 'request-0001', ?)"
        )
        .run(PLAYER_ONE_ID, NOW);
      const triggers = (): Record<string, string> =>
        Object.fromEntries(
          (db.sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as { name: string; sql: string }[]).map(
            (row) => [row.name, row.sql]
          )
        );
      const indexes = (): string[] =>
        (db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'economy_ledger' AND sql IS NOT NULL ORDER BY name").all() as { sql: string }[]).map(
          (row) => row.sql
        );
      const triggersBefore = triggers();
      const indexesBefore = indexes();

      db.sqlite.exec(migrationSql("0047_ships_and_voyages.sql"));

      expect(db.sqlite.prepare("SELECT id, delta, reason FROM economy_ledger").all()).toEqual([
        { id: "econ_eeeeeeee-eeee-4eee-8eee-000000000001", delta: -100, reason: "WAREHOUSE_UPGRADE" }
      ]);
      const after = triggers();
      expect(Object.keys(after).sort()).toEqual([...Object.keys(triggersBefore), "idempotency_ship_build_requires_ledger"].sort());
      for (const [name, sql] of Object.entries(triggersBefore)) expect(after[name]).toBe(sql);
      expect(indexes()).toEqual(indexesBefore);

      const insert = db.sqlite.prepare(
        "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', -800, 1900, 1100, 2, ?, ?, ?, 'request-0002', ?)"
      );
      const id = "econ_eeeeeeee-eeee-4eee-8eee-000000000002";
      expect(() => insert.run(id, PLAYER_ONE_ID, "SHIP_BUILD", "MINE", SHIP_ID, NOW)).toThrow();
      expect(() => insert.run(id, PLAYER_ONE_ID, "MINE_UPGRADE", "SHIP", SHIP_ID, NOW)).toThrow();
      expect(() => insert.run(id, PLAYER_ONE_ID, "SHIP_BUILD", "SHIP", "mine_x", NOW)).toThrow();
      insert.run(id, PLAYER_ONE_ID, "SHIP_BUILD", "SHIP", SHIP_ID, NOW);
      expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 1100, version: 3 });
      expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
      expect(() => db.sqlite.prepare("UPDATE economy_ledger SET delta = -1").run()).toThrow();
      // A ship-build receipt cannot exist without its ledger row.
      const receipt = db.sqlite.prepare(
        "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'SHIP_BUILD', ?, ?, 'COMPLETED', ?, '{}', ?)"
      );
      expect(() => receipt.run(PLAYER_ONE_ID, "request-0003", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000009", NOW)).toThrow();
      receipt.run(PLAYER_ONE_ID, "request-0002", FINGERPRINT, id, NOW);
    } finally {
      db.close();
    }
  });

  it("holds one ship and one voyage per player, with sane values", () => {
    // The schema as 0047 to 0050 left it: 0051 gives a player a fleet (fleet-migration.test.ts).
    const db = new NodeD1Database(
      allMigrationNames()
        .filter((name) => name < "0051")
        .map((name) => migrationSql(name))
        .join("\n")
    );
    try {
      seedPlayer(db);
      const ship = db.sqlite.prepare(
        "INSERT INTO player_ships (player_id, ship_id, class_id, tier, hull, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      expect(() => ship.run(PLAYER_ONE_ID, "boat_1", "ship_class_sloop", 2, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(PLAYER_ONE_ID, SHIP_ID, "sloop", 2, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(PLAYER_ONE_ID, SHIP_ID, "ship_class_sloop", 0, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(PLAYER_ONE_ID, SHIP_ID, "ship_class_sloop", 2, -1, NOW, NOW)).toThrow();
      ship.run(PLAYER_ONE_ID, SHIP_ID, "ship_class_sloop", 2, 150, NOW, NOW);
      expect(() => ship.run(PLAYER_ONE_ID, `${SHIP_ID}2`, "ship_class_brig", 3, 320, NOW, NOW)).toThrow();

      const voyage = db.sqlite.prepare(
        "INSERT INTO ship_voyages (player_id, from_slot_id, to_slot_id, ship_tier, departed_at, arrives_at, status, request_id, updated_at) VALUES (?, ?, ?, 2, ?, ?, ?, 'request-0001', ?)"
      );
      const later = "2026-11-21T00:10:00.000Z";
      expect(() => voyage.run(PLAYER_ONE_ID, "home", "slot_north_1_2", NOW, later, "UNDERWAY", NOW)).toThrow();
      expect(() => voyage.run(PLAYER_ONE_ID, "slot_north_1_1", "slot_north_1_2", later, NOW, "UNDERWAY", NOW)).toThrow();
      expect(() => voyage.run(PLAYER_ONE_ID, "slot_north_1_1", "slot_north_1_2", NOW, later, "SUNK", NOW)).toThrow();
      voyage.run(PLAYER_ONE_ID, "slot_north_1_1", "slot_north_1_2", NOW, later, "UNDERWAY", NOW);
      expect(() => voyage.run(PLAYER_ONE_ID, "slot_north_1_1", "slot_north_1_3", NOW, later, "UNDERWAY", NOW)).toThrow();
    } finally {
      db.close();
    }
  });
});
