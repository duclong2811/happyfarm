# Item presentation: shop, inventory and the planting picker

Status: how V14.2 turned the farming loop from forms into objects. Read this before adding an item
surface, a new card style, or another place that draws an item picture.

> **The world is the interface. A panel is a tool, and a card is a picture of a thing the player
> already understands.**

## The problem this answers

The first real-device screenshots showed two surfaces that read as a web application: an inventory
that was a list of `Carrot x35` lines, and a planting control that was a native `<select>`. Both were
correct, and both were forms. The fix is not decoration - it is choosing the representation a player
already uses for "a thing": a picture, a name, and how many you have.

## Three surfaces, three jobs

| Surface | Answers | Presentation | Never |
| --- | --- | --- | --- |
| **Shop** (Build) | what can I make here, and what does it cost | card grid and inspector, in the existing panel | sells from a card click without the inspector's own Place |
| **Inventory** | what do I own | category tabs over a grid of visual cards | offers a fake "Use" action |
| **Plant picker** | what do I plant on this cell | a row of crop cards in the dock | becomes a dropdown, or a full-screen chooser |

The shop keeps its own card because it carries a price and an upgrade ladder that mean nothing on a
shelf. The inventory and the picker share `apps/web/src/items/card.ts` because they need exactly the
same thing: a framed picture, a name, one short line, and a quantity badge.

## The card

Each card is a framed square thumbnail with the quantity badge over the picture (so a wrapped name
cannot move it), the localized name under it, and one metadata line: what the item is worth, or why it
cannot be used yet.

Four states, and no more: `NORMAL`, `SELECTED` (a border **and** a tick - never colour alone), `EMPTY`
(none held), `LOCKED` (a level the player has not reached). A card with an action is a real `<button>`
with `aria-pressed`; a card without one is inert content, because a button that does nothing is worse
than a picture.

## Thumbnails: one pipeline, four readers

`apps/web/src/items/thumbnails.ts` owns the only picture cache in the page, and the shop, the
inventory, the planting picker and the harvest reward pop all ask it. It is built on the shop's own
V12.4 renderer: **one** offscreen `WebGLRenderer`, drawn on demand, cached as data URLs keyed by the
model (or road tier) and nothing else.

* A carrot is drawn **once per session**, however many cards show one.
* A card whose picture is not drawn yet keeps a fixed-size box with a quiet shimmer: no layout jump, no
  blocked panel, and no placeholder flashing over a picture that was about to arrive.
* `tests/web/item-presentation.test.ts` pins that `createThumbnailRenderer` has exactly two call sites
  in the application: its own module, and this cache.

### What each item shows today

| Item | Picture | Why |
| --- | --- | --- |
| `item_carrot`, `item_corn`, `item_wheat` (produce) | the crop's own `.glb` | the crop *is* the model |
| every seed | fallback `SEED` | no seed model ships |
| `item_apple_sapling` | fallback `SAPLING` | a tree's model is the mature tree |
| anything this build does not know | fallback `ITEM` | the server may define items this build has not seen |

Fallbacks are drawn from the project's own icon set at a fixed size, so they cannot break a layout,
cannot show a broken-image glyph, and are the same shape in every surface.

## The inventory

* **Categories come from the data**: `All`, `Produce`, `Seeds`, `Saplings`, and a tab is only offered
  when something is in it. A sapling is a `SEED` on the wire and a sapling to a player, so the
  catalogues decide the shelf, not the category string.
* **Zero-quantity rows are hidden.** The server keeps a row for everything a player has ever been
  given; an inventory that lists a dozen things they do not have is a form again.
* **Quantity is the loudest thing on the card** and needs no second panel; the same count is also said
  in words for assistive technology.
* **Land is not an item.** `Unlock next plot` stays in its own strip below the grid, where it always
  was - it is ownership, not inventory.
* **Nothing is clickable that has no action.** Produce is not "used", and seeds are not planted from a
  card: planting is cell-based and belongs to the dock on a selected cell.

## The planting picker

Replaces the native `<select>` on every viewport.

**Order** (`plantOptions`): available first (unlocked, seeds in hand), then unlocked with an empty
pouch, then level-locked - catalogue order inside each group, so the list never reshuffles between
refreshes. A player with forty carrot seeds never scrolls past wheat to find carrot.

**State** is on the card, and the *blocker* is the reason the player would act on:

| State | Card | Note |
| --- | --- | --- |
| available | normal, selectable | "Ready in 5m" |
| no seeds | dimmed, **not** selectable | "No seeds" |
| level-locked | dimmed with a lock, not selectable | "Requires level 3" - never "0 seeds" |

**The choice is remembered.** `rememberedPlantChoice` keeps the player's crop while they can still
plant it, and falls back to the first choice they can use when the seeds run out, so planting a field
is select-cell then plant, repeatedly. A locked crop is never remembered, and a crop whose seeds have
just run out is replaced rather than left selected and disabled.

**The action says what it will do**: `Plant Carrot`, not `Plant crop`.

## Harvest feedback (character view)

The interaction itself is described in `docs/design/INTERACTION_SYSTEM.md`; the presentation half is:

* the character bows for 320 ms (procedural: this asset has no harvest clip), started the moment the
  interaction is accepted locally - the request never waits for it and movement is never locked;
* the number the server paid rises from the crop that paid it (`+2 Carrot`), with the item's cached
  thumbnail, one reused element, CSS-animated;
* readiness is the world's own mark: a ring and a small spark over every ripe crop, and now over every
  ready production tree too. No floating icons, no per-tile HUD.

## Rules this page keeps

* **One picture pipeline** - never a Three.js scene per card, never a second cache.
* **No client item truth** - every quantity, price and capability comes from rows the server sent; the
  presentation modules are pure and touch no network, no clock and no renderer.
* **No invented actions** - a surface only offers what the domain actually supports.
* **Nothing becomes a form again** - no native selects, no tables of text where a picture is the
  answer, no oversized cards, no decorative chrome.
