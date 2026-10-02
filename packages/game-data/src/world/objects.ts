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
export const WORLD_OBJECT_DEFINITIONS: readonly WorldObjectDefinition[] = [
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
