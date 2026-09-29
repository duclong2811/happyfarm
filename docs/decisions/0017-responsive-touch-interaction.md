# 0017 - Responsive HUD, touch interaction, and the Go command

Status: implemented (client only). Desktop browser verified; touch verified in emulation, physical
device pending.
Phase: player UX / mobile readiness, the last client phase before the pre-deployment audit.

## Context

The farm was a desktop game that happened to render on anything. A phone could load it, but the two
side panels reserved about 500 CSS px, the market had no way to get out of the way, and the only way
to move the character was a keyboard. Touch was not a supported input; it was an accident.

The goal was one game with one authoritative state and one scene, adapted - never a second mobile
implementation. Nothing in this phase changes what a control *means*: it changes how much room the
controls take and how a finger is read.

## Decisions

### One pointer pipeline, three intents

```text
keyboard ─┐
mouse ────┼→ pointer gesture (tap | pan | pinch) → camera rig
pen/finger┘                                      → tile selection
         └→ movement intent (directional | destination) → player runtime
```

The canvas listens to Pointer Events only. `apps/web/src/render/pointer-gesture.ts` is a pure
recogniser: it is handed pointer samples and answers with an intent, so there is no mouse path and no
touch path that can drift apart, and arbitration is testable without a browser. The canvas sets
`touch-action: none` so a gesture that starts on the world is never stolen by page scrolling or
browser zoom; every other surface keeps its own scrolling.

### Gesture arbitration is one-way

```text
down                        → tap candidate
one pointer moves > 6 px    → pan   (the tap candidate is gone)
a second pointer arrives    → pinch (the tap and pan candidates are gone)
one finger of a pinch lifts → the press stays spent until every pointer is up
pointercancel               → forgotten, never a tap
```

Consequences worth stating: a pan release never selects a tile, a pinch never selects anything, the
leftover finger of a pinch neither pans nor taps, and a tap must both stay inside the slop and be the
only pointer of its press. The same slop that guarded the mouse guards the finger.

### The camera is one rig, and touch only feeds it

`apps/web/src/render/camera.ts` already owned the target (`character + pan offset`, clamped to the
farm) and the wheel zoom. Touch adds one method - `zoomByScale` - and nothing else: a pinch reports a
factor between its two fingers, and the same clamp (0.62..2.4) applies. There is no mobile camera,
and a gesture can no more move the character than a wheel event can.

### "Go" is a client-local destination, not a joystick

A tap already means "select", so walking could not be bound to tapping the world. Instead the dock
offers `👣 Go / Đi tới`, which walks the character to the selected tile:

```text
selection → Go → destination (world metres) → movement intent → straight vector → controller
```

`apps/web/src/player/intent.ts` owns that boundary: a movement intent is either `directional` (a held
key) or `destination` (a place), and only that module turns a destination into a vector. Pathfinding
later replaces `destination -> vector` with `destination -> waypoints` without touching the dock,
the keyboard, the controller, or the server.

Behaviour, all of it client-local:

* a new Go replaces the previous destination;
* any movement key cancels it immediately - the player's own hand wins;
* arrival stops it inside `ARRIVAL_RADIUS_WORLD`;
* a walk that stops making progress for `DESTINATION_STALL_MS` gives up where it stands, so an
  unreachable target cannot spin the loop for ever, and nothing is ever teleported or pushed through
  an obstacle;
* refreshing the farm rebuilds the collision world and never moves the character.

The server is not told about a destination, exactly as it is not told about a key press.

### The side panels fold, and only the CSS decides how much room they take

Both the market and the bag/land panel are collapsible through a real `<button>` in their header
(`aria-expanded`, `aria-controls`, localized label, visible focus). Folded, the panel is a tab in the
corner - `🛒 Market`, `🎒 Bag` - and its old area stops intercepting pointers, so the world gets the
space back.

Defaults come from `apps/web/src/panels.ts` and mirror the CSS breakpoint at 900 CSS px:

```text
desktop / large tablet landscape  → both panels open
tablet portrait, phone, landscape → both folded
```

Only a resize that *crosses* the breakpoint re-applies the defaults; a phone whose address bar
changes the width by a few pixels does not re-open a panel the player just folded. Open/closed is UI
state only: it is not stored, not sent, and not read by a game rule. Collapsing and reopening the
market rebuilds it from the same server state, so quantities and gold are exactly where they were.

### Responsive layout is CSS, and it measures the bands it has to avoid

`apps/web/src/responsive.css` is imported after the desktop stylesheet and adapts it:

* phones drop the descriptive farm line and the XP detail, keep gold, level, language, refresh, the
  selection readout, and the dock;
* the action dock reflows instead of scrolling sideways, keeps its primary action on one line with
  the crop select, and gives every control a ~44 px touch target;
* the status line and the folded tabs are placed from `--hud-height` and `--dock-height`, published
  by `syncLayoutMetrics()`, rather than from magic numbers, so no overlay can land on the controls
  above it whatever a long status or a wrapped button does to their height;
* `env(safe-area-inset-*)` keeps floating controls off notches and home indicators, and the viewport
  meta carries `viewport-fit=cover` so those insets exist at all;
* a short landscape viewport makes the world fill the window instead of keeping its portrait
  minimum height, which is what used to push the dock below the fold.

No user-agent branching: every decision above is a width, a height, or an orientation.

## Consequences

- **No migration, no contract, no server change.** Nothing in this phase reaches the API; the player
  stays client-local and non-authoritative.
- **Desktop behaviour is unchanged in meaning**: click selects, left drag pans, wheel zooms, WASD and
  the arrows walk. The same slop, the same clamp, the same rig.
- **Touch completeness.** Inspect, select, pan, zoom, shop, plant, harvest, uproot and remove are all
  reachable with one finger; walking is reachable through `Go` rather than a joystick by design.
- **Known gap: the phone's first view is a narrow slice.** A portrait window shows roughly seven
  tiles across, so the opening view - the clamped camera, the character on the path - puts the field
  near the top edge. Panning and pinching reach it, and the framing policy is the desktop one; a
  portrait-specific framing pass is a later, separate decision.
- **Not verified on a physical device.** Emulation is not a phone: real touch latency, iOS Safari
  safe areas, and pinch feel still need a human with a device.
