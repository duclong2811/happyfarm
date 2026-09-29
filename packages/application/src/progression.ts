import {
  levelForXp,
  levelProgress,
  type PlayerProgression,
  type ProgressionDefinition
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock, ProgressionRepository } from "./ports";

/**
 * A player's standing, in the shape the API sends.
 *
 * Every field except `xp` and `maxLevel` is derived, so the client never reimplements the curve and
 * never has to guess how far the next level is. The curve itself stays in `packages/domain`; this
 * file only carries it outwards.
 */
export interface ProgressionView {
  readonly level: number;
  readonly xp: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  readonly maxLevel: number;
}

export interface XpAwardView {
  readonly xpAwarded: number;
  readonly leveledUp: boolean;
  readonly progression: ProgressionView;
}

/**
 * Refuses a stored experience award that is not one this contract could have produced.
 *
 * Replay hands back what the settlement stored, so a corrupt or hand-edited row must not be echoed
 * in a shape the client's validator rejects — that would turn a damaged receipt into a broken
 * screen instead of an honest internal error. The floors are the ones `PlayerProgressionDTOSchema`
 * puts on the same fields: a level starts at 1, and a cap below 2 cannot hold a level.
 *
 * Deliberately absent is any re-derivation of the level from `xp`: an award written under an older
 * curve has to stay replayable after a retune, which is exactly what the replay exists for. Both the
 * crop harvest and the tree harvest read their receipts through this one function.
 */
export function assertStoredXpAward(value: unknown): void {
  if (typeof value !== "object" || value === null) throw new Error("invalid stored award");
  const award = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(award.xpAwarded) ||
    (award.xpAwarded as number) <= 0 ||
    typeof award.leveledUp !== "boolean"
  ) {
    throw new Error("invalid stored award");
  }
  const progression = award.progression;
  if (typeof progression !== "object" || progression === null) throw new Error("invalid stored award");
  const fields = ["level", "xp", "xpIntoLevel", "xpForNextLevel", "maxLevel"] as const;
  for (const field of fields) {
    const entry = (progression as Record<string, unknown>)[field];
    if (!Number.isSafeInteger(entry) || (entry as number) < 0) throw new Error("invalid stored award");
  }
  const view = progression as Record<string, unknown>;
  const level = view.level as number;
  const maxLevel = view.maxLevel as number;
  if (level < 1 || maxLevel < 2 || level > maxLevel) throw new Error("invalid stored award");
}

/**
 * The version a player who has never earned experience is modelled at.
 *
 * Rows are created by the first award rather than with the player, so "no row" is a normal state
 * and not an error. Treating it as version 1 is what lets the settlement seed the row and apply the
 * award in one guarded statement pair.
 */
export const DEFAULT_PROGRESSION_VERSION = 1;

export function emptyProgression(playerId: PlayerProgression["playerId"], timestamp: string): PlayerProgression {
  return { playerId, level: 1, xp: 0, progressionVersion: DEFAULT_PROGRESSION_VERSION, updatedAt: timestamp };
}

export function progressionView(definition: ProgressionDefinition, xp: number): ProgressionView {
  const progress = levelProgress(definition, xp);
  return {
    level: progress.level,
    xp,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNextLevel: progress.xpForNextLevel,
    maxLevel: definition.maxLevel
  };
}

/**
 * The level a stored progression row represents, treating "no row yet" as level 1.
 *
 * The level is derived from the stored experience rather than read from the row's cached `level`
 * column, so a row whose cache disagrees with its experience cannot unlock anything. A row the curve
 * could not have produced is refused instead of compared, because a damaged read must never be the
 * thing that grants access.
 */
export function storedLevel(definition: ProgressionDefinition, stored: PlayerProgression | null): number {
  if (stored === null) return 1;
  try {
    return levelForXp(definition, stored.xp);
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
  }
}

/** Reads a player's progression. A player who has never earned experience reads as level 1. */
export class GetProgression {
  constructor(
    private readonly definition: ProgressionDefinition,
    private readonly progression: ProgressionRepository,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<ProgressionView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const stored =
      (await this.progression.find(actor.playerId)) ?? emptyProgression(actor.playerId, this.clock.now());
    return progressionView(this.definition, stored.xp);
  }
}
