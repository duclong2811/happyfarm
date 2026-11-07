/**
 * Turning a raycast hit into the built thing it belongs to.
 *
 * A persisted construction is drawn as a *clone of a model*, and a model is a tree of nodes: the
 * intersection the raycaster reports is almost never the node the renderer hung the id on. It is a
 * leaf mesh three levels down, and the only robust way back to the row is to walk the ancestors until
 * one of them says what it is. Nothing here may depend on a mesh *name*: names come from whichever
 * exporter produced the asset, and an asset that is reimported would silently stop being selectable.
 *
 * Pure and structural - it needs `userData` and `parent`, which a three `Object3D` has, and nothing
 * else - so the whole resolution can be tested against real three objects without a WebGL context.
 */

/** The key a construction root carries. One key, one meaning, read by the picker and the marker. */
export const CONSTRUCTION_ID_KEY = "constructionId";

/**
 * The key an *instanced* construction batch carries: the object id behind each instance, in order.
 *
 * A forest is drawn as a few `InstancedMesh` batches rather than a mesh per tree, and a raycast
 * against one reports an instance index - so the batch has to say what each index means. The batch is
 * rebuilt whenever the rows change, so a removed or stored tree takes its slot with it and can never
 * be selected through a stale mapping.
 */
export const CONSTRUCTION_IDS_KEY = "constructionIds";

/** Stable metadata keys for direct world-resource picking. */
export const RESOURCE_NODE_ID_KEY = "resourceNodeId";
export const FISHING_SPOT_ID_KEY = "fishingSpotId";

/** The two things a `userData` bag and a parent pointer are all this needs. */
export interface PickableNode {
  readonly userData: { readonly [key: string]: unknown };
  readonly parent: PickableNode | null;
}

/**
 * The id of the construction a node belongs to, or null when it belongs to none.
 *
 * `instanceId` is what a raycast against an `InstancedMesh` reports. When the node carries the batch's
 * own instance-to-object table, that is the exact answer; otherwise the search walks the ancestors,
 * which is how a *cloned* model - whose leaf mesh is three levels below the node the id was written
 * on - is resolved.
 */
export function constructionIdFromNode(node: PickableNode | null, instanceId?: number): string | null {
  let current = node;
  while (current !== null) {
    if (instanceId !== undefined) {
      const ids = current.userData[CONSTRUCTION_IDS_KEY];
      if (Array.isArray(ids)) {
        const id = (ids as readonly unknown[])[instanceId];
        if (typeof id === "string" && id.length > 0) return id;
      }
    }
    const id = current.userData[CONSTRUCTION_ID_KEY];
    if (typeof id === "string") return id;
    current = current.parent;
  }
  return null;
}

/**
 * The id of the nearest hit that belongs to a construction, or null.
 *
 * Raycaster hits arrive sorted nearest-first, so the first hit whose ancestry names a construction is
 * the thing the player actually pointed at - not something standing behind it, and not the ground.
 * A hit that belongs to no construction is skipped rather than ending the search, because the world's
 * own scenery is interspersed with the player's objects on the same ray.
 */
export function constructionIdFromHits(
  hits: readonly { readonly object: PickableNode; readonly instanceId?: number | undefined }[]
): string | null {
  for (const hit of hits) {
    const id = constructionIdFromNode(hit.object, hit.instanceId);
    if (id !== null) return id;
  }
  return null;
}

/** Resolve a ground ray against a server-provided construction footprint while its model is loading. */
export function constructionIdFromWorldPoint(
  point: { readonly worldX: number; readonly worldZ: number },
  constructions: readonly {
    readonly id: string;
    readonly worldX: number;
    readonly worldZ: number;
    readonly widthCells: number;
    readonly depthCells: number;
  }[],
  pitch: number
): string | null {
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  let best: { readonly id: string; readonly distance: number } | null = null;
  for (const construction of constructions) {
    const offsetX = ((construction.widthCells - 1) / 2 - Math.floor((construction.widthCells - 1) / 2)) * pitch;
    const offsetZ = ((construction.depthCells - 1) / 2 - Math.floor((construction.depthCells - 1) / 2)) * pitch;
    const centreX = construction.worldX + offsetX;
    const centreZ = construction.worldZ + offsetZ;
    if (
      Math.abs(point.worldX - centreX) > (construction.widthCells * pitch) / 2 ||
      Math.abs(point.worldZ - centreZ) > (construction.depthCells * pitch) / 2
    ) continue;
    const distance = Math.hypot(point.worldX - centreX, point.worldZ - centreZ);
    if (best === null || distance < best.distance || (distance === best.distance && construction.id < best.id)) {
      best = { id: construction.id, distance };
    }
  }
  return best?.id ?? null;
}

/** Resolves a resource/fishing id from a hit mesh or one of its GLB ancestors. */
export function worldTargetIdFromNode(
  node: PickableNode | null,
  key: typeof RESOURCE_NODE_ID_KEY | typeof FISHING_SPOT_ID_KEY
): string | null {
  let current = node;
  while (current !== null) {
    const id = current.userData[key];
    if (typeof id === "string" && id.length > 0) return id;
    current = current.parent;
  }
  return null;
}

export type WorldPickTarget =
  | { readonly kind: "RESOURCE_NODE" | "FISHING_SPOT"; readonly id: string }
  | { readonly kind: "CONSTRUCTION"; readonly id: string };

/**
 * Resolves a tap after the renderer has collected direct and ground-fallback candidates.
 *
 * Direct resource hits must win over a nearby construction because the resource mesh is the thing
 * the player actually pointed at. A direct construction hit still wins over a resource's ground
 * fallback, which preserves management clicks on placed objects while their model is visible.
 */
export function prioritizeWorldPick(input: {
  readonly directWorldTarget: Exclude<WorldPickTarget, { readonly kind: "CONSTRUCTION" }> | null;
  readonly directConstructionId: string | null;
  readonly fallbackWorldTarget: Exclude<WorldPickTarget, { readonly kind: "CONSTRUCTION" }> | null;
  readonly fallbackConstructionId: string | null;
}): WorldPickTarget | null {
  if (input.directWorldTarget !== null) return input.directWorldTarget;
  if (input.directConstructionId !== null) {
    return { kind: "CONSTRUCTION", id: input.directConstructionId };
  }
  if (input.fallbackWorldTarget !== null) return input.fallbackWorldTarget;
  if (input.fallbackConstructionId !== null) {
    return { kind: "CONSTRUCTION", id: input.fallbackConstructionId };
  }
  return null;
}

/** Which layer a tap acts on. */
export type TapTarget = "OBJECT" | "GROUND";

/**
 * What a tap means: the object under the pointer, or the ground.
 *
 * The one line of interaction priority the whole editor rests on. While something is in hand for
 * placement or a move, object picking is off and every tap is a placement tap - otherwise a click
 * that was meant to say "put it here" would quietly select the barn the ghost is standing over.
 */
export function tapTargetFor(input: {
  readonly objectPickingEnabled: boolean;
  readonly constructionId: string | null;
}): TapTarget {
  return input.objectPickingEnabled && input.constructionId !== null ? "OBJECT" : "GROUND";
}
