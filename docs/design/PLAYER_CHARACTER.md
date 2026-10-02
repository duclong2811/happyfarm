# The player character

Status: how the player is drawn, and the line between what they *are* and what they *look like*. Read
this before touching the avatar, its animation, or the asset it comes from.

> **The player character model is a replaceable presentation asset.**
>
> It is never the authority for movement, position, terrain following, collision, camera mode or world
> state. The player runtime remains authoritative; this layer only draws it.

## The separation

```text
CharacterMoveIntent            (player/character-input.ts)
        |
        v
stepPlayer + PlayerRuntime     (player/controller.ts, player/runtime.ts)  <- authoritative
        |
        v
PlayerState {x, y, z, facingYaw, movementState, ...}
        |
        v
FarmScenePlayer                (render/scene.ts)   <- a pose, nothing more
        |
        v
PlayerCharacterView            (render/player-character.ts)
        |
        v
GLTF model + AnimationMixer
```

Everything above `PlayerCharacterView` is gameplay; everything below it is presentation. The view
*reads* the pose and never returns anything, which is why replacing the model cannot change how the
player works: there is no path from the mesh back into a gameplay number.

Two consequences worth stating explicitly:

* **The model is not the collision shape.** Collision is the circle in `player/collision.ts`, unchanged
  by this pass and by any future character art. A detailed bounding box is never consulted.
* **The model is not the position.** The character's feet are placed by the runtime (terrain height,
  slope guard, coast), and the view copies that Y. The view's own bounding-box maths adjusts where the
  *model* sits inside that position - it never moves the player.

## The asset configuration

One object, `PLAYER_CHARACTER_ASSET`, holds everything asset-specific:

| Field | What it is |
| --- | --- |
| `id` | A name for logs and reports: which pack and which model. |
| `modelId` | The id the model library resolves to a file (`character-model-urls.ts`). |
| `targetHeightWorld` | The height the character is drawn at - the world's 1.6 m. |
| `scale` | An explicit visual scale, or `null` to derive one from the loaded model. |
| `rotationOffsetY` | The facing correction, in radians. |
| `groundOffsetWorld` | Extra lift after the feet are put on the ground. |
| `animations` | Which clip means idle, walk and run. `null` when the asset has none. |
| `runFallbackRate` | How much faster the walk clip plays when there is no run clip. |
| `crossFadeSeconds` | How long a change of state takes to blend. |

Nothing else in the project names a character file, a clip name, or a scale factor.

## Scale and grounding

The imported model is not normalised - it is a skinned mesh, and rewriting its geometry would tear the
skeleton apart (see `docs/assets/PLAYER_CHARACTER_ASSET.md`). Instead, at load:

1. the model's bounding box is measured (`Box3.setFromObject`);
2. `characterVisualScale` returns `targetHeight / measuredHeight`, or the config's explicit scale;
3. `characterModelOffset` centres the model over the player and puts its lowest point on the ground;
4. the model is scaled and offset once - never per frame.

So a replacement of any native size is drawn at the world's character size, with its feet on the
ground, without anybody measuring anything by hand. A model with a degenerate (zero-height) box is
left at scale 1 rather than dividing by zero and hiding the player.

## Facing

The game's convention is that a character model faces its local **+Z**; the controller's `facingYaw`
is `atan2(direction.x, direction.z)`, and the view draws the model at
`facingYaw + rotationOffsetY`. The correction exists because imported models are authored facing
whatever their creator's exporter chose, and it must never be solved by changing the movement maths:
the character walks where the controller says, and the mesh is turned to match.

The shipped Kenney model is authored facing +Z, so its correction is 0. This is the one value in the
configuration that a visual check may need to flip (`Math.PI`).

## Animation

Gameplay owns the *speed*; animation only represents it. The state machine is three semantic states,
derived from the pose:

```text
movementState IDLE                  -> IDLE
movementState WALKING               -> WALK
movementState WALKING + running     -> RUN
```

* The mapping from state to clip is configuration, not code: `resolveCharacterClip` looks up
  `animations.idle/walk/run` and checks the clip actually exists in the loaded file.
* **A missing clip falls back rather than failing.** No run clip means the walk clip at
  `runFallbackRate` (which is what a run is, at this fidelity); no walk clip means idle; nothing usable
  means no instruction at all, so whatever is playing keeps playing. The gameplay run *speed* is never
  touched by any of this.
* **Cross-fades happen only when the semantic state changes.** `characterAnimationChange` returns
  `null` for an unchanged state, so there is nothing for the caller to do and a clip cannot be
  restarted every frame. A change blends over `crossFadeSeconds` (0.2 s).
* Actions are created lazily, one per clip actually played: the shipped pack has 32 clips and this
  character uses three.
* The mixer is updated with the delta between player frames, clamped, and only while the character is
  on screen - the same lifecycle the player runtime already had.

### Future farming animations

The pack already carries clips for the semantic states a farming pass will ask for: `pick-up`,
`interact-left`/`interact-right`, `holding-left`/`holding-right`/`holding-both`, and the
`attack-melee`/`attack-kick` family for tools. The rule for that pass is already in place: gameplay
systems should request a **semantic action** (`HARVEST`, `PLANT`, `WATER`, `DIG`, `CARRY`, `FISH`)
and the character config decides which clip that is - never `play("Armature|Animation_047")`.

## The fallback

If the model cannot be loaded - a 404, a broken file, no decoder - the view keeps drawing the old
procedural avatar and reports the problem through `onAssetProblem`, naming the asset and saying that
the placeholder is active. A failed asset request must never leave the player invisible, and the
fallback is also what the estate view drew before this pass, so nothing about the rest of the game
changes when it is in use.

There is never a moment with two characters on screen: the fallback is hidden the instant the model
is in the scene graph, and it is the *same group* the view points at for the life of the scene (the
scene may rebuild its contents when a generated model lands; the view only decides which is visible).

## Performance

The model is loaded once and reused for the life of the scene - not on a farm refresh, not on a camera
mode change, not per instance. One `AnimationMixer` and (at most) three actions exist. The mesh is
traversed once, at load, to configure shadows. Per frame the cost is one mixer update and a handful of
vector writes; there is no traversal, no allocation proportional to the scene, no skeleton cloning, no
world rebuild and no API call.

## Future customisation

Not built in this pass, and nothing here prevents it. The shape a character-creator pass wants is:

```text
Base body (this config)  +  hair  +  outfit  +  hat/accessory  +  animation set
```

The extension points are already in the right places: the model id is one manifest entry, the clip
names are one config object, and the scale/orientation/grounding corrections are per-asset values. A
future pass adds a *part* vocabulary (bone-attached meshes, driven by the same skeleton) behind the
same `PlayerCharacterView`, and the controller, the camera, the collision and the world never hear
about it.

## What is not in this pass

No character creator, no body/outfit variants, no farming interactions, no root motion (the mesh never
drives the position), no IK, and no per-bone camera target: the third-person camera still aims at the
character's *height* rather than at a named bone, exactly as V13.4 left it.
