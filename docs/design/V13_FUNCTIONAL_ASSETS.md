# V13: functional assets

Status: the contract every buildable thing is held to. Read before adding an entry to the catalogue.

## The distinction V12 blurred

A decorative broadleaf tree and a timber plantation are both "a tree" to a renderer and completely
different things to a player. V13 makes that difference data rather than prose:
`packages/game-data/src/placement/gameplay.ts` declares, for every shipped entry, a
**classification**, a **status**, and **structured effects**.

* `GAMEPLAY_CLASSIFICATIONS`: `COSMETIC`, `PRODUCTION`, `STORAGE`, `INFRASTRUCTURE`,
  `WORKER_CAPACITY`, `PROCESSING`, `UTILITY`.
* `GAMEPLAY_STATUSES`: `ACTIVE`, `FOUNDATION_ONLY`, `PREVIEW_ONLY`.
* Effects: `production` (output, yield range, cycle, input, capability, worker role), `storage`
  (capacity per resource), `movement` (multiplier), and `workerTask` (what a future worker would do).

## What ACTIVE means

An effect is `ACTIVE` only when authoritative data defines it, the server uses it, gameplay reflects
it, and a test proves it. Everything else is `FOUNDATION_ONLY` (real, defined, persisted object whose
effect does not run yet) or `PREVIEW_ONLY` (cannot be built at all). The shop prints the status, so a
player is never told a warehouse holds more than the game enforces.

## How the shop reads it

The inspector's **What it does** section is built from this metadata and nothing else: the
classification line, the stats (yield per harvest, growth time, storage capacity, movement, worker),
and the status sentence. Cosmetic assets say "decoration only" and carry no invented numbers.

## The matrix

The catalogue currently ships 35 entries: four roads, ten plantings, two fences, nine decorations,
one light, two utility, one waterfront cage and eight buildings (a three-tier barn ladder, a coop,
an open barn, a silo, a silo house and a windmill).

| Function | Assets | Status |
| --- | --- | --- |
| Decoration | every planting, fence, decoration, light, utility prop, the fish cage | ACTIVE (built and drawn; no gameplay effect) |
| Roads | dirt, gravel, stone, paved | PREVIEW_ONLY (movement multiplier declared, not applied) |
| Storage | three barns, open barn, silo, silo house | FOUNDATION_ONLY (capacity declared, not enforced) |
| Production | chicken coop, windmill | FOUNDATION_ONLY (cycle declared, not simulated) |
| Verified production loop | the existing crop cycle (carrot, wheat, corn) | ACTIVE: plant, grow, harvest, produce, sell |

The verified production loop is the *farming* system the game already had; V13 does not replace it and
does not pretend the construction shop's production buildings run it yet.

## The contract tests enforce

`tests/game-data/placement-gameplay.test.ts`:

* every shipped entry has a definition, and every definition names a shipped entry;
* every functional classification carries at least one structured effect;
* only a storage asset may declare capacity, and only production may declare a cycle;
* no road tier may claim `ACTIVE` movement;
* the road footprint is at least as wide as the ribbon the renderer draws.
