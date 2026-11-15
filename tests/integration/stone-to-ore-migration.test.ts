import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { NOW } from "../support/fixtures";

const DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".sql")).sort();
const read = (name: string): string => readFileSync(`${DIRECTORY}${name}`, "utf8");
const before = files.filter((name) => name < "0041").map(read).join("\n");
const stoneToOre = read("0041_stone_to_ore.sql");

function player(db: NodeD1Database, id: string): void {
  db.sqlite
    .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'P', 'ACTIVE', ?, ?)")
    .run(id, id, NOW, NOW);
}
function item(db: NodeD1Database, playerId: string, itemId: string, quantity: number): void {
  db.sqlite.prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)").run(playerId, itemId, quantity, NOW);
}
function held(db: NodeD1Database, playerId: string, itemId: string): number | null {
  const row = db.sqlite.prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?").get(playerId, itemId) as { quantity: number } | undefined;
  return row?.quantity ?? null;
}

describe("0041 stone to ore", () => {
  const A = "player_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "player_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "player_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("moves stone 1:1 into ore, merges with existing ore, and never changes a player's total", () => {
    const db = new NodeD1Database(before);
    player(db, A);
    player(db, B);
    item(db, A, "item_stone", 120);
    item(db, A, "item_ore", 30);
    item(db, B, "item_stone", 40);
    // A full warehouse (1,000 of 1,000) still converts: the total does not grow.
    item(db, B, "item_wood", 960);
    db.sqlite.exec(stoneToOre);
    expect(held(db, A, "item_stone")).toBeNull();
    expect(held(db, A, "item_ore")).toBe(150);
    expect(held(db, B, "item_stone")).toBeNull();
    expect(held(db, B, "item_ore")).toBe(40);
    expect(held(db, B, "item_wood")).toBe(960);
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'migration_0041_stone'").get()).toBeUndefined();
  });

  it("leaves a player already over capacity untouched instead of aborting the migration", () => {
    const db = new NodeD1Database(before);
    player(db, C);
    db.sqlite.exec("DROP TRIGGER warehouse_capacity_guard_insert");
    item(db, C, "item_stone", 500);
    item(db, C, "item_wood", 900);
    db.sqlite.exec(read(files.find((name) => name.startsWith("0018")) ?? "").match(/CREATE TRIGGER warehouse_capacity_guard_insert[\s\S]*?END;/u)?.[0] ?? "");
    expect(() => { db.sqlite.exec(stoneToOre); }).not.toThrow();
    expect(held(db, C, "item_stone")).toBe(500);
    expect(held(db, C, "item_ore")).toBeNull();
  });
});
