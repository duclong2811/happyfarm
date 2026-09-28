import {
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