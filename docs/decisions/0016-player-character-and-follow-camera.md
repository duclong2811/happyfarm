# 0016 - Player character, collision, and follow camera

Status: implemented (client only); manual browser pass pending.
Phase: 7 (`7B.7`), the character phase ADR 0015 prepared the world for.

## Context

ADR 0015 fixed the world's coordinates and left three things explicitly for the phase that follows:
a spawn point, a walkability query, and a fixed origin that means the same thing tomorrow as today.
Until now the farm was a place you looked at. Nothing in it stood anywhere, so a crop could be
planted where the camera was pointing but no one was there to plant it.

This phase puts a body in the world. It is presentation only: the server still owns every rule, and
nothing about the character is stored, sent, or read back.

## Decisions

### The character is client-local and non-authoritative

There is no new table, no route, no contract field, and no presence channel. The server never learns
where the character is, and no game rule consults it. A tampered position can therefore do exactly
one thing: move the local avatar. This is deliberate; multiplayer positions belong to the FarmRoom
phase (roadmap 11), where they gain an authority the client cannot have today.

### Movement is four pure modules, and the renderer copies a pose

`apps/web/src/player/` holds the whole of it and imports no three, no DOM, and no clock:

- `input.ts` turns key events into one un-normalised intent vector.
- `controller.ts` turns an intent, a delta, and a collision query into the next `PlayerState`.
- `collision.ts` answers the one question the controller asks: how deep is the world at this point?
- `runtime.ts` owns the character's lifetime: start, stop, respawn, the collision world, and the
  single outstanding frame. The browser supplies the frame source and the keyboard; nothing else
  decides when a frame runs.

The renderer knows none of this. It receives a `FarmScenePlayer` pose and copies it onto a group
transform. Because the modules are pure, movement is tested without a canvas, and because the
renderer only reads a pose, it cannot decide anything about where the player is allowed to go.

### Time is seconds, clamped, and never a frame count

Frame-rate independence comes from doing everything in seconds. An abnormal delta - a restored tab,
a stalled frame - is clamped to `MAX_FRAME_DELTA_SECONDS` (50 ms) and split into bounded substeps, so
a long gap cannot teleport the character through an obstacle.

### Collision is the static world plus the farm's own rows

Four sources:

1. The island shore, as an ellipse, so the character stays on the island without a tile-grid clamp.
2. The static obstacles `world-config.ts` already declares - the pond and the farmhouse yard.
3. The fence, from the same `fenceGeometry(FENCE)` the renderer draws.
4. The farm's own rows: a crop or a tree blocks a circle at its tile centre, and terrain that is
   neither soil nor grass blocks its whole tile.

Walking is presentation, so nothing here asks who owns a tile or whether a farming action would be
allowed on it. Locked land is not in the list at all: the only farm rows consulted are the ones that
physically occupy ground. Movement authority and planting authority stay separate.

**Planted things block as circles, not as whole tiles.** A planted row must not be a solid wall, and
at the shipped 1.08 tile pitch a full-tile block would leave 0.08 of clearance - less than the
player's 0.56 diameter, so a field would be impassable. A crop blocks radius 0.22 and a tree radius
0.34 around its centre, against a player radius of 0.28. That makes a row of crops a gap the player
can thread (1.08 - 0.44 = 0.64 of ground for a 0.56 body) and a row of trees a wall, which is the
difference between the two plants. The margin on crops is tight by design; if the manual pass finds
it too tight, the crop radius is the one number to move.

Blocking is depth-based rather than boolean, which is what makes the controller's rule work: a
character already overlapping an obstacle - a crop planted where they happen to stand - may step out
but never deeper in. The same numbers make sliding along a wall work, because each axis is tried on
its own when the full step is refused.

### The fence is one description, drawn and walked

The first pass left the fence out of collision, because the drawn fence and `FENCE.gates` disagreed:
the drawing put its two side gaps in the middle of the east and west runs, and centred the whole
rectangle on the world origin, while the config describes a rectangle around the whole field with a
gap in the middle of the south run and gaps near the ranch and the pond paths.

That is now one derivation. `fenceGeometry()` in `world-config.ts` reads `FENCE.bounds` and
`FENCE.gates` and returns the fence's centre, its half extents, and the closed segments between its
gates. `terrain.ts` draws posts and rails along exactly those segments and nothing else; the
player's collision turns exactly those segments into blockers. Neither side owns a gate number, so a
gate that is drawn open is a gate that can be walked through, and a segment that is drawn solid
stops the player.

Two consequences are worth naming, because the old drawing hid them. The fence and the dirt apron
are now centred on the middle of `FENCE.bounds` - the middle of the field the catalogue can hand out
- instead of on the world origin, which is also where the camera already framed the island. And the
south gate lands exactly on the spawn's line, so the first thing a player does is walk north from
the spawn, through the gate, and into the field.

### The camera follows the character, and stops panning

The island view is framed to `worldExtent`; an avatar at that distance would be a few pixels. While a
character is drawn the camera targets the character and pulls the framing extent in to
`FOLLOW_FRAME_EXTENT`, which is only a smaller number in the same distance formula. Wheel zoom and
the camera's fixed three-quarter direction are unchanged, so the view stays the same kind of view.

The follow is synchronous: each frame the camera target is set to the character's position. There is
no smoothing and therefore no camera motion left to finish after the loop sleeps, which is what lets
the loop stop the moment the keys are released.

Panning is disabled while a character exists, because a drag would otherwise fight the follow. The
drag is still tracked, so a drag never becomes a tile selection; it simply does not move the camera.

### Rendering is still on demand

There is no permanent render loop. Movement input reports when it starts and stops being active, and
the loop runs only while a key is held: it draws a step, then schedules the next frame, and stops as
soon as the keys are released. An idle farm costs nothing extra, which keeps the renderer's existing
"draw when state changes" contract.

## Consequences

- **No migration, no contract, no server change.** Land, crops, trees, inventory, and economy are
  untouched; this is a projection of state the page already had.
- **The security review is not triggered.** Nothing here touches authentication, authorization,
  persistence, economy, inventory, multiplayer, or rewards, and the position it holds is explicitly
  worthless to an attacker.
- **The spawn is fixed and testable.** `SPAWN_WORLD` comes from the fixed frame, and
  `tests/web/player-collision.test.ts` asserts the spawn is free even on an empty farm, so a future
  world change that buried the spawn under the sea would fail loudly.
- **The walk is a placeholder.** Primitive limbs, a bob, and a yaw, with no animation rig. Art
  replaces the look in roadmap 14 without touching the controller.
- **The drawn fence and the collision fence are the same segments.** A gate the renderer draws open
  is passable, and every segment it draws is solid; the collision world never consults a second
  geometry.
- **Known gap: the fence overlaps the next ring of locked land.** A fence around the field and a
  locked ring that starts on the tile next to it cannot both be true at the same time. It is
  cosmetic - locked squares are ground, and the fence is drawn over their edge - and map polish is
  deliberately out of scope for this phase.
- **Known gap: the crop clearance is tight.** 0.64 of ground against a 0.56 body means threading a
  planted row is possible but fiddly. It is a feel question for the manual pass, not a correctness
  one.
