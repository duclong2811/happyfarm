import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

describe("inventory and harvest migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    const insertPlayer = db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)");
    insertPlayer.run(PLAYER_ONE_ID, "one", NOW, NOW);
    insertPlayer.run(PLAYER_TWO_ID, "two", NOW, NOW);
    db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("enforces one bounded stack per player and item", () => {
    const insert = db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', ?, ?, 1)");
    insert.run(PLAYER_ONE_ID, 1, NOW);
    expect(() => insert.run(PLAYER_ONE_ID, 1, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_wheat', -1, ?, 1)").run(PLAYER_ONE_ID, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_wheat', 2147483648, ?, 1)").run(PLAYER_ONE_ID, NOW)).toThrow();
    expect(() => db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES ('player_ffffffff-ffff-4fff-8fff-ffffffffffff', 'item_wheat', 1, ?, 1)").run(NOW)).toThrow();
  });

  it("isolates identical item stacks between players", () => {
    const insert = db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot', ?, ?, 1)");
    insert.run(PLAYER_ONE_ID, 2, NOW);
    insert.run(PLAYER_TWO_ID, 7, NOW);
    const rows = db.sqlite.prepare("SELECT player_id, quantity FROM inventory_items ORDER BY player_id").all() as Array<{ player_id: string; quantity: number }>;
    expect(rows).toEqual([
      { player_id: PLAYER_ONE_ID, quantity: 2 },
      { player_id: PLAYER_TWO_ID, quantity: 7 }
    ]);
  });
});
