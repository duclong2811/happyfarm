# Mobile UI

Status: how the phone layout is arranged, and what it is allowed to change. Read this before touching
`apps/web/src/styles.css`, the HUD, or the touch controls' markup.

> **Presentation only.** The catalog, the filters, the prices, the placement validation, the object
> actions and the economy are the same code on both; only where things sit on the screen changes.

## Where things sit

```text
┌──────────────────────────────────────────────┐
│ Happy Farm        Gold   Level   Estate/Char │   top HUD: always visible, never taller than
│                                              │   one band (the wordmark and the language
│                                              │   toggle drop below 600 px wide)
│                                              │
│                GAME WORLD                    │   the world keeps the middle of the screen
│                                              │
│  [ JOYSTICK ]                     [  RUN  ]  │   character view, coarse pointer only
└──────────────────────────────────────────────┘
```

* The **joystick** sits bottom-left and the **Run** button bottom-right, both clear of
  `env(safe-area-inset-*)`. The world's middle is never covered.
* In **character view** the bottom of the screen belongs to movement: the module rail steps aside
  (`body.is-character-mode`). The selection surface does *not* - character view keeps a one-line
  strip, which is how a player can ask to plant something without the farming editor covering the
  island they are walking on. See "The selection surface" below.
* In **estate view** there is no joystick - estate view is for selecting, building and editing - so the
  bottom belongs to the selection surface and the selected-object panel.
* **Transient messages sit under the top bar on a compact layout**, never at the bottom: the bottom of
  a phone screen is the joystick, the Run button and the strip, and a toast landing on one of them is
  a control the player cannot press.

## Breakpoints

One section of the stylesheet, two media queries, and the same numbers the JavaScript uses
(`apps/web/src/mobile/capability.ts`):

| Query | What it means |
| --- | --- |
| `(max-width: 900px)` | the sidebar layout no longer fits |
| `(max-height: 500px)` | a phone held sideways: wide, but far too short for the desktop arrangement |
| `(max-width: 600px)` | a narrow phone: drop the wordmark and the language toggle so the band stays short |

## The Build Shop, as a bottom sheet

On a compact layout the same `#build-panel` element becomes a sheet anchored to the bottom edge:
rounded top corners, `max-height: min(64dvh, 26rem)`, and its body scrolling internally with
`touch-action: pan-y` and `overscroll-behavior: contain` - so a flick through the catalog scrolls the
catalog and never orbits the camera behind it.

Nothing about the sheet is a second shop: the same categories, the same search, the same level locks,
the same prices, the same thumbnails, the same Place action, the same rendering code. Item cards on a
compact layout use a responsive grid (about two columns on a phone) instead of one wide desktop row,
and every action a finger has to hit is at least `--touch-target` (44 px) tall.

## Placement, move, restore

The mobile workflow is the desktop workflow with a thumb:

1. tap an editable object (or open the shop and pick an item) - either way the page switches to estate
   view, because placement is precise, cell-based work;
2. the shop closes so the world is visible, and the placement HUD shows the asset, its price, the
   placement state and the confirm/cancel pair;
3. tap the target cell; the existing `WorldCell`, ownership, occupancy and server-authoritative
   validation decide whether it is legal;
4. **Confirm** or **Cancel** - both are real buttons in the panel. A phone has no Escape key, so a
   placement, a move and a restore are each leavable by touch, and cancel does exactly what Escape
   does (nothing is changed).

The same is true of the selected-object panel: Move, Rotate, Store and Delete are the desktop actions,
with Delete keeping its confirmation and its refund wording.

## Orientation

Landscape is the preferred way to play (more world, the controls in the corners), and portrait is fully
functional - no "rotate your device" gate, and no portrait-specific gameplay. Rotation is handled by
the existing resize path: the renderer re-measures, the camera keeps its aspect, the controls re-read
their capability and re-centre, and **nothing reloads** - no models, no world, no player position.

## Safe areas, and the address bar

Controls use `env(safe-area-inset-*)` so nothing essential hides under a notch, a rounded corner or the
home indicator, and the panels add the bottom inset to their padding.

For height, the shell uses `height: 100%` with a `@supports (height: 100dvh)` upgrade, and the sheet
uses `max-height: min(64vh, 26rem)` with a `64dvh` refinement - so a phone whose address bar collapses
does not end up with the bottom of the UI off-screen. The canvas follows via the existing
`ResizeObserver`.

## Touch behaviour, scoped

`touch-action` is set where a gesture has an owner and nowhere else:

| Surface | Behaviour |
| --- | --- |
| the canvas, the joystick, the Run button | `touch-action: none` - the game owns those gestures |
| panel bodies, the shop grid | `touch-action: pan-y` + `overscroll-behavior: contain` - they scroll |
| inputs, selects, dialogs, buttons | the browser's own behaviour, untouched |

`body` keeps `overflow: hidden`, so the page never scrolls or pull-to-refreshes behind the game; text
selection and the tap highlight are suppressed only on the controls themselves.

## Accessibility

* The Run button is a real `<button>` with `aria-pressed` reflecting its held state.
* The joystick is a pointer-only convenience and is marked `aria-hidden`: it duplicates what the
  keyboard already does, and the keyboard remains fully supported (that is the accessible path).
* The camera-mode switch keeps its `aria-pressed` buttons; focus states and keyboard operability are
  untouched; touch targets are at least 44 CSS px in the compact layout.

## The quality profile

A coarse-pointer touch device is given the `MOBILE` render-quality preset
(`apps/web/src/render/render-quality.ts`), chosen by capability and applied once when the renderer is
created:

| | NORMAL (desktop) | MOBILE | LOW (`?quality=low`) |
| --- | --- | --- | --- |
| pixel-ratio cap | 1.75 | **1.4** | 1 |
| shadows | on, 2048 | on, **1024** | off |
| micro-scenery | on | **off** | off |

The cap is the single largest saving: a 3x phone display is not drawn at 3x. Shadows stay - the
character and the buildings read better with them - at half the resolution. The micro-scenery (flowers
and grass tufts) goes, because it is the highest draw-call count for the least information. None of it
touches the world, the objects, or anything the server has an opinion about, and a developer's
`?quality=low` still wins on any device.

## What is not here

No PWA installation, no offline mode, no haptics, no gamepad, no mobile-specific gameplay, no second
shop or object editor, and no phone-only map or economy. V13.5 is mobile *playability*.

## V13.6.3: the world is the UI

The first real-device test after V13.5 made one thing clear: the controls were mobile *sized* but not
mobile *designed*. A top bar with four controls, and a selection panel that could take a third of the
screen, read as a desktop layout squeezed onto a handset. The pass that fixed it kept the two rules
above and added a third: **the 3D world is the primary surface, and everything else is either
transient or folded.**

### The top bar

Only three things are permanent: the brand (the wordmark drops below 600 px), gold and level, and the
camera switch. The recenter control joins them in estate view only, as an icon-sized target.

Language and refresh moved behind `#hud-menu-toggle` - the `more` icon - which is `display: none` on a
wide screen, so the desktop bar is unchanged, and a 44 px button on a compact one. The menu is a real
element with `aria-expanded`, closes when a control inside it is used, and closes on any click
outside. It is never the only way to do something: refresh is still a real reload of the farm, and the
language switch is still one tap away.

### The selection surface

`apps/web/src/dock.ts` owns the decision, and it has four answers rather than two - see
`dockPresentationFor`:

| Presentation | When | What is on screen |
| --- | --- | --- |
| `HIDDEN` | nothing selected | nothing: the world keeps the space |
| `STRIP` | compact, collapsed (the default) | one line: what is selected, its primary action, a chevron |
| `SHEET` | compact, expanded by the chevron | the whole dock, on top of the world |
| `FULL` | desktop | the dock exactly as it has always been |

The same buttons exist in all four: nothing is hidden by gameplay, only by layout. In the strip the
detail line, the crop chooser, the tree state and the destructive actions wait behind the chevron;
the primary action stays out. A growing crop whose only action *is* destructive therefore shows the
chevron and its own title, which is honest about where "uproot" went.

Character view can only ever reach `STRIP`. That is the compromise the brief asks for: the farming
editor never appears while the player is running around, and a tap on the player's own soil still
opens a strip with **Plant** on it - which switches to estate view (see
`docs/design/DUAL_CAMERA_CHARACTER_MODE.md`).

### Transient messages

A success message now clears itself after six seconds and the status element is hidden while it is
empty, so a completed action gives the screen back. Errors are deliberately not on that clock: a
refusal the player asked for stays until something replaces it. Routine polling still says nothing at
all - it never did - and the refresh button's own message is now transient like the rest.

### What did not change

Every action, price, lock, validation rule and server call is the one that was there before. The
joystick and Run button are character-view-only, exactly as V13.5 left them. Desktop keeps its dock,
its hover, its right-drag orbit and its middle-drag pan.
