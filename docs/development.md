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
- Never creates wallet balance, items, farms, inventory, crops, progression, or XP.
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
the development Worker entrypoint. Open the printed URL and:

1. Paste the `DEV_AUTH_TOKEN` from `workers/api/.dev.vars` into **Development token** and save it.
   The token stays in this browser's storage and is never written to a URL or a cookie.
2. Press **Bootstrap dev player**, then **Create farm** (or **Load farm** by id).
3. Select a tile in **Field**, choose a crop, and press **Plant on selected tile**.
4. Wait for the crop to mature (carrot 5 min, wheat 15 min, corn 30 min of server time), then press
   **Harvest** on the tile. The field refreshes every two seconds from the server.
5. Use **Sell** in **Shop** to turn harvested items into gold, and **Buy** to spend it.

The UI computes nothing authoritative: prices, rewards, maturity, and balances all come from the
API, and every response is validated against the `@happy-farm/contracts` schemas before it is used.

Because planting is free and only harvested produce is tradeable, the first useful order is
plant → harvest → sell → buy. A brand-new player has no wallet row and therefore no gold, so
`Buy` returns `INSUFFICIENT_FUNDS` until something has been sold.

## 3D view (Phase 3.6A and 3.6C)

The **Field: 3D prototype** panel starts a Three.js renderer on an explicit click and draws the
authoritative farm: one slab per unlocked tile coloured by `terrainType`, one placeholder crop mesh
per planted tile, and a ring around the selected tile. The art is still placeholder geometry and
flat colours; textures and models arrive with the asset pipeline (3.6B).

- `apps/web/src/render/layout.ts` is pure geometry, tile coordinates to world positions, and is unit
  tested in `tests/web/farm-layout.test.ts`.
- `apps/web/src/render/view-model.ts` is pure as well: it turns the tiles and crops payloads into
  render descriptors, and is unit tested in `tests/web/farm-view-model.test.ts`. It encodes two
  rules — a crop is drawn only when the server also returned its tile as unlocked land, and growth
  is taken from the server rather than inferred from the local clock.
- `apps/web/src/render/scene.ts` owns three.js, the canvas, `ResizeObserver` sizing, picking,
  on-demand frames, and disposal. It never fetches and decides nothing about the game.
- Clicking a slab or a crop in the 3D view selects that tile, which is the same selection the 2D
  **Field** grid uses: `main.ts` keeps one selection and pushes it to both views.
- The panel follows the field's two-second refresh, so planting, growth, and harvesting show up in
  3D without a manual reload. Frames are still drawn on demand rather than from a free-running loop,
  because nothing animates yet.
- A session without WebGL is unaffected until the button is pressed, and then reports
  `FarmRendererUnavailableError` instead of failing silently.

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
