# V12.5: the construction shop, the asset inspector, and placement mode

Status: design of record for the V12.5 construction pass. Read this before changing the Build panel,
the shop's browsing state, or placement mode.

V12.4 gave the catalogue a picture of every item. V12.5 gives the player somewhere to *read* one: a
category rail, an asset grid, and an inspector that answers "what is this, what does it cost, may I
build it, and where does it go" before anything is placed. The flow the whole pass exists for is

```text
browse -> select -> inspect -> PLACE -> position -> (V13: confirm)
```

Clicking a card is inspection. Nothing is purchased, no gold is spent, and no placement is persisted -
the confirm step needs a server command that does not exist yet.

## Three areas

| Area | Width on desktop | What it does |
| --- | --- | --- |
| Category rail | 7.4rem (8rem below 1180px) | one icon + short label per *non-empty* category |
| Asset grid | the rest | 3 columns (2 below 980px), picture-first cards, search above |
| Inspector | 15.5rem (12rem below 1180px) | large preview, name, description, facts, PLACE |

The panel is `min(58rem, 88vw)` wide and at most 76vh tall. Only the grid scrolls: the header, the
rail and the inspector stay where the hand and the eye left them. Below 980px the rail becomes a
horizontal strip on top and the inspector moves under the grid, and the card pictures switch to a
fixed height so two rows of the catalogue still fit on a narrow screen.

## Where the code lives

`main.ts` stays the orchestrator and the shop's own state lives beside it, but the decisions and the
DOM moved out:

* `apps/web/src/build-shop/shop-state.ts` - pure: category order and emptiness, availability
  (`AVAILABLE` / `LOCKED` / `PREVIEW_ONLY`), search and filter, rotation and footprint arithmetic,
  description keys, and the thumbnail request for an entry.
* `apps/web/src/build-shop/shop-view.ts` - DOM: the rail, the search bar, the cards, the inspector.
  It decides nothing; everything it shows is passed in.
* `apps/web/src/build-shop/shop-thumbnails.ts` - the shop's view of the thumbnail pipeline: one
  renderer, created on the first ask, and one cache of the URLs it has produced.

## Selection, and what the player is allowed to do

| State | Card | Inspector | PLACE |
| --- | --- | --- | --- |
| Available | selectable, green border when chosen | price, level, footprint, tier, upgrade | enabled |
| Locked | dimmed picture, lock badge `Lv N`, still selectable | "Unlocks at Level N" | disabled, labelled `Locked — Level N` |
| Preview only (gravel, paved) | `Preview` badge, still selectable | "Preview only" | disabled, labelled `Preview only` |

A locked card stays clickable on purpose: seeing what a level unlocks is the point of a progression
preview, so the card carries `aria-disabled` and the *action* is what gets refused.

## Search and filter

The search box filters the current category by the *localised* name, case-insensitively and with the
whitespace trimmed, entirely on the client. Typing re-renders the grid and the inspector only: no
server call, no scene rebuild, no thumbnail renderer recreation, and the search box keeps focus. The
All / Available / Locked filter is the same kind of view, and "nothing matched" is a sentence rather
than an empty grid.

## Thumbnails, reused rather than repeated

The inspector draws the *same* picture the card does: `shop-thumbnails.ts` keys the cache the way the
renderer does, so the second ask - another card, the same card after a search, the inspector - is a
string from a map. One offscreen renderer serves the whole page, and a session that never opens the
shop never creates one at all (the shop renders itself when the panel is opened, not at startup).

### Framing

Models are measured from their own vertices with the outer five per cent of each axis trimmed
(`trimmedBounds`). A bounding box is honest about vertices and dishonest about pictures: `plant_fern`
was mostly transparent quad, and framing it by its raw box made the fern the size of a thumbnail's
shadow. The trim is deterministic and axis-aligned, so a barn, a pine, a boulder and a fern now read
at roughly the same visual weight, and the runtime model scale is untouched.

## Placement mode

`Places` closes the shop and enters placement mode:

1. the item is held, and the cell under the player's selection - or the cell the camera is already
   looking at - becomes the anchor;
2. the camera glides to that cell and comes closer (`focusOnCell`), because a one-cell tree on a
   150-metre island is otherwise a speck;
3. the renderer draws a translucent ghost *and* a footprint patch with a fill at 0.3 opacity and a
   solid perimeter, green when the cell accepts the item and red when it does not;
4. the placement HUD shows the name, the price, the rotated footprint, the validity line with the
   cell, and the controls.

The dock's plant/harvest controls are hidden while something is in hand (`body.is-placing`); they are
not what the player is doing.

### Rotation

`Q` and `E` turn the item a quarter turn. The footprint swaps its axes at odd quarter turns, so a
`4 x 3` barn becomes `3 x 4` and the footprint patch, the ghost and the HUD all follow. Rotation
rebuilds the preview and nothing else: no world rebuild, no renderer, no model reload, no catalogue
fetch. Keys typed into the search box are never treated as rotation.

### Roads

A road is previewed as a **four-cell segment** built by the runtime centreline and ribbon, centred on
the selected cell so the drawn road and its footprint agree. Its direction starts along the axis the
camera faces and then follows the player's turns. The catalogue sells a road by the four-cell segment,
and the inspector says so (`Cost: 4 cells`); V12.5 invents no price per cell and no length-based
charging. Cancelling - `Esc`, closing the shop, or choosing another item - removes the ghost, the
footprint and the segment, and disposes exactly what the preview allocated.

### The camera is never taken away

Placement is a *request* to the camera, not a mode of it: right-drag still orbits, middle-drag still
pans, the wheel still zooms, and the recenter key still works. Outside placement mode, click-to-move
is unchanged.

## Catalogue authority

Everything the shop says about an item is the catalogue's: `price`, `requiredLevel`, `footprint`,
`capability`, `tier`, `tierRank`, `upgradeTo`, `unlockCondition`. The gold in the header is the wallet
the server already reports - there is no second local balance and no fake subtraction. The only client
data is presentation: the localized name (keyed by `displayNameKey`), the description, and the icons.
Descriptions come from the catalogue's own `descriptionKey` where it has one, and from a
presentation-side map keyed by the stable entry id where it does not - never a rule, a price or a
level restated in prose.

## What V12.5 deliberately does not do

* no purchase, no gold deduction, no persistent placement - the confirm step has no server command yet;
* no road upgrade transaction (the ladder `Dirt -> Gravel -> Stone -> Paved` is shown, not sold);
* no worker, livestock, forestry, aquaculture, mining or expansion gameplay;
* no second WebGL renderer, no per-card canvas, no animation loop, no world rebuild on search, hover
  or scroll.

## The V13 seam

```text
browse -> select -> inspect -> place preview -> validate -> confirm
   done      done       done          done         done      <-- V13 starts here
   -> POST /farms/:id/placement  (server authenticates, authorizes, validates the cells,
      charges through the economy service, persists, broadcasts)
   -> refresh from the authoritative world
```

`shop-state.ts` already classifies what may be placed, `enterPlacement` already knows which entry the
player holds, and the renderer already reports valid or invalid for the cells in question. The command
that follows confirmation has to re-derive all of it server-side; nothing the client decided here is
an authority.
