import { describe, expect, it } from "vitest";
import { allMigrationNames, migrationSql, schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Migration 0051: the fleet (docs/design/FLEET.md, F1).
 *
 * A stored ship survives into berth 1 with its id, class, hull and version; a player may then keep a
 * ship per berth; the dock has its table; a voyage names its ship. The ledger rebuild loses no row, no
 * index and no word of any trigger, and admits exactly the dock pairing.
 */

const UUID = PLAYER_ONE_ID.slice("player_".length);
const SHIP_ID = `ship_${UUID}`;
const DOCK_ID = `dock_${UUID}`;
const FINGERPRINT = "f".repeat(64);
const LATER = "2026-11-21T00:10:00.000Z";

function seedPlayer(db: NodeD1Database): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'sailor', 'Sailor', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 2000, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
}

function before0051(): NodeD1Database {
  return new NodeD1Database(
    allMigrationNames()
      .filter((name) => name < "0051")
      .map((name) => migrationSql(name))
      .join("\n")
  );
}

describe("migration 0051: the fleet, the dock and the ledger rebuild", () => {
  it("moves a stored ship and its voyage across unchanged, into berth 1", () => {
    const db = before0051();
    try {
      seedPlayer(db);
      db.sqlite
        .prepare("INSERT INTO player_ships (player_id, ship_id, class_id, tier, hull, version, last_change_id, created_at, updated_at) VALUES (?, ?, 'ship_class_brig', 3, 211, 4, 'econ_x', ?, ?)")
        .run(PLAYER_ONE_ID, SHIP_ID, NOW, NOW);
      db.sqlite
        .prepare(
          "INSERT INTO ship_voyages (player_id, from_slot_id, to_slot_id, ship_tier, departed_at, arrives_at, status, request_id, updated_at) VALUES (?, 'slot_north_1_1', 'slot_north_1_2', 3, ?, ?, 'UNDERWAY', 'request-0001', ?)"
        )
        .run(PLAYER_ONE_ID, NOW, LATER, NOW);

      db.sqlite.exec(migrationSql("0051_fleet_and_docks.sql"));

      expect(db.sqlite.prepare("SELECT * FROM player_ships").all()).toEqual([
        {
          ship_id: SHIP_ID,
          player_id: PLAYER_ONE_ID,
          berth: 1,
          class_id: "ship_class_brig",
          tier: 3,
          hull: 211,
          version: 4,
          last_change_id: "econ_x",
          created_at: NOW,
          updated_at: NOW
        }
      ]);
      expect(db.sqlite.prepare("SELECT to_slot_id, ship_id FROM ship_voyages").all()).toEqual([{ to_slot_id: "slot_north_1_2", ship_id: null }]);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM player_docks").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("keeps every ledger row and the exact SQL of every trigger, and admits only the dock pairing", () => {
    const db = before0051();
    try {
      seedPlayer(db);
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_eeeeeeee-eeee-4eee-8eee-000000000001', ?, 'currency_gold', -100, 2000, 1900, 1, 'SHIP_BUILD', 'SHIP', ?, 'request-0001', ?)"
        )
        .run(PLAYER_ONE_ID, SHIP_ID, NOW);
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

      db.sqlite.exec(migrationSql("0051_fleet_and_docks.sql"));

      expect(db.sqlite.prepare("SELECT id, delta, reason FROM economy_ledger").all()).toEqual([
        { id: "econ_eeeeeeee-eeee-4eee-8eee-000000000001", delta: -100, reason: "SHIP_BUILD" }
      ]);
      const after = triggers();
      expect(Object.keys(after).sort()).toEqual([...Object.keys(triggersBefore), "idempotency_dock_upgrade_requires_ledger"].sort());
      for (const [name, sql] of Object.entries(triggersBefore)) expect(after[name]).toBe(sql);
      expect(indexes()).toEqual(indexesBefore);

      const insert = db.sqlite.prepare(
        "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', -500, 1900, 1400, 2, ?, ?, ?, 'request-0002', ?)"
      );
      const id = "econ_eeeeeeee-eeee-4eee-8eee-000000000002";
      expect(() => insert.run(id, PLAYER_ONE_ID, "DOCK_UPGRADE", "SHIP", SHIP_ID, NOW)).toThrow();
      expect(() => insert.run(id, PLAYER_ONE_ID, "SHIP_BUILD", "DOCK", DOCK_ID, NOW)).toThrow();
      expect(() => insert.run(id, PLAYER_ONE_ID, "DOCK_UPGRADE", "DOCK", SHIP_ID, NOW)).toThrow();
      insert.run(id, PLAYER_ONE_ID, "DOCK_UPGRADE", "DOCK", DOCK_ID, NOW);
      expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 1400, version: 3 });
      expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
      expect(() => db.sqlite.prepare("UPDATE economy_ledger SET delta = -1").run()).toThrow();
      // A dock-upgrade receipt cannot exist without its ledger row.
      const receipt = db.sqlite.prepare(
        "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'DOCK_UPGRADE', ?, ?, 'COMPLETED', ?, '{}', ?)"
      );
      expect(() => receipt.run(PLAYER_ONE_ID, "request-0003", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000009", NOW)).toThrow();
      receipt.run(PLAYER_ONE_ID, "request-0002", FINGERPRINT, id, NOW);
    } finally {
      db.close();
    }
  });

  it("holds a ship per berth, one dock per player, and voyages that name a ship", () => {
    const db = new NodeD1Database(schemaSql());
    try {
      seedPlayer(db);
      const ship = db.sqlite.prepare("INSERT INTO player_ships (ship_id, player_id, berth, class_id, tier, hull, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      expect(() => ship.run("boat_1", PLAYER_ONE_ID, 1, "ship_class_sloop", 2, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(SHIP_ID, PLAYER_ONE_ID, 0, "ship_class_sloop", 2, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(SHIP_ID, PLAYER_ONE_ID, 9, "ship_class_sloop", 2, 150, NOW, NOW)).toThrow();
      expect(() => ship.run(SHIP_ID, PLAYER_ONE_ID, 1, "sloop", 2, 150, NOW, NOW)).toThrow();
      ship.run(SHIP_ID, PLAYER_ONE_ID, 1, "ship_class_sloop", 2, 150, NOW, NOW);
      ship.run(`${SHIP_ID}_2`, PLAYER_ONE_ID, 2, "ship_class_rowboat", 1, 60, NOW, NOW);
      // One ship a berth, and one berth a ship.
      expect(() => ship.run(`${SHIP_ID}_3`, PLAYER_ONE_ID, 2, "ship_class_rowboat", 1, 60, NOW, NOW)).toThrow();
      expect(() => ship.run(`${SHIP_ID}_2`, PLAYER_ONE_ID, 3, "ship_class_rowboat", 1, 60, NOW, NOW)).toThrow();
      // A ship belongs to a player who exists.
      expect(() => ship.run("ship_99999999-9999-4999-8999-999999999999", "player_99999999-9999-4999-8999-999999999999", 1, "ship_class_rowboat", 1, 60, NOW, NOW)).toThrow();

      const dock = db.sqlite.prepare("INSERT INTO player_docks (player_id, dock_id, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
      expect(() => dock.run(PLAYER_ONE_ID, "pier_1", 2, NOW, NOW)).toThrow();
      expect(() => dock.run(PLAYER_ONE_ID, DOCK_ID, 0, NOW, NOW)).toThrow();
      dock.run(PLAYER_ONE_ID, DOCK_ID, 2, NOW, NOW);
      expect(() => dock.run(PLAYER_ONE_ID, DOCK_ID, 3, NOW, NOW)).toThrow();

      const voyage = db.sqlite.prepare(
        "INSERT INTO ship_voyages (player_id, from_slot_id, to_slot_id, ship_tier, departed_at, arrives_at, status, request_id, updated_at, ship_id) VALUES (?, 'slot_north_1_1', 'slot_north_1_2', 2, ?, ?, 'UNDERWAY', 'request-0001', ?, ?)"
      );
      expect(() => voyage.run(PLAYER_ONE_ID, NOW, LATER, NOW, "boat_1")).toThrow();
      voyage.run(PLAYER_ONE_ID, NOW, LATER, NOW, `${SHIP_ID}_2`);
    } finally {
      db.close();
    }
  });
});

describe("migration 0052: fishing trips", () => {
  it("holds one trip a boat, with a ground, a return no earlier than its start, and a catch", () => {
    const db = new NodeD1Database(schemaSql());
    try {
      seedPlayer(db);
      const trip = db.sqlite.prepare("INSERT INTO ship_trips (ship_id, player_id, ground_id, departed_at, returns_at, catch_json, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'trip-request-1', ?)");
      expect(() => trip.run("boat_1", PLAYER_ONE_ID, "ground_inshore", NOW, LATER, "{}", NOW)).toThrow();
      expect(() => trip.run(SHIP_ID, PLAYER_ONE_ID, "inshore", NOW, LATER, "{}", NOW)).toThrow();
      expect(() => trip.run(SHIP_ID, PLAYER_ONE_ID, "ground_inshore", LATER, NOW, "{}", NOW)).toThrow();
      expect(() => trip.run(SHIP_ID, PLAYER_ONE_ID, "ground_inshore", NOW, LATER, "", NOW)).toThrow();
      trip.run(SHIP_ID, PLAYER_ONE_ID, "ground_inshore", NOW, LATER, '{"item_fish_sardine":8}', NOW);
      expect(() => trip.run(SHIP_ID, PLAYER_ONE_ID, "ground_offshore", NOW, LATER, "{}", NOW)).toThrow();
      expect(() => trip.run(`${SHIP_ID}_2`, "player_99999999-9999-4999-8999-999999999999", "ground_inshore", NOW, LATER, "{}", NOW)).toThrow();
    } finally {
      db.close();
    }
  });
});
