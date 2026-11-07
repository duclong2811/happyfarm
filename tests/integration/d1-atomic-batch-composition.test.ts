import { describe, expect, it } from "vitest";
import { executeD1AtomicBatch, requiredSingleStatement } from "../../workers/api/src/d1-atomic-batch";
import { executeD1AtomicAutoPlant } from "../../workers/api/src/d1-atomic-batch";
import { D1AutoTravelRepository } from "../../workers/api/src/d1-repositories";
import { autoTransitionId, assertTrustedAutoEventTime } from "@happy-farm/application";
import type { ActorId, PlayerId } from "@happy-farm/domain";
import { NodeD1Database } from "../support/node-d1";

const schema = `
  CREATE TABLE state (id TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE receipts (id TEXT PRIMARY KEY, marker TEXT NOT NULL);
`;

function values(db: NodeD1Database): { state: number; receipts: number } {
  const state = db.sqlite.prepare("SELECT COALESCE(SUM(value), 0) AS value FROM state").get() as { value: number };
  const receipts = db.sqlite.prepare("SELECT COUNT(*) AS count FROM receipts").get() as { count: number };
  return {
    state: state.value,
    receipts: receipts.count
  };
}

describe("D1 atomic batch composition", () => {
  it("composes prepared components and deterministically slices each result range", async () => {
    const db = new NodeD1Database(schema);
    try {
      const first = requiredSingleStatement(
        db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("first", 2),
        (result) => result.meta.changes
      );
      const second = {
        statements: [
          db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("second", 3),
          db.prepare("INSERT INTO receipts (id, marker) VALUES (?, ?)").bind("receipt", "second")
        ],
        verify: (results: readonly { readonly success: boolean }[]) => results.map((result) => result.success)
      };

      await expect(executeD1AtomicBatch(db, [first, second])).resolves.toEqual([1, [true, true]]);
      expect(values(db)).toEqual({ state: 5, receipts: 1 });
    } finally {
      db.close();
    }
  });

  it("rolls back an earlier mutation when Plant-like work fails afterward", async () => {
    const db = new NodeD1Database(schema);
    try {
      const plant = { statements: [db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("plant", 1)], verify: () => undefined };
      const failingComponent = {
        statements: [db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("plant", 99)],
        verify: () => undefined
      };
      await expect(executeD1AtomicBatch(db, [plant, failingComponent])).rejects.toThrow();
      expect(values(db)).toEqual({ state: 0, receipts: 0 });
    } finally {
      db.close();
    }
  });

  it("rolls back Plant when a later component fails", async () => {
    const db = new NodeD1Database(schema);
    try {
      const plant = { statements: [db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("plant", 1)], verify: () => undefined };
      const later = {
        statements: [
          db.prepare("INSERT INTO receipts (id, marker) VALUES (?, ?)").bind("later", "before-failure"),
          db.prepare("INSERT INTO receipts (id, marker) VALUES (?, ?)").bind("later", "failure")
        ],
        verify: () => undefined
      };
      await expect(executeD1AtomicBatch(db, [plant, later])).rejects.toThrow();
      expect(values(db)).toEqual({ state: 0, receipts: 0 });
    } finally {
      db.close();
    }
  });

  it("proves a zero-row UPDATE commits, so post-batch changes inspection is not a guard", async () => {
    const db = new NodeD1Database(schema);
    try {
      const result = await db.batch([
        db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("mutation", 7),
        db.prepare("UPDATE state SET value = value + 1 WHERE id = ?").bind("missing")
      ]);
      expect(result[1]?.meta.changes).toBe(0);
      expect(values(db)).toEqual({ state: 7, receipts: 0 });
    } finally {
      db.close();
    }
  });

  it("uses a SQL-level stale guard and rolls back mutations on both sides of it", async () => {
    const db = new NodeD1Database(schema);
    try {
      const staleGuard = db
        .prepare("INSERT INTO receipts (id, marker) VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM state WHERE id = ? AND value = ?) THEN ? ELSE NULL END)")
        .bind("guard", "expected", 999, "accepted");
      const plant = db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("plant", 1);
      await expect(
        executeD1AtomicBatch(db, [
          { statements: [plant], verify: () => undefined },
          requiredSingleStatement(staleGuard, (result) => {
            if (result.meta.changes !== 1) throw new Error("stale guard rejected");
            return undefined;
          })
        ])
      ).rejects.toThrow();
      expect(values(db)).toEqual({ state: 0, receipts: 0 });
    } finally {
      db.close();
    }
  });
});

describe("B0.1 Auto Plant boundary", () => {
  const autoSchema = `
    CREATE TABLE state (id TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE actors (id TEXT PRIMARY KEY, owner_player_id TEXT NOT NULL, control_mode TEXT NOT NULL, cargo_transfer_id TEXT);
    CREATE TABLE actor_auto_state (actor_id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL, simulation_at TEXT);
    CREATE TABLE actor_cargo_items (actor_id TEXT, item_definition_id TEXT, quantity INTEGER, version INTEGER, PRIMARY KEY (actor_id, item_definition_id));
    CREATE TABLE crop_instances (id TEXT PRIMARY KEY, farm_id TEXT, version INTEGER);
    CREATE TABLE idempotency_keys (actor_player_id TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL PRIMARY KEY, payload_fingerprint TEXT NOT NULL, status TEXT NOT NULL, resource_id TEXT, response_json TEXT, created_at TEXT NOT NULL);
  `;

  it("commits Plant, Auto advancement, simulation watermark, and semantic receipt together", async () => {
    const db = new NodeD1Database(autoSchema);
    try {
      const actorId = "actor-1" as ActorId;
      const playerId = "player-1" as PlayerId;
      db.sqlite.prepare("INSERT INTO actors VALUES (?, ?, 'AUTO_CONTROLLED', NULL)").run(actorId, playerId);
      db.sqlite.prepare("INSERT INTO actor_auto_state VALUES (?, 4, ?, ?)").run(actorId, "2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z");
      db.sqlite.prepare("INSERT INTO actor_cargo_items VALUES (?, 'item_carrot_seed', 2, 1)").run(actorId);
      const eventTime = "2026-10-05T00:01:00.000Z";
      const transitionId = autoTransitionId({ actorId, assignmentId: "job-1", kind: "PLANT", x: 2, y: 3, eventTime });
      const auto = new D1AutoTravelRepository(db).prepareAutoPlantGuardAndAdvance({
        actorId, actorPlayerId: playerId, expectedVersion: 4, nextVersion: 5,
        expectedSimulationAt: "2026-10-05T00:00:00.000Z", eventTime,
        updatedAt: eventTime, transitionId, payloadFingerprint: "x".repeat(64), responseJson: "{}"
        ,cropId: "crop-1", cropFarmId: "farm-1", cropVersion: 1, itemDefinitionId: "item_carrot_seed", expectedCargoVersion: 1, seedAfterQuantity: 1
      });
      const plant = { statements: [
        db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("crop", 1),
        db.prepare("INSERT INTO crop_instances VALUES (?, ?, ?)").bind("crop-1", "farm-1", 1),
        db.prepare("UPDATE actors SET cargo_transfer_id = ? WHERE id = ?").bind(transitionId, actorId),
        db.prepare("UPDATE actor_cargo_items SET quantity = 1, version = 2 WHERE actor_id = ? AND item_definition_id = ? AND quantity = 2 AND version = 1").bind(actorId, "item_carrot_seed")
      ], verify: () => { return undefined; } };
      assertTrustedAutoEventTime({ eventTime, serverNow: "2026-10-05T00:02:00.000Z", simulationAt: "2026-10-05T00:00:00.000Z" });
      await executeD1AtomicAutoPlant(db, plant, auto);
      expect(db.sqlite.prepare("SELECT version, simulation_at FROM actor_auto_state").get()).toEqual({ version: 5, simulation_at: eventTime });
      expect(db.sqlite.prepare("SELECT request_id FROM idempotency_keys").get()).toEqual({ request_id: transitionId });
      expect(db.sqlite.prepare("SELECT SUM(value) AS value FROM state").get()).toEqual({ value: 1 });
    } finally { db.close(); }
  });

  it("rolls Plant back when Auto state is stale and rejects invalid event time", async () => {
    const db = new NodeD1Database(autoSchema);
    try {
      const actorId = "actor-1" as ActorId;
      const playerId = "player-1" as PlayerId;
      db.sqlite.prepare("INSERT INTO actors VALUES (?, ?, 'AUTO_CONTROLLED', NULL)").run(actorId, playerId);
      db.sqlite.prepare("INSERT INTO actor_auto_state VALUES (?, 9, ?, ?)").run(actorId, "2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z");
      db.sqlite.prepare("INSERT INTO actor_cargo_items VALUES (?, 'item_carrot_seed', 2, 1)").run(actorId);
      const auto = new D1AutoTravelRepository(db).prepareAutoPlantGuardAndAdvance({
        actorId, actorPlayerId: playerId, expectedVersion: 4, nextVersion: 5,
        expectedSimulationAt: "2026-10-05T00:00:00.000Z", eventTime: "2026-10-05T00:01:00.000Z",
        updatedAt: "2026-10-05T00:01:00.000Z", transitionId: "auto-stale-transition", payloadFingerprint: "x".repeat(64), responseJson: "{}"
        ,cropId: "crop-1", cropFarmId: "farm-1", cropVersion: 1, itemDefinitionId: "item_carrot_seed", expectedCargoVersion: 1, seedAfterQuantity: 1
      });
      const plant = { statements: [
        db.prepare("INSERT INTO state (id, value) VALUES (?, ?)").bind("crop", 1),
        db.prepare("INSERT INTO crop_instances VALUES (?, ?, ?)").bind("crop-1", "farm-1", 1),
        db.prepare("UPDATE actors SET cargo_transfer_id = ? WHERE id = ?").bind("auto-stale-transition", actorId),
        db.prepare("UPDATE actor_cargo_items SET quantity = 1, version = 2 WHERE actor_id = ? AND item_definition_id = ? AND quantity = 2 AND version = 1").bind(actorId, "item_carrot_seed")
      ], verify: () => { return undefined; } };
      await expect(executeD1AtomicAutoPlant(db, plant, auto)).rejects.toThrow();
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM state").get()).toEqual({ count: 0 });
      expect(db.sqlite.prepare("SELECT version FROM actor_auto_state").get()).toEqual({ version: 9 });
      expect(() => { assertTrustedAutoEventTime({ eventTime: "2026-10-05T00:03:00.000Z", serverNow: "2026-10-05T00:02:00.000Z", simulationAt: null }); }).toThrow();
      expect(() => { assertTrustedAutoEventTime({ eventTime: "2026-10-04T23:59:00.000Z", serverNow: "2026-10-05T00:02:00.000Z", simulationAt: "2026-10-05T00:00:00.000Z" }); }).toThrow();
    } finally { db.close(); }
  });
});
