# Deployment: staging on Cloudflare Free

Status: repository foundation complete. `workers/api/wrangler.staging.toml` carries real values for
the Access team domain, the Access audience and the staging D1 database id - `npm run
check:staging-config` reports no remaining placeholders - but **the remote state behind those values
has not been verified from this repository**: whether the Worker, the D1 database and the Access
application exist, which migrations the remote database has applied, and whether anything is
currently deployed can only be answered by a machine with Wrangler credentials and network access.
Everything below the "USER ACTION REQUIRED" heading is for a human with dashboard access.

## Topology

```text
                       Cloudflare Access (Zero Trust, free tier)
                                    │  challenge + signed JWT
                                    ▼
                    happy-farm-staging Worker   (workers/api/wrangler.staging.toml)
                                    │  main = src/index.ts
                       ┌────────────┴─────────────┐
                       │                          │
                 /api/*                    everything else
                       │                          │
                       ▼                          ▼
              API handler                  Cloudflare Static Assets
        (prefix stripped once,              apps/web/dist: SPA shell,
         workers/api/src/…                  hashed JS/CSS, GLB models,
         staging-routing.ts)                single-page-application fallback
                       │
                       ▼
              happy-farm-staging D1
```

One origin, no CORS: the browser keeps `API_BASE = "/api"` and is served by the same Worker that
owns the API. Cloudflare Access sits in front of the whole Worker, so an unauthenticated visitor is
challenged before they can load the SPA or call the API.

## Identity

| Question | Answer |
| --- | --- |
| What authenticates a visitor? | Cloudflare Access, via the `Cf-Access-Jwt-Assertion` request header |
| What is verified? | RS256 signature against the team's JWKS, `iss` = team domain, `aud` = the Access application, `exp`/`nbf` (60 s skew) |
| What is never trusted? | email headers, custom headers, cookies, query strings, request bodies, or any client-supplied id |
| How does an Access user become a player? | `player_<uuid>` derived by SHA-256 over `(issuer, subject)`; the same person always maps to the same id and the id contains no PII |
| What happens on a first visit? | the verified visitor's Player row is created once, and the one-time starter package is applied (`player-onboarding.ts` + `GrantStarterPackage`): 10 carrot seeds and 100 gold, ledgered as one `STARTER_GRANT` currency mutation. No farm is created |
| What if configuration is missing? | every authenticated route answers `NOT_AUTHENTICATED` (fail-closed, no fallback) |

## The starter package on staging

Every new visitor receives the package exactly once, because the receipt
(`starter_grants(player_id, grant_key)`) is the primary key of the grant. The alpha testers were
created before the package existed, so staging also sets:

```toml
STARTER_GRANT_POLICY = "ALL_UNRECEIPTED"
```

That offers the package to an existing player who has no receipt - still once, still by the same
primary key. **Production leaves this unset**, so a production deployment only ever grants it to a
player whose row that request creates and never touches an existing balance. The policy is read by
`readStarterGrantPolicy`; anything unrecognised, including absence, is the safe default.

For a tester who never signs in again, apply the package from the operator's machine:

```bash
# Dry run: prints how many players have no receipt. Writes nothing.
node scripts/repair/starter-package-backfill.mjs

# Apply it.
node scripts/repair/starter-package-backfill.mjs --apply
```

The script reads the package out of game data rather than restating it, refuses any database or
config other than `happy-farm-staging` with `workers/api/wrangler.staging.toml`, and inserts the same
receipt the game writes - so it cannot credit a player by a path the game would not take.

The development bridge (`dev-auth.ts`, `dev-index.ts`, `workers/api/dev/**`, `/__dev/bootstrap`) is
not in the deployed entrypoint's import graph and cannot exist in a deployment built from it.

## Environments

| | Entrypoint | Config | Database | Auth | Web |
| --- | --- | --- | --- | --- | --- |
| Local | `workers/api/src/dev-index.ts` | `workers/api/wrangler.dev.toml` | `happy-farm-local` (local SQLite) | dev bearer token | Vite dev server + `/api` proxy |
| Staging | `workers/api/src/index.ts` | `workers/api/wrangler.staging.toml` | `happy-farm-staging` | Cloudflare Access | same Worker, `[assets]` → `apps/web/dist` |
| Production | not configured | `workers/api/wrangler.toml` (placeholder local DB) | — | — | — |

Production is **not** set up: `workers/api/wrangler.toml` still carries the local placeholder
database and no Access configuration. Do not treat it as deployable.

## USER ACTION REQUIRED

Do these in order. Nothing here has been done for you, and no value should be committed.

1. **Authenticate Wrangler with an account that has D1 and Workers access.**

   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

   The audit environment's token could not list D1 (`Authentication error [code: 10000]`), so this
   is the first thing to confirm.

2. **Confirm the staging database.** `workers/api/wrangler.staging.toml` already names
   `happy-farm-staging` and carries a database id, so create one only if that id is not the real one:

   ```bash
   npx wrangler d1 list
   npx wrangler d1 create happy-farm-staging
   ```

   If a new id is returned, paste it over the `database_id` in
   `workers/api/wrangler.staging.toml`. The id is not a secret, but it must be the real one: a deploy
   bound to a name that does not exist fails loudly, which is the point.

3. **Confirm the Cloudflare Access application** (Zero Trust → Access → Applications → Self-hosted)
   for the staging hostname, with a policy that allows only the 2–3 tester emails. Both of the values
   below are already committed in `workers/api/wrangler.staging.toml`; re-copy them only if the
   application has been recreated:

   * the **team domain** (`https://<team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN`
   * the **application audience (AUD) tag** → `ACCESS_AUD`

4. **Apply migrations to staging** after your own review, with the approval the task workflow
   requires:

   ```bash
   npx wrangler d1 migrations list happy-farm-staging --config workers/api/wrangler.staging.toml
   npx wrangler d1 migrations apply happy-farm-staging --config workers/api/wrangler.staging.toml
   ```

   Expected, as of V13.6: `0001` ... `0013` are all applied. On a fresh database all thirteen are
   pending; the staging database was at `0009` when V13.6 ran and needed `0010` ... `0013` (see
   `docs/deployment/STAGING.md` for what was applied and when). Never rewrite an applied migration -
   and use `--` comments rather than block comments in a migration: a `;` inside a block comment
   breaks the Wrangler statement splitter (`incomplete input: SQLITE_ERROR [code: 7500]`), which is the bug
   V13.6 hit and fixed in `0012_world_objects.sql`.
   `0009_starter_package.sql` rebuilds `economy_ledger` to admit the `STARTER_GRANT` reason and
   generalizes the starter receipt; it moves schema and carries old seed-only receipts forward, and
   it grants nothing by itself. `0010_farm_constructions.sql` adds `farm_constructions` with its
   ownership and collision triggers and rebuilds `economy_ledger` once more to admit the
   `CONSTRUCTION` reason.

5. **Check the configuration is no longer a template**, then build and deploy:

   ```bash
   npm run check:staging-config
   npm run build            # builds apps/web/dist, which the Worker serves
   npm run build:worker:staging
   npx wrangler deploy --config workers/api/wrangler.staging.toml
   ```

6. **Set a Worker route/domain** for the staging hostname if the deploy does not create one, then
   put the same hostname in the Access application so Access protects the SPA and the API together.

7. **Verify as a tester**: open the staging URL in a private window, complete the Access challenge,
   and confirm the HUD shows **100 gold and 10 carrot seeds** before anything is planted. Reload
   twice and confirm neither number moves. Confirm a second tester gets a *different* player with
   their own farm and their own 100 gold.

## What the repository already guarantees

* `/api/*` is routed to the API, everything else to static assets, and the prefix is stripped in one
  tested place (`workers/api/src/staging-routing.ts`).
* An unknown API route returns the API's JSON 404, never the SPA shell.
* Access JWTs are verified cryptographically; a forged, expired, wrong-issuer, wrong-audience, or
  wrong-algorithm token resolves to no actor.
* Two Access subjects map to two different players, and one subject always maps to the same player.
* Missing Access configuration, or a JWKS that cannot be fetched, fails closed.
* The deployed bundle contains no `DEV_AUTH_TOKEN`, no `__dev/bootstrap`, no `localhost`, and no
  filesystem path.

## Not verified

```text
REAL_CLOUDFLARE_ACCESS: PARTIAL        (the team domain answers; an Access application covering the
                                        staging hostname does not exist yet, so the API answers 401 -
                                        this is the one step left before a phone can play)
REMOTE D1 STAGING:      VERIFIED       (happy-farm-staging exists with the committed id and now has
                                        migrations 0001 - 0013 applied; 5 players and 4 farms kept)
STAGING DEPLOY:         VERIFIED       (V13.6 deployed happy-farm-staging from wrangler.staging.toml;
                                        see docs/deployment/STAGING.md for the version id and URL)
BROWSER ON STAGING:     NOT VERIFIED   (asset, API and bundle smoke tests ran over HTTPS from this
                                        environment; no browser session was available)
```

The automated tests use a deterministic JWKS fixture and the real verification code path; they are
not a substitute for one pass behind a real Access application.
