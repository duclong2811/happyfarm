import type {
  CellBounds,
  ConstructionId,
  ConstructionInstance,
  Farm,
  FarmId,
  FarmMember,
  FarmRole,
  FarmTile,
  CropInstance,
  CropInstanceId,
  CurrencyDefinitionId,
  EconomyLedgerEntry,
  EconomyMutation,
  EconomyTransactionId,
  InventoryAddition,
  InventoryItem,
  InventoryMutation,
  InventoryRemoval,
  ItemDefinitionId,
  Player,
  PlayerId,
  PlayerProgression,
  PlayerStatus,
  TerrainType,
  TileState,
  TreeInstance,
  TreeInstanceId,
  QuarterTurns,
  XpAward,
  Wallet
} from "@happy-farm/domain";
import {
  parseConstructionId,
  parseCropDefinitionId,
  parseCropInstanceId,
  parseCurrencyDefinitionId,
  parseEconomyReferenceId,
  parseEconomyTransactionId,
  parseFarmId,
  parseItemDefinitionId,
  parsePlayerId,
  parseTreeInstanceId,
  parseTreeDefinitionId,
  PLOT_TILE_COUNT,
  PLOT_TILE_SIZE
} from "@happy-farm/domain";
import type {
  ConstructionPlacement,
  ConstructionRepository,
  ConstructionRelocation,
  ConstructionRemoval,
  ConstructionSeed,
  CropInstanceRepository,
  FarmExpansionRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  PlayerRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  HarvestSettlementRepository,
  InventoryRepository,
  EconomyLedgerRepository,
  EconomyMutationRepository,
  EconomySettlementRepository,
  ProgressionRepository,
  StarterGrant,
  StarterGrantRepository,
  TreeHarvestSettlementRepository,
  TreeInstanceRepository,
  WalletRepository
} from "@happy-farm/application";
import { ApplicationError } from "@happy-farm/application";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./d1-types";

interface PlayerRow {
  id: string;
  auth_issuer: string;
  auth_subject: string;
  display_name: string;
  status: PlayerStatus;
  created_at: string;
  updated_at: string;
}

interface FarmRow {
  id: string;
  owner_player_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  starter_world_version: number;
}

interface FarmMemberRow {
  farm_id: string;
  player_id: string;
  role: FarmRole;
  created_at: string;
}

interface FarmTileRow {
  farm_id: string;
  x: number;
  y: number;
  terrain_type: TerrainType;
  tile_state: TileState;
  version: number;
  updated_at: string;
}

interface CropInstanceRow {
  id: string;
  farm_id: string;
  tile_x: number;
  tile_y: number;
  crop_definition_id: string;
  planted_by_player_id: string;
  planted_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface IdempotencyRow {
  actor_player_id: string;
  operation: string;
  request_id: string;
  payload_fingerprint: string;
  resource_id: string;
  response_json: string;
  status: "COMPLETED";
  created_at: string;
}

interface InventoryItemRow {
  player_id: string;
  item_definition_id: string;
  quantity: number;
  updated_at: string;
  version: number;
}

interface WalletRow {
  player_id: string;
  currency_id: string;
  balance: number;
  version: number;
  updated_at: string;
}

interface EconomyLedgerRow {
  id: string;
  player_id: string;
  currency_id: string;
  delta: number;
  balance_before: number;
  balance_after: number;
  expected_wallet_version: number;
  reason: EconomyLedgerEntry["reason"];
  reference_type: EconomyLedgerEntry["referenceType"];
  reference_id: string;
  request_id: string;
  created_at: string;
}

function mapCrop(row: CropInstanceRow): CropInstance {
  return {
    id: parseCropInstanceId(row.id),
    farmId: parseFarmId(row.farm_id),
    tileX: row.tile_x,
    tileY: row.tile_y,
    cropDefinitionId: parseCropDefinitionId(row.crop_definition_id),
    plantedByPlayerId: parsePlayerId(row.planted_by_player_id),
    plantedAt: row.planted_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class D1PlayerRepository implements PlayerRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: PlayerId): Promise<Player | null> {
    const row = await this.db
      .prepare(
        "SELECT id, auth_issuer, auth_subject, display_name, status, created_at, updated_at FROM players WHERE id = ?"
      )
      .bind(id)
      .first<PlayerRow>();
    return row === null
      ? null
      : {
          id: parsePlayerId(row.id),
          authIssuer: row.auth_issuer,
          authSubject: row.auth_subject,
          displayName: row.display_name,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
  }
}

export class D1FarmRepository implements FarmRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async createWithOwner(
    farm: Farm,
    ownerMembership: FarmMember,
    initialTiles: readonly FarmTile[]
  ): Promise<void> {
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT INTO farms (id, owner_player_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(farm.id, farm.ownerPlayerId, farm.name, farm.createdAt, farm.updatedAt),
      this.db
        .prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, ?, ?)")
        .bind(
          ownerMembership.farmId,
          ownerMembership.playerId,
          ownerMembership.role,
          ownerMembership.createdAt
        ),
      ...initialTiles.map((tile) =>
        this.db
          .prepare(
            "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      )
    ];
    const results = await this.db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error("Atomic farm creation failed");
    }
  }

  async findById(id: FarmId): Promise<Farm | null> {
    const row = await this.db
      .prepare("SELECT id, owner_player_id, name, created_at, updated_at FROM farms WHERE id = ?")
      .bind(id)
      .first<FarmRow>();
    return row === null
      ? null
      : {
          id: parseFarmId(row.id),
          ownerPlayerId: parsePlayerId(row.owner_player_id),
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
  }

  /**
   * What seeding needs to know about a farm, and nothing else.
   *
   * Its own read rather than a field on `Farm`: the version is bookkeeping for the one pass that
   * seeds a farm, and every other use case would be carrying a number it never reads. A missing row
   * answers null, which the seeder treats as "nothing to seed".
   */
  async starterWorldState(farmId: FarmId): Promise<{ readonly ownerPlayerId: PlayerId; readonly version: number } | null> {
    const row = await this.db
      .prepare("SELECT owner_player_id, starter_world_version FROM farms WHERE id = ?")
      .bind(farmId)
      .first<{ owner_player_id: string; starter_world_version: number }>();
    return row === null
      ? null
      : { ownerPlayerId: parsePlayerId(row.owner_player_id), version: row.starter_world_version };
  }
}

export class D1FarmMemberRepository implements FarmMemberRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByFarmAndPlayer(farmId: FarmId, playerId: PlayerId): Promise<FarmMember | null> {
    const row = await this.db
      .prepare("SELECT farm_id, player_id, role, created_at FROM farm_members WHERE farm_id = ? AND player_id = ?")
      .bind(farmId, playerId)
      .first<FarmMemberRow>();
    return row === null
      ? null
      : {
          farmId: parseFarmId(row.farm_id),
          playerId: parsePlayerId(row.player_id),
          role: row.role,
          createdAt: row.created_at
        };
  }
}

function mapFarmTile(row: FarmTileRow): FarmTile {
  return {
    farmId: parseFarmId(row.farm_id),
    x: row.x,
    y: row.y,
    terrainType: row.terrain_type,
    state: row.tile_state,
    version: row.version,
    updatedAt: row.updated_at
  };
}

export class D1FarmTileRepository implements FarmTileRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async insert(tile: FarmTile): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      .run();
  }

  async find(farmId: FarmId, x: number, y: number): Promise<FarmTile | null> {
    const row = await this.db
      .prepare(
        "SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?"
      )
      .bind(farmId, x, y)
      .first<FarmTileRow>();
    return row === null ? null : mapFarmTile(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly FarmTile[]> {
    const result = await this.db
      .prepare(
        "SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at FROM farm_tiles WHERE farm_id = ? ORDER BY y, x"
      )
      .bind(farmId)
      .all<FarmTileRow>();
    return result.results.map(mapFarmTile);
  }

  async updateVersion(tile: FarmTile, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE farm_tiles SET tile_state = ?, version = version + 1, updated_at = ? WHERE farm_id = ? AND x = ? AND y = ? AND version = ?"
      )
      .bind(tile.state, tile.updatedAt, tile.farmId, tile.x, tile.y, expectedVersion)
      .run();
    return result.success && result.meta.changes === 1;
  }
}

export class D1CropRepository implements CropInstanceRepository, IdempotencyRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: CropInstanceId): Promise<CropInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE id = ?"
      )
      .bind(id)
      .first<CropInstanceRow>();
    return row === null ? null : mapCrop(row);
  }

  async findAtTile(farmId: FarmId, x: number, y: number): Promise<CropInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE farm_id = ? AND tile_x = ? AND tile_y = ?"
      )
      .bind(farmId, x, y)
      .first<CropInstanceRow>();
    return row === null ? null : mapCrop(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly CropInstance[]> {
    const result = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at FROM crop_instances WHERE farm_id = ? ORDER BY tile_y, tile_x"
      )
      .bind(farmId)
      .all<CropInstanceRow>();
    return result.results.map(mapCrop);
  }

  async find(actorPlayerId: PlayerId, operation: string, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = ? AND request_id = ?"
      )
      .bind(actorPlayerId, operation, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }

  async plantAtomically(
    crop: CropInstance,
    expectedTileVersion: number,
    seedRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (seedRemoval.playerId !== expectedInventory.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Seed removal ownership does not match");
    }
    const seedAfterQuantity = expectedInventory.quantity - seedRemoval.quantity;
    const seedAfterVersion = expectedInventory.version + 1;
    const results = await this.db.batch([
      // Spends the seed first, guarded on the exact quantity and version the caller read. SQLite
      // cannot fail an UPDATE that matches no rows, so a lost race shows up in the final idempotency
      // statement below, which is what actually aborts the batch.
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          seedRemoval.quantity,
          seedRemoval.timestamp,
          seedRemoval.playerId,
          seedRemoval.itemDefinitionId,
          expectedInventory.quantity,
          expectedInventory.version,
          seedRemoval.quantity
        ),
      this.db
        .prepare(
          "INSERT INTO crop_instances (id, farm_id, tile_x, tile_y, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ? AND version = ? AND terrain_type = 'SOIL' AND tile_state = 'IDLE'"
        )
        .bind(
          crop.id,
          crop.farmId,
          crop.tileX,
          crop.tileY,
          crop.cropDefinitionId,
          crop.plantedByPlayerId,
          crop.plantedAt,
          crop.version,
          crop.createdAt,
          crop.updatedAt,
          crop.farmId,
          crop.tileX,
          crop.tileY,
          expectedTileVersion
        ),
      // The receipt commits only when the crop row exists *and* the seed row is exactly where this
      // settlement left it. Either half missing aborts the whole batch, so a failure after the crop
      // insert cannot leave a planted crop that was never paid for.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crop.id, crop.farmId, crop.version,
          seedRemoval.playerId, seedRemoval.itemDefinitionId, seedAfterQuantity, seedAfterVersion,
          idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
          idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
          idempotency.responseJson, idempotency.createdAt
        )
    ]);
    if (results.length !== 3 || results.some((result) => !result.success)) {
      throw new Error("Atomic crop planting failed");
    }
  }

  async removeAtomically(
    crop: CropInstance,
    expectedCropVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const results = await this.db.batch([
      // Claim the exact crop revision before deleting it. Checking only that the crop is absent
      // after DELETE would let a second request whose DELETE matched zero rows also commit a
      // successful receipt. Since a D1 batch is one transaction, a later DELETE failure rolls this
      // receipt back with the batch.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crop.id,
          crop.farmId,
          expectedCropVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        ),
      this.db
        .prepare("DELETE FROM crop_instances WHERE id = ? AND farm_id = ? AND version = ?")
        .bind(crop.id, crop.farmId, expectedCropVersion)
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic crop removal failed");
    }
  }
}

/**
 * The one-time starter package receipt.
 *
 * The insert is the whole command: `starter_grant_apply` credits the seed stack, creates the wallet,
 * and appends the ledger row in the same statement, and the receipt's primary key on
 * `(player, grant key)` is what makes the package happen once. A second call -- a repeated
 * onboarding pass, a second farm, a replayed sign-in, a retried request, a racing pair -- matches the
 * existing row and reports `changes = 0`, so nothing is credited and no error is raised.
 *
 * There is deliberately no read-then-write here: the conflict is resolved by the primary key inside
 * one statement, so concurrent callers cannot both observe an empty receipt.
 */
export class D1StarterGrantRepository implements StarterGrantRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async grantStarterPackageAtomically(grant: StarterGrant): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO starter_grants (player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount, transaction_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"
        )
        .bind(
          grant.playerId,
          grant.grantKey,
          grant.itemDefinitionId,
          grant.itemQuantity,
          grant.currencyDefinitionId,
          grant.goldAmount,
          grant.transactionId,
          grant.requestId,
          grant.timestamp
        )
    ]);
    const result = results[0];
    if (result === undefined || !result.success) {
      throw new Error("Atomic starter package grant failed");
    }
    return (result.meta.changes ?? 0) === 1;
  }
}

export class D1InventoryRepository implements InventoryRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId, itemDefinitionId: ItemDefinitionId): Promise<InventoryItem | null> {
    const row = await this.db
      .prepare("SELECT player_id, item_definition_id, quantity, updated_at, version FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .bind(playerId, itemDefinitionId)
      .first<InventoryItemRow>();
    return row === null ? null : mapInventoryItem(row);
  }

  async listByPlayer(playerId: PlayerId): Promise<readonly InventoryItem[]> {
    const rows = await this.db
      .prepare("SELECT player_id, item_definition_id, quantity, updated_at, version FROM inventory_items WHERE player_id = ? ORDER BY item_definition_id")
      .bind(playerId)
      .all<InventoryItemRow>();
    return rows.results.map(mapInventoryItem);
  }
}

export class D1WalletRepository implements WalletRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId, currencyDefinitionId: CurrencyDefinitionId): Promise<Wallet | null> {
    const row = await this.db
      .prepare("SELECT player_id, currency_id, balance, version, updated_at FROM wallets WHERE player_id = ? AND currency_id = ?")
      .bind(playerId, currencyDefinitionId)
      .first<WalletRow>();
    return row === null ? null : mapWallet(row);
  }

  async listByPlayer(playerId: PlayerId): Promise<readonly Wallet[]> {
    const rows = await this.db
      .prepare("SELECT player_id, currency_id, balance, version, updated_at FROM wallets WHERE player_id = ? ORDER BY currency_id")
      .bind(playerId)
      .all<WalletRow>();
    return rows.results.map(mapWallet);
  }
}

function mapWallet(row: WalletRow): Wallet {
  return {
    playerId: parsePlayerId(row.player_id),
    currencyDefinitionId: parseCurrencyDefinitionId(row.currency_id),
    balance: row.balance,
    version: row.version,
    updatedAt: row.updated_at
  };
}

export class D1EconomyLedgerRepository implements EconomyLedgerRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByTransactionId(transactionId: EconomyTransactionId): Promise<EconomyLedgerEntry | null> {
    const row = await this.db
      .prepare("SELECT id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at FROM economy_ledger WHERE id = ?")
      .bind(transactionId)
      .first<EconomyLedgerRow>();
    return row === null ? null : mapLedger(row);
  }

  async listByPlayer(playerId: PlayerId, limit: number): Promise<readonly EconomyLedgerEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new ApplicationError("INVALID_INPUT", "Ledger query limit is invalid");
    }
    const rows = await this.db
      .prepare("SELECT id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at FROM economy_ledger WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .bind(playerId, limit)
      .all<EconomyLedgerRow>();
    return rows.results.map(mapLedger);
  }
}

export class D1EconomyMutationRepository implements EconomyMutationRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async applyAtomically(mutation: EconomyMutation): Promise<void> {
    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(mutation.playerId, mutation.currencyDefinitionId, mutation.createdAt, mutation.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            mutation.transactionId,
            mutation.playerId,
            mutation.currencyDefinitionId,
            mutation.delta,
            mutation.balanceBefore,
            mutation.balanceAfter,
            mutation.expectedWalletVersion,
            mutation.reason,
            mutation.referenceType,
            mutation.referenceId,
            mutation.requestId,
            mutation.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic economy mutation failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("economy conflict")) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Wallet changed concurrently");
      }
      throw error;
    }
  }
}

export class D1ConstructionRepository implements ConstructionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  /**
   * Building something: the money, the row, and the receipt, all or nothing.
   *
   * The wallet movement is not written by this class - `economy_ledger`'s own triggers move it, so a
   * construction charge travels the same path a shop purchase does and cannot skip the ledger. The
   * construction insert brings its own database-level rules with it: the cells must be owned, must be
   * free, and must not hold a crop or a tree. The receipt is written last and only if the wallet and
   * the construction it names both exist at the balances this batch produced, so a half-applied
   * placement cannot leave a receipt behind.
   */
  async placeAtomically(
    placement: ConstructionPlacement,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const { construction, economy } = placement;
    if (
      economy.playerId !== idempotency.actorPlayerId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.source !== "PLAYER_PLACED" ||
      construction.state !== "ACTIVE" ||
      economy.reason !== "CONSTRUCTION" ||
      economy.referenceId !== construction.id
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction settlement ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.transactionId,
            economy.playerId,
            economy.currencyDefinitionId,
            economy.delta,
            economy.balanceBefore,
            economy.balanceAfter,
            economy.expectedWalletVersion,
            economy.reason,
            economy.referenceType,
            economy.referenceId,
            economy.requestId,
            economy.createdAt
          ),
        this.db
          .prepare("INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            construction.id,
            construction.farmId,
            construction.entryId,
            construction.category,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.state,
            construction.ownerPlayerId,
            construction.source,
            construction.placementKey,
            construction.paidAmount,
            construction.costAmount,
            construction.costCurrencyDefinitionId,
            construction.createdAt,
            construction.updatedAt,
            construction.storedAt,
            construction.version
          ),
        this.db
          .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND owner_player_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.playerId,
            economy.currencyDefinitionId,
            economy.balanceAfter,
            economy.expectedWalletVersion + 1,
            construction.id,
            construction.farmId,
            construction.ownerPlayerId,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic construction placement failed");
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("economy conflict") ||
          error.message.includes("construction cells") ||
          error.message.includes("idempotency_keys.actor_player_id"))
      ) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  async findById(id: ConstructionId): Promise<ConstructionInstance | null> {
    const row = await this.db
      .prepare("SELECT * FROM farm_constructions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    return row === null ? null : toConstructionInstance(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly ConstructionInstance[]> {
    const rows = await this.db
      .prepare("SELECT * FROM farm_constructions WHERE farm_id = ? ORDER BY created_at, id")
      .bind(farmId)
      .all<Record<string, unknown>>();
    return rows.results.map(toConstructionInstance);
  }

  async listBounds(farmId: FarmId): Promise<readonly CellBounds[]> {
    const rows = await this.db
      // Only objects *standing* on the farm block ground. A stored object is held, not placed, which
      // is what lets a mill go into storage and something else take its cells.
      .prepare("SELECT min_x, max_x, min_y, max_y FROM farm_constructions WHERE farm_id = ? AND state = 'ACTIVE'")
      .bind(farmId)
      .all<Record<string, unknown>>();
    return rows.results.map((row) => ({
      minX: Number(row.min_x),
      maxX: Number(row.max_x),
      minY: Number(row.min_y),
      maxY: Number(row.max_y)
    }));
  }

  /**
   * Moving or turning one object: the new rectangle, and the receipt that says it happened.
   *
   * The update is guarded by the version the use case read, so a stale move writes nothing at all.
   * The database's own triggers do the rest: the destination must be owned, must not overlap another
   * construction (the object's own row is excluded by its id), and must not hold a crop or a tree.
   * The receipt is written only if the row it names carries the timestamp this batch produced, which
   * is what makes "the receipt exists" and "the move happened" the same fact.
   */
  async relocateAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void> {
    const { construction, expectedVersion } = relocation;
    if (
      construction.id !== idempotency.resourceId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.version !== expectedVersion + 1
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction relocation ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "UPDATE farm_constructions SET anchor_x = ?, anchor_y = ?, rotation = ?, footprint_width = ?, footprint_depth = ?, min_x = ?, max_x = ?, min_y = ?, max_y = ?, cell_count = ?, updated_at = ?, version = version + 1 WHERE id = ? AND farm_id = ? AND version = ?"
          )
          .bind(
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.updatedAt,
            construction.id,
            construction.farmId,
            expectedVersion
          ),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND updated_at = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.updatedAt,
            construction.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic construction relocation failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && /construction cells|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("CONSTRUCTION_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  /**
   * Taking one object down, with its refund if its asset returns one.
   *
   * The delete is guarded by the version, exactly as a move is. The refund travels through
   * `economy_ledger`'s own triggers, so the wallet moves the same way every other payment does; the
   * receipt then points at that ledger row, and the ledger row is only written if the refund matched
   * the balance the use case read.
   */
  async removeAtomically(removal: ConstructionRemoval, idempotency: IdempotencyRecord): Promise<void> {
    const { farmId, constructionId, expectedVersion, refund } = removal;
    if (refund !== null && (refund.playerId !== idempotency.actorPlayerId || refund.reason !== "CONSTRUCTION_REFUND")) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction refund ownership does not match");
    }
    if (refund === null && idempotency.resourceId !== constructionId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction removal receipt does not match");
    }
    const deleteRow = this.db
      .prepare("DELETE FROM farm_constructions WHERE id = ? AND farm_id = ? AND version = ?")
      .bind(constructionId, farmId, expectedVersion);
    // The receipt is the last word: it is written only if the effect it claims is visible in this
    // same batch - the object gone, and, when the asset returns money, the refund in the ledger.
    const receipt =
      refund === null
        ? this.db
            .prepare(
              "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN NOT EXISTS (SELECT 1 FROM farm_constructions WHERE id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              constructionId,
              idempotency.actorPlayerId,
              idempotency.operation,
              idempotency.requestId,
              idempotency.payloadFingerprint,
              idempotency.status,
              idempotency.resourceId,
              idempotency.responseJson,
              idempotency.createdAt
            )
        : this.db
            .prepare(
              "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ? AND reason = 'CONSTRUCTION_REFUND' AND reference_id = ?) AND NOT EXISTS (SELECT 1 FROM farm_constructions WHERE id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              refund.transactionId,
              idempotency.actorPlayerId,
              constructionId,
              constructionId,
              idempotency.actorPlayerId,
              idempotency.operation,
              idempotency.requestId,
              idempotency.payloadFingerprint,
              idempotency.status,
              idempotency.resourceId,
              idempotency.responseJson,
              idempotency.createdAt
            );
    const statements =
      refund === null
        ? [deleteRow, receipt]
        : [
            this.db
              .prepare(
                "INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)"
              )
              .bind(refund.playerId, refund.currencyDefinitionId, refund.createdAt, refund.createdAt),
            this.db
              .prepare(
                "INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              )
              .bind(
                refund.transactionId,
                refund.playerId,
                refund.currencyDefinitionId,
                refund.delta,
                refund.balanceBefore,
                refund.balanceAfter,
                refund.expectedWalletVersion,
                refund.reason,
                refund.referenceType,
                refund.referenceId,
                refund.requestId,
                refund.createdAt
              ),
            deleteRow,
            receipt
          ];
    try {
      const results = await this.db.batch(statements);
      if (results.some((result) => !result.success)) throw new Error("Atomic construction removal failed");
    } catch (error: unknown) {
      if (error instanceof Error && /economy conflict|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }

  /**
   * The starter arrangement, written once.
   *
   * The version stamp and the rows are one batch, and the rows are only written by the pass that
   * actually moved the version - `WHERE starter_world_version = ?` on the insert, with the expected
   * version the *new* one. A second caller finds the farm already stamped, its inserts select nothing,
   * and it reports zero. The unique `(farm, placement_key)` index is the second lock on the same door.
   */
  async seedAtomically(seed: ConstructionSeed): Promise<number> {
    if (seed.constructions.length === 0) return 0;
    const statements = [
      this.db
        .prepare(
          "UPDATE farms SET starter_world_version = ?, updated_at = ? WHERE id = ? AND starter_world_version < ?"
        )
        .bind(seed.version, seed.seededAt, seed.farmId, seed.version)
    ];
    let created = 0;
    for (const construction of seed.constructions) {
      if (construction.source !== "STARTER" || construction.placementKey === null) {
        throw new ApplicationError("INTERNAL_ERROR", "A starter row must carry its placement key");
      }
      statements.push(
        this.db
          .prepare(
            "INSERT INTO farm_constructions (id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation, footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count, state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at, stored_at, version) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT starter_world_version FROM farms WHERE id = ?) = ?"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.entryId,
            construction.category,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.state,
            construction.ownerPlayerId,
            construction.source,
            construction.placementKey,
            construction.paidAmount,
            construction.costAmount,
            construction.costCurrencyDefinitionId,
            construction.createdAt,
            construction.updatedAt,
            construction.storedAt,
            construction.version,
            seed.farmId,
            seed.version
          )
      );
    }
    const results = await this.db.batch(statements);
    // The first statement is the version stamp: if it changed nothing, this pass lost the race and
    // created nothing, whatever the insert results say.
    if ((results[0]?.meta.changes ?? 0) === 0) return 0;
    created = results.slice(1).reduce((total, result) => total + (result.meta.changes ?? 0), 0);
    return created;
  }

  /**
   * Moving one object between the world and storage.
   *
   * One statement for both directions: the state, the moment it changed, and - on the way back out -
   * the ground it is returning to. The version predicate is the same one every other edit uses, so a
   * stale store or restore writes nothing, and the guarded receipt makes "the receipt exists" and
   * "the object moved" the same fact.
   */
  async setStoredAtomically(relocation: ConstructionRelocation, idempotency: IdempotencyRecord): Promise<void> {
    const { construction, expectedVersion } = relocation;
    if (
      construction.id !== idempotency.resourceId ||
      construction.ownerPlayerId !== idempotency.actorPlayerId ||
      construction.version !== expectedVersion + 1
    ) {
      throw new ApplicationError("NOT_AUTHORIZED", "Construction storage ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "UPDATE farm_constructions SET state = ?, anchor_x = ?, anchor_y = ?, rotation = ?, footprint_width = ?, footprint_depth = ?, min_x = ?, max_x = ?, min_y = ?, max_y = ?, cell_count = ?, stored_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND farm_id = ? AND version = ?"
          )
          .bind(
            construction.state,
            construction.anchorX,
            construction.anchorY,
            construction.rotation,
            construction.footprint.widthCells,
            construction.footprint.depthCells,
            construction.bounds.minX,
            construction.bounds.maxX,
            construction.bounds.minY,
            construction.bounds.maxY,
            construction.footprint.widthCells * construction.footprint.depthCells,
            construction.storedAt,
            construction.updatedAt,
            construction.id,
            construction.farmId,
            expectedVersion
          ),
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM farm_constructions WHERE id = ? AND farm_id = ? AND updated_at = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            construction.id,
            construction.farmId,
            construction.updatedAt,
            construction.version,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          )
      ]);
      if (results.length !== 2 || results.some((result) => !result.success)) {
        throw new Error("Atomic construction storage change failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && /construction cells|idempotency_keys\.actor_player_id/.test(error.message)) {
        throw new ApplicationError("CONSTRUCTION_CONFLICT", "Construction state changed concurrently");
      }
      throw error;
    }
  }
}

/** One persisted construction, as the domain reads it back. */
function toConstructionInstance(row: Record<string, unknown>): ConstructionInstance {
  // Read as values rather than coerced: a null placement key and a null stored_at are meaningful
  // (a bought object has no placement, a standing one is not stored), and `String(null)` would turn
  // either into the word "null".
  const placementKey = row.placement_key;
  const storedAt = row.stored_at;
  return {
    id: parseConstructionId(String(row.id)),
    farmId: parseFarmId(String(row.farm_id)),
    entryId: String(row.catalogue_entry_id),
    category: String(row.category),
    anchorX: Number(row.anchor_x),
    anchorY: Number(row.anchor_y),
    rotation: Number(row.rotation) as QuarterTurns,
    footprint: { widthCells: Number(row.footprint_width), depthCells: Number(row.footprint_depth) },
    bounds: {
      minX: Number(row.min_x),
      maxX: Number(row.max_x),
      minY: Number(row.min_y),
      maxY: Number(row.max_y)
    },
    state: String(row.state) === "STORED" ? "STORED" : "ACTIVE",
    ownerPlayerId: parsePlayerId(String(row.owner_player_id)),
    source: String(row.source) === "STARTER" ? "STARTER" : "PLAYER_PLACED",
    placementKey: typeof placementKey === "string" ? placementKey : null,
    paidAmount: Number(row.paid_amount),
    costAmount: Number(row.cost_amount),
    costCurrencyDefinitionId: String(row.cost_currency_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    storedAt: typeof storedAt === "string" ? storedAt : null,
    version: Number(row.version)
  };
}

export class D1EconomySettlementRepository implements EconomySettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleShopAtomically(
    economy: EconomyMutation,
    inventory: InventoryMutation,
    expectedInventory: InventoryItem | null,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== inventory.playerId || economy.playerId !== idempotency.actorPlayerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    const expectedQuantity = expectedInventory?.quantity ?? 0;
    const expectedVersion = expectedInventory?.version ?? 0;
    const afterQuantity = inventory.kind === "ADD"
      ? expectedQuantity + inventory.quantity
      : expectedQuantity - inventory.quantity;
    const afterVersion = expectedVersion + 1;
    const inventoryStatement = inventory.kind === "ADD"
      ? expectedInventory === null
        ? this.db
            .prepare("INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ?)")
            .bind(inventory.playerId, inventory.itemDefinitionId, inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId)
        : this.db
            .prepare("UPDATE inventory_items SET quantity = quantity + ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity <= ? - ?")
            .bind(inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId, expectedQuantity, expectedVersion, inventory.maxQuantity, inventory.quantity)
      : this.db
          .prepare("UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?")
          .bind(inventory.quantity, inventory.timestamp, inventory.playerId, inventory.itemDefinitionId, expectedQuantity, expectedVersion, inventory.quantity);

    try {
      const results = await this.db.batch([
        this.db
          .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
          .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
        this.db
          .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
        inventoryStatement,
        this.db
          .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1,
            economy.transactionId, economy.playerId,
            inventory.playerId, inventory.itemDefinitionId, afterQuantity, afterVersion,
            idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
            idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
            idempotency.responseJson, idempotency.createdAt
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic shop settlement failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error &&
          (error.message.includes("economy conflict") || error.message.includes("idempotency_keys.actor_player_id"))) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
      }
      throw error;
    }
  }
}

export class D1FarmExpansionRepository implements FarmExpansionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async expandFarmAtomically(
    economy: EconomyMutation,
    tiles: readonly FarmTile[],
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (economy.playerId !== idempotency.actorPlayerId || economy.reason !== "FARM_EXPANSION") {
      throw new ApplicationError("NOT_AUTHORIZED", "Expansion settlement ownership does not match");
    }
    if (tiles.length !== PLOT_TILE_COUNT || tiles.some((tile) => tile.farmId !== tiles[0]?.farmId)) {
      throw new ApplicationError("INVALID_INPUT", "Expansion tile cohort is invalid");
    }
    const xs = tiles.map((tile) => tile.x);
    const ys = tiles.map((tile) => tile.y);
    if (new Set(xs).size !== PLOT_TILE_SIZE || new Set(ys).size !== PLOT_TILE_SIZE) {
      throw new ApplicationError("INVALID_INPUT", "Expansion tile geometry is invalid");
    }

    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)")
        .bind(economy.playerId, economy.currencyDefinitionId, economy.createdAt, economy.createdAt),
      this.db
        .prepare("INSERT INTO economy_ledger (id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version, reason, reference_type, reference_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(economy.transactionId, economy.playerId, economy.currencyDefinitionId, economy.delta, economy.balanceBefore, economy.balanceAfter, economy.expectedWalletVersion, economy.reason, economy.referenceType, economy.referenceId, economy.requestId, economy.createdAt),
      ...tiles.map((tile) =>
        this.db
          .prepare("INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(tile.farmId, tile.x, tile.y, tile.terrainType, tile.state, tile.version, tile.updatedAt)
      ),
      this.db
        .prepare("INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM wallets WHERE player_id = ? AND currency_id = ? AND balance = ? AND version = ?) AND EXISTS (SELECT 1 FROM economy_ledger WHERE id = ? AND player_id = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          economy.playerId, economy.currencyDefinitionId, economy.balanceAfter, economy.expectedWalletVersion + 1,
          economy.transactionId, economy.playerId,
          idempotency.actorPlayerId, idempotency.operation, idempotency.requestId,
          idempotency.payloadFingerprint, idempotency.status, idempotency.resourceId,
          idempotency.responseJson, idempotency.createdAt
        )
    ];
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("Atomic farm expansion failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("economy conflict") || error.message.includes("UNIQUE constraint failed: farm_tiles") || error.message.includes("idempotency_keys.actor_player_id"))) {
        throw new ApplicationError("ECONOMY_CONFLICT", "Farm or economy state changed concurrently");
      }
      throw error;
    }
  }
}

export class D1HarvestSettlementRepository implements HarvestSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleHarvestAtomically(
    crop: CropInstance,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO harvest_settlements (actor_player_id, operation, request_id, farm_id, crop_instance_id, crop_version, crop_definition_id, item_definition_id, quantity, max_quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            addition.playerId,
            idempotency.operation,
            idempotency.requestId,
            crop.farmId,
            crop.id,
            crop.version,
            crop.cropDefinitionId,
            addition.itemDefinitionId,
            addition.quantity,
            addition.maxQuantity,
            addition.timestamp
          ),
        // Seeds the row for a player who has never earned experience, exactly as the wallet path
        // seeds a wallet, so one guarded update serves the first award and every later one alike.
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        // Tests the state the caller read *before* the award is applied, and the award is applied
        // after it. The pre-award state is the unambiguous choice: `xp` and `progression_version`
        // only ever increase, so a caller whose read has been overtaken can never match the current
        // row, while an after-state check cannot tell such a caller apart from one whose own award
        // already landed — both predict the same `xp` and the same next version.
        //
        // SQLite cannot fail an `UPDATE` that matches no rows, so the guard is the `CASE` below:
        // it yields NULL when the row is not where the caller left it. The database then reports
        // whichever constraint it reaches first, because a NULL actor matches no settlement in the
        // harvest idempotency trigger and aborts there, before any NOT NULL check would.
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        // Applies the award against the very state the guard just matched. Both statements test the
        // same predicate inside one transaction, so they cannot disagree about which revision the
        // caller read.
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic harvest settlement failed");
      }
    } catch (error: unknown) {
      // Three messages mean the same thing: the guard did not match, so the caller read progression
      // before another award moved it. The caller re-reads and retries.
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys") ||
          error.message.includes("completed harvest idempotency requires settlement"))
      ) {
        throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
      }
      throw error;
    }
  }
}

interface PlayerProgressionRow {
  player_id: string;
  level: number;
  xp: number;
  progression_version: number;
  created_at: string;
  updated_at: string;
}

function mapPlayerProgression(row: PlayerProgressionRow): PlayerProgression {
  return {
    playerId: parsePlayerId(row.player_id),
    level: row.level,
    xp: row.xp,
    progressionVersion: row.progression_version,
    updatedAt: row.updated_at
  };
}

export class D1ProgressionRepository implements ProgressionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(playerId: PlayerId): Promise<PlayerProgression | null> {
    const row = await this.db
      .prepare(
        "SELECT player_id, level, xp, progression_version, created_at, updated_at FROM player_progression WHERE player_id = ?"
      )
      .bind(playerId)
      .first<PlayerProgressionRow>();
    return row === null ? null : mapPlayerProgression(row);
  }
}

function mapInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    playerId: parsePlayerId(row.player_id),
    itemDefinitionId: parseItemDefinitionId(row.item_definition_id),
    quantity: row.quantity,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function mapLedger(row: EconomyLedgerRow): EconomyLedgerEntry {
  return {
    transactionId: parseEconomyTransactionId(row.id),
    playerId: parsePlayerId(row.player_id),
    currencyDefinitionId: parseCurrencyDefinitionId(row.currency_id),
    delta: row.delta,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    expectedWalletVersion: row.expected_wallet_version,
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: parseEconomyReferenceId(row.reference_id),
    requestId: row.request_id,
    createdAt: row.created_at
  };
}

/**
 * Reads stored command receipts.
 *
 * Every command path looks a receipt up by (actor, operation, request id). The tree commands have no
 * other use for a crop repository, so this names the one query they need instead of borrowing a
 * crop-named class to reach a table the two features share.
 */
export class D1IdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(actorPlayerId: PlayerId, operation: string, requestId: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT actor_player_id, operation, request_id, payload_fingerprint, resource_id, response_json, status, created_at FROM idempotency_keys WHERE actor_player_id = ? AND operation = ? AND request_id = ?"
      )
      .bind(actorPlayerId, operation, requestId)
      .first<IdempotencyRow>();
    return row === null
      ? null
      : {
          actorPlayerId: parsePlayerId(row.actor_player_id),
          operation: row.operation,
          requestId: row.request_id,
          payloadFingerprint: row.payload_fingerprint,
          resourceId: row.resource_id,
          responseJson: row.response_json,
          status: row.status,
          createdAt: row.created_at
        };
  }
}

interface TreeInstanceRow {
  id: string;
  farm_id: string;
  tile_x: number;
  tile_y: number;
  tree_definition_id: string;
  planted_by_player_id: string;
  planted_at: string;
  last_harvested_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapTree(row: TreeInstanceRow): TreeInstance {
  return {
    id: parseTreeInstanceId(row.id),
    farmId: parseFarmId(row.farm_id),
    tileX: row.tile_x,
    tileY: row.tile_y,
    treeDefinitionId: parseTreeDefinitionId(row.tree_definition_id),
    plantedByPlayerId: parsePlayerId(row.planted_by_player_id),
    plantedAt: row.planted_at,
    lastHarvestedAt: row.last_harvested_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Trees: one row per planted tree, plus the two settlements that create and end it.
 *
 * The SELECT list is spelled out rather than `*` so a column added later cannot silently reach a
 * domain object, and every read filters by farm so a caller cannot reach another farm's tree through
 * a shared instance id.
 */
export class D1TreeRepository implements TreeInstanceRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: TreeInstanceId): Promise<TreeInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at FROM tree_instances WHERE id = ?"
      )
      .bind(id)
      .first<TreeInstanceRow>();
    return row === null ? null : mapTree(row);
  }

  async findAtTile(farmId: FarmId, x: number, y: number): Promise<TreeInstance | null> {
    const row = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at FROM tree_instances WHERE farm_id = ? AND tile_x = ? AND tile_y = ?"
      )
      .bind(farmId, x, y)
      .first<TreeInstanceRow>();
    return row === null ? null : mapTree(row);
  }

  async listByFarm(farmId: FarmId): Promise<readonly TreeInstance[]> {
    const result = await this.db
      .prepare(
        "SELECT id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at FROM tree_instances WHERE farm_id = ? ORDER BY tile_y, tile_x"
      )
      .bind(farmId)
      .all<TreeInstanceRow>();
    return result.results.map(mapTree);
  }

  async plantAtomically(
    tree: TreeInstance,
    expectedTileVersion: number,
    saplingRemoval: InventoryRemoval,
    expectedInventory: InventoryItem,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (saplingRemoval.playerId !== expectedInventory.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Sapling removal ownership does not match");
    }
    const saplingAfterQuantity = expectedInventory.quantity - saplingRemoval.quantity;
    const saplingAfterVersion = expectedInventory.version + 1;
    const results = await this.db.batch([
      // Spends the sapling first, guarded on the exact quantity and version the caller read. SQLite
      // cannot fail an UPDATE that matches no rows, so a lost race shows up in the final idempotency
      // statement below, which is what actually aborts the batch.
      this.db
        .prepare(
          "UPDATE inventory_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ? AND quantity >= ?"
        )
        .bind(
          saplingRemoval.quantity,
          saplingRemoval.timestamp,
          saplingRemoval.playerId,
          saplingRemoval.itemDefinitionId,
          expectedInventory.quantity,
          expectedInventory.version,
          saplingRemoval.quantity
        ),
      // The tile row is the unlocked land, and the SELECT is the guard that it is still empty soil at
      // the revision the caller read. A tile that a crop already occupies inserts nothing.
      this.db
        .prepare(
          "INSERT INTO tree_instances (id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ? FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ? AND version = ? AND terrain_type = 'SOIL' AND tile_state = 'IDLE'"
        )
        .bind(
          tree.id,
          tree.farmId,
          tree.tileX,
          tree.tileY,
          tree.treeDefinitionId,
          tree.plantedByPlayerId,
          tree.plantedAt,
          tree.version,
          tree.createdAt,
          tree.updatedAt,
          tree.farmId,
          tree.tileX,
          tree.tileY,
          expectedTileVersion
        ),
      // The receipt commits only when the tree exists *and* the sapling is exactly where this
      // settlement left it, so a failure after the insert cannot leave a planted tree that was never
      // paid for.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM inventory_items WHERE player_id = ? AND item_definition_id = ? AND quantity = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          tree.id,
          tree.farmId,
          tree.version,
          saplingRemoval.playerId,
          saplingRemoval.itemDefinitionId,
          saplingAfterQuantity,
          saplingAfterVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        )
    ]);
    if (results.length !== 3 || results.some((result) => !result.success)) {
      throw new Error("Atomic tree planting failed");
    }
  }

  async removeAtomically(
    tree: TreeInstance,
    expectedTreeVersion: number,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const results = await this.db.batch([
      // Claim the exact revision before deleting it. Checking only that the tree is absent after
      // DELETE would let a second request whose DELETE matched zero rows also commit a successful
      // receipt. Since a D1 batch is one transaction, a later DELETE failure rolls this receipt back
      // with the batch.
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          tree.id,
          tree.farmId,
          expectedTreeVersion,
          idempotency.actorPlayerId,
          idempotency.operation,
          idempotency.requestId,
          idempotency.payloadFingerprint,
          idempotency.status,
          idempotency.resourceId,
          idempotency.responseJson,
          idempotency.createdAt
        ),
      this.db
        .prepare("DELETE FROM tree_instances WHERE id = ? AND farm_id = ? AND version = ?")
        .bind(tree.id, tree.farmId, expectedTreeVersion)
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic tree removal failed");
    }
  }
}

/**
 * The one write boundary for harvesting a tree's cycle.
 *
 * The same four statements as a crop harvest, with one substitution: the settlement's apply trigger
 * advances the tree's harvest anchor and revision instead of deleting the crop. The guard still tests
 * the progression state the caller read, so a lost race aborts the whole batch and the use case
 * re-reads rather than paying twice.
 */
export class D1TreeHarvestSettlementRepository implements TreeHarvestSettlementRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async settleTreeHarvestAtomically(
    tree: TreeInstance,
    addition: InventoryAddition,
    award: XpAward,
    idempotency: IdempotencyRecord
  ): Promise<void> {
    if (award.playerId !== idempotency.actorPlayerId || award.playerId !== addition.playerId) {
      throw new ApplicationError("NOT_AUTHORIZED", "Settlement ownership does not match");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO tree_harvest_settlements (actor_player_id, operation, request_id, farm_id, tree_instance_id, tree_version, tree_definition_id, item_definition_id, quantity, max_quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            addition.playerId,
            idempotency.operation,
            idempotency.requestId,
            tree.farmId,
            tree.id,
            tree.version,
            tree.treeDefinitionId,
            addition.itemDefinitionId,
            addition.quantity,
            addition.maxQuantity,
            addition.timestamp
          ),
        this.db
          .prepare(
            "INSERT OR IGNORE INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 1, 0, 1, ?, ?)"
          )
          .bind(award.playerId, award.timestamp, award.timestamp),
        // Tests the state the caller read *before* the award is applied, exactly as the crop harvest
        // does. SQLite cannot fail an UPDATE that matches no rows, so this CASE is the guard: it
        // yields NULL when the row moved, and the receipt's NOT NULL then aborts the batch.
        this.db
          .prepare(
            "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM player_progression WHERE player_id = ? AND xp = ? AND progression_version = ?) THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion,
            idempotency.actorPlayerId,
            idempotency.operation,
            idempotency.requestId,
            idempotency.payloadFingerprint,
            idempotency.status,
            idempotency.resourceId,
            idempotency.responseJson,
            idempotency.createdAt
          ),
        this.db
          .prepare(
            "UPDATE player_progression SET level = ?, xp = ?, progression_version = progression_version + 1, updated_at = ? WHERE player_id = ? AND xp = ? AND progression_version = ?"
          )
          .bind(
            award.levelAfter,
            award.xpAfter,
            award.timestamp,
            award.playerId,
            award.xpBefore,
            award.expectedProgressionVersion
          )
      ]);
      if (results.length !== 4 || results.some((result) => !result.success)) {
        throw new Error("Atomic tree harvest settlement failed");
      }
    } catch (error: unknown) {
      // The messages the crop harvest classifies, plus the tree cycle's own two: the receipt trigger
      // fires when the guard yielded NULL, and the monotonic progression trigger fires when the
      // caller's award would move a row that has already moved. Anything else is a genuine internal
      // failure and is rethrown so it surfaces as one instead of being disguised as a conflict.
      if (
        error instanceof Error &&
        (error.message.includes("player progression") ||
          error.message.includes("NOT NULL constraint failed: idempotency_keys") ||
          error.message.includes("completed tree harvest idempotency requires settlement"))
      ) {
        throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
      }
      throw error;
    }
  }
}
