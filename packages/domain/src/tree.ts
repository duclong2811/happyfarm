import { DomainError } from "./errors";
import type { FarmId, ItemDefinitionId, PlayerId, TreeDefinitionId, TreeInstanceId } from "./ids";
import { meetsRequiredLevel } from "./progression";

/**
 * A repeating producer: the second crop pattern.
 *
 * A tree differs from an annual crop in exactly two ways, and both are visible here. It carries two
 * durations instead of one, because the first fruit takes as long as it takes and every fruit after
 * it takes the regrow duration; and harvesting it does not end its life, so the instance keeps a
 * record of the last harvest rather than being deleted.
 *
 * The definition is authoritative game data. Nothing in it is ever supplied by a client, and no use
 * case branches on a tree id: a second species is another row in `packages/game-data`.
 */
export interface TreeDefinition {
  readonly id: TreeDefinitionId;
  readonly displayNameKey: string;
  /** The sapling item planting this tree consumes, exactly one per planting. */
  readonly saplingItemDefinitionId: ItemDefinitionId;
  /** Seconds from planting to the first ready harvest. */
  readonly firstReadySeconds: number;
  /** Seconds from one harvest to the next: the repeating cycle. */
  readonly regrowSeconds: number;
  readonly growthStages: number;
  /**
   * The player level at which this tree becomes plantable. Absent means no requirement.
   *
   * A farm has no level of its own, so this is the player's level, and `isTreeUnlocked` below is the
   * only rule that reads it.
   */
  readonly requiredLevel?: number;
  readonly harvest: {
    readonly itemDefinitionId: ItemDefinitionId;
    readonly baseQuantity: number;
    /** Experience granted on every harvest of this tree. Authoritative. */
    readonly xp: number;
  };
}

/**
 * One planted tree.
 *
 * Only three fields carry time or lifecycle: `plantedAt`, `lastHarvestedAt`, and `version`. Ready
 * state, phase, remaining time, and growth stage are derived from those plus the definition, so a
 * tree can never hold two disagreeing answers, and a definition change re-derives consistently
 * instead of stranding a cached value. `last_harvestedAt` is null until the first harvest, which is
 * the only thing that distinguishes "still growing for the first time" from "regrowing".
 */
export interface TreeInstance {
  readonly id: TreeInstanceId;
  readonly farmId: FarmId;
  readonly tileX: number;
  readonly tileY: number;
  readonly treeDefinitionId: TreeDefinitionId;
  readonly plantedByPlayerId: PlayerId;
  readonly plantedAt: string;
  readonly lastHarvestedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TreePhase = "GROWING" | "READY" | "REGROWING";

/** Everything the read paths need to draw one tree, all of it derived from server time. */
export interface TreeProduction {
  readonly phase: TreePhase;
  readonly ready: boolean;
  /** The instant the current cycle completes, as an ISO string. */
  readonly readyAt: string;
  /** Whole seconds until `readyAt`, never negative. Zero exactly when the tree is ready. */
  readonly secondsUntilReady: number;
  /** The instant the current cycle began: planting time, or the last harvest. */
  readonly cycleStartAt: string;
  readonly cycleSeconds: number;
  readonly elapsedSeconds: number;
  /** 0..1 within the current cycle, clamped. */
  readonly progress: number;
  readonly stage: number;
}

/** The level a player must have reached before this tree can be planted. */
export function requiredLevelForTree(definition: TreeDefinition): number {
  return definition.requiredLevel ?? 1;
}

/** Whether a player at `level` may plant this tree. The rule itself is shared with crops. */
export function isTreeUnlocked(definition: TreeDefinition, level: number): boolean {
  return meetsRequiredLevel(requiredLevelForTree(definition), level);
}

export function createTreeInstance(
  id: TreeInstanceId,
  farmId: FarmId,
  tileX: number,
  tileY: number,
  treeDefinitionId: TreeDefinitionId,
  plantedByPlayerId: PlayerId,
  timestamp: string
): TreeInstance {
  return {
    id,
    farmId,
    tileX,
    tileY,
    treeDefinitionId,
    plantedByPlayerId,
    plantedAt: timestamp,
    lastHarvestedAt: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function parseInstant(value: string, message: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    throw new DomainError("INVALID_TREE", message);
  }
  return instant;
}

/**
 * Where a tree is in its current cycle, from server time alone.
 *
 * The cycle starts at planting time until the tree is harvested once, and at the last harvest
 * afterwards, so an absent `lastHarvestedAt` is the whole difference between first growth and
 * regrowth. A tree that is ready stays ready: time spent away is not accumulated into further
 * cycles, so one ready tree is worth one harvest however long the player was gone.
 *
 * `serverNow === readyAt` counts as ready, and a server clock that reads earlier than the cycle
 * start reports the cycle as unstarted rather than as overdue.
 */
export function calculateTreeProduction(
  definition: TreeDefinition,
  instance: TreeInstance,
  serverTime: string
): TreeProduction {
  if (
    !Number.isSafeInteger(definition.firstReadySeconds) ||
    definition.firstReadySeconds <= 0 ||
    !Number.isSafeInteger(definition.regrowSeconds) ||
    definition.regrowSeconds <= 0 ||
    !Number.isInteger(definition.growthStages) ||
    definition.growthStages < 2
  ) {
    throw new DomainError("INVALID_TREE", "Tree timing data is invalid");
  }

  const serverMs = parseInstant(serverTime, "Server time is invalid");
  const plantedMs = parseInstant(instance.plantedAt, "Tree planting time is invalid");
  const harvestedMs =
    instance.lastHarvestedAt === null
      ? null
      : parseInstant(instance.lastHarvestedAt, "Tree harvest time is invalid");

  const firstReadyMs = definition.firstReadySeconds * 1000;
  const regrowMs = definition.regrowSeconds * 1000;
  if (
    !Number.isSafeInteger(firstReadyMs) ||
    !Number.isSafeInteger(regrowMs) ||
    !Number.isSafeInteger(plantedMs) ||
    (harvestedMs !== null && !Number.isSafeInteger(harvestedMs))
  ) {
    throw new DomainError("INVALID_TREE", "Tree timing data is invalid");
  }

  const cycleStartMs = harvestedMs ?? plantedMs;
  const cycleMs = harvestedMs === null ? firstReadyMs : regrowMs;
  const readyAtMs = cycleStartMs + cycleMs;
  if (!Number.isFinite(readyAtMs)) {
    throw new DomainError("INVALID_TREE", "Tree timing data is invalid");
  }

  const elapsedMs = Math.max(0, serverMs - cycleStartMs);
  const clampedElapsedMs = Math.min(elapsedMs, cycleMs);
  const ready = elapsedMs >= cycleMs;
  // Clamped to the cycle length so the two derived numbers always agree: a clock that reads earlier
  // than the cycle start reports a full cycle remaining rather than a wait longer than the cycle
  // itself, and `elapsedSeconds + secondsUntilReady === cycleSeconds` holds for every input.
  const secondsUntilReady = Math.min(
    cycleMs / 1000,
    Math.max(0, Math.ceil((readyAtMs - serverMs) / 1000))
  );
  const stage = ready
    ? definition.growthStages - 1
    : Number(
        (BigInt(Math.trunc(clampedElapsedMs)) * BigInt(definition.growthStages - 1)) /
          BigInt(cycleMs)
      );

  return {
    phase: ready ? "READY" : harvestedMs === null ? "GROWING" : "REGROWING",
    ready,
    readyAt: new Date(readyAtMs).toISOString(),
    secondsUntilReady,
    cycleStartAt: new Date(cycleStartMs).toISOString(),
    cycleSeconds: cycleMs / 1000,
    elapsedSeconds: elapsedMs / 1000,
    progress: clampedElapsedMs / cycleMs,
    stage
  };
}

export function canHarvestTree(
  instance: TreeInstance,
  definition: TreeDefinition,
  serverTime: string
): boolean {
  return calculateTreeProduction(definition, instance, serverTime).ready;
}
