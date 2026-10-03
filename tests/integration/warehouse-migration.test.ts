import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTER_WAREHOUSE_CAPACITY } from "@happy-farm/game-data";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * The Island Warehouse migration: the capacity guard, the backfill, and the ledger reason the upgrade
 * pays through. This applies every migration so the guard is exercised against the real schema.
 */

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const migration = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIRECTORY}${name}`, "utf8"))
  .join("\n");

function insertPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

function setItem(db: NodeD1Database, playerId: string, itemId: string, quantity: number): void {
  db.sqlite
    .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)")
    .run(playerId, itemId, quantity, NOW);
}

function growItem(db: NodeD1Database, playerId: string, itemId: string, by: number): void {
  db.sqlite
    .prepare("UPDATE inventory_items SET quantity = quantity + ?, version = version + 1 WHERE player_id = ? AND item_definition_id = ?")
    .run(by, playerId, itemId);
}

function shrinkItem(db: NodeD1Database, playerId: string, itemId: string, by: number): void {
  db.sqlite
    .prepare("UPDATE inventory_items SET quantity = quantity - ?, version = version + 1 WHERE player_id = ? AND item_definition_id = ?")
    .run(by, playerId, itemId);
}

function used(db: NodeD1Database, playerId: string): number {
  const row = db.sqlite.prepare("SELECT COALESCE(SUM(quantity), 0) AS used FROM inventory_items WHERE player_id = ?").get(playerId) as
    | { used: number }
    | undefined;
  return row?.used ?? 0;
}

describe("island warehouse migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    insertPlayer(db, PLAYER_ONE_ID, "subject-one");
    insertPlayer(db, PLAYER_TWO_ID, "subject-two");
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("gives every player a starter warehouse, with the game-data capacity", () => {
    const rows = db.sqlite
      .prepare("SELECT owner_player_id, tier, capacity, zone_kind, zone_id FROM home_island_warehouses ORDER BY owner_player_id")
      .all() as unknown as readonly {
      owner_player_id: string;
      tier: number;
      capacity: number;
      zone_kind: string;
      zone_id: string | null;
    }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tier).toBe(0);
      expect(row.capacity).toBe(STARTER_WAREHOUSE_CAPACITY);
      expect(row.zone_kind).toBe("HOME_ISLAND");
    }
    // The row is created with the player, before a farm exists, so zone_id is filled later.
    expect(rows.find((row) => row.owner_player_id === PLAYER_ONE_ID)?.zone_id ?? null).toBeNull();
  });

  it("caps a player at the starter capacity, counting every item together", () => {
    setItem(db, PLAYER_ONE_ID, "item_wood", 600);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_stone", 400);
    }).not.toThrow();
    expect(used(db, PLAYER_ONE_ID)).toBe(1000);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_carrot", 1);
    }).toThrow(/warehouse_full/);
    expect(() => {
      shrinkItem(db, PLAYER_ONE_ID, "item_stone", 1);
    }).not.toThrow();
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_carrot", 1);
    }).not.toThrow();
  });

  it("caps a player who has no warehouse row at all (the default applies)", () => {
    db.sqlite.prepare("DELETE FROM home_island_warehouses WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_wood", STARTER_WAREHOUSE_CAPACITY);
    }).not.toThrow();
    expect(() => {
      growItem(db, PLAYER_ONE_ID, "item_wood", 1);
    }).toThrow(/warehouse_full/);
  });

  it("does not lose an over-capacity player's goods, and lets them remove but not add", () => {
    setItem(db, PLAYER_ONE_ID, "item_wood", 900);
    // A grandfathered player is now above a smaller capacity.
    db.sqlite.prepare("UPDATE home_island_warehouses SET capacity = 500 WHERE owner_player_id = ?").run(PLAYER_ONE_ID);
    expect(used(db, PLAYER_ONE_ID)).toBe(900);
    expect(() => {
      growItem(db, PLAYER_ONE_ID, "item_wood", 1);
    }).toThrow(/warehouse_full/);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_stone", 1);
    }).toThrow(/warehouse_full/);
    // Selling/consuming must always work: the guard only fires when a stack grows.
    expect(() => {
      shrinkItem(db, PLAYER_ONE_ID, "item_wood", 500);
    }).not.toThrow();
    expect(used(db, PLAYER_ONE_ID)).toBe(400);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_stone", 100);
    }).not.toThrow();
  });

  it("raises the cap when the warehouse is upgraded", () => {
    setItem(db, PLAYER_ONE_ID, "item_wood", 1000);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_stone", 1);
    }).toThrow(/warehouse_full/);
    db.sqlite
      .prepare("UPDATE home_island_warehouses SET tier = 1, capacity = 2500, version = version + 1 WHERE owner_player_id = ?")
      .run(PLAYER_ONE_ID);
    expect(() => {
      setItem(db, PLAYER_ONE_ID, "item_stone", 1500);
    }).not.toThrow();
  });

  it("accepts the WAREHOUSE_UPGRADE ledger reason and refuses a mismatched reference", () => {
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    const ledger = (reason: string, referenceType: string, referenceId: string): void => {
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', -100, 1000, 900, 1, ?, ?, ?, 'req_warehouse_1', ?)"
        )
        .run(`econ_${"0".repeat(8)}-0000-4000-8000-000000000001`, PLAYER_ONE_ID, reason, referenceType, referenceId, NOW);
    };
    expect(() => {
      ledger("WAREHOUSE_UPGRADE", "WAREHOUSE", `warehouse_${"0".repeat(8)}-0000-4000-8000-000000000001`);
    }).not.toThrow();
    // A warehouse reason must not masquerade behind a shop reference.
    expect(() => {
      ledger("WAREHOUSE_UPGRADE", "SHOP_ENTRY", "shop_carrot_seed");
    }).toThrow();
  });
});
