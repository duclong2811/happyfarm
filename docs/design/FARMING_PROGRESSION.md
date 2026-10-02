# Farming progression: experience, levels, and unlocks

Status: V14.4. This is the reference for the *farming* progression layer - the experience a player
earns by farming, the levels that experience buys, and the catalogue content a level opens. Read it
before changing an experience value, the level curve, a `requiredLevel`, the harvest settlement, or
the level-up feedback.

The mechanical decisions behind the server side are recorded in
`docs/decisions/0008-player-progression-and-levelling.md` (experience and levels) and
`docs/decisions/0009-crop-unlocks-by-level.md` (planting gates). V14.4 adds unlock *discovery* -
telling the player what a level opened - recorded in
`docs/decisions/0028-progression-unlock-discovery.md`.

## The loop this layer gives a reason for

```text
buy seed -> plant -> wait -> harvest -> produce + XP -> level up -> new content unlocked
   ^                                                                        |
   +---------------------------- gold from selling --------------------------+
```

Every arrow that changes state is a server command. The client sends gameplay intent, reads back
authoritative state, and draws it.

## Who owns what

| Fact | Owner | Never |
| --- | --- | --- |
| Experience amount per harvest | game data (`packages/game-data`) | a client, a UI constant |
| Experience total | `player_progression` row, written only by the harvest settlement | a request body |
| Level | derived from experience by `packages/domain/src/progression.ts` | stored as an independent value, or computed in the client |
| Planting eligibility | `PlantCrop` / `PlantTree` level gate | a disabled `<option>` |
| Newly unlocked content | a diff of the served catalogue | a hardcoded `if level == 3` |

The server owns experience, level, and eligibility. The client owns none of them; it may only
describe them.

## Experience sources (V14.4)

Experience comes from **completed productive farming actions** only:

| Source | Pays XP | Why |
| --- | --- | --- |
| Harvest a mature crop | `CropDefinition.harvest.xp` | the crop is consumed; the action is the activity |
| Harvest a ready production tree | `TreeDefinition.harvest.xp` | one repeating cycle, one reward |

Deliberately **no** XP for opening panels, buying seeds, selling produce, moving or rotating objects,
inspecting, logging in, refreshing, or planting and immediately uprooting. XP must represent
completed work and must not offer a spam loop.

Land expansion is *not* an XP source today. It is a gold sink with its own plot-level requirement
(`docs/decisions/0010-farm-expansion.md`); adding an experience award there would be a second place
experience is created, and the layer does not need one.

### Offline maturity is not offline XP

Crops and trees mature while the player is away, but **nothing is awarded for time passing**. XP is
paid when the authoritative harvest happens. The sequence is:

```text
plant -> logout -> crop matures -> login -> harvest -> XP
```

No polling tick, no maturity read, and no login grants experience. A ready tree that sat overnight is
worth exactly one harvest, and one harvest's experience.

## XP values

Values are game data, chosen against the current growth and economy data, and are deliberately
deterministic. They track *growth duration relative to the carrot*, which is the shortest and
cheapest crop:

| Definition | Growth | Harvest XP | Rationale |
| --- | --- | --- | --- |
| `crop_carrot` | 300 s | 4 | the baseline: fast, cheap, low |
| `crop_wheat` | 900 s (3x) | 12 | 3x the carrot's XP for 3x the wait |
| `crop_corn` | 1800 s (6x) | 24 | 6x the carrot's XP for 6x the wait |
| `tree_apple` | 3600 s first, 900 s regrow | 10 / cycle | slightly below a wheat harvest: the tree's value is the repeating gold from one sapling, not the experience |

A tree pays less per cycle than a crop of the same cycle length because a tree is *capital* - one
sapling keeps producing - while experience rewards the harvest action, not the capital.

Retuning any value is a game-data change and nothing else; no use case knows these numbers.

## Level curve

`packages/game-data/src/progression/index.ts`: `maxLevel: 50`, `xpStep: 120`. Reaching level `n + 1`
from `n` costs `n * xpStep`, so the total to reach level `L` is the triangular number
`xpStep * (L - 1) * L / 2`.

| Level | Total XP | From the previous level |
| --- | --- | --- |
| 1 | 0 | - |
| 2 | 120 | 120 |
| 3 | 360 | 240 |
| 4 | 720 | 360 |
| ... | ... | ... |
| 50 | 147,000 | - |

Early levels arrive quickly, later levels take progressively more activity, and the level-50 cap
stops promising a next level. The arithmetic lives in `packages/domain/src/progression.ts`
(`cumulativeXpForLevel`, `levelForXp`, `levelProgress`); the level is a cache of `levelForXp(xp)` and
`assertProgression` refuses a row where the two disagree.

## Current farming unlock ladder

Unlocks are **explicit game data**, not a derived formula: the field is reviewable in one diff and a
designer can find it.

| Level | Unlocked |
| --- | --- |
| 1 | Carrot (`crop_carrot` - no `requiredLevel`, so the starting crop) |
| 2 | Wheat (`crop_wheat`) |
| 3 | Corn (`crop_corn`) and Apple Tree (`tree_apple`) |

Game-data validation (`tests/game-data/schema.test.ts`) keeps this sane: a requirement is a positive
whole number inside the level ceiling, and exactly one crop is available at level 1 so a new player
is never stuck.

## Harvest settlement: experience is part of the harvest

There is no "award experience" endpoint. Experience is written by the same D1 batch as the harvest:

```text
authenticate -> authorize (OWNER) -> load crop/tree -> server-time readiness
  -> compute the award from the stored experience (absolute after-values + expected version)
  -> atomically: produce added, crop deleted / tree cycle advanced, XP row written, receipt written
```

The stored receipt is the command result, so a replay returns the original award instead of
recomputing one. Progression is guarded on the revision the caller *read*; a lost race rolls the
whole batch back and retries. The result is that a harvest can never pay produce twice or XP twice,
and the two can never be split across a partial settlement.

### Replay and concurrency guarantees

- A replayed `requestId` returns the stored response, unchanged, including the original
  `xpAwarded`, `leveledUp`, and after-progression.
- Two concurrent harvests of the same mature crop/tree settle exactly one; the loser retries, sees
  the crop gone (or the tree's cycle advanced), and reports the honest failure.
- A campaign cross of several thresholds from one award is safe: the level is derived from the
  after-total, not incremented once.

## Market semantics: buy ahead, plant when you qualify

The market shows a planting requirement (`market.plantingLevel`: "Requires level N to plant") and
**buys the seed anyway**. That is the intended rule: a player may prepare and hold a seed, but the
server refuses to plant it until they are eligible (`CROP_LEVEL_REQUIRED`, 403). The note is not a
disabled state the server would contradict - it is accurate, and it updates live when the level
changes because the market re-renders from refreshed state.

## Plant Picker semantics

Every planting option is one of three groups, derived from the served catalogue and the current
level (`apps/web/src/items/catalogue.ts`):

| Group | Meaning |
| --- | --- |
| `AVAILABLE` | unlocked and the player holds at least one seed/sapling |
| `NO_SEEDS` | unlocked, but no seed in the inventory |
| `LOCKED` | below the option's `requiredLevel` |

On level-up a `LOCKED` option becomes `NO_SEEDS` or `AVAILABLE` on the next render, with no reload.
The picker holds no crop list of its own; it is rebuilt from the catalogue the server sent.

## Unlock discovery (V14.4)

When a harvest raises the level, the page shows a short banner: the level reached, and the catalogue
content that became newly eligible (`apps/web/src/unlocks.ts` -> `#level-up` in `apps/web/index.html`).

The "newly unlocked" set is a **diff over the served catalogue**: an entry is news when its
requirement is satisfied at the new level and was not satisfied at the level shown before the
action. It is not a hardcoded level-to-crop table, and it already covers crops, trees, and build
catalogue entries through one requirement shape. The level the diff uses is the server's; the page
only compares. Nothing here is authority - the planting gate is.

Performance: the diff runs once per level-up, over the in-memory catalogue already loaded. It is not
per frame, not polled, and not a second source of truth.

## Player-scoped progression

`player_progression` is keyed by `player_id` (`database/migrations/0005_player_progression.sql`), a
foreign key to `players`, with no farm column. **Progression belongs to the player**, not to a farm
or a home island, which is what the future world needs: a player may later own several islands and
their farming level follows them. V14.4 adds no farm-scoped progression and makes no schema change.

## Building requirement compatibility

Build catalogue entries already carry `requiredLevel`, and the build shop reads it through the same
"a level is a comparison" rule. The unlock diff above includes them, so a level that unlocks a
building is announced like a crop. There is deliberately no separate building progression system in
this phase: buildings are not placeable through a server command yet, so nothing enforces their
level but the client's own presentation.

## Performance characteristics

- No per-frame XP check, unlock scan, or catalogue reconstruction.
- XP and level update on a harvest response; the HUD re-renders from state.
- Unlock discovery runs once per level change, over in-memory data.
- No API polling was added for progression; the existing farm poll is unchanged.

## Future world compatibility boundary

The requirement model is intentionally a shape (`{ level }` on the client, `meetsRequiredLevel` in
the domain) rather than "a bare number is the only rule that can ever exist". A future region, zone,
biome, resource, or profession requirement is another field, not a second evaluator. V14.4 does
**not** add regions, biomes, island archetypes, or world coordinates, and does not implement
starter-island selection.

## Deliberately absent

Fishing, mining, forestry, boats, world map, regions, NPC quests, PvP, multiplayer economy, and
dynamic market prices are out of scope. So are experience for land expansion, temporary or
consumable unlocks, and any second way to award experience.
