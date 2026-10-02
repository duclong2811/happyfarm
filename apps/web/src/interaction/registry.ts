import type {
  BuildCatalogEntryDTO,
  ConstructionDTO,
  CropDefinitionDTO,
  CropStateDTO,
  TreeDefinitionDTO,
  TreeStateDTO
} from "@happy-farm/contracts";
import { tileToWorld, worldFrame } from "../render/layout";
import { cellKey, worldToCell } from "../render/world-cell";
import { remainingGrowthSeconds } from "../selection";
import { objectPolicy, type WorldObjectDefinitions } from "../world-objects";
import {
  INTERACTION_ACTION_PRIORITY,
  INTERACTION_RANGE_WORLD,
  cropInteraction,
  treeInteraction,
  type InteractionAction,
  type InteractableTarget
} from "./model";

/**
 * The registry: every interactable on the island, and the bounded way to ask what is near the player.
 *
 * Two problems, one structure. The first is that discovery must not scan the world: the island already
 * carries several hundred scenery rows, and it will grow. The second is that a scan must not be able
 * to see a target that is nowhere near, however attractive it looks - proximity is a *rule*, not a
 * sort order. Bucketing every target by the cell it stands on answers both: the query walks only the
 * cells around the player (a few dozen map lookups, whatever the island's size), and a target outside
 * that neighbourhood is not merely ranked last, it is never returned.
 *
 * The index is rebuilt when the read models change - a farm refresh, a planting, a stored object - and
 * never per frame. See `docs/design/INTERACTION_SYSTEM.md` for why this shape and not a spatial tree.
 */

/** Everything the adapters read. All of it is the server's own state, as the page last received it. */
export interface InteractionWorldInput {
  readonly crops: readonly CropStateDTO[];
  readonly trees: readonly TreeStateDTO[];
  readonly constructions: readonly ConstructionDTO[];
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  readonly worldObjects: WorldObjectDefinitions;
  readonly buildCatalog: readonly BuildCatalogEntryDTO[];
  /** Current epoch milliseconds, used only to phrase a growing crop's countdown. */
  readonly nowMs: number;
}

export interface InteractionIndex {
  /** Targets by the cell they stand on. */
  readonly buckets: ReadonlyMap<string, readonly InteractableTarget[]>;
  readonly targets: readonly InteractableTarget[];
}

export const EMPTY_INTERACTION_INDEX: InteractionIndex = { buckets: new Map(), targets: [] };

/** The furthest a target may be, used to size the neighbourhood rather than to filter by it. */
export function maxInteractionRangeWorld(): number {
  return Math.max(
    INTERACTION_RANGE_WORLD.CROP,
    INTERACTION_RANGE_WORLD.TREE,
    INTERACTION_RANGE_WORLD.WORLD_OBJECT
  );
}

/**
 * How many cells around the player the query has to look.
 *
 * Derived from the ranges and the tile pitch rather than written down, so widening a range cannot
 * silently make an in-range target unreachable. One extra cell covers a player standing at the very
 * edge of their own cell.
 */
export function interactionSearchRadiusCells(frame = worldFrame()): number {
  const pitch = Number.isFinite(frame.pitch) && frame.pitch > 0 ? frame.pitch : 1;
  return Math.ceil(maxInteractionRangeWorld() / pitch) + 1;
}

/**
 * Whether a built thing is something a character walks up to.
 *
 * Deliberately not "every construction". The island ships several hundred single-cell starter props -
 * pines, bushes, rocks, tufts - and narrating each one would leave an interaction prompt on screen
 * permanently, which is exactly the "never reserve space for nothing" rule the mobile pass established.
 * So a target is: **something the player placed themselves**, or **something that occupies more than
 * one cell** - a barn, the mill, an authored landmark - which is a place a person can stand outside of.
 * Single-cell island scenery stays selectable in Estate view, where selection is the interaction.
 */
export function worldObjectIsInteractable(row: ConstructionDTO): boolean {
  if (row.source === "PLAYER_PLACED") return true;
  return row.footprint.widthCells > 1 || row.footprint.depthCells > 1;
}

/** One crop row, as a target. Maturity is the server's `mature` flag and nothing else. */
function cropTarget(
  crop: CropStateDTO,
  definitions: readonly CropDefinitionDTO[],
  nowMs: number
): InteractableTarget {
  const definition = definitions.find((entry) => entry.cropDefinitionId === crop.definitionId);
  const position = tileToWorld({ x: crop.tileX, y: crop.tileY }, worldFrame());
  const action = cropInteraction(crop);
  return {
    key: `crop:${crop.cropInstanceId}`,
    kind: "CROP",
    action,
    targetId: crop.cropInstanceId,
    tileX: crop.tileX,
    tileY: crop.tileY,
    worldX: position.worldX,
    worldZ: position.worldZ,
    rangeWorld: INTERACTION_RANGE_WORLD.CROP,
    priority: INTERACTION_ACTION_PRIORITY[action],
    nameKey: definition?.displayNameKey ?? null,
    nameFallback: crop.definitionId,
    version: crop.version,
    readyInSeconds:
      action === "HARVEST" ? null : remainingGrowthSeconds(crop, definition, nowMs)
  };
}

/** One production tree, as a target. The cycle's readiness is the server's `ready` flag. */
function treeTarget(tree: TreeStateDTO, definitions: readonly TreeDefinitionDTO[]): InteractableTarget {
  const definition = definitions.find((entry) => entry.treeDefinitionId === tree.definitionId);
  const position = tileToWorld({ x: tree.tileX, y: tree.tileY }, worldFrame());
  const action = treeInteraction(tree);
  return {
    key: `tree:${tree.treeInstanceId}`,
    kind: "TREE",
    action,
    targetId: tree.treeInstanceId,
    tileX: tree.tileX,
    tileY: tree.tileY,
    worldX: position.worldX,
    worldZ: position.worldZ,
    rangeWorld: INTERACTION_RANGE_WORLD.TREE,
    priority: INTERACTION_ACTION_PRIORITY[action],
    nameKey: definition?.displayNameKey ?? null,
    nameFallback: tree.definitionId,
    version: tree.version,
    readyInSeconds: action === "HARVEST" ? null : Math.max(0, tree.secondsUntilReady)
  };
}

/**
 * One built thing, as a target.
 *
 * The anchor is the row's own position rather than the visual centre of its bounding box: a barn's
 * anchor is the cell the player chose, and a landmark's is where the island put it, which is what the
 * prompt should name. V14.1 offers Inspect only - Open, Use and Enter arrive with the objects that
 * mean them.
 */
function constructionTarget(
  row: ConstructionDTO,
  worldObjects: WorldObjectDefinitions,
  catalog: readonly BuildCatalogEntryDTO[]
): InteractableTarget {
  const position = tileToWorld({ x: row.anchorX, y: row.anchorY }, worldFrame());
  const policy = objectPolicy(row, worldObjects, catalog);
  // What the object *does* comes from its own definition, never from its model or its name: the market
  // stall is a `FARM_MARKET` because game data says so, so a second stall - or a stall this build has
  // never seen - offers Trade without a line of client code changing.
  const service = worldObjects.get(row.entryId)?.service ?? null;
  const action: InteractionAction = service === "FARM_MARKET" ? "TRADE" : "INSPECT";
  return {
    key: `object:${row.constructionId}`,
    kind: "WORLD_OBJECT",
    action,
    targetId: row.constructionId,
    tileX: Math.floor(row.anchorX),
    tileY: Math.floor(row.anchorY),
    worldX: position.worldX,
    worldZ: position.worldZ,
    rangeWorld: INTERACTION_RANGE_WORLD.WORLD_OBJECT,
    priority: INTERACTION_ACTION_PRIORITY[action],
    nameKey: policy?.displayNameKey ?? null,
    nameFallback: policy?.label ?? row.entryId,
    version: row.version,
    readyInSeconds: null
  };
}

/** Adapts the read models into one flat list of targets. Pure: nothing here touches the network. */
export function interactionTargets(input: InteractionWorldInput): readonly InteractableTarget[] {
  const targets: InteractableTarget[] = [];
  for (const crop of input.crops) {
    targets.push(cropTarget(crop, input.cropDefinitions, input.nowMs));
  }
  for (const tree of input.trees) {
    targets.push(treeTarget(tree, input.treeDefinitions));
  }
  for (const row of input.constructions) {
    // Only rows that are standing: a stored object is the player's, and it is not on the island.
    if (row.state !== "ACTIVE") continue;
    if (!worldObjectIsInteractable(row)) continue;
    targets.push(constructionTarget(row, input.worldObjects, input.buildCatalog));
  }
  return targets;
}

export function buildInteractionIndex(input: InteractionWorldInput): InteractionIndex {
  const targets = interactionTargets(input);
  const buckets = new Map<string, InteractableTarget[]>();
  for (const target of targets) {
    const key = cellKey(target.tileX, target.tileY);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [target]);
    else bucket.push(target);
  }
  return { buckets, targets };
}

/**
 * Everything near a world position, and nothing else.
 *
 * The walk is over the neighbourhood's cell keys only, so a bigger island costs the same; and because
 * a target is bucketed by the cell it stands on, a target just outside the neighbourhood is invisible
 * here rather than ranked low. Range is then applied per target by the selector, since different
 * families are allowed to reach different distances.
 */
export function targetsNear(
  index: InteractionIndex,
  worldX: number,
  worldZ: number,
  frame = worldFrame()
): readonly InteractableTarget[] {
  const centre = worldToCell({ worldX, worldZ }, frame);
  const radius = interactionSearchRadiusCells(frame);
  const found: InteractableTarget[] = [];
  for (let x = centre.x - radius; x <= centre.x + radius; x += 1) {
    for (let y = centre.y - radius; y <= centre.y + radius; y += 1) {
      const bucket = index.buckets.get(cellKey(x, y));
      if (bucket === undefined) continue;
      for (const target of bucket) found.push(target);
    }
  }
  return found;
}
