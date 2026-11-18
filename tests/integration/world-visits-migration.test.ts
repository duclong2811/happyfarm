import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";

/**
 * Migration 0046: the places a player has visited on the world map, once each, only real slot ids,
 * and gone with the player.
 */

const DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".sql")).sort();
const all = files.filter((name) => name <= "0046_world_visits.sql").map((name) => readFileSync(`${DIRECTORY}${name}`, "utf8")).join("\n");
const PLAYER = "player_00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-20T00:00:00.000Z";

describe("0046 world visits", () => {
  it("keeps one row per player and place, accepts only slot ids, and follows the player", () => {
    const db = new NodeD1Database(all);
    db.sqlite.exec("PRAGMA foreign_keys = ON");
    db.sqlite
      .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'one', 'P', 'ACTIVE', ?, ?)")
      .run(PLAYER, NOW, NOW);
    const visit = db.sqlite.prepare("INSERT OR IGNORE INTO world_visits (player_id, slot_id, visited_at) VALUES (?, ?, ?)");
    visit.run(PLAYER, "slot_north_1_2", NOW);
    visit.run(PLAYER, "slot_north_1_2", "2026-11-21T00:00:00.000Z");
    expect(db.sqlite.prepare("SELECT slot_id, visited_at FROM world_visits").all()).toEqual([{ slot_id: "slot_north_1_2", visited_at: NOW }]);
    expect(() => db.sqlite.prepare("INSERT INTO world_visits (player_id, slot_id, visited_at) VALUES (?, 'north', ?)").run(PLAYER, NOW)).toThrow();
    expect(() =>
      db.sqlite.prepare("INSERT INTO world_visits (player_id, slot_id, visited_at) VALUES ('player_missing', 'slot_east_1_1', ?)").run(NOW)
    ).toThrow();
    db.close();
  });
});
