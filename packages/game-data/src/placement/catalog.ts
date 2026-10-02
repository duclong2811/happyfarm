import {
  ROAD_SEGMENT_CELLS,
  ROAD_TIERS,
  PROVISIONAL_ROAD_PRICES,
  roadFootprintWidthCells,
  roadTiers,
  type RoadTierId
} from "../roads";
import { createPlacementCatalog, type PlacementCatalogEntryData, type PlacementCategory } from "./schema";

/**
 * The ship list: everything a player can build or plant, and nothing that does not exist.
 *
 * Three rules, all of them from the brief:
 *
 * * **Every model id resolves.** Each entry names a `.glb` that ships in `apps/web/src/assets/models`
 *   (or one of the procedural road visuals), and the catalogue refuses to load if it does not. A
 *   catalogue entry with no art is a shop row that cannot be fulfilled, so there are none.
 * * **Levels and prices are provisional and centralised.** `PLACEMENT_LEVEL_POLICY` and
 *   `PROVISIONAL_ASSET_PRICES` below are the only places a number lives; nothing in the client
 *   restates one. They exist so the ladder reads plausibly and are expected to be rebalanced.
 * * **Civic is not for sale.** The village's own buildings - the farmhouse the game starts with, the
 *   plaza, the quay - are not catalogue entries. What a player can buy is what a player would build on
 *   land they own.
 */

/**
 * The provisional unlock ladder, as a policy rather than a scatter of numbers.
 *
 * LEVEL 1 is what a new island can already do: a dirt road, a fence, something to plant, something to
 * look at, and a first shed. The middle levels add comfort and capacity, and the top of the ladder is
 * where infrastructure stops being practical and starts being a statement.
 */
export const PLACEMENT_LEVEL_POLICY = {
  /** The first thing a player builds: earth, wood and planting. */
  BASIC: 1,
  /** Comforts and small working buildings. */
  SETTLED: 3,
  /** Real buildings, stone underfoot, light after dark. */
  ESTABLISHED: 5,
  /** The top of the ladder: paved roads, monuments, the civic showpiece. */
  PROSPEROUS: 8
} as const;

/**
 * Provisional prices, in gold, for everything that is not a road.
 *
 * Road prices live with the road tiers (`PROVISIONAL_ROAD_PRICES`) because a road is priced by the
 * segment. These are the same kind of placeholder: rough magnitudes that make a shop readable, to be
 * replaced by an economy pass.
 */
export const PROVISIONAL_ASSET_PRICES = {
  planting: 40,
  rock: 30,
  flowerBed: 25,
  fenceLength: 45,
  bench: 120,
  barrel: 60,
  crate: 60,
  sack: 50,
  planter: 90,
  lantern: 140,
  sign: 80,
  well: 400,
  stall: 320,
  wagon: 260,
  workbench: 180,
  fishCage: 600,
  coop: 700,
  barnT1: 900,
  barnT2: 2200,
  barnT3: 4800,
  openBarn: 1400,
  silo: 1800,
  siloHouse: 3200,
  windmill: 2600
} as const;

/**
 * What a removal returns, as a share of what the thing cost.
 *
 * **Provisional, and deliberately not one number.** The honest answer differs by what the thing is
 * made of: a barn's timbers and stones are half its price again as materials, a road's gravel is
 * partly recoverable, and a planting or a lantern comes back as nothing at all. These are balance
 * numbers a later economy pass owns; what this pass establishes is that the rate belongs to the
 * *asset*, so rebalancing is an edit to this table rather than a rewrite of the removal path.
 *
 * No tier of this table may exceed 1: a refund can never be a way to make gold.
 */
export const REMOVAL_REFUND_POLICY: Readonly<Record<PlacementCategory, number>> = {
  BUILDING: 0.5,
  UTILITY: 0.5,
  MONUMENT: 0.5,
  WATERFRONT: 0.5,
  ROAD: 0.25,
  FENCE: 0.25,
  DECORATION: 0,
  LIGHTING: 0,
  VEGETATION: 0
};

/**
 * The road entries, built from the tier table so a price can never be restated.
 *
 * A road is the one category whose prices are decided elsewhere, and the one whose ids a test pins to
 * the tier ladder: four segments, four entries, each upgrading into the next.
 */
function roadEntries(): PlacementCatalogEntryData[] {
  return ROAD_TIERS.map((tierId: RoadTierId) => {
    const tier = roadTiers.get(tierId);
    if (tier === undefined) throw new Error(`Missing road tier: ${tierId}`);
    const next = tier.upgradeTo === null ? undefined : roadTiers.get(tier.upgradeTo);
    return {
      id: `place_road_${tier.surface.toLowerCase()}`,
      category: "ROAD" as const,
      displayNameKey: tier.displayNameKey,
      requiredLevel: tier.rank,
      price: PROVISIONAL_ROAD_PRICES[tierId],
      currencyDefinitionId: "currency_gold",
      modelId: `road.${tier.surface.toLowerCase()}`,
      // The footprint *contains* the drawn ribbon: four cells long, and as many cells wide as the
      // renderer actually paints. V12.5 advertised one cell for a road drawn 1.75 cells wide, which is
      // a collision rule that does not match the picture it is supposed to protect.
      footprint: {
        widthCells: roadFootprintWidthCells(tier.renderKind),
        depthCells: ROAD_SEGMENT_CELLS
      },
      // A road is laid on owned ground, like everything else a player builds. The player's own asphalt
      // is not the island's authored highway: that one is world infrastructure and this catalogue
      // never names it.
      allowedTerrain: ["LAND"] as const,
      tier: tierId,
      upgradeTo: next === undefined ? null : `place_road_${next.surface.toLowerCase()}`,
      rotatable: true,
      movable: true,
      removable: true,
      removalRefundRate: REMOVAL_REFUND_POLICY.ROAD,
      decorative: false,
      tags: ["infrastructure"],
      descriptionKey: "place.road.description",
      unlockCondition: "OWNED_LAND" as const
    };
  });
}

/** Everything else, one row per thing a player can actually place. */
function assetEntries(): PlacementCatalogEntryData[] {
  const level = PLACEMENT_LEVEL_POLICY;
  const price = PROVISIONAL_ASSET_PRICES;
  const gold = "currency_gold";
  /** A planting: one cell, turnable, decorative, and only on land the player owns. */
  const planting = (
    id: string,
    modelId: string,
    labelKey: string,
    priceGold: number,
    requiredLevel: number,
    tags: readonly string[]
  ): PlacementCatalogEntryData => ({
    id,
    category: "VEGETATION",
    displayNameKey: labelKey,
    requiredLevel,
    price: priceGold,
    currencyDefinitionId: gold,
    modelId,
    footprint: { widthCells: 1, depthCells: 1 },
    // An ordinary owned cell takes a planting, a rock or a bench: the ground only has to be dry land.
    allowedTerrain: ["LAND"],
    tier: null,
    upgradeTo: null,
    rotatable: true,
    movable: true,
    removable: true,
    removalRefundRate: REMOVAL_REFUND_POLICY.VEGETATION,
    decorative: true,
    tags: [...tags],
    descriptionKey: null,
    unlockCondition: "OWNED_LAND"
  });
  /** A decoration: the same shape, in the decoration category. */
  const decoration = (
    id: string,
    modelId: string,
    labelKey: string,
    priceGold: number,
    requiredLevel: number,
    tags: readonly string[]
  ): PlacementCatalogEntryData => ({
    ...planting(id, modelId, labelKey, priceGold, requiredLevel, tags),
    category: "DECORATION",
    removalRefundRate: REMOVAL_REFUND_POLICY.DECORATION
  });
  /**
   * The placement and editing fields for a thing that stands on dry land.
   *
   * Every building the catalogue sells is the player's own, so every one may be picked up and taken
   * down, for the refund its category declares. A row that ever needs to differ states the field
   * itself after the spread - which is what "the policy is data" has to mean in practice.
   */
  const onLand = (
    category: PlacementCategory
  ): Pick<PlacementCatalogEntryData, "allowedTerrain" | "movable" | "removable" | "removalRefundRate"> => ({
    allowedTerrain: ["LAND"],
    movable: true,
    removable: true,
    removalRefundRate: REMOVAL_REFUND_POLICY[category]
  });

  return [
    // ---- Vegetation: what makes an empty island a place --------------------------------
    planting("place_tree_broad", "tree_broad_2", "place.tree_broad.name", price.planting, level.BASIC, ["trees"]),
    planting("place_tree_pine", "tree_pine_2", "place.tree_pine.name", price.planting, level.BASIC, ["trees"]),
    planting("place_bush_leafy", "bush_leafy", "place.bush_leafy.name", price.planting, level.BASIC, ["shrubs"]),
    planting("place_bush_flowering", "bush_flowering", "place.bush_flowering.name", price.planting, level.BASIC, ["shrubs"]),
    planting("place_flower_group", "flower_group_1", "place.flower_group.name", price.flowerBed, level.BASIC, ["flowers"]),
    planting("place_plant_clover", "plant_clover", "place.plant_clover.name", price.flowerBed, level.BASIC, ["ground_cover"]),
    planting("place_plant_fern", "plant_fern", "place.plant_fern.name", price.flowerBed, level.SETTLED, ["ground_cover"]),
    planting("place_plant_grass", "plant_grass_tall", "place.plant_grass.name", price.flowerBed, level.BASIC, ["ground_cover"]),
    planting("place_rock_small", "rock_boulder_1", "place.rock_small.name", price.rock, level.BASIC, ["stone"]),
    planting("place_rock_large", "rock_boulder_3", "place.rock_large.name", price.rock * 2, level.SETTLED, ["stone"]),

    // ---- Fences: the first thing a farm needs and the last thing it finishes ------------
    {
      ...decoration("place_fence_rail", "prop_fence_rail", "place.fence_rail.name", price.fenceLength, level.BASIC, ["fencing"]),
      category: "FENCE",
      removalRefundRate: REMOVAL_REFUND_POLICY.FENCE,
      rotatable: true
    },
    {
      ...decoration("place_fence_rail_long", "prop_fence_rail_long", "place.fence_rail_long.name", price.fenceLength * 2, level.BASIC, ["fencing"]),
      category: "FENCE",
      removalRefundRate: REMOVAL_REFUND_POLICY.FENCE
    },

    // ---- Decoration: the things that make it somebody's farm ---------------------------
    decoration("place_barrel", "prop_barrel", "place.barrel.name", price.barrel, level.BASIC, ["storage"]),
    decoration("place_crate", "prop_crate_wooden", "place.crate.name", price.crate, level.BASIC, ["storage"]),
    decoration("place_sack", "prop_sack", "place.sack.name", price.sack, level.BASIC, ["storage"]),
    decoration("place_planter", "prop_planter", "place.planter.name", price.planter, level.SETTLED, ["planting"]),
    decoration("place_bench", "prop_bench", "place.bench.name", price.bench, level.SETTLED, ["seating"]),
    decoration("place_wagon", "prop_wagon", "place.wagon.name", price.wagon, level.SETTLED, ["transport"]),
    decoration("place_stall", "prop_stall", "place.stall.name", price.stall, level.SETTLED, ["market"]),
    decoration("place_well", "civic.well.t1", "place.well.name", price.well, level.ESTABLISHED, ["water"]),
    {
      ...decoration("place_lantern", "prop_lantern", "place.lantern.name", price.lantern, level.ESTABLISHED, ["light"]),
      category: "LIGHTING",
      removalRefundRate: REMOVAL_REFUND_POLICY.LIGHTING
    },
    {
      ...decoration("place_workbench", "prop_workbench", "place.workbench.name", price.workbench, level.SETTLED, ["work"]),
      category: "UTILITY",
      removalRefundRate: REMOVAL_REFUND_POLICY.UTILITY
    },
    {
      ...decoration("place_fish_cage", "prop_cage_small", "place.fish_cage.name", price.fishCage, level.ESTABLISHED, ["water"]),
      category: "WATERFRONT",
      removalRefundRate: REMOVAL_REFUND_POLICY.WATERFRONT,
      // The one asset in the catalogue that may not stand on land: a cage is moored in the shallows.
      allowedTerrain: ["SHALLOW_WATER"]
    },

    // ---- Buildings: the working farm the player grows into ----------------------------
    {
      id: "place_barn_t1",
      category: "BUILDING",
      displayNameKey: "place.barn_t1.name",
      requiredLevel: level.BASIC,
      price: price.barnT1,
      currencyDefinitionId: gold,
      modelId: "farm.barn.t1",
      footprint: { widthCells: 4, depthCells: 3 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: "place_barn_t2",
      rotatable: true,
      decorative: false,
      tags: ["storage", "farm"],
      descriptionKey: "place.barn_t1.description",
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_barn_t2",
      category: "BUILDING",
      displayNameKey: "place.barn_t2.name",
      requiredLevel: level.SETTLED,
      price: price.barnT2,
      currencyDefinitionId: gold,
      modelId: "farm.barn.t2",
      footprint: { widthCells: 5, depthCells: 4 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: "place_barn_t3",
      rotatable: true,
      decorative: false,
      tags: ["storage", "farm"],
      descriptionKey: "place.barn_t2.description",
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_barn_t3",
      category: "BUILDING",
      displayNameKey: "place.barn_t3.name",
      requiredLevel: level.PROSPEROUS,
      price: price.barnT3,
      currencyDefinitionId: gold,
      modelId: "farm.barn.t3",
      footprint: { widthCells: 6, depthCells: 5 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: null,
      rotatable: true,
      decorative: false,
      tags: ["storage", "farm"],
      descriptionKey: "place.barn_t3.description",
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_coop",
      category: "BUILDING",
      displayNameKey: "place.coop.name",
      requiredLevel: level.SETTLED,
      price: price.coop,
      currencyDefinitionId: gold,
      modelId: "farm.coop.t1",
      footprint: { widthCells: 3, depthCells: 3 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: "place_open_barn",
      rotatable: true,
      decorative: false,
      tags: ["livestock", "farm"],
      descriptionKey: "place.coop.description",
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_open_barn",
      category: "BUILDING",
      displayNameKey: "place.open_barn.name",
      requiredLevel: level.ESTABLISHED,
      price: price.openBarn,
      currencyDefinitionId: gold,
      modelId: "farm.openbarn.t1",
      footprint: { widthCells: 4, depthCells: 3 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: null,
      rotatable: true,
      decorative: false,
      tags: ["livestock", "farm"],
      descriptionKey: null,
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_silo",
      category: "BUILDING",
      displayNameKey: "place.silo.name",
      requiredLevel: level.ESTABLISHED,
      price: price.silo,
      currencyDefinitionId: gold,
      modelId: "farm.silo.t1",
      footprint: { widthCells: 2, depthCells: 2 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: "place_silo_house",
      rotatable: false,
      decorative: false,
      tags: ["storage", "farm"],
      descriptionKey: null,
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_silo_house",
      category: "BUILDING",
      displayNameKey: "place.silo_house.name",
      requiredLevel: level.ESTABLISHED + 1,
      price: price.siloHouse,
      currencyDefinitionId: gold,
      modelId: "farm.silo_house.t2",
      footprint: { widthCells: 3, depthCells: 3 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: null,
      rotatable: true,
      decorative: false,
      tags: ["storage", "farm", "housing"],
      descriptionKey: null,
      unlockCondition: "OWNED_LAND"
    },
    {
      id: "place_windmill",
      category: "UTILITY",
      displayNameKey: "place.windmill.name",
      requiredLevel: level.ESTABLISHED,
      price: price.windmill,
      currencyDefinitionId: gold,
      modelId: "farm.windmill.t2",
      footprint: { widthCells: 3, depthCells: 3 },
      ...onLand("BUILDING"),
      tier: null,
      upgradeTo: null,
      rotatable: false,
      decorative: false,
      tags: ["utility", "farm"],
      descriptionKey: null,
      unlockCondition: "OWNED_LAND"
    }
  ];
}

/**
 * The curated assets the catalogue is allowed to name.
 *
 * The catalogue cannot read the client's asset folder - `packages/game-data` must not depend on
 * `apps/web` - so the ids it may use are declared here, and `tests/game-data/placement-catalog.test.ts`
 * checks this list against the files that actually ship. That is the same trade the crop and building
 * manifests make: the data names what exists, and a test is what keeps the two honest.
 */
export const CATALOGUE_MODEL_IDS = [
  "bush_flowering",
  "bush_leafy",
  "civic.well.t1",
  "farm.barn.t1",
  "farm.barn.t2",
  "farm.barn.t3",
  "farm.coop.t1",
  "farm.openbarn.t1",
  "farm.silo.t1",
  "farm.silo_house.t2",
  "farm.windmill.t2",
  "flower_group_1",
  "plant_clover",
  "plant_fern",
  "plant_grass_tall",
  "prop_bench",
  "prop_barrel",
  "prop_cage_small",
  "prop_crate_wooden",
  "prop_fence_rail",
  "prop_fence_rail_long",
  "prop_lantern",
  "prop_planter",
  "prop_sack",
  "prop_stall",
  "prop_wagon",
  "prop_workbench",
  "rock_boulder_1",
  "rock_boulder_3",
  "tree_broad_2",
  "tree_pine_2"
] as const;

/** The full ship list, in a stable order: roads first, then everything a player places. */
export const PLACEMENT_ENTRIES: readonly PlacementCatalogEntryData[] = [...roadEntries(), ...assetEntries()];

/** The catalogue, validated as a whole. A single bad row stops the game from starting. */
export const placementCatalog = createPlacementCatalog(PLACEMENT_ENTRIES, {
  assetIds: new Set<string>(CATALOGUE_MODEL_IDS)
});

/** Every entry, in the catalogue's order, for the client and for tests. */
export const placementEntries: readonly PlacementCatalogEntryData[] = [...placementCatalog.values()];
