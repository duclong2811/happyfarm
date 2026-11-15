/**
 * The characters a player may appear as.
 *
 * Definitions only: which ids exist and how the picker groups them. A player's choice is persistent
 * player state on the server (`player_appearance`), validated against this list; the browser maps an
 * id to a model file and never sends anything but the id.
 *
 * Every character is from Kenney's Mini Characters (CC0 1.0) and shares one rig and one clip set, so
 * a choice changes how a player looks and nothing about how they move or work.
 */

export const PLAYER_CHARACTER_GROUPS = ["FEMALE", "MALE", "SPECIAL"] as const;
export type PlayerCharacterGroup = (typeof PLAYER_CHARACTER_GROUPS)[number];

export interface PlayerCharacterDefinition {
  /** Stable id, e.g. `character.kenney_female_a`. Also the id the client's model table resolves. */
  readonly id: string;
  readonly group: PlayerCharacterGroup;
}

/** The character every player has until they choose another: the original farmer. */
export const DEFAULT_PLAYER_CHARACTER_ID = "character.player_farmer";

export const PLAYER_CHARACTERS: readonly PlayerCharacterDefinition[] = [
  { id: "character.kenney_female_a", group: "FEMALE" },
  { id: "character.kenney_female_b", group: "FEMALE" },
  { id: "character.kenney_female_c", group: "FEMALE" },
  { id: "character.kenney_female_d", group: "FEMALE" },
  { id: "character.kenney_female_e", group: "FEMALE" },
  { id: "character.kenney_female_f", group: "FEMALE" },
  { id: DEFAULT_PLAYER_CHARACTER_ID, group: "MALE" },
  { id: "character.kenney_male_b", group: "MALE" },
  { id: "character.kenney_male_c", group: "MALE" },
  { id: "character.kenney_male_d", group: "MALE" },
  { id: "character.kenney_male_e", group: "MALE" },
  { id: "character.kenney_male_f", group: "MALE" },
  { id: "character.kenney_male_g", group: "MALE" },
  { id: "character.kenney_worker", group: "SPECIAL" },
  { id: "character.kenney_knight", group: "SPECIAL" },
  { id: "character.kenney_robot", group: "SPECIAL" },
  { id: "character.kenney_alien", group: "SPECIAL" }
];

const SELECTABLE = new Set(PLAYER_CHARACTERS.map((character) => character.id));

/** Whether a player may choose this character. The one rule the server applies to a choice. */
export function isSelectablePlayerCharacter(id: string): boolean {
  return SELECTABLE.has(id);
}
