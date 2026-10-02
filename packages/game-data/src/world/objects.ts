/**
 * What a world object *is*, as data both the server and the renderer read.
 *
 * This is the definition layer the V13.3 brief asks for: an instance (a row) points at one of these,
 * and the definition decides the object's footprint, the ground it may stand on, whether it can be
 * moved, turned, stored or removed, what a removal returns, and how it is drawn. Nothing about a
 * particular object's *place* lives here - that is the instance's - and nothing about rendering lives
 * here either except the id of the model, which is a name both sides already resolve.
 *
 * The set is deliberately small and ordinary. The brief's rule is that an object's *source* must not
 * decide its editability, so nothing here is marked "starter": the starter layout places these
 * definitions exactly as a player would, and the same definitions are what the renderer draws.
 */

/** The ground an object may stand on, physically. Never an economic district. */
export type WorldObjectGround = "LAND" | "SHORE" | "SHALLOW_WATER" | "WATER";

/**
 * How an object is drawn.
 *
 * `MODEL` is a `.glb` the client resolves; `LANDMARK` is one of the island's primitive structures,
 * which has no model of its own yet and is drawn by the renderer's builder for that kind. Two forms
 * rather than one because the authored buildings genuinely are two: some shipped as models and some
 * are still assembled from primitives.
 */
export type WorldObjectPresentation =
  | { readonly form: "MODEL"; readonly modelId: string; readonly sizeWorld: number }
  | { readonly form: "LANDMARK"; readonly kind: string };

export interface WorldObjectDefinition {
  readonly id: string;
  /** A dotted translation key. The client falls back to the words in the key when it has no string. */
  readonly displayNameKey: string;
  readonly presentation: WorldObjectPresentation;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  /** The circle a walker goes around. */
  readonly collisionRadiusWorld: number;
  readonly allowedTerrain: readonly WorldObjectGround[];
  readonly movable: boolean;
  readonly rotatable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  /**
   * The share of what the *owner actually paid* a removal returns.
   *
   * A rate, not a price: the money is `floor(paidAmount x rate)`, and `paidAmount` lives on the
   * instance. A starter object was paid for by nobody, so it can pay nothing back however valuable
   * its definition is - which is the P0 exploit this shape exists to make impossible.
   */
  readonly removalRefundRate: number;
  /**
   * Whether the island keeps this object.
   *
   * A system object is not a player's to change, whoever is looking at it. Ordinary objects - every
   * one below - are `false`, and the flag exists so that the few genuinely protected things have
   * somewhere to say so rather than being protected by their source.
   */
  readonly system: boolean;
}

/**
 * The ordinary starter objects.
 *
 * Vegetation and one building. Every one of them is movable, turnable, storable and removable, for
 * nothing back, because nobody paid for it.
 */
const BASE_WORLD_OBJECTS: readonly WorldObjectDefinition[] = [
  {
    id: "world.windmill",
    displayNameKey: "object.windmill.name",
    // The island's own mill: the one authored building this pass hands to the player, so "a starter
    // building can be selected and moved" is a real behaviour rather than a promise.
    presentation: { form: "MODEL", modelId: "farm.windmill.t2", sizeWorld: 8.6 },
    footprint: { widthCells: 3, depthCells: 3 },
    collisionRadiusWorld: 1.8,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.tree_broad",
    displayNameKey: "object.tree_broad.name",
    presentation: { form: "MODEL", modelId: "tree_broad_2", sizeWorld: 3.4 },
    footprint: { widthCells: 1, depthCells: 1 },
    collisionRadiusWorld: 0.5,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.tree_pine",
    displayNameKey: "object.tree_pine.name",
    presentation: { form: "MODEL", modelId: "tree_pine_2", sizeWorld: 3.8 },
    footprint: { widthCells: 1, depthCells: 1 },
    collisionRadiusWorld: 0.5,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.rock",
    displayNameKey: "object.rock.name",
    presentation: { form: "MODEL", modelId: "rock_boulder_3", sizeWorld: 1.3 },
    footprint: { widthCells: 1, depthCells: 1 },
    collisionRadiusWorld: 0.6,
    allowedTerrain: ["LAND", "SHORE"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.bush",
    displayNameKey: "object.bush.name",
    presentation: { form: "MODEL", modelId: "bush_leafy", sizeWorld: 1.1 },
    footprint: { widthCells: 1, depthCells: 1 },
    collisionRadiusWorld: 0.4,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.flowers",
    displayNameKey: "object.flowers.name",
    presentation: { form: "MODEL", modelId: "flower_group_1", sizeWorld: 0.9 },
    footprint: { widthCells: 1, depthCells: 1 },
    // Flowers are what a road's edge is made of: they do not block a walker, which is why the circle
    // is zero rather than small.
    collisionRadiusWorld: 0,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  },
  {
    id: "world.grass_clump",
    displayNameKey: "object.grass_clump.name",
    presentation: { form: "MODEL", modelId: "plant_grass_tall", sizeWorld: 0.7 },
    footprint: { widthCells: 1, depthCells: 1 },
    collisionRadiusWorld: 0,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  }
];

/**
 * The island's authored buildings, as ordinary editable objects.
 *
 * V13.3 promoted the mill and left the rest as renderer-owned landmarks; V13.3.1 hands the player the
 * whole settlement, because a farmhouse is a farmhouse whatever drew it. Each keeps the footprint and
 * the circle the *building* already declared, so the collision the player walks around is the one the
 * island always had, and each names the landmark builder for its kind so the renderer draws exactly
 * what it drew before - only now from a row the player may move.
 *
 * Nothing here is `system`. The plaza's paving, the quay and the roads are geography and stay
 * protected, but a *building standing on* them is an object like any other; making them permanent
 * merely because the old renderer called them landmarks is the thing this pass exists to undo.
 */
interface BuildingObjectInput {
  readonly id: string;
  readonly displayNameKey: string;
  readonly landmarkKind: string;
  readonly footprintCells: number;
  readonly collisionRadiusWorld: number;
}

const BUILDING_OBJECTS: readonly BuildingObjectInput[] = [
  { id: "world.barn", displayNameKey: "object.barn.name", landmarkKind: "FARMHOUSE", footprintCells: 4, collisionRadiusWorld: 2.2 },
  { id: "world.farmhouse", displayNameKey: "object.farmhouse.name", landmarkKind: "FARMHOUSE", footprintCells: 5, collisionRadiusWorld: 2.6 },
  { id: "world.market_stall", displayNameKey: "object.market_stall.name", landmarkKind: "MARKET_STALL", footprintCells: 2, collisionRadiusWorld: 1.2 },
  { id: "world.well", displayNameKey: "object.well.name", landmarkKind: "WELL", footprintCells: 2, collisionRadiusWorld: 0.85 },
  { id: "world.storage_shed", displayNameKey: "object.storage_shed.name", landmarkKind: "STORAGE_SHED", footprintCells: 3, collisionRadiusWorld: 1.6 },
  { id: "world.open_barn", displayNameKey: "object.open_barn.name", landmarkKind: "OPEN_BARN", footprintCells: 3, collisionRadiusWorld: 1.8 },
  { id: "world.silo", displayNameKey: "object.silo.name", landmarkKind: "SILO", footprintCells: 3, collisionRadiusWorld: 1.6 },
  { id: "world.coop", displayNameKey: "object.coop.name", landmarkKind: "COOP", footprintCells: 2, collisionRadiusWorld: 1.1 },
  { id: "world.harbor", displayNameKey: "object.harbor.name", landmarkKind: "HARBOR", footprintCells: 3, collisionRadiusWorld: 1.4 }
];

function buildingObject(input: BuildingObjectInput): WorldObjectDefinition {
  return {
    id: input.id,
    displayNameKey: input.displayNameKey,
    // The barn is drawn from a model the build ships; the village and the quay are still assembled
    // from primitives, and `presentation.form: LANDMARK` is how the definition says so.
    presentation:
      input.id === "world.barn"
        ? { form: "MODEL", modelId: "farm.barn.t2", sizeWorld: 6.4 }
        : { form: "LANDMARK", kind: input.landmarkKind },
    footprint: { widthCells: input.footprintCells, depthCells: input.footprintCells },
    collisionRadiusWorld: input.collisionRadiusWorld,
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  };
}

/**
 * The island's set dressing: the barrels, crates, benches and stalls that make a yard a yard.
 *
 * The brief's rule is that a player who can clearly see an object should be able to select it, and a
 * barrel by a door is exactly that. They are the smallest promoted family, so every one keeps the
 * footprint of a single cell and a collision circle taken from its own size - a bucket is something
 * to walk around, not a wall.
 */
const PROP_OBJECTS: readonly { readonly assetId: string; readonly sizeWorld: number }[] = [
  { assetId: "prop_barrel", sizeWorld: 0.95 },
  { assetId: "prop_barrel_apples", sizeWorld: 0.95 },
  { assetId: "prop_crate_wooden", sizeWorld: 0.7 },
  { assetId: "prop_crate_produce", sizeWorld: 0.68 },
  { assetId: "prop_crate_carrot", sizeWorld: 0.68 },
  { assetId: "prop_crate_empty", sizeWorld: 0.62 },
  { assetId: "prop_sack", sizeWorld: 0.8 },
  { assetId: "prop_bucket", sizeWorld: 0.42 },
  { assetId: "prop_bench", sizeWorld: 1.5 },
  { assetId: "prop_stall", sizeWorld: 2.6 },
  { assetId: "prop_stall_cart", sizeWorld: 2.9 },
  { assetId: "prop_rope", sizeWorld: 0.5 },
  { assetId: "prop_lantern", sizeWorld: 0.55 },
  { assetId: "prop_planter", sizeWorld: 0.75 },
  { assetId: "prop_axe", sizeWorld: 0.8 },
  { assetId: "prop_anvil_log", sizeWorld: 1.2 },
  { assetId: "prop_workbench", sizeWorld: 1.9 },
  { assetId: "prop_chest", sizeWorld: 0.9 },
  { assetId: "prop_cage_small", sizeWorld: 0.95 },
  { assetId: "prop_whetstone", sizeWorld: 0.65 },
  { assetId: "prop_crate", sizeWorld: 0.75 },
  { assetId: "prop_wagon", sizeWorld: 2.2 },
  { assetId: "prop_fence_rail", sizeWorld: 1.3 },
  { assetId: "prop_fence_rail_long", sizeWorld: 2.1 }
];

function propObject(input: { readonly assetId: string; readonly sizeWorld: number }): WorldObjectDefinition {
  return {
    id: `world.${input.assetId}`,
    displayNameKey: `object.${input.assetId}.name`,
    presentation: { form: "MODEL", modelId: input.assetId, sizeWorld: input.sizeWorld },
    footprint: { widthCells: 1, depthCells: 1 },
    // A prop blocks a walker by its own width, and half of a small prop is a small circle: the number
    // is a real measurement, not the whole cell.
    collisionRadiusWorld: Math.max(0.2, input.sizeWorld * 0.35),
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    system: false
  };
}

/**
 * Every ordinary world object this build ships: the V13.3 families, the island's buildings, and the
 * set dressing. One list, because the server seeds from it, the renderer draws from it, and the
 * editor offers its policy - a definition that existed in only one of those places would be a
 * disagreement waiting to happen.
 */
export const WORLD_OBJECT_DEFINITIONS: readonly WorldObjectDefinition[] = [
  ...BASE_WORLD_OBJECTS,
  ...BUILDING_OBJECTS.map(buildingObject),
  ...PROP_OBJECTS.map(propObject)
];

const BY_ID: ReadonlyMap<string, WorldObjectDefinition> = new Map(
  WORLD_OBJECT_DEFINITIONS.map((definition) => [definition.id, definition])
);

/** A definition, or null when this build ships nothing for that id. */
export function worldObjectDefinition(id: string): WorldObjectDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** Every definition id, for the tests and the seed that walk the set. */
export const WORLD_OBJECT_DEFINITION_IDS: readonly string[] = WORLD_OBJECT_DEFINITIONS.map(
  (definition) => definition.id
);
