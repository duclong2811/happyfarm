# Brief: Island Generator v2 - prettier, more complete, more playable islands

Owner request (2026-11-18): "Các đảo phải đẹp hơn: kiểu dáng, map, độ hoàn chỉnh. Ví dụ đảo Thủy có vùng
biển nông và biển sâu: biển nông đi lại và nuôi cá được, biển sâu thì đánh cá. Đảo Thủy hiện đi lại hơi khó.
Có thể nghiên cứu những game tương tự."

Read `AGENTS.md` and `docs/CONTEXT_INDEX.md` first. Work on branch `world/island-generator` (or a branch
from it). Commit with the session's attribution lines; push when asked.

## Where things stand (v1)

- `packages/game-data/src/world/island-generator.ts` (265 lines): one recipe per element
  (`THO`, `KIM`, `MOC`, `THUY`, `HOA`) x six outlines (`ROUND`, `LONG`, `CRESCENT`, `TWIN`, `ATOLL`,
  `ARCHIPELAGO`), deterministic from `{ element, outline, seed }`. A 96x96 grid of cells
  `DEEP | SHALLOW | SAND | GRASS | FOREST | ROCK | MEADOW | FIELD` plus sites
  `ORE | TREE | FISH_BAY | PASTURE | DOCK | CAMP`. It is CPU-budgeted for the Workers free tier
  (10 ms per request): now about 3-4 ms, using summed-area tables. Keep it under about 5 ms.
- `packages/game-data/src/world/island-ground.ts`: `buildIslandGround` stores the result per farm in
  `farm_islands` (migration 0042) as one character per cell plus sites JSON, with
  `generator_version = 1`. **A stored island never depends on the generator again**: existing farms keep
  v1 forever. A new generator is `ISLAND_GENERATOR_VERSION = 2` for new farms only. Keep v1 importable
  (or its stored cells readable) so v1 farms still draw and validate. `tests/game-data/island-generator.test.ts`
  holds a fingerprint of v1 output: do not change v1's output.
- Server rules read the stored ground: `classifyIslandTile` / `islandGroundCapabilities`
  (`island-ground.ts`), wrapped per farm in `workers/api/src/runtime.ts` (`storedIslandGeography`,
  which also blocks every mine slot's yard, `inMineFootprint`). SHALLOW is already `WATER` +
  `shallowWater` (aquaculture-capable), DEEP is `WATER`, SAND is `SHORE`, ROCK is `BLOCKED`.
- Browser: `apps/web/src/render/island-world.ts` (cell map, scenery, spawn),
  `apps/web/src/render/terrain.ts` (`addChosenIsland`: ground mesh at 2 samples per cell, tinted water),
  `apps/web/src/render/terrain-height.ts` (`IslandField`: shore distance, softened height, waterline
  drop, colours), `apps/web/src/player/collision.ts` (`shoreDepthFor`: today the walker stops at the
  coast, so **no water is walkable**).
- Picker: `apps/web/src/island-picker.ts` draws a 2D preview from the same generator.
- Mines stand on `ORE` sites (`islandMineTiles`, `packages/game-data/src/mines`). Fishing spots are still
  the composed island's fixed list: chosen islands do not yet fish from their own water.
- THUY today: `roughness 0.3, coastFrequency 6, bays 7, bayDepth 0.75` - deep, narrow inlets that cut the
  land into hard-to-walk fingers. That is the owner's "đi lại hơi khó".

## Goals

1. **Prettier islands.** Each element reads at a glance and looks finished, from the picker preview to
   the 3D world:
   - coastlines with headlands and coves, but no slivers;
   - a clear water-depth gradient (turquoise shallows, then deep blue);
   - a beach band and shoreline foam;
   - gentle relief (hills, a few terraces or cliffs where they suit the element);
   - optional ponds or a river where they fit;
   - biome patches that look designed, not noisy;
   - one or two landmarks per element, for example: rock spires and a quarry (Kim), an old grove (Mộc),
     lagoons and a reef (Thủy), meadows and a ridge (Hỏa), terraced fields (Thổ).
2. **Water you can use.**
   - **Shallow sea (SHALLOW) is walkable** (wading speed is fine) and is where aquaculture goes.
   - **Deep sea (DEEP) is not walkable** and is where fishing happens.
   - The coast should give a usable band of shallows on every element; Thủy gets the most (lagoons, reef
     flats).
3. **Walkable Thủy.** Every land cell, and every shallow cell meant to be reachable, must connect to the
   camp by walking through land or shallows. Inlets can stay pretty but must not cut the island into
   unreachable fingers.
4. **Complete.** Sites must sit on sensible ground:
   - camp: open land near the dock;
   - dock: on the coast, facing deep water;
   - fish bays: deep water next to shallows;
   - pastures: open meadow (Hỏa);
   - ores: rock (Kim) or solid land.
   Each element keeps its identity (counts in `RECIPES`).

## Research (do this before designing)

Study how comparable games make islands read well, and write 5-10 concrete takeaways into
`docs/design/ISLAND_V2_RESEARCH.md`:

- Animal Crossing: New Horizons: island layouts, river/cliff tiers, beach rings.
- Farm Together: plots and expansion feel.
- Stardew Valley: Ginger Island.
- Islanders and Townscaper: low-poly islands with depth-coloured water and foam.
- Dorfromantik: biome tiles.
- Sea of Thieves: shallow vs deep water colour.
- Coral Island and Cozy Grove.

Only study how they look and play. **Copy no assets, names, maps or layouts** (AGENTS.md mission).

## Constraints

- Server authoritative: what a cell *is* (water, shallow, shore, blocked) comes from the stored ground,
  which the server validates against. Walkability is browser movement, but it must agree with the cell
  kinds the server stores.
- Deterministic and pure: the same template gives the same island on server and browser. No
  `Math.random`, no browser APIs in `packages/game-data`.
- Keep generation under about 5 ms on a Worker (benchmark, as in the v1 work). Keep the stored format,
  extending the cell codes only if needed (a new code needs a migration only if the server stores
  something new; the cells column is text).
- v1 islands must keep working unchanged (draw, collide, place, mines).
- Performance in the browser: one ground mesh, instanced scenery, no per-frame allocation. Check on the
  low quality profile (`?quality=low`) and a mid laptop.
- Migrations: only if needed; `--` comments, no `/* */`, no `;` inside comments (see
  `docs/deployment/STAGING.md`).

## Done when

- `ISLAND_GENERATOR_VERSION = 2` produces new islands for every element and outline. The v1
  fingerprint test still passes. New tests check that, for every element x outline x several seeds:
  - land and intended shallows are connected to the camp;
  - sites sit on legal ground;
  - there is a minimum shallow band;
  - DEEP surrounds the island edge;
  - the generator stays under the time budget.
- Shallow water is walkable in the browser and blocks building and planting. Deep water is not walkable.
  Aquaculture can be placed in shallows on chosen islands (server-side, via the stored ground).
- **Deep-water fishing on chosen islands:** fishing places derived from the stored island (for example
  FISH_BAY sites in deep water), served by the server per farm and drawn in the browser. Keep the composed
  island's spots for v1 and composed farms.
- The picker preview and the 3D island both look clearly better. Attach before/after screenshots of each
  element (picker plus 3D overview) to the report. Use the Playwright tooling pattern from the previous
  sessions: swiftshader, island farms only.
- `npm run typecheck`, `npm run lint` (new code) and `npm test` pass, apart from the four failures and two
  lint errors that predate this work, which the report must name. Update
  `docs/design/` and `docs/CONTEXT_INDEX.md`.

## Out of scope

Sea reclamation (buying sea to grow the island), livestock, NPC workers, building art tiers, economy
changes. Note anything they will need, but do not build them.

## After this ships

The owner wants to **start over on staging**. Islands are fixed at creation, so the reset should come
*after* v2 is deployed, or players would be left on v1 islands. Plan for it, but do not do it without the
owner's go-ahead. The intended way is a fresh D1 database (all migrations applied) bound in
`workers/api/wrangler.staging.toml`, keeping the old database as an archive. The deploy itself runs from
the owner's workstation (`npx wrangler login`), because the cloud proxy cannot upload Worker assets.
