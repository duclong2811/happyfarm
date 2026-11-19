import { describe, expect, it } from "vitest";
import { allMigrationNames, migrationSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Migration 0050: the ledger rebuilt to admit `PIRATE_BOUNTY`.
 *
 * Like 0047, the rebuild must not lose a ledger row, an index, or a word of any trigger that reads the
 * ledger: every trigger that stood before stands after with exactly the same SQL, and the only new one
 * is the bounty receipt guard. The table itself differs from before only in the bounty reason.
 */

const SHIP_ID = `ship_${PLAYER_ONE_ID.slice("player_".length)}`;
const FINGERPRINT = "f".repeat(64);

function before0050(): NodeD1Database {
  const names = allMigrationNames().filter((name) => name < "0050");
  const db = new NodeD1Database(names.map((name) => migrationSql(name)).join("\n"));
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'sailor', 'Sailor', 'ACTIVE', ?, ?)"
    )
    .run(PLAYER_ONE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 2000, 1, ?, ?)").run(PLAYER_ONE_ID, NOW, NOW);
  return db;
}

function ledgerInsert(db: NodeD1Database, id: string, reason: string, delta: number, balanceBefore: number, walletVersion: number, referenceId = SHIP_ID): void {
  db.sqlite
    .prepare(
      "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', ?, ?, ?, ?, ?, 'SHIP', ?, ?, ?)"
    )
    .run(id, PLAYER_ONE_ID, delta, balanceBefore, balanceBefore + delta, walletVersion, reason, referenceId, `request-${id.slice(-4)}`, NOW);
}

describe("migration 0050: pirate bounties and the ledger rebuild", () => {
  it("keeps every ledger row, index and trigger exactly, and changes the table only by the bounty reason", () => {
    const db = before0050();
    try {
      ledgerInsert(db, "econ_eeeeeeee-eeee-4eee-8eee-000000000001", "SHIP_REPAIR", -100, 2000, 1);
      const schema = (): Record<string, string> =>
        Object.fromEntries(
          (db.sqlite.prepare("SELECT type || ':' || name AS key, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY key").all() as { key: string; sql: string }[]).map(
            (row) => [row.key, row.sql]
          )
        );
      const beforeSchema = schema();
      // A bounty is not a reason the ledger knows yet.
      expect(() => { ledgerInsert(db, "econ_eeeeeeee-eeee-4eee-8eee-000000000002", "PIRATE_BOUNTY", 160, 1900, 2); }).toThrow(/CHECK constraint failed/);

      db.sqlite.exec(migrationSql("0050_pirate_bounty.sql"));

      expect(db.sqlite.prepare("SELECT id, delta, reason FROM economy_ledger").all()).toEqual([
        { id: "econ_eeeeeeee-eeee-4eee-8eee-000000000001", delta: -100, reason: "SHIP_REPAIR" }
      ]);
      const afterSchema = schema();
      expect(Object.keys(afterSchema).sort()).toEqual([...Object.keys(beforeSchema), "trigger:idempotency_pirate_bounty_requires_ledger"].sort());
      for (const [key, sql] of Object.entries(beforeSchema)) {
        if (key === "table:economy_ledger") continue;
        expect(afterSchema[key], key).toBe(sql);
      }
      // The table is the old one with the bounty added, and nothing else.
      const widened = (beforeSchema["table:economy_ledger"] ?? "")
        .replace("'SHIP_BUILD', 'SHIP_REPAIR'\n    )", "'SHIP_BUILD', 'SHIP_REPAIR', 'PIRATE_BOUNTY'\n    )")
        .replace("(reason IN ('SHIP_BUILD', 'SHIP_REPAIR') AND reference_type = 'SHIP')", "(reason IN ('SHIP_BUILD', 'SHIP_REPAIR', 'PIRATE_BOUNTY') AND reference_type = 'SHIP')");
      expect(afterSchema["table:economy_ledger"]?.replace("CREATE TABLE economy_ledger_rebuilt", "CREATE TABLE economy_ledger").replace(/CREATE TABLE "economy_ledger"/, "CREATE TABLE economy_ledger")).toBe(
        widened.replace(/CREATE TABLE "economy_ledger"/, "CREATE TABLE economy_ledger")
      );

      // A bounty is admitted, pointing at a ship, and the wallet trigger still applies it.
      ledgerInsert(db, "econ_eeeeeeee-eeee-4eee-8eee-000000000003", "PIRATE_BOUNTY", 160, 1900, 2);
      expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ balance: 2060, version: 3 });
      // ...but never pointing at anything else.
      expect(() =>
        db.sqlite
          .prepare(
            "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_eeeeeeee-eeee-4eee-8eee-000000000004', ?, 'currency_gold', 10, 2060, 2070, 3, 'PIRATE_BOUNTY', 'WAREHOUSE', 'warehouse_11111111-1111-4111-8111-111111111111', 'request-0004', ?)"
          )
          .run(PLAYER_ONE_ID, NOW)
      ).toThrow(/CHECK constraint failed/);
      // The ledger is still append-only.
      expect(() => db.sqlite.prepare("UPDATE economy_ledger SET delta = 1 WHERE reason = 'PIRATE_BOUNTY'").run()).toThrow();
      expect(() => db.sqlite.prepare("DELETE FROM economy_ledger").run()).toThrow();
    } finally {
      db.close();
    }
  });

  it("writes a bounty's receipt only beside its ledger row", () => {
    const db = before0050();
    try {
      db.sqlite.exec(migrationSql("0050_pirate_bounty.sql"));
      const receipt = db.sqlite.prepare(
        "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'PIRATE_BOUNTY', ?, ?, 'COMPLETED', ?, '{}', ?)"
      );
      expect(() => receipt.run(PLAYER_ONE_ID, "bounty_without_ledger", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000009", NOW)).toThrow(
        /completed pirate bounty idempotency requires its ledger row/
      );
      ledgerInsert(db, "econ_eeeeeeee-eeee-4eee-8eee-000000000005", "PIRATE_BOUNTY", 160, 2000, 1);
      receipt.run(PLAYER_ONE_ID, "bounty_with_ledger_01", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000005", NOW);
      // A repair's ledger row does not stand in for a bounty's.
      ledgerInsert(db, "econ_eeeeeeee-eeee-4eee-8eee-000000000006", "SHIP_REPAIR", -100, 2160, 2);
      expect(() => receipt.run(PLAYER_ONE_ID, "bounty_on_a_repair_01", FINGERPRINT, "econ_eeeeeeee-eeee-4eee-8eee-000000000006", NOW)).toThrow(
        /completed pirate bounty idempotency requires its ledger row/
      );
    } finally {
      db.close();
    }
  });
});
