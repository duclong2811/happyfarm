# V12.4: the visual build shop, asset thumbnails, and natural dirt roads

Status: design of record for the V12.4 visual pass. Read this before changing the build panel, the
thumbnail renderer, the placement preview, or the road's surface.

V12.4 changes no game rule. Prices, levels, footprints, tiers, and unlock conditions still come from
the server's catalogue; nothing here buys, sells, places, or persists anything. What changes is what
the two most visible systems *look like*: the dirt road that the harbour's traffic wears into the
field, and the panel a player opens when they want to build.

Both halves exist for the same reason. V12.3 established that the island is *buildable* - the
catalogue, the WorldCell grid, and the clearance rules were all in place - but the road still read as
a brown strip laid over the grass, and the Build panel read as an internal catalogue dump. A player
could not tell what a barn looked like from the panel that sold one.

## The road: from strip to trodden ground

### What was kept

The V12.3 geometry is untouched, because it is the part that was right: one authoritative centreline
per road, a Catmull-Rom spline resampled by *arc length* at a fixed step, one mitred normal per
sample, and square caps. The width a road reports (`RoadSpec.widthWorld`) is still the navigation
width, and the scenery clearance rule still measures from the rendered edge. Nothing in this pass may
change the shape a player can walk on.

### The cross-section

`ribbonSurface` now carries **nine** columns across the road instead of five, at unequal spacings, so
each band of a farm track can hold its own tone:

```text
grass | disturbed grass | dusty edge | compacted dirt | wheel rut | centre crown | wheel rut |
        compacted dirt | dusty edge | disturbed grass | grass
```

The ruts are deliberately shallow: three per cent of value either side of the compacted dirt, with
the crown a shade lighter. A rut painted as a dark stripe is the single thing that turns a dirt road
back into a graphic, so `dirtProfile` is bounded and has no high-frequency term in it.

The shoulder is a second ribbon of the same centreline, wider than the road by
`ROAD_SHOULDER_WORLD`, with its own tone profile (`shoulderProfile`): darkest where trodden ground
meets unbroken grass and lighter as it approaches the road. The material colour moved from a brown
fringe to a dull olive (`roadShoulder`), because the thing between a road and a field is worn *grass*,
not a dark outline.

### The edge

The drawn edge is allowed to wander; the *shape* is not. `roadEdgeWave(distance, side)` returns a
deterministic multiplier of at most 5% of the half-width, from two low-frequency sines, applied only
to the outermost column of the ribbon. It is a function of distance along the road and the side, so
it is identical on every client and after every refresh, and there is no per-frame work and no
`Math.random` anywhere in it. At the estate camera the road is unchanged to the eye; at walking
distance the border stops being a machined line.

### Contact with the terrain

`ROAD_LIFT_WORLD` is **0.03** world units, down from V12.2's 0.16. V12.2 raised it to stop the drawn
ground poking through the road near the shore, and paid for it with a kerb that was visible from the
estate camera. V12.4 takes the same problem to the material instead: every road surface is drawn with
`polygonOffset` (`-2 / -4`), so the road wins the depth test against ground that interpolates a few
centimetres above the analytic curve it follows. The lift is now the *smallest* separation that keeps
the surface free of z-fighting, and `tests/web/road-visual-quality.test.ts` pins it at or below five
centimetres so it cannot quietly climb again.

### Junctions

The bed heights were re-ordered by importance rather than by accident: dirt road (0.008) above stone
bed (0.006) above path bed (0.002), with junction discs at 0.016 and cobble plates at 0.012. The V12.3
pale wedge at the village gate was the footpath ribbon winning the overlap against the dirt road
because it happened to be lifted higher; ordering the beds fixes the cause instead of hiding the
seam under a larger disc.

### Road tiers

| Tier | Runtime surface | Shop identity |
| --- | --- | --- |
| Dirt T1 | yes (`roadDirt`, the island's own road) | brown worn earth, 100 gold / 4 cells |
| Gravel T2 | **no** - preview only | grey/brown aggregate, 250 gold / 4 cells, `Preview` badge |
| Stone T3 | yes (`roadStone` + cobble plates) | stone plates on a grey bed, 500 gold / 4 cells |
| Paved T4 | **no** - preview only | clean pale slab, 900 gold / 4 cells, `Preview` badge |

The two tiers with no runtime surface say so on the card. The flag lives in
`ROAD_PREVIEW_STYLES` in `apps/web/src/render/thumbnail-spec.ts`, which is the same table the
thumbnail renderer and the placement ghost draw from, so the badge cannot drift away from the picture.

## The shop: from catalogue rows to a construction menu

The Build panel is now a card grid: a compact category row, a scrolling grid of cards, and one status
line at the bottom. It is `min(48rem, 68vw)` wide and at most 76% of the viewport tall, so it covers
the world enough to read and not enough to lose it.

* **Categories** come from the authoritative catalogue. A category with no entry has no tab -
  `MONUMENT` currently has no asset, so it is absent rather than empty. Each tab carries an icon, a
  translated label, and hover/focus/selected states.
* **Cards** are ~9.5rem wide, filled by a square picture (about two thirds of the card), then the
  localised name, the price with a coin glyph and locale-aware digits, the level, and the tier when
  the entry has one. Internal ids never appear.
* **Locked cards** stay visible: the picture is dimmed and desaturated, a lock badge shows
  `Lv N`, and clicking does nothing. Locked items are progression previews, not errors.
* **States**: the grid shows neutral silhouettes while thumbnails are being drawn, a friendly empty
  message for an empty category, and a silhouette - never a broken image - when one model fails.

### Where the data comes from

`GET /build-catalog` remains the only source. `price`, `requiredLevel`, `footprint`, `capability`,
`tier`, `tierRank`, and `unlockCondition` are read from the DTO and never restated in the client. The
one addition to the contract is `tierRank`, so a card can say "Tier 2" without printing the id it is
keyed by.

## Thumbnails

### Architecture

`createThumbnailRenderer()` owns **one** offscreen `WebGLRenderer` (256x256, `preserveDrawingBuffer`)
for the whole page, created the first time a card asks for a picture and never per card. It draws on
demand and returns a data URL. A 55-card catalogue is therefore one canvas, one render per unseen
asset, and no animation loop; the alternative - a live scene per card - is fifty-five WebGL contexts
and fifty-five requestAnimationFrame loops, which is exactly the CPU failure this project already paid
for once.

The pure decisions live in `thumbnail-spec.ts` so they can be tested without a GL context: the cache
key (`model:<id>` / `road:<tier>`), the framing arithmetic, and the four road tier previews.

**Art direction is fixed**: warm cream background, one round ground disc for contact, a soft key plus
a hemisphere light, a three-quarter bearing, the object filling about 72% of the frame. Models are
cloned before they are posed, and the clone's geometry is never disposed - it belongs to the shared
`ModelLibrary` cache that the world, the ghost, and the thumbnails all read from
(`loadModel(modelId)`), so a barn is downloaded once and drawn three ways.

**Road thumbnails are procedural**, not painted: they go through the same `buildRoadSpec` and
`ribbonSurface` the island uses, on a grass disc, so a dirt card cannot show something dirt roads do
not look like.

### Cache behaviour

`thumbnailCacheKey` is stable for an asset and distinct across assets, so the second look at a
category is a map lookup and an `img.src` assignment. Failures are not cached, so one flaky download
does not become a permanent hole in the catalogue.

Measured on the coverage harness (`apps/web/qa/thumbs.ts`, temporary): 35 catalogue entries, 31 GLB
models plus 4 procedural road tiers, **usable = 35, missing = 0**; the first pass over the models
reported `drawn=39, cached=31` (every model asked twice by the sheet), and re-asking a drawn road tier
incremented `cached` only. No renderer is created at startup, and a session that never opens the shop
never creates one at all.

## Placement preview

Selecting an unlocked card closes the panel and hands the renderer a `PlacementPreview`: the model or
road tier, the footprint in cells, whether the current cell accepts it, and a yaw. The renderer draws
a translucent footprint patch - green when the cell accepts it, red when it does not - and a ghost of
the model above it, or a four-cell segment of the road tier's own surface. The model itself is not
recoloured.

The validity rule is `previewRejection` in `apps/web/src/render/placement-preview.ts`, written over
the renderer's own `WorldCell` map: no cell, off the island, wrong ground, missing capability,
occupied, or land the player does not own. It is pure and unit tested, and it intentionally mirrors
the checks the future server command will make rather than inventing a client-side rule.

Cancellation - `Esc`, choosing another item, or closing the shop - clears the ghost, the footprint,
and the road segment, and disposes exactly what the preview allocated (never the cached model's
geometry).

## The boundary V12.5 will attach to

This pass stops before `confirm`. There is no gold deduction, no purchase command, no placement
command, and nothing is written to `localStorage` to fake persistence. The seam is deliberately
shaped for the next pass:

```text
select a catalogue entry            -> done (shop)
+ show a ghost on the selected cell -> done (renderer preview)
+ collect a confirmation            -> next
+ POST the placement command        -> next: server authenticates, authorizes, validates the cell and
                                       footprint, charges through the economy service, persists, and
                                       broadcasts the result
+ refresh from the authoritative    -> next
  world state
```

The catalogue already carries everything that command needs (`entryId`, `footprint`, `capability`,
`tier`, `upgradeTo`, `unlockCondition`), and the preview's rejection reasons are the client's *guess*
at the server's answer - a courtesy to the player, never the enforcement.

## Performance rules this pass must keep

* one offscreen renderer, drawing on demand, cached as data URLs - never one per card;
* no animation loop anywhere in the shop or the preview;
* road geometry is built once and never rebuilt per frame; the road adds no per-frame work;
* the preview rebuilds only when the selection, the item, or the world layer changes;
* scenery clearance and the WorldCell lattice are unchanged, so nothing new is scattered per cell.

## Known limits

* Gravel and paved are **preview-only**; naming them `Preview` on the card is the honest state until
  the runtime surfaces exist.
* Thumbnail framing fits the model's bounding box. A model that is mostly transparent margin around a
  small subject (currently `plant_fern`) reads smaller than its neighbours.
* The placement preview is a picture of an intention, not a reservation: two players could preview the
  same cell, and nothing is claimed until the server command exists.

## Visual QA, V12.4

24 views were rendered from the finished build and opened one by one (a temporary headless-Edge
harness, deleted with the commit; nothing in the repository serves them).

| # | View | Verdict | Note |
| --- | --- | --- | --- |
| 01 | estate north | PASS | the road reads as a worn trail across the field, not a strip on top of it |
| 02 | estate east | PASS | road and harbour visible at estate zoom; no kerb, no flare |
| 03 | estate west | PASS | the trail crosses open land cleanly; village to harbour reads as one route |
| 04 | harbour | PASS | the road runs into the quay yard and stops; no wedge at the junction |
| 05 | harbour road start | PASS | believable transition from yard to dirt; no raised shoulder |
| 06 | dirt road straight | PASS | dark trodden edge, no pale halo, edges not machine-straight |
| 07 | dirt road bend | PASS | the bend follows the ground; no fold, no width flare |
| 08 | dirt road edge close-up | PASS | ruts readable, shoulder darker than the field, no floating edge |
| 09 | village road transition | PASS | dirt terminates into the paving; the V12.3 pale wedge is gone |
| 10 | shop default / Roads | PASS | cards, prices, levels, `Preview` on gravel and paved |
| 11 | shop Buildings | PASS | real barn/coop/silo thumbnails, locked Barn t3 dimmed |
| 12 | shop Planting | PASS | trees, bushes, flowers and rocks all identifiable without reading |
| 13 | shop Decoration | PASS | consistent framing and contact shadow across props |
| 14 | shop locked items | PASS | dimmed picture, lock icon, `Lv 8` badge over the thumbnail |
| 15 | shop scrolled | PASS | only the grid scrolls; header and categories stay put |
| 16 | barn thumbnail close-up | PASS | whole footprint, 3/4 angle, ~70% of the frame |
| 17 | tree thumbnail close-up | PASS | whole tree visible; consistent ground and lighting |
| 18 | road tier thumbnails | PASS | four visibly different surfaces; previews badged |
| 19 | building preview, valid | PARTIAL | ghost and status line read clearly; the green patch is subtle at the default zoom |
| 20 | building preview, invalid | PASS | red patch plus "cannot go there: this ground cannot hold it" |
| 21 | road preview | PARTIAL | four-cell segment appears on the cell; small at the default camera distance |
| 22 | cancelled placement | PASS | ghost, footprint and segment all gone; "Nothing was built." |
| 23 | shop + world composition | PASS | the panel covers a meaningful part of the viewport and still leaves the island |
| 24 | low-angle road view | PASS | the road sits in the grass; no kerb from a pedestrian eye height |

### Problems found during QA, and what was done

1. **Every road card was a plain green rectangle.** The road ribbon is built in world coordinates, and
   the preview rotated that geometry around the world origin, which threw the segment out of frame.
   Fixed by translating the geometry to its own start before the mesh is posed. Re-rendered: 10, 16,
   18 and the coverage sheet.
2. **Road thumbnails were a full-frame diagonal swatch.** The camera sat so close that the segment ran
   off all four corners. The preview camera now frames the whole four-cell segment with grass around
   it. Re-rendered: 18.
3. **A pale halo around the road.** `shoulderProfile` rose above 1.0 next to the road, so the shoulder
   was *brighter* than the field - a ribbon with an outline. The profile now stays below the field
   everywhere and is darkest at its outer edge. Re-rendered: 05-09, 24.
4. **Wheel ruts were invisible at walking distance.** Deepened from 3% to 6% either side of the crown.
   Re-rendered: 08, 24.
5. **The lock badge vanished as soon as a thumbnail arrived**, because the image swap replaced *all*
   of the thumbnail's children, overlay included. Fixed by removing only the placeholder. Re-rendered:
   11, 14.
6. **An invalid placement was only a colour.** The status line now names the reason ("Fish cage cannot
   go there: this ground cannot hold it"), and the footprint patch got a lip so the colour is visible
   around the ghost. Re-rendered: 19-22.
7. **The scrolled shot was not scrolled.** The first capture used a viewport tall enough that the
   longest category fit, so the "scrolled" view was a lie; it is now shot at 620 px tall, where the
   grid genuinely overflows. Re-rendered: 15.

### Remaining visual weaknesses

* `plant_fern` is mostly transparent margin around a small subject, so its card reads smaller than its
  neighbours. Fixing it properly means alpha-aware thumbnail bounds.
* At the default camera distance the placement footprint is small; the colour and the status line
  carry the meaning, but a closer default for placement would read better.
* Gravel and paved remain preview-only surfaces; the island can draw neither yet.
