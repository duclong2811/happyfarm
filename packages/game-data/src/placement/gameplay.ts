import { z } from "zod";
import { ROAD_TIERS, roadTiers, type RoadTierId } from "../roads";
import { placementEntries } from "./catalog";

/**
 * What a buildable thing *does*, as data.
 *
 * The shop sells two very different kinds of object, and V12.5 blurred them: a decorative broadleaf
 * tree and a timber plantation are both "a tree" to the catalogue, and the inventory of what a player
 * could actually *do* with either was prose in a design note. This module is that answer, structured,
 * per entry, and validated:
 *
 * * **classification** - what kind of thing it is (decoration, production, storage, infrastructure,
 *   worker capacity, processing, utility). Campaigns and filters read it; the shop labels it.
 * * **effects** - the numbers a player would ask about (what comes out, how much, how long, how much
 *   it holds), in the shape the future systems will consume.
 * * **status** - whether the effect is *live* today. `ACTIVE` requires authoritative data, a server
 *   that uses it, gameplay that reflects it, and a test; everything else is `FOUNDATION_ONLY` or
 *   `PREVIEW_ONLY`, and the shop must not present a foundation as if it were running.
 *
 * Nothing here is player state: it is the definition a `ConstructionInstance` points at, exactly as a
 * `crop_instances` row points at a crop definition rather than copying it.
 */

export const GAMEPLAY_CLASSIFICATIONS = [
  "COSMETIC",
  "PRODUCTION",
  "STORAGE",
  "INFRASTRUCTURE",
  "WORKER_CAPACITY",
  "PROCESSING",
  "UTILITY"
] as const;
export type GameplayClassification = (typeof GAMEPLAY_CLASSIFICATIONS)[number];

/**
 * How live an effect is.
 *
 * `ACTIVE` is a claim: game data defines it, the server reads it, gameplay reflects it, and a test
 * proves it. `FOUNDATION_ONLY` means the data exists and the shop may describe it *as planned*, and
 * `PREVIEW_ONLY` means the thing cannot even be built yet.
 */
export const GAMEPLAY_STATUSES = ["ACTIVE", "FOUNDATION_ONLY", "PREVIEW_ONLY"] as const;
export type GameplayStatus = (typeof GAMEPLAY_STATUSES)[number];

/** The resource a production cycle yields. Small on purpose: gold, food, wood, stone. */
export const RESOURCE_IDS = ["GOLD", "FOOD", "WOOD", "STONE"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const ProductionEffectSchema = z
  .object({
    output: z.enum(RESOURCE_IDS),
    /** A fixed yield is `min === max`; a range is only ever declared when the rules roll. */
    minYield: z.number().int().positive(),
    maxYield: z.number().int().positive(),
    /** Seconds from planting to the first harvest. */
    firstYieldSeconds: z.number().int().positive(),
    /** Seconds between later harvests, or null when the asset is spent after one harvest. */
    regrowSeconds: z.number().int().positive().nullable(),
    /** The input the cycle consumes, if any. */
    input: z
      .object({
        resource: z.enum(RESOURCE_IDS),
        amount: z.number().int().positive()
      })
      .strict()
      .nullable(),
    /** The capability the ground must carry, in the build catalogue's own vocabulary. */
    requiredCapability: z.string().min(1).max(40),
    /** Which worker role could automate this later, or null when nothing will. */
    workerRole: z.enum(["FARM_WORKER", "FORESTRY_WORKER", "FISHERY_WORKER"]).nullable()
  })
  .strict()
  .refine((effect) => effect.minYield <= effect.maxYield, { message: "minYield must not exceed maxYield" });
export type ProductionEffect = z.infer<typeof ProductionEffectSchema>;

export const StorageEffectSchema = z
  .object({
    /**
     * Capacity this building adds, per resource. A general store adds to every resource it lists, so
     * the map is partial by design - a silo holds food and nothing else.
     */
    capacity: z
      .record(z.string(), z.number().int().positive())
      .refine((capacity) => Object.keys(capacity).length > 0, { message: "A store must hold something" })
      .refine((capacity) => Object.keys(capacity).every((key) => (RESOURCE_IDS as readonly string[]).includes(key)), {
        message: "Storage capacity names an unknown resource"
      })
  })
  .strict();
export type StorageEffect = z.infer<typeof StorageEffectSchema>;

export const MovementEffectSchema = z
  .object({
    /** How much faster a walker moves along this surface, against bare ground. */
    multiplier: z.number().min(1).max(3)
  })
  .strict();
export type MovementEffect = z.infer<typeof MovementEffectSchema>;

export const GameplayDefinitionSchema = z
  .object({
    classification: z.enum(GAMEPLAY_CLASSIFICATIONS),
    status: z.enum(GAMEPLAY_STATUSES),
    production: ProductionEffectSchema.nullable(),
    storage: StorageEffectSchema.nullable(),
    movement: MovementEffectSchema.nullable(),
    /** One line, player-facing: "why would I build this?". Never a rule or a price. */
    summaryKey: z.string().regex(/^place\.[a-z0-9_]+\.effect$/),
    /** What a later worker system would ask for, or null while nothing can automate it. */
    workerTask: z
      .object({
        taskType: z.enum(["PLANT", "HARVEST", "FEED", "COLLECT"]),
        workerRole: z.enum(["FARM_WORKER", "FORESTRY_WORKER", "FISHERY_WORKER"])
      })
      .strict()
      .nullable()
  })
  .strict()
  .refine(
    (definition) =>
      definition.classification === "COSMETIC" ||
      definition.classification === "UTILITY" ||
      definition.production !== null ||
      definition.storage !== null ||
      definition.movement !== null,
    { message: "A functional classification must carry at least one structured effect" }
  )
  .refine(
    (definition) => definition.classification === "STORAGE" || definition.storage === null,
    { message: "Only a storage asset may declare storage capacity" }
  );
export type GameplayDefinition = z.infer<typeof GameplayDefinitionSchema>;

/**
 * The gameplay definition of every shipped entry.
 *
 * Kept as one table rather than a field on each catalogue row so the *whole* gameplay surface can be
 * read in one screen, and so a test can prove that the table and the catalogue name the same set of
 * entries - in both directions.
 */
const DEFINITIONS: Readonly<Record<string, GameplayDefinition>> = {
  // ---- Roads: infrastructure, and the movement number is metadata until a road can be built ----
  place_road_dirt: roadGameplay("road.dirt.t1"),
  place_road_gravel: roadGameplay("road.gravel.t2"),
  place_road_stone: roadGameplay("road.stone.t3"),
  place_road_paved: roadGameplay("road.paved.t4"),

  // ---- Planting: decorations, unless the model is a plantation ----
  place_tree_broad: cosmetic("place.tree_broad.effect"),
  place_tree_pine: cosmetic("place.tree_pine.effect"),
  place_bush_leafy: cosmetic("place.bush_leafy.effect"),
  place_bush_flowering: cosmetic("place.bush_flowering.effect"),
  place_flower_group: cosmetic("place.flower_group.effect"),
  place_plant_clover: cosmetic("place.plant_clover.effect"),
  place_plant_fern: cosmetic("place.plant_fern.effect"),
  place_plant_grass: cosmetic("place.plant_grass.effect"),
  place_rock_small: cosmetic("place.rock_small.effect"),
  place_rock_large: cosmetic("place.rock_large.effect"),

  // ---- Fences, lighting, decoration: cosmetic ----
  place_fence_rail: cosmetic("place.fence_rail.effect"),
  place_fence_rail_long: cosmetic("place.fence_rail_long.effect"),
  place_barrel: cosmetic("place.barrel.effect"),
  place_crate: cosmetic("place.crate.effect"),
  place_sack: cosmetic("place.sack.effect"),
  place_planter: cosmetic("place.planter.effect"),
  place_bench: cosmetic("place.bench.effect"),
  place_wagon: cosmetic("place.wagon.effect"),
  place_stall: cosmetic("place.stall.effect"),
  place_well: cosmetic("place.well.effect"),
  place_lantern: cosmetic("place.lantern.effect"),
  place_workbench: cosmetic("place.workbench.effect"),
  // Aquaculture has its own authoritative pond lifecycle; it is not a decoration and must not be
  // presented as one in the construction inspector. The dedicated domain flow owns stock/harvest.
  place_fish_cage: utility("place.fish_cage.effect"),

  // ---- Buildings: the first functional assets ----
  place_barn_t1: storage("place.barn_t1.effect", { WOOD: 250, FOOD: 150, STONE: 100 }),
  place_barn_t2: storage("place.barn_t2.effect", { WOOD: 600, FOOD: 360, STONE: 240 }),
  place_barn_t3: storage("place.barn_t3.effect", { WOOD: 1400, FOOD: 840, STONE: 560 }),
  place_coop: production("place.coop.effect", {
    output: "FOOD",
    minYield: 6,
    maxYield: 6,
    firstYieldSeconds: 900,
    regrowSeconds: 900,
    input: { resource: "FOOD", amount: 2 },
    requiredCapability: "LIVESTOCK",
    workerRole: "FARM_WORKER"
  }),
  place_open_barn: storage("place.open_barn.effect", { WOOD: 400, FOOD: 240, STONE: 160 }),
  place_silo: storage("place.silo.effect", { FOOD: 900 }),
  place_silo_house: storage("place.silo_house.effect", { FOOD: 1200, WOOD: 200 }),
  place_windmill: production("place.windmill.effect", {
    output: "FOOD",
    minYield: 12,
    maxYield: 12,
    firstYieldSeconds: 600,
    regrowSeconds: 600,
    input: { resource: "FOOD", amount: 4 },
    requiredCapability: "BUILD",
    workerRole: "FARM_WORKER"
  })
};

function cosmetic(summaryKey: string): GameplayDefinition {
  return GameplayDefinitionSchema.parse({
    classification: "COSMETIC",
    status: "ACTIVE",
    production: null,
    storage: null,
    movement: null,
    summaryKey,
    workerTask: null
  });
}

function utility(summaryKey: string): GameplayDefinition {
  return GameplayDefinitionSchema.parse({
    classification: "UTILITY",
    status: "ACTIVE",
    production: null,
    storage: null,
    movement: null,
    summaryKey,
    workerTask: null
  });
}

function storage(summaryKey: string, capacity: Readonly<Record<string, number>>): GameplayDefinition {
  return GameplayDefinitionSchema.parse({
    classification: "STORAGE",
    // The capacity is defined and shown, but nothing enforces a maximum yet, so it is not ACTIVE.
    status: "FOUNDATION_ONLY",
    production: null,
    storage: { capacity },
    movement: null,
    summaryKey,
    workerTask: null
  });
}

function production(
  summaryKey: string,
  effect: {
    readonly output: ResourceId;
    readonly minYield: number;
    readonly maxYield: number;
    readonly firstYieldSeconds: number;
    readonly regrowSeconds: number | null;
    readonly input: { readonly resource: ResourceId; readonly amount: number } | null;
    readonly requiredCapability: string;
    readonly workerRole: "FARM_WORKER" | "FORESTRY_WORKER" | "FISHERY_WORKER" | null;
  }
): GameplayDefinition {
  return GameplayDefinitionSchema.parse({
    classification: "PRODUCTION",
    // A production building is a real, persisted object today; its cycle is not simulated yet, so the
    // effect is foundation-only and the shop says so.
    status: "FOUNDATION_ONLY",
    production: effect,
    storage: null,
    movement: null,
    summaryKey,
    workerTask: effect.workerRole === null ? null : { taskType: "HARVEST", workerRole: effect.workerRole }
  });
}

function roadGameplay(tierId: RoadTierId): GameplayDefinition {
  const tier = roadTiers.get(tierId);
  if (tier === undefined) throw new Error(`Missing road tier: ${tierId}`);
  return GameplayDefinitionSchema.parse({
    classification: "INFRASTRUCTURE",
    // Roads cannot be built yet (V13 ships the persistence for objects), so their movement effect is
    // declared and *not* claimed as live.
    status: "PREVIEW_ONLY",
    production: null,
    storage: null,
    movement: { multiplier: tier.moveMultiplier },
    summaryKey: "place.road.effect",
    workerTask: null
  });
}

/** The gameplay definition for an entry, or null when the catalogue ships something without one. */
export function gameplayFor(entryId: string): GameplayDefinition | null {
  return DEFINITIONS[entryId] ?? null;
}

/** Every entry id this table defines, for the coverage test. */
export function gameplayEntryIds(): readonly string[] {
  return Object.keys(DEFINITIONS);
}

/**
 * Checks the two directions of the contract: every shipped entry has a definition, and every
 * definition names an entry that actually ships.
 */
export function gameplayCoverageProblems(): readonly string[] {
  const problems: string[] = [];
  const shipped = new Set(placementEntries.map((entry) => entry.id));
  for (const entry of placementEntries) {
    if (DEFINITIONS[entry.id] === undefined) problems.push(`no gameplay definition: ${entry.id}`);
  }
  for (const id of Object.keys(DEFINITIONS)) {
    if (!shipped.has(id)) problems.push(`gameplay definition without an entry: ${id}`);
  }
  return problems;
}

/** The roads, for the economy document and the tier tests. */
export const gameplayRoadTiers = ROAD_TIERS;
