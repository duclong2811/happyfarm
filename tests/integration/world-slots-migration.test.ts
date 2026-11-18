import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIslandGround, findSeaSlot } from "@happy-farm/game-data";
import { NodeD1Database } from "../support/node-d1";

/**
 * Migration 0045: farms that already have a chosen island take a place on the world map, round the
 * four regions in creation order, and every place it writes is a slot the chart has.
 */

const DIRECTORY = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".sql")).sort();
const read = (name: string): string => readFileSync(`${DIRECTORY}${name}`, "utf8");
const before = files.filter((name) => name < "0045").map(read).join("\n");
const worldSlots = read("0045_world_slots.sql");

function farmWithIsland(db: NodeD1Database, n: number, createdAt: string, island: boolean): void {
  const player = `player_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const farm = `farm_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  db.sqlite.prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'P', 'ACTIVE', ?, ?)").run(player, player, createdAt, createdAt);
  db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(farm, player, createdAt, createdAt);
  if (!island) return;
  const ground = buildIslandGround({ element: "THO", outline: "ROUND", seed: n });
  db.sqlite
    .prepare("INSERT INTO farm_islands (farm_id, element, outline, seed, generator_version, grid_size, origin_x, origin_y, cells, sites_json, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
    .run(farm, ground.element, ground.outline, ground.seed, ground.generatorVersion, ground.size, ground.originX, ground.originY, ground.cells, JSON.stringify(ground.sites), createdAt);
}

describe("0045 world slots", () => {
  it("places existing island farms round the regions in creation order, and only island farms", () => {
    const db = new NodeD1Database(before);
    farmWithIsland(db, 1, "2026-11-01T00:00:00.000Z", true);
    farmWithIsland(db, 2, "2026-11-02T00:00:00.000Z", true);
    farmWithIsland(db, 3, "2026-11-02T12:00:00.000Z", false);
    farmWithIsland(db, 4, "2026-11-03T00:00:00.000Z", true);
    farmWithIsland(db, 5, "2026-11-04T00:00:00.000Z", true);
    farmWithIsland(db, 6, "2026-11-05T00:00:00.000Z", true);
    db.sqlite.exec(worldSlots);
    const rows = db.sqlite.prepare("SELECT slot_id, region, farm_id FROM world_slots ORDER BY claimed_at").all() as { slot_id: string; region: string; farm_id: string }[];
    expect(rows.map((row) => row.slot_id)).toEqual(["slot_north_1_1", "slot_east_1_1", "slot_south_1_1", "slot_west_1_1", "slot_north_1_2"]);
    expect(rows.some((row) => row.farm_id.endsWith("000000000003"))).toBe(false);
    for (const row of rows) expect(findSeaSlot(row.slot_id)?.region, row.slot_id).toBe(row.region);
    // Re-running changes nothing.
    db.sqlite.exec(worldSlots);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM world_slots").get()).toEqual({ n: 5 });
  });

  it("holds one farm per slot and one slot per farm", () => {
    const db = new NodeD1Database(before + "\n" + worldSlots);
    farmWithIsland(db, 1, "2026-11-01T00:00:00.000Z", true);
    farmWithIsland(db, 2, "2026-11-02T00:00:00.000Z", true);
    const insert = db.sqlite.prepare("INSERT INTO world_slots (slot_id, region, farm_id, claimed_at) VALUES (?, ?, ?, ?)");
    insert.run("slot_north_1_1", "NORTH", "farm_00000000-0000-4000-8000-000000000001", "2026-11-06T00:00:00.000Z");
    expect(() => insert.run("slot_north_1_1", "NORTH", "farm_00000000-0000-4000-8000-000000000002", "2026-11-06T00:00:00.000Z")).toThrow();
    expect(() => insert.run("slot_north_1_2", "NORTH", "farm_00000000-0000-4000-8000-000000000001", "2026-11-06T00:00:00.000Z")).toThrow();
    expect(() => insert.run("slot_centre_1_1", "CENTRE", "farm_00000000-0000-4000-8000-000000000002", "2026-11-06T00:00:00.000Z")).toThrow();
  });
});
