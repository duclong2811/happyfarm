import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_CHARACTER_ID, PLAYER_CHARACTERS, isSelectablePlayerCharacter } from "@happy-farm/game-data";
import { CHARACTER_MODELS } from "../../apps/web/src/render/character-model-urls";
import { characterNameKey, characterSlug } from "../../apps/web/src/character-picker";
import { createTranslator } from "../../apps/web/src/i18n";

describe("the character roster", () => {
  it("has a model, a name in both languages, and a portrait file for every selectable character", () => {
    const en = createTranslator("en");
    const vi = createTranslator("vi");
    for (const character of PLAYER_CHARACTERS) {
      expect(CHARACTER_MODELS.has(character.id), character.id).toBe(true);
      const key = characterNameKey(character.id);
      expect(en(key)).not.toBe(key);
      expect(vi(key)).not.toBe(key);
      expect(characterSlug(character.id)).toMatch(/^[a-z0-9_]+$/);
    }
    // And the client ships no model the roster does not offer.
    expect([...CHARACTER_MODELS.keys()].sort()).toEqual(PLAYER_CHARACTERS.map((character) => character.id).sort());
  });

  it("offers the default, both bodies, and nothing outside the list", () => {
    expect(isSelectablePlayerCharacter(DEFAULT_PLAYER_CHARACTER_ID)).toBe(true);
    expect(PLAYER_CHARACTERS.filter((character) => character.group === "FEMALE").length).toBeGreaterThanOrEqual(6);
    expect(PLAYER_CHARACTERS.filter((character) => character.group === "MALE").length).toBeGreaterThanOrEqual(6);
    expect(isSelectablePlayerCharacter("character.kenney_zombie")).toBe(false);
    expect(isSelectablePlayerCharacter("")).toBe(false);
    expect(new Set(PLAYER_CHARACTERS.map((character) => character.id)).size).toBe(PLAYER_CHARACTERS.length);
  });
});
