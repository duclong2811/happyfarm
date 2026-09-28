import type { PlayerProgressionDTO } from "@happy-farm/contracts";

/**
 * A player's standing, formatted for display.
 *
 * This is presentation only. The level, the experience total, the span of the current level, and
 * the level cap all arrive already derived from the server; the page re-implements none of them, so
 * it cannot disagree with the authoritative curve. `fraction` is the one thing computed here, and
 * it is the server's own `xpIntoLevel / xpForNextLevel` turned into a 0..1 width.
 */
export interface ProgressionSummary {
  readonly title: string;
  readonly detail: string;
  readonly fraction: number;
}

export function progressionSummary(progression: PlayerProgressionDTO): ProgressionSummary {
  // At the cap the server reports an empty span, so there is no next level to count towards.
  const atCap = progression.level >= progression.maxLevel || progression.xpForNextLevel <= 0;
  return {
    title: `Level ${String(progression.level)}`,
    detail: atCap
      ? `${String(progression.xp)} XP · highest level`
      : `${String(progression.xpIntoLevel)} / ${String(progression.xpForNextLevel)} XP to level ${String(progression.level + 1)}`,
    fraction: atCap ? 1 : clampFraction(progression.xpIntoLevel / progression.xpForNextLevel)
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
