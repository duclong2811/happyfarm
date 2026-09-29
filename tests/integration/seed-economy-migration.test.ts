import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

function readMigration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

/** Everything a database has before the seed economy migration is applied. */
const BEFORE = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql"
]
  .map(readMigration)
  .join("\n");

const SEED_ECONOMY = readMigration("0007_seed_economy.sql");

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare(
    "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)"
  );
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
}

function grant(db: NodeD1Database, player = PLAYER_ONE_ID, quantity = 36): void {
  db.sqlite
    .prepare("INSERT INTO starter_seed_grants (player_id, item_definition_id, quantity, created_at) VALUES (?, 'item_carrot_seed', ?, ?)")
    .run(player, quantity, NOW);
}

describe("seed economy migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(BEFORE);
    seedPlayers(db);
  });

  afterEach(() => {
    db.close();
  });

  it("adds only the starter receipt table, leaving existing player state alone", () => {
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', 4, ?, 1)")
      .run(PLAYER_ONE_ID, NOW);

    db.sqlite.exec(SEED_ECONOMY);

    expect(
      db.sqlite
        .prepare("SELECT item_definition_id, quantity, version FROM inventory_items WHERE player_id = ?")
        .all(PLAYER_ONE_ID)
    ).toEqual([{ item_definition_id: "item_carrot", quantity: 4, version: 1 }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 0 });
  });

  it("credits the inventory in the same statement that writes the receipt", () => {
    db.sqlite.exec(SEED_ECONOMY);
    grant(db);
    expect(
      db.sqlite
        .prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 36, version: 1 });
  });

  it("refuses a second grant for the same player, which is what makes it one-time", () => {
    db.sqlite.exec(SEED_ECONOMY);
    grant(db);
    expect(() => { grant(db); }).toThrow();
    expect(
      db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 36 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 1 });
  });

  it("keeps the grant scoped to one player", () => {
    db.sqlite.exec(SEED_ECONOMY);
    grant(db);
    grant(db, PLAYER_TWO_ID);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 2 });
    expect(
      db.sqlite.prepare("SELECT player_id, quantity FROM inventory_items WHERE item_definition_id = 'item_carrot_seed' ORDER BY player_id").all()
    ).toEqual([
      { player_id: PLAYER_ONE_ID, quantity: 36 },
      { player_id: PLAYER_TWO_ID, quantity: 36 }
    ]);
  });

  it("rolls the credit back with the receipt when the receipt cannot be written", () => {
    db.sqlite.exec(SEED_ECONOMY);
    expect(() => { grant(db, PLAYER_ONE_ID, 0); }).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 0 });
  });

  it("refuses a grant that would overflow the inventory stack", () => {
    db.sqlite.exec(SEED_ECONOMY);
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot_seed', 2147483647, ?, 1)")
      .run(PLAYER_ONE_ID, NOW);
    expect(() => { grant(db); }).toThrow();
    expect(
      db.sqlite
        .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
        .get(PLAYER_ONE_ID)
    ).toEqual({ quantity: 2147483647 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_seed_grants").get()).toEqual({ count: 0 });
  });
});
