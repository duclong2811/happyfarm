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
  windmill: 2600,
  // Làng Việt (docs/design/LANG_VIET.md): the same magnitudes as the pieces above, a house priced
  // like the barn it stands beside, a monument like the windmill.
  vietThatchHouse: 1200,
  vietStiltHouse: 2400,
  vietTiledHouse: 3600,
  vietGate: 1800,
  vietShrine: 1500,
  vietWell: 450,
  vietJars: 70,
  vietStrawStack: 80,
  vietRiceMortar: 60,
  vietDaybed: 130,
  vietLanternPost: 160,
  vietLanternString: 260,
  vietBonsai: 110,
  vietRockery: 380,
  vietLotusPond: 520,
  vietScreenWall: 340,
  vietFenceBamboo: 45,
  vietFenceBreeze: 70,
  vietBanyan: 220,
  vietBamboo: 60,
  vietAreca: 50,
  vietBanana: 45,
  vietTetBlossom: 150,
  // Vùng miền (the regions of Việt Nam): the same magnitudes again.
  regionDinh: 5200,
  regionBellTower: 1400,
  regionTiledBridge: 1600,
  regionGao: 200,
  regionRuongHouse: 4200,
  regionTamQuan: 2600,
  regionChamTower: 3400,
  regionBasketBoat: 120,
  regionCoconut: 60,
  regionNipaHouse: 1000,
  regionMonkeyBridge: 300,
  regionSampan: 140,
  regionNipaPalm: 50,
  regionFieldHut: 220,
  regionNhaRong: 4600,
  regionCayNeu: 90,
  regionGongRack: 260,
  regionCoffee: 45,
  regionWildSunflower: 40,
  regionWaterWheel: 360,
  regionRammedHouse: 2800,
  regionBuckwheat: 35
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
  AQUACULTURE: 0.5,
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
      storable: true,
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
    storable: true,
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
  /** A working shallow-water construction, separate from visual decoration. */
  const aquaculture = (
    id: string,
    modelId: string,
    labelKey: string,
    priceGold: number,
    requiredLevel: number,
    tags: readonly string[]
  ): PlacementCatalogEntryData => ({
    ...planting(id, modelId, labelKey, priceGold, requiredLevel, tags),
    category: "AQUACULTURE",
    decorative: false,
    removalRefundRate: REMOVAL_REFUND_POLICY.AQUACULTURE
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
  ): Pick<PlacementCatalogEntryData, "allowedTerrain" | "movable" | "storable" | "removable" | "removalRefundRate"> => ({
    allowedTerrain: ["LAND"],
    movable: true,
    storable: true,
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
      ...aquaculture("place_fish_cage", "prop_cage_small", "place.fish_cage.name", price.fishCage, level.ESTABLISHED, ["water", "aquaculture"]),
      // The one asset in the catalogue that may not stand on land: a cage is moored in the shallows.
      allowedTerrain: ["SHALLOW_WATER"]
    },

    // ---- Làng Việt: the Vietnamese village pack (docs/design/LANG_VIET.md) -----------------
    ...villageEntries(),

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
 * The decoration collections, in the shop's order: sets of pieces sold together and filtered together
 * (docs/design/LANG_VIET.md). A row joins one by carrying its tag; every piece in one is cosmetic.
 */
export const DECORATION_COLLECTIONS = ["lang_viet", "viet_bac", "viet_trung", "viet_nam_bo", "viet_tay_nguyen", "viet_tay_bac"] as const;
export type DecorationCollection = (typeof DECORATION_COLLECTIONS)[number];

/**
 * Làng Việt: houses, village pieces, fences and trees in the look of the Vietnamese countryside
 * (`tools/asset-pipeline/node/viet.mjs`). Every one is cosmetic - it is bought, placed, moved, stored
 * and taken down like any other piece, and changes nothing but how the island looks. All of them carry
 * the `lang_viet` tag, so the shop can show the set together.
 */
function villageEntries(): PlacementCatalogEntryData[] {
  const level = PLACEMENT_LEVEL_POLICY;
  const price = PROVISIONAL_ASSET_PRICES;
  const piece = (
    name: string,
    category: PlacementCategory,
    priceGold: number,
    requiredLevel: number,
    footprint: { readonly widthCells: number; readonly depthCells: number },
    tags: readonly string[],
    allowedTerrain: PlacementCatalogEntryData["allowedTerrain"] = ["LAND"],
    collection: DecorationCollection = "lang_viet"
  ): PlacementCatalogEntryData => ({
    id: `place_${name}`,
    category,
    displayNameKey: `place.${name}.name`,
    requiredLevel,
    price: priceGold,
    currencyDefinitionId: "currency_gold",
    // The entry is named after its model: `place_viet_well` draws `viet_well`.
    modelId: name,
    footprint: { widthCells: footprint.widthCells, depthCells: footprint.depthCells },
    allowedTerrain: [...allowedTerrain],
    tier: null,
    upgradeTo: null,
    rotatable: true,
    movable: true,
    storable: true,
    removable: true,
    removalRefundRate: REMOVAL_REFUND_POLICY[category],
    decorative: true,
    tags: [collection, ...tags],
    descriptionKey: `place.${name}.description`,
    unlockCondition: "OWNED_LAND"
  });
  const cells = (widthCells: number, depthCells: number) => ({ widthCells, depthCells });
  // Most pieces stand on dry land; a boat or a palm of the shore may also stand on the sand.
  const land: PlacementCatalogEntryData["allowedTerrain"] = ["LAND"];
  const shore: PlacementCatalogEntryData["allowedTerrain"] = ["LAND", "SHORE"];
  return [
    piece("viet_house_thatch", "BUILDING", price.vietThatchHouse, level.SETTLED, cells(3, 3), ["housing"]),
    piece("viet_house_stilt", "BUILDING", price.vietStiltHouse, level.SETTLED + 1, cells(3, 3), ["housing"]),
    piece("viet_house_tiled", "BUILDING", price.vietTiledHouse, level.ESTABLISHED, cells(5, 4), ["housing"]),
    piece("viet_village_gate", "MONUMENT", price.vietGate, level.ESTABLISHED, cells(4, 2), ["landmark"]),
    piece("viet_shrine", "MONUMENT", price.vietShrine, level.ESTABLISHED, cells(2, 2), ["landmark"]),
    piece("viet_well", "DECORATION", price.vietWell, level.SETTLED, cells(2, 2), ["water"]),
    piece("viet_jars", "DECORATION", price.vietJars, level.BASIC, cells(1, 1), ["storage"]),
    piece("viet_straw_stack", "DECORATION", price.vietStrawStack, level.BASIC, cells(2, 2), ["farm"]),
    piece("viet_rice_mortar", "DECORATION", price.vietRiceMortar, level.BASIC, cells(1, 1), ["farm"]),
    piece("viet_bamboo_daybed", "DECORATION", price.vietDaybed, level.SETTLED, cells(2, 1), ["seating"]),
    piece("viet_bonsai", "DECORATION", price.vietBonsai, level.SETTLED, cells(1, 1), ["planting"]),
    piece("viet_rockery", "DECORATION", price.vietRockery, level.ESTABLISHED, cells(2, 2), ["water", "stone"]),
    piece("viet_lotus_pond", "DECORATION", price.vietLotusPond, level.ESTABLISHED, cells(3, 3), ["water"]),
    piece("viet_screen_wall", "DECORATION", price.vietScreenWall, level.ESTABLISHED, cells(2, 1), ["landmark"]),
    piece("viet_lantern_post", "LIGHTING", price.vietLanternPost, level.ESTABLISHED, cells(1, 1), ["light"]),
    piece("viet_lantern_string", "LIGHTING", price.vietLanternString, level.ESTABLISHED, cells(3, 1), ["light"]),
    piece("viet_fence_bamboo", "FENCE", price.vietFenceBamboo, level.BASIC, cells(1, 1), ["fencing"]),
    piece("viet_fence_breeze", "FENCE", price.vietFenceBreeze, level.SETTLED, cells(1, 1), ["fencing"]),
    piece("viet_tree_banyan", "VEGETATION", price.vietBanyan, level.ESTABLISHED, cells(2, 2), ["trees"]),
    piece("viet_bamboo_clump", "VEGETATION", price.vietBamboo, level.BASIC, cells(1, 1), ["trees"]),
    piece("viet_tree_areca", "VEGETATION", price.vietAreca, level.BASIC, cells(1, 1), ["trees"]),
    piece("viet_tree_banana", "VEGETATION", price.vietBanana, level.BASIC, cells(1, 1), ["trees"]),
    piece("viet_tree_mai", "VEGETATION", price.vietTetBlossom, level.SETTLED, cells(1, 1), ["trees", "flowers"]),
    piece("viet_tree_dao", "VEGETATION", price.vietTetBlossom, level.SETTLED, cells(1, 1), ["trees", "flowers"]),

    // ---- Vùng miền: one collection per region (docs/design/LANG_VIET.md, "Regions") ----
    // Bắc Bộ, the northern delta.
    piece("viet_dinh", "MONUMENT", price.regionDinh, level.PROSPEROUS, cells(7, 5), ["landmark"], land, "viet_bac"),
    piece("viet_bell_tower", "MONUMENT", price.regionBellTower, level.ESTABLISHED, cells(2, 2), ["landmark"], land, "viet_bac"),
    piece("viet_bridge_tiled", "DECORATION", price.regionTiledBridge, level.ESTABLISHED, cells(5, 3), ["water"], land, "viet_bac"),
    piece("viet_tree_gao", "VEGETATION", price.regionGao, level.SETTLED, cells(2, 2), ["trees"], land, "viet_bac"),
    // Trung Bộ, the centre.
    piece("viet_house_ruong", "BUILDING", price.regionRuongHouse, level.ESTABLISHED + 1, cells(5, 4), ["housing"], land, "viet_trung"),
    piece("viet_gate_tam_quan", "MONUMENT", price.regionTamQuan, level.ESTABLISHED + 1, cells(5, 2), ["landmark"], land, "viet_trung"),
    piece("viet_cham_tower", "MONUMENT", price.regionChamTower, level.PROSPEROUS, cells(3, 3), ["landmark"], land, "viet_trung"),
    piece("viet_basket_boat", "DECORATION", price.regionBasketBoat, level.BASIC, cells(3, 2), ["boats"], shore, "viet_trung"),
    piece("viet_tree_coconut", "VEGETATION", price.regionCoconut, level.BASIC, cells(1, 1), ["trees"], shore, "viet_trung"),
    // Nam Bộ, the Mekong.
    piece("viet_house_nipa", "BUILDING", price.regionNipaHouse, level.SETTLED, cells(3, 3), ["housing"], land, "viet_nam_bo"),
    piece("viet_monkey_bridge", "DECORATION", price.regionMonkeyBridge, level.SETTLED, cells(2, 4), ["water"], land, "viet_nam_bo"),
    piece("viet_sampan", "DECORATION", price.regionSampan, level.BASIC, cells(3, 1), ["boats"], shore, "viet_nam_bo"),
    piece("viet_nipa_palm", "VEGETATION", price.regionNipaPalm, level.BASIC, cells(2, 2), ["trees"], shore, "viet_nam_bo"),
    piece("viet_field_hut", "DECORATION", price.regionFieldHut, level.BASIC, cells(2, 2), ["farm"], land, "viet_nam_bo"),
    // Tây Nguyên, the highlands.
    piece("viet_nha_rong", "MONUMENT", price.regionNhaRong, level.PROSPEROUS, cells(4, 4), ["landmark"], land, "viet_tay_nguyen"),
    piece("viet_cay_neu", "DECORATION", price.regionCayNeu, level.BASIC, cells(1, 1), ["festival"], land, "viet_tay_nguyen"),
    piece("viet_gong_rack", "DECORATION", price.regionGongRack, level.SETTLED, cells(3, 1), ["festival"], land, "viet_tay_nguyen"),
    piece("viet_coffee_shrub", "VEGETATION", price.regionCoffee, level.BASIC, cells(1, 1), ["shrubs"], land, "viet_tay_nguyen"),
    piece("viet_wild_sunflower", "VEGETATION", price.regionWildSunflower, level.BASIC, cells(1, 1), ["flowers"], land, "viet_tay_nguyen"),
    // Tây Bắc, the north-west.
    piece("viet_water_wheel", "DECORATION", price.regionWaterWheel, level.SETTLED, cells(3, 2), ["water"], land, "viet_tay_bac"),
    piece("viet_house_rammed", "BUILDING", price.regionRammedHouse, level.ESTABLISHED, cells(4, 3), ["housing"], land, "viet_tay_bac"),
    piece("viet_buckwheat", "VEGETATION", price.regionBuckwheat, level.BASIC, cells(1, 1), ["flowers"], land, "viet_tay_bac")
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
  "tree_pine_2",
  // Làng Việt (generated by tools/asset-pipeline/node/viet.mjs).
  "viet_bamboo_clump",
  "viet_bamboo_daybed",
  "viet_bonsai",
  "viet_fence_bamboo",
  "viet_fence_breeze",
  "viet_house_stilt",
  "viet_house_thatch",
  "viet_house_tiled",
  "viet_jars",
  "viet_lantern_post",
  "viet_lantern_string",
  "viet_lotus_pond",
  "viet_rice_mortar",
  "viet_rockery",
  "viet_screen_wall",
  "viet_shrine",
  "viet_straw_stack",
  "viet_tree_areca",
  "viet_tree_banana",
  "viet_tree_banyan",
  "viet_tree_dao",
  "viet_tree_mai",
  "viet_village_gate",
  "viet_well",
  // Vùng miền (generated by tools/asset-pipeline/node/viet-regions.mjs).
  "viet_basket_boat",
  "viet_bell_tower",
  "viet_bridge_tiled",
  "viet_buckwheat",
  "viet_cay_neu",
  "viet_cham_tower",
  "viet_coffee_shrub",
  "viet_dinh",
  "viet_field_hut",
  "viet_gate_tam_quan",
  "viet_gong_rack",
  "viet_house_nipa",
  "viet_house_rammed",
  "viet_house_ruong",
  "viet_monkey_bridge",
  "viet_nha_rong",
  "viet_nipa_palm",
  "viet_sampan",
  "viet_tree_coconut",
  "viet_tree_gao",
  "viet_water_wheel",
  "viet_wild_sunflower"
] as const;

/** The full ship list, in a stable order: roads first, then everything a player places. */
export const PLACEMENT_ENTRIES: readonly PlacementCatalogEntryData[] = [...roadEntries(), ...assetEntries()];

/** The catalogue, validated as a whole. A single bad row stops the game from starting. */
export const placementCatalog = createPlacementCatalog(PLACEMENT_ENTRIES, {
  assetIds: new Set<string>(CATALOGUE_MODEL_IDS)
});

/** Every entry, in the catalogue's order, for the client and for tests. */
export const placementEntries: readonly PlacementCatalogEntryData[] = [...placementCatalog.values()];
