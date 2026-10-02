import type {
  BuildCatalogEntryDTO,
  CropDefinitionDTO,
  TreeDefinitionDTO
} from "@happy-farm/contracts";
import type { Translate } from "./i18n";

/**
 * Which catalogue content a level-up made newly available.
 *
 * Presentation only. The server decides what may be planted (the level gate in `PlantCrop`) and
 * served the catalogues this reads, so a notice can only ever describe a state the server already
 * enforces. It exists so the page does not hardcode "level 3 unlocks wheat": the requirement travels
 * with each definition, exactly as it does for the planting picker and the market.
 */

/** The kind of content a notice names, so a caller can style or group it. */
export type UnlockKind = "crop" | "tree" | "building";

/**
 * How long the level-up banner stays up.
 *
 * Long enough to read a level and the names under it, and the stylesheet's animation has to run for
 * the same span — a test pins the two together.
 */
export const LEVEL_UP_DURATION_MS = 2400;

export interface UnlockNotice {
  /** Stable across languages and re-renders, for tests and de-duplication. */
  readonly key: string;
  readonly kind: UnlockKind;
  /** The game-data display key to translate, with the fallback the caller resolves it against. */
  readonly labelKey: string;
  readonly fallback: string;
}

export interface UnlockDiscoveryInput {
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  readonly buildCatalog: readonly BuildCatalogEntryDTO[];
  /** The level shown before the action; `null` when no level has been read yet. */
  readonly previousLevel: number | null;
  /** The level the action reported; `null` when no level has been read yet. */
  readonly level: number | null;
}

/**
 * A condition a catalogue entry carries.
 *
 * A shape rather than a bare level, so the future world — a region, a zone, a biome, a profession —
 * is another field on this object and the diff below keeps working. Only the level exists today, and
 * nothing here is authority: the server's planting gate is what actually refuses.
 */
interface UnlockRequirement {
  readonly level: number;
}

function meetsRequirement(requirement: UnlockRequirement, level: number): boolean {
  return (
    Number.isSafeInteger(level) &&
    Number.isSafeInteger(requirement.level) &&
    requirement.level >= 1 &&
    level >= requirement.level
  );
}

interface Candidate {
  readonly requirement: UnlockRequirement;
  readonly notice: UnlockNotice;
}

function candidate(requiredLevel: number, notice: UnlockNotice): Candidate {
  return { requirement: { level: requiredLevel }, notice };
}

/**
 * The notices for content that became eligible between two levels.
 *
 * Deterministic: candidates are ordered by the level they need and then by key, so the same two
 * levels always produce the same list. A change that does not rise unlocks nothing, and an unknown
 * previous level produces nothing rather than announcing the whole catalogue — the safe direction is
 * to say too little, never to claim an unlock the player did not earn.
 */
export function unlockNotices(input: UnlockDiscoveryInput): readonly UnlockNotice[] {
  const { previousLevel, level } = input;
  if (
    previousLevel === null ||
    level === null ||
    !Number.isSafeInteger(previousLevel) ||
    !Number.isSafeInteger(level) ||
    level <= previousLevel
  ) {
    return [];
  }

  const candidates: Candidate[] = [
    ...input.cropDefinitions.map((crop) =>
      candidate(crop.requiredLevel, {
        key: `crop:${crop.cropDefinitionId}`,
        kind: "crop",
        labelKey: crop.displayNameKey,
        fallback: crop.cropDefinitionId
      })
    ),
    ...input.treeDefinitions.map((tree) =>
      candidate(tree.requiredLevel, {
        key: `tree:${tree.treeDefinitionId}`,
        kind: "tree",
        labelKey: tree.displayNameKey,
        fallback: tree.treeDefinitionId
      })
    ),
    ...input.buildCatalog.map((entry) =>
      candidate(entry.requiredLevel, {
        key: `build:${entry.entryId}`,
        kind: "building",
        labelKey: entry.displayNameKey,
        fallback: entry.label
      })
    )
  ];

  candidates.sort((left, right) => {
    if (left.requirement.level !== right.requirement.level) {
      return left.requirement.level - right.requirement.level;
    }
    return left.notice.key < right.notice.key ? -1 : left.notice.key > right.notice.key ? 1 : 0;
  });

  return candidates
    .filter(
      (entry) =>
        meetsRequirement(entry.requirement, level) &&
        !meetsRequirement(entry.requirement, previousLevel)
    )
    .map((entry) => entry.notice);
}

export interface LevelUpFeedback {
  readonly title: string;
  readonly detail: string | null;
}

/**
 * The two lines a level-up shows: the level reached, and what it opened, when it opened anything.
 *
 * The names are resolved by the caller (they are game-data display keys, which need the language),
 * so this stays a pure string composition a test can read without a DOM or a catalogue.
 */
export function levelUpFeedback(
  level: number,
  names: readonly string[],
  t: Translate
): LevelUpFeedback {
  return {
    title: t("levelUp.title", { level }),
    detail:
      names.length === 0
        ? null
        : t("levelUp.unlocked", { items: names.join(t("levelUp.separator")) })
  };
}
