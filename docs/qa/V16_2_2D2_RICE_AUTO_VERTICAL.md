# V16.2.2D2 - the rice (replanting crop) Auto vertical slice

Date: 2026-10-04. Verdict: **V16_2_2D2_RICE_AUTO_VERTICAL_COMPLETE**.

D1 taught Auto to decide. D2 gives it hands:

```text
D1 CAN PLAN.      control mode, a pure resolver, a typed next action, a panel that explains it
D2 CAN ALSO ACT.  the same actor walks, loads, plants, waits, harvests, returns, unloads and replants
```

This is the first Work Skill that runs end to end. The design authority is
`docs/design/WORK_SKILLS_AND_AUTO.md`; the recording of what D2 actually did on staging is section 22.

The design's example skill is `farm.rice`. No rice crop ships in this deployment, so the slice is
implemented as the **`REPLANT_CROP` family over the shipped crop catalogue** and demonstrated with
`farm.carrot` - the starter crop, exactly as a player plants it by hand. Nothing is faked: the same
seed, the same growth clock, the same harvest, the same settlement.

## 1. Executor architecture

```text
POST /farms/:id/auto/step  { requestId }        the only request that changes anything
  -> AdvanceAuto (packages/application/src/auto-executor.ts)
       authorize (owner) + read the actor
       if a walk is under way and not yet due   -> TRAVELLING (no settlement)
       else record the arrival                  -> the actor is now there
       re-resolve the plan from current state   -> ResolveAutoPlan (the same read the panel does)
       perform ONE bounded transition           -> a walk, or one authoritative settlement
```

One step is one request, one bounded read set and at most one settlement. There is no `while`, no
server tick, no cron, no Durable Object and no per-actor timer: the browser owns frames, so the browser
asks, and the server answers with what it did or where it is walking. If the browser stops asking -
a closed tab, a hidden tab, a dead session - Auto simply **pauses**; there is no offline production in
this slice.

## 2. Runtime / in-flight state

Migration `0026_auto_execution.sql` adds one table, `actor_auto_state`, one row per actor:

| Column | Why it exists |
| --- | --- |
| `anchor_kind`, `anchor_x`, `anchor_y` | **Where the actor is.** The place the last walk finished - `WAREHOUSE`, `MARKET`, or a `CELL` with its tile. The server needs it to decide whether an action needs a walk and to refuse a distant one. |
| `travel_kind`, `travel_x`, `travel_y` | **Where it is going**, while a walk is under way. |
| `travel_arrives_at` | **When the server will consider it arrived.** The whole anti-teleport rule: no settlement before this instant. |
| `version` | The optimistic guard for the two writers that can race on one actor (an arrival and a departure). |

There is deliberately **no** per-frame position, no path, no waypoint, no activity log and no
simulation watermark. An actor that has never run Auto has no row, which reads as "somewhere unknown"
and is treated as the Warehouse - the one place every actor can certainly reach.

## 3. Movement / travel model

A walk is `distance / speed`, computed on the server from the island's own tile pitch and the same walk
speed the client's character controller uses (`AUTO_WALK_SPEED_WORLD_PER_SECOND = 2.6`,
`FARM_TILE_PITCH_WORLD = 1.08`; `tests/game-data/auto-anchors.test.ts` pins both against the client's
own copies). Travel is clamped to 0.4 s - 180 s:

- the **floor** is what makes the work cadence human: two cells cannot be planted in the same instant,
  because moving between them is itself a walk the server times;
- the **ceiling** keeps one absurd journey from parking an actor for an hour.

The client animates the walk with the existing `setDestination`/collision runtime, at the same speed,
so the picture and the schedule agree. It cannot rush either one: it learns the arrival time from the
server and the server refuses to settle anything before it.

`tests/api/auto-execution.test.ts` proves the rule directly - a step taken one second before arrival is
still `TRAVELLING` with no crop planted, and the same step after arrival plants.

## 4. Warehouse anchor

The island already has a barn (`starter.building.barn`, at tile 38,-7) and no separate warehouse
building: the Home Warehouse is the account's storage row. So the anchor is the **clear tile in the
barn's own yard**, derived in `packages/game-data/src/auto/index.ts` from the starter layout and
checked against every other starter footprint and against the island's terrain classification
(`HOME_WAREHOUSE_ANCHOR_TILE`). A moved barn moves its doorstep; a doorstep inside a barn or under a
barrel fails the test rather than stranding an actor.

## 5. Supply purchase location

The Farm Market is the shipped `world.market_stall` (tile 49,3), and its anchor is the clear tile beside
it (`FARM_MARKET_ANCHOR_TILE`). Auto therefore **walks to the Market to buy** - seed never materialises
in the actor's hands from the middle of a field. There is no "supplies appear at the Warehouse" rule.

## 6. Empty-field behaviour

An empty field is the normal first state, not an error. The plan resolves the supply ladder
(carried -> stored -> bought -> wait) and the executor performs it one step at a time:

```text
empty field, seed in the Warehouse  -> LOAD (at the barn) -> walk -> PLANT, cell by cell
empty field, seed carried           -> walk -> PLANT
empty field, no seed, buy ON        -> walk to the Market -> PURCHASE -> walk -> PLANT
empty field, no seed, buy OFF       -> WAITING_FOR_SUPPLY, and the actor does not move at all
empty field, buy ON, no gold        -> WAITING_FOR_FUNDS
```

The batch is bounded by `MAX_AUTO_INPUT_BATCH` (10) and by what actually helps: the eligible cells, the
free cargo space, the stock, and (for a purchase) what the gold covers. Section 22 shows the real
numbers for a one-cell field.

## 7. LOAD behaviour

`LoadCargo` (C.6), called with the cargo version the executor just read. The seed moves
Warehouse -> cargo atomically, exactly as a player's manual load does, and the actor has to be standing
at the Warehouse anchor for it to happen.

## 8. Purchase behaviour

`PurchaseSupplyIntoCargo` (C.6): the ordinary shop settlement - catalogue price, wallet, `SHOP_BUY`
ledger row, receipt - with the goods landing in the actor's hands. `tests/api/auto-execution.test.ts`
asserts the gold arithmetic (3 seeds x the catalogue's 2 gold) and that the ledger row exists.

## 9. Planting from cargo

The one application-layer change to a manual path, and it is a **branch, not a second path**:

```text
PlantCrop.execute(actor, farmId, command)            seed from the Warehouse   (manual, unchanged)
PlantCrop.executeFromCargo(actor, farmId, command)   seed from the actor's cargo (Auto)
```

Both run the same private `plant`: the same terrain check, the same occupancy check, the same tile
version guard, the same crop definition, the same level requirement, the same one-seed-per-crop, and
the same receipt. Only the container the seed leaves differs, and
`CropInstanceRepository.plantFromCargoAtomically` writes the crop, the tile, the cargo subtraction and
the receipt in one transaction. A cargo stack that would reach zero is **deleted** rather than left at
zero, because the table's own check forbids an empty row and a zero stack would make the next unload a
zero-value transfer.

There is deliberately no `AutoPlantCrop` class.

## 10. Growth waiting

When nothing is actionable, the step answers `WAITING_FOR_GROWTH` with `retryAfterMs` - the time until
the soonest crop in the winning assignment is ripe, computed from the server's clock and the crop
definition's own duration, capped at five minutes. The client schedules one wake at that time. There is
no per-crop timer, no per-actor tick and no poll: the wait is a comparison, and the wake is a
timestamp. Section 22 shows the countdown the server reported on staging.

## 11. Harvest into cargo

`HarvestCrop.executeIntoCargo`, sharing the manual harvest's whole body: the same reward amount, the
same XP rule and curve, the same `canHarvest` server-time check, the same progression pre-state guard
and retry, the same receipt. The destination is a field on the settlement row
(`harvest_settlements.destination`), and the row's own triggers move the goods into `actor_cargo_items`
instead of `inventory_items`. One reward rule, two containers - so Auto can never yield more than a
player's own hands.

## 12. Unload / return behaviour

A delivery is the **actor's** next step, not an assignment's: when the plan says `TRAVEL_TO_STORAGE`,
the executor walks to the Warehouse anchor and, once there, calls the existing `UnloadCargo` - cargo ->
Warehouse, all or nothing, capacity-guarded by the destination. The plan only says "go home and put it
down"; the executor decides that arriving means unloading, and it re-resolves before doing even that.

## 13. The replant loop

The skill maintains rice in the area, so a harvested cell is a planting target again. After the harvest
the plan loads more seed (carried, stored, or bought) and plants the freed cell - which is the loop in
section 22: plant -> grow -> harvest -> replant. The design sends the actor home when the hands are
**full**, not after every harvest; a two-unit reward into a thirty-unit container is a field day, not a
walk per crop.

## 14. Priority and actionability

The D1 rules are unchanged and are what the executor obeys: the highest-priority **actionable**
assignment wins, so a field that is growing never blocks another field that is ready. The executor adds
nothing to the rule - it asks the same resolver the panel reads.

## 15. Overlap

The resolver's claim rule is what the executor inherits: per pass, one target belongs to one
assignment, and the lower priority number wins. The executor only ever works a cell the plan named, so
two overlapping assignments cannot both plant the same cell. No schema constraint exists or is needed.

## 16. Manual takeover

STOP AUTO changes the control mode on the same actor. The executor notices on the next step and
**abandons** a walk in progress rather than fast-forwarding it: the anchor stays where the last walk
finished, the cargo stays exactly as it was, the assignments are untouched, and no settlement is undone
- because a settlement that happened is atomic and a walk that did not finish never wrote anything.

The player's own movement also takes over: while Auto is driving, pressing a movement key or deflecting
the stick asks for STOP AUTO on the same frame the character starts moving (the design's own
`AUTO_CONTROLLED --[player input]--> PLAYER_CONTROLLED`). It is asked for once per press, never once per
frame.

## 17. Refresh / reconnect / failure recovery

The server's state is the actor row, the cargo rows, the crops and `actor_auto_state` - all in D1 - so a
refresh re-reads the world and continues: the panel's first step re-resolves from scratch. A client
that goes away mid-walk leaves the walk recorded with an arrival in the past; the next step simply
records the arrival and carries on. There is no step queue, no script and no "resume from where I was"
bookkeeping to corrupt.

Recoverable states are all the same shape - re-resolve, then either act or say why:

```text
seed runs out            -> WAITING_FOR_SUPPLY (or a purchase, if the policy allows and the gold is there)
gold runs out            -> WAITING_FOR_FUNDS, with no retry spam (retryAfterMs 0: nothing to wake for)
Warehouse full           -> WAITING_FOR_STORAGE; the cargo stays on the actor, nothing is destroyed
cargo full/nearly full   -> the delivery, before any work whose reward would not fit
target becomes occupied  -> the plan re-resolves and picks the next eligible cell
crop already harvested   -> CROP_ALREADY_HARVESTED, mapped to a prompt re-resolve, not an error
assignment disabled      -> ALL_DISABLED / DISABLED; nothing is executed
Auto stopped             -> STOPPED, walk abandoned, cargo kept
replayed request         -> the settlement's own receipt answers it (the step's id names its settlements)
```

## 18. Cargo and Warehouse full

Two rules, both the design's:

- **A reward that cannot fit is not taken.** The resolver compares the skill's own output quantity with
  the actor's free capacity, and `HarvestCrop`'s reward preparation is the second check; the cargo
  capacity trigger inside the settlement is the third and the authority. A harvest that would overflow
  rolls back whole, so the crop stays in the ground and nothing is lost.
- **A full pair of hands is a delivery, not a dead end.** When the cargo is what stands in the way -
  full, or holding enough that the next reward would not fit - the plan says `TRAVEL_TO_STORAGE` and the
  actor goes home. A full Warehouse answers `WAITING_FOR_STORAGE`: no auto-sell, no dropping, no
  destruction, and no repeated failing unload.

## 19. UI running states

The Auto sheet now shows what the server *did*, with the numbers it reported - never a guess:

```text
Loading Carrot seeds x1        Going to the Warehouse      Returning to the Warehouse
Buying Carrot seeds x3         Going to the Market         Unloading cargo
Planting Carrot                Going to the field          Catching up...
Harvesting Carrot              Idle                        You are driving
```

The progress line under it reads `1 / 1 · Cargo 2 / 30` from the step's own field counts and container
reading, and the reward's own thumbnail floats up from the cell a harvest paid at. No enum name and no
raw id ever reaches the player.

## 20. World visual behaviour

The Main Character visibly walks its route (the existing runtime, speed and collision), turns to face
where it is going, and stoops through a short work gesture when a plant or a harvest lands. The gesture
is presentation only and deliberately not clip-dependent: no shipped model has a work animation, so the
view answers `working` with a small steady stoop instead of standing frozen. Crops appear, grow and
disappear through the ordinary farm refresh, so what the player sees is the server's row changing.

## 21. Mobile behaviour

The sheet is the D1 bottom sheet: one column, controls at 44 px or more, no hover, and the Auto button
and status are reachable with a thumb. Starting, watching and stopping are all one tap each, and the
walk/gesture animation is the same code the desktop sees.

## 22. Remote end-to-end smoke (staging)

Run on `happy-farm-staging` with a **fresh guest** (100 gold, 10 carrot seeds - no cheat grants), a real
FARM work area of one cell at (0,0), and a `crop_carrot` assignment:

```text
GET  /session                                 200  guest established
POST /farms                                   201  farm created
GET  /farms/:id/workers                       200  actor PLAYER_CONTROLLED v1
GET  /farms/:id/tiles                         200  cell (0,0) SOIL, IDLE
POST /farms/:id/work-areas                    201  FARM area, 1 cell
POST /farms/:id/jobs                          201  crop_carrot, priority 1, policy off
POST /farms/:id/workers/control (START)       200  AUTO_CONTROLLED v2
POST /farms/:id/auto/step                     200  LOAD_INPUT worked   - 1 seed Warehouse -> cargo
POST /farms/:id/auto/step                     200  TRAVELLING to cell (0,0), arrives in 15.8 s
                                                   (no settlement may precede this instant)
POST /farms/:id/auto/step (after arrival)     200  PLANT worked        - cargo 1 -> 0, crops 0 -> 1
POST /farms/:id/auto/step                     200  WAITING_FOR_GROWTH, retry 293,377 ms
     ... 12 growth waits, each reporting the server's own countdown, without a single crop being
         harvested early: 293 s -> 268 -> 243 -> 218 -> 193 -> 168 -> 142 -> 117 -> 92 -> 67 -> 42 -> 17
POST /farms/:id/auto/step (at maturity)       200  HARVEST worked      - crops 1 -> 0, cargo 0 -> 2 carrots
POST /farms/:id/auto/step                     200  TRAVELLING to the Warehouse (to fetch seed)
POST /farms/:id/auto/step (after arrival)     200  LOAD_INPUT worked   - 1 seed -> cargo (cargo 3/30)
POST /farms/:id/auto/step                     200  TRAVELLING to cell (0,0) - the replant
POST /farms/:id/auto/step (after arrival)     200  PLANT worked        - cargo 3 -> 2, crops 0 -> 1
POST /farms/:id/auto/step                     200  WAITING_FOR_GROWTH, retry 293,286 ms  (cycle two)
```

The whole lifecycle the brief asks for is in that transcript: supply acquired, the actor travelled, the
crop was planted, it became harvestable **under the server's own clock**, the actor harvested, the
reward entered **cargo**, it returned to the Warehouse, fetched more seed and **replanted** - the loop
continuing on its own.

The growth countdown was re-asked by the *smoke harness*, which sleeps in 20-second slices so it can
print progress; the browser sleeps the whole `retryAfterMs` and would have made one request per
countdown. That is why the transcript shows twelve growth waits rather than one.

Conservation held throughout: the seed count fell by exactly one per planting and nothing else, the
harvest's two carrots appeared in cargo exactly once, the wallet stayed at 100 gold, the ledger gained
no row (no purchase was needed) and the crop row went 0 -> 1 -> 0 -> 1. The one path this particular
run did not exercise is the **unload**, because the hands never filled (2 of 30 units): this design
sends the actor home when they are full, which the API suite proves directly in
`tests/api/auto-execution.test.ts` ("walks home and unloads when the hands are full, before doing any
more field work") and the conservation suite proves arithmetically.

The run was left to continue for 60 steps, which produced **three complete harvests and a fourth
planting** - the loop the slice exists to prove. The end state, read back through the API:

```text
inventory   carrot seeds 6   (10 - four plantings, one seed each)
wallet      gold 100         (untouched: nothing was bought)
cargo       6 carrot, used 6 / 30   (three harvests x 2, all still carried)
crops       1 carrot, growing       (the fourth planting, under way when the run ended)
ledger      0 rows added
STOP AUTO   200 -> PLAYER_CONTROLLED, plan NOT_AUTO_CONTROLLED, actor, cargo and assignment intact
```

## 23. Security review

Checked against `.agents/skills/security-review/SKILL.md`:

- **Trust boundaries** - the step body is a request id and nothing else: no cell, no crop, no quantity,
  no price and no claim to have arrived. `AutoStepRequestSchema` bounds it, and the path is
  `FarmIdSchema`-checked.
- **Authentication / authorization** - the owner-only `requireOwnedFarm` runs on every step, and the
  actor is the farm owner's Main Character, derived server-side. A foreign farm is 403 and no session is
  401 (both tested, and the farm is foreign-checked on the deployed host in the D1 smoke).
- **Location is eligibility, ownership is authority** - the anti-teleport rule lives in
  `actor_auto_state`: the server records when a walk lands and refuses to settle anything before then.
  A modified client can lie about where it *draws* the character, and that changes nothing.
- **Every settlement re-validates** - each one is the existing use case with its own authorization,
  version guard, capacity guard and receipt, called through the same code path a manual action uses.
  A client-supplied target, quantity or price does not exist to be supplied.
- **Race and replay** - the step's request id names its settlements, so a retried request replays the
  receipt it already wrote; a *new* step gets a new id, and the world's own guards (tile occupancy, crop
  version, cargo version and the transfer marker) refuse a duplicate. Two tabs or two steps cannot
  double-plant, double-harvest, double-load or double-unload.
- **Database** - the migration is additive (one table, one defaulted column, two replaced triggers).
  The harvest destination is a CHECK-bounded enum, and the cargo path is guarded by the cargo capacity
  trigger that already existed.
- **Economy** - no new currency path, no new ledger reason, no reward table. Auto's reward is the
  crop definition's, paid by the same settlement, and the only gold it can spend is the shop's own
  price through the ordinary purchase.
- **Known limitations, stated rather than implied** - (1) Auto is **online only**: a closed tab pauses
  it, and there is no offline reconciliation in this slice. (2) The travel guard bounds *server-known*
  movement between anchors; it is a gameplay pacing rule, not a physics simulation, and the client's
  drawn position was never authoritative. (3) Only the `REPLANT_CROP` family executes; everything else
  resolves and waits.

## 24. D1 cost per step

Measured deterministically with the local D1 harness (`tests/api/auto-execution.test.ts` drives the real
handler), counting the reads each use case performs:

```text
one step (any phase)     actor + membership + farm + travel row + the plan read set (see D1 section 17)
                         ~14 point reads and one small range read per assignment area
a settled plant adds     the tile row, the crops/trees/bounds read for target choice, then the
                         settlement batch (crop + tile + cargo row + receipt) on the write side
a settled harvest adds   the same target read, then the settlement batch + the progression guard
a delivery               two steps (a walk, then the unload), and one cargo read per step
```

Rows, not statements, are what D1 bills: every one of these is a point read or a per-area range read, so
a step costs tens of rows - the same order as the panel's own loads and far below the 5-second growth
poll's list reads. The cadence is what keeps the total small: a step happens on a settlement, on an
arrival, or on the server's own growth wake, and **never** on a repeating timer. A one-cell carrot cycle
took 20 steps for a full cycle *and* a replant in the smoke, twelve of which were the growth wait being
re-asked by the test harness (the browser would have made one request for the same countdown).

## 24b. Gates

```text
npm run typecheck            clean
npm run lint                 clean (--max-warnings=0)
npm test                     173 files / 1707 tests
npm run build                web client builds; Worker dry-run builds
npm run build:worker:staging staging Worker dry-run builds
npm run assets:validate      27/27 models match their specs
git diff --check             clean
```

The deployed staging shell serves the D2 bundle (`assets/index-sUeIPNfV.js`,
`assets/index-JL3LWMqx.css`), and the smoke in section 22 was run against it.

## 25. Staging deployment

Staging only; production is not authorized for this slice.

```text
Worker:      happy-farm-staging
Migration:   0026_auto_execution.sql            applied 2026-10-04 (remote)
Version ID:  1d703a89-f496-4ed6-ac84-328db7e9361c   deployed 2026-10-04T06:27Z
Rollback:    7a4f41c6-a2e8-456d-8c6b-1eb1737050ab   (V16.2.2D1)
```

## 26. What D2 deliberately did not do

- No execution for the orchard, mining, forestry, fishing or livestock: they still resolve, and the
  step answers `NOT_EXECUTABLE_YET` rather than running them.
- No offline production, no `simulation_at`, no catch-up, no cron and no per-actor timer.
- No NPC workers, no ships, no routes table, no global simulation queue.
- No client-authoritative movement, arrival or reward.
- No change to the manual game: manual planting still spends Warehouse seed, manual harvesting still
  lands in the Warehouse, and every other system is untouched.
