# ADR 0006: Starter land and the Node development host

Status: Accepted (pending independent security/architecture audit before the Phase 3 commit)

## Problem

Phase 2A shipped `PlantCrop` against a schema where a `farm_tiles` row *is* unlocked land, but
`CreateFarm` never inserted any tile rows and no HTTP route exposed them. A farm created through the
public API therefore had no plantable land, and planting could only be exercised by hand-seeding
rows in a test database. That made the documented gameplay loop unreachable over HTTP even with a
live runtime, and left Phase 3.5B (a playable development UI) with nothing to render.

A second, unrelated blocker was environmental: the native Worker runtime (`workerd`) crashes on this
Windows host, so `wrangler dev` cannot start.

## Decisions

### Starter land

- `CreateFarm` inserts a `6 x 6` square of `SOIL`/`IDLE`/`version 1` tiles anchored at the origin,
  in the **same** transaction as the farm row and its `OWNER` membership. A partially created farm,
  or a farm with partial starter land, must never be observable.
- `INITIAL_LAND_SIZE` and `createInitialFarmTiles` in `packages/domain` are the single source of the
  starter shape. The application layer calls them; it does not inline coordinates or sizes.
- `FarmRepository.createWithOwner` therefore takes the initial tiles, and the D1 implementation adds
  one bounded `INSERT` per tile to the existing batch. The domain, not SQL, decides what starter
  land contains.
- `FarmTileRepository.listByFarm` plus the authenticated `GET /farms/:farmId/tiles` route expose the
  authoritative coordinates and `version` values a client needs to satisfy `expectedTileVersion`.
  This is a projection only: it unlocks nothing and mutates nothing.
- Planting remains free. No seed item, planting cost, wallet grant, or new currency is introduced by
  this ADR: those are economy/game-data changes with their own audit surface, and inventing them to
  make a demo loop look better would bypass the Phase 3 ledger invariants. The honest first loop is
  plant → harvest → sell → buy, and the UI states that.
- Tile `version` keeps meaning "terrain mutation counter". Planting guards on it but does not
  increment it; occupancy is canonical in `crop_instances`.

### Node development host

- The development API keeps **one** implementation: `workers/api/src/dev-index.ts` with
  `DevAuthenticator`. Production keeps `workers/api/src/index.ts` with `UnconfiguredAuthenticator`.
- `workers/api/dev/api-host.ts` supplies only what `workerd` normally supplies — the `DB` binding and
  a `fetch(request, env)` entry — so that entrypoint can run on plain Node when `workerd` cannot
  start. It is development-only and is never referenced by `wrangler.toml`.
- `workers/api/dev/sqlite-d1.ts` implements the existing narrow `D1DatabaseLike` port over
  `node:sqlite`, with `PRAGMA foreign_keys = ON` and `batch` as an all-or-nothing transaction whose
  concurrent calls are serialized rather than nested. Repositories are unchanged.
- The committed `database/migrations/*.sql` remain the single schema source of truth; the dev host
  only tracks what a local file has already applied (`dev_applied_migrations`).
- The Vite dev server forwards same-origin `/api/*` to that host. During development the browser
  holds the dev bearer token and nothing else; a proxy is used instead of wildcard CORS.

## Consequences

- The MVP "unlock starter land" step now has a real, tested implementation, and the whole
  buy/plant/grow/harvest/inventory/sell/wallet loop is reachable over HTTP without hand-seeded rows.
- Existing farms created before this change have no tiles and cannot be planted until land is
  granted. No backfill is performed: there is no production data, and a silent backfill would be an
  unreviewed write against player state.
- Six rows per farm is a deliberate MVP constant, not a design for land expansion. Land purchase and
  expansion need their own ADR and must insert rows rather than widen these bounds.
- The Node host is additional development-only surface that must never be reachable in production.
  `tests/api/dev-auth.test.ts`, `tests/integration/dev-host.test.ts`, and the `wrangler.toml`
  isolation check exist to keep it that way.
- Deferred until the independent audit: true parallel `workerd` concurrency, replay-returns-stored-
  balance confirmation under real D1, `PRAGMA foreign_keys` observation in D1, and the Windows
  `workerd` crash itself.