# Staging: the playtest environment

Status: **deployed and smoke-tested** (V14.1, 2026-10-02). Staging is a **public guest alpha**: a
visitor opens the link and plays, with no email, OTP, or Access login. **Both hostnames are public** -
the Access gate that blocked the custom domain in V13.6.2 has since been lifted, and the canonical URL
was re-verified end to end (200, guest cookie, 401 without a session). See "The URLs" below and
`docs/qa/MULTI_USER_ALPHA.md` for the tester-facing version.

This is a mobile playtest environment, not a launch. `docs/deployment.md` is the older, wider
checklist; this file is the current state of the deployment and how to operate it.

## The URLs

```text
https://happyfarm-staging.longfx.trade/                    canonical custom domain, public
https://happy-farm-staging.duclong-reg.workers.dev         public
```

Both hostnames are the same Worker (`happy-farm-staging`), and both serve the same guest alpha. The
custom domain is the one to hand to testers: it is easier to type, and it is verified working. A guest
is scoped to the hostname it was created on (the cookie carries no `Domain`), so pick one URL per
playtest - see the last section.

Current deployment: Worker `happy-farm-staging`, version `24b24d4c-35bf-4d0b-9912-9be859c548fd`,
deployed 2026-10-02 from the V14.3 Farm Market commit, bundles `assets/index-AI5KPUr1.js` and
`assets/index-wmaDqDVj.css`. (V14.2 was `67678bb7-7dbd-4896-a343-34841cde3180`, V14.1
`6d8b7e83-0b60-43ec-ac61-2ffd6d1a7031`, V13.6.3 `784f4e7f-607f-4106-92e9-34126df471d2`, V13.6.2
`174b4e39-f0dd-46e6-84e3-de0b97c9ed01`, V13.6.1 `7df79218-2a86-4435-9cd9-a399f9415c93`.)

## Architecture

```text
        browser
          |  opens the canonical URL
          v
        Cloudflare Access (Zero Trust)     <-- applies to the CUSTOM DOMAIN only; the one remaining
          |  (operator: bypass/remove)          operator step. workers.dev is not covered by it.
          v
        happy-farm-staging Worker   (workers/api/wrangler.staging.toml)
          |  main = src/index.ts
          +-- /api/*  (prefix stripped once) --> API handler  (workers/api/src/handler.ts)
          |                                      identity: Access JWT, or guest cookie
          |                                      storage: happy-farm-staging D1 (binding DB)
          |
          +-- everything else ----------------> Cloudflare Static Assets (ASSETS)
                                                 apps/web/dist: SPA shell, hashed JS/CSS,
                                                 GLB models, single-page fallback
```

One origin, so there is **no CORS**: the browser uses `API_BASE = "/api"` (`apps/web/src/api.ts`) and
is served by the same Worker that owns the API. That is also what makes a cookie-borne guest session
simple, and why the only CSRF defence needed beyond `SameSite=Lax` is the origin check in
`workers/api/src/origin-guard.ts`. Nothing in the shipped bundle refers to `localhost`, `127.0.0.1`,
a dev-server port or a filesystem path.

## Environments

| | Entrypoint | Config | Database | Identity |
| --- | --- | --- | --- | --- |
| Local dev | `workers/api/src/dev-index.ts` | `wrangler.dev.toml` | `happy-farm-local` (local SQLite) | dev bearer token via the Vite proxy |
| **Staging** | `workers/api/src/index.ts` | `wrangler.staging.toml` | `happy-farm-staging` (D1, binding `DB`) | guest cookie (`GUEST_AUTH_ENABLED = "true"`), plus Cloudflare Access if a JWT is present |
| Production | not configured | `wrangler.toml` (local placeholder) | - | none until Access is configured; guest play is off |

The development bridge (`dev-auth.ts`, `dev-index.ts`, `workers/api/dev/**`) is not in the deployed
entrypoint's import graph: it cannot exist in a Worker built from the staging config, and the deployed
bundle was checked for it.

## Identity: guest sessions (V13.6.2)

A visitor who lands on a public hostname gets a real player, a real farm, and no login. The whole
design is in `docs/design/IDENTITY.md`; the operational facts are:

| | |
| --- | --- |
| Credential | 32 random bytes from `crypto.getRandomValues`, base64url, in the `hf_guest` cookie |
| Cookie | `Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax` (180 days) |
| Storage | `player_identities(kind='GUEST')`; the **SHA-256 hash** of the credential, never the credential |
| Establishment | `GET /api/session` (the only route that may create an identity) |
| Resolution | every other route; a cookie that does not resolve is simply not authenticated |
| CSRF | `SameSite=Lax` plus an `Origin` check on unsafe methods (401 before authentication) |

`GUEST_AUTH_ENABLED = "true"` in `workers/api/wrangler.staging.toml` is the only place guest play is
switched on. Production leaves it unset, so `/api/session` answers `NOT_AUTHENTICATED` there and no
player is created.

Cloudflare Access is untouched and still available: if a valid `Cf-Access-Jwt-Assertion` is present,
that identity wins, and the guest cookie is ignored for that request. Nothing about the Access path
was removed - a browser holding both is always the Access player.

## The custom domain is public (was: the operator step)

The V13.6.2 report asked an operator to lift the Cloudflare Access gate on
`happyfarm-staging.longfx.trade`. That has been done, and it is verified from this environment:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://happyfarm-staging.longfx.trade/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://happyfarm-staging.longfx.trade/api/health   # 200
curl -si https://happyfarm-staging.longfx.trade/api/session | grep -i set-cookie             # hf_guest=...
curl -s -o /dev/null -w '%{http_code}\n' https://happyfarm-staging.longfx.trade/api/shop     # 401
```

The last line is the one that matters: with no cookie and no Access assertion the API still answers
`NOT_AUTHENTICATED`, so lifting the gate published the *guest* path and nothing else. The Worker's
`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` configuration is untouched, so if the gate is ever restored
(re-enable the Access application, or delete a bypass policy), a valid `Cf-Access-Jwt-Assertion` still
outranks a guest cookie exactly as before.

Repository code cannot add or remove an Access application either way: the deployment credentials
carry Workers scopes, not Access scopes (`npx wrangler whoami` lists no Access permissions). This
section stays as the record of what was needed and how it was checked.

## Database

| | |
| --- | --- |
| Binding | `DB` |
| Database | `happy-farm-staging` |
| Id | `acc598c9-e726-46c8-b1a3-23e5b6a42d52` (committed in `wrangler.staging.toml`; not a secret) |
| Migrations | **0001 - 0015 applied** |
| Data after the V13.6.2 smoke test | 7 players, 7 identities (2 of them guest), 6 farms - nothing reset |

V13.6.1 added `0014_one_farm_per_player.sql`: a unique index on `farms(owner_player_id)`, so a phone
that retries "create my farm" cannot end up with two farms - and with its gold and crops on the one it
cannot see. `CreateFarm` also looks for the player's farm before creating one, and answers `200`
(rather than `201`) when it finds it.

V13.6.2 added `0015_player_identities.sql`: the multi-identity table (`packages`-level model in
`packages/domain/src/identity.ts`). It is additive - `players` keeps its columns and its
`(auth_issuer, auth_subject)` pair as the primary identity - and it backfilled all 5 players that
existed at migration time as `CLOUDFLARE_ACCESS` identities, verified before the deploy (`5 players,
5 identities, 4 farms`). The two guest players created by the live smoke test are the first two
`GUEST` rows.

The database existed from the earlier alpha and was at `0009` before V13.6. V13.6 applied `0010`,
`0011`, `0012` and `0013` through the repository's own workflow, V13.6.1 applied `0014`, and V13.6.2
applied `0015`; nothing was altered by hand and no data was deleted. Existing testers keep their
farms.

### A migration bug V13.6 found and fixed

`0012_world_objects.sql` used `/* ... */` block comments, two of which contained a `;`. Wrangler's
statement splitter does not understand block comments, so it split a statement in half and the remote
database was sent an incomplete query:

```text
incomplete input: SQLITE_ERROR [code: 7500]
```

The repository's own tests never saw it, because Node's SQLite `exec` understands block comments
perfectly. `0012` is now commented with `--` line comments only (identical SQL - comments are not
schema), and the file carries a note explaining why. **Rule for new migrations: use `--` comments,
never `/* */`, and never a `;` inside a comment.**

## Deploying

```bash
# 1. The gates (all must pass; never deploy a known-broken build)
npm run typecheck && npm run lint && npm test
npm run assets:validate && npm run check:staging-config
npm run build                     # writes apps/web/dist, which the Worker serves
npm run build:worker:staging      # dry run of the Worker bundle

# 2. Migrations, if any are pending
npx wrangler d1 migrations list happy-farm-staging --remote --config workers/api/wrangler.staging.toml
npx wrangler d1 migrations apply happy-farm-staging --remote --config workers/api/wrangler.staging.toml

# 3. Deploy staging only - never the production config
npx wrangler deploy --config workers/api/wrangler.staging.toml
```

Authentication is `npx wrangler login` (an OAuth session), or `CLOUDFLARE_API_TOKEN` in CI. The token
needs Workers Scripts: Edit and D1: Edit for this account. A rare `7403 "account is not valid or is
not authorized"` from the D1 endpoint has been seen and cleared by simply retrying the command.

**Order matters for V13.6.2**: this Worker's onboarding writes to `player_identities`, so migration
`0015` must be applied *before* this version is deployed. Deploying the code first would leave every
authenticated request answering `NOT_AUTHENTICATED` (the identity write fails, and the authenticator
fails closed) until the migration lands. Apply migrations, then deploy.

Prerequisites that already exist in this account: the `happy-farm-staging` Worker and D1 database.
`npx wrangler d1 create happy-farm-staging` is only needed if the database is ever deleted.

## Rolling back

```bash
# What is deployed, and what came before
npx wrangler versions list --config workers/api/wrangler.staging.toml

# Put an earlier Worker version back (assets included - they are part of the version)
npx wrangler rollback <version-id> --config workers/api/wrangler.staging.toml
```

The Worker that was live before V13.6.2 is recoverable this way (`7df79218-...`, V13.6.1).
**Database migrations do not roll back** - they are additive and forward-only, as the project's
migration policy requires - so a rollback of the Worker to a pre-`0015` build against a migrated
database is not a supported state. If that is ever needed, the safe move is a new forward migration,
not a downgrade.

## Verifying a deploy

```bash
BASE=https://happy-farm-staging.duclong-reg.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' $BASE/                     # 200, the app shell
curl -s -o /dev/null -w '%{http_code}\n' $BASE/some/client/route    # 200, the SPA fallback
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/health           # 200, the Worker is alive
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/shop             # 401, no cookie and no JWT

# A whole guest session, with its own cookie jar
JAR=$(mktemp); curl -s -c $JAR -o /dev/null -w '%{http_code}\n' $BASE/api/session   # 200, sets hf_guest
curl -s -b $JAR $BASE/api/session                                                   # same player id
```

The character model is served as a hashed asset; find its name in `apps/web/dist/index.html` or the
build output (`player-farmer-*.glb`, 253,400 bytes, `model/gltf-binary`). It is fetched lazily and
never blocks startup: if it 404s, the game still plays with the placeholder character.

## Known limitations

* **Both hostnames are public**, which is the intended alpha policy but also means two public entry
  points into the same data. They share one database; if the alpha ever needs to be closed, the Access
  application (or a Cloudflare route) is the lever, and it has to be applied to each hostname.
* **Guest progress depends on keeping the guest credential.** Clearing site data, a private window,
  or a different browser makes a new guest; there is no account-linking or recovery path yet, so the
  old farm becomes unreachable. Documented for testers in `docs/qa/MULTI_USER_ALPHA.md`.
* **Guest creation is not rate-limited by the application.** The public URL can be scripted to mint
  players, bounded only by Cloudflare's platform protections. Acceptable for an invited alpha;
  a launch would need a limit (rate limiting rule, Turnstile, or a per-IP creation cap).
* The `workers.dev` hostname is reachable whenever the Worker is; it is not on Access. It is,
  intentionally, the same policy as the intended public custom domain - but it is a second public
  entry point an operator should be aware of and can disable with a Cloudflare route if needed.
* **Guest identity is per hostname.** The `hf_guest` cookie is set with `Path=/` and no `Domain`, so a
  guest on `workers.dev` is a different guest from one on the custom domain. Testers who switch
  hostnames get a new farm (their old one still exists, addressed only by the old cookie). Choose one
  URL per playtest; when the custom domain is made public, hand that one out from the start.
* Staging is the only deployed environment. There is no production deployment, and the production
  config still carries the local placeholder database - do not deploy it.
* `STARTER_GRANT_POLICY = "ALL_UNRECEIPTED"` is set on staging so earlier alpha testers receive the
  starter package once. Production leaves it unset; that difference is intentional.
* The migrations are forward-only (see "Rolling back").
