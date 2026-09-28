import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProgression, type IdempotencyRecord } from "@happy-farm/application";
import {
  createCropInstance,
  createXpAward,
  parseCropDefinitionId,
  parseItemDefinitionId,
  type CropInstanceId,
  type InventoryAddition
} from "@happy-farm/domain";
import { D1HarvestSettlementRepository, D1ProgressionRepository } from "../../workers/api/src/d1-repositories";
import { gameDataProgressionDefinition } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { CROP_ONE_ID, CROP_TWO_ID, FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

const migration = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0005_player_progression.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

function row(db: NodeD1Database): unknown {
  return db.sqlite
    .prepare("SELECT xp, level, progression_version FROM player_progression WHERE player_id = ?")
    .get(PLAYER_ONE_ID);
}

describe("player_progression migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-one', 'Player', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-two', 'Other', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("creates no row at all for a player that has never earned experience", () => {
    expect(row(db)).toBeUndefined();
  });

  it("refuses a progression row for a player that does not exist", async () => {
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES ('player_99999999-9999-4999-8999-999999999999', 1, 0, 1, ?, ?)"
        )
        .run(NOW, NOW)
    ).toThrow(/FOREIGN KEY/i);
    await expect(new D1ProgressionRepository(db).find(PLAYER_ONE_ID)).resolves.toBeNull();
  });

  it("refuses experience, level, and version values outside the documented bounds", () => {
    const insert = db.sqlite.prepare(
      "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    expect(() => insert.run(PLAYER_ONE_ID, 1, -1, 1, NOW, NOW)).toThrow(/CHECK/i);
    expect(() => insert.run(PLAYER_ONE_ID, 0, 0, 1, NOW, NOW)).toThrow(/CHECK/i);
    expect(() => insert.run(PLAYER_ONE_ID, 1, 0, 0, NOW, NOW)).toThrow(/CHECK/i);
  });

  it("refuses to move experience, level, or the version backwards", () => {
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 2, 120, 3, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    const update = db.sqlite.prepare(
      "UPDATE player_progression SET level = ?, xp = ?, progression_version = ?, updated_at = ? WHERE player_id = ?"
    );
    expect(() => update.run(2, 119, 4, NOW, PLAYER_ONE_ID)).toThrow(/regress/i);
    expect(() => update.run(1, 120, 4, NOW, PLAYER_ONE_ID)).toThrow(/regress/i);
    expect(() => update.run(2, 120, 3, NOW, PLAYER_ONE_ID)).toThrow(/regress/i);
    // A legitimate award still applies.
    update.run(3, 360, 4, NOW, PLAYER_ONE_ID);
    expect(row(db)).toMatchObject({ xp: 360, level: 3, progression_version: 4 });
  });

  it("keeps a player's progression while the player exists, and blocks deleting the owner", () => {
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 4, 2, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    expect(() => db.sqlite.prepare("DELETE FROM players WHERE id = ?").run(PLAYER_ONE_ID)).toThrow(
      /FOREIGN KEY/i
    );
  });
});

describe("harvest settlement experience guard", () => {
  let db: NodeD1Database;
  let settlement: D1HarvestSettlementRepository;
  const addition: InventoryAddition = {
    kind: "ADD",
    playerId: PLAYER_ONE_ID,
    itemDefinitionId: parseItemDefinitionId("item_carrot"),
    quantity: 2,
    maxQuantity: 100,
    timestamp: NOW
  };

  function record(requestId: string, resourceId: CropInstanceId): IdempotencyRecord {
    return {
      actorPlayerId: PLAYER_ONE_ID,
      operation: "HARVEST_CROP",
      requestId,
      payloadFingerprint: "a".repeat(64),
      resourceId,
      responseJson: JSON.stringify({ harvest: {}, progression: {} }),
      status: "COMPLETED",
      createdAt: NOW
    };
  }

  function crop(id: CropInstanceId, x: number) {
    return createCropInstance(
      id,
      FARM_ONE_ID,
      x,
      0,
      parseCropDefinitionId("crop_carrot"),
      PLAYER_ONE_ID,
      NOW
    );
  }

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-one', 'Player', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
      .run(FARM_ONE_ID, PLAYER_ONE_ID, NOW);
    for (const [id, x] of [
      [CROP_ONE_ID, 0],
      [CROP_TWO_ID, 1]
    ] as const) {
      db.sqlite
        .prepare(
          "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, 0, 'SOIL', 'IDLE', 1, ?)"
        )
        .run(FARM_ONE_ID, x, NOW);
      db.sqlite
        .prepare(
          "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) VALUES (?, ?, ?, 0, 'crop_carrot', ?, ?, 1, ?, ?)"
        )
        .run(id, FARM_ONE_ID, x, PLAYER_ONE_ID, NOW, NOW, NOW);
    }
    settlement = new D1HarvestSettlementRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates the row on the first award and advances the version", async () => {
    const award = createXpAward(
      gameDataProgressionDefinition,
      emptyProgression(PLAYER_ONE_ID, NOW),
      4,
      NOW
    );
    await settlement.settleHarvestAtomically(
      crop(CROP_ONE_ID, 0),
      addition,
      award,
      record("harvest_request_001", CROP_ONE_ID)
    );
    expect(row(db)).toMatchObject({ xp: 4, level: 1, progression_version: 2 });
  });

  it("rejects an award computed from a state that has already moved on", async () => {
    const stale = createXpAward(
      gameDataProgressionDefinition,
      emptyProgression(PLAYER_ONE_ID, NOW),
      4,
      NOW
    );
    await settlement.settleHarvestAtomically(
      crop(CROP_ONE_ID, 0),
      addition,
      stale,
      record("harvest_request_001", CROP_ONE_ID)
    );
    // A second harvest that read progression before the first one landed must not overwrite it.
    await expect(
      settlement.settleHarvestAtomically(
        crop(CROP_TWO_ID, 1),
        addition,
        stale,
        record("harvest_request_002", CROP_TWO_ID)
      )
    ).rejects.toMatchObject({ code: "PROGRESSION_CONFLICT" });
    expect(row(db)).toMatchObject({ xp: 4, level: 1, progression_version: 2 });
    // The rejected batch rolled back in full, harvest row included.
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM harvest_settlements").get()
    ).toMatchObject({ count: 1 });

    // Re-reading and recomputing is what the use case does on the retry.
    const fresh = createXpAward(
      gameDataProgressionDefinition,
      { ...emptyProgression(PLAYER_ONE_ID, NOW), xp: 4, level: 1, progressionVersion: 2 },
      4,
      NOW
    );
    await settlement.settleHarvestAtomically(
      crop(CROP_TWO_ID, 1),
      addition,
      fresh,
      record("harvest_request_003", CROP_TWO_ID)
    );
    expect(row(db)).toMatchObject({ xp: 8, level: 1, progression_version: 3 });
  });

  it("refuses a stale award that would settle a larger reward onto an older revision", async () => {
    const first = createXpAward(
      gameDataProgressionDefinition,
      emptyProgression(PLAYER_ONE_ID, NOW),
      4,
      NOW
    );
    await settlement.settleHarvestAtomically(
      crop(CROP_ONE_ID, 0),
      addition,
      first,
      record("harvest_request_001", CROP_ONE_ID)
    );
    expect(row(db)).toMatchObject({ xp: 4, level: 1, progression_version: 2 });

    // Experience is a running total, not a high-water mark, so a stale caller whose own reward is
    // larger than the one that landed must still be rejected: accepting it would quietly swallow
    // the four points the first harvest earned.
    const wider = createXpAward(
      gameDataProgressionDefinition,
      emptyProgression(PLAYER_ONE_ID, NOW),
      24,
      NOW
    );
    await expect(
      settlement.settleHarvestAtomically(
        crop(CROP_TWO_ID, 1),
        addition,
        wider,
        record("harvest_request_002", CROP_TWO_ID)
      )
    ).rejects.toMatchObject({ code: "PROGRESSION_CONFLICT" });
    expect(row(db)).toMatchObject({ xp: 4, level: 1, progression_version: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM harvest_settlements").get()).toMatchObject({
      count: 1
    });
  });

  it("refuses a settlement whose parts belong to different players", async () => {
    const award = createXpAward(
      gameDataProgressionDefinition,
      emptyProgression(PLAYER_TWO_ID, NOW),
      4,
      NOW
    );
    await expect(
      settlement.settleHarvestAtomically(
        crop(CROP_ONE_ID, 0),
        addition,
        award,
        record("harvest_request_001", CROP_ONE_ID)
      )
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(row(db)).toBeUndefined();
  });
});
