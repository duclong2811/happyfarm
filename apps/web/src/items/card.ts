import type { IconName } from "../icons";
import type { ItemThumbnails } from "./thumbnails";
import type { ItemFallback, ItemVisual } from "./visuals";

/**
 * One visual item card, shared by the inventory grid and the planting picker.
 *
 * Deliberately small. The three surfaces that show an item - the shop, the inventory and the picker -
 * need the same *picture language* (a framed thumbnail, a name, a quantity badge, a locked or empty
 * state) and different *behaviour*: the shop sells, the inventory shows what you own, the picker
 * chooses. So this module owns the picture and the words, and nothing else: no price, no action, no
 * fetch. The shop keeps its own card because it carries a price and a Place action that mean nothing
 * here.
 *
 * The picture is either a cached render of the real asset or a drawn fallback from the icon set - never
 * a broken image, never a size change, and never a second WebGL context (see `thumbnails.ts`).
 */

export interface ItemCardDeps {
  readonly thumbnails: ItemThumbnails;
  readonly icon: (name: IconName, size?: number) => SVGElement;
}

/**
 * How a card is presented. Four states, because four are meaningful to a player: it is normal, it is
 * the one I have chosen, I have none of it, or it is not unlocked yet. Anything finer belongs to the
 * surface that owns the card, not to the card.
 */
export type ItemCardState = "NORMAL" | "SELECTED" | "EMPTY" | "LOCKED";

export interface ItemCardModel {
  readonly key: string;
  readonly visual: ItemVisual;
  /** Already localized by the caller. */
  readonly name: string;
  /** How many the player holds, or null when a count makes no sense for this surface. */
  readonly quantity: number | null;
  /** A localized count for screen readers, e.g. "35 carrots". */
  readonly quantityLabel: string | null;
  /** A localized second line: a growth time, a level requirement, "no seeds". */
  readonly note: string | null;
  readonly state: ItemCardState;
  readonly disabled: boolean;
  readonly ariaLabel: string;
}

const FALLBACK_ICON: Readonly<Record<ItemFallback, IconName>> = {
  PRODUCE: "harvest",
  SEED: "seed",
  SEED_CARROT: "seed",
  SEED_CORN: "seed",
  SAPLING: "sprout",
  ITEM: "inventory"
};

export interface ItemCardOptions {
  /** Present when the card is actionable (the picker). Absent for a card that is only read. */
  readonly onSelect?: () => void;
}

/**
 * Builds one card. A card with an action is a real `<button>` (keyboard operable, `aria-pressed` for
 * the chosen one); a card without one is inert content, because a button that does nothing is worse
 * than a picture.
 */
export function renderItemCard(
  model: ItemCardModel,
  deps: ItemCardDeps,
  options: ItemCardOptions = {}
): HTMLElement {
  const card = options.onSelect === undefined
    ? document.createElement("div")
    : document.createElement("button");
  card.className = "item-card";
  card.classList.toggle("is-selected", model.state === "SELECTED");
  card.classList.toggle("is-empty", model.state === "EMPTY");
  card.classList.toggle("is-locked", model.state === "LOCKED");
  card.dataset.itemKey = model.key;
  if (card instanceof HTMLButtonElement) {
    card.type = "button";
    card.setAttribute("aria-pressed", String(model.state === "SELECTED"));
    card.disabled = model.disabled;
    card.addEventListener("click", () => options.onSelect?.());
  } else {
    card.setAttribute("role", "listitem");
  }
  card.setAttribute("aria-label", model.ariaLabel);
  card.title = model.ariaLabel;

  const thumb = document.createElement("div");
  thumb.className = "item-card-thumb is-loading";
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  const fallback = document.createElement("span");
  fallback.className = "item-card-fallback";
  fallback.dataset.fallback = model.visual.fallback;
  fallback.hidden = true;
  fallback.appendChild(deps.icon(FALLBACK_ICON[model.visual.fallback], 26));
  image.addEventListener("error", () => {
    image.hidden = true;
    fallback.hidden = false;
    thumb.classList.remove("is-loading");
  });
  // `appendChild`, not `append`: this repository typechecks against both the DOM and the Workers
  // libraries, whose `append` signatures disagree.
  thumb.appendChild(image);
  thumb.appendChild(fallback);

  const known = deps.thumbnails.cached(model.visual.request);
  if (known !== null) {
    image.src = known;
    thumb.classList.remove("is-loading");
  } else {
    deps.thumbnails.apply(model.visual.request, image, (result) => {
      thumb.classList.remove("is-loading");
      if (result.dataUrl === null) {
        // No picture exists for this item: keep the card's own art rather than a broken image.
        image.hidden = true;
        fallback.hidden = false;
      }
    });
  }
  const meta = document.createElement("div");
  meta.className = "item-card-meta";
  const name = document.createElement("span");
  name.className = "item-card-name";
  name.textContent = model.name;
  meta.appendChild(name);
  if (model.note !== null) {
    const note = document.createElement("span");
    note.className = "item-card-note";
    note.textContent = model.note;
    meta.appendChild(note);
  }
  // The badges belong to the *picture*, not to the card: the picture is a fixed square, so a count or
  // a lock never moves when a name wraps to a second line.
  if (model.quantity !== null) {
    const quantity = document.createElement("span");
    quantity.className = "item-card-qty";
    // The count is the loudest thing on the card and needs no panel; the accessible name already
    // carries the localized form, so the badge itself is shorthand.
    quantity.textContent = `\u00d7${String(model.quantity)}`;
    quantity.setAttribute("aria-hidden", "true");
    thumb.appendChild(quantity);
    if (model.quantityLabel !== null) {
      // The badge is shorthand; the count is also said in words for anyone not reading it as a picture.
      const words = document.createElement("span");
      words.className = "visually-hidden";
      words.textContent = model.quantityLabel;
      thumb.appendChild(words);
    }
  }

  if (model.state === "SELECTED") {
    const check = document.createElement("span");
    check.className = "item-card-check";
    check.setAttribute("aria-hidden", "true");
    check.appendChild(deps.icon("check", 14));
    thumb.appendChild(check);
  }
  if (model.state === "LOCKED") {
    const lock = document.createElement("span");
    lock.className = "item-card-lock";
    lock.setAttribute("aria-hidden", "true");
    lock.appendChild(deps.icon("lock", 13));
    thumb.appendChild(lock);
  }

  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}
