# Deployment: staging on Cloudflare Free

Status: repository foundation complete; Cloudflare resources are not created yet, so nothing has
been deployed. Everything below the "USER ACTION REQUIRED" heading is for a human with dashboard
access.

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
| What happens on a first visit? | the verified visitor's Player row is created once (`player-onboarding.ts`); no wallet, farm, item, or reward is created |
| What if configuration is missing? | every authenticated route answers `NOT_AUTHENTICATED` (fail-closed, no fallback) |

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

2. **Create the staging database** and keep the returned id:

   ```bash
   npx wrangler d1 create happy-farm-staging
   ```

   Paste the id over `REPLACE_WITH_STAGING_D1_ID` in
   `workers/api/wrangler.staging.toml`. The id is not a secret, but it must be the real one; the
   sentinel exists so a deploy fails loudly instead of binding somewhere else.

3. **Create the Cloudflare Access application** (Zero Trust → Access → Applications → Self-hosted)
   for the staging hostname, with a policy that allows only the 2–3 tester emails. Copy:

   * the **team domain** (`https://<team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN`
   * the **application audience (AUD) tag** → `ACCESS_AUD`

4. **Apply migrations to staging** after your own review, with the approval the task workflow
   requires:

   ```bash
   npx wrangler d1 migrations list happy-farm-staging --config workers/api/wrangler.staging.toml
   npx wrangler d1 migrations apply happy-farm-staging --config workers/api/wrangler.staging.toml
   ```

   Expected: `0001` … `0008`, all pending on a fresh database. Never rewrite an applied migration.

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
   confirm the farm loads, and confirm a second tester gets a *different* player (their own farm and
   their own gold).

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
REAL_CLOUDFLARE_ACCESS: NOT VERIFIED   (no team domain/AUD exists yet)
REMOTE D1 STAGING:      NOT VERIFIED   (database not created; Wrangler API access failed)
STAGING DEPLOY:         NOT PERFORMED  (no deploy in this task)
BROWSER ON STAGING:     NOT VERIFIED
```

The automated tests use a deterministic JWKS fixture and the real verification code path; they are
not a substitute for one pass behind a real Access application.
