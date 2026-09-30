# 0025 - V10: curated asset library, set dressing, and the composition preset

Status: accepted (V10, on top of `0842556`)

## Context

V9 rebuilt the island's composition but every building still stood alone on grass, and the two
plantation districts still lost the estate test: an orchard and a managed wood that a viewer cannot
name from the estate camera are, visually, not there.

V10 is the pass that furnishes the island with real models and makes the plantations legible. It also
found one live bug in the asset pipeline that had been shipping since V8.

## Decisions

### The composition preset

`apps/web/src/render/composition.ts` defines `EnvironmentCompositionPreset`: an anchor, a facing, a
clearance radius, and a list of props with authored offsets in the anchor's own frame. The presets
themselves live in `world-config.ts`, because that file is the one place a world coordinate is
written down, and `buildCompositions` turns them into world metres with the same `terrainHeightAt`
the ground mesh and collision use.

Six places are furnished: `barn_yard_t1`, `market_square_t1`, `farmhouse_yard_t1`, `orchard_yard_t1`,
`logging_yard_t1`, `fishery_t1`. The scenery pass now reads the presets' clearings, so nothing grows
through a yard.

### A prop manifest, separate from scenery

`apps/web/src/render/prop-model-urls.ts` is a second, smaller manifest: id, file, real size in metres,
and the role the model is allowed to fill. Scenery is a scatter - a kind, a tier and a roll - and a
composition is the opposite: an authored object at an authored spot. Merging the two would mean a
barrel could be rolled where a bush was meant.

### Twenty props from the Fantasy Props MegaKit

CC0, from the creator's own page, imported by `import-cc0.mjs` behind a `--fantasy` argument. Twenty
models, chosen so that each one says what a place *is*, and repeated across six compositions. The
runtime never loads one it does not place: props are fetched lazily by id, exactly like scenery.

### The pipeline bug

`metallicRoughnessTexture` lives inside `pbrMetallicRoughness` while every other dropped texture slot
lives on the material. The importer's single delete pass therefore removed three of the four and left
that one index pointing at a texture that no longer existed, which makes the whole GLB fail to load.
It was invisible for two packs and broke the first one that ships ORM maps. The four Medieval Village
props that shipped with it - and never loaded, because nothing placed them - are re-imported.

Removing the ORM map also means the material must stop defaulting to a fully metallic surface, so the
importer now writes `metallicFactor = 0` and `roughnessFactor = 0.9`: the same dielectric, rough
surface every other material in the scene uses.

### The orchard and the managed wood, again

Three changes, and the estate screenshot is the only reason for each:

1. **Tight along the row, wide between rows.** Rows every 2.6 tiles with a tree every 1.1 along them,
   and a mown lane two tiles wide between the rows. An even lattice at any spacing reads as a block of
   trees; that ratio reads as rows.
2. **One cultivar.** Every orchard tree is `tree_broad_2` and every forestry tree is `tree_pine_2`,
   named by the district rather than rolled: a row of four canopy shapes is a thicket.
3. **Turned to follow the coast.** The orchard's long axis now runs along the shoreline it occupies,
   which fits twice the plantation on the same land and puts its rows across the estate camera's view
   instead of away from it.

The mown lane is a new shared material (`mownLane`), used only under orchard rows.

### Ground and detail

The barn yard, quay, timber yard and square keep the ground treatments V9 gave them; the farmhouse
gained a worn footpath to the square, the wilderness gained two meadow patches, and the lake's sand
bank is drawn with enough sectors to read as a shore rather than as a polygon.

## Consequences

* `COMPOSITION_PRESETS` is world config, so a second composition is a table edit.
* The orchard's lattice is now read by `production.ts` from the district rather than repeated as
  hard-coded coordinates - the second copy had already drifted and was placing cells outside the
  orchard.
* Tests: `tests/web/farm-composition.test.ts` (preset districts, prop ids and files, nothing on the
  reserve, nothing floating, scenery out of clearings, determinism) and the curated-set list in
  `tests/integration/environment-model-assets.test.ts`.
* Nothing about farming, land, prices, persistence, contracts or authority changed. Compositions are
  decoration: they place no tile, block no rule, and produce nothing.
