# HappyFarm Product Roadmap

Status: living document. Update it when a phase lands or the order changes.
Audience: the person driving the prompts, plus the audit role that reviews each phase.

Purpose: this is the ordered backlog of work after the current playable build. Each phase below is
written so it can be handed to an implementation agent as **one prompt**. Build the prompt from
`docs/templates/TASK_TEMPLATE.md` and keep it under `docs/DEEPSEEK_EXECUTION_PROTOCOL.md` (no
architecture changes without approval, applied migrations are immutable, allowed-file scope, no
commit). A phase is finished only when its own acceptance criteria and the repository-wide gates
(`npm run typecheck`, `npm run lint`, `npx vitest run`, both builds) pass.

## Where the project stands

Committed and verified through `0857e93`:

- Phase 1 foundation: players, farms, memberships, tiles, stable IDs, game-data registries.
- Phase 2 crop simulation: plant, timestamp-based growth, offline progression, harvest.
- Phase 3 economy: inventory, wallet, ledger, shop buy/sell, idempotency.
- Phase 4A/4B progression: XP on harvest, level curve, and level-gated crops.

Implemented and locally verified in the current working tree, but **not shipped or committed**:

- Phase 4C farm expansion: server-selected purchasable 6 x 6 land plots.
- Phase 5 seed economy: seed items and a `SEED` category, planting that spends exactly one seed, a
  one-time 36-carrot-seed starter grant, uprooting, and a bilingual (vi/en) HUD.
- Client work: fullscreen HUD, Three.js island world, camera pan/zoom, locked-land frontier,
  deterministic scenery, and an action dock that follows server state (plant while empty, countdown
  while growing, Harvest when the server reports the crop mature, and Uproot while a crop is in the
  ground).
- Client character: a walkable local avatar on the fixed world, with depth-based collision against
  the shore, the pond, the farmhouse, a fence drawn from one derived geometry, and the farm's own
  crop and tree rows, plus a camera that follows the avatar through the player's own drag offset and
  wakes only while a movement key is held (ADR 0016).

Gateways available today: `npm run typecheck`, `npm run lint`, `npx vitest run` (42 files /
385 tests), `npm run build --workspace @happy-farm/web`,
`npm run build --workspace @happy-farm/api`, and a local playable dev host (ADR 0011) where the
browser never sees the development token.

## Gaps that shape the order

- The gold -> seed -> produce -> gold loop exists, but seeds are only ever bought: there are no seed
  drops, no tool or building upgrades, and no second way to earn gold.
- One player, one farm. Farm mutations require `role === "OWNER"` and there is no way to add a
  member, so EDITOR / HELPER / VISITOR are modelled in the domain but unreachable in play.
- `trees`, `animals`, `fish`, and `buildings` registries are empty placeholders. There is no
  production, crafting, decoration, or second crop pattern.
- No Durable Object, no WebSocket protocol, no R2 binding, no admin surface, and no browser-level
  (end-to-end) test running the real UI.

## Phase overview

| Phase | Name | Player-facing result | Risk |
| --- | --- | --- | --- |
| 5 | Seed economy | Buy seeds, planting spends a seed, harvest and sell to fund the next crop | Medium |
| 6 | Trees and repeating harvests | Plant fruit trees and harvest them again on a regrow timer | High |
| 7 | Buildings and animals | Place a coop or barn, feed animals, collect products on a timer | High |
| 8 | Water plots and fishing | Stock a pond with fish and catch them after a server-timed wait | Medium |
| 9 | Processing and recipes | Turn raw produce into higher-value goods with a machine | Medium |
| 10 | Membership, invites, roles | Invite a friend with a code and play the same farm as HELPER or EDITOR | High |
| 11 | FarmRoom realtime | Two browsers on one farm see each other's actions live | High |
| 12 | Visiting other farms | Visit another farm read-only, help water crops, leave a sign | Medium |
| 13 | Quests, dailies, events | Daily goals, streak rewards, and a limited-time event crop | High |
| 14 | Art and asset pipeline | Real models, avatar, day/night, and sound instead of primitives | Medium |
| 15 | Client polish | Play on a phone with touch controls and read the UI in Vietnamese | Low |
| 16 | Admin and operations | Support can inspect a player and the ledger with audited tools | High |
| 17 | Production launch readiness | Real accounts, deployed staging and production, CI, browser tests | High |
| 18 | Post-MVP | Trading, co-op farms, seasons, and creator tooling | High |

Phases 5-9 add content, 10-12 add other people, 13-15 add polish, 16-17 make it a product. If the
goal is "play with friends soon", do 10 -> 11 -> 12 before 6-9; the only hard dependencies are 10
before 11 and 11 before 12.

---

## Phase 5 - Seed economy

Status: **implemented and locally verified; pending commit**. See
`docs/decisions/0013-phase-5-seed-economy.md` for the decisions that
actually landed, `docs/DATA_MODEL.md` for `starter_seed_grants` and the planting settlement, and
`docs/protocols.md` for the seed, uproot, and bilingual-HUD contracts.

Goal: give the loop an input cost so gold matters.

Player-facing result: buy carrot, wheat, or corn seeds in the shop, planting spends exactly one
seed, harvesting yields produce, and selling produce funds more seeds. Seeds unlock by level
alongside their crops.

In scope:

- Item categories beyond `CROP` (at least `SEED`), seed item definitions, and a seed -> crop
  mapping in `packages/game-data`.
- Planting consumes one seed through the centralized inventory service inside the same transaction
  as the crop insert, so a replayed request cannot consume twice.
- Shop entries for seeds, plus a way for the client to tell seeds from produce.
- Client planting control: seed counts, and a disabled plant button with a clear reason when the
  player has none.

Out of scope: seed drops from harvests, tool upgrades, and any change to crop growth timing.

Data and security: inventory consumption is a high-value mutation, so the security-review skill
applies. No new table is expected because inventory already exists; if a category column is needed,
that is one additive migration and must be called out separately. The crop catalogue contract gains
a seed item id, which is an additive contract change.

Done when: tests cover planting with no seed, planting with exactly one seed, replay of the same
request not consuming twice, a seed above the player's level still refused, and the client showing
seed counts; plus all repository gates.

Decision needed before starting: planting becomes paid. If free planting should stay, this phase
becomes "seeds are a faster or better variant" instead.

## Phase 6 - Trees and repeating harvests

Goal: introduce a second crop pattern that pays out on a regrow timer.

Status: **implemented on top of the audited backend** (migration `0008`, tree catalogue, use cases,
routes, client dock, and 3D rendering). Migration `0008` and the repeating-harvest invariants
(occupancy in both directions, one settlement per cycle, replay, races, removal) are verified on the
staging D1 database. Pending: a manual browser pass. See
`docs/decisions/0014-trees-and-repeating-harvests.md`.

Player-facing result: plant a fruit tree, wait longer than a crop, then harvest it repeatedly. Each
harvest puts the tree on a regrow timer instead of freeing the tile.

In scope:

- `tree_instances` persistent state with planted and next-ready timestamps, and a tree definition
  registry in game data.
- Domain rules for tree maturity and regrow, kept in `packages/domain` and reused by the
  application use case and the client view model.
- Harvest settlement that pays items and XP through the existing settlement path, never a second
  award mechanism.
- A "remove tree" command with an authorization and audit trail.
- Client: tree rendering from a primitive placeholder first, a regrow countdown in the action dock,
  and tree entries in the shop.

Out of scope: breeding, grafting, and decorative-only trees.

Data and security: one additive migration for tree instances; the harvest path already exists and
must be generalized rather than duplicated. Security review applies (new persistent domain,
inventory and XP payout).

Done when: tests cover plant, maturity by server timestamp, first harvest, regrow not ready, regrow
ready, remove, replay safety, and unauthorized removal; plus all repository gates.

## Phase 7 - Buildings and animals

Status note: the **world/map foundation** for this phase landed first (fixed world coordinates, static
regions, paths, spawn, and walkability preparation) - see
`docs/decisions/0015-fixed-world-coordinates-and-static-farm-regions.md`. Buildings and animals
themselves are **not implemented**; the reserved regions are visual space only. The **character**
that foundation was built for also landed - a walkable avatar with collision and a follow camera, see
`docs/decisions/0016-player-character-and-follow-camera.md`. The fence is drawn and blocked from the
same derived segments, and the avatar has no animation yet.

Goal: the farm earns while the player is away without one timer per animal.

Player-facing result: buy and place a coop or barn, put animals inside, feed them, and collect eggs
or milk when the server says the product is ready.

Suggested split into two prompts so each diff stays reviewable:

1. Buildings and placement: a building registry, placement on valid tiles with collision and
   ownership checks, one migration, and client placement UX.
2. Animals and production: animal instances bound to a building, feed consumption through the
   inventory service, product collection through harvest-style settlement with XP, all driven by
   timestamps.

Out of scope: animal happiness, breeding, and building upgrades in the first pass.

Data and security: two additive migrations at most. Both prompts touch inventory, economy, and new
persistent state, so the security review applies to each.

Done when: tests cover placement refusal on occupied or locked land, feeding without feed, product
collection before and after ready, replay safety, and unauthorized placement; plus all gates.

## Phase 8 - Water plots and fishing

Goal: use the terrain types the tile model already has.

Player-facing result: water tiles the farm owns can be stocked with fish, fed, and fished after a
server-timed wait.

In scope: a fish definition registry, a stocking command on water tiles, a catch command whose
outcome is decided entirely by the server, XP and item payout through the existing settlement, and
client rendering plus a dock state for water tiles.

Out of scope: a player-skill fishing mini-game; the first version is click, wait, collect.

Data and security: one additive migration. Security review applies (new payout path).

Done when: tests cover stocking on non-water tiles, catching before ready, catching after ready,
replay, and authorization; plus all gates.

## Phase 9 - Processing and recipes

Goal: give harvested goods a second use besides selling.

Player-facing result: place a machine, load produce, wait, and collect a higher-value good.

In scope: recipe definitions in game data, a machine instance with input, output, and timestamps, a
single "collect" command, inventory consumption and production through the centralized services,
and a client machine panel.

Out of scope: multi-step tech trees and machine upgrades.

Data and security: one additive migration; security review applies, because inventory input and
output happen in one transaction and replay safety is the point of the phase.

Done when: tests cover missing inputs, correct consumption and output, concurrent collections, and
replay; plus all gates.

## Phase 10 - Membership, invites, and roles

Goal: make the four farm roles real, and make it possible to share a farm at all.

Player-facing result: the owner creates an invite, a second player joins with that code, and the
owner can set them to HELPER (farms, but cannot spend the farm's gold or buy land), EDITOR (farms
and builds), or VISITOR (read-only). The owner can change a role or remove a member at any time.

In scope:

- A single pure capability policy in `packages/domain` mapping role -> allowed action, consumed by
  every use case so authorization is decided in one place instead of per handler.
- Invite creation, redemption, and revocation with expiry, rate limiting, and audit records.
- Membership listing and role changes, with audit records for every change.
- Replacing the current `role !== "OWNER"` checks with the policy, keeping writes owner-only where
  the policy says so.
- Client member list, invite UI, and role controls.

Out of scope: friends lists, notifications, and cross-farm chat.

Data and security: one additive migration for invites; membership changes are security-critical, so
the security review is mandatory and the audit trail is part of done. Errors must not reveal
whether an invite code exists for another player.

Done when: tests cover invite expiry, single-use redemption, replay, role escalation attempts
(HELPER trying to buy land), removal taking effect immediately, and every capability in the matrix;
plus all gates.

## Phase 11 - FarmRoom realtime

Goal: people on the same farm see each other's actions without refreshing.

Player-facing result: a colleague plants a crop and it appears in your farm within a moment, and a
small panel shows who is online.

Recommended split:

1. Broadcast only: a `workers/farm-room` Durable Object keyed by `farmId`, a WebSocket upgrade route
   that reuses the same authentication, and validated outbound events published by the existing use
   cases after they persist. Commands still travel over HTTP.
2. Presence and ordering: join/leave, ordered events per farm, reconnect resync from D1, and
   dev-host wiring so the Vite dev server proxies the WebSocket.

In scope: a WebSocket envelope contract, event payloads derived from the same DTOs the REST API
returns, backpressure and disconnect handling, and client reconnection that rebuilds state from the
`GET` endpoints rather than trusting the stream.

Out of scope: moving commands into the Durable Object, cross-farm chat, and voice.

Data and security: no table is required for the broadcast step. Every socket message must be
authorized against the membership policy from Phase 10, and the socket must never become a second
source of truth. Security review applies.

Done when: tests cover unauthorized upgrades, membership removal mid-session, event ordering,
reconnect resync, and that a rejected command never broadcasts; plus all gates.

## Phase 12 - Visiting other farms

Goal: make farms visible to each other.

Player-facing result: open a farm by id or from a short public list, walk it read-only, water a few
crops to help, and leave a sign.

In scope: a public farm summary, a visit read path that returns only what a VISITOR may see,
server-decided watering with a small XP or cosmetic reward, and a sign book.

Out of scope: trading, griefing mechanics, and cross-farm economy transfers.

Data and security: any new table is additive. This phase exposes other players' data, so the
security review must confirm exactly what a visitor can read and that no write path accepts a
client-chosen farm id the player is not a member of.

Done when: tests cover visitor read scope, watering limits, sign abuse limits, and blocked writes;
plus all gates.

## Phase 13 - Quests, dailies, and events

Goal: give the player a reason to come back tomorrow.

Player-facing result: daily goals with streak rewards and a seasonal event crop that can only be
planted during the event.

In scope: quest definitions in game data, progress written inside the same transactions that
already settle harvests and collections, claimable rewards through the economy service with
idempotency, and a client quest panel.

Out of scope: a general event engine and per-player scripted content.

Data and security: additive migrations for progress and claims. Reward duplication is the main
risk, so idempotency tests are part of done. Security review applies.

Done when: tests cover progress from a replayed harvest, one claim per reward, a missed day
breaking a streak, and an event crop refused outside its window; plus all gates.

## Phase 14 - Art and asset pipeline

Goal: replace placeholder primitives with a real look.

Player-facing result: recognisable crops and trees, an avatar, a tractor, changing light through the
day, and ambient sound.

In scope: an R2 bucket with an upload and versioning pipeline, a manifest the client reads instead
of bundled files, GLTF models and animations, day/night lighting, sound, and a documented asset
licensing rule so no third-party asset enters the project without a compatible licence.

Out of scope: character gameplay systems; the avatar is cosmetic in this phase.

Data and security: no database change. Watch bundle size, plus the renderer's model cache and
disposal paths.

Done when: the placeholder manifest is replaced by R2-backed assets, a missing asset degrades to a
placeholder instead of breaking the scene, and the world still renders on a mid-range laptop; plus
all gates.

## Phase 15 - Client polish

Goal: the game is comfortable on a phone and reads in the player's language.

Player-facing result: touch pan and pinch zoom, a layout that works on a narrow screen, a Vietnamese
interface, and settings for quality and sound.

In scope: touch input, responsive HUD layout, moving every user-visible string in `apps/web` through
one translation layer (game-data display names included), persisted settings, reduced-motion and
colour-contrast support, and ARIA labels on the HUD.

Out of scope: localising repository documentation.

Done when: the field, the action dock, and the shop are usable at a phone width, a language switch
changes every visible string, and no string is hard-coded outside the layer; plus all gates.

## Phase 16 - Admin and operations

Goal: the game can be operated.

Player-facing result: support can look up a player, read the economy ledger, and fix a problem with
an audited action such as granting a missing item.

In scope: an `apps/admin` surface with its own authorization separate from player auth, audit-first
mutations that require a reason, a ledger browser, rate limiting and abuse protection on public
routes, structured logging and metrics, and alerts for failed settlements.

Out of scope: chat moderation, which arrives with the social phases.

Data and security: this is the most privileged surface in the repository. Security review is
mandatory, and no admin action may bypass the centralized inventory or economy services.

Done when: an unauthorized actor cannot reach any admin route, every write records a reason and an
actor, and the ledger can answer "where did this gold come from" for one player; plus all gates.

## Phase 17 - Production launch readiness

Goal: real players, real accounts, a real deployment.

Player-facing result: sign in with an email or a provider, keep progress in the cloud, and open the
game from a public URL.

In scope: a production authenticator that replaces the development identity without weakening the
fail-closed default, staging and production environments, secret management, a CI pipeline that runs
typecheck, lint, tests, and both builds on every change, browser end-to-end tests over the real UI,
a D1 backup and restore drill, a load test with simulated farms, and a documented rollback and
balancing procedure.

Out of scope: the marketing site and payments.

Data and security: security review is mandatory. The dev authenticator must remain unreachable in
production, and no secret may enter the client bundle.

Done when: a fresh clone can deploy to staging through CI, and the restore drill has been performed
once rather than only documented.

## Phase 18 - Post-MVP

Kept deliberately unscheduled:

- Player-to-player trading and a market, only after the audit tooling from Phase 16 exists.
- Co-op farms, guilds, and shared goals beyond one farm.
- Seasons, leaderboards, and limited-time content as a reusable system.
- Creator tooling, custom decoration packs, and a mobile app wrapper.

## Cross-cutting backlog

- Performance: instancing and level of detail once a farm holds hundreds of entities, and streamed
  world chunks beyond the current plot frame.
- Accessibility and comfort: camera speed options, motion reduction, and colour-blind-safe markers.
- Economy health: a balancing pass with a spreadsheet or a simulation test over the level curve,
  prices, growth times, and rewards.
- Documentation debt: keep `docs/protocols.md`, `docs/DATA_MODEL.md`, and the ADR series current in
  the same prompt that changes them.

## Rules that never change

- Server authority over economy, inventory, XP, level, crop and production state, rewards, prices,
  ownership, permissions, and unlocks.
- The client sends intent, never authoritative state, and never decides maturity or rewards.
- Migrations are additive, and applied migrations are immutable.
- Every phase ends with the repository gates and, where it touches auth, permissions, economy,
  inventory, rewards, or persistent state, a security review.
- No commit until the phase diff has been audited.

## Suggested next three prompts

1. Phase 6 trees, which introduces the repeating-harvest pattern later content phases reuse.
2. Either Phase 10 membership and roles (other people on the farm next) or Phase 7 buildings and
   animals (more to do alone next).
3. The other of those two, once the first has been audited.
