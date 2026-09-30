import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

function readMigration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8");
}

/** Every migration the package migration can be applied on top of. */
const BEFORE = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql"
]
  .map(readMigration)
  .join("\n");

const STARTER_PACKAGE = readMigration("0009_starter_package.sql");

function seedPlayers(db: NodeD1Database): void {
  const insert = db.sqlite.prepare(
    "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', ?, 'Player', 'ACTIVE', ?, ?)"
  );
  insert.run(PLAYER_ONE_ID, "one", NOW, NOW);
  insert.run(PLAYER_TWO_ID, "two", NOW, NOW);
}

const PACKAGE_COLUMNS =
  "player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount, transaction_id, request_id, created_at";

function grant(
  db: NodeD1Database,
  options: {
    readonly player?: string;
    readonly key?: string;
    readonly seeds?: number;
    readonly gold?: number;
    readonly transactionId?: string | null;
    readonly requestId?: string | null;
  } = {}
): void {
  db.sqlite
    .prepare(
      `INSERT INTO starter_grants (${PACKAGE_COLUMNS}) VALUES (?, ?, 'item_carrot_seed', ?, 'currency_gold', ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    )
    .run(
      options.player ?? PLAYER_ONE_ID,
      options.key ?? "starter_package_v1",
      options.seeds ?? 10,
      options.gold ?? 100,
      options.transactionId === undefined
        ? transactionIdFor(options.player ?? PLAYER_ONE_ID)
        : options.transactionId,
      options.requestId === undefined ? `starter:${options.player ?? PLAYER_ONE_ID}` : options.requestId,
      NOW
    );
}

/** A distinct, well-formed ledger identity per player, so one grant cannot collide with another's. */
function transactionIdFor(player: string): string {
  const digit = /([0-9a-f])$/.exec(player)?.[1] ?? "0";
  return `econ_1111111${digit}-1111-4111-8111-11111111111${digit}`;
}

function seeds(db: NodeD1Database, player = PLAYER_ONE_ID): unknown {
  return db.sqlite
    .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = 'item_carrot_seed'")
    .get(player);
}

function gold(db: NodeD1Database, player = PLAYER_ONE_ID): unknown {
  return db.sqlite
    .prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'")
    .get(player);
}

describe("starter package migration", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(BEFORE);
    seedPlayers(db);
  });

  afterEach(() => {
    db.close();
  });

  it("replaces the seed-only receipt with one package receipt, carrying old rows forward", () => {
    db.sqlite
      .prepare("INSERT INTO starter_seed_grants (player_id, item_definition_id, quantity, created_at) VALUES (?, 'item_carrot_seed', 36, ?)")
      .run(PLAYER_ONE_ID, NOW);

    db.sqlite.exec(STARTER_PACKAGE);

    // The pre-package grant keeps its own key, its quantity, and the fact that it moved no currency:
    // its holder is not silently relabelled as someone who already received the package.
    expect(db.sqlite.prepare("SELECT * FROM starter_grants WHERE player_id = ?").all(PLAYER_ONE_ID)).toEqual([
      {
        player_id: PLAYER_ONE_ID,
        grant_key: "starter_seed_v1",
        item_definition_id: "item_carrot_seed",
        item_quantity: 36,
        currency_id: "currency_gold",
        gold_amount: 0,
        transaction_id: null,
        request_id: null,
        created_at: NOW
      }
    ]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 0 });
    // The 36 seeds that grant credited are still in the inventory: replacing the receipt table does
    // not touch a player's holdings, it only stops the old table from being the way they are granted.
    expect(seeds(db)).toEqual({ quantity: 36 });
    // `starter_seed_grants` is gone: there is one starter-reward mechanism, not two.
    expect(
      db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'starter_seed_grants'").get()
    ).toBeUndefined();
  });

  it("credits the seeds, the wallet, and one ledger row in the same statement as the receipt", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    grant(db);

    expect(seeds(db)).toEqual({ quantity: 10 });
    expect(gold(db)).toEqual({ balance: 100 });
    expect(
      db.sqlite
        .prepare("SELECT reason, reference_type, reference_id, delta, balance_before, balance_after FROM economy_ledger")
        .all()
    ).toEqual([
      {
        reason: "STARTER_GRANT",
        reference_type: "PLAYER",
        reference_id: PLAYER_ONE_ID,
        delta: 100,
        balance_before: 0,
        balance_after: 100
      }
    ]);
  });

  it("makes the grant one-time even when the same receipt is replayed", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    grant(db);
    grant(db);
    grant(db);
    expect(seeds(db)).toEqual({ quantity: 10 });
    expect(gold(db)).toEqual({ balance: 100 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 1 });
  });

  it("credits a player whose wallet already holds a balance, without resetting it", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 57, 4, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);

    grant(db);

    expect(gold(db)).toEqual({ balance: 157 });
    expect(
      db.sqlite.prepare("SELECT balance_before, balance_after, expected_wallet_version FROM economy_ledger").all()
    ).toEqual([{ balance_before: 57, balance_after: 157, expected_wallet_version: 4 }]);
    expect(db.sqlite.prepare("SELECT version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({ version: 5 });
  });

  it("refuses a receipt that would move currency without naming its ledger identity", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    expect(() => {
      grant(db, { transactionId: null });
    }).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 0 });
  });

  it("rolls the whole package back when its ledger row cannot be written", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    // A transaction ID that already belongs to somebody else is the one thing the ledger cannot
    // accept, so the receipt, the seeds, and the ledger row must all disappear together.
    const transactionId = "econ_22222222-2222-4222-8222-222222222222";
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 0, 1, ?, ?)")
      .run(PLAYER_TWO_ID, NOW, NOW);
    db.sqlite
      .prepare(
        "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, 'currency_gold', 5, 0, 5, 1, 'STARTER_GRANT', 'PLAYER', ?, 'starter:other:player', ?)"
      )
      .run(transactionId, PLAYER_TWO_ID, PLAYER_TWO_ID, NOW);

    expect(() => {
      grant(db, { transactionId });
    }).toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      count: 0
    });
    expect(seeds(db)).toBeUndefined();
    expect(gold(db)).toBeUndefined();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 1 });
  });

  it("repairs a player created before the package existed, one key at a time", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    // What the staging repair does: hand the package to a player who has no receipt for it.
    grant(db, { player: PLAYER_ONE_ID });
    grant(db, { player: PLAYER_TWO_ID });
    expect(seeds(db, PLAYER_TWO_ID)).toEqual({ quantity: 10 });
    expect(gold(db, PLAYER_TWO_ID)).toEqual({ balance: 100 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 2 });
  });

  it("keeps the ledger's reason and reference pairing closed", () => {
    db.sqlite.exec(STARTER_PACKAGE);
    expect(() => {
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_33333333-3333-4333-8333-333333333333', ?, 'currency_gold', 5, 0, 5, 1, 'STARTER_GRANT', 'SHOP_ENTRY', 'shop_carrot', 'starter:bad:row', ?)"
        )
        .run(PLAYER_ONE_ID, NOW);
    }).toThrow();
    expect(() => {
      db.sqlite
        .prepare(
          "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES ('econ_44444444-4444-4444-8444-444444444444', ?, 'currency_gold', 5, 0, 5, 1, 'STARTER_GRANT', 'PLAYER', 'plot_3', 'starter:bad:row', ?)"
        )
        .run(PLAYER_ONE_ID, NOW);
    }).toThrow();
  });
});
