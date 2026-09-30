import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EconomyService,
  GrantStarterPackage,
  InventoryService,
  type Clock
} from "@happy-farm/application";
import { MAX_WALLET_BALANCE } from "@happy-farm/domain";
import { STARTER_GOLD_AMOUNT, STARTER_SEED_QUANTITY, starterPackage } from "@happy-farm/game-data";
import {
  D1EconomyLedgerRepository,
  D1StarterGrantRepository,
  D1WalletRepository
} from "../../workers/api/src/d1-repositories";
import {
  CryptoIdGenerator,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * The starter package, end to end over the real schema.
 *
 * The point of these tests is not that a function returns 100. It is that the number a brand-new
 * player sees is decided by the server, that it can never be obtained twice by any sequence of
 * refreshes, retries, reconnects, extra farms, replays, or races, and that a player who already owns
 * something keeps it.
 */
const MIGRATIONS = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql",
  "0009_starter_package.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const clock: Clock = { now: () => NOW };
const packageDefinition = {
  grantKey: starterPackage.grantKey,
  seedItemDefinitionId: starterPackage.seedItemDefinitionId,
  seedQuantity: starterPackage.seedQuantity,
  currencyDefinitionId: starterPackage.currencyDefinitionId,
  goldAmount: starterPackage.goldAmount
};

function seedPlayer(db: NodeD1Database, id: string, subject: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', ?, 'Player', 'ACTIVE', ?, ?)"
    )
    .run(id, subject, NOW, NOW);
}

describe("the one-time starter package", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    seedPlayer(db, PLAYER_ONE_ID, "subject-one");
    seedPlayer(db, PLAYER_TWO_ID, "subject-two");
  });

  afterEach(() => {
    db.close();
  });

  function service(): GrantStarterPackage {
    const ids = new CryptoIdGenerator();
    return new GrantStarterPackage(
      new D1StarterGrantRepository(db),
      new InventoryService(new GameDataItemDefinitions(), clock),
      new EconomyService(ids, clock),
      new GameDataCurrencyDefinitions(),
      new D1WalletRepository(db),
      clock,
      packageDefinition
    );
  }

  function seeds(player = PLAYER_ONE_ID): unknown {
    return db.sqlite
      .prepare("SELECT quantity, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(player, starterPackage.seedItemDefinitionId);
  }

  function gold(player = PLAYER_ONE_ID): unknown {
    return db.sqlite
      .prepare("SELECT balance, version FROM wallets WHERE player_id = ? AND currency_id = ?")
      .get(player, starterPackage.currencyDefinitionId);
  }

  function receiptCount(player = PLAYER_ONE_ID): unknown {
    return db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants WHERE player_id = ?").get(player);
  }

  function ledgerRows(player = PLAYER_ONE_ID): readonly { reason: string; reference_type: string; delta: number; balance_before: number; balance_after: number }[] {
    return db.sqlite
      .prepare(
        "SELECT reason, reference_type, delta, balance_before, balance_after FROM economy_ledger WHERE player_id = ? ORDER BY created_at"
      )
      .all(player) as unknown as readonly { reason: string; reference_type: string; delta: number; balance_before: number; balance_after: number }[];
  }

  it("gives a brand-new player exactly 100 gold and 10 carrot seeds", async () => {
    await expect(service().execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
      grantKey: "starter_package_v1",
      seedItemDefinitionId: "item_carrot_seed",
      seedQuantity: 10,
      currencyDefinitionId: "currency_gold",
      goldAmount: 100,
      granted: true
    });
    expect(STARTER_SEED_QUANTITY).toBe(10);
    expect(STARTER_GOLD_AMOUNT).toBe(100);
    expect(seeds()).toEqual({ quantity: 10, version: 1 });
    expect(gold()).toEqual({ balance: 100, version: 2 });
  });

  it("starts the player with nothing else: no wheat, corn, or sapling", async () => {
    await service().execute({ playerId: PLAYER_ONE_ID });
    const items = db.sqlite
      .prepare("SELECT item_definition_id, quantity FROM inventory_items WHERE player_id = ? ORDER BY item_definition_id")
      .all(PLAYER_ONE_ID);
    expect(items).toEqual([{ item_definition_id: "item_carrot_seed", quantity: 10 }]);
  });

  it("records the gold as an ordinary ledger row the economy can read back", async () => {
    await service().execute({ playerId: PLAYER_ONE_ID });
    expect(ledgerRows()).toEqual([
      { reason: "STARTER_GRANT", reference_type: "PLAYER", delta: 100, balance_before: 0, balance_after: 100 }
    ]);
    // The stored row must survive the domain readers, which is what makes it real history rather
    // than a row only this feature understands.
    const entries = await new D1EconomyLedgerRepository(db).listByPlayer(PLAYER_ONE_ID, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      playerId: PLAYER_ONE_ID,
      currencyDefinitionId: "currency_gold",
      reason: "STARTER_GRANT",
      referenceType: "PLAYER",
      referenceId: PLAYER_ONE_ID,
      delta: 100,
      balanceBefore: 0,
      balanceAfter: 100
    });
  });

  it("grants nothing more on a repeated pass, a second farm, a replay, or a retry", async () => {
    const grant = service();
    await grant.execute({ playerId: PLAYER_ONE_ID });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(grant.execute({ playerId: PLAYER_ONE_ID })).resolves.toMatchObject({ granted: false });
    }
    expect(seeds()).toEqual({ quantity: 10, version: 1 });
    expect(gold()).toEqual({ balance: 100, version: 2 });
    expect(receiptCount()).toEqual({ count: 1 });
    expect(ledgerRows()).toHaveLength(1);
  });

  it("keeps 100 gold and 10 seeds when concurrent passes race", async () => {
    const grant = service();
    const results = await Promise.all([
      grant.execute({ playerId: PLAYER_ONE_ID }),
      grant.execute({ playerId: PLAYER_ONE_ID }),
      grant.execute({ playerId: PLAYER_ONE_ID })
    ]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
    expect(seeds()).toEqual({ quantity: 10, version: 1 });
    expect(gold()).toEqual({ balance: 100, version: 2 });
    expect(receiptCount()).toEqual({ count: 1 });
  });

  it("scopes the package to the player, not to the farm or the session", async () => {
    await service().execute({ playerId: PLAYER_ONE_ID });
    await service().execute({ playerId: PLAYER_TWO_ID });
    expect(gold(PLAYER_TWO_ID)).toEqual({ balance: 100, version: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger").get()).toEqual({ count: 2 });
  });

  it("adds to existing player state instead of resetting it", async () => {
    // A player who already holds gold and seeds - from play, from a grant made before this package,
    // from anywhere - keeps every unit of it and receives the package on top, exactly once.
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 57, 4, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    db.sqlite
      .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, 'item_carrot_seed', 3, ?, 2)")
      .run(PLAYER_ONE_ID, NOW);

    await service().execute({ playerId: PLAYER_ONE_ID });

    expect(gold()).toEqual({ balance: 157, version: 5 });
    expect(seeds()).toEqual({ quantity: 13, version: 3 });
    expect(ledgerRows()).toEqual([
      { reason: "STARTER_GRANT", reference_type: "PLAYER", delta: 100, balance_before: 57, balance_after: 157 }
    ]);
    await service().execute({ playerId: PLAYER_ONE_ID });
    expect(gold()).toEqual({ balance: 157, version: 5 });
  });

  it("requires an authenticated actor and credits nothing without one", async () => {
    await expect(service().execute(null)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_items").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM wallets").get()).toEqual({ count: 0 });
  });

  it("refuses, and writes nothing, when the credit could not be represented", async () => {
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?)")
      .run(PLAYER_ONE_ID, MAX_WALLET_BALANCE, NOW, NOW);

    await expect(service().execute({ playerId: PLAYER_ONE_ID })).rejects.toMatchObject({
      code: "WALLET_LIMIT_EXCEEDED"
    });
    expect(receiptCount()).toEqual({ count: 0 });
    expect(seeds()).toBeUndefined();
    expect(ledgerRows()).toHaveLength(0);
  });

  it("files the receipt under the package key so one key can only ever be granted once", async () => {
    await service().execute({ playerId: PLAYER_ONE_ID });
    expect(
      db.sqlite.prepare("SELECT grant_key, item_quantity, gold_amount FROM starter_grants WHERE player_id = ?").all(PLAYER_ONE_ID)
    ).toEqual([{ grant_key: "starter_package_v1", item_quantity: 10, gold_amount: 100 }]);
    expect(() => {
      db.sqlite
        .prepare(
          "INSERT INTO starter_grants (player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount, transaction_id, request_id, created_at) VALUES (?, 'starter_package_v1', 'item_carrot_seed', 10, 'currency_gold', 100, 'econ_99999999-9999-4999-8999-999999999999', 'starter:duplicate:player', ?)"
        )
        .run(PLAYER_ONE_ID, NOW);
    }).toThrow();
    expect(gold()).toEqual({ balance: 100, version: 2 });
    expect(seeds()).toEqual({ quantity: 10, version: 1 });
  });
});
