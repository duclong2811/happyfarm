# HappyFarm Three.js geometry hotfix — staging deployment

Date: 2026-10-11 (Asia/Seoul)  
Target Worker: `happy-farm-staging`  
Target D1: `acc598c9-e726-46c8-b1a3-23e5b6a42d52`  
Remote migration ledger: `0031_aquaculture_pond_cycle.sql`

## Verdict

`GEOMETRY_HOTFIX_DEPLOYED_NEEDS_BROWSER_PROOF`

The validated empty-world terrain guard was deployed to staging only. Public HTTP checks passed.
No migration, production deployment, economy change, reset, stash, clean, commit, or push was
performed.

## Deployment

- Worker: `happy-farm-staging`
- Deployment/version ID: `9c2792cd-c0ba-46a1-bf89-cf1e076e3bea`
- Deployment URL: `https://happy-farm-staging.duclong-reg.workers.dev`
- Public hostname: `https://happyfarm-staging.longfx.trade/`
- Wrangler config: `workers/api/wrangler.staging.toml`
- D1 binding: `happy-farm-staging` / `acc598c9-e726-46c8-b1a3-23e5b6a42d52`

The staging dry-run read 84 frontend assets and resolved only the staging D1, staging Assets
binding, staging Access variables, and staging guest-auth variables. No production configuration
was used.

## Source change verification

The root cause fix is present at `apps/web/src/render/terrain.ts:929`:

```ts
if (world.outer === null) return null;
```

This prevents `EMPTY_WORLD` from reaching island terrain height sampling before a valid world exists.
The focused regression is test-only at `tests/web/geometry-finiteness.test.ts:65` and proves empty-world
terrain is not built while starter geometry has finite positions and bounding spheres.

Hotfix source SHA-256:

```text
FEAD82763D5F1AD03734047DBCADD21ABA9765FCE313B56A94F84AB33A0BAD21  apps/web/src/render/terrain.ts
D9729DC56E1491FF8C9F8F4AE8DE1B4D036F2F0CDDB0C71EDF17DDCBE088D0A1  tests/web/geometry-finiteness.test.ts
```

The previously deployed staging source anchors for the Worker, scene, API, bootstrap instrumentation,
staging config, and package manifest were unchanged. The intentionally dirty working tree was
preserved; generated output and tests were not treated as production source. No unrelated source
refactor was made for this hotfix.

## Validation

- Focused geometry/bootstrap suites: 6 files, 34 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run build:worker:staging`: passed; staging D1 and Assets bindings resolved.
- `git diff --check`: passed; existing LF/CRLF normalization warnings only.
- Existing asset validation: 79 GLB assets checked with finite geometry positions; passed before
  deployment.

The build emitted the existing non-fatal Zod annotation warnings and large-main-chunk warning.

## Public smoke checks

- Site root: HTTP 200, HTML, 18,427 bytes.
- `/api/health`: HTTP 200, `{"ok":true,"data":{"status":"ok"}}`.
- `/assets/index-29m60_gr.js`: HTTP 200, JavaScript, 1,237,316 bytes.
- `/assets/index-C7SfOP_q.css`: HTTP 200, CSS, 43,836 bytes.
- Unauthenticated `/api/shop`: HTTP 401.

## Browser verification

No browser surface was available in the execution environment (`apps=[]`, `browsers=[]`). Therefore
the following were not executed and have no fabricated result:

- first page load and empty-world startup;
- populated Farm startup and terrain appearance;
- camera and player movement;
- browser Console check for `THREE.BufferGeometry.computeBoundingSphere()` NaN errors.

An authenticated staging account was not used. Public HTTP success is not evidence of authenticated
gameplay or D1-backed Farm rendering.

## Remaining issues

Run an authenticated browser pass at
`https://happyfarm-staging.longfx.trade/?perf=1` and verify empty-world startup, populated Farm
terrain, camera/movement, and the absence of Three.js NaN errors. Existing gameplay/performance
browser evidence remains pending from the earlier staging release.
