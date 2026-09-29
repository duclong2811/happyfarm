import type { PlayerProgressionDTO } from "@happy-farm/contracts";
import type { Translate } from "./i18n";

/**
 * A player's standing, formatted for display.
 *
 * This is presentation only. The level, the experience total, the span of the current level, and
 * the level cap all arrive already derived from the server; the page re-implements none of them, so
 * it cannot disagree with the authoritative curve. `fraction` is the one thing computed here, and
 * it is the server's own `xpIntoLevel / xpForNextLevel` turned into a 0..1 width.
 *
 * The two strings go through the translation layer like every other player-visible string, so the
 * level readout changes language with the rest of the HUD without touching the numbers.
 */
export interface ProgressionSummary {
  readonly title: string;
  readonly detail: string;
  readonly fraction: number;
}

export function progressionSummary(
  progression: PlayerProgressionDTO,
  t: Translate
): ProgressionSummary {
  // At the cap the server reports an empty span, so there is no next level to count towards.
  const atCap = progression.level >= progression.maxLevel || progression.xpForNextLevel <= 0;
  return {
    title: t("progression.level", { level: progression.level }),
    detail: atCap
      ? t("progression.cap", { xp: progression.xp })
      : t("progression.toNext", {
          into: progression.xpIntoLevel,
          span: progression.xpForNextLevel,
          next: progression.level + 1
        }),
    fraction: atCap ? 1 : clampFraction(progression.xpIntoLevel / progression.xpForNextLevel)
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
