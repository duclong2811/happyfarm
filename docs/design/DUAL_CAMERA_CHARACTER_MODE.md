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
* **Ground click-to-move is off in character view.** The character is steered with the movement keys,
  and a stray click setting up a walk would fight them.

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

## What is not implemented

Mobile input (a joystick and a touch camera, which will feed the same intent and the same rig),
first-person view, jumping, swimming, vehicles, combat, stamina, NPCs, and multiplayer avatar sync.
The character model is unchanged: this pass is camera and controller, not art.
