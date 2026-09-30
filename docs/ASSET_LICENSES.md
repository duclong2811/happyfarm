# Asset licences and provenance

Status: living document. Update it in the same change that adds, replaces, or removes a third-party
asset, and never import a pack whose licence has not been read at its own source.

HappyFarm ships a small, curated set of third-party models. Everything here was downloaded from the
creator's own page - not from a mirror, a re-upload, or an asset aggregator - and every entry below
records what was verified, when, and what was done to the files afterwards.

**Rule:** if a source's official page stops stating a licence clearly, that pack is not used. The
alternative is not "assume CC0"; it is to stop and ask.

## What ships today

| Pack | Creator | Source | Licence | Retrieved | Formats used | HappyFarm categories | Modified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stylized Nature MegaKit | Quaternius | https://quaternius.com/packs/stylizednaturemegakit.html | CC0 1.0 (stated on the pack page, linking to https://creativecommons.org/publicdomain/zero/1.0/) | 2026-09-30 | glTF → GLB | environment: trees, bushes, rocks, flowers, plants | Yes - see "Normalization" |
| Medieval Village MegaKit | Quaternius | https://quaternius.com/packs/medievalvillagemegakit.html | CC0 1.0 (stated on the pack page, linking to https://creativecommons.org/publicdomain/zero/1.0/) | 2026-09-30 | glTF → GLB | props: crate, wagon, fence rails | Yes - see "Normalization" |
| Kenney Nature Kit | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | shipped before this pass (2026-09-2x) | GLB | environment filler: rim trees, distant scrub | No |

Both Quaternius packs were downloaded from their itch.io download pages, which the creator's own site
links to as the official source:

- https://quaternius.itch.io/stylized-nature-megakit
- https://quaternius.itch.io/medieval-village-megakit

## What was selected, and what was left out

The island places 18 environment models and 4 props, not the packs' 68 and 176.

**Selected from Stylized Nature** - chosen for silhouette variety at gameplay distance and for a
triangle budget a browser can afford: `CommonTree_2/3/4/5`, `Pine_2/4/5`, `Bush_Common`,
`Bush_Common_Flowers`, `Rock_Medium_1/2/3`, `Fern_1`, `Grass_Common_Tall`, `Grass_Wispy_Tall`,
`Clover_2`, `Flower_3_Group`, `Flower_4_Group`.

**Rejected from Stylized Nature:** the `TwistedTree_*` family (9,000-10,000 triangles each, more than
twice the heaviest tree shipped, for a silhouette that reads as "spooky" rather than as farmland);
`DeadTree_1..5` for the same reason; `Mushroom_*` and the `Pebble_*`/`RockPath_*` sets, which are
detail props for a first-person game and invisible at farm-camera distance; `Petal_*`, at 13-30
triangles, which are smaller than a single tile.

**Selected from Medieval Village:** `Prop_Crate`, `Prop_Wagon`, `Prop_WoodenFence_Single`,
`Prop_WoodenFence_Extension1`.

**Rejected from Medieval Village:** the whole modular building kit - walls, roofs, doors, windows,
stairs, balconies, towers. Two reasons, and both matter: assembling a farmhouse out of modular pieces
is a modelling job with its own art direction (and a naive assembly reads as a kit demo, which the
brief explicitly rules out), and the pack's brick-and-round-tile architecture is a *medieval village*
rather than a rural farm. HappyFarm's own structures stay as the existing stylized primitives until a
structure pass can build and review them properly. The pack's decorative masonry (`Prop_Brick*`,
`Prop_Chimney*`, `Prop_Vine*`) was rejected as belonging to that same building style.

**Not used this pass:** Styloo COZY FARM and KayKit Medieval Builder/Hexagon. They are approved
sources but were not retrieved: see "Not used, and why" below.

## Normalization

The packs ship `.gltf` + external `.bin` + shared 2K PNGs. Shipping that as-is would mean a multi-file
asset per model (which Vite's per-file asset handling does not preserve) and roughly two megabytes of
bark normal map per tree. `tools/asset-pipeline/node/import-cc0.mjs` converts each selected model into
one self-contained `.glb`:

1. **Base colour only.** Normal, occlusion, and emissive maps are dropped: a stylized flat-shaded
   world has nothing to do with a normal map, and they are the largest files in the packs.
2. **Textures downscaled to 256 px** (box filter, PNG, embedded). At gameplay distance the difference
   is not visible; the size difference is 100:1 on the bark maps.
3. **Normalized geometry.** Each model is scaled and translated so it is **one world unit across its
   largest dimension, centred on X/Z, with its base on `y = 0`**. The largest dimension rather than
   the height, because half of a nature pack is flat: dividing a flower by its height would make it
   metres wide. The world model then says "this tree is 3.4 metres" and is right.
4. **Self-contained.** One embedded buffer, embedded PNGs, no sibling files.

The per-model result - triangles, bytes, and which textures were kept - is committed as
`tools/asset-pipeline/node/import-report.json`, so a change in the source packs is visible in review.

The Kenney models shipped earlier are *not* re-imported; their normalizing factor lives beside the
manifest entry (`unitScale` in `apps/web/src/render/environment-model-urls.ts`), measured from the
shipped files.

## Not used, and why

| Source | Status | Reason |
| --- | --- | --- |
| Styloo - COZY FARM (https://styloo.itch.io/farm, CC0) | approved, not retrieved | Its download page serves the pack through itch.io's purchase flow rather than a direct file. Rather than work around it - and rather than take the pack from a re-upload, which the brief forbids while the creator's own page exists - it is left for a pass that can fetch it properly. Its intended roles (barn, hay, barrels, fences) are currently filled by the existing primitives and by the Medieval Village props. |
| KayKit - Medieval Builder / Hexagon (CC0) | approved, not used | Nothing in the candidate list (windmill, well, bridge, market) was needed once the settlement's own primitives and the Quaternius props covered those places, and its pieces are a *different* stylised dialect from Quaternius. Adding them for the sake of the list would work against the art-consistency gate. |

## Adding an asset

1. Read the licence on the creator's own page. If it is not clearly CC0 (or another licence the
   project has explicitly accepted), stop.
2. Download and extract into a temporary directory **outside the repository**.
3. Add the model to the curated list in `tools/asset-pipeline/node/import-cc0.mjs`, and run it.
4. Copy nothing by hand: the tool writes the `.glb` into `apps/web/src/assets/models/<category>/`.
5. Add the id to the manifest in `apps/web/src/render/environment-model-urls.ts`, with its category,
   tier, `unitScale`, and provenance id.
6. Add the row to the table above, and the id to the expected set in
   `tests/integration/environment-model-assets.test.ts`.
7. Delete the temporary download. `tests/integration/environment-model-assets.test.ts` fails if an
   archive, an `.fbx`, a `.gltf`, or any other source-pack file is committed.
