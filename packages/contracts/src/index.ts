import { z } from "zod";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const PlayerIdSchema = z.string().regex(new RegExp(`^player_${UUID_PATTERN}$`, "i"));
export const FarmIdSchema = z.string().regex(new RegExp(`^farm_${UUID_PATTERN}$`, "i"));
export const CropInstanceIdSchema = z.string().regex(new RegExp(`^cropinst_${UUID_PATTERN}$`, "i"));
export const CropDefinitionIdSchema = z.string().regex(/^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const TreeInstanceIdSchema = z.string().regex(new RegExp(`^treeinst_${UUID_PATTERN}$`, "i"));
export const TreeDefinitionIdSchema = z.string().regex(/^tree_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const ItemDefinitionIdSchema = z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const CurrencyDefinitionIdSchema = z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const ShopEntryIdSchema = z.string().regex(/^shop_[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const PlotIdSchema = z.string().regex(/^plot_[1-9][0-9]*$/);
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
export const GetFarmTilesResponseSchema = z.object({ tiles: z.array(FarmTileDTOSchema) }).strict();
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

/**
 * The two item kinds an inventory or a market row can hold.
 *
 * Sent to the client so it can group and label without keeping a list of which item is which: a
 * server that adds a seed does not need a client release to say so.
 */
export const ItemCategorySchema = z.enum(["CROP", "SEED"]);

/**
 * Uprooting a crop.
 *
 * The command carries a request ID and the crop version the client last saw, exactly like harvesting.
 * There is no reward, refund, or owner field because there is nothing to decide: the server deletes
 * the crop it was pointed at, and the seed is gone.
 */
export const UprootCropRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    expectedCropVersion: z.number().int().positive()
  })
  .strict();

export const UprootCropResponseSchema = z
  .object({ removed: z.object({ cropInstanceId: CropInstanceIdSchema }).strict() })
  .strict();

/**
 * One tree the server can be asked to plant.
 *
 * A tree carries two durations rather than one: `firstReadySeconds` for the fruit it bears first and
 * `regrowSeconds` for every fruit after that. `requiredLevel` is always present, exactly as it is for
 * crops, so the client never infers a rule from a missing field.
 */
export const TreeDefinitionDTOSchema = z
  .object({
    treeDefinitionId: TreeDefinitionIdSchema,
    /** The game-data key for this tree's name, which the client translates. */
    displayNameKey: z.string().min(1).max(120),
    /** The sapling one planting consumes. The client shows the count of exactly this item. */
    saplingItemDefinitionId: ItemDefinitionIdSchema,
    saplingItemDisplayNameKey: z.string().min(1).max(120),
    firstReadySeconds: z.number().int().positive().max(31_536_000),
    regrowSeconds: z.number().int().positive().max(31_536_000),
    growthStages: z.number().int().min(2).max(16),
    harvestItemDefinitionId: ItemDefinitionIdSchema,
    baseQuantity: z.number().int().positive().max(1_000_000),
    harvestXp: z.number().int().positive().max(1_000_000),
    // Bounded by the same ceiling the progression schema and `player_progression` use, so a served
    // definition can never be one this contract would reject.
    requiredLevel: z.number().int().positive().max(10_000)
  })
  .strict();

export const GetTreeDefinitionsResponseSchema = z
  .object({ definitions: z.array(TreeDefinitionDTOSchema) })
  .strict();

/**
 * Where a tree is in its current cycle.
 *
 * `ready`, `readyAt`, `secondsUntilReady`, `phase`, and the growth numbers are derived by the server
 * from its own clock and the tree's timestamps; they travel so the client can show a countdown
 * without reimplementing the rule or trusting a local clock. `lastHarvestedAt` is null until the
 * first harvest, which is how a client tells first growth from regrowth.
 */
export const TREE_PHASES = ["GROWING", "READY", "REGROWING"] as const;

export const TreeStateDTOSchema = z
  .object({
    treeInstanceId: TreeInstanceIdSchema,
    definitionId: TreeDefinitionIdSchema,
    tileX: z.number().int(),
    tileY: z.number().int(),
    plantedAt: z.iso.datetime(),
    lastHarvestedAt: z.iso.datetime().nullable(),
    readyAt: z.iso.datetime(),
    secondsUntilReady: z.number().int().nonnegative(),
    ready: z.boolean(),
    phase: z.enum(TREE_PHASES),
    growthStage: z.number().int().nonnegative(),
    growthProgress: z.number().min(0).max(1),
    version: z.number().int().positive()
  })
  .strict();

/**
 * Planting a tree.
 *
 * The command names a coordinate, the definition, and the tile revision the client last saw. There is
 * no sapling id, no quantity, and no reward: the sapling comes from the definition and the settlement
 * spends exactly one.
 */
export const PlantTreeRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    treeDefinitionId: TreeDefinitionIdSchema,
    x: z.number().int().min(MIN_TILE_X).max(MAX_TILE_X),
    y: z.number().int().min(MIN_TILE_Y).max(MAX_TILE_Y),
    expectedTileVersion: z.number().int().positive()
  })
  .strict();

export const PlantTreeResponseSchema = z.object({ tree: TreeStateDTOSchema }).strict();
export const GetFarmTreesResponseSchema = z.object({ trees: z.array(TreeStateDTOSchema) }).strict();

/** Harvesting one cycle. The tree version identifies the cycle and is the concurrency guard. */
export const HarvestTreeRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    expectedTreeVersion: z.number().int().positive()
  })
  .strict();

export const TreeHarvestResultDTOSchema = z
  .object({
    treeInstanceId: TreeInstanceIdSchema,
    itemDefinitionId: ItemDefinitionIdSchema,
    quantityAdded: z.number().int().positive()
  })
  .strict();

/**
 * Removing a tree.
 *
 * Like uprooting a crop, the command carries a request ID and the version the client last saw, and
 * nothing else: there is no reward and no refund to ask for.
 */
export const RemoveTreeRequestSchema = z
  .object({
    requestId: RequestIdSchema,
    expectedTreeVersion: z.number().int().positive()
  })
  .strict();

export const RemoveTreeResponseSchema = z
  .object({ removed: z.object({ treeInstanceId: TreeInstanceIdSchema }).strict() })
  .strict();

export const InventoryEntryDTOSchema = z
  .object({
    itemDefinitionId: ItemDefinitionIdSchema,
    displayNameKey: z.string().min(1).max(120),
    category: ItemCategorySchema,
    quantity: z.number().int().nonnegative()
  })
  .strict();

export const MAX_PROGRESSION_LEVEL = 10_000;

/**
 * A player's level and the experience behind it.
 *
 * level, xpIntoLevel, and xpForNextLevel are all derived by the server from `xp`; they are sent so
 * the client never has to reimplement the curve, and never has to guess how far the next level is.
 */
export const PlayerProgressionDTOSchema = z
  .object({
    level: z.number().int().positive().max(MAX_PROGRESSION_LEVEL),
    xp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    xpIntoLevel: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    xpForNextLevel: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxLevel: z.number().int().min(2).max(MAX_PROGRESSION_LEVEL)
  })
  .strict();

export const XpAwardDTOSchema = z
  .object({
    xpAwarded: z.number().int().positive().max(1_000_000),
    leveledUp: z.boolean(),
    progression: PlayerProgressionDTOSchema
  })
  .strict();

export const HarvestCropResponseSchema = z
  .object({ harvest: HarvestResultDTOSchema, progression: XpAwardDTOSchema })
  .strict();

export const HarvestTreeResponseSchema = z
  .object({ harvest: TreeHarvestResultDTOSchema, progression: XpAwardDTOSchema })
  .strict();
export const GetProgressionResponseSchema = z
  .object({ progression: PlayerProgressionDTOSchema })
  .strict();

/**
 * One crop the server can be asked to plant.
 *
 * `requiredLevel` is always present rather than optional: "no requirement" is level 1, the level
 * every player starts at, so the client never has to infer a rule from a missing field. Crops the
 * player has not unlocked are still sent, because the client has to be able to show why they are
 * unavailable instead of hiding them.
 */
export const CropDefinitionDTOSchema = z
  .object({
    cropDefinitionId: CropDefinitionIdSchema,
    /**
     * The game-data key for this crop's name, which the client translates.
     *
     * It travels so the client renders its planting choices from what this deployment ships instead
     * of from a compiled-in crop list, and so a crop this client has never heard of still appears
     * with a translated or clearly-fallback name.
     */
    displayNameKey: z.string().min(1).max(120),
    growthDurationSeconds: z.number().int().positive().max(31_536_000),
    /** The seed one planting consumes. The client shows the player's count of exactly this item. */
    seedItemDefinitionId: ItemDefinitionIdSchema,
    seedItemDisplayNameKey: z.string().min(1).max(120),
    harvestItemDefinitionId: ItemDefinitionIdSchema,
    baseQuantity: z.number().int().positive().max(1_000_000),
    harvestXp: z.number().int().positive().max(1_000_000),
    requiredLevel: z.number().int().positive().max(MAX_PROGRESSION_LEVEL)
  })
  .strict();

export const GetCropDefinitionsResponseSchema = z
  .object({ definitions: z.array(CropDefinitionDTOSchema) })
  .strict();

export const GetInventoryResponseSchema = z.object({ items: z.array(InventoryEntryDTOSchema) }).strict();

export const MAX_SHOP_COMMAND_QUANTITY = 1_000_000;

const ShopItemCommandSchema = z
  .object({
    requestId: RequestIdSchema,
    shopEntryId: ShopEntryIdSchema,
    quantity: z.number().int().positive().max(MAX_SHOP_COMMAND_QUANTITY)
  })
  .strict();

export const BuyItemRequestSchema = ShopItemCommandSchema;
export const SellItemRequestSchema = ShopItemCommandSchema;

export const BuyItemResultDTOSchema = z
  .object({
    itemDefinitionId: ItemDefinitionIdSchema,
    quantity: z.number().int().positive(),
    currencyId: CurrencyDefinitionIdSchema,
    amountSpent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    newBalance: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict();

export const SellItemResultDTOSchema = z
  .object({
    itemDefinitionId: ItemDefinitionIdSchema,
    quantity: z.number().int().positive(),
    currencyId: CurrencyDefinitionIdSchema,
    amountReceived: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    newBalance: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict();

export const ShopEntryDTOSchema = z
  .object({
    shopEntryId: ShopEntryIdSchema,
    itemDefinitionId: ItemDefinitionIdSchema,
    itemDisplayNameKey: z.string().min(1).max(120),
    category: ItemCategorySchema,
    currencyId: CurrencyDefinitionIdSchema,
    currencyDisplayNameKey: z.string().min(1).max(120),
    /**
     * Null means this entry does not trade that way, so the client renders no button for it rather
     * than a disabled one. Prices stay server-owned: the command carries an entry ID and a quantity.
     */
    buyPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    sellPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    maxQuantityPerRequest: z.number().int().positive().max(MAX_SHOP_COMMAND_QUANTITY)
  })
  .strict()
  // An entry that trades neither way is not a market row, so the client is never handed one it
  // would have to render as a name with no action.
  .refine((entry) => entry.buyPrice !== null || entry.sellPrice !== null, {
    message: "A shop entry must offer a buy price, a sell price, or both"
  });

export const GetShopResponseSchema = z.object({ entries: z.array(ShopEntryDTOSchema) }).strict();

export const WalletDTOSchema = z
  .object({
    currencyId: CurrencyDefinitionIdSchema,
    displayNameKey: z.string().min(1).max(120),
    balance: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict();

export const GetWalletResponseSchema = z.object({ wallets: z.array(WalletDTOSchema) }).strict();

/**
 * The deepest plot index a catalogue may define. Mirrors `MAX_PLOT_INDEX` in `@happy-farm/game-data`,
 * which is what a deployment actually ships; a game-data contract test keeps the two equal.
 */
export const MAX_PLOT_INDEX = 256;

/**
 * One piece of land a farm can buy, and whether this farm already owns it.
 *
 * Prices and level requirements are server data the client only displays: the expansion command
 * carries a request ID and nothing else, so the client can never name a price, a currency, or a plot.
 */
export const PlotDTOSchema = z
  .object({
    plotId: PlotIdSchema,
    plotIndex: z.number().int().min(1).max(MAX_PLOT_INDEX),
    currencyId: CurrencyDefinitionIdSchema,
    currencyDisplayNameKey: z.string().min(1).max(120),
    price: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requiredLevel: z.number().int().positive().max(MAX_PROGRESSION_LEVEL),
    unlocked: z.boolean()
  })
  .strict();

export const GetPlotsResponseSchema = z.object({ plots: z.array(PlotDTOSchema) }).strict();

export const ExpandFarmRequestSchema = z
  .object({
    requestId: RequestIdSchema
  })
  .strict();

export const ExpandFarmResultDTOSchema = z
  .object({
    plotId: PlotIdSchema,
    plotIndex: z.number().int().min(1).max(MAX_PLOT_INDEX),
    currencyId: CurrencyDefinitionIdSchema,
    amountSpent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    newBalance: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    tilesAdded: z.number().int().positive().max(1_000_000)
  })
  .strict();

export const ExpandFarmResponseSchema = z.object({ expansion: ExpandFarmResultDTOSchema }).strict();

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
  "CROP_LEVEL_REQUIRED",
  "ITEM_DEFINITION_NOT_FOUND",
  "INVENTORY_LIMIT_EXCEEDED",
  "CURRENCY_DEFINITION_NOT_FOUND",
  "SHOP_ENTRY_NOT_FOUND",
  "SHOP_ENTRY_NOT_ALLOWED",
  "PLOT_LEVEL_REQUIRED",
  "PLOT_LIMIT_REACHED",
  "INVALID_QUANTITY",
  "WALLET_LIMIT_EXCEEDED",
  "ECONOMY_CONFLICT",
  "PROGRESSION_CONFLICT",
  "CROP_NOT_READY",
  "TREE_DEFINITION_NOT_FOUND",
  "TREE_NOT_FOUND",
  "TREE_NOT_READY",
  "TREE_LEVEL_REQUIRED",
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
export type UprootCropRequest = z.infer<typeof UprootCropRequestSchema>;
export type UprootCropResponse = z.infer<typeof UprootCropResponseSchema>;
export type HarvestResultDTO = z.infer<typeof HarvestResultDTOSchema>;
export type PlayerProgressionDTO = z.infer<typeof PlayerProgressionDTOSchema>;
export type XpAwardDTO = z.infer<typeof XpAwardDTOSchema>;
export type CropDefinitionDTO = z.infer<typeof CropDefinitionDTOSchema>;
export type InventoryEntryDTO = z.infer<typeof InventoryEntryDTOSchema>;
export type BuyItemRequest = z.infer<typeof BuyItemRequestSchema>;
export type SellItemRequest = z.infer<typeof SellItemRequestSchema>;
export type BuyItemResultDTO = z.infer<typeof BuyItemResultDTOSchema>;
export type SellItemResultDTO = z.infer<typeof SellItemResultDTOSchema>;
export type ShopEntryDTO = z.infer<typeof ShopEntryDTOSchema>;
export type WalletDTO = z.infer<typeof WalletDTOSchema>;
export type PlotDTO = z.infer<typeof PlotDTOSchema>;
export type GetPlotsResponse = z.infer<typeof GetPlotsResponseSchema>;
export type ExpandFarmRequest = z.infer<typeof ExpandFarmRequestSchema>;
export type ExpandFarmResultDTO = z.infer<typeof ExpandFarmResultDTOSchema>;
export type TreeDefinitionDTO = z.infer<typeof TreeDefinitionDTOSchema>;
export type GetTreeDefinitionsResponse = z.infer<typeof GetTreeDefinitionsResponseSchema>;
export type TreeStateDTO = z.infer<typeof TreeStateDTOSchema>;
export type PlantTreeRequest = z.infer<typeof PlantTreeRequestSchema>;
export type PlantTreeResponse = z.infer<typeof PlantTreeResponseSchema>;
export type GetFarmTreesResponse = z.infer<typeof GetFarmTreesResponseSchema>;
export type HarvestTreeRequest = z.infer<typeof HarvestTreeRequestSchema>;
export type TreeHarvestResultDTO = z.infer<typeof TreeHarvestResultDTOSchema>;
export type HarvestTreeResponse = z.infer<typeof HarvestTreeResponseSchema>;
export type RemoveTreeRequest = z.infer<typeof RemoveTreeRequestSchema>;
export type RemoveTreeResponse = z.infer<typeof RemoveTreeResponseSchema>;

export type ApiSuccess<T> = { readonly ok: true; readonly data: T };
export type ApiFailure = {
  readonly ok: false;
  readonly error: { readonly code: ErrorCode; readonly requestId?: string };
};
