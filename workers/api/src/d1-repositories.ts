import type {
  Farm,
  FarmId,
  FarmMember,
  FarmRole,
  FarmTile,
  Player,
  PlayerId,
  PlayerStatus,
  TerrainType,
  TileState
} from "@happy-farm/domain";
import { parseFarmId, parsePlayerId } from "@happy-farm/domain";
import type {
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  PlayerRepository
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
