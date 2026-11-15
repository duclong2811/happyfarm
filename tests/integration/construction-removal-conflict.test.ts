import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationError, type IdempotencyRecord } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  type EconomyMutation
} from "@happy-farm/domain";
import { D1ConstructionRepository } from "../../workers/api/src/d1-repositories";
import { schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * Removing an object whose version moved between the read and the write.
 *
 * The delete is guarded by the version the caller read, and the receipt is written only if the object
 * is gone (and, with a refund, the refund is in the ledger) - otherwise its actor is NULL. The receipt
 * trigger `idempotency_construction_remove_requires_effect` fires before the NOT NULL check, so its
 * message is what surfaces; either way the refusal must read as a conflict and leave nothing behind.
 */

const CONSTRUCTION_ID = parseConstructionId("construct_cccccccc-cccc-4ccc-8ccc-000000000001");
const REFUND_ID = "econ_eeeeeeee-eeee-4eee-8eee-000000000001";

function receipt(requestId: string, resourceId: string): IdempotencyRecord {
  return {
    actorPlayerId: PLAYER_ONE_ID,
    operation: "REMOVE_CONSTRUCTION",
    requestId,
    payloadFingerprint: "f".repeat(64),
    resourceId,
    responseJson: "{}",
    status: "COMPLETED",
    createdAt: NOW
  };
}

function refund(requestId: string): EconomyMutation {
  return {
    transactionId: parseEconomyTransactionId(REFUND_ID),
    playerId: PLAYER_ONE_ID,
    currencyDefinitionId: parseCurrencyDefinitionId("currency_gold"),
    delta: 450,
    balanceBefore: 1000,
    balanceAfter: 1450,
    expectedWalletVersion: 1,
    reason: "CONSTRUCTION_REFUND",
    referenceType: "CONSTRUCTION",
    referenceId: CONSTRUCTION_ID,
    requestId,
    createdAt: NOW
  };
}

describe("construction removal against a version that has moved", () => {
  let db: NodeD1Database;
  let constructions: D1ConstructionRepository;

  beforeEach(() => {
    db = new NodeD1Database(schemaSql());
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'builder', 'Builder', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, 'Farm', ?, ?)").run(FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    db.sqlite.prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, 0, 0, 'GRASS', 'IDLE', 1, ?)").run(FARM_ONE_ID, NOW);
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, 'build_barn', 'building', 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 'ACTIVE', ?, 'PLAYER_PLACED', NULL, 900, 900, 'currency_gold', ?, ?, NULL, 1)"
      )
      .run(CONSTRUCTION_ID, FARM_ONE_ID, PLAYER_ONE_ID, NOW, NOW);
    constructions = new D1ConstructionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function snapshot(): unknown {
    return {
      construction: db.sqlite.prepare("SELECT id, rotation, version FROM farm_constructions").all(),
      wallet: db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID),
      ledger: db.sqlite.prepare("SELECT id FROM economy_ledger").all(),
      receipts: db.sqlite.prepare("SELECT request_id FROM idempotency_keys").all()
    };
  }

  /** Someone else turned the object after it was read: the version the caller holds is stale. */
  function moveConcurrently(): void {
    db.sqlite.prepare("UPDATE farm_constructions SET rotation = 1, version = version + 1 WHERE id = ?").run(CONSTRUCTION_ID);
  }

  it("removes the object, with its refund, at the version it read", async () => {
    await constructions.removeAtomically(
      { farmId: FARM_ONE_ID, constructionId: CONSTRUCTION_ID, expectedVersion: 1, refund: refund("request-remove-0001") },
      receipt("request-remove-0001", REFUND_ID)
    );
    expect(snapshot()).toEqual({
      construction: [],
      wallet: { balance: 1450, version: 2 },
      ledger: [{ id: REFUND_ID }],
      receipts: [{ request_id: "request-remove-0001" }]
    });
  });

  it("refuses a refunded removal as an economy conflict, and pays nothing", async () => {
    moveConcurrently();
    const before = snapshot();
    const attempt = constructions.removeAtomically(
      { farmId: FARM_ONE_ID, constructionId: CONSTRUCTION_ID, expectedVersion: 1, refund: refund("request-remove-0002") },
      receipt("request-remove-0002", REFUND_ID)
    );
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT");
    expect(snapshot()).toEqual(before);
    expect(before).toMatchObject({ construction: [{ id: CONSTRUCTION_ID, rotation: 1, version: 2 }], wallet: { balance: 1000, version: 1 } });
  });

  it("refuses an unrefunded removal as an economy conflict, and removes nothing", async () => {
    moveConcurrently();
    const before = snapshot();
    const attempt = constructions.removeAtomically(
      { farmId: FARM_ONE_ID, constructionId: CONSTRUCTION_ID, expectedVersion: 1, refund: null },
      receipt("request-remove-0003", CONSTRUCTION_ID)
    );
    await expect(attempt).rejects.toSatisfy((error: unknown) => error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT");
    expect(snapshot()).toEqual(before);
  });
});
