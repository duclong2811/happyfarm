# Mobile input

Status: how a phone plays the same game a desktop does, and the boundaries that keep it that way.
Read this before touching the joystick, the touch camera, or anything that decides movement.

> **Happy Farm has one world and one gameplay controller.**
>
> Desktop and mobile are merely different ways to control it. No mobile UX problem is solved by
> creating a second gameplay implementation.

## The architecture, in one picture

```text
desktop keyboard  ──┐
                    ├─→ CharacterMoveIntent ─→ composeCharacterInput ─→ cameraRelativeMovement(yaw)
mobile joystick   ──┘                                                        │
                                                                            ▼
                                                        stepPlayer(state, vector, dt, world)
```

The joystick does not know about speed, collision, terrain, the camera, or the character. It answers
"which way is this finger pushing"; the composition layer decides whose answer counts; the *same*
controller that desktop WASD feeds does the rest. That is the whole mobile-input architecture, and it
is why V13.5 cannot accidentally become a second gameplay implementation.

## Who is holding what: capability, not user agents

`apps/web/src/mobile/capability.ts` answers two independent questions from the browser's own signals
(`pointer: coarse`, `hover: none`, `maxTouchPoints`, viewport size):

| | what it means | what it decides |
| --- | --- | --- |
| `coarse` | the primary pointer is a finger that cannot hover | whether the touch controls exist at all |
| `compact` | the viewport is too small for the desktop layout | which CSS layout applies |

They are deliberately separate. A **touchscreen laptop** reports `touch` but not `coarse` (its mouse
hovers), so it keeps its desktop controls and just gets bigger hit targets. A **narrow desktop window**
is compact without being coarse, so it gets the compact layout and no joystick. A **large tablet** is
coarse without being compact: it gets a joystick and the normal layout.

The numbers are shared with the stylesheet rather than duplicated: 900 CSS px is the width at which the
sidebar stops fitting, and 500 the short side below which a viewport is a phone held sideways.

## Gesture ownership

Ownership is structural rather than negotiated, which is what makes the multi-touch cases fall out for
free:

* The joystick and the Run button are **DOM elements over the canvas**, with `pointer-events: auto`
  inside a container that is otherwise `pointer-events: none`, and `touch-action: none`. A touch that
  starts on a control never reaches the canvas at all, so it can never orbit the camera or select
  anything.
* The joystick **owns one pointer id** (`createJoystickTracking`). A second finger landing on the stick
  is ignored rather than adopted, and a move from any other pointer is ignored entirely.
* The camera sees only the pointers that start on the canvas. The scene's gesture module
  (`apps/web/src/render/pointer-gesture.ts`) already arbitrates tap / pan / pinch by pointer id, and it
  is unchanged: one pointer that travels past `TAP_SLOP_PX` (6 px) is a drag, a second pointer is a
  pinch, and **a drag or a pinch can never end in a selection**.
* The Build Shop's scrollable body and the panel surfaces own their own touches (`touch-action: pan-y`
  and `overscroll-behavior: contain`), so scrolling the catalog cannot orbit the world underneath it.

There is no global "is the screen being touched" flag anywhere in the codebase, on purpose.

## The joystick

A **fixed** joystick (the brief's choice: predictable, discoverable, easy to QA, and it does not
compete with the camera for the same finger), built from `apps/web/src/mobile/joystick.ts`, which is
split into a pure tracker and a thin DOM binder.

| Property | Value | Why |
| --- | --- | --- |
| Base | 128 px diameter (`--joystick-size`) | a thumb-sized target, clear of the safe area |
| Thumb | 52 px | visibly inside the base at full deflection |
| Dead zone | 18% of the base radius | a resting thumb must not walk the character |
| Travel | 68% of the base radius | a thumb pinned to the rim looks broken |

* **Fixed means fixed**: deflection is measured from the *base centre*, re-read once per press so a
  rotation or a safe-area change moves it correctly. Touching the rim means full push immediately.
* **Analog**: magnitude ramps from the dead zone to the rim, so a small push is a slow walk. The
  returned vector is never longer than one unit.
* **Screen-up is forward, screen-right is right** - the same mapping the keyboard has, and the camera's
  yaw is what turns it into a world direction.
* **One transform per event**: the binder writes `translate3d(...)` to the thumb and nothing else. No
  DOM is built per move, and no scene work happens on a pointer event.
* **Pointer capture** keeps the gesture alive when the thumb slides off the base, so a firm push does
  not turn into a camera drag halfway through.

The same file provides the **Run** control: a press-and-hold button with `aria-pressed`, which reports
`false` on release, cancel, lost capture, a blurred window and a hidden tab. Run feeds the existing
`RUN_SPEED_MULTIPLIER` and the existing `RUN` animation state; it changes no speed of its own.

## Composition: whose movement counts

`composeCharacterInput(keyboard, touch)` (in `apps/web/src/player/character-input.ts`):

> **A deflected touch stick wins; otherwise the keyboard does.**

The alternatives were to sum the two (which changes the *direction* when a hybrid player pushes both -
the character veers - and makes the pace depend on how many devices are plugged in) or to clamp a sum
to unit length (same veer, honest speed). Choosing a source keeps the character walking exactly where
the player is pointing, and the brief's rule - two inputs at once must never double the speed - is
satisfied by construction: exactly one of them is ever used. Both intents are magnitude-clamped to one
unit before anything else sees them.

## The camera, on a finger

There is **no mobile camera**. Touch drives the same rigs the desktop does:

* **One-finger drag on the world** orbits the active camera: the estate rig in estate view, the
  character rig in character view. A phone has no right button, so "right-drag rotates" cannot be the
  touch language - the drag *is* the rotate. A mouse's left drag still belongs to selection.
* **Two-finger pinch** zooms the same rig, respecting the same minimum and maximum distances. The
  canvas is `touch-action: none`, so the browser never zooms the page instead.
* **Panning stays a mouse gesture** (the middle button). V13.5 deliberately does not add a two-finger
  pan: it would compete with the pinch for the same two fingers, and the brief's priority is selection,
  orbit and zoom.
* **Selection happens on tap**, through the existing raycast and the existing picking pipeline. There
  is no mobile raycast.

## Losing input

Every "held" thing clears on every way it can be lost: `pointerup`, `pointercancel`,
`lostpointercapture`, the window blurring, the tab being hidden, and a camera-mode switch (which clears
both touch controls, because they only exist in character view). The player must never continue
walking after a finger is lifted, and a run button must never stay held.

## Desktop coexistence

Nothing about the desktop path changed: keyboard WASD, Shift to run, F to switch view, click to select,
right-drag to orbit, middle-drag to pan, wheel to zoom. The touch handlers are bound to elements that
only exist for a coarse pointer, and the compact layout is a media query, so a mouse session is
untouched by all of it.

## Future: a gamepad

The same seam takes it. A gamepad adapter produces `CharacterMoveIntent` and a run flag, and nothing
downstream changes - which is another reason movement logic must never live inside the joystick code.
