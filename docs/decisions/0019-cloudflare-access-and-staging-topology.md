# 0019 - Cloudflare Access authentication and the staging topology

Status: implemented (repository foundation). No Cloudflare resource has been created and nothing has
been deployed, so remote behaviour is unverified. See `docs/deployment.md` for the operator checklist.

## Context

The pre-deployment audit found three blockers for a playable alpha on Cloudflare:

```text
PLAYABLE_STAGING_AUTH_MISSING        public staging had no identity mechanism at all
STAGING_D1_NOT_CONFIGURED            no staging database boundary existed
DEPLOYED_WEB_TO_API_PATH_UNDEFINED   the web bundle assumed a same-origin /api that nothing served
```

The deployed entrypoint wired `UnconfiguredAuthenticator`, which is correct as a fail-closed default
and useless as a product: every protected route answered `NOT_AUTHENTICATED`, so no tester could
create or load a farm. The web bundle was a separate static build with no deployable route to the
API, and the only API hosting that existed was the Vite development proxy.

## Decision

### Identity comes from Cloudflare Access, verified in the Worker

`workers/api/src/access-auth.ts` reads `Cf-Access-Jwt-Assertion` and proves it before believing
anything in it: RS256 signature against the team's published JWKS
(`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached, `kid`-matched), `iss` equal to
the configured team domain, `aud` containing the configured Access application, and a valid
`exp`/`nbf` window with 60 seconds of clock skew. `alg` must be `RS256`, so a token cannot ask for
`none` or an HMAC algorithm.

The edge challenge and the Worker verification are two different things and both are required:
Access decides who may reach the application, and the Worker decides which HappyFarm player a
request belongs to. A forged header, a cookie, an email header, a query parameter, or a body field
never becomes an identity.

### The Access subject maps to a HappyFarm player deterministically

`player_<uuid>` is derived by SHA-256 over `("happy-farm/access", issuer, subject)` with UUIDv5-style
version and variant bits. The same Access subject always produces the same id, two subjects produce
different ids, and the id contains no PII - no email, no display name, no subject text.

`workers/api/src/player-onboarding.ts` then makes the identity durable: a verified visitor without a
Player row gets exactly one, and nothing else. That is the production counterpart of the development
bootstrap, and it is why the browser no longer needs a bootstrap call at all.

### Configuration is fail-closed

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are required. A missing, blank, non-HTTPS, non-
`*.cloudflareaccess.com`, path-carrying, or audience-less configuration resolves to "no
authenticator", and every protected request answers `NOT_AUTHENTICATED`. There is no fallback to the
development bridge, and the deployed entrypoint cannot reach it: `tests/api/staging-routing.test.ts`
walks its import graph and fails if `dev-auth`, `dev-index`, `workers/api/dev/**`, `DEV_AUTH*` or
`/__dev/bootstrap` appears in it.

### One Worker serves the SPA and the API on one origin

Cloudflare's static asset binding (`[assets]` in `wrangler.staging.toml`, `binding = "ASSETS"`,
`not_found_handling = "single-page-application"`) serves `apps/web/dist`: the SPA shell, hashed JS
and CSS, and the generated GLB models. The Worker runs first and routes `/api/*` to the existing
handler, stripping the prefix once in `staging-routing.ts`; everything else is handed to the asset
binding, including the SPA fallback. An unknown `/api/...` route therefore returns the API's JSON
404 and never the HTML shell. The browser keeps `API_BASE = "/api"` and there is no CORS to
configure, because there is one origin.

### The staging database is its own boundary

`workers/api/wrangler.staging.toml` names `happy-farm-staging`, points at `src/index.ts`, binds the
static assets, and declares the Access variables as sentinels. Its `database_id` is a sentinel rather
than an invented UUID, so a deploy fails loudly until an operator pastes the id Cloudflare returned;
`npm run check:staging-config` reports exactly what is still missing. The production configuration
is untouched and still holds the local placeholder: production is not configured, and the repository
does not pretend otherwise.

## Consequences

- **No gameplay, economy, contract, or schema change.** The only new persistence is the idempotent
  Player row a verified visitor needs before their first command.
- **The development bridge keeps working and stays where it belongs.** The browser no longer knows a
  development route exists; the dev host performs the same onboarding server-side.
- **The alpha is a hostname plus two values away.** Everything the repository can decide is decided;
  what remains is Cloudflare account work that needs a human (`docs/deployment.md`).
- **Unverified until someone runs it.** Deterministic tests use a JWKS fixture and the real
  verification code path; they are not a substitute for one pass behind a real Access application.
