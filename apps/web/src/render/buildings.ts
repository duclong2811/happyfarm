import type { TileCoordinate } from "./layout";
import { DISTRICTS, LANDMARKS, type DistrictKind, type LandmarkKind } from "./world-config";

/**
 * Buildings as data, with the shape a progression pass will need.
 *
 * Today every one of these draws its first tier: the stylized primitives the settlement has always
 * been built from. What this module adds is the *structure* to replace them one tier at a time -
 * a building knows which district it belongs to, how much ground it stands on, what it blocks, and
 * which model each visual tier uses - so a future "the town hall grows when the island reaches level
 * four" pass is a table edit and a model import rather than a renderer rewrite.
 *
 * Nothing here is connected to server progression, and nothing here may be: a tier is a *visual*
 * statement chosen by the client, and the server owns anything that is a rule.
 */

/** One step of a building's visual life. Tier 1 is always the first thing that is drawn. */
export interface BuildingVariant {
  readonly tier: number;
  /**
   * The deterministic asset id this tier draws, or null while the tier has no model yet.
   *
   * An id - `farm.barn.t2` - rather than a file: the world definition never names a `.glb`, and
   * `building-model-urls.ts` is the only place one is resolved.
   */
  readonly modelId: string | null;
  readonly labelKey: string;
}

export interface BuildingDefinition {
  readonly id: string;
  readonly kind: LandmarkKind;
  /**
   * The place this building belongs to, or null when it stands on open land.
   *
   * V12.2 removed the production districts, and a windmill or a coop out in the country does not
   * belong to a place the island owns - it belongs to the land, which is the player's. Saying so is
   * the point: a building only claims a district when the island has one to claim.
   */
  readonly district: DistrictKind | null;
  readonly tile: TileCoordinate;
  readonly rotationY: number;
  /** The ground the building stands on, in world metres. Used to keep scenery and roads clear. */
  readonly footprint: { readonly halfWidthWorld: number; readonly halfDepthWorld: number };
  /** What a walker goes around. A simplified circle, never the render mesh. */
  readonly collisionRadiusWorld: number;
  /** Which tier this world draws. Client-side only; it does not read the player's level. */
  readonly visualTier: number;
  readonly variants: readonly BuildingVariant[];
}

/** A place reserved for a building that does not exist yet: the settlement's plan, written down. */
/**
 * The kinds of building the island has set ground aside for but has not built.
 *
 * They are not landmarks: nothing draws them, and no model exists for any tier yet. What exists is
 * the *ladder* - the ground is reserved at its largest tier, and the tier a later pass will draw is
 * one field away, so "the village grows" is a table edit rather than a redesign of the square.
 */
export type ReservedKind = "TOWN_HALL" | "WAREHOUSE";

export interface ReservedBuilding {
  readonly id: string;
  readonly kind: LandmarkKind | ReservedKind;
  readonly district: DistrictKind | null;
  readonly tile: TileCoordinate;
  readonly rotationY: number;
  readonly footprint: { readonly halfWidthWorld: number; readonly halfDepthWorld: number };
  /** Which tier this plot is drawn at today. Nothing draws it yet, so every one is tier 1. */
  readonly tier: number;
  readonly variants: readonly BuildingVariant[];
}

/**
 * The tier ladder for each kind of building.
 *
 * Written out rather than generated, because the ladder *is* the design decision: a market becomes a
 * covered market before it becomes a trade hall, and a harbour is a pier before it is a port. Only
 * tier 1 exists today.
 */
const LADDERS: Readonly<Record<LandmarkKind, readonly BuildingVariant[]>> = {
  FARMHOUSE: [
    { tier: 1, modelId: null, labelKey: "building.farmhouse.t1" },
    { tier: 2, modelId: "farm.silo_house.t2", labelKey: "building.farmhouse.t2" },
    { tier: 3, modelId: null, labelKey: "building.farmhouse.t3" }
  ],
  WINDMILL: [
    { tier: 1, modelId: "farm.windmill.t2", labelKey: "building.windmill.t1" },
    { tier: 2, modelId: "farm.windmill.t2", labelKey: "building.windmill.t2" }
  ],
  WELL: [
    { tier: 1, modelId: "civic.well.t1", labelKey: "building.well.t1" },
    { tier: 2, modelId: "civic.well.t1", labelKey: "building.well.t2" }
  ],
  MARKET_STALL: [
    { tier: 1, modelId: null, labelKey: "building.market.t1" },
    { tier: 2, modelId: null, labelKey: "building.market.t2" },
    { tier: 3, modelId: null, labelKey: "building.market.t3" }
  ],
  STORAGE_SHED: [
    { tier: 1, modelId: "farm.barn.t1", labelKey: "building.storage.t1" },
    { tier: 2, modelId: "farm.barn.t2", labelKey: "building.storage.t2" },
    { tier: 3, modelId: "farm.barn.t3", labelKey: "building.warehouse.t3" }
  ],
  HARBOR: [
    { tier: 1, modelId: null, labelKey: "building.harbor.t1" },
    { tier: 2, modelId: null, labelKey: "building.harbor.t2" },
    { tier: 3, modelId: null, labelKey: "building.harbor.t3" }
  ],
  SILO: [
    { tier: 1, modelId: "farm.silo.t1", labelKey: "building.silo.t1" },
    { tier: 2, modelId: "farm.silo_house.t2", labelKey: "building.silo.t2" }
  ],
  OPEN_BARN: [
    { tier: 1, modelId: "farm.openbarn.t1", labelKey: "building.openbarn.t1" },
    { tier: 2, modelId: "farm.barn.t2", labelKey: "building.openbarn.t2" }
  ],
  COOP: [
    { tier: 1, modelId: "farm.coop.t1", labelKey: "building.coop.t1" },
    { tier: 2, modelId: "farm.openbarn.t1", labelKey: "building.coop.t2" }
  ]
};

/**
 * The tier ladders for the buildings the island has reserved ground for.
 *
 * No model is named yet and nothing draws them: what this establishes is that the *shape* of the
 * upgrade exists before the art does - a village office becomes a town hall and then a civic hall, a
 * storage shed becomes a warehouse and then a logistics building - so the reserved footprints and the
 * future shop entries have something to point at.
 */
const RESERVED_LADDERS: Readonly<Record<ReservedKind, readonly BuildingVariant[]>> = {
  TOWN_HALL: [
    { tier: 1, modelId: null, labelKey: "building.town_hall.t1" },
    { tier: 2, modelId: null, labelKey: "building.town_hall.t2" },
    { tier: 3, modelId: null, labelKey: "building.town_hall.t3" }
  ],
  WAREHOUSE: [
    { tier: 1, modelId: null, labelKey: "building.warehouse.t1" },
    { tier: 2, modelId: null, labelKey: "building.warehouse.t2" },
    { tier: 3, modelId: null, labelKey: "building.warehouse.t3" }
  ]
};

/**
 * Which place a kind belongs to.
 *
 * The island's own buildings are civic: they stand in the village or on the coast. The working
 * buildings that used to claim the orchard and the pasture stand on open land now, which is exactly
 * what they do - and the honest answer is `null` rather than a district that no longer exists.
 */
const DISTRICT_BY_KIND: Readonly<Record<LandmarkKind, DistrictKind | null>> = {
  FARMHOUSE: "SETTLEMENT",
  WELL: "SETTLEMENT",
  MARKET_STALL: "SETTLEMENT",
  HARBOR: "COAST",
  SILO: "SETTLEMENT",
  OPEN_BARN: "SETTLEMENT",
  // Out in the country, on land the island has not kept for itself.
  WINDMILL: null,
  STORAGE_SHED: null,
  COOP: null
};

/** The buildings the island draws today, one per placed landmark. */
export const BUILDINGS: readonly BuildingDefinition[] = LANDMARKS.map((landmark) => ({
  id: landmark.id,
  kind: landmark.kind,
  district: DISTRICT_BY_KIND[landmark.kind],
  tile: landmark.tile,
  rotationY: landmark.rotationY,
  footprint: {
    halfWidthWorld: Math.max(1.4, landmark.blockingRadiusWorld),
    halfDepthWorld: Math.max(1.4, landmark.blockingRadiusWorld)
  },
  collisionRadiusWorld: landmark.blockingRadiusWorld,
  visualTier: 1,
  variants: LADDERS[landmark.kind]
}));

/**
 * The settlement's reserved plots.
 *
 * A civic centre is a *plan*, not whatever ground happened to be free: a town hall on the square,
 * a warehouse on the road out of it, and room between them for the market the island already has.
 * Nothing is built here yet; these are the coordinates the future buildings will take, so the
 * square does not slowly fill with whatever came next.
 */
export const RESERVED_BUILDINGS: readonly ReservedBuilding[] = [
  {
    id: "town_hall",
    kind: "TOWN_HALL",
    district: "SETTLEMENT",
    tile: { x: 47, y: -4 },
    rotationY: Math.PI,
    // The reserved footprint is the *largest* the building will ever be, so a tier-3 town hall has
    // the ground it needs before anybody decides to build it.
    footprint: { halfWidthWorld: 5, halfDepthWorld: 4 },
    tier: 1,
    variants: RESERVED_LADDERS.TOWN_HALL
  },
  {
    id: "warehouse",
    kind: "WAREHOUSE",
    district: "SETTLEMENT",
    tile: { x: 51.5, y: 8 },
    rotationY: -Math.PI / 2,
    footprint: { halfWidthWorld: 5, halfDepthWorld: 3.5 },
    tier: 1,
    variants: RESERVED_LADDERS.WAREHOUSE
  },
  {
    id: "fishery_store",
    kind: "WAREHOUSE",
    district: "COAST",
    tile: { x: 41.5, y: 48 },
    rotationY: -Math.PI / 3,
    footprint: { halfWidthWorld: 3.5, halfDepthWorld: 2.5 },
    tier: 1,
    variants: RESERVED_LADDERS.WAREHOUSE
  }
];

/** The variant a world at this tier draws. Total, so a renderer never has to guess. */
export function variantFor(building: BuildingDefinition): BuildingVariant {
  const exact = building.variants.find((variant) => variant.tier === building.visualTier);
  const first = building.variants[0];
  if (exact !== undefined) return exact;
  if (first === undefined) throw new Error(`building ${building.id} has no variants`);
  return first;
}

/** The district definition a building claims to belong to. */
export function districtOf(kind: DistrictKind): (typeof DISTRICTS)[number] | null {
  return DISTRICTS.find((district) => district.kind === kind) ?? null;
}
