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

/**
 * How the caller is currently authenticated, as the session endpoint reports it.
 *
 * The client never sends this and never decides it: it is how the page can say "Playing as Guest",
 * and how a future account-linking control will know whether it has anything to link. `GUEST` is an
 * anonymous credential that resolves to a real player, not a temporary or throwaway farm.
 */
export const IdentityKindSchema = z.enum(["GUEST", "CLOUDFLARE_ACCESS", "GOOGLE", "EMAIL"]);
export const SessionPlayerDTOSchema = z
  .object({ playerId: PlayerIdSchema, kind: IdentityKindSchema })
  .strict();
export const GetSessionResponseSchema = z.object({ player: SessionPlayerDTOSchema }).strict();

/**
 * Where gameplay happens.
 *
 * A player is not a farm and a farm is not the world: the long-term model is World -> Region -> Zone,
 * and a player *is present in* a zone rather than *owning* it. Today there is exactly one kind of place
 * - the player's own island, which is their farm - but interaction code must not be written in a way
 * that cannot be moved to a fishing ground or a shared resource island later.
 *
 * The list is deliberately the full vocabulary rather than only what is used: it is a contract, and a
 * reader of this file should be able to see the shape of the world that is coming. `SHARED_FISHING`,
 * `SHARED_RESOURCE`, `CONTESTED`, `PORT` and `EVENT` are named here and implemented nowhere yet.
 */
export const ZONE_KINDS = [
  "HOME_ISLAND",
  "PLAYER_ISLAND",
  "SHARED_FISHING",
  "SHARED_RESOURCE",
  "CONTESTED",
  "PORT",
  "EVENT"
] as const;
export const ZoneKindSchema = z.enum(ZONE_KINDS);

/**
 * A *reference* to a place: what kind of place it is, and which one.
 *
 * It is a location descriptor and nothing else. It carries no player, no owner, no role and no
 * permission, and receiving one from a client must never be read as a claim of authority - see
 * `docs/design/WORLD_ARCHITECTURE.md`. Authority is decided server-side from the authenticated actor
 * and the resource, exactly as it was before this existed.
 */
export const ZoneRefSchema = z
  .object({
    kind: ZoneKindSchema,
    // Segments joined by `_`, with hyphens allowed inside one so a zone derived from a `farm_<uuid>`
    // stays readable rather than being hashed into something unparseable.
    zoneId: z.string().regex(/^zone_[a-z0-9]+(?:[_-][a-z0-9]+)*$/)
  })
  .strict();

/** The prefix a home island's zone id carries, so the farm it was derived from is readable. */
export const HOME_ISLAND_ZONE_PREFIX = "zone_home_island_";

/**
 * The zone the current farm *is*, for as long as one farm is one island.
 *
 * Deriving the zone from the farm (and never the other way round) is what keeps this pass from
 * duplicating persistent state: no island table, no coordinates, no second copy of the land. When the
 * world map arrives, a farm's island becomes one zone among many and this function becomes the adapter
 * that already exists rather than the assumption that has to be unpicked.
 */
export function homeIslandZoneRef(farmId: string): ZoneRef {
  return { kind: "HOME_ISLAND", zoneId: `${HOME_ISLAND_ZONE_PREFIX}${farmId}` };
}

/**
 * The farm a home-island zone was derived from, or null for any other kind of place.
 *
 * A *lookup*, never a permission: resolving a zone to a farm says which land was meant, and says
 * nothing about who may act on it. Any future caller that is tempted to turn this into "so the caller
 * owns it" is the exact mistake this architecture exists to prevent.
 */
export function farmIdFromHomeIslandZone(zone: ZoneRef): string | null {
  if (zone.kind !== "HOME_ISLAND") return null;
  if (!zone.zoneId.startsWith(HOME_ISLAND_ZONE_PREFIX)) return null;
  const farmId = zone.zoneId.slice(HOME_ISLAND_ZONE_PREFIX.length);
  return farmId.length === 0 ? null : farmId;
}

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
export const ItemCategorySchema = z.enum(["CROP", "SEED", "FISH", "MATERIAL"]);

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

/**
 * One row of the build catalogue: something a player can place, and what it costs to place it.
 *
 * Read-only reference data, like a crop definition. It travels so the client renders the shop from
 * what the deployment ships rather than from a compiled-in list, and so an entry this client has never
 * heard of still appears with a translated or fallback name.
 *
 * What it is **not**: a purchase. There is no order, no quantity, and no settlement here - a player
 * placing something is a command the server does not yet accept, and the panel that shows this list
 * says so rather than pretending a click bought something.
 */
export const BuildCatalogEntryDTOSchema = z
  .object({
    entryId: z.string().regex(/^place_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    category: z.enum([
      "ROAD",
      "BUILDING",
      "DECORATION",
      "VEGETATION",
      "UTILITY",
      "MONUMENT",
      "FENCE",
      "LIGHTING",
      "WATERFRONT"
    ]),
    displayNameKey: z.string().min(1).max(120),
    /**
     * A readable default, so an entry the client has no translation for still has a name. The client
     * prefers a translation of `displayNameKey` when it has one.
     */
    label: z.string().min(1).max(80),
    descriptionKey: z.string().min(1).max(120).nullable(),
    /** The asset the client resolves, or null when the entry draws as a placeholder. */
    modelId: z.string().min(1).max(120).nullable(),
    /** The level a player must have reached before this may be placed. */
    requiredLevel: z.number().int().min(1).max(1_000),
    price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currencyDefinitionId: z.string().min(1).max(120),
    footprint: z
      .object({ widthCells: z.number().int().positive(), depthCells: z.number().int().positive() })
      .strict(),
    /**
     * The ground this entry may stand on, and the whole of its land requirement.
     *
     * Physical terrain only: `LAND`, `SHORE`, the `SHALLOW_WATER` a moored asset needs, open `WATER`.
     * There is deliberately no economic district here - normal owned land takes normal assets.
     */
    allowedTerrain: z.array(z.enum(["LAND", "SHORE", "SHALLOW_WATER", "WATER"])).min(1),
    /** The tier within the entry's own ladder, or null when it has none. */
    tier: z.string().min(1).max(40).nullable(),
    /**
     * Where that tier sits in its ladder, 1-based, or null when the entry has no ladder.
     *
     * Sent so a shop can say "Tier 3" instead of showing the id it happens to be keyed by: an id is
     * data, and a player reading a card should be reading a name.
     */
    tierRank: z.number().int().min(1).max(8).nullable(),
    /**
     * What the thing does, as data: its classification, its structured effects, and whether those
     * effects are live yet. Presentation reads it; the server's placement rules read it; a client may
     * never invent it.
     */
    gameplay: z
      .object({
        classification: z.enum([
          "COSMETIC",
          "PRODUCTION",
          "STORAGE",
          "INFRASTRUCTURE",
          "WORKER_CAPACITY",
          "PROCESSING",
          "UTILITY"
        ]),
        status: z.enum(["ACTIVE", "FOUNDATION_ONLY", "PREVIEW_ONLY"]),
        summaryKey: z.string().min(1).max(120),
        production: z
          .object({
            output: z.enum(["GOLD", "FOOD", "WOOD", "STONE"]),
            minYield: z.number().int().positive(),
            maxYield: z.number().int().positive(),
            firstYieldSeconds: z.number().int().positive(),
            regrowSeconds: z.number().int().positive().nullable(),
            input: z
              .object({ resource: z.enum(["GOLD", "FOOD", "WOOD", "STONE"]), amount: z.number().int().positive() })
              .strict()
              .nullable(),
            requiredCapability: z.string().min(1).max(40),
            workerRole: z.enum(["FARM_WORKER", "FORESTRY_WORKER", "FISHERY_WORKER"]).nullable()
          })
          .strict()
          .nullable(),
        storage: z
          .object({
            // Partial by design: a silo holds food and nothing else.
            capacity: z.record(z.string(), z.number().int().positive())
          })
          .strict()
          .nullable(),
        movement: z.object({ multiplier: z.number().min(1).max(3) }).strict().nullable(),
        workerTask: z
          .object({
            taskType: z.enum(["PLANT", "HARVEST", "FEED", "COLLECT"]),
            workerRole: z.enum(["FARM_WORKER", "FORESTRY_WORKER", "FISHERY_WORKER"])
          })
          .strict()
          .nullable()
      })
      .strict(),
    /** The entry this one upgrades into, or null at the top of its ladder. */
    upgradeTo: z.string().min(1).max(120).nullable(),
    rotatable: z.boolean(),
    /** Whether the player may move it, and remove it, and what a removal returns. */
    movable: z.boolean(),
    storable: z.boolean(),
    removable: z.boolean(),
    removalRefundRate: z.number().min(0).max(1),
    decorative: z.boolean(),
    tags: z.array(z.string().min(1).max(40)).max(8),
    /** What must be true of the world before it may be placed. */
    unlockCondition: z.enum(["NONE", "OWNED_LAND"])
  })
  .strict();

export type BuildCatalogEntryDTO = z.infer<typeof BuildCatalogEntryDTOSchema>;

export const GetBuildCatalogResponseSchema = z
  .object({ entries: z.array(BuildCatalogEntryDTOSchema) })
  .strict();

/** The four quarter turns a construction may be saved with. */
export const ConstructionRotationSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/**
 * A construction's id, in the one shape the server mints.
 *
 * Worth naming rather than repeating: it is what a *path* segment has to be before a route may hand
 * it to the domain, so a malformed url is a 400 rather than an internal error.
 */
export const ConstructionIdSchema = z.string().regex(/^construct_[0-9a-f-]{36}$/i);

/**
 * A construction the player has actually built.
 *
 * One shape for every buildable thing: the catalogue entry says what it is, this says where it is and
 * who paid for it. `costAmount` is recorded here for audit; the ledger records the same amount from
 * the other side of the same transaction.
 */
export const ConstructionDTOSchema = z
  .object({
    constructionId: ConstructionIdSchema,
    farmId: FarmIdSchema,
    /**
     * What the object is: a catalogue entry a player bought (`place_*`) or an ordinary world object
     * (`world.*`) such as a starter tree. One id space with two namespaces, because both are edited
     * by the same commands and drawn by the same layer.
     */
    entryId: z.string().regex(/^(place_[a-z0-9]+(?:_[a-z0-9]+)*|world\.[a-z0-9]+(?:_[a-z0-9]+)*)$/),
    category: z.string().min(1).max(40),
    /**
     * Where the object stands, in tile coordinates.
     *
     * Fractional, because the island's own objects stand at a world position rather than on the grid:
     * a tree the generator grew, an authored building. A player's edit still lands on a cell, so a
     * row the player moved is always whole - but the arrangement the island starts with is not, and
     * rounding it would re-plant the whole island on a lattice.
     */
    anchorX: z.number().min(-1_000_000).max(1_000_000),
    anchorY: z.number().min(-1_000_000).max(1_000_000),
    rotation: ConstructionRotationSchema,
    footprint: z
      .object({ widthCells: z.number().int().positive(), depthCells: z.number().int().positive() })
      .strict(),
    /** Standing on the island, or held in the player's storage. */
    state: z.enum(["ACTIVE", "STORED"]),
    /** Where it came from. It never decides what may be done to it. */
    source: z.enum(["STARTER", "PLAYER_PLACED"]),
    /** A starter placement's stable identity, or null for anything a player placed. */
    placementKey: z.string().min(3).max(80).nullable(),
    /**
     * What the object actually cost its owner.
     *
     * A starter object paid for by nobody carries zero, which is why removing one can refund nothing
     * however valuable its catalogue entry is. The client shows a refund preview from this number and
     * never from the price.
     */
    paidAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    costAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    costCurrencyDefinitionId: z.string().min(1).max(120),
    createdAt: z.string().min(1).max(40),
    /** When it was put into storage, or null while it stands on the island. */
    storedAt: z.string().min(1).max(40).nullable(),
    /**
     * The row's version, which every edit command echoes back.
     *
     * A move, a turn or a removal is applied only if the version the client is editing is still the
     * version on the server, so two players (or two tabs) cannot both move the same barn.
     */
    version: z.number().int().min(1)
  })
  .strict();
export type ConstructionDTO = z.infer<typeof ConstructionDTOSchema>;

/**
 * A placement command: what to build, where, and which way round.
 *
 * The client sends **nothing** about price, level, effects or capability - only which catalogue entry
 * it means and where it pointed. The request id is the idempotency key, exactly as planting's is.
 */
export const PlaceConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    entryId: z.string().regex(/^place_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    anchorX: z.number().int().min(-1_000_000).max(1_000_000),
    anchorY: z.number().int().min(-1_000_000).max(1_000_000),
    rotation: ConstructionRotationSchema
  })
  .strict();
export type PlaceConstructionRequest = z.infer<typeof PlaceConstructionRequestSchema>;

export const PlaceConstructionResponseSchema = z
  .object({ construction: ConstructionDTOSchema })
  .strict();

export const GetFarmConstructionsResponseSchema = z
  .object({ constructions: z.array(ConstructionDTOSchema) })
  .strict();

/**
 * One ordinary world object a farm may hold: a starter tree, a rock, the mill.
 *
 * Read-only reference data like the crop catalogue, and the reason a client can draw and describe an
 * object it never bought: the definition says what the object is and what may be done to it, and the
 * instance row says where it is.
 */
export const WorldObjectDefinitionDTOSchema = z
  .object({
    id: z.string().regex(/^world\.[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().min(1).max(120),
    /** The `.glb` the client resolves, or null when the object is drawn from a landmark builder. */
    modelId: z.string().min(1).max(120).nullable(),
    /** The landmark kind the renderer builds it from, when it has no model. */
    landmarkKind: z.string().min(1).max(40).nullable(),
    sizeWorld: z.number().positive().max(1_000),
    /**
     * The circle a walker goes around, in world metres.
     *
     * The definition's own number: a tree blocks by its trunk, a rock by its boulder, and a flower
     * patch by nothing at all. The client's collision world reads it from here rather than guessing a
     * circle from the footprint, so what stops the player is what the object *is*.
     */
    collisionRadiusWorld: z.number().min(0).max(1_000),
    footprint: z
      .object({ widthCells: z.number().int().positive(), depthCells: z.number().int().positive() })
      .strict(),
    /** The ground this world object may stand on. */
    allowedTerrain: z.array(z.enum(["LAND", "SHORE", "SHALLOW_WATER", "WATER"])).min(1),
    movable: z.boolean(),
    rotatable: z.boolean(),
    storable: z.boolean(),
    removable: z.boolean(),
    removalRefundRate: z.number().min(0).max(1)
    ,
    /**
     * The gameplay service this object stands for, or null for one that is only itself.
     *
     * `FARM_MARKET` is the first: a market stall is a place a character can walk up to and trade at.
     * The capability travels as data so the interaction layer never learns a model name, and so a
     * second stall - or a stall on another island - is a row in game data and nothing else.
     */
    service: z.enum(["FARM_MARKET"]).nullable()
  })
  .strict();
export type WorldObjectDefinitionDTO = z.infer<typeof WorldObjectDefinitionDTOSchema>;

export const GetWorldObjectsResponseSchema = z
  .object({ objects: z.array(WorldObjectDefinitionDTOSchema) })
  .strict();

/** The version of the row an edit is acting on: the optimistic-concurrency token. */
const ConstructionVersionSchema = z.number().int().min(1);

/**
 * Moving something the player already owns.
 *
 * `expectedVersion` is the version the client is looking at. It sends a destination and a rotation
 * and nothing else - never a price, a refund, a footprint or an owner, all of which the server reads
 * from its own catalogue and its own rows.
 */
export const MoveConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    anchorX: z.number().int().min(-1_000_000).max(1_000_000),
    anchorY: z.number().int().min(-1_000_000).max(1_000_000),
    rotation: ConstructionRotationSchema,
    expectedVersion: ConstructionVersionSchema
  })
  .strict();
export type MoveConstructionRequest = z.infer<typeof MoveConstructionRequestSchema>;

/** Turning something in place. The anchor is unchanged, so only the rotation travels. */
export const RotateConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    rotation: ConstructionRotationSchema,
    expectedVersion: ConstructionVersionSchema
  })
  .strict();
export type RotateConstructionRequest = z.infer<typeof RotateConstructionRequestSchema>;

/** Removing something: the command carries the version and nothing else at all. */
export const RemoveConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    expectedVersion: ConstructionVersionSchema
  })
  .strict();
export type RemoveConstructionRequest = z.infer<typeof RemoveConstructionRequestSchema>;

/** Putting an object into storage: the version, and nothing else. */
export const StoreConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    expectedVersion: ConstructionVersionSchema
  })
  .strict();
export type StoreConstructionRequest = z.infer<typeof StoreConstructionRequestSchema>;

/** Taking an object back out of storage: where, which way round, and which version. */
export const RestoreConstructionRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    anchorX: z.number().int().min(-1_000_000).max(1_000_000),
    anchorY: z.number().int().min(-1_000_000).max(1_000_000),
    rotation: ConstructionRotationSchema,
    expectedVersion: ConstructionVersionSchema
  })
  .strict();
export type RestoreConstructionRequest = z.infer<typeof RestoreConstructionRequestSchema>;

export const ConstructionEditResponseSchema = z
  .object({ construction: ConstructionDTOSchema })
  .strict();

/**
 * What a removal returned, as the server computed it.
 *
 * The client shows this number *after* the fact rather than predicting it: the rate is the asset's
 * own data, and a client that guessed it would be telling the player about gold it does not control.
 */
export const RemoveConstructionResponseSchema = z
  .object({
    constructionId: ConstructionIdSchema,
    refundAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    refundCurrencyDefinitionId: z.string().min(1).max(120)
  })
  .strict();
export type RemoveConstructionResponse = z.infer<typeof RemoveConstructionResponseSchema>;

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

/** One material the next warehouse upgrade consumes. */
export const WarehouseMaterialCostSchema = z
  .object({
    itemDefinitionId: z.string().regex(/^item_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    quantity: z.number().int().positive()
  })
  .strict();

export const WarehouseUpgradeCostDTOSchema = z
  .object({
    currencyId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    gold: z.number().int().nonnegative(),
    materials: z.array(WarehouseMaterialCostSchema)
  })
  .strict();

/**
 * The warehouse as the client sees it. Capacity, usage and the next cost are all server values; the
 * client only draws them.
 */
export const WarehouseStatusDTOSchema = z
  .object({
    tier: z.number().int().min(0),
    capacity: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    overCapacity: z.boolean(),
    nextTier: z.number().int().min(0).nullable(),
    nextUpgrade: WarehouseUpgradeCostDTOSchema.nullable()
  })
  .strict();

export const GetWarehouseResponseSchema = z.object({ warehouse: WarehouseStatusDTOSchema }).strict();

export const UpgradeWarehouseRequestSchema = z.object({ requestId: z.string().min(8).max(100) }).strict();

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
  "WAREHOUSE_FULL",
  "WAREHOUSE_MAX_TIER",
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
  "CONSTRUCTION_NOT_FOUND",
  "CONSTRUCTION_NOT_ALLOWED",
  "CONSTRUCTION_LEVEL_REQUIRED",
  "CONSTRUCTION_OCCUPIED",
  "CONSTRUCTION_NOT_OWNED",
  "CONSTRUCTION_UNSUITABLE_GROUND",
  "CONSTRUCTION_BLOCKED",
  "CONSTRUCTION_OUTSIDE_WORLD",
  "CONSTRUCTION_NOT_MOVABLE",
  "CONSTRUCTION_NOT_ROTATABLE",
  "CONSTRUCTION_NOT_REMOVABLE",
  "CONSTRUCTION_NOT_STORABLE",
  "CONSTRUCTION_NOT_STORED",
  "CONSTRUCTION_CONFLICT",
  "OBJECT_NOT_OWNED",
  "FISHING_SPOT_NOT_FOUND",
  "FISHING_ACTION_NOT_FOUND",
  "FISHING_ZONE_NOT_ALLOWED",
  "FISHING_SPOT_DISABLED",
  "FISHING_ALREADY_ACTIVE",
  "FISHING_NOT_READY",
  "FISHING_ACTION_NOT_ACTIVE",
  "FISHING_CONFLICT",
  "RESOURCE_NODE_NOT_FOUND",
  "RESOURCE_ACTION_NOT_FOUND",
  "RESOURCE_ZONE_NOT_ALLOWED",
  "RESOURCE_NODE_DEPLETED",
  "RESOURCE_LEVEL_REQUIRED",
  "RESOURCE_ALREADY_ACTIVE",
  "RESOURCE_NOT_READY",
  "RESOURCE_ACTION_NOT_ACTIVE",
  "RESOURCE_CONFLICT",
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
export type WarehouseStatusDTO = z.infer<typeof WarehouseStatusDTOSchema>;
export type GetWarehouseResponse = z.infer<typeof GetWarehouseResponseSchema>;
export type UpgradeWarehouseRequest = z.infer<typeof UpgradeWarehouseRequestSchema>;
export type IdentityKindDTO = z.infer<typeof IdentityKindSchema>;
export type SessionPlayerDTO = z.infer<typeof SessionPlayerDTOSchema>;
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;
export type ZoneKind = z.infer<typeof ZoneKindSchema>;
export type ZoneRef = z.infer<typeof ZoneRefSchema>;
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

/**
 * Fishing: the water, the species, and the action.
 *
 * Reading the catalogue is a pure projection of game data (the client draws the spots and names the
 * fish from it), while starting and settling an action are commands the server settles. Nothing a
 * client sends ever names a fish, a price, or a reward: a start names a *spot*, and a settle names the
 * server's own action id.
 */
export const FishingSpotDTOSchema = z
  .object({
    spotId: z.string().regex(/^spot_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().min(1).max(120),
    /** The zone kind the spot stands in. Today always `HOME_ISLAND`; the field is what keeps it explicit. */
    zoneKind: ZoneKindSchema,
    /** Fractional tile coordinates: the client converts them with the same frame as every other thing. */
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    interactionRadiusTiles: z.number().positive().max(12),
    tableId: z.string().regex(/^fishtable_[a-z0-9]+(?:_[a-z0-9]+)*$/)
  })
  .strict();

export const FishDefinitionDTOSchema = z
  .object({
    fishDefinitionId: z.string().regex(/^fish_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().min(1).max(120),
    itemDefinitionId: ItemDefinitionIdSchema,
    itemDisplayNameKey: z.string().min(1).max(120),
    /** The generated model the inventory card renders; `null` when this build has no art for it. */
    modelId: z.string().min(1).max(120).nullable(),
    sellPrice: z.number().int().positive().max(1_000_000),
    xp: z.number().int().positive().max(1_000_000),
    requiredLevel: z.number().int().positive().max(MAX_PROGRESSION_LEVEL)
  })
  .strict();

export const GetFishingResponseSchema = z
  .object({ spots: z.array(FishingSpotDTOSchema), fish: z.array(FishDefinitionDTOSchema) })
  .strict();

export const StartFishingRequestSchema = z
  .object({ requestId: RequestIdSchema, spotId: FishingSpotDTOSchema.shape.spotId })
  .strict();

export const FishingActionDTOSchema = z
  .object({
    actionId: z.string().regex(/^fishact_[0-9a-f-]{36}$/i),
    zone: ZoneRefSchema,
    spotId: z.string().regex(/^spot_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    tableId: z.string().regex(/^fishtable_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    status: z.enum(["ACTIVE", "SETTLED", "CANCELLED"]),
    startedAt: z.iso.datetime(),
    readyAt: z.iso.datetime(),
    secondsUntilReady: z.number().int().nonnegative(),
    version: z.number().int().positive()
  })
  .strict();

export const StartFishingResponseSchema = z.object({ action: FishingActionDTOSchema }).strict();
export const GetActiveFishingResponseSchema = z
  .object({ action: FishingActionDTOSchema.nullable() })
  .strict();

export const SettleFishingRequestSchema = z
  .object({ requestId: RequestIdSchema, expectedActionVersion: z.number().int().positive() })
  .strict();

export const FishingCatchDTOSchema = z
  .object({ itemDefinitionId: ItemDefinitionIdSchema, quantity: z.number().int().positive() })
  .strict();

export const SettleFishingResponseSchema = z
  .object({ catch: FishingCatchDTOSchema, progression: XpAwardDTOSchema })
  .strict();

export const CancelFishingRequestSchema = z
  .object({ requestId: RequestIdSchema, expectedActionVersion: z.number().int().positive() })
  .strict();

export const CancelFishingResponseSchema = z.object({ cancelled: z.literal(true) }).strict();

export type FishingSpotDTO = z.infer<typeof FishingSpotDTOSchema>;
export type FishDefinitionDTO = z.infer<typeof FishDefinitionDTOSchema>;
export type GetFishingResponse = z.infer<typeof GetFishingResponseSchema>;
export type FishingActionDTO = z.infer<typeof FishingActionDTOSchema>;
export type StartFishingRequest = z.infer<typeof StartFishingRequestSchema>;
export type StartFishingResponse = z.infer<typeof StartFishingResponseSchema>;
export type SettleFishingRequest = z.infer<typeof SettleFishingRequestSchema>;
export type FishingCatchDTO = z.infer<typeof FishingCatchDTOSchema>;
export type SettleFishingResponse = z.infer<typeof SettleFishingResponseSchema>;
export type CancelFishingRequest = z.infer<typeof CancelFishingRequestSchema>;

/**
 * Resource nodes: what stands where, whether it is ready, and the gather commands.
 *
 * The catalogue carries both halves the client needs - the static definition and placement, and the
 * actor's own zone's availability - because a node's *availability* is mutable state, unlike a fishing
 * spot's position. Everything else is the server's: the drop, the quantity, the experience, the
 * depletion and the regeneration clock.
 */
export const ResourceNodeDTOSchema = z
  .object({
    nodeId: z.string().regex(/^node_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    definitionId: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    displayNameKey: z.string().min(1).max(120),
    verb: z.enum(["MINE", "CHOP"]),
    zoneKind: ZoneKindSchema,
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    interactionRadiusTiles: z.number().positive().max(12),
    actionSeconds: z.number().int().positive().max(600),
    modelId: z.string().min(1).max(120),
    /** What a depleted node draws instead, or null when the renderer shrinks the full model. */
    depletedModelId: z.string().min(1).max(120).nullable(),
    /** The material this node yields, so the client can draw that material with the node's art. */
    dropItemDefinitionId: ItemDefinitionIdSchema,
    requiredLevel: z.number().int().positive().max(MAX_PROGRESSION_LEVEL),
    /** When this node is next available, or null when it has never been gathered. */
    availableAt: z.iso.datetime().nullable(),
    secondsUntilAvailable: z.number().int().nonnegative(),
    available: z.boolean()
  })
  .strict();

export const GetResourceNodesResponseSchema = z.object({ nodes: z.array(ResourceNodeDTOSchema) }).strict();

export const ResourceActionDTOSchema = z
  .object({
    actionId: z.string().regex(/^resact_[0-9a-f-]{36}$/i),
    zone: ZoneRefSchema,
    nodeId: z.string().regex(/^node_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    definitionId: z.string().regex(/^resource_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    verb: z.enum(["MINE", "CHOP"]),
    status: z.enum(["ACTIVE", "SETTLED", "CANCELLED"]),
    startedAt: z.iso.datetime(),
    readyAt: z.iso.datetime(),
    secondsUntilReady: z.number().int().nonnegative(),
    version: z.number().int().positive()
  })
  .strict();

export const StartResourceActionRequestSchema = z
  .object({ requestId: RequestIdSchema, nodeId: ResourceNodeDTOSchema.shape.nodeId })
  .strict();
export const StartResourceActionResponseSchema = z.object({ action: ResourceActionDTOSchema }).strict();

export const GetActiveResourceActionResponseSchema = z
  .object({ action: ResourceActionDTOSchema.nullable() })
  .strict();

export const SettleResourceActionRequestSchema = z
  .object({ requestId: RequestIdSchema, expectedActionVersion: z.number().int().positive() })
  .strict();

export const ResourceDropDTOSchema = z
  .object({ itemDefinitionId: ItemDefinitionIdSchema, quantity: z.number().int().positive() })
  .strict();

export const SettleResourceActionResponseSchema = z
  .object({
    drop: ResourceDropDTOSchema,
    node: z
      .object({
        nodeId: z.string().regex(/^node_[a-z0-9]+(?:_[a-z0-9]+)*$/),
        availableAt: z.iso.datetime()
      })
      .strict(),
    progression: XpAwardDTOSchema
  })
  .strict();

export const CancelResourceActionRequestSchema = z
  .object({ requestId: RequestIdSchema, expectedActionVersion: z.number().int().positive() })
  .strict();
export const CancelResourceActionResponseSchema = z.object({ cancelled: z.literal(true) }).strict();

export type ResourceNodeDTO = z.infer<typeof ResourceNodeDTOSchema>;
export type ResourceActionDTO = z.infer<typeof ResourceActionDTOSchema>;
export type StartResourceActionResponse = z.infer<typeof StartResourceActionResponseSchema>;
export type StartResourceActionRequest = z.infer<typeof StartResourceActionRequestSchema>;
export type SettleResourceActionRequest = z.infer<typeof SettleResourceActionRequestSchema>;
export type ResourceDropDTO = z.infer<typeof ResourceDropDTOSchema>;
export type SettleResourceActionResponse = z.infer<typeof SettleResourceActionResponseSchema>;

export type ApiSuccess<T> = { readonly ok: true; readonly data: T };
export type ApiFailure = {
  readonly ok: false;
  readonly error: { readonly code: ErrorCode; readonly requestId?: string };
};
