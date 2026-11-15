/**
 * The character picker: which of the roster the player appears as.
 *
 * Presentation only. The roster is game data (`PLAYER_CHARACTERS`), the portraits are pre-rendered
 * from the shipped models, and what the player confirms is one id the server validates and stores.
 */

import { DEFAULT_PLAYER_CHARACTER_ID, PLAYER_CHARACTER_GROUPS, PLAYER_CHARACTERS, type PlayerCharacterGroup } from "@happy-farm/game-data";
import { CHARACTER_PORTRAITS } from "./character-portraits";
import type { MessageKey } from "./i18n";


/** The id without its namespace: `character.kenney_female_a` -> `kenney_female_a`. */
export function characterSlug(id: string): string {
  return id.startsWith("character.") ? id.slice("character.".length) : id;
}

/** The pre-rendered portrait of a character, or undefined for an id the client has no art for. */
export function characterPortraitUrl(id: string): string | undefined {
  return CHARACTER_PORTRAITS.get(id);
}

/** The message key of a character's display name. Every roster id has one in both languages. */
export function characterNameKey(id: string): MessageKey {
  return `character.name.${characterSlug(id)}` as MessageKey;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Shows the picker and resolves with the confirmed id, or null when the player closes it.
 *
 * `onConfirm` saves the choice; while it runs the picker is disabled, and a failure re-enables it with
 * the reason, so a dropped request is a retry rather than a lost choice.
 */
export function showCharacterPicker(options: {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly current: string;
  /** Whether the player may leave without choosing (from the menu), or is being asked once (onboarding). */
  readonly closeLabel: MessageKey;
  readonly onConfirm: (characterId: string) => Promise<void>;
  readonly describeError: (error: unknown) => string;
}): Promise<string | null> {
  const { translate } = options;
  let selected = PLAYER_CHARACTERS.some((character) => character.id === options.current) ? options.current : DEFAULT_PLAYER_CHARACTER_ID;

  const root = document.createElement("div");
  root.id = "character-picker";
  root.className = "character-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "character-picker-title");

  const card = document.createElement("div");
  card.className = "cp-card";
  const title = document.createElement("h2");
  title.id = "character-picker-title";
  title.textContent = translate("characterPicker.title");

  const preview = document.createElement("div");
  preview.className = "cp-preview";
  const previewImage = document.createElement("img");
  previewImage.alt = "";
  previewImage.width = 224;
  previewImage.height = 224;
  const previewName = document.createElement("strong");
  preview.replaceChildren(previewImage, previewName);

  const groups = document.createElement("div");
  groups.className = "cp-groups";
  const buttons: HTMLButtonElement[] = [];
  const sections = PLAYER_CHARACTER_GROUPS.map((group: PlayerCharacterGroup) => {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = translate(`characterPicker.group.${group}` as MessageKey);
    const grid = document.createElement("div");
    grid.className = "cp-grid";
    const entries = PLAYER_CHARACTERS.filter((character) => character.group === group).map((character) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cp-option";
      button.dataset.character = character.id;
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = characterPortraitUrl(character.id) ?? "";
      const name = document.createElement("span");
      name.textContent = translate(characterNameKey(character.id));
      button.replaceChildren(image, name);
      button.setAttribute("aria-label", name.textContent);
      button.addEventListener("click", () => {
        selected = character.id;
        render();
      });
      buttons.push(button);
      return button;
    });
    grid.replaceChildren(...entries);
    section.replaceChildren(heading, grid);
    return section;
  });
  groups.replaceChildren(...sections);

  const error = document.createElement("p");
  error.className = "cp-error";
  error.hidden = true;
  const actions = document.createElement("div");
  actions.className = "cp-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cp-close";
  close.textContent = translate(options.closeLabel);
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary cp-confirm";
  confirm.textContent = translate("characterPicker.confirm");
  actions.replaceChildren(close, confirm);

  const body = document.createElement("div");
  body.className = "cp-body";
  body.replaceChildren(preview, groups);
  card.replaceChildren(title, body, error, actions);
  root.replaceChildren(card);

  function render(): void {
    previewImage.src = characterPortraitUrl(selected) ?? "";
    previewName.textContent = translate(characterNameKey(selected));
    for (const button of buttons) {
      const active = button.dataset.character === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  options.host.appendChild(root);
  render();

  return new Promise<string | null>((resolve) => {
    close.addEventListener("click", () => {
      root.remove();
      resolve(null);
    });
    confirm.addEventListener("click", () => {
      const choice = selected;
      for (const control of root.querySelectorAll("button")) control.disabled = true;
      root.classList.add("is-busy");
      error.hidden = true;
      options.onConfirm(choice).then(
        () => {
          root.remove();
          resolve(choice);
        },
        (reason: unknown) => {
          for (const control of root.querySelectorAll("button")) control.disabled = false;
          root.classList.remove("is-busy");
          error.textContent = options.describeError(reason);
          error.hidden = false;
        }
      );
    });
  });
}
