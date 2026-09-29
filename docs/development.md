# Local development

This document covers the isolated development authentication bridge (Phase 3.5A). It is
development tooling only and is not part of the production API surface.

## Production stays fail-closed

| Entrypoint | Config | Authenticator | Dev bootstrap route |
| --- | --- | --- | --- |
| `workers/api/src/index.ts` | `workers/api/wrangler.toml` | `UnconfiguredAuthenticator` (always no actor) | absent |
| `workers/api/src/dev-index.ts` | `workers/api/wrangler.dev.toml` | `DevAuthenticator` | `POST /__dev/bootstrap` |

The production entrypoint never imports `dev-auth.ts`, `dev-index.ts`, or the dev player
bootstrap. The dev bearer token therefore has zero authority in production: `POST /farms` with a
valid dev token still returns `NOT_AUTHENTICATED`, and `/__dev/bootstrap` returns
`RESOURCE_NOT_FOUND`.

## Configure local development

1. Copy the template and fill in local-only values:

   ```text
   workers/api/.dev.vars.example  ->  workers/api/.dev.vars
   ```

   `.dev.vars` is gitignored. Use a long random `DEV_AUTH_TOKEN`; never commit a real token.
2. `wrangler.dev.toml` keeps `DEV_AUTH_ENABLED = "false"` as the committed placeholder so that
   nothing authenticates by accident. `.dev.vars` overrides it with `DEV_AUTH_ENABLED=true`.
3. Run the development Worker:

   ```text
   npm run dev:worker
   ```

   The development Worker listens on `http://localhost:8787` by default. Production dry-run
   isolation can be checked with `npm run build:worker:dev` (dev entrypoint) and
   `npm run build` (production entrypoint).

## Bindings

| Binding | Purpose |
| --- | --- |
| `DEV_AUTH_ENABLED` | `"true"` enables dev authentication; anything else fails closed |
| `DEV_AUTH_TOKEN` | Server-side bearer secret; compared by hashed, byte-folded equality |
| `DEV_PLAYER_ID` | Single server-configured development player id |
| `DEV_AUTH_ISSUER` | Issuer recorded for the development player row |
| `DEV_AUTH_SUBJECT` | Subject recorded for the development player row |
| `DEV_PLAYER_DISPLAY_NAME` | Optional display name (defaults to `Dev Player`) |

The browser supplies only `Authorization: Bearer <dev-token>`. The server decides `playerId`,
issuer, and subject. `x-player-id`, `?playerId=`, request bodies, and any client storage are never
read as identity — not even in development.

## Dev player bootstrap

Farm and economy rows reference `players(id)`, so the configured dev actor needs a real Player row
before any gameplay command can persist:

```text
POST /__dev/bootstrap
Authorization: Bearer <dev-token>
```

- Sends no body. A request with a body is rejected with `INVALID_INPUT`.
- Requires a valid dev token; otherwise `NOT_AUTHENTICATED` and no row is written.
- Creates only the one server-configured Player (`ACTIVE`) using the Phase 1 schema, and is
  idempotent — repeated calls return the same player with `created: false`.
- Since Phase 5 it then performs onboarding: `GrantStarterSeed` gives that player their one-time 36
  `item_carrot_seed`. The receipt is keyed by player, so a repeated bootstrap, a second farm, or a
  replayed call grants nothing more. There is no HTTP route for granting items, and the browser never
  names the item or the quantity.
- Never creates wallet balance (gold), farms, crops, progression, or XP.
- Returns `CONFLICT_STALE_STATE` if the configured player id already belongs to a different
  issuer/subject pair (change `DEV_PLAYER_ID` or reset the local database).

Typical local sequence:

```text
npm run db:migrate:local
npm run dev:worker
curl -X POST http://localhost:8787/__dev/bootstrap -H "Authorization: Bearer $DEV_TOKEN"
```

## Browser calls

The playable development UI (`apps/web`, plain TypeScript + Vite) calls the development API with
the bearer header. Prefer same-origin requests through the Vite dev-server middleware; do not add
wildcard production CORS for development convenience.

## Playable development UI

```text
npm run dev
```

This starts the Vite dev server, which serves the UI and forwards same-origin `/api/*` requests to
the development Worker entrypoint. Open the printed localhost URL. The local proxy keeps the bearer
credential server-side, automatically bootstraps the configured development player, and loads the
last local Starter Farm (or creates one when none exists).

1. Select a tile in **Field**, choose a crop, and press **Plant crop**. The list comes from
   `GET /crop-definitions`, not from the page: each option shows the crop and how many of its seeds
   the player holds; wheat needs level 2 and corn level 3, and a crop this player has not unlocked
   yet is listed with the level it needs rather than hidden. Planting spends one seed, so the button
   is disabled, with the reason shown, when the tile is not empty soil, the crop is locked, or no
   seed is left.
2. A planted tile reports its crop name and growth state in the action dock. While it grows, the
   plant button is disabled and the dock shows the remaining server-timed growth. Once the crop
   matures (carrot 5 min, wheat 15 min, corn 30 min of server time), the dock replaces the plant
   controls with a **Harvest** button. The field refreshes every two seconds from the server.
3. Use **Sell** in **Farm Market** to turn harvested produce into gold, and **Buy** to spend it on
   more seeds. The two directions are separate rows: seeds can only be bought and produce can only be
   sold, so no item can be bought and sold back.
4. Press **Uproot** to free a tile you planted by mistake. It asks for confirmation first, because
   the seed is not refunded; a growing crop can be uprooted just as a mature one can.
5. Use the **language button** in the top bar to switch the whole HUD between English and
   Vietnamese. The choice is saved and applied without a reload; it changes only wording, never a
   price, a level, or a count.

The 36 starter tiles are the field, not the whole map. They sit on a larger island with a dirt
apron, fence, path, pond, barn, and deterministic scenery. The next ring of land for sale is drawn
as fogged, padlocked `6 x 6` plots around the field; buying a plot through **Land** turns that ring
into field and previews the next one. Drag the 3D view to pan and use the wheel to zoom; both are
clamped to the island, and clicking a tile selects it. The surrounding world is presentation only:
unlocked land, prices, and levels still come from the server.

Automatic authentication is intentionally limited to loopback Host headers (`localhost`,
`127.0.0.1`, and `[::1]`). Running Vite with a LAN-facing host does not auto-authenticate remote
requests. The production Worker remains unchanged and the dev token is never bundled into the UI.

**Progression** shows the level and experience the server reports for the development player. A
harvest is the only thing that moves it, because the award is written inside the harvest settlement
itself; the status line names the experience a harvest earned and says so when a level was reached.
The panel is a projection of `GET /progression` and recomputes no threshold of its own, so it cannot
disagree with the curve the server applied.

The planting control is bound to the same server answers: an option is disabled while the reported
level is below the catalogue's requirement, and it re-renders when a harvest awards a level, so the
crop a level unlocks becomes selectable without a reload. Disabling an option is a courtesy, not a
boundary — the server refuses the command with `CROP_LEVEL_REQUIRED` either way.

The UI computes nothing authoritative: prices, rewards, maturity, and balances all come from the
API, and every response is validated against the `@happy-farm/contracts` schemas before it is used.

Because planting costs a seed and only harvested produce is tradeable, the first useful order is
plant → harvest → sell → buy. A brand-new player has no wallet row and therefore no gold, so
`Buy` returns `INSUFFICIENT_FUNDS` until something has been sold. The dev bootstrap grants 36
carrot seeds -- three full plantings of the starting crop -- so a new player can plant immediately,
and a player who has spent them all with nothing to sell sees `INSUFFICIENT_ITEMS` from `Plant crop`
until the market is used.

## 3D view (Phase 3.6A, 3.6B, and 3.6C)

The **Field: 3D prototype** panel starts a Three.js renderer on an explicit click and draws the
authoritative farm: one slab per unlocked tile coloured by `terrainType`, one crop mesh per planted
tile, and a ring around the selected tile. The art is placeholder throughout — flat slab colours and
small generated models — and replacing it is a file swap, not a code change.

- `apps/web/src/render/layout.ts` is pure geometry, tile coordinates to world positions, and is unit
  tested in `tests/web/farm-layout.test.ts`.
- `apps/web/src/render/view-model.ts` is pure as well: it turns the tiles and crops payloads into
  render descriptors, and is unit tested in `tests/web/farm-view-model.test.ts`. It encodes two
  rules — a crop is drawn only when the server also returned its tile as unlocked land, and growth
  is taken from the server rather than inferred from the local clock.
- `apps/web/src/render/scene.ts` owns three.js, the canvas, `ResizeObserver` sizing, picking,
  on-demand frames, disposal, and the model cache. It never fetches authoritative state and decides
  nothing about the game.
- Clicking a slab or a crop in the 3D view selects that tile, which is the same selection the 2D
  **Field** grid uses: `main.ts` keeps one selection and pushes it to both views.
- The panel follows the field's two-second refresh, so planting, growth, and harvesting show up in
  3D without a manual reload. Frames are still drawn on demand rather than from a free-running loop,
  because nothing animates yet.
- A session without WebGL is unaffected until the button is pressed, and then reports
  `FarmRendererUnavailableError` instead of failing silently.

### Crop models

Models are glTF 2.0 binaries in `apps/web/src/assets/models/`, imported through Vite's `?url` so a
missing file fails the build. A crop draws its model once loaded and placeholder geometry before
that, so nothing waits on a download, and a model that fails to load leaves its placeholder in place
and reports the reason on the status line.

Every model must be one world unit tall with its base on y = 0 and its footprint inside a 1 x 1
square; the renderer scales uniformly by the crop's display height, so those two come out right
without any per-model factor. `tests/integration/crop-model-assets.test.ts` parses each shipped file
and fails one that breaks the contract.

The committed models are placeholders, generated deterministically by
`apps/web/tools/generate-placeholder-models.mjs`:

```text
npm run assets:generate --workspace @happy-farm/web
```

Rerun it after changing the generator; replace the files by name to use real art. A new crop needs
an entry in `apps/web/src/render/assets.ts` and a file with a matching name, and two tests will say
so if only one of the two happened.

## Live backend without `workerd`

On some Windows hosts the native Worker runtime crashes with
`access violation 0xc0000005` / stack overflow, so `wrangler dev` cannot start. That is a local
runtime limitation, not an authentication or gameplay defect, and it is not worked around by
weakening authentication.

Instead, `workers/api/dev/api-host.ts` hosts the **same** development Worker entrypoint
(`workers/api/src/dev-index.ts`) on plain Node:

| Concern | Provided by |
| --- | --- |
| Worker `fetch(request, env)` runtime | `createDevWorker` from the real dev entrypoint |
| `DB` binding | `workers/api/dev/sqlite-d1.ts` over `node:sqlite` |
| Schema | the committed `database/migrations/*.sql`, applied by `workers/api/dev/migrations.ts` |
| Identity | `workers/api/.dev.vars`, read by `workers/api/dev/dev-vars.ts` |

The Node host is development-only: `wrangler.toml` still points production at
`workers/api/src/index.ts`, so the host is never bundled into the production Worker, and it reuses
the same authenticator, handler, routes, game data, and repositories as the `workerd` path. The
local database defaults to `.wrangler/dev-local.sqlite` (gitignored) and can be overridden with
`DEV_DATABASE_PATH`; the bindings file defaults to `workers/api/.dev.vars` and can be overridden
with `DEV_VARS_PATH`. The middleware test uses that override so it never writes to the developer's
own token file. `GET /health` is the quickest liveness check.

`SqliteD1Database` mirrors the D1 semantics the repositories rely on — foreign keys enforced,
`batch` as an all-or-nothing transaction, and batches serialized rather than nested — so
`node:sqlite` and production D1 behave the same way for these queries.

The migration runner enables foreign keys *before* it starts and commits each migration together
with its tracking row, so a migration that fails partway through rolls back completely and is
retried on the next start instead of leaving the local database carrying schema the runner does
not know it applied. D1 applies migrations with foreign keys enforced, so the local runner does
the same rather than accepting a migration production would reject.

The Vite `/api` middleware refuses a request body larger than 16 KiB, mirroring
`MAX_JSON_BODY_BYTES` in `workers/api/src/handler.ts`. A declared `content-length` over the limit
is refused before any byte is read, and a chunked body that crosses the limit is abandoned rather
than buffered to the end. Both cases answer an `INVALID_INPUT` failure envelope carrying a
`requestId`, the same shape and code the Worker returns for an oversized body. The connection is
closed only after that refusal has been flushed, because tearing down a request whose body was
never read resets the socket and would otherwise be able to truncate the error on its way back to
the browser. Read-only checks:

```text
npm run typecheck
npm run lint
npm run test
```

Both runtimes can still be validated without `workerd` by dry-running the bundles:
`npm run build` (production entrypoint) and `npm run build:worker:dev` (development entrypoint).
