# 0030. The natural Home Island is the player's land

Status: accepted (V14.5.2). Supersedes the ownership-as-a-placement-boundary parts of ADR 0029; the
green-terrain rule in 0029 still stands.

## Context

V14.5.1 made placement freeform but still sold the ground under it: planting or building on a cell the
farm had no `farm_tiles` row for meant a land quote, a purchase and a second confirmation. That was
the wrong shape for the product. The island the player looks at **is** their farm; buying invisible
ownership over grass that already exists is not a decision anyone wants to make.

## Decision

### Natural land is free to use

If a cell is valid natural Home Island land for the action being asked for, the player may use it
immediately. No quote, no purchase, no land charge, no ownership mutation.

```text
natural Home Island land  ->  the player may develop it
ocean / pond / beach / volcano / protected ground  ->  still refused
```

What changed:

* `packages/domain/src/construction.ts` no longer has an ownership refusal (`NOT_OWNED` is gone), and
  the client's `placement-preview.ts` no longer refuses unowned cells.
* `PlantCrop` and `PlantTree` validate the ground through the island's own classifier
  (`TileTerrainLookup` / `landOriginFor`) instead of `UnlockedLandPolicy`, which is deleted.
* The planting and construction settlements write the `farm_tiles` rows a used cell needs, for free.
  Those rows are now **tile state and legacy ownership bookkeeping**, not a licence: they keep the
  crop foreign key and the construction cross-occupancy triggers working, and nothing reads them to
  decide what a player may do.
* `expectedTileVersion` on a plant is optional: absent means "this cell has no row yet".

### What still limits placement

Geography and the asset's own rules, unchanged: the island boundary, ocean, the pond, the beach
(unless the asset asks for the shore), the volcano, protected/reserved ground, occupied cells,
terrain-specific placement rules, collision, level, and the seed/item cost. The server is the one that
decides all of it; neither an ownership row nor the client can make ocean into land.

### The buying UI is gone, the legacy endpoints are not

Removed from the client: the Land strip (plots, "Unlock next plot"), the single-cell "Buy individual
cells" mode, the land-buy HUD, the ownership and purchasable overlays, and the quote/purchase steps in
the plant and build flows. Normal planting and building now make **fewer** network requests - the
plant and place commands are the whole flow.

Kept, deliberately, on the server and in the client API module as legacy: `POST /farms/:id/plots`,
`POST /farms/:id/land/quote` and `POST /farms/:id/land/cells`. They are unreachable from the normal
UI; existing tests, old saves and the expansion migration continue to work against them, and deleting
foundational land code is a later, separate decision.

### The reclamation boundary

Sea reclamation is **not** implemented. The architecture leaves one clean seam for it:

```text
usable land = natural Home Island land OR (later) reclaimed land
```

`packages/domain/src/land.ts` owns the vocabulary (`LandOrigin = "NATURAL" | "RECLAIMED"`,
`isUsableLand`) and the one classifier (`landOriginFor`). Today every usable cell is `NATURAL`; a later
pass teaches the host's terrain lookup about reclaimed cells, and every placement rule keeps asking
the same question. Reclamation is fundamentally different from the ownership-over-grass that was
removed: it converts water into land, permanently, at a real cost.

## Consequences

* The island reads as "this whole island is my farm"; the only land cost left is a future one for
  making *new* land.
* Existing `farm_tiles` rows are untouched, and no migration runs. Old farms, expanded farms and crops
  keep loading exactly as before.
* Fewer requests and fewer D1 reads on the plant/build path, and the ownership overlays are gone from
  normal play entirely.

## Known limitations

* The legacy land-purchase endpoints still charge Gold if called directly; they are documented as
  legacy-only and are not wired to any control.
* Water-only catalogue entries (the fish cage) cannot be placed on natural land, and reclamation does
  not exist yet, so those objects remain unplaceable for now.

## Development note: the dev API host reloads

The Vite dev server runs the real Worker in-process. `createDevApiHost` captures the routes and the
payload schemas when it is built, so a host memoized for the whole session kept answering with the
pre-edit contract while the browser had already reloaded with the new client - the "stale worker"
behind both the V14.5.1C `invalid_union` and the V14.5.2A first-use plant (`INVALID_INPUT`, because
the running host still required an `expectedTileVersion` the new client no longer sends).

`apps/web/dev-api-host-cache.ts` now caches the host per generation: an edit under `workers/`,
`packages/` or `database/` retires it, the SSR module graph is invalidated, and the next request
builds a fresh host. A retired generation is closed only once no request is in flight, so a poll is
never answered by a closed database handle. A deployed Worker still needs a redeploy after a
server-side change; that is inherent, and the client's `INVALID_RESPONSE` fallback keeps a contract
skew from ever showing validator output.
