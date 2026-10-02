# Staging: the playtest environment

Status: **deployed and smoke-tested** (V13.6, redeployed for V13.6.1), with one step still to do
before a phone can play - the Cloudflare Access application for the staging hostname. See "The one
remaining step" below, and `docs/qa/MULTI_USER_ALPHA.md` for the tester-facing version of it.

This is a mobile playtest environment, not a launch. `docs/deployment.md` is the older, wider
checklist; this file is the current state of the deployment and how to operate it.

## The URL

```text
https://happy-farm-staging.duclong-reg.workers.dev
```

Worker `happy-farm-staging`, version `279a8ce2-b03a-459c-a7ca-9be114ac8bb2`, deployed 2026-10-02 from
commit `b23498d` (V13.5) with the V13.6 migration-comment fix.

## Architecture

```text
                    Cloudflare Access (Zero Trust)   <-- NOT YET APPLIED to the hostname above
                              │  challenge + signed JWT
                              ▼
        happy-farm-staging Worker   (workers/api/wrangler.staging.toml)
                              │  main = src/index.ts
              ┌───────────────┴───────────────┐
              ▼                               ▼
        /api/*   (prefix stripped once)   everything else
              │                               │
              ▼                               ▼
        API handler                Cloudflare Static Assets (ASSETS)
        workers/api/src/handler.ts  apps/web/dist: SPA shell, hashed JS/CSS,
              │                     GLB models, single-page fallback
              ▼
        happy-farm-staging D1  (binding DB)
```

One origin, so there is **no CORS**: the browser uses `API_BASE = "/api"` (`apps/web/src/api.ts`) and
is served by the same Worker that owns the API. Nothing in the shipped bundle refers to `localhost`,
`127.0.0.1`, a dev-server port or a filesystem path - verified against the deployed JS in V13.6, not
only against the source.

## Environments

| | Entrypoint | Config | Database | Identity |
| --- | --- | --- | --- | --- |
| Local dev | `workers/api/src/dev-index.ts` | `wrangler.dev.toml` | `happy-farm-local` (local SQLite) | dev bearer token via the Vite proxy |
| **Staging** | `workers/api/src/index.ts` | `wrangler.staging.toml` | `happy-farm-staging` (D1, binding `DB`) | Cloudflare Access JWT |
| Production | not configured | `wrangler.toml` (local placeholder) | - | - |

The development bridge (`dev-auth.ts`, `dev-index.ts`, `workers/api/dev/**`) is not in the deployed
entrypoint's import graph: it cannot exist in a Worker built from the staging config, and the deployed
bundle was checked for it.

## Identity: what works and what is missing

Identity on staging is **Cloudflare Access**, and the API authenticates only the
`Cf-Access-Jwt-Assertion` header that Access injects (RS256 verified against the team's JWKS). The
browser sends no credential of its own, by design.

* The Zero Trust **team** exists: `https://dawn-field-0231.cloudflareaccess.com` answers.
* The values in `wrangler.staging.toml` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) are the real ones, and
  the API fails **closed** without a valid JWT - verified: `GET /api/shop` on the deployed Worker
  answers **401** with no identity.
* **There is no Access application covering the staging hostname yet.** An unauthenticated request to
  `/` returns the app shell (200) rather than an Access challenge, which is how V13.6 proved it.

### The one remaining step (needs the Cloudflare dashboard)

Until this is done, a phone will load the shell and then fail every API call with
`NOT_AUTHENTICATED`: the world never loads, and no farm is created.

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Application domain: `happy-farm-staging.duclong-reg.workers.dev` (or a custom domain, see below).
3. Policy: **Allow**, with the tester emails (2-3 people is plenty).
4. Copy the application's **Audience (AUD)** tag if it differs from the committed one, and its team
   domain, into `workers/api/wrangler.staging.toml`, then redeploy (the commands below).
5. `npm run check:staging-config` to confirm no placeholder remains.

Optional but recommended for a phone: attach a **custom domain** to the Worker (Workers → the
`happy-farm-staging` service → Settings → Domains & Routes) and put *that* hostname in the Access
application. `*.workers.dev` hostnames are perfectly functional; a custom domain is simply easier to
type and to hand to a tester.

## Database

| | |
| --- | --- |
| Binding | `DB` |
| Database | `happy-farm-staging` |
| Id | `acc598c9-e726-46c8-b1a3-23e5b6a42d52` (committed in `wrangler.staging.toml`; not a secret) |
| Migrations | **0001 - 0013 applied** (V13.6) |
| Data at deploy time | 5 players, 4 farms, 80 tiles - preserved, not reset |

V13.6.1 added `0014_one_farm_per_player.sql`: a unique index on `farms(owner_player_id)`, so a phone
that retries "create my farm" cannot end up with two farms - and with its gold and crops on the one it
cannot see. The index was safe to add because no staging player owned more than one farm (4 farms, 4
owner memberships, 0 duplicates). `CreateFarm` also looks for the player's farm before creating one,
and answers `200` (rather than `201`) when it finds it.

The database existed from the earlier alpha and was at `0009`. V13.6 applied `0010`, `0011`, `0012`
and `0013` through the repository's own workflow; nothing was altered by hand, and no data was
deleted. Existing testers keep their farms, and their first read after the deploy seeds the V13.3
starter world objects onto them (that is the designed migration path, not a reset).

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

# 2. Migrations, if any are pending (see below)
npx wrangler d1 migrations list happy-farm-staging --remote --config workers/api/wrangler.staging.toml
npx wrangler d1 migrations apply happy-farm-staging --remote --config workers/api/wrangler.staging.toml

# 3. Deploy staging only - never the production config
npx wrangler deploy --config workers/api/wrangler.staging.toml
```

Authentication for step 3 is `npx wrangler login` (an OAuth session), or `CLOUDFLARE_API_TOKEN` in
CI. The token needs Workers Scripts: Edit and D1: Edit for this account.

Prerequisites that already exist in this account: the `happy-farm-staging` Worker and D1 database.
`npx wrangler d1 create happy-farm-staging` is only needed if the database is ever deleted.

## Rolling back

```bash
# What is deployed, and what came before
npx wrangler versions list --config workers/api/wrangler.staging.toml

# Put an earlier Worker version back (assets included - they are part of the version)
npx wrangler rollback <version-id> --config workers/api/wrangler.staging.toml
```

The Worker that was live before V13.6 is recoverable this way. **Database migrations do not roll
back** - they are additive and forward-only, as the project's migration policy requires - so a
rollback of the Worker to a pre-V13 build against a migrated database is not a supported state. If
that is ever needed, the safe move is a new forward migration, not a downgrade.

## Verifying a deploy

```bash
BASE=https://happy-farm-staging.duclong-reg.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' $BASE/                     # 200, the app shell
curl -s -o /dev/null -w '%{http_code}\n' $BASE/some/client/route    # 200, the SPA fallback
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/health           # 200, the Worker is alive
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/shop             # 401 until Access is in front
```

The character model is served as a hashed asset; find its name in `apps/web/dist/index.html` or the
build output (`player-farmer-*.glb`, 253,400 bytes, `model/gltf-binary`). It is fetched lazily and
never blocks startup: if it 404s, the game still plays with the placeholder character.

## Known limitations

* **Access is not yet applied to the hostname**, so the API answers 401 and a phone cannot play. This
  is the only thing standing between this deployment and a real-device test.
* The `workers.dev` URL is the staging URL; there is no custom domain yet.
* Staging is the only deployed environment. There is no production deployment, and the production
  config still carries the local placeholder database - do not deploy it.
* `STARTER_GRANT_POLICY = "ALL_UNRECEIPTED"` is set on staging so the earlier alpha testers receive
  the starter package once. Production leaves it unset; that difference is intentional.
* The migrations are forward-only (see "Rolling back").
