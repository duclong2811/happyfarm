import type { BuildCatalogEntryDTO, ConstructionDTO, WorldObjectDefinitionDTO } from "@happy-farm/contracts";
import { STARTER_WORLD_PLACEMENTS } from "@happy-farm/game-data";
import { BUILDING_MODELS } from "./render/building-model-urls";
import { tileToWorld, type WorldFrame } from "./render/layout";
import { PROP_MODELS } from "./render/prop-model-urls";
import type { WorldObstacle } from "./render/world-config";

/**
 * How a persistent object is drawn and what may be done to it, whoever it belongs to.
 *
 * Two families of definition meet here and are deliberately treated as one: a `place_*` catalogue
 * entry a player bought, and a `world.*` definition an ordinary island object came from. A row names
 * one of them; this module answers the two questions the renderer and the panel ask - which model at
 * what size, and which actions the asset allows - without either of them caring which family it was.
 */

/** One object as the world's own definitions describe it, keyed for lookup. */
export type WorldObjectDefinitions = ReadonlyMap<string, WorldObjectDefinitionDTO>;

export function indexWorldObjects(definitions: readonly WorldObjectDefinitionDTO[]): WorldObjectDefinitions {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

/**
 * How the island arranged one object when it was still the renderer's.
 *
 * A forest is a family of models and a scatter of sizes, and V13.3.1 moved that family into rows
 * without flattening it: the starter layout records which model each promoted tree grew as and how
 * tall it was, and a row is drawn from that - keyed by its stable `placementKey`, so moving a tree
 * keeps the tree. A row a player bought has no placement key and is resolved from its catalogue
 * entry as before.
 */
export interface StarterVisual {
  readonly modelId: string | null;
  readonly sizeWorld: number | null;
  /** The facing the island arranged it at, in radians, added to the player's whole quarter turns. */
  readonly baseYaw: number;
}

const STARTER_VISUALS: ReadonlyMap<string, StarterVisual> = new Map(
  STARTER_WORLD_PLACEMENTS.map((placement) => [
    placement.key,
    {
      modelId: placement.modelId ?? null,
      sizeWorld: placement.sizeWorld ?? null,
      baseYaw: placement.baseYaw ?? 0
    }
  ])
);

/** The island's arrangement of one object, or undefined for anything the player placed. */
export function starterVisual(placementKey: string | null): StarterVisual | undefined {
  return placementKey === null ? undefined : STARTER_VISUALS.get(placementKey);
}

export interface ObjectPresentation {
  /** The `.glb` to draw, or null when this build ships nothing for it. */
  readonly modelId: string | null;
  /** How large the model is drawn, in metres. Every imported model is normalized to one unit. */
  readonly sizeWorld: number;
}

/**
 * How an object is drawn.
 *
 * A world object carries its own size, because `world.*` definitions are the island's own catalogue.
 * A bought object's model is resolved here: props and buildings carry a size in their manifests, and
 * the island's own trees, rocks and flowers are given the size their scenery kind is drawn at - which
 * is what stops a placed tree from being a metre tall next to a three-metre one the island grew.
 */
export function objectPresentation(
  row: ConstructionDTO,
  worldObjects: WorldObjectDefinitions,
  catalog: readonly BuildCatalogEntryDTO[]
): ObjectPresentation {
  const world = worldObjects.get(row.entryId);
  if (world !== undefined) {
    return { modelId: world.modelId, sizeWorld: world.sizeWorld };
  }
  const entry = catalog.find((candidate) => candidate.entryId === row.entryId);
  const modelId = entry?.modelId ?? null;
  if (modelId === null) return { modelId: null, sizeWorld: 1 };
  return { modelId, sizeWorld: settledModelSize(modelId) };
}

/**
 * The size a shipped model is drawn at, for the families that do not carry one on the catalogue row.
 *
 * The props and buildings have manifests with real metres in them; the island's vegetation does not,
 * because until V13.3 nothing drew it as a construction. The numbers match `unitScaleFor` in the
 * scenery pass, so a planted tree and a bought one are the same size.
 */
export function settledModelSize(modelId: string): number {
  const prop = PROP_MODELS.get(modelId);
  if (prop !== undefined) return prop.sizeWorld;
  const building = BUILDING_MODELS.get(modelId);
  if (building !== undefined) return building.sizeWorld;
  // The vegetation families, by the name the manifest gives them.
  if (modelId.startsWith("tree_pine")) return 3.8;
  if (modelId.startsWith("tree_broad")) return 3.4;
  if (modelId.startsWith("bush")) return 1.1;
  if (modelId.startsWith("rock")) return 1.3;
  if (modelId.startsWith("flower")) return 0.9;
  if (modelId.startsWith("plant")) return 0.7;
  return 1;
}

export interface ObjectPolicy {
  readonly movable: boolean;
  readonly rotatable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  /** The catalogue price, when there is one. A world object is not for sale. */
  readonly price: number;
  readonly removalRefundRate: number;
  readonly displayNameKey: string | null;
  readonly label: string | null;
  readonly requiredLevel: number;
}

/**
 * What may be done with an object, from whichever definition family describes it.
 *
 * A row whose definition this client does not have answers null, and the panel offers nothing: a
 * guessed button is worse than a missing one.
 */
export function objectPolicy(
  row: ConstructionDTO,
  worldObjects: WorldObjectDefinitions,
  catalog: readonly BuildCatalogEntryDTO[]
): ObjectPolicy | null {
  const world = worldObjects.get(row.entryId);
  if (world !== undefined) {
    return {
      movable: world.movable,
      rotatable: world.rotatable,
      storable: world.storable,
      removable: world.removable,
      // Nobody sells a starter tree, so nothing about it is a price.
      price: 0,
      removalRefundRate: world.removalRefundRate,
      displayNameKey: world.displayNameKey,
      label: null,
      requiredLevel: 1
    };
  }
  const entry = catalog.find((candidate) => candidate.entryId === row.entryId);
  if (entry === undefined) return null;
  return {
    movable: entry.movable,
    rotatable: entry.rotatable,
    storable: entry.storable,
    removable: entry.removable,
    price: entry.price,
    removalRefundRate: entry.removalRefundRate,
    displayNameKey: entry.displayNameKey,
    label: entry.label,
    requiredLevel: entry.requiredLevel
  };
}

/**
 * What a removal would return, from what the object actually cost.
 *
 * The cost basis, not the price: a starter object paid for by nobody returns nothing however valuable
 * its definition is, and the client says so before the player commits.
 */
export function removalRefundPreview(row: ConstructionDTO, policy: ObjectPolicy): number {
  const rate = Math.min(1, Math.max(0, policy.removalRefundRate));
  const paid = Math.max(0, Math.min(row.paidAmount, row.costAmount));
  return Math.floor(paid * rate);
}

/** The objects standing on the island. */
export function activeObjects(rows: readonly ConstructionDTO[]): readonly ConstructionDTO[] {
  return rows.filter((row) => row.state === "ACTIVE");
}

/**
 * The collision circles the farm's own standing objects contribute to the walker.
 *
 * A building is as solid as a landmark, and because it can be moved, stored or removed its circle
 * has to come from its row rather than from a list compiled into the world config - that is what
 * stops a collision circle staying behind when its barn walks away. Only ACTIVE rows count: a
 * stored object has left the world and released its ground.
 */
export function objectObstacles(
  rows: readonly ConstructionDTO[],
  frame: WorldFrame,
  /**
   * The definitions, so a circle is the object's *own* size rather than a guess from its footprint.
   *
   * A tree blocks by its trunk and a flower patch by nothing; with the whole island promoted those
   * distinctions matter, and they already live on the definition the client holds.
   */
  definitions: WorldObjectDefinitions = new Map()
): readonly WorldObstacle[] {
  const { pitch } = frame;
  const obstacles: WorldObstacle[] = [];
  for (const row of activeObjects(rows)) {
    const anchor = tileToWorld({ x: row.anchorX, y: row.anchorY }, frame);
    // An even span's centre sits half a cell off the anchor's own centre, so an object is drawn and
    // blocked around the footprint the player picked rather than around one of its corners.
    const centreX =
      anchor.worldX + ((row.footprint.widthCells - 1) / 2 - Math.floor((row.footprint.widthCells - 1) / 2)) * pitch;
    const centreZ =
      anchor.worldZ + ((row.footprint.depthCells - 1) / 2 - Math.floor((row.footprint.depthCells - 1) / 2)) * pitch;
    const definition = definitions.get(row.entryId);
    const radiusWorld =
      definition === undefined
        ? (Math.min(row.footprint.widthCells, row.footprint.depthCells) / 2) * pitch + 0.18
        : definition.collisionRadiusWorld;
    // A definition that blocks nothing - a flower patch - has no circle at all, rather than a
    // hair-thin one a walker would still bump into.
    if (radiusWorld <= 0) continue;
    obstacles.push({
      id: row.constructionId,
      centerWorldX: centreX,
      centerWorldZ: centreZ,
      radiusWorld
    });
  }
  return obstacles;
}

/**
 * The objects held in storage, newest first.
 *
 * Storage is a *state* of the same row rather than a second table, so this is a filter and never a
 * second inventory to reconcile.
 */
export function storedObjects(rows: readonly ConstructionDTO[]): readonly ConstructionDTO[] {
  return rows
    .filter((row) => row.state === "STORED")
    .slice()
    .sort((left, right) => (right.storedAt ?? "").localeCompare(left.storedAt ?? ""));
}

/** How many of each stored definition the player holds, in a stable order. */
export interface StorageStack {
  readonly entryId: string;
  readonly count: number;
  /** The newest row of the stack, which is the one a placement restores. */
  readonly newest: ConstructionDTO;
}

export function storageStacks(rows: readonly ConstructionDTO[]): readonly StorageStack[] {
  const byEntry = new Map<string, StorageStack>();
  for (const row of storedObjects(rows)) {
    const existing = byEntry.get(row.entryId);
    byEntry.set(row.entryId, {
      entryId: row.entryId,
      count: (existing?.count ?? 0) + 1,
      newest: existing?.newest ?? row
    });
  }
  return [...byEntry.values()];
}
