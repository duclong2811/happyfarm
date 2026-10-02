# Character interaction: discovery, intent, execution

Status: implemented in V14.1 for two actions - `INSPECT` and `HARVEST` - on crops, production trees and
built things. Read this before adding an action, changing what is "in reach", or wiring a new kind of
target into character view.

> **Discovery looks; execution acts.** Nothing that finds a target may change the world, and nothing
> that changes the world may go looking for targets of its own.

## Why a framework, when one button would do

Character view used to be walking and looking, and the first thing that makes it *gameplay* is being
able to use what you walk up to. The tempting version of that is a `harvestNearestCrop()` function -
and it is a dead end, because the second thing a player walks up to will not be a crop with the same
command behind it:

```text
crop          -> Harvest
production tree -> Harvest
fishing spot  -> Fish          (future)
rock          -> Mine          (future)
forest        -> Chop          (future)
NPC           -> Talk          (future)
chest / door  -> Open / Enter  (future)
```

So V14.1 fixes the *shape* and implements the cheapest real case. A future action adds a `kind` to an
adapter and a case to an executor; it does not change how the prompt is drawn, how proximity works, or
who is allowed to do what.

## The pipeline

```text
read models (crops, trees, constructions)
        |                          adapters, pure
        v
   InteractableTarget[]            one shape, many families
        |                          bucketed by cell, rebuilt on data change only
        v
   InteractionIndex                "what is on the island"
        |                          bounded neighbourhood query
        v
   InteractionCandidate            "what is in reach right now"
        |                          one calculation, two consumers
        +--> keyboard prompt  [E] Harvest Spinach
        +--> touch button     [ Harvest ]
        |
        |  activation re-asks discovery with fresh data
        v
   InteractionActivation           HARVEST_CROP | HARVEST_TREE | INSPECT | STALE
        |
        v
   existing server-authoritative command (harvest) or the existing selection surface (inspect)
```

## Where the code lives

| Concern | File |
| --- | --- |
| Vocabulary, ranges, priorities, candidate shape | `apps/web/src/interaction/model.ts` |
| Adapters and the cell-bucketed index | `apps/web/src/interaction/registry.ts` |
| Choice, revalidation, the `E` key rule | `apps/web/src/interaction/selection.ts` |
| Player vs place | `apps/web/src/interaction/context.ts` |
| HUD state, activation, the two surfaces | `apps/web/src/main.ts` (`renderInteraction`, `runInteraction`) |
| Markup | `apps/web/index.html` (`#interaction-prompt`, `#interact-button`) |
| The `E` arbitration with the camera | `apps/web/src/render/scene.ts` (`onInteractionKeyRequested`) |
| Contracts | `packages/contracts` (`ZoneKind`, `ZoneRef`, `homeIslandZoneRef`) |

## Discovery

Discovery answers "what could the player use if they were standing here?", and it is *pure*: adapters
read rows the page already holds, produce `InteractableTarget`s, and mutate nothing. There is no
network call, no clock (a `nowMs` is passed in so a countdown is testable), and no renderer.

**Target sources.** One adapter per family, each reading its own domain model: a crop row stays a crop
row, a production tree stays a production tree, a built thing stays a construction. The interaction
layer adapts them into one shape and never merges them into one table - the repository has already made
the mistake of a generic world object once, and the answer then was the same as now: adapt, do not
collapse.

Maturity and readiness come from the server's own flags (`crop.mature`, `tree.ready`), never from a mesh
variant and never from a client clock.

**Which built things count.** A player-placed object always does; a starter object does when it occupies
more than one cell (a barn, the mill, an authored landmark). Single-cell island scenery does not: the
island ships several hundred such rows, and narrating each one would leave a prompt on the screen
permanently, which is exactly the "never reserve space for nothing" rule the mobile pass established.
That scenery is still selectable in Estate view, where selection *is* the interaction.

## Range

One table, by kind, in `INTERACTION_RANGE_WORLD`:

| Kind | Range | Why |
| --- | --- | --- |
| `CROP` | 2.6 m | about "standing at the edge of the next tile" (a tile is ~1.08 m) |
| `TREE` | 2.8 m | the trunk is the anchor, and the canopy is wider than the player |
| `WORLD_OBJECT` | 3.6 m | a barn's anchor is inside it, so reach has to clear its wall |

Deliberately generous, because this is a farming game read through a third-person camera on a phone,
not a first-person shooter: the player stands *near* a thing and uses it. Out of range is not a
low-priority target - it is not a target at all.

The server never trusts the client's range, but it also does not need to know about metres: it checks
ownership, state, maturity and idempotency, which is what actually decides whether an action happens.

## Candidate priority

In order, and deterministic:

1. **The more useful action wins** (`INTERACTION_ACTION_PRIORITY`: harvest 2, inspect 1). A mature crop
   beats a landmark the player is standing beside.
2. **Otherwise the nearer target wins** - unless the two are within
   `INTERACTION_FACING_TOLERANCE_WORLD` (0.5 m), in which case the one the character is facing wins.
   That is the whole of the "broad facing preference": forgiving, and never a reason to refuse a
   clearly closer target.
3. **Otherwise the lower key wins**, and keys are derived from server ids - so array order and render
   order can never decide a gameplay question.

Facing is a *preference*, never a filter. There is no crosshair, no aim requirement, and no failure
mode for "you were not looking at it".

## Update frequency, and why

The island already holds several hundred scenery rows and will grow, so nothing here scans the world:

* the **index** is rebuilt only when the read models change (a farm refresh, a planting, a stored
  object) - the same place the renderer's own state is pushed;
* the **query** walks the cell neighbourhood around the player: `interactionSearchRadiusCells()` is
  derived from the ranges and the tile pitch, so widening a range cannot silently make an in-range
  target unreachable, and a bigger island costs exactly the same;
* the **candidate** is re-decided on the character's pose stream, which only ticks while they move,
  and the HUD is written only when the candidate's signature changes.

There is no new animation loop, no per-frame DOM work, and no API request while merely looking around.
`tests/web/interaction-input.test.ts` pins the parts of that which are properties of the source.

## Intent and execution

Activation re-asks discovery with the player's *current* position and compares the result with the
candidate the button was drawn for:

```text
same target, harvestable -> HARVEST_CROP / HARVEST_TREE  (the existing command, unchanged)
same target, not ready   -> INSPECT                      (the existing selection surface)
different target         -> STALE                        ("nothing in reach - move closer")
nothing in reach         -> STALE
```

A stale candidate activates nothing: the prompt simply updates. This is the client half of the range
race - the player may walk away between the prompt appearing and the button being pressed - and the
server's half is that it re-checks everything anyway.

The harvest path is the *existing* server-authoritative command, end to end:

```text
candidate -> existing request id + expected version -> POST /farms/:farmId/crops/:id/harvest
          -> server authorizes the actor, checks ownership, maturity, idempotency and concurrency
          -> inventory settles once, crop lifecycle advances -> the page refreshes from the server
```

Nothing about settlement is duplicated, and no client-only harvest exists. `INSPECT` sends nothing at
all: it selects the target so the existing info surface shows the authoritative rows.

## Desktop input

One compact prompt, `[E] Harvest Spinach`, drawn only while something is in reach. `E` is
context-sensitive on purpose: it is already the character camera's orbit-right key, so with something
in reach it acts, and with nothing in reach the camera keeps the key. `E` never fires while a text
field has focus, while a panel is open, while something is in hand for placement, or in estate view -
where it still turns the item in hand. The rule is one pure function
(`interactionKeyRequested`), asked by the renderer rather than assumed by two handlers.

## Mobile input

A real button above Run, drawn only while something is in reach, carrying the same action word. It
lives inside `#touch-controls`, which is what makes it safe: a tap on it is a DOM event on the button,
so the canvas never sees the pointer - the camera cannot rotate from it and the ground cannot be
selected from it. It is at least `--touch-target` (44 px), it never overlaps Run, the joystick or the
selection strip, and it disappears the moment the target does.

Desktop and touch run *the same* intent: one candidate, one activation rule, two ways to press it.

## Stale targets, stored objects, mode switches

* A target that leaves range, is harvested, is stored or is removed is gone from the index, so the
  prompt and the button vanish with it (`renderInteraction` compares signatures, so this is one DOM
  write, not a poll).
* Switching to Estate clears the candidate immediately: the interaction surfaces belong to character
  view, and a stale button must never survive a mode change.
* A destroyed or stored object cannot be interacted with because it is no longer a row the adapters
  read at all.

## Zone awareness

The client keeps a `GameplayContext` - the player, and the zone they are in - and today the zone is
derived from the farm (`homeIslandZoneRef`). The interaction code asks the context rather than assuming
"the player's farm", which is what makes a shared zone a change of authorization rules rather than a
rewrite of discovery.

The execution path deliberately does **not** assume farm ownership. Today the harvest command is
authorized by ownership because the only zone that exists is a home island; a shared zone will
authorize on presence, zone rules and resource state, and the executor does not care which.

## Adding a future action

1. Add the action to `InteractionAction` and its priority to `INTERACTION_ACTION_PRIORITY`.
2. Teach the adapter that produces it (a fishing spot adapter, a rock adapter) to emit that action, its
   range and its anchor.
3. Add the case to `interactionActivation` and an executor branch that calls the server-authoritative
   command for it.
4. Add the localized action word, and nothing else in the HUD changes.

Do not: invent a client-side effect, add an action with no handler, or make discovery mutate anything.

## The beat: what a harvest looks and feels like (V14.2)

The interaction was already server-authoritative in V14.1; V14.2 gave it a shape a player can read.
Four things happen, in this order, and the order is the rule:

1. **The press is accepted locally** - the candidate is re-asked, and a stale one activates nothing.
2. **The command goes out immediately.** Nothing waits for an animation: the gesture starts *with* the
   press, and a failure simply pays nothing (no fake reward, no optimistic inventory).
3. **The server answers**, and the page refreshes from it - inventory, crops and the interaction
   registry all come from the same rows.
4. **The feedback lands**: the character bows for 320 ms (`harvestGestureBend`, a procedural gesture
   because this asset ships no harvest clip), the world loses the crop it settled, and the server's own
   `quantityAdded` rises from the tile it came from as `+2 Carrot` with the item's cached thumbnail.

Two rules keep it honest and cheap:

* **One press is one command.** A held key is ignored (`repeat` in `interactionKeyRequested`) and a
  second press while a command is in flight does nothing, so a player cannot machine-gun the server
  from a keyboard or a thumb.
* **The next target is discovered, not remembered.** Because the registry is rebuilt from the rows the
  server sends back, the crop beside the one just harvested becomes the candidate for free - pressing
  again picks it up. There is no field sweep, no auto-harvest and no queue: the player still walks.

The presentation half of this - the card language, the reward pop, the ready mark - is
`docs/design/ITEM_PRESENTATION.md`.
