# Dual camera: estate view and character view

Status: what V13.4 added, and the rules a later pass must not break. Read this before touching the
camera, the movement input, or the way the HUD switches between the two.

> **Estate View and Character View are two ways to control the same world, not separate game states.**

HappyFarm is one island with one terrain, one object state, one character, one collision world and one
renderer. The two views differ in exactly two things: where the camera is, and who is driving the
character. Nothing is reloaded, no state is duplicated, and switching is a change of viewpoint rather
than a change of game.

## The two views

| | Estate | Character |
| --- | --- | --- |
| camera | a high orbit over the island | behind the character, at shoulder scale |
| movement | click-to-move, plus WASD on the world's axes | WASD relative to where the camera looks |
| selection | cells, objects, the Build Shop | objects only |
| used for | designing and managing the island | walking it at human scale |

The mode is owned by the host page (`apps/web/src/main.ts`), because the HUD shows it, the panels
depend on it, and the movement keys are routed by it. `apps/web/src/render/camera-mode.ts` owns the
pure parts: which mode a toggle leads to, whether a keystroke is a shortcut at all, and the flight
between the two viewpoints.

* **Desktop shortcut**: `F`, toggles, ignored while a text field, a select or a `contenteditable` has
  focus (the same guard the movement keys use - `isTypingTarget` in `apps/web/src/player/input.ts`).
* **HUD control**: two named buttons in the top HUD, the active one lit. The player should never have
  to guess which of two very different cameras they are holding.
* **First entry**: a four-line hint that fades itself out. Once per session.

## One camera, two rigs

There is one `PerspectiveCamera` and two rigs that describe where it should be:

* the **estate rig** (`apps/web/src/render/camera.ts`) - unchanged from V10, and the one the player
  steers with a right-drag, a middle-drag, the wheel and the recenter control;
* the **character rig** (`apps/web/src/render/character-camera.ts`) - the same yaw/pitch/distance
  vocabulary aimed at a character.

A mode switch never writes to the rig it is leaving. It *reads* the current pose, reads the target
pose, and flies between them, so "the estate camera is preserved exactly" is a property of the code
rather than a promise: rotate and zoom the island, walk around, come back, and the estate view is
where it was.

## The transition

`createCameraTransition` interpolates eye, target and lens together over 0.65 s with a cubic ease, and
manual camera input is suppressed for its duration - the flight is short, and a drag that moved a rig
underneath the blend would fight it.

The transition is **re-aimed every frame** (`retarget`): a character can walk while the camera is
still on its way, and a flight that froze its destination when F was pressed would land where the
player used to be. Pressing the switch twice mid-flight turns around from where the camera actually
is, because the new flight starts from the *blended* pose.

The two views use different lenses - 45 degrees for the estate, 52 for the character - and the
projection is rebuilt only when the lens actually changes.

## Moving in character view

Movement is an **intent**, never a keystroke:

```text
DesktopKeyboardInput  ─┐
                       ├─→  CharacterMoveIntent { forward, right }  ─→  cameraRelativeMovement(yaw)
MobileJoystick (V13.5) ─┘                                                   │
                                                                            ▼
                                                        stepPlayer(state, worldVector, dt, world)
```

`apps/web/src/player/character-input.ts` holds the intent, the desktop reading of it, and the one
conversion that matters: the camera's yaw. The controller (`apps/web/src/player/controller.ts`) never
sees a key, a key code, or a `KeyboardEvent`, which is what lets V13.5 add a thumbstick without
touching movement.

* **Camera-relative**: the eye sits at `target + (sin yaw, cos yaw)`, so forward is `(-sin yaw,
  -cos yaw)` and right is `(cos yaw, -sin yaw)` - the same frame the estate camera pans in, so the
  two views agree about what "right" means. Turn the camera 180 degrees and W walks the other way.
* **Diagonal**: the intent is a direction, and `stepPlayer` normalizes once at the point of use, so
  W+D is not faster than W.
* **Speed**: `PLAYER_SPEED` = 2.6 m/s, chosen against the world's own numbers - a tile is 1.08 m, the
  player is 1.6 m, the island is about 118 m across - so crossing the island takes the better part of
  a minute rather than five seconds. `Shift` runs at 1.6x. No stamina.
* **Facing**: the controller turns the character towards their heading at 12 rad/s rather than
  snapping, and the avatar's own bob is unchanged.
* **Frame-rate independence**: everything is in seconds, and an abnormal delta (a restored tab) is
  clamped and sub-stepped, so 30 fps and 120 fps travel the same distance in the same real time.

## The ground

The character stands on the island's own surface - `terrainHeightAt`, the same function the ground
mesh, the props and the estate camera use - rather than on the flat plane the grid is laid out on.
`PlayerRuntime.setTerrain` hands the runtime that function, and the runtime re-reads it when the
character moves, not every frame while they stand still.

`slopeBlocks` (`apps/web/src/player/collision.ts`) is the one addition to the collision model: a step
whose rise is steeper than `PLAYER_MAX_SLOPE` (45 degrees) and taller than `PLAYER_MAX_STEP_WORLD`
(0.35 m, a kerb) is refused. It is deliberately a *climb* rule - walking down a steep face is never
refused, because refusing it would strand anyone who walked out onto a ridge - and deliberately not a
physics engine.

Water and out-of-world are already handled by the collision world the estate view uses: the shore is a
signed distance, so the character may stand on the beach and may not walk into the sea, and there is
no permitted shallow-water wading today.

## Obstacles and occlusion

Walking and looking use the same rows. `objectObstacles` turns every *standing* row into the circle
its definition declares, so the character is stopped by a tree, a rock or a barn - never by a row that
has been stored, removed or moved elsewhere.

The camera's occluders are a much smaller set, and deliberately so:

* the geography (`STATIC_OBSTACLES`: the pond),
* the **buildings**, taken from the rows whose footprint covers more than one cell.

A tree, a rock, a bush or a barrel is not an occluder: a third-person camera that pulled in behind
every shrub would feel broken, and testing four hundred circles every frame is exactly the kind of
per-frame raycast the performance rules forbid. The occluders are rebuilt when the rows are, so a
building the player moves takes its silhouette with it.

The character camera walks its ray outward from the shoulder and stops at the first sample that would
be under the ground or inside a building; the eye is then clamped above the terrain whatever the
samples did. When the obstruction is gone the camera returns to the distance it was asked for, because
the obstruction shortens the *eye*, never the rig's own setting.

## Construction and editing from character view

Deliberately minimal, and documented rather than half-built:

* **Opening the Build panel, picking an entry up, moving an object or restoring one from storage
  switches to the estate view.** Placing is cell-based, precise work; asking a player to do it from
  behind their own shoulder would be a worse tool, not a new one.
* **Clicking an object in character view still selects it** and opens the object panel. Move then
  hands over to the estate workflow.
* **A ground tap in character view selects only when the cell offers something** - the player's own
  soil to plant, a crop or a tree to inspect - and opens the one-line context strip (V13.6.3). Wild
  land, water and anybody else's ground are ignored, so the joystick keeps the screen.
* **Ground click-to-move is still off in character view.** The character is steered with the movement
  keys, and a stray tap setting up a walk would fight them. Walking to a selected cell is the Go
  control, and it is estate view's.

## Input priority

Highest first, and one rule per level:

1. a modal or a text field owns the keyboard entirely (`isTypingTarget`);
2. placement and object-move modes own the pointer (object picking is off);
3. a camera flight owns the camera (manual camera input is suppressed);
4. character movement (only in character view);
5. normal world selection.

`F` is ignored at level 1, and WASD never reaches the character while a search box has focus.

## Frame update and performance

Character view adds vector maths to a loop the client already ran: read the intent, turn it into a
direction, step the controller (which asks the collision world), write the pose, and let the camera
follow. There is no per-frame API call, no world rebuild, no collision rebuild, no scene-wide
raycast, and no DOM work - the character loop sleeps the moment no key is held, and the camera's own
frame loop sleeps as soon as it has settled. The hint and the mode control are ordinary DOM, updated
when the mode changes rather than per frame.

The character's position is **client-local**, exactly as it was before V13.4: no position is sent
anywhere, and there is no persistence to throttle because there is no traffic. Camera state is not
persisted either.

## V13.6.3: the estate camera follows, and precision work owns the view

Two rules were added after the first real-device test, and they are the ones to keep.

### 1. The estate camera follows the player, without losing map inspection

Before this pass the estate camera stayed wherever it was put - which was right when the farm *was*
the game, and wrong the moment a character could walk off the edge of the frame. It now has two
behaviours, and `apps/web/src/render/estate-follow.ts` is the whole of the rule:

| Behaviour | Meaning |
| --- | --- |
| `FOLLOW` | the camera's target glides to the player's ground position (a damped glide, never a cut) |
| `FREE` | the camera stays exactly where the player left it |

* Touching the estate camera - orbiting with a drag, Q/E, or a middle-drag pan - enters `FREE` and
  stamps the time. Zooming deliberately does **not**: pulling the lens back does not mean "stop
  looking at my farmer", which is also why `Estate zoom preserved while following` is a test.
* A camera the *game* aimed (`focusOnCell`: entering placement, picking an object up) is `FREE` too:
  a step must not drag the view off the cell being edited.
* Movement re-attaches a `FREE` camera once the player has left it alone for
  `FOLLOW_RESUME_DELAY_MS` (2 s). That is the brief's "preserve FREE briefly", expressed as one
  timestamp rather than a timer per input, and it is what stops a pan-then-walk from being a
  tug-of-war.
* The recenter control (target icon in the top HUD, and `R` on a keyboard, estate view only) restores
  `FOLLOW` immediately and glides back to the player. It glows while the camera is free, so the one
  control that would bring it back is the one that says so.
* Coming back from character view: a `FOLLOW` camera re-attaches to the player where they now are,
  and a `FREE` camera is restored exactly as the player left it.

The motion itself is the estate rig's existing damped glide, re-armed every frame by
`followTo` - one vector subtraction and one exponential step per frame, driven by the pose stream the
character already produces, so a following camera costs no extra frames and a standing player costs
none at all (`isSettling()` only reports work when there is a real gap).

### 2. Precision work owns the estate view; asking for it from character view helps

The product rule: **character view is for movement and interaction, estate view is for precise
farming, building and editing.** Planting, placing, moving and turning are cell work, and the estate
camera is the only one of the two that can see a cell, its neighbours and the ownership wash at once.

So a precision action asked for from character view does not answer "not available". It changes the
viewpoint and takes the camera to the thing the player was working on:

```text
character view -> player selects their own soil -> taps Plant
  -> estate view, camera gliding to that cell, planting controls available
```

`apps/web/src/render/precision-action.ts` decides *where* to look (the selected cell, the object's own
anchor, or the player as a fallback), and the status line says what happened. No page reload, no
duplicated state, and the action itself never moves: it is still the dock's Plant and the Build
shop's Place.

## What is not implemented

First-person view, jumping, swimming, vehicles, combat, stamina, NPCs, a character gather/interact
button, and multiplayer avatar sync. The character model is unchanged: this pass is camera and
controller, not art.
