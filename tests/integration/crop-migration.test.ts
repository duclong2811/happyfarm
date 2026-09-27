import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { parseCropInstanceId } from "@happy-farm/domain";
import { CROP_ONE_ID, FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

describe("crop simulation migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject', 'Player', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'SOIL', 'IDLE', 1, ?)"
      )
      .run(FARM_ONE_ID, NOW);
  });

  afterEach(() => {
    db.close();
  });

  function insertCrop(id = CROP_ONE_ID, x = 0, version = 1): void {
    db.sqlite
      .prepare(
        "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, ?, 0, 'crop_carrot', ?, ?, ?, ?, ?)"
      )
      .run(id, FARM_ONE_ID, x, PLAYER_ONE_ID, NOW, version, NOW, NOW);
  }

  it("preserves migration 0001 and enforces crop occupancy uniqueness", () => {
    insertCrop();
    expect(() => {
      insertCrop(parseCropInstanceId("cropinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));
    }).toThrow();
  });

  it("enforces crop foreign keys, coordinates, and versions", () => {
    expect(() => {
      insertCrop(CROP_ONE_ID, 1);
    }).toThrow();
    expect(() => {
      insertCrop(CROP_ONE_ID, 0, 0);
    }).toThrow();
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, created_at, updated_at) VALUES (?, 'farm_ffffffff-ffff-4fff-8fff-ffffffffffff', 0, 0, 'crop_carrot', ?, ?, ?, ?)"
        )
        .run(CROP_ONE_ID, PLAYER_ONE_ID, NOW, NOW, NOW)
    ).toThrow();
  });

  it("scopes idempotency uniqueness by actor, operation, and request ID", () => {
    insertCrop();
    const insert = () =>
      db.sqlite
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'PLANT_CROP', 'request_001', ?, 'COMPLETED', ?, '{}', ?)"
        )
        .run(PLAYER_ONE_ID, "a".repeat(64), CROP_ONE_ID, NOW);
    insert();
    expect(insert).toThrow();
  });

  it("rejects a completed plant record without its actor-owned crop", () => {
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, 'PLANT_CROP', 'request_001', ?, 'COMPLETED', ?, '{}', ?)"
        )
        .run(PLAYER_ONE_ID, "a".repeat(64), CROP_ONE_ID, NOW)
    ).toThrow();
  });
});
