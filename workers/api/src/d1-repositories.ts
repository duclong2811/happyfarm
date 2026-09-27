import type {
  Farm,
  FarmId,
  FarmMember,
  FarmRole,
  FarmTile,
  CropInstance,
  CropInstanceId,
  Player,
  PlayerId,
  PlayerStatus,
  TerrainType,
  TileState
} from "@happy-farm/domain";
import { parseCropDefinitionId, parseCropInstanceId, parseFarmId, parsePlayerId } from "@happy-farm/domain";
import type {
  CropInstanceRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  PlayerRepository,
  IdempotencyRecord,
  IdempotencyRepository
} from "@happy-farm/application";
import type { D1DatabaseLike } from "./d1-types";

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

  async createWithOwner(farm: Farm, ownerMembership: FarmMember): Promise<void> {
    const results = await this.db.batch([
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
        )
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
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
    return row === null
      ? null
      : {
          farmId: parseFarmId(row.farm_id),
          x: row.x,
          y: row.y,
          terrainType: row.terrain_type,
          state: row.tile_state,
          version: row.version,
          updatedAt: row.updated_at
        };
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
