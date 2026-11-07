# HappyFarm non-blocking bootstrap — staging deployment

Date: 2026-10-11 (Asia/Seoul)  
Target: `happy-farm-staging`  
D1: `acc598c9-e726-46c8-b1a3-23e5b6a42d52`  
Migration state: remote ledger ends at `31 / 0031_aquaculture_pond_cycle.sql`

## Verdict

`BOOT_OPTIMIZATION_DEPLOYED_NEEDS_BROWSER_PROOF`

The validated non-blocking bootstrap was deployed to staging only. Public HTTP checks passed. An
authenticated browser was unavailable, so real startup timing and gameplay verification remain open.

## Deployment

- Worker: `happy-farm-staging`
- Deployment/version ID: `84ad39bf-1778-41c2-ad4f-01262e2db45f`
- Worker URL: `https://happy-farm-staging.duclong-reg.workers.dev`
- Public hostname checked: `https://happyfarm-staging.longfx.trade/`
- Frontend asset identity: `/assets/index-DsUXlZSt.js`
- Wrangler staging dry run read 84 asset files and bound only `happy-farm-staging` D1 plus staging
  Assets/vars.

No Production deployment, remote migration, commit, push, reset, stash, clean, or database restore was
performed.

## Preflight and source snapshot

- Cloudflare account authentication succeeded with the deployment-capable account.
- Remote D1 SQL inspection confirmed the full schema and `d1_migrations` rows 29, 30, and 31.
- `wrangler d1 list` reported a stale `num_tables 0` summary, inconsistent with the authoritative SQL
  result; the actual remote schema query returned all expected tables, indexes, and triggers.
- The working tree intentionally remained dirty: 267 status entries before deployment. No cleanup or
  unrelated-file deletion was performed.
- The staging config points to the exact Worker and D1 identities above.

Relevant source SHA-256 snapshot used for the build:

```text
1F693BDB746F847DE724AA91F5F0C8CF2308C97701E1EB2FB64C5C90F70015  apps/web/src/main.ts
B8E39773045AE35FC4B8DD9DCA9BF3A958C4C9FB3AB5F59559955F2D4155878E  apps/web/src/boot-performance.ts
0E6FA11D2A7D0D9DFE341F0FC1E6E1F9641692C561A71F20EDD7DACF318B702D  apps/web/src/api.ts
32BEAC90F6A301E44649D05A4738286C0D7186FB32BD15FF23D7FA963AD58A7B  apps/web/src/render/scene.ts
AC559BF5DFCCDA8D9052FE8F0EA357E27D666AEA01FA67EB20425F53C25E1817  apps/web/src/i18n.ts
1057B8575C009CB976C67D59E195016D6E54271A3B9BD5182696E061E5BC4983  workers/api/src/index.ts
F848742711C1E54154CB6ECB0339520AAA42EE43D28A2718AA914FA8336759AC  workers/api/wrangler.staging.toml
493079D911BF485C5BEC2C1CFE40FBC012B7E68DF105DCA2D2BEDBA91B4D7FCD  package.json
```

## Validation

- Existing validated regression suite: 25 files / 175 tests passed.
- Existing validated bootstrap suite: 6 files / 30 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run build:worker:staging`: passed.
- `git diff --check`: passed; only existing LF/CRLF normalization warnings were emitted.

## Public smoke tests

- `/`: HTTP 200, 18,794 bytes.
- `/api/health`: HTTP 200, body `{"ok":true,"data":{"status":"ok"}}`.
- `/assets/index-DsUXlZSt.js`: HTTP 200, 1,237,286 bytes, JavaScript.
- `/assets/index-C7SfOP_q.css`: HTTP 200, 43,836 bytes, CSS.
- Unauthenticated `/api/shop`: HTTP 401.
- No browser console/runtime-error inspection was possible without a browser session.

## Browser performance and authentication

No authenticated browser was available in the execution environment. Therefore these marks have no
fabricated values:

`session_resolved`, `farm_loaded`, `renderer_init_started`, `first_3d_frame`, `reconcile_started`,
`reconcile_finished`, `warehouse_ready`, `game_interactive`.

The required next test is an authenticated visit to:

`https://happyfarm-staging.longfx.trade/?perf=1`

Capture browser Performance and Network data, then verify the Farm, Warehouse, existing player state,
offline return summary, delayed/failed reconciliation behavior, and protected endpoint handling.

## Remaining risks

- Authenticated first-load and hidden-to-visible gameplay are not verified after this deployment.
- Offline reward credit, authoritative Warehouse refresh, duplicate reconciliation prevention, failed
  reconciliation recovery, economic gating, and no-idle-polling were validated by source-level and
  integration tests, but still need one real authenticated staging gameplay pass.
- Build retains the known large main JS chunk warning; this deployment does not attempt a bundle
  refactor.
