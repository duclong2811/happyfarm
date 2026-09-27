import { z } from "zod";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const PlayerIdSchema = z.string().regex(new RegExp(`^player_${UUID_PATTERN}$`, "i"));
export const FarmIdSchema = z.string().regex(new RegExp(`^farm_${UUID_PATTERN}$`, "i"));
export const CropInstanceIdSchema = z.string().regex(new RegExp(`^cropinst_${UUID_PATTERN}$`, "i"));
export const CropDefinitionIdSchema = z.string().regex(/^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const ItemDefinitionIdSchema = z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const RequestIdSchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
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

export const PlantCropRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    cropDefinitionId: CropDefinitionIdSchema,
    x: z.number().int().min(MIN_TILE_X).max(MAX_TILE_X),
    y: z.number().int().min(MIN_TILE_Y).max(MAX_TILE_Y),
    expectedTileVersion: z.number().int().positive()
  })
  .strict();

export const CropStateDTOSchema = z
  .object({
    cropInstanceId: CropInstanceIdSchema,
    definitionId: CropDefinitionIdSchema,
    tileX: z.number().int(),
    tileY: z.number().int(),
    plantedAt: z.iso.datetime(),
    growthStage: z.number().int().nonnegative(),
    growthProgress: z.number().min(0).max(1),
    mature: z.boolean(),
    version: z.number().int().positive()
  })
  .strict();

export const PlantCropResponseSchema = z.object({ crop: CropStateDTOSchema }).strict();
export const GetFarmCropsResponseSchema = z.object({ crops: z.array(CropStateDTOSchema) }).strict();

export const HarvestCropRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    expectedCropVersion: z.number().int().positive()
  })
  .strict();

export const HarvestResultDTOSchema = z
  .object({
    cropInstanceId: CropInstanceIdSchema,
    itemDefinitionId: ItemDefinitionIdSchema,
    quantityAdded: z.number().int().positive()
  })
  .strict();

export const InventoryEntryDTOSchema = z
  .object({ itemDefinitionId: ItemDefinitionIdSchema, quantity: z.number().int().nonnegative() })
  .strict();

export const HarvestCropResponseSchema = z.object({ harvest: HarvestResultDTOSchema }).strict();
export const GetInventoryResponseSchema = z.object({ items: z.array(InventoryEntryDTOSchema) }).strict();

export const ErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "RESOURCE_NOT_FOUND",
  "FARM_PERMISSION_DENIED",
  "TILE_INVALID",
  "TILE_OCCUPIED",
  "TILE_NOT_PLANTABLE",
  "CROP_DEFINITION_NOT_FOUND",
  "CROP_NOT_FOUND",
  "CROP_NOT_MATURE",
  "CROP_ALREADY_HARVESTED",
  "ITEM_DEFINITION_NOT_FOUND",
  "INVENTORY_LIMIT_EXCEEDED",
  "CROP_NOT_READY",
  "INSUFFICIENT_ITEMS",
  "INSUFFICIENT_FUNDS",
  "REQUEST_ALREADY_PROCESSED",
  "CONFLICT_STALE_STATE",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR"
]);

export type CreateFarmRequest = z.infer<typeof CreateFarmRequestSchema>;
export type FarmDTO = z.infer<typeof FarmDTOSchema>;
export type FarmMemberDTO = z.infer<typeof FarmMemberDTOSchema>;
export type FarmTileDTO = z.infer<typeof FarmTileDTOSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type PlantCropRequest = z.infer<typeof PlantCropRequestSchema>;
export type CropStateDTO = z.infer<typeof CropStateDTOSchema>;
export type HarvestCropRequest = z.infer<typeof HarvestCropRequestSchema>;
export type HarvestResultDTO = z.infer<typeof HarvestResultDTOSchema>;
export type InventoryEntryDTO = z.infer<typeof InventoryEntryDTOSchema>;

export type ApiSuccess<T> = { readonly ok: true; readonly data: T };
export type ApiFailure = {
  readonly ok: false;
  readonly error: { readonly code: ErrorCode; readonly requestId?: string };
};
