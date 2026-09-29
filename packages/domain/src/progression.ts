import { DomainError } from "./errors";
import type { PlayerId } from "./ids";

export const MAX_TOTAL_XP = Number.MAX_SAFE_INTEGER;
export const MAX_XP_AWARD = 1_000_000;

/** The curve shape. Values live in `packages/game-data`; the arithmetic lives here. */
export interface ProgressionDefinition {
  readonly maxLevel: number;
  readonly xpStep: number;
}

/** The authoritative progression row. Level is derived from `xp` and stored with it. */
export interface PlayerProgression {
  readonly playerId: PlayerId;
  readonly level: number;
  readonly xp: number;
  readonly progressionVersion: number;
  readonly updatedAt: string;
}

export interface LevelProgress {
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  readonly isMaxLevel: boolean;
}

/** Everything the settlement needs to write one experience award and detect a lost race. */
export interface XpAward {
  readonly playerId: PlayerId;
  readonly xpBefore: number;
  readonly expectedProgressionVersion: number;
  readonly xpAfter: number;
  readonly levelAfter: number;
  readonly xpAwarded: number;
  readonly leveledUp: boolean;
  readonly timestamp: string;
}

function assertDefinition(definition: ProgressionDefinition): void {
  if (
    !Number.isInteger(definition.maxLevel) ||
    definition.maxLevel < 2 ||
    !Number.isInteger(definition.xpStep) ||
    definition.xpStep < 1
  ) {
    throw new DomainError("INVALID_PROGRESSION", "Progression definition is invalid");
  }
}

function assertXp(xp: number): void {
  if (!Number.isSafeInteger(xp) || xp < 0) {
    throw new DomainError("INVALID_PROGRESSION", "Experience total is invalid");
  }
}

/**
 * Whether a player's level satisfies a requirement, which is the one rule that reads one.
 *
 * A level that is not a safe integer (negative, fractional, NaN, infinite) compares as
 * insufficient, so a malformed reading locks everything rather than unlocking everything. The same
 * applies to the requirement: a requirement below the level every player starts at is not a level
 * either, and compared exactly as written it would unlock the content for everybody. Both are
 * refused instead, and game data rejects such a value at load, so this is the last line of defence.
 *
 * Crops and trees share this rule rather than each restating it, which is what keeps "what a level
 * unlocks" from drifting into two interpretations.
 */
export function meetsRequiredLevel(required: number, level: number): boolean {
  return Number.isSafeInteger(level) && required >= 1 && level >= required;
}

/** Total experience a player has earned on reaching `level`. Level 1 is zero. */
export function cumulativeXpForLevel(definition: ProgressionDefinition, level: number): number {
  assertDefinition(definition);
  if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
    throw new DomainError("INVALID_PROGRESSION", "Level is outside the progression range");
  }
  return (definition.xpStep * (level - 1) * level) / 2;
}

/**
 * The highest level whose threshold has been reached, capped at the definition's maximum.
 *
 * A binary search rather than a closed form: the comparison stays exact in integers, and the loop
 * count is bounded by the level cap rather than by the experience total.
 */
export function levelForXp(definition: ProgressionDefinition, xp: number): number {
  assertDefinition(definition);
  assertXp(xp);
  let low = 1;
  let high = definition.maxLevel;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (cumulativeXpForLevel(definition, middle) <= xp) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function levelProgress(definition: ProgressionDefinition, xp: number): LevelProgress {
  const level = levelForXp(definition, xp);
  const floorXp = cumulativeXpForLevel(definition, level);
  const isMaxLevel = level >= definition.maxLevel;
  const ceilingXp = isMaxLevel ? floorXp : cumulativeXpForLevel(definition, level + 1);
  return {
    level,
    xpIntoLevel: xp - floorXp,
    xpForNextLevel: ceilingXp - floorXp,
    isMaxLevel
  };
}

/**
 * Rejects a progression row that could not have been produced by this curve.
 *
 * The stored level is a cache of `levelForXp(xp)`, so a row where the two disagree is corrupt rather
 * than merely old, and awarding experience against it would write the corruption forward.
 */
export function assertProgression(
  definition: ProgressionDefinition,
  progression: PlayerProgression
): void {
  assertDefinition(definition);
  assertXp(progression.xp);
  if (!Number.isSafeInteger(progression.progressionVersion) || progression.progressionVersion < 1) {
    throw new DomainError("INVALID_PROGRESSION", "Progression version is invalid");
  }
  if (progression.level !== levelForXp(definition, progression.xp)) {
    throw new DomainError("INVALID_PROGRESSION", "Stored level does not match stored experience");
  }
}

/**
 * Builds the award the settlement writes: absolute after-values plus the pre-state they replace.
 *
 * Absolute values with an expected version, rather than a relative increment, so a concurrent award
 * either applies against the state it was computed from or is rejected and retried.
 */
export function createXpAward(
  definition: ProgressionDefinition,
  progression: PlayerProgression,
  xpAwarded: number,
  timestamp: string
): XpAward {
  assertProgression(definition, progression);
  if (!Number.isSafeInteger(xpAwarded) || xpAwarded <= 0 || xpAwarded > MAX_XP_AWARD) {
    throw new DomainError("INVALID_PROGRESSION", "Experience award is invalid");
  }
  const xpAfter = progression.xp + xpAwarded;
  if (!Number.isSafeInteger(xpAfter) || xpAfter > MAX_TOTAL_XP) {
    throw new DomainError("PROGRESSION_LIMIT_EXCEEDED", "Total experience would exceed the maximum");
  }
  const levelAfter = levelForXp(definition, xpAfter);
  return {
    playerId: progression.playerId,
    xpBefore: progression.xp,
    expectedProgressionVersion: progression.progressionVersion,
    xpAfter,
    levelAfter,
    xpAwarded,
    leveledUp: levelAfter > progression.level,
    timestamp
  };
}
