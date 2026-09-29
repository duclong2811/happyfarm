# 0018 - Game HUD and panel architecture

Status: implemented (client only). Desktop and phone-emulation browser passes done; physical device
still unverified.

## Problem

The HUD had grown by accretion: a permanent inventory column on the left, a permanent market column
on the right, a wide bottom dock that was always there, a top bar carrying gold, level, language,
refresh and the farm's UUID, and every shop row wrapped in its own rounded card. The farm was the
background of a dashboard. It also had nowhere to put a quest, a build mode, animals or friends
except another column.

## Decisions

### World first

The default view is the farm plus a thin top HUD, a small module rail, and a contextual action
surface that appears only when something is selected. Nothing opens itself: a panel is something the
player asks for. The measured result on desktop 1440x900 is a 352x287 market panel over a farm that
keeps the rest of the screen, and no dock at all until a tile is selected.

### One active module, described by a registry

```text
MODULES[]  (id, glyph, localized label, panel/body/launcher/close element ids)
   ↓ launcher click
activePanel: null | inventory | market
   ↓
renderPanels(): the active panel is visible, every other is hidden
```

`apps/web/src/panels.ts` owns that state and `openPanel` / `closePanel` / `togglePanel` are the only
transitions, so "inventory and market both open" is unrepresentable. Quest, Build, Animals, Friends
and Settings each add one registry entry and one panel element; none of them needs a sidebar, a
boolean, or a change to the HUD.

The farm id left the player-facing HUD (it lives in the document title and the brand tooltip), the
language switch and refresh were demoted to small ghost buttons, and the level/gold readouts became
two compact pills instead of cards.

### The asset area is canvas again when nothing is open

Closed panels are `hidden`, so they neither reserve space nor intercept pointer events: the module
rail is the only permanent chrome on that side. The bottom dock is hidden whenever nothing is
selected, which is what removes the "large permanent action rectangle".

### Market rows, not cards

One row per product: name, price, a `− n +` stepper, and the one action the row offers. Buy and Sell
are two views of the same server-provided list - a tab filters on `buyPrice`/`sellPrice`, and the
button is chosen from the same field, so prices and directions still come only from the server. Rows
scroll inside a capped panel, which is what lets the catalogue grow past the current eight entries
without a redesign.

### Inventory as a grid

Each stack is a name and a count in a compact auto-filling grid rather than a card in a list, so a
larger inventory is a longer grid, not a taller sidebar. Grouping by category is deliberately absent:
the item DTO carries no category, and inventing one here would be client-side game data.

### One stylesheet, tokens first

`styles.css` is organised as tokens (palette, four surface levels, radius scale, spacing scale, HUD
metrics, safe areas) and then base -> world -> HUD -> modules -> action surface, with three
breakpoints and no device sniffing. `hud.css`, `action-dock.css` and `responsive.css` were folded
into it, which is why the shipped CSS is ~10 kB while carrying more structure than before.

## Consequences

- **No authority change.** Panel state is UI-only: never stored, never sent, never consulted by a
  game rule. Inventory, market, land and action surfaces render from authoritative state on every
  open, so closing and reopening cannot lose a quantity.
- **Input is unchanged.** A closed panel is `hidden`, so the canvas keeps its pointer events;
  selection, drag, wheel, WASD/arrows, tap, pan, pinch and Go are all untouched.
- **Remaining honesty.** Expansion still lives inside the inventory panel as a compact strip rather
  than a dedicated land module; a Land module is the natural next registry entry. The action surface
  still carries the plant selector for the selected tile.
