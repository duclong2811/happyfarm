import { z } from "zod";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const PlayerIdSchema = z.string().regex(new RegExp(`^player_${UUID_PATTERN}$`, "i"));
export const FarmIdSchema = z.string().regex(new RegExp(`^farm_${UUID_PATTERN}$`, "i"));
export const FarmRoleSchema = z.enum(["OWNER", "EDITOR", "HELPER", "VISITOR"]);
export const TerrainTypeSchema = z.enum(["GRASS", "SOIL", "WATER", "BLOCKED"]);
export const TileStateSchema = z.enum(["IDLE"]);

export const MIN_TILE_X = -1_000_000;
export const MAX_TILE_X = 1_000_000;
export const MIN_TILE_Y = -1_000_000;
export const MAX_TILE_Y = 1_000_000;

export const TileCoordinateSchema = z
  .object({
    x: z.number().int().min(MIN_TILE_X).max(MAX_TILE_X),
    y: z.number().int().min(MIN_TILE_Y).max(MAX_TILE_Y)
  })
  .strict();

export const CreateFarmRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80)
  })
  .strict();

export const FarmDTOSchema = z
  .object({
    id: FarmIdSchema,
    ownerPlayerId: PlayerIdSchema,
    name: z.string().min(1).max(80),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const FarmMemberDTOSchema = z
  .object({
    farmId: FarmIdSchema,
    playerId: PlayerIdSchema,
    role: FarmRoleSchema,
    createdAt: z.iso.datetime()
  })
  .strict();

export const FarmTileDTOSchema = z
  .object({
    farmId: FarmIdSchema,
    x: z.number().int().min(MIN_TILE_X).max(MAX_TILE_X),
    y: z.number().int().min(MIN_TILE_Y).max(MAX_TILE_Y),
    terrainType: TerrainTypeSchema,
    state: TileStateSchema,
    version: z.number().int().positive(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const CreateFarmResponseSchema = z
  .object({ farm: FarmDTOSchema, membership: FarmMemberDTOSchema })
  .strict();
export const GetFarmResponseSchema = CreateFarmResponseSchema;
export const HealthResponseSchema = z
  .object({ ok: z.literal(true), data: z.object({ status: z.literal("ok") }).strict() })
  .strict();

export const ErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "RESOURCE_NOT_FOUND",
  "FARM_PERMISSION_DENIED",
  "TILE_INVALID",
  "TILE_OCCUPIED",
  "CROP_NOT_READY",
  "INSUFFICIENT_ITEMS",
  "INSUFFICIENT_FUNDS",
  "REQUEST_ALREADY_PROCESSED",
  "CONFLICT_STALE_STATE",
  "RATE_LIMITED",
  "INTERNAL_ERROR"
]);

export type CreateFarmRequest = z.infer<typeof CreateFarmRequestSchema>;
export type FarmDTO = z.infer<typeof FarmDTOSchema>;
export type FarmMemberDTO = z.infer<typeof FarmMemberDTOSchema>;
export type FarmTileDTO = z.infer<typeof FarmTileDTOSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export type ApiSuccess<T> = { readonly ok: true; readonly data: T };
export type ApiFailure = {
  readonly ok: false;
  readonly error: { readonly code: ErrorCode; readonly requestId?: string };
};
