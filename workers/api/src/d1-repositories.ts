import type {
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
  ItemDefinitionId,
  Player,
  PlayerId,
  PlayerProgression,
  PlayerStatus,
  TerrainType,
  TileState,
  XpAward,
  Wallet
} from "@happy-farm/domain";
import {
  parseCropDefinitionId,
  parseCropInstanceId,
  parseCurrencyDefinitionId,
  parseEconomyReferenceId,
  parseEconomyTransactionId,
  parseFarmId,
  parseItemDefinitionId,
  parsePlayerId,
  PLOT_TILE_COUNT,
  PLOT_TILE_SIZE
} from "@happy-farm/domain";
import type {
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
    idempotency: IdempotencyRecord
  ): Promise<void> {
    const results = await this.db.batch([
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
      this.db
        .prepare(
          "INSERT INTO idempotency_keys (actor_player_id, operation, request_id, payload_fingerprint, status, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
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
      throw new Error("Atomic crop planting failed");
    }
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
