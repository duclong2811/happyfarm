# ADR 0028: Unlock discovery from the served catalogue

Status: Accepted

## Problem

Phase 4A/4B made level authoritative and made it gate planting, and Phase 6 gave trees the same
treatment. But a level-up only produced a status line saying which level was reached. Nothing told
the player *what it opened*, which is the whole point of a progression layer: the reward for the
harvest is not the number, it is the new thing the number lets them do.

Three questions needed deciding: where the "newly unlocked" set is computed, what it is computed
from, and how the level-up feedback shows it without inventing a second source of truth.

## Decisions

### Unlock discovery is a diff over the served catalogue, not a table

`apps/web/src/unlocks.ts` builds a `UnlockNotice` for every catalogue entry whose requirement is
satisfied at the new level and was not satisfied at the previous level. The catalogues are the ones
the server already serves - `CropDefinitionDTO`, `TreeDefinitionDTO`, and `BuildCatalogEntryDTO`, each
carrying the `requiredLevel` the server enforces.

A hardcoded `if (level == 3) show("Wheat")` would have been shorter and would have drifted the first
time a designer retuned a requirement. The diff cannot drift: a crop unlocked at level 7 is news at
level 7 because game data says so, with no client change.

### The requirement is a shape, not a level

Each candidate carries an `UnlockRequirement` - today `{ level }` - and one local `meetsRequirement`
interprets it. The future world (a region, a zone, a biome, a profession) is another field on that
object and the same diff keeps working. V14.4 implements none of those; it only avoids a rule that
can never be anything but `level >= N`.

This deliberately does *not* duplicate the server's evaluator. The domain keeps one rule
(`meetsRequiredLevel`, shared by `isCropUnlocked`, `isTreeUnlocked`, and `isPlotUnlocked`); the
client's comparison is presentation, over catalogue rows the server sent, and it is not a security
boundary in any direction. A notice can only ever describe a state the planting gate already
enforces.

### The diff base is the authoritative level read before the action

The page captures `state.progression.level` immediately before it sends the harvest and diffs against
the level the award reports. Both levels came from the server; the page recomputes no level and
reimplements no curve.

The alternative - adding `previousLevel` to the harvest award DTO - was rejected. The award is also
the stored idempotency receipt and the replay payload, so a new required field would either strand an
in-flight receipt written before the deployment (`assertStoredXpAward` would refuse it) or force a
tolerant "sometimes absent" field the contract exists to forbid. The existing DTO already carries
`leveledUp` and the full after-progression, which is what the brief asks for; the one value it lacks
is available for free in the page's own last authoritative read.

### The feedback is one reusable element

`#level-up` is a single transient banner - the level, then the names of what it opened. It reuses the
reward-pop pattern (one element, a restartable animation class, a timer the stylesheet's duration is
checked against) and replaces no existing surface. The names come from the catalogue's own display
keys through the existing translation layer, so an untranslated definition shows its fallback rather
than disappearing.

## Consequences

- A level-up now says what it unlocked, for crops, trees, and buildings, from one rule and one
  element.
- No wire contract changed; the replays of receipts written before this deployment keep working.
- If another harvest lands between the page's read and its own, the announced set can be larger than
  this one action strictly caused. The announced set is never *wrong about the state*: the picker and
  the market derive their real lock state from the refreshed level, which is authoritative. The cost
  of the alternative (a required receipt field) was judged higher than the cosmetic imprecision of a
  rare concurrent award.
- `docs/design/FARMING_PROGRESSION.md` is the player-facing reference; this ADR is the decision.
